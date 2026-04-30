/**
 * POST /api/admin/upload-analysis
 *
 * Single endpoint that scheduled tasks (and future agents — nanoclaw, etc.)
 * POST to with a generated game analysis. Validates the payload, upserts into
 * the `game_analyses` table on the unique (sport, game_date, home_team, away_team)
 * key, and returns the row id.
 *
 * Auth: Bearer token in Authorization header, compared against ANALYSIS_UPLOAD_SECRET.
 * Fails closed: returns 503 if the env var isn't configured at all.
 *
 * Designed to be a drop-in alternative to the Vercel cron `pregenerate-analysis`
 * pipeline. Output rows are indistinguishable downstream from cron-generated rows
 * (same columns populated, same trigger_source convention).
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/adminAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_SPORTS = new Set([
  'mlb', 'nba', 'nhl', 'nfl', 'ncaab', 'ncaaf',
  'soccer', 'mls', 'tennis', 'ufc', 'mma', 'golf', 'wnba',
]);

const ALLOWED_CONF = new Set(['ELITE', 'HIGH', 'MEDIUM', 'LOW']);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function bad(msg, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = process.env.ANALYSIS_UPLOAD_SECRET;
  if (!secret) {
    return bad('ANALYSIS_UPLOAD_SECRET not configured', 503);
  }
  const auth = req.headers.get('authorization') || '';
  if (auth !== `Bearer ${secret}`) {
    return bad('Unauthorized', 401);
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try {
    body = await req.json();
  } catch {
    return bad('Body must be valid JSON');
  }
  if (!body || typeof body !== 'object') {
    return bad('Body must be a JSON object');
  }

  // ── Required field validation ─────────────────────────────────────────────
  const sport = String(body.sport || '').toLowerCase().trim();
  if (!sport) return bad('Missing required field: sport');
  if (!ALLOWED_SPORTS.has(sport)) {
    return bad(`Unknown sport: ${sport}. Allowed: ${[...ALLOWED_SPORTS].join(', ')}`);
  }

  const gameDate = String(body.game_date || '').trim();
  if (!gameDate) return bad('Missing required field: game_date');
  if (!DATE_RE.test(gameDate)) return bad('game_date must be YYYY-MM-DD');

  const homeTeam = String(body.home_team || '').trim();
  if (!homeTeam) return bad('Missing required field: home_team');

  const awayTeam = String(body.away_team || '').trim();
  if (!awayTeam) return bad('Missing required field: away_team');

  const analysis = String(body.analysis || '').trim();
  if (!analysis) return bad('Missing required field: analysis');
  if (analysis.length < 100) {
    return bad('analysis text is suspiciously short (<100 chars) — refusing to upsert');
  }
  if (analysis.length > 50000) {
    return bad('analysis text exceeds 50,000 char limit');
  }

  // ── Required structured fields for the badge UI ───────────────────────────
  // prediction_pick + prediction_conf + prediction_edge power the AI Lean
  // badge on the scoreboard. They must always be present and well-formed —
  // an empty pick or null confidence means the badge silently disappears,
  // which is the failure mode we're designing this contract to prevent.
  const pick = String(body.prediction_pick || '').trim();
  if (!pick) return bad('Missing required field: prediction_pick');
  if (pick.length < 3 || pick.length > 200) {
    return bad('prediction_pick must be 3–200 chars');
  }

  const conf = String(body.prediction_conf || '').toUpperCase().trim();
  if (!conf) return bad('Missing required field: prediction_conf');
  if (!ALLOWED_CONF.has(conf)) {
    return bad(`prediction_conf must be one of ${[...ALLOWED_CONF].join('/')}`);
  }

  const edge = String(body.prediction_edge || '').trim();
  if (!edge) return bad('Missing required field: prediction_edge');
  if (edge.length > 20) {
    return bad('prediction_edge must be ≤20 chars (e.g. "4.2%")');
  }

  const row = {
    sport,
    game_date:        gameDate,
    home_team:        homeTeam,
    away_team:        awayTeam,
    analysis,
    model:            body.model            || 'claude-scheduled-task',
    provider:         body.provider         || 'anthropic-pro-max',
    was_fallback:     body.was_fallback === true,
    latency_ms:       Number.isFinite(body.latency_ms) ? body.latency_ms : null,
    tokens_in:        Number.isFinite(body.tokens_in)  ? body.tokens_in  : null,
    tokens_out:       Number.isFinite(body.tokens_out) ? body.tokens_out : null,
    prompt_version:   body.prompt_version   || null,
    trigger_source:   body.trigger_source   || 'scheduled_task',
    run_id:           body.run_id           || null,
    prediction_pick:  pick,
    prediction_conf:  conf,
    prediction_edge:  edge,
    alternate_angles: body.alternate_angles || null,
    line_movement:    body.line_movement    || null,
    unit_sizing:      body.unit_sizing      || null,
    win_probability:  body.win_probability  || null,
    generated_at:     new Date().toISOString(),
    updated_at:       new Date().toISOString(),
  };

  // ── Upsert ────────────────────────────────────────────────────────────────
  let supabase;
  try {
    supabase = supabaseAdmin();
  } catch (e) {
    return bad(`Server config error: ${e.message}`, 503);
  }

  const { data, error } = await supabase
    .from('game_analyses')
    .upsert([row], {
      onConflict: 'sport,game_date,home_team,away_team',
      ignoreDuplicates: false,
    })
    .select('id, sport, game_date, home_team, away_team, generated_at')
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Database upsert failed', detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, row: data });
}

// Reject anything that isn't POST so accidental browser hits return a clear 405
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed. Use POST with a JSON body.' },
    { status: 405 }
  );
}
