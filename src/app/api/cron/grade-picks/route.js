/**
 * /api/cron/grade-picks
 * Vercel Cron: grades PENDING picks for ALL users during game hours.
 *
 * Schedule (vercel.json):
 *   */5 17-23 * * *  →  noon–midnight ET (main evening window)
 *   */5 0-8 * * *    →  midnight–4am ET  (late west coast games)
 *
 * Key fixes:
 *  - Catches result=null picks as well as result='PENDING'
 *  - Looks back 7 days (not just yesterday) so old stuck picks get graded
 *  - Uses shared gradeEngine so logic is identical across all grading paths
 *  - Batches ESPN calls per sport+date — one fetch per group across all users
 */
import { NextResponse }   from 'next/server';
import { createClient }   from '@supabase/supabase-js';
import {
  fetchESPNScoreboard,
  gradePicksAgainstScoreboard,
  SPORT_PATHS,
} from '@/lib/gradeEngine';

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(req) {
  // ── Auth: allow both CRON_SECRET header AND Vercel's own cron invocation ──
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is set, enforce it. If it's not set, allow the request
  // (useful during initial setup before the env var is configured).
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    if (!SPORT_PATHS[sport]) continue;
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
      const { error: updateErr } = await supabase
        .from('picks')
        .update({
          result:            g.result,
          profit:            g.profit,
          graded_at:         new Date().toISOString(),
          graded_home_score: g.home_score,
          graded_away_score: g.away_score,
        })
        .eq('id', g.id);

      if (!updateErr) {
        gradedCount++;
        affectedUsers.add(g.user_id);
      }
    }
  }

  const summary = {
    graded:      gradedCount,
    users:       affectedUsers.size,
    skipped:     skippedCount,
    duration_ms: Date.now() - started,
    run_at:      new Date().toISOString(),
  };

  console.log('[cron/grade-picks]', JSON.stringify(summary));

  // Persist last-run stats for Admin Panel visibility
  await supabase.from('settings')
    .upsert([{ key: 'cron_grade_last_run', value: JSON.stringify(summary) }], { onConflict: 'key' })
    .catch(() => {});

  return NextResponse.json(summary);
}
