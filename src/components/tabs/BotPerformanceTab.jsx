'use client';
import { useEffect, useState } from 'react';

const CONF_COLORS = { ELITE: '#FFB800', HIGH: '#4ade80', MEDIUM: '#60a5fa', LOW: '#9ca3af', UNCAL: '#6b7280' };
const SPORT_LABELS = {
  mlb: 'MLB', nba: 'NBA', nhl: 'NHL', nfl: 'NFL', ncaaf: 'NCAAF', ncaab: 'NCAAB',
  wnba: 'WNBA', mls: 'MLS', soccer: 'Soccer', tennis: 'Tennis', ufc: 'UFC', mma: 'MMA', golf: 'Golf',
};

function fmtPct(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function fmtUnits(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}u`;
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s + 'T12:00:00Z');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ── Reusable summary tile ─────────────────────────────────────────────────
function StatTile({ label, value, sub, color }) {
  return (
    <div style={{
      background: 'var(--bg-card, #0f0f1a)',
      border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
      borderRadius: '10px',
      padding: '14px 16px',
      flex: '1 1 180px',
      minWidth: '170px',
    }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{
        fontFamily: 'IBM Plex Mono, monospace',
        fontSize: '1.6rem',
        fontWeight: 700,
        color: color || 'var(--text-primary)',
        lineHeight: 1.1,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ── Horizontal win/loss bar ──────────────────────────────────────────────
function WinLossBar({ wins, losses, height = 6 }) {
  const total = wins + losses;
  if (total === 0) {
    return <div style={{ height, background: 'rgba(255,255,255,0.04)', borderRadius: 3 }} />;
  }
  const winPct = (100 * wins) / total;
  return (
    <div style={{ height, display: 'flex', borderRadius: 3, overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
      <div style={{ width: `${winPct}%`, background: '#4ade80' }} />
      <div style={{ width: `${100 - winPct}%`, background: '#f87171' }} />
    </div>
  );
}

// ── Result pill (WIN / LOSS / PUSH) ───────────────────────────────────────
function ResultPill({ result }) {
  if (!result) return null;
  const colors = { WIN: '#4ade80', LOSS: '#f87171', PUSH: '#9ca3af' };
  const c = colors[result] || '#9ca3af';
  return (
    <span style={{
      fontSize: '0.6rem',
      fontWeight: 800,
      letterSpacing: '0.08em',
      padding: '2px 7px',
      borderRadius: '4px',
      background: c + '22',
      color: c,
      border: `1px solid ${c}44`,
    }}>
      {result}
    </span>
  );
}

// ── Confidence pill ─────────────────────────────────────────────────────
function ConfPill({ conf }) {
  if (!conf) return null;
  const c = CONF_COLORS[conf] || '#9ca3af';
  return (
    <span style={{
      fontSize: '0.6rem',
      fontWeight: 700,
      letterSpacing: '0.06em',
      padding: '1px 6px',
      borderRadius: '4px',
      background: c + '1f',
      color: c,
      border: `1px solid ${c}40`,
    }}>
      {conf}
    </span>
  );
}

// ── Main tab ─────────────────────────────────────────────────────────────
export default function BotPerformanceTab() {
  const [range, setRange] = useState('all');
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/bot-performance?range=${range}`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [range]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', color: 'var(--text-muted)', textAlign: 'center' }}>
        Loading bot performance…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', color: 'var(--text-danger, #f87171)', textAlign: 'center' }}>
        Failed to load: {error}
      </div>
    );
  }

  if (!data) return null;

  const { summary, by_sport, by_conf, weekly, recent } = data;
  const wlTotal = summary.wins + summary.losses;
  const winColor = summary.win_pct === null ? 'var(--text-primary)'
                  : summary.win_pct >= 55 ? '#4ade80'
                  : summary.win_pct >= 50 ? '#FFB800'
                  : '#f87171';
  const roiColor = summary.roi.roi_pct === null ? 'var(--text-primary)'
                  : summary.roi.roi_pct > 0 ? '#4ade80'
                  : '#f87171';

  return (
    <div style={{ padding: '0.5rem 0 2rem', maxWidth: 1300, margin: '0 auto' }}>
      {/* Header + range selector */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginBottom: '4px', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
          🤖 Bot Performance
        </h1>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          BetOS AI's pick history & accuracy — updated live from the picks DB
        </span>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: 'All time' },
          { id: '30d', label: 'Last 30 days' },
          { id: '7d',  label: 'Last 7 days' },
        ].map(r => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            style={{
              padding: '6px 12px',
              fontSize: '0.78rem',
              fontWeight: 600,
              borderRadius: '6px',
              cursor: 'pointer',
              background: range === r.id ? 'rgba(255,184,0,0.15)' : 'transparent',
              color: range === r.id ? '#FFB800' : 'var(--text-secondary)',
              border: range === r.id ? '1px solid rgba(255,184,0,0.4)' : '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Top-line stats */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <StatTile
          label="Record"
          value={`${summary.wins}–${summary.losses}`}
          sub={`${summary.total} graded picks`}
        />
        <StatTile
          label="Win Rate"
          value={fmtPct(summary.win_pct, 1)}
          sub="W / (W + L)"
          color={winColor}
        />
        <StatTile
          label="ROI"
          value={fmtPct(summary.roi.roi_pct, 1)}
          sub={`${fmtUnits(summary.roi.net_units)} on ${summary.roi.picks} picks`}
          color={roiColor}
        />
      </div>

      {/* Methodology / caveats */}
      <details style={{
        marginBottom: '24px',
        background: 'rgba(96,165,250,0.05)',
        border: '1px solid rgba(96,165,250,0.18)',
        borderRadius: '8px',
        padding: '10px 14px',
      }}>
        <summary style={{ cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: '#60a5fa' }}>
          ℹ️ How to read this page
        </summary>
        <ul style={{ marginTop: '10px', paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.6 }}>
          <li><strong>Record</strong> shows only graded W/L bets. Games where the AI declined to bet, or where the result couldn't be determined, are excluded entirely.</li>
          <li><strong>Win rate</strong> is W / (W + L).</li>
          <li><strong>ROI</strong> only includes picks where odds were clearly parseable from the pick text (e.g. "NYY ML -150"). It's a representative sample of all bets.</li>
        </ul>
      </details>

      {/* Two-column: by sport + by confidence */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* By sport */}
        <div style={{
          background: 'var(--bg-card, #0f0f1a)',
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
          borderRadius: '10px',
          padding: '14px 16px',
        }}>
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '12px' }}>
            By Sport
          </div>
          {by_sport.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No graded picks yet.</div>
          ) : by_sport.map(s => (
            <div key={s.sport} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  {SPORT_LABELS[s.sport] || s.sport.toUpperCase()}
                </span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <span style={{ color: '#4ade80' }}>{s.wins}</span>
                  <span style={{ color: 'var(--text-muted)' }}>–</span>
                  <span style={{ color: '#f87171' }}>{s.losses}</span>
                  <span style={{ marginLeft: '10px', color: s.win_pct >= 55 ? '#4ade80' : s.win_pct >= 50 ? '#FFB800' : '#f87171', fontWeight: 700 }}>
                    {fmtPct(s.win_pct, 1)}
                  </span>
                </span>
              </div>
              <WinLossBar wins={s.wins} losses={s.losses} />
            </div>
          ))}
        </div>

        {/* By confidence */}
        <div style={{
          background: 'var(--bg-card, #0f0f1a)',
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
          borderRadius: '10px',
          padding: '14px 16px',
        }}>
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '12px' }}>
            Confidence Calibration
          </div>
          {by_conf.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No graded picks yet.</div>
          ) : by_conf.map(c => (
            <div key={c.conf} style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <ConfPill conf={c.conf} />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                    {c.total} picks
                  </span>
                </span>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <span style={{ color: '#4ade80' }}>{c.wins}</span>
                  <span style={{ color: 'var(--text-muted)' }}>–</span>
                  <span style={{ color: '#f87171' }}>{c.losses}</span>
                  <span style={{ marginLeft: '10px', color: c.win_pct >= 55 ? '#4ade80' : c.win_pct >= 50 ? '#FFB800' : '#f87171', fontWeight: 700 }}>
                    {fmtPct(c.win_pct, 1)}
                  </span>
                </span>
              </div>
              <WinLossBar wins={c.wins} losses={c.losses} />
            </div>
          ))}
          <div style={{ marginTop: '12px', fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            A well-calibrated model has ELITE &gt; HIGH &gt; MEDIUM &gt; LOW. If the bars look flat, the AI's confidence labels aren't predictive.
          </div>
        </div>
      </div>

      {/* Weekly trend */}
      {weekly.length > 0 && (
        <div style={{
          background: 'var(--bg-card, #0f0f1a)',
          border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
          borderRadius: '10px',
          padding: '14px 16px',
          marginBottom: '24px',
        }}>
          <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '12px' }}>
            Weekly Performance
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', minHeight: '120px' }}>
            {weekly.map(w => {
              const total = w.wins + w.losses;
              const winH = total === 0 ? 0 : Math.max(4, (w.wins / Math.max(...weekly.map(x => x.wins + x.losses))) * 100);
              const lossH = total === 0 ? 0 : Math.max(4, (w.losses / Math.max(...weekly.map(x => x.wins + x.losses))) * 100);
              return (
                <div key={w.week} style={{ flex: 1, minWidth: 28, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', height: 100, gap: 1 }}>
                    <div style={{ width: 8, height: `${winH}px`, background: '#4ade80', borderRadius: '2px 2px 0 0' }} title={`${w.wins} wins`} />
                    <div style={{ width: 8, height: `${lossH}px`, background: '#f87171', borderRadius: '2px 2px 0 0' }} title={`${w.losses} losses`} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace' }}>
                    {w.week.slice(-3)}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: w.win_pct >= 55 ? '#4ade80' : w.win_pct >= 50 ? '#FFB800' : '#f87171', fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace' }}>
                    {fmtPct(w.win_pct, 0)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent picks table */}
      <div style={{
        background: 'var(--bg-card, #0f0f1a)',
        border: '1px solid var(--border-subtle, rgba(255,255,255,0.06))',
        borderRadius: '10px',
        padding: '14px 16px',
      }}>
        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: '12px' }}>
          Recent Picks ({recent.length})
        </div>
        {recent.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No graded picks yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Sport</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Matchup</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Pick</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Conf</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Edge</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Score</th>
                  <th style={{ padding: '8px 6px', fontWeight: 600 }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.05))' }}>
                    <td style={{ padding: '8px 6px', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace' }}>{fmtDate(p.game_date)}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-secondary)' }}>{(SPORT_LABELS[p.sport] || p.sport || '').toUpperCase()}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-primary)' }}>{p.matchup}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-primary)', fontFamily: 'IBM Plex Mono, monospace', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.pick}>
                      {p.pick || '—'}
                    </td>
                    <td style={{ padding: '8px 6px' }}><ConfPill conf={p.conf} /></td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace' }}>{p.edge || '—'}</td>
                    <td style={{ padding: '8px 6px', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace' }}>{p.final_score || '—'}</td>
                    <td style={{ padding: '8px 6px' }}><ResultPill result={p.result} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
