/**
 * /api/game-analyses — Public read of today's pre-generated BetOS analyses.
 * Used by ScoreboardTab to show AI leans on game cards without auth.
 *
 * GET ?date=2026-04-05   (defaults to today)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 10;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

  const { data, error } = await supabase
    .from('game_analyses')
    .select('id, sport, away_team, home_team, game_date, updated_at, analysis')
    .eq('game_date', date)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ analyses: [] });

  // Parse just the key fields from each analysis — keeps payload small
  const analyses = (data || []).map(row => {
    const pickM  = row.analysis?.match(/THE PICK[:\s]+([^\n]{5,120})/i);
    const confM  = row.analysis?.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
    const edgeM  = row.analysis?.match(/EDGE SCORE[:\s]+([\d.]+)/i);
    const edgeBM = row.analysis?.match(/EDGE BREAKDOWN[:\s]*([^\n]{10,200})/i);
    return {
      id:        row.id,
      sport:     row.sport,
      away_team: row.away_team,
      home_team: row.home_team,
      updated_at: row.updated_at,
      pick:      pickM?.[1]?.trim()  || null,
      conf:      confM?.[1]?.trim()  || null,
      edge:      edgeM?.[1]?.trim()  || null,
      edge_breakdown: edgeBM?.[1]?.trim() || null,
    };
  });

  return NextResponse.json({ analyses, date });
}
