// /api/cron/grade-picks
// Vercel Cron: grades PENDING picks for ALL users during game hours.
//
// Schedule (vercel.json):
//   every 5 min, 15-23 UTC  →  11am-7pm ET  (afternoon + evening games)
//   every 5 min, 0-9 UTC    →  8pm-5am ET   (late west coast + overnight)
//   every 5 min, 10-14 UTC  →  6am-10am ET  (closes the early morning gap)
//
// Key fixes:
//  - Catches result=null picks as well as result='PENDING'
//  - Looks back 7 days (not just yesterday) so old stuck picks get graded
//  - Uses shared gradeEngine so logic is identical across all grading paths
//  - Batches ESPN calls per sport+date — one fetch per group across all users
//  - Parlays graded via gradeParlay (handles multi-sport legs independently)
//  - Postponed/cancelled games void picks (PUSH) per standard sportsbook practice
import { NextResponse }   from 'next/server';
import { createClient }   from '@supabase/supabase-js';
import {
  fetchESPNScoreboard,
  gradePicksAgainstScoreboard,
  gradeParlay,
  SPORT_PATHS,
  SOCCER_FALLBACK_PATHS,
} from '@/lib/gradeEngine';
import { generatePostMortems } from '@/lib/feedbackLoop';

export const maxDuration = 120; // bumped for post-mortem generation

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Golf / PGA Tour grading helpers ───────────────────────────────────────────
/**
 * Fetch the current PGA Tour leaderboard from ESPN.
 * Returns an array of { name, position, status } objects if a completed
 * or in-progress tournament is found, otherwise null.
 */
async function fetchPGALeaderboard() {
  try {
    const res = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    // ESPN golf returns events[] each with a competitors/leaderboard array
    const events = data?.events || [];
    if (!events.length) return null;
    // Use the most recently completed or active event
    const event = events.find(e => e.status?.type?.completed) || events[0];
    if (!event) return null;
    const competitors = event.competitions?.[0]?.competitors || [];
    const leaderboard = {
      eventName: event.name || 'PGA Event',
      completed: !!event.status?.type?.completed,
      players: competitors.map(c => ({
        name:     c.athlete?.displayName || c.athlete?.fullName || '',
        position: c.status?.position?.id ? parseInt(c.status.position.id) : 999,
        tied:     c.status?.position?.displayName?.startsWith('T') || false,
      })),
    };
    // M-9: guard against missing completed flag
    if (leaderboard.completed === undefined) return null;
    return leaderboard;
  } catch {
    return null;
  }
}

/**
 * Grade a golf moneyline pick against the PGA leaderboard.
 * Returns 'WIN' if player won, 'LOSS' if tournament is complete and they didn't,
 * or null if the tournament is still in progress (can't grade yet).
 */
function gradeGolfPick(playerName, betType, leaderboard) {
  if (!leaderboard?.players?.length) return null;
  // Only grade if tournament is complete
  if (!leaderboard.completed) return null;

  const nameNorm = (playerName || '').toLowerCase().replace(/[^a-z]/g, '');
  // Require minimum match length to avoid ambiguous short-name collisions
  if (nameNorm.length < 4) return null; // name too short to match reliably
  const match = leaderboard.players.find(p => {
    const pNorm = (p.name || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!pNorm || pNorm.length < 4) return false;
    // Prefer exact match over partial
    if (pNorm === nameNorm) return true;
    // Partial: only match if overlap is substantial (at least 5 chars)
    const shorter = Math.min(pNorm.length, nameNorm.length);
    if (shorter < 5) return false;
    return pNorm.includes(nameNorm) || nameNorm.includes(pNorm);
  });
  if (!match) return 'LOSS'; // Player not in event = loss
  return match.position === 1 ? 'WIN' : 'LOSS';
}

