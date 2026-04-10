'use client';
import React, { useState, useEffect, useCallback } from 'react';

// ── Auth helper ──────────────────────────────────────────────────────────────
async function getAuthToken() {
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch { return null; }
}
async function adminFetch(url, opts = {}) {
  const token = await getAuthToken();
  const headers = { ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return fetch(url, { ...opts, headers });
}

// ── Formatters & color helpers ───────────────────────────────────────────────
const GOLD = '#D4A843';
function pct(w, l) { const s = w + l; return s > 0 ? Math.round((w / s) * 1000) / 10 : 0; }
function fmtU(v) { if (v == null) return '—'; return `${v > 0 ? '+' : ''}${v.toFixed(2)}u`; }
function fmtOdds(v) { if (!v) return '—'; return v > 0 ? `+${v}` : `${v}`; }
function winC(wp) { return wp >= 55 ? '#4ade80' : wp >= 50 ? '#facc15' : '#f87171'; }
function profC(v) { return v > 0 ? '#4ade80' : v < 0 ? '#f87171' : '#94a3b8'; }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function offsetDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]; }

// ── Shared UI atoms ──────────────────────────────────────────────────────────
function WinBadge({ result }) {
  const m = {
    WIN:  ['rgba(74,222,128,0.12)', 'rgba(74,222,128,0.35)', '#4ade80'],
    LOSS: ['rgba(248,113,113,0.12)', 'rgba(248,113,113,0.35)', '#f87171'],
    PUSH: ['rgba(250,204,21,0.12)', 'rgba(250,204,21,0.35)', '#facc15'],
  }[result] || ['rgba(148,163,184,0.1)', 'rgba(148,163,184,0.3)', '#94a3b8'];
  return <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: m[0], border: `1px solid ${m[1]}`, color: m[2] }}>{result || 'PENDING'}</span>;
}

function ConfBadge({ conf }) {
  const c = { ELITE: '#a855f7', HIGH: '#4ade80', MEDIUM: '#facc15', LOW: '#94a3b8' }[conf] || '#94a3b8';
  return <span style={{ fontSize: '0.58rem', fontWeight: 700, padding: '1px 5px', borderRadius: '3px', color: c, background: `${c}18`, border: `1px solid ${c}44` }}>{conf || '?'}</span>;
}

function MiniBar({ wins, losses, pushes }) {
  const total = wins + losses + pushes;
  if (!total) return null;
  return (
    <div style={{ display: 'flex', height: '5px', borderRadius: '3px', overflow: 'hidden', width: '100%', background: 'var(--bg-primary)' }}>
      {wins > 0   && <div style={{ width: `${(wins/total)*100}%`,   background: '#4ade80' }} />}
      {pushes > 0 && <div style={{ width: `${(pushes/total)*100}%`, background: '#facc15' }} />}
      {losses > 0 && <div style={{ width: `${(losses/total)*100}%`, background: '#f87171' }} />}
    </div>
  );
}

function Panel({ title, children, style = {} }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem', ...style }}>
      {title && <div style={{ fontSize: '0.61rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '0.7rem' }}>{title}</div>}
      {children}
    </div>
  );
}

function KPICard({ label, value, sub, color = 'var(--text-primary)', icon }) {
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
      <div style={{ fontSize: '0.59rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>
        {icon && <span style={{ marginRight: '4px' }}>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace', color, lineHeight: 1.2 }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '2px' }}>{sub}</div>}
    </div>
  );
}

// ── SVG Line Chart ────────────────────────────────────────────────────────────
function LineChart({ data, xKey = 'date', yKey = 'cumulative', height = 170 }) {
  if (!data || data.length < 2) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem', fontSize: '0.75rem' }}>Not enough data</div>
  );
  const W = 800, H = height, P = { t: 10, r: 20, b: 26, l: 50 };
  const iW = W - P.l - P.r, iH = H - P.t - P.b;
  const ys = data.map(d => d[yKey]);
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys), yR = yMax - yMin || 1;
  const toX = i => P.l + (i / (data.length - 1)) * iW;
  const toY = v => P.t + ((yMax - v) / yR) * iH;
  const zY = toY(0);
  const pts = data.map((d, i) => `${toX(i).toFixed(1)},${toY(d[yKey]).toFixed(1)}`).join(' ');
  const areaD = `M${toX(0).toFixed(1)},${zY} L${pts.split(' ').join(' L')} L${toX(data.length - 1).toFixed(1)},${zY} Z`;
  const fin = data[data.length - 1][yKey];
  const lc = fin >= 0 ? GOLD : '#f87171';
  const yTicks = [...new Set([yMax, (yMax + yMin) / 2, 0, yMin])].map(v => ({ v, y: toY(v) }));
  const xIdxs = [0, Math.floor(data.length * 0.25), Math.floor(data.length * 0.5), Math.floor(data.length * 0.75), data.length - 1].filter((v, i, a) => a.indexOf(v) === i && v < data.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: `${height}px` }}>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={P.l} x2={W - P.r} y1={t.y} y2={t.y} stroke={t.v === 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.04)'} strokeWidth="1" strokeDasharray={t.v === 0 ? '4,4' : ''} />
          <text x={P.l - 6} y={t.y + 4} textAnchor="end" fontSize="9" fill="rgba(255,255,255,0.3)" fontFamily="monospace">{t.v > 0 ? '+' : ''}{t.v.toFixed(1)}</text>
        </g>
      ))}
      <path d={areaD} fill={lc} opacity="0.09" />
      <polyline points={pts} fill="none" stroke={lc} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {xIdxs.map(i => <text key={i} x={toX(i)} y={H - 3} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.28)" fontFamily="monospace">{String(data[i]?.[xKey] || '').slice(5)}</text>)}
    </svg>
  );
}

