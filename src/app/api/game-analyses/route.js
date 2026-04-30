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
    .select('id, sport, away_team, home_team, game_date, updated_at, analysis, prediction_pick, prediction_conf, prediction_edge, alternate_angles, line_movement, unit_sizing, win_probability')
    .eq('game_date', date)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ analyses: [] });

  // Prefer the structured DB columns (prediction_pick / prediction_conf /
  // prediction_edge) — the pregenerate cron writes directly into these so
  // the frontend doesn't have to regex-scrape the narrative text. The regex
  // path remains as a fallback for legacy rows that predate the structured
  // columns being populated, and for the numeric EDGE SCORE which isn't
  // stored in its own column.
  const analyses = (data || []).map(row => {
    const pickRegex = row.analysis?.match(/(?:^|\n)\*{0,2}THE PICK\*{0,2}\s*:\s*([^\n]{5,120})/im);
    const pickFromText = pickRegex?.[1]?.replace(/\*+/g, '').trim() || null;

    const confRegex = row.analysis?.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
    const confFromText = confRegex?.[1]?.trim() || null;

    const edgeNumRegex   = row.analysis?.match(/EDGE SCORE[:\s]+([\d.]+)/i);
    const edgeBreakRegex = row.analysis?.match(/EDGE BREAKDOWN[:\s]*([^\n]{10,200})/i);

    return {
      id:         row.id,
      sport:      row.sport,
      away_team:  row.away_team,
      home_team:  row.home_team,
      updated_at: row.updated_at,
      pick:       row.prediction_pick || pickFromText,
      conf:       row.prediction_conf || confFromText,
      edge:       edgeNumRegex?.[1]?.trim() || null,
      // prediction_edge stores the rationale text; fall back to a narrative
      // "EDGE BREAKDOWN:" section if present.
      edge_breakdown:   row.prediction_edge || edgeBreakRegex?.[1]?.trim() || null,
      // Full long-form analysis text for the scoreboard "Read full analysis"
      // expander. Capped to 6000 chars to keep the wire payload reasonable
      // when many games are loaded at once.
      analysis:         (row.analysis || '').slice(0, 6000),
      alternate_angles: row.alternate_angles || null,
      line_movement:    row.line_movement   || null,
      unit_sizing:      row.unit_sizing     || null,
      win_probability:  row.win_probability || null,
    };
  });

  return NextResponse.json({ analyses, date });
}
