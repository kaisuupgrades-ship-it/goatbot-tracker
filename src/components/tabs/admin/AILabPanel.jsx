'use client';
import React, { useState, useEffect, useCallback } from 'react';

// ── Auth helper ───────────────────────────────────────────────────────────────
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

// ── Formatters & helpers ──────────────────────────────────────────────────────
const GOLD = '#D4A843';
function pct(w, l) { const s = w + l; return s > 0 ? Math.round((w / s) * 1000) / 10 : 0; }
function fmtU(v) { if (v == null) return '—'; return `${v > 0 ? '+' : ''}${v.toFixed(2)}u`; }
function fmtOdds(v) { if (!v) return '—'; return v > 0 ? `+${v}` : `${v}`; }
function winC(wp) { return wp >= 55 ? '#4ade80' : wp >= 50 ? '#facc15' : '#f87171'; }
function profC(v) { return v > 0 ? '#4ade80' : v < 0 ? '#f87171' : '#94a3b8'; }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function offsetDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]; }

function btnStyle(active, accent = '#a855f7') {
  return {
    padding: '0.32rem 0.65rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.71rem',
    border: `1px solid ${active ? `${accent}88` : 'var(--border)'}`,
    background: active ? `${accent}14` : 'transparent',
    color: active ? accent : 'var(--text-muted)',
    fontWeight: active ? 700 : 400, fontFamily: 'inherit',
  };
}

// ── Pick parsing ──────────────────────────────────────────────────────────────
// Parses prediction_pick text like "Lakers ML -150", "Chiefs -3.5 -115", "Over 217.5 -110"
function parsePredictionPick(text) {
  if (!text) return {};
  const t = text.trim();
  const oddsMatch = t.match(/\s([+-]\d{2,4})\s*$/);
  const odds = oddsMatch ? parseInt(oddsMatch[1]) : null;
  const core = oddsMatch ? t.slice(0, oddsMatch.index).trim() : t;

  const ouMatch = core.match(/^(Over|Under|O\/U)\s+([\d.]+)$/i);
  if (ouMatch) {
    const side = ouMatch[1].charAt(0).toUpperCase() + ouMatch[1].slice(1).toLowerCase();
    return { bet_type: `Total (${side})`, team: `${side} ${ouMatch[2]}`, line: parseFloat(ouMatch[2]), odds };
  }
  const mlMatch = core.match(/^(.+?)\s+ML\s*$/i);
  if (mlMatch) return { bet_type: 'Moneyline', team: mlMatch[1].trim(), line: null, odds };

  const spreadMatch = core.match(/^(.+?)\s+([+-][\d]+\.?[\d]*)$/);
  if (spreadMatch) {
    const line = parseFloat(spreadMatch[2]);
    if (Math.abs(line) < 50) return { bet_type: 'Spread', team: spreadMatch[1].trim(), line, odds };
  }
  return { bet_type: 'Moneyline', team: core || text, line: null, odds };
}

function confToUnits(conf) {
  return { ELITE: 3, HIGH: 3, MEDIUM: 2, LOW: 1 }[conf] || 1;
}

// ── UI atoms ──────────────────────────────────────────────────────────────────
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
    <div style={{ display: 'flex', height: '5px', borderRadius: '3px', overflow: 'hidden', width: '100%', background: 'var(--bg-primary)', marginTop: '8px' }}>
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

