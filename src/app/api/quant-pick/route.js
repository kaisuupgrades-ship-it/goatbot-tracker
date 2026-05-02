/**
 * /api/quant-pick
 *
 * Standalone Elo-vs-market edge endpoint.
 * Computes the BetOS quant model's recommendation for a single MLB game.
 *
 * GET /api/quant-pick?homeTeam=New+York+Yankees&awayTeam=Baltimore+Orioles&sport=mlb
 *
 * Returns a quant verdict:
 *   { available, hasPick, pick, pickOdds, edgePct, eloHomeProb, eloAwayProb,
 *     marketHomeProb, marketAwayProb, homeEdgePct, awayEdgePct, source, ... }
 *
 * `hasPick` is true only when edge ≥ MIN_EDGE_PCT (3 pp). Below threshold
 * the response still includes all the Elo/market math for transparency.
 *
 * Non-MLB sports return { available: false, reason: 'sport_not_supported' }.
 * MLB teams not in the Elo table return { available: false, reason: '...' }.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentMLBRatings } from '@/lib/eloRatings';
import { computeMLBQuantPick } from '@/lib/quantPick';

export const maxDuration = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const homeTeam = searchParams.get('homeTeam')?.trim();
  const awayTeam = searchParams.get('awayTeam')?.trim();
  const sport    = (searchParams.get('sport') || 'mlb').toLowerCase();

  if (!homeTeam || !awayTeam) {
    return NextResponse.json(
      { error: 'homeTeam and awayTeam query params are required' },
      { status: 400 },
    );
  }

  // Only MLB for now — other sports need their own Elo infra
  if (sport !== 'mlb') {
    return NextResponse.json({
      available: false,
      reason: 'sport_not_supported',
      sport,
      homeTeam,
      awayTeam,
      message: `Quant model is MLB-only right now. ${sport.toUpperCase()} support planned.`,
    });
  }

  try {
    // 1. Fetch Elo ratings (cached in-process for 5 min by eloRatings.js)
    const { ratings, source: ratingSource } = await getCurrentMLBRatings({ supabase });

    // 2. Fetch today's odds from odds_cache (fuzzy match by last team name word)
    const today   = new Date().toISOString().slice(0, 10);
    const htLast  = homeTeam.split(' ').pop().toLowerCase();
    const atLast  = awayTeam.split(' ').pop().toLowerCase();

    const { data: oddsRows, error: oddsErr } = await supabase
      .from('odds_cache')
      .select('home_team, away_team, odds_data, commence_time')
      .like('sport_key', 'baseball_mlb%')
      .gte('commence_time', `${today}T00:00:00`)
      .lte('commence_time', `${today}T23:59:59`);

    if (oddsErr) {
      console.warn('[quant-pick] odds_cache error:', oddsErr.message);
    }

    const oddsRow = (oddsRows || []).find(r =>
      (r.home_team || '').toLowerCase().includes(htLast) &&
      (r.away_team || '').toLowerCase().includes(atLast),
    );

    // 3. Compute quant pick
    const result = computeMLBQuantPick({
      ratings,
      homeTeam,
      awayTeam,
      oddsData: oddsRow?.odds_data ?? null,
    });

    return NextResponse.json({
      ...result,
      homeTeam,
      awayTeam,
      sport,
      ratingSource,
      oddsMatchedGame: oddsRow
        ? `${oddsRow.away_team} @ ${oddsRow.home_team}`
        : null,
    });
  } catch (err) {
    console.error('[quant-pick] error:', err.message);
    return NextResponse.json(
      { error: err.message, available: false },
      { status: 500 },
    );
  }
}
