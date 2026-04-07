/**
 * /api/grade-game
 * Client-triggered instant grading when HistoryTab detects STATUS_FINAL via live score polling.
 * Accepts final score data directly — no ESPN fetch needed.
 * Grades ALL users' PENDING/null picks for that game and returns the graded list.
 *
 * POST { sport, homeTeam, awayTeam, homeScore, awayScore, gameDate }
 * → { graded: [{ id, user_id, result, profit, home_score, away_score, contest_entry }], count }
 */
import { NextResponse } from 'next/server';
import { createClient }  from '@supabase/supabase-js';
import { gradePick, pickMatchesGame } from '@/lib/gradeEngine';

export const maxDuration = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function POST(req) {
  try {
    const { sport, homeTeam, awayTeam, homeScore, awayScore, gameDate } = await req.json();

    if (!homeTeam || !awayTeam || !gameDate) {
      return NextResponse.json({ error: 'homeTeam, awayTeam, gameDate required' }, { status: 400 });
    }

    // Find ALL pending picks for this date across all users.
    // Filter by sport in the query (not just in JS) to avoid loading picks from other sports.
    let query = supabase
      .from('picks')
      .select('*')
      .or('result.eq.PENDING,result.is.null')
      .eq('date', gameDate);

    if (sport) {
      query = query.ilike('sport', sport);
    }

    const { data: allPending } = await query.limit(500);
    const picks = allPending || [];

    if (!picks.length) return NextResponse.json({ graded: [], count: 0 });

    const graded = [];

    for (const pick of picks) {
      if (!pickMatchesGame(pick, homeTeam, awayTeam)) continue;

      const gradeResult = gradePick(pick, homeTeam, awayTeam, homeScore, awayScore);
      if (!gradeResult) continue;

      // Idempotency: only grade picks that are still PENDING
      const { error } = await supabase
        .from('picks')
        .update({
          result:            gradeResult.result,
          profit:            gradeResult.profit,
          graded_at:         new Date().toISOString(),
          graded_home_score: homeScore,
          graded_away_score: awayScore,
        })
        .eq('id', pick.id)
        .is('result', null);

      if (!error) {
        graded.push({
          id:            pick.id,
          user_id:       pick.user_id,
          result:        gradeResult.result,
          profit:        gradeResult.profit,
          home_score:    homeScore,
          away_score:    awayScore,
          contest_entry: pick.contest_entry,
        });
      }
    }

    console.log(`[grade-game] ${homeTeam} vs ${awayTeam} ${homeScore}-${awayScore}: graded ${graded.length} picks`);
    return NextResponse.json({ graded, count: graded.length });

  } catch (err) {
    console.error('[grade-game] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
