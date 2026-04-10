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
  process.env.SUPABASE_SERVICE_ROLE_KEY
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

  const pickType = searchParams.get('pickType') || null;

  try {
    if (view === 'overview') {
      return await getOverview(from, to, sport);
    } else if (view === 'logs') {
      return await getLogs(from, to, sport, page, limit);
    } else if (view === 'run') {
      const runId = searchParams.get('runId');
      return await getRunDetail(runId);
    } else if (view === 'analytics') {
      return await getAnalytics(from, to, sport, pickType);
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

// ── Parse prediction_pick text → { bet_type, odds } ──────────────────────────
function parsePredictionPickServer(text) {
  if (!text) return { bet_type: 'Unknown', odds: null };
  const t = text.trim();
  // Over/Under totals: "Over 217.5 -110", "Under 8.5 +100"
  const ouMatch = t.match(/^(Over|Under)\s+[\d.]+\s+([+-]\d+)/i);
  if (ouMatch) return { bet_type: 'Total', odds: parseInt(ouMatch[2]) };
  // Spread: ends with a signed number line then odds, e.g. "Chiefs -3.5 -115"
  const spreadMatch = t.match(/[+-][\d.]+\s+([+-]\d{3,4})$/);
  if (spreadMatch) return { bet_type: 'Spread', odds: parseInt(spreadMatch[1]) };
  // ML: "Lakers ML -150" or just ends with odds after team name
  const mlMatch = t.match(/ML\s+([+-]\d+)/i) || t.match(/\s([+-]\d{3,4})$/);
  if (mlMatch) return { bet_type: 'Moneyline', odds: parseInt(mlMatch[1]) };
  return { bet_type: 'Unknown', odds: null };
}

// ── Analytics: game_analyses-based ROI dashboard ──────────────────────────────
async function getAnalytics(from, to, sport, pickType) {
  let query = supabase
    .from('game_analyses')
    .select('id, sport, game_date, prediction_pick, prediction_conf, prediction_result, model')
    .in('prediction_result', ['WIN', 'LOSS', 'PUSH'])
    .order('game_date', { ascending: true })
    .limit(5000);

  if (from) query = query.gte('game_date', from);
  if (to)   query = query.lte('game_date', to);
  if (sport) query = query.eq('sport', sport);

  const { data: rawPicks, error } = await query;
  if (error) throw error;

  // Enrich each row with parsed odds, bet_type, and theoretical profit
  const picks = (rawPicks || []).map(p => {
    const { bet_type, odds } = parsePredictionPickServer(p.prediction_pick);
    let profit = 0;
    if (p.prediction_result === 'WIN') {
      profit = odds != null ? (odds > 0 ? odds / 100 : 100 / Math.abs(odds)) : 1;
    } else if (p.prediction_result === 'LOSS') {
      profit = -1;
    }
    return { ...p, bet_type, odds, profit };
  });

  // Filter by pick type if requested
  const filtered = pickType
    ? picks.filter(p => p.bet_type === pickType)
    : picks;

  const wins   = filtered.filter(p => p.prediction_result === 'WIN');
  const losses = filtered.filter(p => p.prediction_result === 'LOSS');
  const pushes = filtered.filter(p => p.prediction_result === 'PUSH');
  const settled = wins.length + losses.length;

  const totalProfit = filtered.reduce((s, p) => s + p.profit, 0);
  const roi     = filtered.length > 0 ? (totalProfit / filtered.length) * 100 : 0;
  const winRate = settled > 0 ? (wins.length / settled) * 100 : 0;

  // Average odds via decimal conversion
  const avgOdds = (arr) => {
    const valid = arr.map(p => p.odds).filter(o => o != null && !isNaN(o) && o !== 0);
    if (!valid.length) return null;
    const avgDec = valid.reduce((s, o) => s + (o > 0 ? o / 100 + 1 : 100 / Math.abs(o) + 1), 0) / valid.length;
    return avgDec >= 2
      ? Math.round((avgDec - 1) * 100)
      : Math.round(-100 / (avgDec - 1));
  };
  const avgWinOdds  = avgOdds(wins);
  const avgLossOdds = avgOdds(losses);

  // ROI over time (cumulative units by date)
  const dateMap = {};
  for (const p of filtered) {
    const d = p.game_date;
    if (!d) continue;
    if (!dateMap[d]) dateMap[d] = { date: d, picks: 0, wins: 0, losses: 0, pushes: 0, dailyProfit: 0 };
    dateMap[d].picks++;
    if (p.prediction_result === 'WIN')  dateMap[d].wins++;
    if (p.prediction_result === 'LOSS') dateMap[d].losses++;
    if (p.prediction_result === 'PUSH') dateMap[d].pushes++;
    dateMap[d].dailyProfit += p.profit;
  }
  let running = 0;
  const roiByDate = Object.values(dateMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => {
      running += d.dailyProfit;
      return {
        date: d.date,
        picks: d.picks,
        wins: d.wins,
        losses: d.losses,
        dailyProfit: parseFloat(d.dailyProfit.toFixed(2)),
        cumulative: parseFloat(running.toFixed(2)),
      };
    });

  // By sport
  const sportMap = {};
  for (const p of filtered) {
    const s = (p.sport || 'unknown').toUpperCase();
    if (!sportMap[s]) sportMap[s] = { sport: s, picks: 0, wins: 0, losses: 0, pushes: 0, profit: 0 };
    sportMap[s].picks++;
    if (p.prediction_result === 'WIN')  sportMap[s].wins++;
    if (p.prediction_result === 'LOSS') sportMap[s].losses++;
    if (p.prediction_result === 'PUSH') sportMap[s].pushes++;
    sportMap[s].profit += p.profit;
  }
  const bySport = Object.values(sportMap).map(s => ({
    ...s,
    roi:     s.picks > 0             ? parseFloat(((s.profit / s.picks) * 100).toFixed(1)) : 0,
    winRate: (s.wins + s.losses) > 0 ? parseFloat(((s.wins / (s.wins + s.losses)) * 100).toFixed(1)) : 0,
    profit:  parseFloat(s.profit.toFixed(2)),
  })).sort((a, b) => b.picks - a.picks);

  // By pick type (derived from prediction_pick text)
  const typeMap = {};
  for (const p of filtered) {
    const t = p.bet_type || 'Unknown';
    if (!typeMap[t]) typeMap[t] = { type: t, picks: 0, wins: 0, losses: 0, pushes: 0, profit: 0 };
    typeMap[t].picks++;
    if (p.prediction_result === 'WIN')  typeMap[t].wins++;
    if (p.prediction_result === 'LOSS') typeMap[t].losses++;
    if (p.prediction_result === 'PUSH') typeMap[t].pushes++;
    typeMap[t].profit += p.profit;
  }
  const byPickType = Object.values(typeMap).map(t => ({
    ...t,
    roi:     t.picks > 0             ? parseFloat(((t.profit / t.picks) * 100).toFixed(1)) : 0,
    winRate: (t.wins + t.losses) > 0 ? parseFloat(((t.wins / (t.wins + t.losses)) * 100).toFixed(1)) : 0,
    profit:  parseFloat(t.profit.toFixed(2)),
  })).sort((a, b) => b.picks - a.picks);

  // Streaks (settled picks only, chronological)
  const resultSeq = filtered
    .filter(p => p.prediction_result === 'WIN' || p.prediction_result === 'LOSS')
    .map(p => p.prediction_result);
  let longestWin = 0, longestLoss = 0, tW = 0, tL = 0;
  for (const r of resultSeq) {
    if (r === 'WIN') { tW++; tL = 0; longestWin = Math.max(longestWin, tW); }
    else             { tL++; tW = 0; longestLoss = Math.max(longestLoss, tL); }
  }
  let currentStreak = 0, currentType = null;
  if (resultSeq.length > 0) {
    currentType = resultSeq[resultSeq.length - 1];
    for (let i = resultSeq.length - 1; i >= 0; i--) {
      if (resultSeq[i] === currentType) currentStreak++;
      else break;
    }
  }

  // Odds calibration
  const oddsRanges = [
    { label: '≤ -300',      min: -9999, max: -300 },
    { label: '-299 to -150', min: -299,  max: -150 },
    { label: '-149 to -110', min: -149,  max: -110 },
    { label: '-109 to +109', min: -109,  max:  109 },
    { label: '+110 to +200', min:  110,  max:  200 },
    { label: '+201 to +400', min:  201,  max:  400 },
    { label: '≥ +401',       min:  401,  max: 9999 },
  ];
  const calibration = oddsRanges.map(({ label, min, max }) => {
    const inRange = filtered.filter(p => {
      const o = p.odds;
      return o != null && !isNaN(o) && o >= min && o <= max &&
        (p.prediction_result === 'WIN' || p.prediction_result === 'LOSS');
    });
    if (!inRange.length) return null;
    const w = inRange.filter(p => p.prediction_result === 'WIN').length;
    const impliedArr = inRange.map(p => {
      const o = p.odds;
      return o < 0 ? Math.abs(o) / (Math.abs(o) + 100) * 100 : 100 / (o + 100) * 100;
    });
    const avgImplied = impliedArr.reduce((s, v) => s + v, 0) / impliedArr.length;
    const actualWinRate = (w / inRange.length) * 100;
    return {
      label,
      picks: inRange.length,
      wins: w,
      losses: inRange.length - w,
      actualWinRate: parseFloat(actualWinRate.toFixed(1)),
      impliedWinRate: parseFloat(avgImplied.toFixed(1)),
      edge: parseFloat((actualWinRate - avgImplied).toFixed(1)),
    };
  }).filter(Boolean);

  // Kelly criterion recommendation (quarter-Kelly = conservative)
  let kellyPct = null, quarterKellyPct = null;
  if (winRate > 0 && avgWinOdds !== null && settled >= 20) {
    const avgNetOdds = avgWinOdds > 0 ? avgWinOdds / 100 : 100 / Math.abs(avgWinOdds);
    const b = avgNetOdds;
    const p_win = winRate / 100;
    const kelly = (b * p_win - (1 - p_win)) / b;
    kellyPct = parseFloat((kelly * 100).toFixed(1));
    quarterKellyPct = parseFloat((kelly * 25).toFixed(1));
  }

  return NextResponse.json({
    summary: {
      totalPicks: filtered.length,
      wins: wins.length,
      losses: losses.length,
      pushes: pushes.length,
      settled,
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      roi: parseFloat(roi.toFixed(1)),
      winRate: parseFloat(winRate.toFixed(1)),
      avgWinOdds,
      avgLossOdds,
      kellyPct,
      quarterKellyPct,
    },
    roiByDate,
    bySport,
    byPickType,
    streaks: { current: currentStreak, currentType, longestWin, longestLoss },
    calibration,
  });
}
