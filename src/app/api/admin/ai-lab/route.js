/**
 * /api/admin/ai-lab
 *
 * GET — fetch AI analysis performance data for the AI Lab dashboard.
 *
 * Query params:
 *   ?view=overview     — overall stats, win rate by confidence, by sport, by model, by prompt version
 *   ?view=logs         — paginated audit logs with full detail
 *   ?view=run&runId=X  — all analyses from a single cron run
 *   ?from=YYYY-MM-DD   — filter start date (default: 30 days ago)
 *   ?to=YYYY-MM-DD     — filter end date (default: today)
 *   ?sport=nba         — filter by sport
 *   ?page=1&limit=50   — pagination for logs view
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 15;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isAdmin(email) { return ADMIN_EMAILS.includes((email || '').toLowerCase()); }

async function getAdminUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    if (!isAdmin(user.email)) return null;
    return user;
  } catch { return null; }
}

export async function GET(req) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const view  = searchParams.get('view') || 'overview';
  const from  = searchParams.get('from') || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const to    = searchParams.get('to') || new Date().toISOString().split('T')[0];
  const sport = searchParams.get('sport') || null;
  const page  = parseInt(searchParams.get('page') || '1');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

  try {
    if (view === 'overview') {
      return await getOverview(from, to, sport);
    } else if (view === 'logs') {
      return await getLogs(from, to, sport, page, limit);
    } else if (view === 'run') {
      const runId = searchParams.get('runId');
      return await getRunDetail(runId);
    } else {
      return NextResponse.json({ error: 'Invalid view' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Overview: aggregate performance stats ─────────────────────────────────────
async function getOverview(from, to, sport) {
  let query = supabase
    .from('game_analyses')
    .select('id, sport, game_date, prediction_pick, prediction_conf, prediction_result, model, provider, was_fallback, prompt_version, latency_ms, tokens_in, tokens_out, final_score')
    .gte('game_date', from)
    .lte('game_date', to);

  if (sport) query = query.eq('sport', sport);

  const { data: all, error } = await query.order('game_date', { ascending: false }).limit(2000);
  if (error) throw error;

  const graded = (all || []).filter(r => r.prediction_result);
  const total  = all?.length || 0;

  // Overall record
  const wins   = graded.filter(r => r.prediction_result === 'WIN').length;
  const losses = graded.filter(r => r.prediction_result === 'LOSS').length;
  const pushes = graded.filter(r => r.prediction_result === 'PUSH').length;
  const settled = wins + losses;
  const winPct = settled > 0 ? Math.round((wins / settled) * 1000) / 10 : null;

  // By confidence
  const byConf = {};
  for (const r of graded) {
    const c = r.prediction_conf || 'UNKNOWN';
    if (!byConf[c]) byConf[c] = { wins: 0, losses: 0, pushes: 0, total: 0 };
    byConf[c].total++;
    if (r.prediction_result === 'WIN')  byConf[c].wins++;
    if (r.prediction_result === 'LOSS') byConf[c].losses++;
    if (r.prediction_result === 'PUSH') byConf[c].pushes++;
  }

  // By sport
  const bySport = {};
  for (const r of graded) {
    const s = (r.sport || 'unknown').toUpperCase();
    if (!bySport[s]) bySport[s] = { wins: 0, losses: 0, pushes: 0, total: 0 };
    bySport[s].total++;
    if (r.prediction_result === 'WIN')  bySport[s].wins++;
    if (r.prediction_result === 'LOSS') bySport[s].losses++;
    if (r.prediction_result === 'PUSH') bySport[s].pushes++;
  }

  // By model/provider
  const byModel = {};
  for (const r of graded) {
    const m = r.provider || r.model || 'unknown';
    if (!byModel[m]) byModel[m] = { wins: 0, losses: 0, pushes: 0, total: 0 };
    byModel[m].total++;
    if (r.prediction_result === 'WIN')  byModel[m].wins++;
    if (r.prediction_result === 'LOSS') byModel[m].losses++;
    if (r.prediction_result === 'PUSH') byModel[m].pushes++;
  }

  // By prompt version
  const byPrompt = {};
  for (const r of graded) {
    const v = r.prompt_version || 'pre-versioning';
    if (!byPrompt[v]) byPrompt[v] = { wins: 0, losses: 0, pushes: 0, total: 0 };
    byPrompt[v].total++;
    if (r.prediction_result === 'WIN')  byPrompt[v].wins++;
    if (r.prediction_result === 'LOSS') byPrompt[v].losses++;
    if (r.prediction_result === 'PUSH') byPrompt[v].pushes++;
  }

  // By date (for trend chart)
  const byDate = {};
  for (const r of graded) {
    const d = r.game_date;
    if (!byDate[d]) byDate[d] = { date: d, wins: 0, losses: 0, pushes: 0, total: 0 };
    byDate[d].total++;
    if (r.prediction_result === 'WIN')  byDate[d].wins++;
    if (r.prediction_result === 'LOSS') byDate[d].losses++;
    if (r.prediction_result === 'PUSH') byDate[d].pushes++;
  }

  // Average latency and token usage
  const withLatency = (all || []).filter(r => r.latency_ms);
  const avgLatency = withLatency.length > 0
    ? Math.round(withLatency.reduce((s, r) => s + r.latency_ms, 0) / withLatency.length)
    : null;
  const withTokens = (all || []).filter(r => r.tokens_in || r.tokens_out);
  const avgTokensIn = withTokens.length > 0
    ? Math.round(withTokens.reduce((s, r) => s + (r.tokens_in || 0), 0) / withTokens.length)
    : null;
  const avgTokensOut = withTokens.length > 0
    ? Math.round(withTokens.reduce((s, r) => s + (r.tokens_out || 0), 0) / withTokens.length)
    : null;

  return NextResponse.json({
    total,
    graded: graded.length,
    ungraded: total - graded.length,
    record: { wins, losses, pushes, settled, winPct },
    byConf,
    bySport,
    byModel,
    byPrompt,
    byDate: Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)),
    performance: { avgLatency, avgTokensIn, avgTokensOut },
  });
}

// ── Logs: paginated audit trail ───────────────────────────────────────────────
async function getLogs(from, to, sport, page, limit) {
  const offset = (page - 1) * limit;

  let query = supabase
    .from('analysis_audit_logs')
    .select('*', { count: 'exact' })
    .gte('game_date', from)
    .lte('game_date', to)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (sport) query = query.eq('sport', sport);

  const { data, count, error } = await query;
  if (error) throw error;

  return NextResponse.json({
    logs: data || [],
    total: count || 0,
    page,
    limit,
    totalPages: Math.ceil((count || 0) / limit),
  });
}

// ── Run detail: all analyses from a single cron run ───────────────────────────
async function getRunDetail(runId) {
  if (!runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });

  const { data, error } = await supabase
    .from('analysis_audit_logs')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const logs = data || [];
  const wins   = logs.filter(r => r.prediction_result === 'WIN').length;
  const losses = logs.filter(r => r.prediction_result === 'LOSS').length;
  const pushes = logs.filter(r => r.prediction_result === 'PUSH').length;

  return NextResponse.json({
    runId,
    total: logs.length,
    graded: wins + losses + pushes,
    record: { wins, losses, pushes },
    logs,
  });
}