// ── AI Analysis pick parsing & grading (for pre-generated game analyses) ──────
function parseAnalysisPick(analysis) {
  const pickMatch = analysis?.match(/THE PICK[:\s]+([^\n]{5,150})/i);
  if (!pickMatch) return null;

  const confMatch = analysis?.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
  const conf = confMatch?.[1] || null;

  // Normalize the pick line:
  //  1. Strip markdown bold/italic markers (** and *)
  //  2. Strip "— N units" or "- N units" trailing suffix
  //  3. Normalize parenthesized odds: (-110) → -110, (+200) → +200
  //  4. Strip remaining parentheticals like (est. -145) or (Pinnacle line looks stale)
  //  5. Strip sportsbook name trailing tokens
  //  6. Strip "PL" (puck line indicator) that appears between spread and odds
  const pickLine = pickMatch[1].trim()
    .replace(/\*+/g, '')                          // strip * and **
    .replace(/\s+[—–-]+\s+[\d.]+\s+units?.*$/i, '') // strip "— 2 units" suffix
    .replace(/\(([+-]?\d+)\)/g, '$1')             // (-110) → -110, (+200) → +200
    .replace(/\([^)]*\)/g, '')                    // strip remaining parentheticals
    .replace(/\s+(DraftKings|FanDuel|BetMGM|Caesars|Pinnacle|PointsBet|BetRivers|Fanatics|MyBookie|Bookmaker|ESPN\s*Bet)\s*$/i, '')
    .replace(/\s+PL\b/i, '')                      // strip "PL" (puck line) token
    .trim();

  // Over/Under total
  const overMatch = pickLine.match(/^Over\s+([\d.]+)/i);
  if (overMatch) return { type: 'over', total: parseFloat(overMatch[1]), raw: pickLine, conf };
  const underMatch = pickLine.match(/^Under\s+([\d.]+)/i);
  if (underMatch) return { type: 'under', total: parseFloat(underMatch[1]), raw: pickLine, conf };

  // Team ML — handles both "ML" abbreviation and "Moneyline" spelled out
  const mlMatch = pickLine.match(/^(.+?)\s+(?:ML|Moneyline)\s+([+-]?\d+)/i);
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
  // Allow dots/apostrophes in team names (e.g. "St. Louis Cardinals", "D'Antoni")
  // Also handles "TEAM ML" without odds (e.g. after stripping "est." odds)
  const fallbackMatch = pickLine.match(/^([A-Z][a-zA-Z0-9\s.']+?)(?:\s+(?:ML|Moneyline)|\s+[+-]?\d)/i);
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
    if (!(status?.startsWith('STATUS_FINAL') || status === 'STATUS_FULL_TIME')) continue;

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
  // Strip punctuation for a cleaner comparison (handles "St. Louis" vs "St Louis")
  const clean = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const p = clean(pickTeam);
  const a = clean(awayTeam);
  const h = clean(homeTeam);
  if (!p) return null;
  // Full substring match
  if (h.includes(p) || p.includes(h)) return 'home';
  if (a.includes(p) || p.includes(a)) return 'away';
  // Last word match (e.g. "Cardinals" matches "St. Louis Cardinals")
  const pLast = p.split(' ').pop();
  if (pLast && pLast.length >= 4) {
    if (h.split(' ').includes(pLast)) return 'home';
    if (a.split(' ').includes(pLast)) return 'away';
  }
  // Any significant word in the pick team matches a word in the ESPN name
  const pWords = p.split(' ').filter(w => w.length >= 4);
  for (const w of pWords) {
    if (h.split(' ').includes(w)) return 'home';
    if (a.split(' ').includes(w)) return 'away';
  }
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

  // NOTE: do NOT early-return when picks is empty — Phase 2 (AI analysis grading)
  // must always run regardless of whether there are user picks pending.
  const allPicks = picks || [];

  // Separate picks by grading path:
  //   parlayPicks  → gradeParlay (multi-sport, needs DB leg lookup)
  //   otherPicks   → golf PGA grading path
  //   regularPicks → ESPN scoreboard grading
  const parlayPicks  = allPicks.filter(p =>
    p.is_parlay || (p.sport || '').toUpperCase() === 'PARLAY' || (p.bet_type || '').toLowerCase() === 'parlay'
  );
  const otherPicks   = allPicks.filter(p =>
    !p.is_parlay && (p.sport || '').toLowerCase() === 'other' && (p.bet_type || '').toLowerCase() !== 'parlay'
  );
  const regularPicks = allPicks.filter(p =>
    !p.is_parlay &&
    (p.sport || '').toUpperCase() !== 'PARLAY' &&
    (p.bet_type || '').toLowerCase() !== 'parlay' &&
    (p.sport || '').toLowerCase() !== 'other'
  );

  // Group regular picks by sport + date to batch ESPN calls
  const groups = {};
  for (const pick of regularPicks) {
    const sport = (pick.sport || '').toLowerCase();
    const supported = SPORT_PATHS[sport] || sport === 'soccer' || sport === 'other';
    if (!supported) continue;
    // Use the actual game date (from commence_time) so we fetch the right ESPN scoreboard.
    // pick.date is the submission date — if a user added the pick the night before,
    // pick.date would be yesterday and the game wouldn't appear in that day's scoreboard.
    const gameDate = pick.commence_time
      ? new Date(pick.commence_time).toISOString().slice(0, 10)
      : pick.date;
    const key = `${sport}|${gameDate}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(pick);
  }

  const scoreboardCache = {};
  let gradedCount  = 0;
  let skippedCount = 0;
  const affectedUsers = new Set();
  const gradedPickIds = new Set(); // track graded pick IDs for fallback retry

  for (const [key, groupPicks] of Object.entries(groups)) {
    const [sport, dateStr] = key.split('|');

    if (!scoreboardCache[key]) {
      scoreboardCache[key] = await fetchESPNScoreboard(sport, dateStr);
    }
    const scoreboard = scoreboardCache[key];
    if (!scoreboard?.events) { skippedCount += groupPicks.length; continue; }

    const graded = await gradePicksAgainstScoreboard(groupPicks, scoreboard, supabase);
    skippedCount += groupPicks.length - graded.length;

    for (const g of graded) {
      // Idempotency: only update if still ungraded (null OR 'PENDING' string)
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
        .or('result.is.null,result.eq.PENDING');

      if (!updateErr) {
        gradedCount++;
        affectedUsers.add(g.user_id);
        gradedPickIds.add(g.id);
      }
    }
  }

  // ── Phase 1b-retry: previous-day scoreboard fallback ──────────────────────
  // Fixes edge case: when a pick lacks commence_time, we use pick.date (UTC).
  // If the game started at e.g. 7pm ET (23:00 UTC), a pick logged at 11pm ET
  // (03:00 UTC next day) gets pick.date = next UTC day, so the primary lookup
  // finds zero games. Retry ungraded regular picks using (gameDate − 1 day).
  const ungradedRegular = regularPicks.filter(p => !gradedPickIds.has(p.id));
  if (ungradedRegular.length > 0) {
    const prevDayGroups = {};
    for (const pick of ungradedRegular) {
      const sport = (pick.sport || '').toLowerCase();
      if (!SPORT_PATHS[sport] && sport !== 'soccer') continue;
      const gameDate = pick.commence_time
        ? new Date(pick.commence_time).toISOString().slice(0, 10)
        : pick.date;
      // Subtract 1 day (anchored at noon UTC to avoid DST weirdness)
      const prevDate = new Date(new Date(`${gameDate}T12:00:00Z`).getTime() - 86400000)
        .toISOString().slice(0, 10);
      const key = `${sport}|${prevDate}`;
      if (!prevDayGroups[key]) prevDayGroups[key] = [];
      prevDayGroups[key].push(pick);
    }
    for (const [key, groupPicks] of Object.entries(prevDayGroups)) {
      const [sport, dateStr] = key.split('|');
      if (!scoreboardCache[key]) {
        scoreboardCache[key] = await fetchESPNScoreboard(sport, dateStr);
      }
      const scoreboard = scoreboardCache[key];
      if (!scoreboard?.events) continue;
      const graded = await gradePicksAgainstScoreboard(groupPicks, scoreboard, supabase);
      for (const g of graded) {
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
          .or('result.is.null,result.eq.PENDING');
        if (!updateErr) {
          gradedCount++;
          affectedUsers.add(g.user_id);
          gradedPickIds.add(g.id);
        }
      }
    }
  }

  // ── Phase 1c: Grade parlay picks ─────────────────────────────────────────
  // Parlays span multiple sports/games — gradeParlay fetches each leg's
  // scoreboard independently and grades each leg, then combines results.
  for (const pick of parlayPicks) {
    try {
      const parlayResult = await gradeParlay(pick, supabase);
      if (!parlayResult) { skippedCount++; continue; }

      const { error: updateErr } = await supabase
        .from('picks')
        .update({
          result:    parlayResult.result,
          profit:    parlayResult.profit,
          graded_at: new Date().toISOString(),
        })
        .eq('id', pick.id)
        .or('result.is.null,result.eq.PENDING');

      if (!updateErr) {
        gradedCount++;
        affectedUsers.add(pick.user_id);
      }
    } catch (parlayErr) {
      console.error('[cron/grade-picks] Error grading parlay', pick.id, ':', parlayErr.message);
      skippedCount++;
    }
  }

  // ── Phase 1b: Grade "Other" sport picks — Golf (PGA Tour) ──────────────────
  // Uses the ESPN Golf PGA leaderboard. A moneyline pick on a golfer's name grades
  // WIN if they're in 1st place in a Final-status tournament, LOSS otherwise.
  if (otherPicks.length > 0) {
    try {
      const golfLeaderboard = await fetchPGALeaderboard();
      if (golfLeaderboard) {
        for (const pick of otherPicks) {
          const playerName = (pick.team || '').trim();
          if (!playerName) { skippedCount++; continue; }

          const gradeResult = gradeGolfPick(playerName, pick.bet_type, golfLeaderboard);
          if (!gradeResult) { skippedCount++; continue; }

          const units = parseFloat(pick.units) || 1;
          const odds  = pick.odds || 0;
          const profit = gradeResult === 'WIN'
            ? (odds > 0 ? units * (odds / 100) : units * (100 / Math.abs(odds)))
            : -units;

          const { error: golfUpdateErr } = await supabase
            .from('picks')
            .update({
              result:    gradeResult,
              profit:    parseFloat(profit.toFixed(3)),
              graded_at: new Date().toISOString(),
            })
            .eq('id', pick.id)
            .or('result.is.null,result.eq.PENDING');

          if (!golfUpdateErr) {
            gradedCount++;
            affectedUsers.add(pick.user_id);
          }
        }
      } else {
        // Can't reach ESPN golf — leave Other picks as PENDING for manual review
        skippedCount += otherPicks.length;
      }
    } catch (golfErr) {
      console.error('[cron/grade-picks] Golf grading error:', golfErr.message);
      skippedCount += otherPicks.length;
    }
  }

  // ── Phase 2: Auto-grade AI analysis predictions ──────────────────────────
  let aiGraded = 0, aiSkipped = 0, aiNoScore = 0, aiWins = 0, aiLosses = 0, aiPushes = 0;

  try {
    // Fetch all ungraded analyses where game_date is today or earlier
    // Include prediction_pick so we can use the pre-stored value instead of re-parsing analysis text
    const { data: analyses, error: analysisErr } = await supabase
      .from('game_analyses')
      .select('id, sport, away_team, home_team, game_date, analysis, prediction_result, prediction_pick')
      .is('prediction_result', null)
      .lte('game_date', todayStr)
      .gte('game_date', cutoffDate)
      .limit(500);

    if (!analysisErr && analyses?.length) {
      console.log(`[cron/grade-picks] Found ${analyses.length} ungraded AI analyses`);

      for (const row of analyses) {
        // 1. Parse the pick.
        //    Prefer the pre-stored prediction_pick column (already extracted when the analysis
        //    was generated) over re-parsing the full analysis text. The analysis text uses
        //    markdown formatting (**Team -4 (-110)**) that the parser struggles with.
        //    Fall back to parsing analysis text only when prediction_pick is absent.
        let pick;
        const storedPick = (row.prediction_pick || '').trim();
        if (storedPick && !/^pass[.\s—-]*/i.test(storedPick)) {
          // Synthesize the THE PICK: prefix so parseAnalysisPick can handle it
          pick = parseAnalysisPick(`THE PICK: ${storedPick}\n`);
        }
        // Fall back to full analysis text if stored pick is absent or failed to parse
        if (!pick || pick.type === 'unknown') {
          pick = parseAnalysisPick(row.analysis);
        }
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

        // 5. Update the row.
        //    Only update prediction_pick if it wasn't already populated — the stored
        //    value is the canonical one (used for display) and shouldn't be overwritten
        //    with a re-parsed/normalized version.
        const updatePayload = {
          prediction_result:    result,
          prediction_conf:      pick.conf || null,
          prediction_graded_at: new Date().toISOString(),
          final_score:          `${game.awayScore}-${game.homeScore}`,
        };
        if (!row.prediction_pick) {
          updatePayload.prediction_pick = pick.raw;
        }
        const { error: updateErr } = await supabase
          .from('game_analyses')
          .update(updatePayload)
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
        } catch (auditErr) { console.warn('[cron/grade-picks] audit log update failed:', auditErr.message); }
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
  } catch (settingsErr) { console.warn('[cron/grade-picks] failed to persist run stats:', settingsErr.message); }

  return NextResponse.json(summary);
}
