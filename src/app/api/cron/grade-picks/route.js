// /api/cron/grade-picks
// Vercel Cron: grades PENDING picks for ALL users during game hours.
//
// Schedule (vercel.json):
//   every 5 min, 17-23 UTC  →  noon-midnight ET (main evening window)
//   every 5 min, 0-8 UTC    →  midnight-4am ET  (late west coast games)
//
// Key fixes:
//  - Catches result=null picks as well as result='PENDING'
//  - Looks back 7 days (not just yesterday) so old stuck picks get graded
//  - Uses shared gradeEngine so logic is identical across all grading paths
//  - Batches ESPN calls per sport+date — one fetch per group across all users
import { NextResponse }   from 'next/server';
import { createClient }   from '@supabase/supabase-js';
import {
  fetchESPNScoreboard,
  gradePicksAgainstScoreboard,
  SPORT_PATHS,
  SOCCER_FALLBACK_PATHS,
} from '@/lib/gradeEngine';
import { generatePostMortems } from '@/lib/feedbackLoop';

export const maxDuration = 120; // bumped for post-mortem generation

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── AI Analysis pick parsing & grading (for pre-generated game analyses) ──────
function parseAnalysisPick(analysis) {
  const pickMatch = analysis?.match(/THE PICK[:\s]+([^\n]{5,150})/i);
  if (!pickMatch) return null;
  const pickLine = pickMatch[1].trim();

  const confMatch = analysis?.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
  const conf = confMatch?.[1] || null;

  // Over/Under total
  const overMatch = pickLine.match(/^Over\s+([\d.]+)\s/i);
  if (overMatch) return { type: 'over', total: parseFloat(overMatch[1]), raw: pickLine, conf };
  const underMatch = pickLine.match(/^Under\s+([\d.]+)\s/i);
  if (underMatch) return { type: 'under', total: parseFloat(underMatch[1]), raw: pickLine, conf };

  // Team ML
  const mlMatch = pickLine.match(/^(.+?)\s+ML\s+([+-]?\d+)/i);
  if (mlMatch) return { team: mlMatch[1].trim(), type: 'ml', line: parseInt(mlMatch[2]), raw: pickLine, conf };

  // Team spread (e.g., "Nets +6.5 -110")
  const spreadMatch = pickLine.match(/^(.+?)\s+([+-][\d.]+)\s+[+-]?\d+/i);
  if (spreadMatch) {
    const spread = parseFloat(spreadMatch[2]);
    if (spread !== Math.floor(spread) || Math.abs(spread) > 20) {
      return { team: spreadMatch[1].trim(), type: 'spread', spread, raw: pickLine, conf };
    }
  }

  // Fallback: assume ML if team name found
  const fallbackMatch = pickLine.match(/^([A-Z][a-zA-Z\s]+?)(?:\s+ML|\s+[+-]?\d)/i);
  if (fallbackMatch) return { team: fallbackMatch[1].trim(), type: 'ml', raw: pickLine, conf };

  return { type: 'unknown', raw: pickLine, conf };
}

function findAnalysisGame(events, awayTeam, homeTeam) {
  const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const away = normalize(awayTeam);
  const home = normalize(homeTeam);

  for (const evt of events) {
    const comp = evt.competitions?.[0];
    if (!comp) continue;
    const status = comp.status?.type?.name;
    if (!['STATUS_FINAL', 'STATUS_FULL_TIME'].includes(status)) continue;

    const competitors = comp.competitors || [];
    const homeC = competitors.find(c => c.homeAway === 'home');
    const awayC = competitors.find(c => c.homeAway === 'away');
    if (!homeC || !awayC) continue;

    const homeNames = [homeC.team?.displayName, homeC.team?.shortDisplayName, homeC.team?.name, homeC.team?.abbreviation].filter(Boolean).map(normalize);
    const awayNames = [awayC.team?.displayName, awayC.team?.shortDisplayName, awayC.team?.name, awayC.team?.abbreviation].filter(Boolean).map(normalize);

    const homeMatch = homeNames.some(n => n.includes(home) || home.includes(n));
    const awayMatch = awayNames.some(n => n.includes(away) || away.includes(n));

    if (homeMatch && awayMatch) {
      return {
        homeScore: parseInt(homeC.score),
        awayScore: parseInt(awayC.score),
        totalScore: parseInt(homeC.score) + parseInt(awayC.score),
      };
    }
  }
  return null;
}

