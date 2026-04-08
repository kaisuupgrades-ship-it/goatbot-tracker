/**
 * /api/admin/grade-analysis
 *
 * POST { id, result }           — grade a single analysis (WIN | LOSS | PUSH | null to clear)
 * GET  ?from=YYYY-MM-DD         — fetch all graded analyses for the record summary
 *                                 defaults to all-time if no param
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 10;

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// ── POST: grade a single analysis ────────────────────────────────────────────
export async function POST(req) {
  try {
    const { id, result } = await req.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const VALID = ['WIN', 'LOSS', 'PUSH', null];
    if (!VALID.includes(result)) {
      return NextResponse.json({ error: 'result must be WIN, LOSS, PUSH, or null' }, { status: 400 });
    }

    // Fetch the analysis row first so we can extract pick/conf for storage
    const { data: row, error: fetchErr } = await supabase
      .from('game_analyses')
      .select('id, analysis')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr || !row) {
      return NextResponse.json({ error: fetchErr?.message || 'Analysis not found' }, { status: 404 });
    }

    // Parse key fields from the raw analysis text
    const pickM = row.analysis?.match(/THE PICK[:\s]+([^\n]{5,120})/i);
    const confM = row.analysis?.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
    const pick  = pickM?.[1]?.trim() || null;
    const conf  = confM?.[1]?.trim() || null;

    const { error: updateErr } = await supabase
      .from('game_analyses')
      .update({
        prediction_result:    result,
        prediction_pick:      pick,
        prediction_conf:      conf,
        prediction_graded_at: result ? new Date().toISOString() : null,
      })
      .eq('id', id);

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true, id, result, pick, conf });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── GET: fetch grading record summary ────────────────────────────────────────
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from'); // optional ISO date string

    let query = supabase
      .from('game_analyses')
      .select('id, sport, away_team, home_team, game_date, prediction_pick, prediction_conf, prediction_result, prediction_graded_at, updated_at')
      .not('prediction_result', 'is', null)
      .order('prediction_graded_at', { ascending: false });

    if (from) query = query.gte('game_date', from);

    const { data, error } = await query;
    if (error) throw error;

    const graded = data || [];

    // Aggregate overall stats
    const wins   = graded.filter(r => r.prediction_result === 'WIN').length;
    const losses = graded.filter(r => r.prediction_result === 'LOSS').length;
    const pushes = graded.filter(r => r.prediction_result === 'PUSH').length;
    const settled = wins + losses;
    const winPct = settled > 0 ? Math.round((wins / settled) * 100) : null;

    // Break down by confidence level
    const byConf = {};
    for (const r of graded) {
      const c = r.prediction_conf || 'UNKNOWN';
      if (!byConf[c]) byConf[c] = { wins: 0, losses: 0, pushes: 0 };
      if (r.prediction_result === 'WIN')  byConf[c].wins++;
      if (r.prediction_result === 'LOSS') byConf[c].losses++;
      if (r.prediction_result === 'PUSH') byConf[c].pushes++;
    }

    // Break down by sport
    const bySport = {};
    for (const r of graded) {
      const s = r.sport || 'UNKNOWN';
      if (!bySport[s]) bySport[s] = { wins: 0, losses: 0, pushes: 0 };
      if (r.prediction_result === 'WIN')  bySport[s].wins++;
      if (r.prediction_result === 'LOSS') bySport[s].losses++;
      if (r.prediction_result === 'PUSH') bySport[s].pushes++;
    }

    return NextResponse.json({
      graded,
      summary: { wins, losses, pushes, settled, winPct, byConf, bySport },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
