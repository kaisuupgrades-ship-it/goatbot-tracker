/**
 * /api/grade-picks
 * User-triggered grading: checks ESPN for final scores on a user's PENDING picks.
 *
 * POST { userId, force? }
 *  → normal: grades result=PENDING or result=null picks from last 7 days
 *  → force:  re-checks all picks from last 14 days (re-grades anything whose result is wrong)
 *
 * Returns { graded: [...], count }
 */
import { NextResponse } from 'next/server';
import { createClient }  from '@supabase/supabase-js';
import {
  fetchESPNScoreboard,
  gradePicksAgainstScoreboard,
  SPORT_PATHS,
  SOCCER_FALLBACK_PATHS,
} from '@/lib/gradeEngine';

export const maxDuration = 45;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const body             = await req.json();
    const { userId, force = false } = body;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const todayStr   = new Date().toISOString().split('T')[0];
    const lookback   = force ? 14 : 7;
    const cutoffDate = new Date(Date.now() - lookback * 86400000).toISOString().split('T')[0];

    // Grab picks from the lookback window — both explicit PENDING and null-result picks
    let query = supabase
      .from('picks')
      .select('*')
      .eq('user_id', userId)
      .gte('date', cutoffDate)
      .lte('date', todayStr)
      .limit(200);

    if (!force) {
      query = query.or('result.eq.PENDING,result.is.null');
    }

    const { data: picks, error } = await query;
    if (error) throw error;
    if (!picks?.length) return NextResponse.json({ graded: [], count: 0 });

    // Group by sport+date to minimise ESPN API calls
    const groups = {};
    for (const pick of picks) {
      const sport = (pick.sport || '').toLowerCase();
      // Allow generic 'soccer' and 'other' through — fetchESPNScoreboard handles fallback
      const supported = SPORT_PATHS[sport] || sport === 'soccer' || sport === 'other';
      if (!supported) continue;
      const key = `${sport}|${pick.date}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(pick);
    }

    const allGraded = [];
    const scoreboardCache = {};

    for (const [key, groupPicks] of Object.entries(groups)) {
      const [sport, dateStr] = key.split('|');
      if (!scoreboardCache[key]) {
        scoreboardCache[key] = await fetchESPNScoreboard(sport, dateStr);
      }
      const scoreboard = scoreboardCache[key];
      if (!scoreboard?.events) continue;

      const graded = gradePicksAgainstScoreboard(groupPicks, scoreboard);

      for (const g of graded) {
        // Idempotency: only grade picks that are still PENDING (result IS NULL)
        // This prevents double-grading if cron + manual trigger overlap
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
          allGraded.push(g);
          // Award XP for result: WIN +20, PUSH +3
          const xpGain = g.result === 'WIN' ? 20 : g.result === 'PUSH' ? 3 : 0;
          if (xpGain > 0 && g.user_id) {
            try {
              const RANKS = [
                { title: 'Degenerate', minXp: 0 }, { title: 'Square', minXp: 100 },
                { title: 'Handicapper', minXp: 300 }, { title: 'Sharp', minXp: 700 },
                { title: 'Steam Chaser', minXp: 1500 }, { title: 'Wiseguy', minXp: 3000 },
                { title: 'Line Mover', minXp: 6000 }, { title: 'Syndicate', minXp: 10000 },
                { title: 'Whale', minXp: 20000 }, { title: 'Legend', minXp: 40000 },
              ];
              const { data: prof } = await supabase.from('profiles').select('xp').eq('id', g.user_id).single();
              const newXp = (prof?.xp || 0) + xpGain;
              let rank = RANKS[0];
              for (const r of RANKS) { if (newXp >= r.minXp) rank = r; }
              await supabase.from('profiles').update({ xp: newXp, rank_title: rank.title }).eq('id', g.user_id);
            } catch { /* non-critical */ }
          }
        }
      }
    }

    return NextResponse.json({ graded: allGraded, count: allGraded.length });
  } catch (err) {
    console.error('[grade-picks] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