function gradeAnalysisPick(pick, game, awayTeam, homeTeam) {
  if (!pick || !game) return null;
  const { homeScore, awayScore, totalScore } = game;

  if (pick.type === 'over') return totalScore > pick.total ? 'WIN' : totalScore < pick.total ? 'LOSS' : 'PUSH';
  if (pick.type === 'under') return totalScore < pick.total ? 'WIN' : totalScore > pick.total ? 'LOSS' : 'PUSH';

  if (pick.type === 'ml') {
    const side = identifyAnalysisSide(pick.team, awayTeam, homeTeam);
    if (!side) return null;
    if (side === 'home') return homeScore > awayScore ? 'WIN' : homeScore < awayScore ? 'LOSS' : 'PUSH';
    return awayScore > homeScore ? 'WIN' : awayScore < homeScore ? 'LOSS' : 'PUSH';
  }

  if (pick.type === 'spread') {
    const side = identifyAnalysisSide(pick.team, awayTeam, homeTeam);
    if (!side) return null;
    const pickedScore = side === 'home' ? homeScore : awayScore;
    const oppScore    = side === 'home' ? awayScore : homeScore;
    const adjusted = pickedScore + pick.spread;
    return adjusted > oppScore ? 'WIN' : adjusted < oppScore ? 'LOSS' : 'PUSH';
  }

  return null;
}

function identifyAnalysisSide(pickTeam, awayTeam, homeTeam) {
  const p = (pickTeam || '').toLowerCase().trim();
  const a = (awayTeam || '').toLowerCase().trim();
  const h = (homeTeam || '').toLowerCase().trim();
  if (h.includes(p) || p.includes(h) || h.split(' ').pop() === p.split(' ').pop()) return 'home';
  if (a.includes(p) || p.includes(a) || a.split(' ').pop() === p.split(' ').pop()) return 'away';
  const pLast = p.split(' ').pop();
  if (h.split(' ').some(w => w === pLast)) return 'home';
  if (a.split(' ').some(w => w === pLast)) return 'away';
  return null;
}

