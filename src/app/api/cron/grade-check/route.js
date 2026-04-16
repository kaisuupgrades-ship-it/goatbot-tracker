// /api/cron/grade-check
// Safety-net cron: finds picks on concluded games that were never graded
// and either grades them or flags them in the AI error log for admin review.
//
// Schedule (vercel.json): 0 */2 * * *  (every 2 hours)
//
// A pick is considered "on a concluded game" when its commence_time is
// more than 4 hours in the past — enough time for any sport's final
// to be posted on ESPN's scoreboard API.
//
// Grading reuses the same gradePicksAgainstScoreboard logic as
// /api/cron/grade-picks — no duplicated grading rules.
//
// Ungraded picks that still can't be graded are written to ai_error_logs
// so they surface in the admin panel's Errors tab.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  fetchESPNScoreboard,
  gradePicksAgainstScoreboard,
  SPORT_PATHS,
  SKIP_PICK_RE,
  parseAnalysisPick,
  findAnalysisGame,
  gradeAnalysisPick,
} from '@/lib/gradeEngine';

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(req) {
  // ── Auth: require CRON_SECRET (fail-closed) ───────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Admin soft-disable flag
  const { data: enabledSetting } = await supabase
    .from('settings').select('value').eq('key', 'cron_grade_check_enabled').maybeSingle();
  if (enabledSetting?.value === 'false') {
    return NextResponse.json({ skipped: true, reason: 'Disabled by admin' });
  }

  const started = Date.now();

  // Picks whose games started 4+ hours ago (should be concluded regardless of sport)
  const cutoffTime = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
  // Look back 7 days max — older picks are very unlikely to be fixable
  const cutoffDate = new Date(Date.now() - 7 * 86400 * 1000).toISOString().split('T')[0];

  const { data: picks, error: fetchErr } = await supabase
    .from('picks')
    .select('*')
    .or('result.is.null,result.eq.PENDING')
    .not('commence_time', 'is', null)
    .lt('commence_time', cutoffTime)
    .gte('date', cutoffDate)
    .limit(500);

  if (fetchErr) {
    console.error('[cron/grade-check] DB fetch error:', fetchErr.message);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  // NOTE: do NOT early-return when picks is empty — Phase 2 (AI analysis grading)
  // must always run regardless of whether there are user picks pending.
  if (!picks?.length) {
    console.log('[cron/grade-check] No concluded ungraded user picks found — proceeding to Phase 2');
  } else {
    console.log(`[cron/grade-check] Found ${picks.length} ungraded picks on concluded games`);
  }

  // Skip parlays — gradeParlay needs multi-sport leg resolution; grade-picks handles those
  const regularPicks = picks.filter(p =>
    !p.is_parlay &&
    (p.sport || '').toUpperCase() !== 'PARLAY' &&
    (p.bet_type || '').toLowerCase() !== 'parlay'
  );

  // Group by sport + game date for batched ESPN calls
  const groups = {};
  for (const pick of regularPicks) {
    const sport = (pick.sport || '').toLowerCase();
    if (!SPORT_PATHS[sport] && sport !== 'soccer') continue;
    const gameDate = new Date(pick.commence_time).toISOString().slice(0, 10);
    const key = `${sport}|${gameDate}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(pick);
  }

  const scoreboardCache = {};
  let gradedCount = 0;
  const gradedPickIds = new Set();

  // ── Primary pass: grade using game date derived from commence_time ──────────
  for (const [key, groupPicks] of Object.entries(groups)) {
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
          graded_home_score: g.home_score ?? null,
          graded_away_score: g.away_score ?? null,
        })
        .eq('id', g.id)
        .or('result.is.null,result.eq.PENDING');

      if (!updateErr) {
        gradedCount++;
        gradedPickIds.add(g.id);
      }
    }
  }

  // ── Previous-day fallback: handles late-night games where commence_time and
  //    pick.date land on different UTC days ────────────────────────────────────
  const stillUngraded = regularPicks.filter(p => !gradedPickIds.has(p.id));
  if (stillUngraded.length > 0) {
    const prevGroups = {};
    for (const pick of stillUngraded) {
      const sport = (pick.sport || '').toLowerCase();
      if (!SPORT_PATHS[sport] && sport !== 'soccer') continue;
      const gameDate = new Date(pick.commence_time).toISOString().slice(0, 10);
      const prevDate = new Date(new Date(`${gameDate}T12:00:00Z`).getTime() - 86400000)
        .toISOString().slice(0, 10);
      const key = `${sport}|${prevDate}`;
      if (!prevGroups[key]) prevGroups[key] = [];
      prevGroups[key].push(pick);
    }
    for (const [key, groupPicks] of Object.entries(prevGroups)) {
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
            graded_home_score: g.home_score ?? null,
            graded_away_score: g.away_score ?? null,
          })
          .eq('id', g.id)
          .or('result.is.null,result.eq.PENDING');

        if (!updateErr) {
          gradedCount++;
          gradedPickIds.add(g.id);
        }
      }
    }
  }

  // ── Flag anything still ungraded → error log + review queue ──────────────
  const flagPicks = regularPicks.filter(p => !gradedPickIds.has(p.id));
  let flaggedCount = 0;

  // Batch-check which pick_ids already have a PENDING review request
  // to avoid inserting duplicates on every cron run.
  let existingReviewPickIds = new Set();
  if (flagPicks.length > 0) {
    try {
      const { data: existing } = await supabase
        .from('pick_review_requests')
        .select('pick_id')
        .in('pick_id', flagPicks.map(p => p.id))
        .eq('status', 'PENDING');
      (existing || []).forEach(r => existingReviewPickIds.add(r.pick_id));
    } catch { /* non-critical — proceed, dedup will just be skipped */ }
  }

  for (const pick of flagPicks) {
    const label = [pick.team, pick.bet_type, pick.line != null ? pick.line : null]
      .filter(Boolean).join(' ');

    // Write to ai_error_logs for Errors tab visibility
    try {
      await supabase.from('ai_error_logs').insert([{
        pick_id:       pick.id,
        user_id:       pick.user_id || null,
        error_message: `Ungraded pick found for concluded game: ${label}`,
        pick_data:     JSON.stringify({
          team:     pick.team,
          sport:    pick.sport,
          bet_type: pick.bet_type,
          line:     pick.line,
          odds:     pick.odds,
          date:     pick.date,
          commence_time: pick.commence_time,
        }),
        ai_diagnosis: `commence_time ${pick.commence_time} is >4 hours past — game should be final. ESPN scoreboard returned no matching game. Possible causes: team name mismatch, postponed game not reflected in ESPN, or unsupported sport/league.`,
        created_at:    new Date().toISOString(),
        resolved:      false,
      }]);
    } catch (logErr) {
      console.warn('[cron/grade-check] Could not log to ai_error_logs for pick', pick.id, logErr?.message);
    }

    // Insert into pick_review_requests for the Reviews queue — skip if one already exists
    if (!existingReviewPickIds.has(pick.id)) {
      try {
        await supabase.from('pick_review_requests').insert([{
          pick_id:          pick.id,
          user_id:          pick.user_id || null,
          user_message:     'Auto-detected: ungraded pick on concluded game — needs manual grading',
          suggested_changes: {
            type:         'ungraded',
            game_status:  'concluded',
            commence_time: pick.commence_time,
          },
          status:     'PENDING',
          created_at: new Date().toISOString(),
        }]);
      } catch (reviewErr) {
        console.warn('[cron/grade-check] Could not insert review request for pick', pick.id, reviewErr?.message);
      }
    }

    flaggedCount++;
  }

  // ── Phase 2: Grade ungraded AI game analyses ─────────────────────────────
  // Safety net for game_analyses rows that were skipped by grade-picks because
  // ESPN hadn't marked the game STATUS_FINAL yet (common for late west-coast games).
  let aiGraded = 0, aiSkipped = 0, aiNoScore = 0;
  try {
    const todayStr   = new Date().toISOString().split('T')[0];
    const { data: analyses, error: analysisErr } = await supabase
      .from('game_analyses')
      .select('id, sport, away_team, home_team, game_date, analysis, prediction_result, prediction_pick')
      .is('prediction_result', null)
      .lte('game_date', todayStr)
      .gte('game_date', cutoffDate)
      .limit(200);

    if (!analysisErr && analyses?.length) {
      console.log(`[cron/grade-check] Found ${analyses.length} ungraded AI analyses`);

      for (const row of analyses) {
        const storedPick = (row.prediction_pick || '').trim();
        // Intentional non-picks → mark PUSH (no action) instead of leaving null forever
        if (storedPick && SKIP_PICK_RE.test(storedPick)) {
          await supabase.from('game_analyses')
            .update({ prediction_result: 'PUSH', prediction_graded_at: new Date().toISOString() })
            .eq('id', row.id)
            .is('prediction_result', null);
          aiSkipped++;
          continue;
        }

        let pick;
        if (storedPick) {
          pick = parseAnalysisPick(`THE PICK: ${storedPick}\n`);
        }
        if (!pick || pick.type === 'unknown') {
          pick = parseAnalysisPick(row.analysis);
        }
        if (!pick || pick.type === 'unknown') { aiSkipped++; continue; }

        const sport    = (row.sport || '').toLowerCase();
        const cacheKey = `${sport}|${row.game_date}`;
        if (!scoreboardCache[cacheKey]) {
          scoreboardCache[cacheKey] = await fetchESPNScoreboard(sport, row.game_date);
        }
        const scoreboard = scoreboardCache[cacheKey];
        if (!scoreboard?.events) { aiNoScore++; continue; }

        const game = findAnalysisGame(scoreboard.events, row.away_team, row.home_team);
        if (!game) { aiNoScore++; continue; }

        const result = gradeAnalysisPick(pick, game, row.away_team, row.home_team);
        if (!result) { aiSkipped++; continue; }

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
          .is('prediction_result', null);
        if (!updateErr) aiGraded++;
      }
    }
  } catch (aiErr) {
    console.error('[cron/grade-check] AI analysis grading error:', aiErr.message);
  }

  // ── Completeness assertion ────────────────────────────────────────────────
  // Sportsbook-grade invariant: any non-parlay pick whose game date is more
  // than 48h in the past MUST have a terminal result. If it doesn't, something
  // upstream is broken (unknown sport, malformed row, team-match failure,
  // silent API error — all of which have happened before). Count how many
  // rows violate the invariant and log a visible alert to the error_log table
  // so the admin dashboard can surface it. Avoids the "silent accumulation"
  // failure mode where stuck picks pile up for weeks before anyone notices.
  let stuckCount = 0;
  try {
    const cutoffDate = new Date(Date.now() - 48 * 3600_000).toISOString().slice(0, 10);
    const { count } = await supabase
      .from('picks')
      .select('id', { count: 'exact', head: true })
      .or('result.is.null,result.eq.PENDING')
      .lt('date', cutoffDate)
      .eq('is_parlay', false);
    stuckCount = count || 0;
    if (stuckCount > 0) {
      await supabase.from('error_log').insert({
        level:    'warning',
        source:   'cron/grade-check',
        endpoint: '/api/cron/grade-check',
        message:  `Completeness alert: ${stuckCount} non-parlay pick(s) stuck PENDING past date < ${cutoffDate}`,
        metadata: { stuck_count: stuckCount, cutoff_date: cutoffDate, checked_at: new Date().toISOString() },
      });
      console.warn(`[cron/grade-check] STUCK PICKS DETECTED: ${stuckCount} row(s) past ${cutoffDate}`);
    }
  } catch (assertErr) {
    console.warn('[cron/grade-check] Completeness assertion failed (non-fatal):', assertErr?.message);
  }

  // ── Persist run summary to settings for admin observability ───────────────
  const summary = {
    found:       picks.length,
    graded:      gradedCount,
    flagged:     flaggedCount,
    stuck_picks: stuckCount,
    ai_analyses: { graded: aiGraded, skipped: aiSkipped, noScore: aiNoScore },
    duration_ms: Date.now() - started,
    run_at:      new Date().toISOString(),
  };
  try {
    await supabase.from('settings').upsert(
      [{ key: 'cron_grade_check_last_run', value: JSON.stringify(summary) }],
      { onConflict: 'key' }
    );
  } catch { /* non-critical */ }

  console.log('[cron/grade-check]', summary);
  return NextResponse.json(summary);
}