function Empty({ msg }) {
  return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2.5rem', fontSize: '0.76rem', border: '1px dashed var(--border)', borderRadius: '10px' }}>{msg}</div>;
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

// ── Pregenerate panel ─────────────────────────────────────────────────────────
function PregenPanel({ pregen, onPregen }) {
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
  return (
    <Panel title="⚡ Pregenerate Controls">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>Manually trigger AI analysis pre-generation. Runs in background — check pick cards below after ~2 min.</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {[["⚡ Generate Today's", 'today', GOLD], ["🌙 Generate Tomorrow's", 'tomorrow', '#a855f7']].map(([label, which, color]) => (
            <button key={which} onClick={() => onPregen(which)} disabled={pregen[which]?.loading} style={{ padding: '0.4rem 0.9rem', borderRadius: '6px', cursor: pregen[which]?.loading ? 'default' : 'pointer', fontSize: '0.72rem', background: pregen[which]?.loading ? 'rgba(255,255,255,0.04)' : `${color}18`, border: `1px solid ${pregen[which]?.loading ? 'var(--border)' : `${color}55`}`, color: pregen[which]?.loading ? 'var(--text-muted)' : color, fontWeight: 600, fontFamily: 'inherit' }}>
              {pregen[which]?.loading ? '⟳ Running…' : label}
            </button>
          ))}
        </div>
        <PregenResult state={pregen.today} />
        <PregenResult state={pregen.tomorrow} />
        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Full pre-generation takes 5–15 min (1 game/min). May timeout but continues server-side.</div>
      </div>
    </Panel>
  );
}

// ── Add Pick Modal ────────────────────────────────────────────────────────────
function AddPickModal({ analysis, onClose, onSuccess }) {
  const parsed = parsePredictionPick(analysis.prediction_pick);
  const suggested = confToUnits(analysis.prediction_conf);
  const [units, setUnits] = useState(suggested);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const confColor = { ELITE: '#a855f7', HIGH: '#4ade80', MEDIUM: '#facc15', LOW: '#94a3b8' }[analysis.prediction_conf] || '#94a3b8';
  const sportIcon = { mlb: '⚾', nba: '🏀', nhl: '🏒', nfl: '🏈', mls: '⚽', wnba: '🏀' }[analysis.sport?.toLowerCase()] || '🏟️';

  const handleSubmit = async () => {
    setSubmitting(true); setErr('');
    try {
      const { addPick } = await import('@/lib/supabase');
      const { error } = await addPick({
        sport:     analysis.sport?.toLowerCase() || '',
        team:      parsed.team || analysis.prediction_pick || '',
        pick:      analysis.prediction_pick || '',
        odds:      String(parsed.odds || ''),
        units:     parseFloat(units) || 1,
        date:      analysis.game_date || todayStr(),
        bet_type:  parsed.bet_type || 'Moneyline',
        // home_team/away_team give the grading engine a reliable fallback for game matching
        // when the team name alone doesn't resolve (covers edge cases in prediction_pick parsing)
        home_team: analysis.home_team || '',
        away_team: analysis.away_team || '',
        ...(parsed.line != null ? { line: parsed.line } : {}),
      });
      if (error) throw new Error(error.message || 'Save failed');
      onSuccess?.();
      onClose();
    } catch (e) { setErr(e.message); }
    setSubmitting(false);
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-primary)', border: `1px solid ${GOLD}44`, borderRadius: '14px', padding: '1.4rem', width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: GOLD, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Add GoatBot Pick</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>{sportIcon} {analysis.away_team} @ {analysis.home_team}</div>
        <div style={{ background: 'var(--bg-elevated)', borderRadius: '10px', padding: '0.9rem', display: 'flex', flexDirection: 'column', gap: '7px' }}>
          {[
            ['Pick', parsed.team || analysis.prediction_pick, 'var(--text-primary)'],
            ['Bet Type', `${parsed.bet_type || '—'}${parsed.line != null ? ` ${parsed.line > 0 ? '+' : ''}${parsed.line}` : ''}`, 'var(--text-secondary)'],
            ['Odds', fmtOdds(parsed.odds), GOLD],
            ['Confidence', analysis.prediction_conf || '—', confColor],
          ].map(([label, val, color]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color, fontFamily: label === 'Odds' ? 'IBM Plex Mono, monospace' : 'inherit' }}>{val}</span>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Units (suggested: {suggested}u for {analysis.prediction_conf || 'this confidence'})</div>
          <div style={{ display: 'flex', gap: '5px' }}>
            {[0.5, 1, 1.5, 2, 2.5, 3].map(u => (
              <button key={u} onClick={() => setUnits(u)} style={{ flex: 1, padding: '6px 2px', borderRadius: '6px', border: `1px solid ${units === u ? `${GOLD}88` : 'var(--border)'}`, background: units === u ? `${GOLD}18` : 'transparent', color: units === u ? GOLD : 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '0.7rem', cursor: 'pointer' }}>{u}u</button>
            ))}
          </div>
        </div>
        {err && <div style={{ fontSize: '0.7rem', color: '#f87171', background: 'rgba(248,113,113,0.08)', borderRadius: '6px', padding: '6px 10px', border: '1px solid rgba(248,113,113,0.2)' }}>⚠ {err}</div>}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '0.55rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.76rem' }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} style={{ flex: 2, padding: '0.55rem', borderRadius: '8px', border: `1px solid ${GOLD}66`, background: `${GOLD}18`, color: GOLD, cursor: submitting ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: '0.76rem', fontWeight: 700 }}>
            {submitting ? '⟳ Adding…' : `Add ${units}u Pick`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main AI Lab Panel ─────────────────────────────────────────────────────────
export default function AILabPanel({ userEmail }) {
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [logsExpanded, setLogsExpanded]   = useState(false);

  const [preset, setPreset]           = useState('30d');
  const [customFrom, setCustomFrom]   = useState(() => offsetDate(-30));
  const [customTo, setCustomTo]       = useState(() => todayStr());
  const [sportFilter, setSportFilter] = useState('');
  const [typeFilter, setTypeFilter]   = useState('');

  const [analyticsData, setAnalyticsData] = useState(null);
  const [reportsData, setReportsData]     = useState(null);
  const [logsData, setLogsData]           = useState(null);

  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [loadingReports, setLoadingReports]     = useState(false);
  const [loadingLogs, setLoadingLogs]           = useState(false);
  const [analyticsError, setAnalyticsError]     = useState('');

  const [logPage, setLogPage]                   = useState(1);
  const [expandedLog, setExpandedLog]           = useState(null);
  const [reportDate, setReportDate]             = useState(() => todayStr());
  const [expandedAnalysis, setExpandedAnalysis] = useState(null);
  const [addPickTarget, setAddPickTarget]       = useState(null);
  const [pickSuccess, setPickSuccess]           = useState('');
  const [pregenState, setPregenState]           = useState({ today: null, tomorrow: null });

  const { from, to } = (() => {
    if (preset === 'custom') return { from: customFrom, to: customTo };
    const p = PRESETS.find(x => x.id === preset);
    return { from: p?.from?.() || offsetDate(-30), to: todayStr() };
  })();

  const doLoadAnalytics = useCallback(async (f, t, sport, type) => {
    setLoadingAnalytics(true); setAnalyticsError('');
    try {
      let url = `/api/admin/ai-lab?view=analytics&from=${f}&to=${t}`;
      if (sport) url += `&sport=${sport}`;
      if (type)  url += `&pickType=${encodeURIComponent(type)}`;
      const d = await adminFetch(url).then(r => r.json());
      if (d.error) throw new Error(d.error);
      setAnalyticsData(d);
    } catch (e) { setAnalyticsError(e.message); }
    setLoadingAnalytics(false);
  }, []);

  const doLoadReports = useCallback(async (date) => {
    setLoadingReports(true);
    try {
      const d = await adminFetch(`/api/admin?action=game_analyses&date=${date}`).then(r => r.json());
      if (!d.error) setReportsData(d);
    } catch {}
    setLoadingReports(false);
  }, []);

  const doLoadLogs = useCallback(async (f, t, sport, page) => {
    setLoadingLogs(true);
    try {
      let url = `/api/admin/ai-lab?view=logs&from=${f}&to=${t}&page=${page}&limit=30`;
      if (sport) url += `&sport=${sport}`;
      const d = await adminFetch(url).then(r => r.json());
      if (!d.error) { setLogsData(d); setLogPage(page); }
    } catch {}
    setLoadingLogs(false);
  }, []);

  // Analytics fires on filter change (and mount)
  useEffect(() => {
    doLoadAnalytics(from, to, sportFilter, typeFilter);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, sportFilter, typeFilter]);

  // Reports fires on date change (and mount)
  useEffect(() => {
    doLoadReports(reportDate);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate]);

  const triggerPregenerate = useCallback(async (which) => {
    const date = which === 'tomorrow' ? offsetDate(1) : todayStr();
    setPregenState(p => ({ ...p, [which]: { loading: true, result: null } }));
    try {
      const jobPath = `/api/cron/pregenerate-analysis${which === 'tomorrow' ? `?gameDate=${date}` : ''}`;
      const res = await adminFetch('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'cron_run', jobPath }) });
      const data = await res.json();
      setPregenState(p => ({ ...p, [which]: { loading: false, result: data } }));
      setTimeout(() => doLoadReports(which === 'tomorrow' ? date : todayStr()), 2000);
    } catch (e) {
      setPregenState(p => ({ ...p, [which]: { loading: false, result: { ok: false, error: e.message } } }));
    }
  }, [doLoadReports]);

  const s = analyticsData?.summary;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

      {/* Pick success toast */}
      {pickSuccess && (
        <div style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: '8px', padding: '8px 12px', fontSize: '0.76rem', color: '#4ade80', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          ✓ {pickSuccess}
          <button onClick={() => setPickSuccess('')} style={{ background: 'none', border: 'none', color: '#4ade80', cursor: 'pointer', fontSize: '0.9rem' }}>×</button>
        </div>
      )}

      {/* ── 1. Record card (clickable → expands full analytics) ── */}
      <div
        onClick={() => setStatsExpanded(x => !x)}
        style={{ background: 'var(--bg-elevated)', border: `1px solid ${statsExpanded ? `${GOLD}55` : 'var(--border)'}`, borderRadius: '10px', padding: '1rem 1.15rem', cursor: 'pointer', transition: 'border-color 0.15s' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.57rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px' }}>
              📈 AI Pick Record · {from} → {to}
            </div>
            {loadingAnalytics && !s ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Loading…</div>
            ) : s ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.85rem', fontWeight: 900, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)', lineHeight: 1 }}>{s.wins}W–{s.losses}L</span>
                {s.pushes > 0 && <span style={{ fontSize: '1rem', color: '#facc15', fontWeight: 700 }}>{s.pushes}P</span>}
                {s.winRate != null && <span style={{ fontSize: '1.1rem', fontWeight: 800, color: winC(s.winRate) }}>{s.winRate}%</span>}
                <span style={{ fontSize: '0.88rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: profC(s.totalProfit) }}>{fmtU(s.totalProfit)}</span>
                <span style={{ fontSize: '0.75rem', fontFamily: 'IBM Plex Mono, monospace', color: profC(s.roi) }}>ROI {s.roi != null ? `${s.roi > 0 ? '+' : ''}${s.roi}%` : '—'}</span>
              </div>
            ) : analyticsError ? (
              <div style={{ fontSize: '0.75rem', color: '#f87171' }}>⚠ {analyticsError}</div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No pick data</div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginBottom: '3px' }}>{statsExpanded ? 'Collapse' : 'Full analytics'}</div>
            <span style={{ fontSize: '1rem', color: GOLD, transform: statsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
          </div>
        </div>
        {s && <MiniBar wins={s.wins} losses={s.losses} pushes={s.pushes} />}
      </div>

      {/* ── 2. Expanded analytics section ── */}
      {statsExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          {/* Filter bar */}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', padding: '0.55rem 0.8rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px' }}>
            {PRESETS.map(p => (
              <button key={p.id} onClick={e => { e.stopPropagation(); setPreset(p.id); }} style={{ ...btnStyle(preset === p.id, GOLD), padding: '0.22rem 0.5rem', fontSize: '0.67rem' }}>{p.label}</button>
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
              {['mlb','nba','nhl','nfl','mls','wnba','ncaaf','ncaab'].map(sp => <option key={sp} value={sp}>{sp.toUpperCase()}</option>)}
            </select>
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: '5px', padding: '2px 6px', fontSize: '0.67rem' }}>
              <option value="">All Types</option>
              {['Moneyline','Spread','Total','Parlay'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <span style={{ marginLeft: 'auto', fontSize: '0.6rem', color: 'var(--text-muted)' }}>{from} → {to}</span>
          </div>
          {loadingAnalytics && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem', fontSize: '0.76rem' }}>Loading analytics…</div>}
          {!loadingAnalytics && analyticsData && <AnalyticsView data={analyticsData} />}
          <PregenPanel pregen={pregenState} onPregen={triggerPregenerate} />
        </div>
      )}

      {/* ── 3. Pick recommendation cards (always visible) ── */}
      <ReportsSection
        reportDate={reportDate}
        setReportDate={setReportDate}
        data={reportsData}
        loading={loadingReports}
        expandedAnalysis={expandedAnalysis}
        setExpandedAnalysis={setExpandedAnalysis}
        onRefresh={() => doLoadReports(reportDate)}
        onAddPick={setAddPickTarget}
      />

      {/* ── 4. Audit logs (collapsible) ── */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
        <div
          onClick={() => { const next = !logsExpanded; setLogsExpanded(next); if (next && !logsData) doLoadLogs(from, to, sportFilter, 1); }}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', cursor: 'pointer' }}
        >
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)' }}>🔍 Audit Logs</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {loadingLogs && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>⟳</span>}
            <span style={{ fontSize: '1rem', color: 'var(--text-muted)', transform: logsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', display: 'inline-block' }}>▾</span>
          </div>
        </div>
        {logsExpanded && (
          <div style={{ padding: '0 0.85rem 0.85rem', borderTop: '1px solid var(--border)' }}>
            {loadingLogs && <div style={{ color: 'var(--text-muted)', padding: '1rem', textAlign: 'center', fontSize: '0.76rem' }}>Loading…</div>}
            {!loadingLogs && logsData && <LogsView data={logsData} page={logPage} onPageChange={(page) => doLoadLogs(from, to, sportFilter, page)} expanded={expandedLog} onToggle={id => setExpandedLog(expandedLog === id ? null : id)} />}
            {!loadingLogs && !logsData && <div style={{ color: 'var(--text-muted)', padding: '1rem', textAlign: 'center', fontSize: '0.76rem' }}>No audit logs found.</div>}
          </div>
        )}
      </div>

      {/* Add Pick modal */}
      {addPickTarget && (
        <AddPickModal
          analysis={addPickTarget}
          onClose={() => setAddPickTarget(null)}
          onSuccess={() => setPickSuccess(`Pick added: ${addPickTarget.prediction_pick || addPickTarget.away_team}`)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function AnalyticsView({ data }) {
  const { summary: s, roiByDate, bySport, byPickType, streaks, calibration } = data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(138px, 1fr))', gap: '8px' }}>
        <KPICard label="Total P&L" icon="💰" value={fmtU(s.totalProfit)} color={profC(s.totalProfit)} sub={`${s.totalPicks} picks graded`} />
        <KPICard label="ROI %" icon="📊" value={s.roi != null ? `${s.roi > 0 ? '+' : ''}${s.roi}%` : '—'} color={profC(s.roi)} sub={`${s.wins}W / ${s.losses}L / ${s.pushes}P`} />
        <KPICard label="Win Rate" icon="🎯" value={s.winRate != null ? `${s.winRate}%` : '—'} color={winC(s.winRate)} sub={`${s.settled} settled`} />
        <KPICard label="Avg Win Odds" icon="📈" value={fmtOdds(s.avgWinOdds)} color={GOLD} sub="on wins" />
        <KPICard label="Avg Loss Odds" icon="📉" value={fmtOdds(s.avgLossOdds)} color="#f87171" sub="on losses" />
        <KPICard label="¼ Kelly" icon="🧮" value={s.quarterKellyPct != null ? `${Math.max(0, s.quarterKellyPct)}%` : '—'} color={s.quarterKellyPct > 0 ? '#4ade80' : '#f87171'} sub={s.kellyPct != null ? `Full: ${Math.max(0, s.kellyPct)}%` : 'Need ≥20 settled'} />
      </div>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '0.8rem' }}>
        <Panel title="P&L by Sport">
          {bySport?.length > 0 ? (
            <>
              <HBars items={bySport} nameKey="sport" valueKey="profit" winRateKey="winRate" />
              <div style={{ marginTop: '0.65rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {bySport.slice(0, 8).map(sp => (
                  <div key={sp.sport} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.63rem', color: 'var(--text-muted)', padding: '1px 0' }}>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{sp.sport}</span>
                    <span>{sp.wins}W-{sp.losses}L</span>
                    <span style={{ color: profC(sp.profit), fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}>{fmtU(sp.profit)}</span>
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))', gap: '0.8rem' }}>
        <Panel title="Streak Tracker"><StreakView streaks={streaks} /></Panel>
        <Panel title="Odds Calibration — Edge Analysis"><CalibrationTable data={calibration} /></Panel>
      </div>
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
// REPORTS SECTION — pick recommendation cards with date navigation
// ═══════════════════════════════════════════════════════════════════════════════
function ReportsSection({ reportDate, setReportDate, data, loading, expandedAnalysis, setExpandedAnalysis, onRefresh, onAddPick }) {
  const analyses = data?.analyses || [];
  const graded   = analyses.filter(a => a.prediction_result).length;
  const pending  = analyses.length - graded;
  const isToday    = reportDate === todayStr();
  const isTomorrow = reportDate === offsetDate(1);
  const sportIcon  = s => ({ mlb: '⚾', nba: '🏀', nhl: '🏒', nfl: '🏈', mls: '⚽', wnba: '🏀' }[s?.toLowerCase()] || '🏟️');

  const navDate = (delta) => {
    const d = new Date(reportDate + 'T12:00:00');
    d.setDate(d.getDate() + delta);
    setReportDate(d.toISOString().split('T')[0]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      <div style={{ fontSize: '0.61rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, padding: '0 2px' }}>📋 AI Pick Recommendations</div>
      {/* Date nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={() => navDate(-1)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem' }}>‹ Prev</button>
          <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} style={{ background: 'var(--bg-elevated)', border: `1px solid ${GOLD}55`, color: 'var(--text-primary)', borderRadius: '6px', padding: '4px 8px', fontSize: '0.72rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }} />
          <button onClick={() => navDate(1)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.72rem' }}>Next ›</button>
          {!isToday    && <button onClick={() => setReportDate(todayStr())}    style={{ background: `${GOLD}14`, border: `1px solid ${GOLD}44`, color: GOLD, borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700 }}>Today</button>}
          {!isTomorrow && <button onClick={() => setReportDate(offsetDate(1))} style={{ background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700 }}>Tomorrow</button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {analyses.length > 0 && (
            <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{analyses.length}</span> cached · <span style={{ color: '#4ade80' }}>{graded}</span> graded · <span style={{ color: '#facc15' }}>{pending}</span> pending
            </div>
          )}
          <button onClick={onRefresh} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 8px', fontSize: '0.67rem', fontFamily: 'inherit' }}>↺ Refresh</button>
        </div>
      </div>
      {loading && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem', fontSize: '0.76rem' }}>Loading…</div>}
      {!loading && analyses.length === 0 && (
        <div style={{ textAlign: 'center', padding: '2.5rem', border: '1px dashed var(--border)', borderRadius: '10px', color: 'var(--text-muted)', fontSize: '0.76rem' }}>
          No cached analyses for {reportDate}.<br />
          <span style={{ fontSize: '0.68rem', marginTop: '6px', display: 'block' }}>Tap the record card above → expand → ⚡ Generate to run pre-generation.</span>
        </div>
      )}
      {analyses.map(a => (
        <PickCard
          key={a.id}
          analysis={a}
          sportIcon={sportIcon}
          isExpanded={expandedAnalysis === a.id}
          onToggleExpand={() => setExpandedAnalysis(expandedAnalysis === a.id ? null : a.id)}
          onAddPick={onAddPick}
        />
      ))}
    </div>
  );
}

// ── Individual pick recommendation card ───────────────────────────────────────
function PickCard({ analysis: a, sportIcon, isExpanded, onToggleExpand, onAddPick }) {
  const parsed    = parsePredictionPick(a.prediction_pick);
  const suggested = confToUnits(a.prediction_conf);
  const confColor = { ELITE: '#a855f7', HIGH: '#4ade80', MEDIUM: '#facc15', LOW: '#94a3b8' }[a.prediction_conf] || '#94a3b8';
  const resultColor = { WIN: '#4ade80', LOSS: '#f87171', PUSH: '#facc15' }[a.prediction_result] || 'var(--text-muted)';
  const isPending = !a.prediction_result;

  return (
    <div style={{ background: 'var(--bg-elevated)', border: `1px solid ${isExpanded ? `${GOLD}44` : isPending && a.prediction_pick ? `${confColor}33` : 'var(--border)'}`, borderRadius: '10px', overflow: 'hidden' }}>
      {/* Pick recommendation banner — only shown when there's a pick */}
      {a.prediction_pick && (
        <div style={{ background: isPending ? `${confColor}08` : 'transparent', borderBottom: `1px solid ${isPending ? `${confColor}20` : 'var(--border)'}`, padding: '0.65rem 0.9rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: confColor, flexShrink: 0, boxShadow: isPending ? `0 0 5px ${confColor}88` : 'none' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {parsed.team || a.prediction_pick}
            </div>
            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'flex', gap: '8px', marginTop: '1px', flexWrap: 'wrap' }}>
              <span>{parsed.bet_type}{parsed.line != null ? ` ${parsed.line > 0 ? '+' : ''}${parsed.line}` : ''}</span>
              {parsed.odds && <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: GOLD }}>{fmtOdds(parsed.odds)}</span>}
              <span style={{ color: confColor, fontWeight: 700 }}>{suggested}u suggested</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {a.prediction_result
              ? <WinBadge result={a.prediction_result} />
              : a.prediction_pick && (
                <button
                  onClick={e => { e.stopPropagation(); onAddPick(a); }}
                  style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${GOLD}66`, background: `${GOLD}18`, color: GOLD, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap' }}
                >
                  + Add Pick
                </button>
              )
            }
            {a.prediction_conf && <ConfBadge conf={a.prediction_conf} />}
          </div>
        </div>
      )}
      {/* Game row (tap to expand analysis) */}
      <div onClick={onToggleExpand} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.6rem 0.9rem', cursor: 'pointer' }}>
        <span style={{ fontSize: '0.95rem' }}>{sportIcon(a.sport)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.away_team} @ {a.home_team}</div>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>{a.sport?.toUpperCase()} · {a.game_date} · {a.model || '—'}</div>
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}>▾</span>
      </div>
      {/* Full analysis text */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '0.8rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.67rem', color: 'var(--text-muted)' }}>
            {a.prediction_pick && <span><span style={{ color: GOLD, fontWeight: 700 }}>Pick:</span> {a.prediction_pick}</span>}
            {a.prediction_conf && <span><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Confidence:</span> <span style={{ color: confColor, fontWeight: 700 }}>{a.prediction_conf}</span></span>}
            {a.model && <span><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Model:</span> {a.model}</span>}
            {a.prediction_result && <span><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Result:</span> <span style={{ color: resultColor, fontWeight: 700 }}>{a.prediction_result}</span></span>}
            {a.prediction_graded_at && <span><span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Graded:</span> {new Date(a.prediction_graded_at).toLocaleDateString()}</span>}
          </div>
          {a.analysis
            ? <div style={{ background: 'var(--bg-primary)', borderRadius: '7px', padding: '0.75rem', maxHeight: '400px', overflow: 'auto' }}><pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.67rem', color: 'var(--text-secondary)', lineHeight: 1.6, fontFamily: 'inherit', margin: 0 }}>{a.analysis}</pre></div>
            : <div style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No analysis text stored.</div>
          }
          <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', display: 'flex', gap: '10px' }}>
            <span>ID: {a.id}</span>
            {a.updated_at && <span>Updated: {new Date(a.updated_at).toLocaleString()}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOGS VIEW
// ═══════════════════════════════════════════════════════════════════════════════
function LogsView({ data, page, onPageChange, expanded, onToggle }) {
  const { logs, totalPages } = data;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '0.5rem' }}>
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