export async function GET(req) {
  // ── Auth: require CRON_SECRET to be configured (fail-closed) ──
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;

  // Fail-closed: if CRON_SECRET is not configured, return 503
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }

  // If CRON_SECRET is set, enforce it
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check admin-controlled enable flag (soft disable without redeploying)
  const { data: enabledSetting } = await supabase
    .from('settings').select('value').eq('key', 'cron_grade_picks_enabled').maybeSingle();
  if (enabledSetting?.value === 'false') {
    return NextResponse.json({ skipped: true, reason: 'Disabled by admin' });
  }

  const started    = Date.now();
  const todayStr   = new Date().toISOString().split('T')[0];
  const cutoffDate = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  // Fetch ALL pending picks across ALL users from the last 7 days
  // Include both explicit 'PENDING' AND null (newly inserted picks with default)
  const { data: picks, error } = await supabase
    .from('picks')
    .select('*')
    .or('result.eq.PENDING,result.is.null')
    .gte('date', cutoffDate)
    .lte('date', todayStr)
    .limit(1000);

  if (error) {
    console.error('[cron/grade-picks] DB error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!picks?.length) {
    const summary = { graded: 0, users: 0, skipped: 0, duration_ms: Date.now() - started };
    console.log('[cron/grade-picks] No pending picks found', summary);
    return NextResponse.json(summary);
  }

  // Group by sport + date to batch ESPN calls
  const groups = {};
  for (const pick of picks) {
    const sport = (pick.sport || '').toLowerCase();
    // Allow known paths + generic soccer/other (fetchESPNScoreboard handles fallback)
    const supported = SPORT_PATHS[sport] || sport === 'soccer' || sport === 'other';
    if (!supported) continue;
    const key = `${sport}|${pick.date}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(pick);
  }

  const scoreboardCache = {};
  let gradedCount  = 0;
  let skippedCount = 0;
  const affectedUsers = new Set();

  for (const [key, groupPicks] of Object.entries(groups)) {
    const [sport, dateStr] = key.split('|');

    if (!scoreboardCache[key]) {
      scoreboardCache[key] = await fetchESPNScoreboard(sport, dateStr);
    }
    const scoreboard = scoreboardCache[key];
    if (!scoreboard?.events) { skippedCount += groupPicks.length; continue; }

    const graded = gradePicksAgainstScoreboard(groupPicks, scoreboard);
    skippedCount += groupPicks.length - graded.length;

    for (const g of graded) {
      // Idempotency: only grade picks that are still PENDING
      const { error: updateErr } = await supabase
        .from('picks')
        .update({
          result:            g.result,
          profit:            g.profit,
          graded_at:         new Date().toISOString(),
          graded_home_score: g.home_score,
          graded_away_score: g.away_score,
        })
        .eq('id', g.id)
        .is('result', null);

      if (!updateErr) {
        gradedCount++;
        affectedUsers.add(g.user_id);
      }
    }
  }

  // ── Phase 2: Auto-grade AI analysis predictions ──────────────────────────
  let aiGraded = 0, aiSkipped = 0, aiNoScore = 0, aiWins = 0, aiLosses = 0, aiPushes = 0;

  try {
    // Fetch all ungraded analyses where game_date is today or earlier
    const { data: analyses, error: analysisErr } = await supabase
      .from('game_analyses')
      .select('id, sport, away_team, home_team, game_date, analysis, prediction_result')
      .is('prediction_result', null)
      .lte('game_date', todayStr)
      .gte('game_date', cutoffDate)
      .limit(500);

    if (!analysisErr && analyses?.length) {
      console.log(`[cron/grade-picks] Found ${analyses.length} ungraded AI analyses`);

      for (const row of analyses) {
        // 1. Parse the pick from analysis text
        const pick = parseAnalysisPick(row.analysis);
        if (!pick || pick.type === 'unknown') { aiSkipped++; continue; }

        // 2. Reuse cached scoreboard or fetch new one
        const sport = (row.sport || '').toLowerCase();
        const cacheKey = `${sport}|${row.game_date}`;
        if (!scoreboardCache[cacheKey]) {
          scoreboardCache[cacheKey] = await fetchESPNScoreboard(sport, row.game_date);
        }
        const scoreboard = scoreboardCache[cacheKey];
        if (!scoreboard?.events) { aiNoScore++; continue; }

        // 3. Find the finished game
        const game = findAnalysisGame(scoreboard.events, row.away_team, row.home_team);
        if (!game) { aiNoScore++; continue; }

        // 4. Grade it
        const result = gradeAnalysisPick(pick, game, row.away_team, row.home_team);
        if (!result) { aiSkipped++; continue; }

        // 5. Update the row
        const { error: updateErr } = await supabase
          .from('game_analyses')
          .update({
            prediction_result:    result,
            prediction_pick:      pick.raw,
            prediction_conf:      pick.conf,
            prediction_graded_at: new Date().toISOString(),
            final_score:          `${game.awayScore}-${game.homeScore}`,
          })
          .eq('id', row.id)
          .is('prediction_result', null); // idempotency guard

        if (!updateErr) {
          aiGraded++;
          if (result === 'WIN') aiWins++;
          if (result === 'LOSS') aiLosses++;
          if (result === 'PUSH') aiPushes++;
        }

        // Also update the audit log if one exists
        try {
          await supabase
            .from('analysis_audit_logs')
            .update({
              prediction_result: result,
              final_score: `${game.awayScore}-${game.homeScore}`,
              graded_at: new Date().toISOString(),
            })
            .eq('analysis_id', row.id)
            .is('prediction_result', null);
        } catch { /* non-critical */ }
      }
    }
  } catch (aiErr) {
    console.error('[cron/grade-picks] AI analysis grading error:', aiErr.message);
  }

  // ── Phase 3: Generate post-mortems for newly graded analyses ──────────────
  // This is the learning step — AI reviews its own wins/losses and extracts
  // structured lessons that get fed back into future analysis prompts.
  let postMortemStats = { generated: 0, skipped: 0, errors: 0 };
  try {
    // Always attempt post-mortems — catches any graded analyses missing lessons.
    // Limit to 10 per run to stay within timeout. The cron runs every 5 min
    // so it'll catch up within a few cycles even with a large backlog.
    postMortemStats = await generatePostMortems(10);
    if (postMortemStats.generated > 0) {
      console.log(`[cron/grade-picks] Generated ${postMortemStats.generated} post-mortems`);
    }
  } catch (pmErr) {
    console.error('[cron/grade-picks] Post-mortem generation error:', pmErr.message);
  }

  const summary = {
    graded:      gradedCount,
    users:       affectedUsers.size,
    skipped:     skippedCount,
    ai_analyses: { graded: aiGraded, skipped: aiSkipped, noScore: aiNoScore, wins: aiWins, losses: aiLosses, pushes: aiPushes },
    postMortems: postMortemStats,
    duration_ms: Date.now() - started,
    run_at:      new Date().toISOString(),
  };

  console.log('[cron/grade-picks]', JSON.stringify(summary));

  // Persist last-run stats for Admin Panel visibility
  try {
    await supabase.from('settings')
      .upsert([{ key: 'cron_grade_last_run', value: JSON.stringify(summary) }], { onConflict: 'key' });
  } catch { /* non-critical */ }

  return NextResponse.json(summary);
}
