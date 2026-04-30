/**
 * /api/admin/upload-postmortem
 *
 * GET  → returns a queue of graded analyses that don't have a post-mortem yet.
 *         Used by the betos-postmortem-catchup scheduled task to know what to review.
 * POST → writes one structured post-mortem result into analysis_lessons.
 *
 * Auth: bearer ANALYSIS_UPLOAD_SECRET (same secret used for upload-analysis).
 *
 * Designed so the scheduled task does the AI reasoning under Pro Max OAuth
 * (zero API tokens) and only this server holds the service-role key. The task
 * never touches Supabase directly.
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_LESSON_TYPES = new Set([
  'betting_angle', 'injury_miss', 'line_value', 'matchup_read', 'weather',
  'motivation', 'model_overconfident', 'sharp_edge', 'public_fade',
  'situational', 'bullpen', 'pitching', 'scoring_pace', 'defensive', 'other',
]);

const ALLOWED_BET_TYPES = new Set(['ml', 'spread', 'over', 'under']);

function bad(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

function checkAuth(req) {
  const secret = process.env.ANALYSIS_UPLOAD_SECRET;
  if (!secret) return { error: 'ANALYSIS_UPLOAD_SECRET not configured', status: 503 };
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${secret}`) return { error: 'Unauthorized', status: 401 };
  return null;
}

// ── GET: queue of graded analyses needing a post-mortem ─────────────────────
export async function GET(req) {
  const authErr = checkAuth(req);
  if (authErr) return bad(authErr.error, authErr.status);

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 50);

  let supabase;
  try {
    supabase = supabaseAdmin();
  } catch (e) {
    return bad(`Server config error: ${e.message}`, 503);
  }

  // Pull recent graded analyses
  const { data: graded, error: gradedErr } = await supabase
    .from('game_analyses')
    .select('id, sport, game_date, home_team, away_team, analysis, prediction_pick, prediction_conf, prediction_result, final_score, prompt_version, provider, prediction_graded_at')
    .not('prediction_result', 'is', null)
    .order('prediction_graded_at', { ascending: false })
    .limit(limit * 3); // fetch extra since some may already have lessons

  if (gradedErr) {
    return NextResponse.json({ error: 'Failed to fetch graded analyses', detail: gradedErr.message }, { status: 500 });
  }
  if (!graded?.length) return NextResponse.json({ queue: [], count: 0 });

  // Filter out analyses that already have a lesson recorded
  const ids = graded.map(g => g.id);
  const { data: existing, error: existingErr } = await supabase
    .from('analysis_lessons')
    .select('analysis_id')
    .in('analysis_id', ids);

  if (existingErr) {
    return NextResponse.json({ error: 'Failed to check existing lessons', detail: existingErr.message }, { status: 500 });
  }

  const existingIds = new Set((existing || []).map(e => e.analysis_id));
  const queue = graded
    .filter(g => !existingIds.has(g.id))
    .slice(0, limit)
    .map(g => ({
      analysis_id:        g.id,
      sport:              g.sport,
      game_date:          g.game_date,
      home_team:           g.home_team,
      away_team:           g.away_team,
      analysis:           (g.analysis || '').slice(0, 2500), // cap to keep payload small
      prediction_pick:    g.prediction_pick,
      prediction_conf:    g.prediction_conf,
      prediction_result:  g.prediction_result,
      final_score:        g.final_score,
    }));

  return NextResponse.json({ queue, count: queue.length });
}

// ── POST: receive one structured post-mortem and write to analysis_lessons ──
export async function POST(req) {
  const authErr = checkAuth(req);
  if (authErr) return bad(authErr.error, authErr.status);

  let body;
  try { body = await req.json(); } catch { return bad('Body must be valid JSON'); }
  if (!body || typeof body !== 'object') return bad('Body must be a JSON object');

  // Required: analysis_id + a minimal narrative
  const analysisId = String(body.analysis_id || '').trim();
  if (!analysisId) return bad('Missing required field: analysis_id');

  const postmortem = String(body.postmortem || '').trim();
  if (!postmortem) return bad('Missing required field: postmortem');
  if (postmortem.length < 20) return bad('postmortem text too short (<20 chars)');
  if (postmortem.length > 5000) return bad('postmortem exceeds 5000 char limit');

  // Optional structured fields with validation
  const lessonType = String(body.lesson_type || 'other').toLowerCase().trim();
  if (!ALLOWED_LESSON_TYPES.has(lessonType)) {
    return bad(`lesson_type must be one of ${[...ALLOWED_LESSON_TYPES].join('/')}`);
  }

  const betType = body.bet_type ? String(body.bet_type).toLowerCase().trim() : null;
  if (betType && !ALLOWED_BET_TYPES.has(betType)) {
    return bad(`bet_type must be one of ${[...ALLOWED_BET_TYPES].join('/')}`);
  }

  let supabase;
  try {
    supabase = supabaseAdmin();
  } catch (e) {
    return bad(`Server config error: ${e.message}`, 503);
  }

  // Look up the analysis to populate contextual fields server-side
  const { data: analysis, error: lookupErr } = await supabase
    .from('game_analyses')
    .select('id, sport, game_date, home_team, away_team, prediction_pick, prediction_conf, prediction_result, final_score, prompt_version, provider')
    .eq('id', analysisId)
    .maybeSingle();

  if (lookupErr || !analysis) {
    return bad(`Analysis ${analysisId} not found`, 404);
  }

  // Attach the most-recent audit log if there is one
  const { data: auditLog } = await supabase
    .from('analysis_audit_logs')
    .select('id')
    .eq('analysis_id', analysisId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Insert the lesson
  const { data, error: insertErr } = await supabase
    .from('analysis_lessons')
    .insert([{
      analysis_id:         analysis.id,
      audit_log_id:        auditLog?.id || null,
      sport:               analysis.sport,
      game_date:           analysis.game_date,
      home_team:           analysis.home_team,
      away_team:           analysis.away_team,
      predicted_pick:      analysis.prediction_pick,
      predicted_conf:      analysis.prediction_conf,
      predicted_edge:      null,
      result:              analysis.prediction_result,
      final_score:         analysis.final_score,
      postmortem,
      lesson_type:         lessonType,
      bet_type:            betType,
      key_factor:          body.key_factor      ? String(body.key_factor).trim().slice(0, 200)      : null,
      lesson_summary:      body.lesson_summary  ? String(body.lesson_summary).trim().slice(0, 2000) : null,
      avoid_pattern:       body.avoid_pattern   ? String(body.avoid_pattern).trim().slice(0, 500)   : null,
      seek_pattern:        body.seek_pattern    ? String(body.seek_pattern).trim().slice(0, 500)    : null,
      was_overconfident:   body.was_overconfident === true,
      was_underconfident:  body.was_underconfident === true,
      confidence_delta:    Number.isFinite(body.confidence_delta) ? body.confidence_delta : 0,
      prompt_version:      analysis.prompt_version,
      model_used:          body.model_used || analysis.provider || 'claude-scheduled-task',
      generated_by:        body.generated_by || 'scheduled_task',
    }])
    .select('id, analysis_id')
    .maybeSingle();

  if (insertErr) {
    // Unique-violation = already has a lesson; treat as idempotent ok
    if (insertErr.code === '23505') {
      return NextResponse.json({ ok: true, duplicate: true, analysis_id: analysisId });
    }
    return NextResponse.json({ error: 'Database insert failed', detail: insertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, row: data });
}