// ── Horizontal bar chart ──────────────────────────────────────────────────────
function HBars({ items, nameKey, valueKey, winRateKey, suffix = 'u', max = 8 }) {
  const rows = items.slice(0, max);
  const maxAbs = Math.max(...rows.map(d => Math.abs(d[valueKey])), 0.01);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {rows.map((item, i) => {
        const val = item[valueKey];
        const w = Math.min(Math.abs(val) / maxAbs * 100, 100);
        const c = profC(val);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ fontSize: '0.61rem', fontWeight: 700, width: '50px', color: 'var(--text-muted)', textTransform: 'uppercase', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item[nameKey]}</span>
            <div style={{ flex: 1, height: '13px', background: 'var(--bg-primary)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${w}%`, height: '100%', background: c, opacity: 0.82, borderRadius: '3px' }} />
            </div>
            <span style={{ fontSize: '0.63rem', fontFamily: 'IBM Plex Mono, monospace', color: c, fontWeight: 700, width: '50px', textAlign: 'right', flexShrink: 0 }}>{val > 0 ? '+' : ''}{val.toFixed(1)}{suffix}</span>
            {winRateKey && <span style={{ fontSize: '0.61rem', color: winC(item[winRateKey]), fontWeight: 700, width: '36px', textAlign: 'right', flexShrink: 0 }}>{item[winRateKey]}%</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Calibration chart ─────────────────────────────────────────────────────────
function CalibrationTable({ data }) {
  if (!data?.length) return <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No calibration data</div>;
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 44px 44px 40px', gap: '4px', fontSize: '0.57rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', paddingBottom: '4px', borderBottom: '1px solid var(--border)' }}>
        <span>Odds</span><span>Win Rate</span><span style={{ textAlign: 'right' }}>Actual</span><span style={{ textAlign: 'right' }}>Implied</span><span style={{ textAlign: 'right' }}>Edge</span>
      </div>
      {data.map((r, i) => {
        const ec = r.edge > 2 ? '#4ade80' : r.edge < -2 ? '#f87171' : '#facc15';
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 44px 44px 40px', gap: '4px', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace' }}>{r.label}</span>
            <div style={{ position: 'relative', height: '11px', background: 'var(--bg-primary)', borderRadius: '2px' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, width: `${Math.min(r.impliedWinRate, 100)}%`, height: '100%', background: 'rgba(148,163,184,0.2)', borderRadius: '2px' }} />
              <div style={{ position: 'absolute', left: 0, top: 2, width: `${Math.min(r.actualWinRate, 100)}%`, height: '7px', background: ec, opacity: 0.75, borderRadius: '2px' }} />
            </div>
            <span style={{ fontSize: '0.63rem', fontFamily: 'IBM Plex Mono, monospace', color: ec, fontWeight: 700, textAlign: 'right' }}>{r.actualWinRate}%</span>
            <span style={{ fontSize: '0.63rem', fontFamily: 'IBM Plex Mono, monospace', color: 'rgba(148,163,184,0.6)', textAlign: 'right' }}>{r.impliedWinRate}%</span>
            <span style={{ fontSize: '0.63rem', fontFamily: 'IBM Plex Mono, monospace', color: ec, fontWeight: 700, textAlign: 'right' }}>{r.edge > 0 ? '+' : ''}{r.edge}%</span>
          </div>
        );
      })}
      <div style={{ fontSize: '0.59rem', color: 'var(--text-muted)', marginTop: '5px', fontStyle: 'italic' }}>Gray = implied · Color = actual · Edge = actual − implied</div>
    </div>
  );
}

// ── Streak view ───────────────────────────────────────────────────────────────
function StreakView({ streaks }) {
  if (!streaks) return null;
  const { current, currentType, longestWin, longestLoss } = streaks;
  const isW = currentType === 'WIN';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <div style={{ textAlign: 'center', padding: '0.7rem', background: 'var(--bg-primary)', borderRadius: '8px' }}>
        <div style={{ fontSize: '0.59rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px' }}>Current Streak</div>
        {current > 0 ? (
          <>
            <div style={{ fontSize: '2.4rem', fontWeight: 900, fontFamily: 'IBM Plex Mono, monospace', color: isW ? '#4ade80' : '#f87171', lineHeight: 1 }}>{current}</div>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: isW ? '#4ade80' : '#f87171', marginTop: '3px' }}>{isW ? '🔥 WIN STREAK' : '❄️ LOSS STREAK'}</div>
          </>
        ) : <div style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>No picks yet</div>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
        {[['Longest Win Streak', longestWin, '#4ade80'], ['Longest Loss Streak', longestLoss, '#f87171']].map(([label, val, c]) => (
          <div key={label} style={{ background: `${c}0d`, border: `1px solid ${c}2a`, borderRadius: '8px', padding: '0.6rem', textAlign: 'center' }}>
            <div style={{ fontSize: '0.57rem', color: `${c}99`, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{label}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, fontFamily: 'IBM Plex Mono, monospace', color: c }}>{val}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Presets ───────────────────────────────────────────────────────────────────
const PRESETS = [
  { id: '7d',  label: '7D',   from: () => offsetDate(-7) },
  { id: '30d', label: '30D',  from: () => offsetDate(-30) },
  { id: '90d', label: '90D',  from: () => offsetDate(-90) },
  { id: 'ytd', label: 'YTD',  from: () => `${new Date().getFullYear()}-01-01` },
  { id: 'all', label: 'All',  from: () => '2023-01-01' },
  { id: 'custom', label: 'Custom', from: null },
];

// ── Main AI Lab Panel ─────────────────────────────────────────────────────────
export default function AILabPanel({ userEmail }) {
  const [tab, setTab] = useState('analytics');

  // Filter state
  const [preset, setPreset]             = useState('30d');
  const [customFrom, setCustomFrom]     = useState(() => offsetDate(-30));
  const [customTo, setCustomTo]         = useState(() => todayStr());
  const [sportFilter, setSportFilter]   = useState('');
  const [typeFilter, setTypeFilter]     = useState('');

  // Data
  const [analyticsData, setAnalyticsData] = useState(null);
  const [overviewData, setOverviewData]   = useState(null);
  const [logsData, setLogsData]           = useState(null);
  const [reportsData, setReportsData]     = useState(null);

  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [logPage, setLogPage]       = useState(1);
  const [expandedLog, setExpandedLog] = useState(null);

  // Reports tab state
  const [reportDate, setReportDate]     = useState(() => todayStr());
  const [expandedAnalysis, setExpandedAnalysis] = useState(null);
  const [pregenState, setPregenState]   = useState({ today: null, tomorrow: null });

  // Derived date range
  const { from, to } = (() => {
    if (preset === 'custom') return { from: customFrom, to: customTo };
    const p = PRESETS.find(x => x.id === preset);
    return { from: p?.from?.() || offsetDate(-30), to: todayStr() };
  })();

  const baseUrl = (view, extra = '') =>
    `/api/admin/ai-lab?view=${view}&from=${from}&to=${to}${sportFilter ? `&sport=${sportFilter}` : ''}${extra}`;

  const load = useCallback(async (fn) => {
    setLoading(true); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  const loadAnalytics = useCallback(() => load(async () => {
    const url = baseUrl('analytics') + (typeFilter ? `&pickType=${encodeURIComponent(typeFilter)}` : '');
    const d = await adminFetch(url).then(r => r.json());
    if (d.error) throw new Error(d.error);
    setAnalyticsData(d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [from, to, sportFilter, typeFilter, load]);

  const loadOverview = useCallback(() => load(async () => {
    const d = await adminFetch(baseUrl('overview')).then(r => r.json());
    if (d.error) throw new Error(d.error);
    setOverviewData(d);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [from, to, sportFilter, load]);

  const loadLogs = useCallback((page = 1) => load(async () => {
    const d = await adminFetch(baseUrl('logs', `&page=${page}&limit=30`)).then(r => r.json());
    if (d.error) throw new Error(d.error);
    setLogsData(d); setLogPage(page);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [from, to, sportFilter, load]);

  const loadReports = useCallback((date = reportDate) => load(async () => {
    const d = await adminFetch(`/api/admin?action=game_analyses&date=${date}`).then(r => r.json());
    if (d.error) throw new Error(d.error);
    setReportsData(d);
  }), [reportDate, load]);

  useEffect(() => {
    setAnalyticsData(null); setOverviewData(null); setLogsData(null);
    if (tab === 'analytics') loadAnalytics();
    else if (tab === 'overview') loadOverview();
    else if (tab === 'logs') loadLogs(1);
    else if (tab === 'reports') loadReports(reportDate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to, sportFilter, typeFilter]);

  const triggerPregenerate = useCallback(async (which) => {
    const date = which === 'tomorrow' ? offsetDate(1) : todayStr();
    setPregenState(p => ({ ...p, [which]: { loading: true, result: null } }));
    try {
      const jobPath = `/api/cron/pregenerate-analysis${which === 'tomorrow' ? `?gameDate=${date}` : ''}`;
      const res = await adminFetch('/api/admin', {
        method: 'POST',
        body: JSON.stringify({ action: 'cron_run', jobPath }),
      });
      const data = await res.json();
      setPregenState(p => ({ ...p, [which]: { loading: false, result: data } }));
      // Refresh reports after triggering
      setTimeout(() => loadReports(which === 'tomorrow' ? date : todayStr()), 2000);
    } catch (e) {
      setPregenState(p => ({ ...p, [which]: { loading: false, result: { ok: false, error: e.message } } }));
    }
  }, [loadReports]);

  const btnStyle = (active, accent = '#a855f7') => ({
    padding: '0.32rem 0.65rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.71rem',
    border: `1px solid ${active ? `${accent}88` : 'var(--border)'}`,
    background: active ? `${accent}14` : 'transparent',
    color: active ? accent : 'var(--text-muted)',
    fontWeight: active ? 700 : 400, fontFamily: 'inherit',
  });

  const TABS = [
    { id: 'analytics', label: '📈 ROI Analytics' },
    { id: 'overview',  label: '🤖 AI Performance' },
    { id: 'reports',   label: '📋 Analysis Reports' },
    { id: 'logs',      label: '🔍 Audit Logs' },
  ];

  const showFilters = tab !== 'reports';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Tab nav */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={btnStyle(tab === t.id)}>
            {t.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: '0.61rem', color: 'var(--text-muted)' }}>
          {loading && '⟳ Loading…'}
        </div>
      </div>

      {/* Filter bar (analytics / overview / logs) */}
      {showFilters && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', padding: '0.55rem 0.8rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px' }}>
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => { setPreset(p.id); }} style={{ ...btnStyle(preset === p.id, GOLD), padding: '0.22rem 0.5rem', fontSize: '0.67rem' }}>
              {p.label}
            </button>
          ))}
          {preset === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: '5px', padding: '2px 6px', fontSize: '0.67rem' }} />
              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>→</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: '5px', padding: '2px 6px', fontSize: '0.67rem' }} />
            </>
          )}
          <div style={{ width: '1px', height: '18px', background: 'var(--border)', margin: '0 2px' }} />
          <select value={sportFilter} onChange={e => setSportFilter(e.target.value)} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: '5px', padding: '2px 6px', fontSize: '0.67rem' }}>
            <option value="">All Sports</option>
            {['mlb','nba','nhl','nfl','mls','wnba','ncaaf','ncaab'].map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          {tab === 'analytics' && (
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: '5px', padding: '2px 6px', fontSize: '0.67rem' }}>
              <option value="">All Types</option>
              {['Moneyline','Spread','Total','Parlay'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: 'var(--text-muted)' }}>{from} → {to}</span>
        </div>
      )}

      {/* Error */}
      {error && <div style={{ color: '#f87171', padding: '0.55rem', background: 'rgba(248,113,113,0.05)', borderRadius: '6px', fontSize: '0.76rem', border: '1px solid rgba(248,113,113,0.2)' }}>⚠ {error}</div>}

      {/* Content */}
      {tab === 'analytics' && (analyticsData ? <AnalyticsView data={analyticsData} /> : !loading && <Empty msg="No pick data for this period." />)}
      {tab === 'overview'  && (overviewData  ? <OverviewView  data={overviewData}  /> : !loading && <Empty msg="No AI analysis data for this period." />)}
      {tab === 'reports'   && <ReportsView reportDate={reportDate} setReportDate={(d) => { setReportDate(d); loadReports(d); }} data={reportsData} expandedAnalysis={expandedAnalysis} setExpandedAnalysis={setExpandedAnalysis} pregen={pregenState} onPregen={triggerPregenerate} onRefresh={() => loadReports(reportDate)} loading={loading} />}
      {tab === 'logs'      && (logsData      ? <LogsView      data={logsData} page={logPage} onPageChange={loadLogs} expanded={expandedLog} onToggle={id => setExpandedLog(expandedLog === id ? null : id)} /> : !loading && <Empty msg="No audit logs found." />)}
      {loading && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', fontSize: '0.76rem' }}>Loading…</div>}
    </div>
  );
}

function Empty({ msg }) {
  return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2.5rem', fontSize: '0.76rem', border: '1px dashed var(--border)', borderRadius: '10px' }}>{msg}</div>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS VIEW (picks-based ROI)
// ═══════════════════════════════════════════════════════════════════════════════
function AnalyticsView({ data }) {
  const { summary: s, roiByDate, bySport, byPickType, streaks, calibration } = data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(138px, 1fr))', gap: '8px' }}>
        <KPICard label="Total P&L" icon="💰" value={s.totalProfit != null ? fmtU(s.totalProfit) : '—'} color={profC(s.totalProfit)} sub={`${s.totalPicks} picks graded`} />
        <KPICard label="ROI %" icon="📊" value={s.roi != null ? `${s.roi > 0 ? '+' : ''}${s.roi}%` : '—'} color={profC(s.roi)} sub={`${s.wins}W / ${s.losses}L / ${s.pushes}P`} />
        <KPICard label="Win Rate" icon="🎯" value={s.winRate != null ? `${s.winRate}%` : '—'} color={winC(s.winRate)} sub={`${s.settled} settled`} />
        <KPICard label="Avg Win Odds" icon="📈" value={fmtOdds(s.avgWinOdds)} color={GOLD} sub="on wins" />
        <KPICard label="Avg Loss Odds" icon="📉" value={fmtOdds(s.avgLossOdds)} color="#f87171" sub="on losses" />
        <KPICard label="¼ Kelly" icon="🧮"
          value={s.quarterKellyPct != null ? `${Math.max(0, s.quarterKellyPct)}%` : '—'}
          color={s.quarterKellyPct > 0 ? '#4ade80' : '#f87171'}
          sub={s.kellyPct != null ? `Full: ${Math.max(0, s.kellyPct)}%` : 'Need ≥20 settled'} />
      </div>

      {/* ROI over time */}
      <Panel title="Cumulative Units P&L Over Time">
        <LineChart data={roiByDate} xKey="date" yKey="cumulative" height={175} />
        {roiByDate?.length > 1 && (
          <div style={{ display: 'flex', gap: '1.5rem', marginTop: '5px', fontSize: '0.63rem', color: 'var(--text-muted)' }}>
            <span>{roiByDate.length} days</span>
            <span>Peak: {fmtU(Math.max(...roiByDate.map(d => d.cumulative)))}</span>
            <span>Trough: {fmtU(Math.min(...roiByDate.map(d => d.cumulative)))}</span>
          </div>
        )}
      </Panel>

      {/* By sport + by type */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '0.8rem' }}>
        <Panel title="P&L by Sport">
          {bySport?.length > 0 ? (
            <>
              <HBars items={bySport} nameKey="sport" valueKey="profit" winRateKey="winRate" />
              <div style={{ marginTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {bySport.slice(0, 8).map(s => (
                  <div key={s.sport} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.63rem', color: 'var(--text-muted)', padding: '1px 0' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{s.sport}</span>
                    <span>{s.wins}W-{s.losses}L</span>
                    <span style={{ color: profC(s.profit), fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}>{fmtU(s.profit)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty msg="No sport data" />}
        </Panel>

        <Panel title="P&L by Pick Type">
          {byPickType?.length > 0 ? (
            <>
              <HBars items={byPickType} nameKey="type" valueKey="profit" winRateKey="winRate" />
              <div style={{ marginTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {byPickType.slice(0, 6).map(t => (
                  <div key={t.type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.63rem', color: 'var(--text-muted)', padding: '1px 0' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{t.type}</span>
                    <span>{t.wins}W-{t.losses}L ({t.winRate}%)</span>
                    <span style={{ color: profC(t.profit), fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}>{fmtU(t.profit)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <Empty msg="No pick type data" />}
        </Panel>
      </div>

      {/* Streaks + Calibration */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '0.8rem' }}>
        <Panel title="Streak Tracker"><StreakView streaks={streaks} /></Panel>
        <Panel title="Odds Calibration — Edge Analysis"><CalibrationTable data={calibration} /></Panel>
      </div>

      {/* Recent daily table */}
      {roiByDate?.length > 0 && (
        <Panel title="Recent Daily Performance">
          <div style={{ display: 'grid', gridTemplateColumns: '86px 38px 34px 34px 66px 76px', gap: '5px', fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', padding: '0 2px 4px', borderBottom: '1px solid var(--border)' }}>
            <span>Date</span><span style={{ textAlign: 'right' }}>Picks</span><span style={{ textAlign: 'right' }}>W</span><span style={{ textAlign: 'right' }}>L</span><span style={{ textAlign: 'right' }}>Daily</span><span style={{ textAlign: 'right' }}>Running</span>
          </div>
          {[...roiByDate].reverse().slice(0, 14).map(d => (
            <div key={d.date} style={{ display: 'grid', gridTemplateColumns: '86px 38px 34px 34px 66px 76px', gap: '5px', fontSize: '0.67rem', padding: '3px 2px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace' }}>{d.date}</span>
              <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{d.picks}</span>
              <span style={{ textAlign: 'right', color: '#4ade80' }}>{d.wins}</span>
              <span style={{ textAlign: 'right', color: '#f87171' }}>{d.losses}</span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: profC(d.dailyProfit) }}>{d.dailyProfit > 0 ? '+' : ''}{d.dailyProfit.toFixed(2)}</span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: profC(d.cumulative) }}>{d.cumulative > 0 ? '+' : ''}{d.cumulative.toFixed(2)}</span>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// OVERVIEW VIEW (game_analyses accuracy + model comparison)
// ═══════════════════════════════════════════════════════════════════════════════
function OverviewView({ data }) {
  const { record, byConf, bySport, byModel, byPrompt, byDate, performance, total, graded, ungraded } = data;

  // Build model comparison table from byModel
  const modelRows = Object.entries(byModel || {}).map(([model, d]) => ({
    model,
    wins: d.wins, losses: d.losses, pushes: d.pushes, total: d.total,
    winPct: pct(d.wins, d.losses),
  })).sort((a, b) => b.total - a.total);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      {/* Hero */}
      <Panel>
        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px' }}>AI Analyzer Overall Record (game_analyses)</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '1.9rem', fontWeight: 900, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)' }}>
            {record.wins}W – {record.losses}L
          </span>
          {record.pushes > 0 && <span style={{ fontSize: '1rem', color: '#facc15', fontWeight: 700 }}>{record.pushes}P</span>}
          {record.winPct !== null && <span style={{ fontSize: '1.25rem', fontWeight: 800, color: winC(record.winPct) }}>{record.winPct}%</span>}
        </div>
        <MiniBar wins={record.wins} losses={record.losses} pushes={record.pushes} />
        <div style={{ display: 'flex', gap: '1rem', marginTop: '7px', fontSize: '0.67rem', color: 'var(--text-muted)' }}>
          <span>{total} analyses</span><span>{graded} graded</span><span>{ungraded} pending</span>
        </div>
      </Panel>

      {/* Model comparison table */}
      {modelRows.length > 0 && (
        <Panel title="Model Comparison">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 60px 50px 50px', gap: '6px', fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', paddingBottom: '5px', borderBottom: '1px solid var(--border)' }}>
            <span>Model</span><span style={{ textAlign: 'right' }}>Record</span><span style={{ textAlign: 'right' }}>Win %</span><span style={{ textAlign: 'right' }}>Sample</span><span style={{ textAlign: 'right' }}>Graded</span>
          </div>
          {modelRows.map(m => (
            <div key={m.model} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 60px 50px 50px', gap: '6px', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.71rem' }}>
              <span style={{ color: '#60a5fa', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.model}</span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-secondary)', fontWeight: 600 }}>{m.wins}-{m.losses}</span>
              <span style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: winC(m.winPct) }}>{m.winPct}%</span>
              <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{m.total}</span>
              <span style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{m.wins + m.losses}</span>
            </div>
          ))}
        </Panel>
      )}

      {/* By Confidence + By Sport */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '0.75rem' }}>
        <Panel title="By Confidence Level">
          {['ELITE','HIGH','MEDIUM','LOW','UNKNOWN'].filter(c => byConf[c]).map(c => {
            const d = byConf[c]; const wp = pct(d.wins, d.losses);
            const cc = { ELITE: '#a855f7', HIGH: '#4ade80', MEDIUM: '#facc15', LOW: '#94a3b8' }[c] || '#94a3b8';
            return (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.61rem', fontWeight: 700, width: '58px', color: cc }}>{c}</span>
                <span style={{ fontSize: '0.73rem', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)', fontWeight: 600 }}>{d.wins}-{d.losses}{d.pushes > 0 ? `-${d.pushes}` : ''}</span>
                <span style={{ fontSize: '0.68rem', color: winC(wp), fontWeight: 700, marginLeft: 'auto' }}>{wp}%</span>
                <div style={{ width: '56px' }}><MiniBar wins={d.wins} losses={d.losses} pushes={d.pushes} /></div>
              </div>
            );
          })}
        </Panel>

        <Panel title="By Sport">
          {Object.entries(bySport || {}).sort((a, b) => b[1].total - a[1].total).map(([sport, d]) => {
            const wp = pct(d.wins, d.losses);
            return (
              <div key={sport} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.63rem', fontWeight: 700, width: '48px', color: 'var(--text-secondary)' }}>{sport}</span>
                <span style={{ fontSize: '0.73rem', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)', fontWeight: 600 }}>{d.wins}-{d.losses}{d.pushes > 0 ? `-${d.pushes}` : ''}</span>
                <span style={{ fontSize: '0.68rem', color: winC(wp), fontWeight: 700, marginLeft: 'auto' }}>{wp}%</span>
                <div style={{ width: '56px' }}><MiniBar wins={d.wins} losses={d.losses} pushes={d.pushes} /></div>
              </div>
            );
          })}
        </Panel>
      </div>

      {/* By Prompt Version */}
      {Object.keys(byPrompt || {}).length > 0 && (
        <Panel title="By Prompt Version">
          {Object.entries(byPrompt).map(([ver, d]) => {
            const wp = pct(d.wins, d.losses);
            return (
              <div key={ver} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: '0.71rem' }}>
                <span style={{ fontWeight: 700, color: '#a855f7', flex: '0 0 auto' }}>{ver}</span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: 'var(--text-primary)' }}>{d.wins}-{d.losses}{d.pushes > 0 ? `-${d.pushes}` : ''}</span>
                <span style={{ color: winC(wp), fontWeight: 700, marginLeft: 'auto' }}>{wp}%</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>{d.total} total</span>
              </div>
            );
          })}
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '6px', fontStyle: 'italic' }}>Bump PROMPT_VERSION in pregenerate-analysis to track prompt changes</div>
        </Panel>
      )}

      {/* Performance metrics */}
      {performance && (
        <Panel title="AI Performance Metrics">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            {[['Avg Latency', performance.avgLatency ? `${(performance.avgLatency/1000).toFixed(1)}s` : '—'],
              ['Avg Tokens In', performance.avgTokensIn?.toLocaleString() || '—'],
              ['Avg Tokens Out', performance.avgTokensOut?.toLocaleString() || '—']].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{label}</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)' }}>{val}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Daily trend bars */}
      {byDate?.length > 1 && (
        <Panel title="Daily Win Rate Trend">
          <div style={{ display: 'flex', gap: '2px', alignItems: 'end', height: '55px' }}>
            {byDate.map((d, i) => {
              const wp = pct(d.wins, d.losses);
              return <div key={i} title={`${d.date}: ${d.wins}W-${d.losses}L (${wp}%)`} style={{ flex: 1, height: `${Math.max(4, (wp/100)*55)}px`, borderRadius: '2px 2px 0 0', background: winC(wp), opacity: 0.7, cursor: 'pointer', minWidth: '3px' }} />;
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '3px' }}>
            <span>{byDate[0]?.date}</span><span>{byDate[byDate.length-1]?.date}</span>
          </div>
        </Panel>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS VIEW (analysis viewer + pregenerate triggers)
// ═══════════════════════════════════════════════════════════════════════════════
function ReportsView({ reportDate, setReportDate, data, expandedAnalysis, setExpandedAnalysis, pregen, onPregen, onRefresh, loading }) {
  const analyses = data?.analyses || [];
  const graded   = analyses.filter(a => a.prediction_result).length;
  const pending  = analyses.length - graded;

  const navDate = (delta) => {
    const d = new Date(reportDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setReportDate(d.toISOString().split('T')[0]);
  };

  const isToday = reportDate === todayStr();
  const isTomorrow = reportDate === offsetDate(1);

  const actionBtn = (label, onClick, disabled, color = GOLD, loading = false) => (
    <button onClick={onClick} disabled={disabled || loading} style={{
      padding: '0.4rem 0.9rem', borderRadius: '6px', cursor: disabled || loading ? 'default' : 'pointer', fontSize: '0.72rem',
      background: disabled || loading ? 'rgba(255,255,255,0.04)' : `${color}18`,
      border: `1px solid ${disabled || loading ? 'var(--border)' : `${color}55`}`,
      color: disabled || loading ? 'var(--text-muted)' : color,
      fontWeight: 600, fontFamily: 'inherit',
      opacity: disabled ? 0.5 : 1,
    }}>
      {loading ? '⟳ Running…' : label}
    </button>
  );

  const PregenResult = ({ state }) => {
    if (!state?.result) return null;
    const ok = state.result.ok !== false;
    const msg = state.result.result?.message || state.result.result?.analysed || state.result.error || (ok ? 'Triggered' : 'Error');
    return (
      <div style={{ fontSize: '0.65rem', padding: '4px 8px', borderRadius: '4px', background: ok ? 'rgba(74,222,128,0.07)' : 'rgba(248,113,113,0.07)', border: `1px solid ${ok ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`, color: ok ? '#4ade80' : '#f87171' }}>
        {ok ? '✓' : '✗'} {typeof msg === 'object' ? JSON.stringify(msg) : String(msg).slice(0, 150)}
      </div>
    );
  };

  // Sport icon map
  const sportIcon = (sport) => ({ mlb: '⚾', nba: '🏀', nhl: '🏒', nfl: '🏈', mls: '⚽', wnba: '🏀' }[sport?.toLowerCase()] || '🏟️');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
      {/* Pregenerate control panel */}
      <Panel title="⚡ Pregenerate Controls">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
            Manually trigger AI analysis pre-generation. Analyses run in background — check the report viewer below after ~2 minutes.
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {actionBtn("⚡ Generate Today's Analyses", () => onPregen('today'), pregen.today?.loading, GOLD, pregen.today?.loading)}
            {actionBtn("🌙 Generate Tomorrow's Analyses", () => onPregen('tomorrow'), pregen.tomorrow?.loading, '#a855f7', pregen.tomorrow?.loading)}
          </div>
          <PregenResult state={pregen.today} />
          <PregenResult state={pregen.tomorrow} />
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Note: full pre-generation takes 5–15 min (1 game/min). Request may timeout but analysis continues on the server.
          </div>
        </div>
      </Panel>

      {/* Date navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={() => navDate(-1)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem' }}>‹ Prev</button>
          <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} style={{ background: 'var(--bg-elevated)', border: `1px solid ${GOLD}55`, color: 'var(--text-primary)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.72rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }} />
          <button onClick={() => navDate(1)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem' }}>Next ›</button>
          {!isToday && <button onClick={() => setReportDate(todayStr())} style={{ background: `${GOLD}14`, border: `1px solid ${GOLD}44`, color: GOLD, borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700 }}>Today</button>}
          {!isTomorrow && <button onClick={() => setReportDate(offsetDate(1))} style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700 }}>Tomorrow</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {analyses.length > 0 && (
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{analyses.length}</span> cached ·{' '}
              <span style={{ color: '#4ade80' }}>{graded}</span> graded ·{' '}
              <span style={{ color: '#facc15' }}>{pending}</span> pending
            </div>
          )}
          <button onClick={onRefresh} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 8px', fontSize: '0.67rem', fontFamily: 'inherit' }}>
            ↺ Refresh
          </button>
        </div>
      </div>

      {/* Analysis cards */}
      {!loading && analyses.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2.5rem', border: '1px dashed var(--border)', borderRadius: '10px', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
          No cached analyses for {reportDate}.<br />
          <span style={{ fontSize: '0.68rem', marginTop: '6px', display: 'block' }}>Use the pregenerate buttons above or wait for the scheduled cron (8am / 4pm ET).</span>
        </div>
      )}

      {analyses.map(a => {
        const isExpanded = expandedAnalysis === a.id;
        const resultColor = { WIN: '#4ade80', LOSS: '#f87171', PUSH: '#facc15' }[a.prediction_result] || 'var(--text-muted)';
        return (
          <div key={a.id} style={{ background: 'var(--bg-elevated)', border: `1px solid ${isExpanded ? `${GOLD}44` : 'var(--border)'}`, borderRadius: '10px', overflow: 'hidden' }}>
            {/* Header row */}
            <div onClick={() => setExpandedAnalysis(isExpanded ? null : a.id)} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.7rem 0.9rem', cursor: 'pointer' }}>
              <span style={{ fontSize: '1rem' }}>{sportIcon(a.sport)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.away_team} @ {a.home_team}
                </div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                  {a.sport?.toUpperCase()} · {a.game_date} · Generated {a.generated_at ? new Date(a.generated_at).toLocaleString() : '—'}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                {a.prediction_result ? <WinBadge result={a.prediction_result} /> : <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>pending</span>}
                {a.prediction_conf && <ConfBadge conf={a.prediction_conf} />}
                <span style={{ fontSize: '0.61rem', color: '#60a5fa', fontWeight: 600 }}>{a.model || '—'}</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '0.8rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                {/* Meta row */}
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.67rem', color: 'var(--text-muted)' }}>
                  {a.prediction_pick && <span><span style={{ color: GOLD, fontWeight: 700 }}>Pick:</span> {a.prediction_pick}</span>}
                  {a.prediction_conf && <span><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Confidence:</span> <span style={{ color: { ELITE: '#a855f7', HIGH: '#4ade80', MEDIUM: '#facc15' }[a.prediction_conf] || '#94a3b8', fontWeight: 700 }}>{a.prediction_conf}</span></span>}
                  {a.model && <span><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Model:</span> {a.model}</span>}
                  {a.prediction_result && <span><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Result:</span> <span style={{ color: resultColor, fontWeight: 700 }}>{a.prediction_result}</span></span>}
                  {a.prediction_graded_at && <span><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Graded:</span> {new Date(a.prediction_graded_at).toLocaleDateString()}</span>}
                </div>

                {/* Full analysis text */}
                {a.analysis ? (
                  <div style={{ background: 'var(--bg-primary)', borderRadius: '7px', padding: '0.75rem', maxHeight: '400px', overflow: 'auto' }}>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.67rem', color: 'var(--text-secondary)', lineHeight: 1.6, fontFamily: 'inherit', margin: 0 }}>
                      {a.analysis}
                    </pre>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No analysis text stored.</div>
                )}

                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', display: 'flex', gap: '10px' }}>
                  <span>ID: {a.id}</span>
                  {a.updated_at && <span>Updated: {new Date(a.updated_at).toLocaleString()}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGS VIEW (audit trail)
// ═══════════════════════════════════════════════════════════════════════════════
function LogsView({ data, page, onPageChange, expanded, onToggle }) {
  const { logs, totalPages } = data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{data.total} entries — Page {page} of {totalPages}</div>
      {logs.map(log => (
        <div key={log.id} style={{ background: 'var(--bg-elevated)', border: `1px solid ${expanded === log.id ? 'rgba(168,85,247,0.4)' : 'var(--border)'}`, borderRadius: '8px', overflow: 'hidden' }}>
          <div onClick={() => onToggle(log.id)} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.55rem 0.8rem', cursor: 'pointer', fontSize: '0.74rem' }}>
            <span style={{ fontWeight: 700, color: 'var(--text-secondary)', width: '34px', textAlign: 'center', fontSize: '0.6rem', textTransform: 'uppercase' }}>{log.sport}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 500, flex: 1 }}>{log.away_team} @ {log.home_team}</span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{log.game_date}</span>
            {log.prediction_result && <WinBadge result={log.prediction_result} />}
            {log.parsed_conf && <ConfBadge conf={log.parsed_conf} />}
            <span style={{ fontSize: '0.58rem', color: '#60a5fa' }}>{log.model_used || '—'}</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', transform: expanded === log.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
          </div>
          {expanded === log.id && (
            <div style={{ padding: '0 0.8rem 0.8rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '6px', fontSize: '0.67rem' }}>
                {[['Model Requested', log.model_requested], ['Model Used', log.model_used], ['Provider', log.provider], ['Fallback?', log.was_fallback ? 'Yes' : 'No'], ['Prompt Version', log.prompt_version], ['Latency', log.latency_ms ? `${(log.latency_ms/1000).toFixed(1)}s` : '—'], ['Tokens In', log.tokens_in?.toLocaleString() || '—'], ['Tokens Out', log.tokens_out?.toLocaleString() || '—'], ['Trigger', log.trigger_source], ['Pick', log.parsed_pick], ['Edge Score', log.parsed_edge], ['Final Score', log.final_score]].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: '0.57rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
                    <div style={{ fontSize: '0.71rem', color: 'var(--text-primary)', fontWeight: 500, wordBreak: 'break-all' }}>{val || '—'}</div>
                  </div>
                ))}
              </div>
              {[['Odds Context Fed to AI', log.odds_context, '#60a5fa'], ['User Prompt Sent', log.user_prompt, '#a855f7'], ['System Prompt', log.system_prompt, '#facc15'], ['Full AI Response', log.raw_response, '#4ade80']].map(([label, val, c]) => val && (
                <details key={label} style={{ fontSize: '0.67rem' }}>
                  <summary style={{ color: c, cursor: 'pointer', fontWeight: 600 }}>{label}</summary>
                  <pre style={{ background: 'var(--bg-primary)', padding: '8px', borderRadius: '6px', whiteSpace: 'pre-wrap', color: 'var(--text-muted)', fontSize: '0.61rem', marginTop: '4px', maxHeight: '200px', overflow: 'auto' }}>{val}</pre>
                </details>
              ))}
              <div style={{ fontSize: '0.57rem', color: 'var(--text-muted)', display: 'flex', gap: '10px' }}>
                <span>Run: {log.run_id || '—'}</span>
                <span>Created: {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}</span>
              </div>
            </div>
          )}
        </div>
      ))}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '0.5rem' }}>
          {[['Prev', page > 1, () => onPageChange(page - 1)], ['Next', page < totalPages, () => onPageChange(page + 1)]].map(([label, enabled, onClick]) => (
            <button key={label} onClick={enabled ? onClick : undefined} disabled={!enabled} style={{ padding: '4px 12px', borderRadius: '6px', fontSize: '0.71rem', cursor: enabled ? 'pointer' : 'default', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: enabled ? 'var(--text-secondary)' : 'var(--text-muted)', opacity: enabled ? 1 : 0.4, fontFamily: 'inherit' }}>{label}</button>
          ))}
          <span style={{ fontSize: '0.71rem', color: 'var(--text-muted)', padding: '4px 8px' }}>{page} / {totalPages}</span>
        </div>
      )}
    </div>
  );
}
