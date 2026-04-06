'use client';
import React, { useState, useEffect, useCallback } from 'react';

// ── Auth helper (same as AdminTab) ──────────────────────────────────────────
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

// ── Tiny helpers ────────────────────────────────────────────────────────────
function pct(w, l) { const s = w + l; return s > 0 ? Math.round((w / s) * 1000) / 10 : 0; }

function WinBadge({ result }) {
  const colors = {
    WIN:  { bg: 'rgba(74,222,128,0.1)',  border: 'rgba(74,222,128,0.3)',  text: '#4ade80' },
    LOSS: { bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)', text: '#f87171' },
    PUSH: { bg: 'rgba(250,204,21,0.1)',  border: 'rgba(250,204,21,0.3)',  text: '#facc15' },
  };
  const c = colors[result] || { bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.3)', text: '#94a3b8' };
  return (
    <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: '4px', background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
      {result}
    </span>
  );
}

function MiniBar({ wins, losses, pushes }) {
  const total = wins + losses + pushes;
  if (!total) return null;
  return (
    <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', width: '100%', background: 'var(--bg-primary)' }}>
      {wins > 0 && <div style={{ width: `${(wins/total)*100}%`, background: '#4ade80' }} />}
      {pushes > 0 && <div style={{ width: `${(pushes/total)*100}%`, background: '#facc15' }} />}
      {losses > 0 && <div style={{ width: `${(losses/total)*100}%`, background: '#f87171' }} />}
    </div>
  );
}

// ── Main AI Lab Panel ───────────────────────────────────────────────────────
export default function AILabPanel({ userEmail }) {
  const [tab, setTab]       = useState('overview');
  const [overview, setOv]   = useState(null);
  const [logs, setLogs]     = useState(null);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState('');
  const [logPage, setLogPage] = useState(1);
  const [expandedLog, setExpandedLog] = useState(null);
  const [sportFilter, setSportFilter] = useState('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });

  const loadOverview = useCallback(async () => {
    setLoad(true); setError('');
    try {
      const url = `/api/admin/ai-lab?view=overview&from=${dateFrom}${sportFilter ? `&sport=${sportFilter}` : ''}`;
      const res = await adminFetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOv(data);
    } catch (e) { setError(e.message); }
    setLoad(false);
  }, [dateFrom, sportFilter]);

  const loadLogs = useCallback(async (page = 1) => {
    setLoad(true); setError('');
    try {
      const url = `/api/admin/ai-lab?view=logs&page=${page}&limit=30&from=${dateFrom}${sportFilter ? `&sport=${sportFilter}` : ''}`;
      const res = await adminFetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLogs(data);
      setLogPage(page);
    } catch (e) { setError(e.message); }
    setLoad(false);
  }, [dateFrom, sportFilter]);

  useEffect(() => {
    if (tab === 'overview') loadOverview();
    else if (tab === 'logs') loadLogs(1);
  }, [tab, loadOverview, loadLogs]);

  const subTabs = [
    { id: 'overview', label: 'Performance' },
    { id: 'logs',     label: 'Audit Logs' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Sub navigation */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {subTabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '0.4rem 0.85rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem',
            border: `1px solid ${tab === t.id ? 'rgba(168,85,247,0.6)' : 'var(--border)'}`,
            background: tab === t.id ? 'rgba(168,85,247,0.08)' : 'transparent',
            color: tab === t.id ? '#a855f7' : 'var(--text-muted)',
            fontWeight: tab === t.id ? 700 : 400,
          }}>{t.label}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <select value={sportFilter} onChange={e => setSportFilter(e.target.value)} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
            borderRadius: '6px', padding: '4px 8px', fontSize: '0.72rem',
          }}>
            <option value="">All Sports</option>
            {['mlb','nba','nhl','nfl','mls','wnba'].map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
            borderRadius: '6px', padding: '4px 8px', fontSize: '0.72rem',
          }} />
        </div>
      </div>

      {error && <div style={{ color: '#f87171', padding: '0.6rem', background: 'rgba(248,113,113,0.05)', borderRadius: '6px', fontSize: '0.78rem', border: '1px solid rgba(248,113,113,0.2)' }}>{error}</div>}

      {tab === 'overview' && overview && <OverviewView data={overview} loading={loading} />}
      {tab === 'logs' && logs && <LogsView data={logs} page={logPage} onPageChange={loadLogs} expanded={expandedLog} onToggle={id => setExpandedLog(expandedLog === id ? null : id)} loading={loading} />}
      {loading && !overview && !logs && <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Loading AI Lab data...</div>}
    </div>
  );
}

// ── Overview sub-view ─────────────────────────────────────────────────────────
function OverviewView({ data }) {
  const { record, byConf, bySport, byModel, byPrompt, byDate, performance, total, graded, ungraded } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Hero record */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.2rem' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>AI Analyzer Overall Record</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '2rem', fontWeight: 900, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)' }}>
            {record.wins}W - {record.losses}L
          </span>
          {record.pushes > 0 && <span style={{ fontSize: '1.1rem', color: '#facc15', fontWeight: 700 }}>{record.pushes}P</span>}
          {record.winPct !== null && (
            <span style={{ fontSize: '1.3rem', fontWeight: 800, color: record.winPct >= 55 ? '#4ade80' : record.winPct >= 50 ? '#facc15' : '#f87171' }}>
              {record.winPct}%
            </span>
          )}
        </div>
        <MiniBar wins={record.wins} losses={record.losses} pushes={record.pushes} />
        <div style={{ display: 'flex', gap: '1rem', marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          <span>{total} total analyses</span>
          <span>{graded} graded</span>
          <span>{ungraded} pending</span>
        </div>
      </div>

      {/* Grid: By Confidence + By Sport */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
        {/* By Confidence */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>By Confidence Level</div>
          {['ELITE', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].filter(c => byConf[c]).map(c => {
            const d = byConf[c];
            const wp = pct(d.wins, d.losses);
            return (
              <div key={c} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{
                  fontSize: '0.62rem', fontWeight: 700, width: '60px',
                  color: c === 'ELITE' ? '#a855f7' : c === 'HIGH' ? '#4ade80' : c === 'MEDIUM' ? '#facc15' : '#94a3b8',
                }}>{c}</span>
                <span style={{ fontSize: '0.75rem', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {d.wins}-{d.losses}{d.pushes > 0 ? `-${d.pushes}` : ''}
                </span>
                <span style={{ fontSize: '0.7rem', color: wp >= 55 ? '#4ade80' : wp >= 50 ? '#facc15' : '#f87171', fontWeight: 700, marginLeft: 'auto' }}>
                  {wp}%
                </span>
                <div style={{ width: '60px' }}><MiniBar wins={d.wins} losses={d.losses} pushes={d.pushes} /></div>
              </div>
            );
          })}
        </div>

        {/* By Sport */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>By Sport</div>
          {Object.entries(bySport).sort((a, b) => b[1].total - a[1].total).map(([sport, d]) => {
            const wp = pct(d.wins, d.losses);
            return (
              <div key={sport} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, width: '50px', color: 'var(--text-secondary)' }}>{sport}</span>
                <span style={{ fontSize: '0.75rem', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)', fontWeight: 600 }}>
                  {d.wins}-{d.losses}{d.pushes > 0 ? `-${d.pushes}` : ''}
                </span>
                <span style={{ fontSize: '0.7rem', color: wp >= 55 ? '#4ade80' : wp >= 50 ? '#facc15' : '#f87171', fontWeight: 700, marginLeft: 'auto' }}>
                  {wp}%
                </span>
                <div style={{ width: '60px' }}><MiniBar wins={d.wins} losses={d.losses} pushes={d.pushes} /></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Grid: By Model + By Prompt Version */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
        {/* By Model */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>By Model / Provider</div>
          {Object.entries(byModel).map(([model, d]) => {
            const wp = pct(d.wins, d.losses);
            return (
              <div key={model} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#60a5fa', flex: '0 0 auto' }}>{model}</span>
                <span style={{ fontSize: '0.75rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {d.wins}-{d.losses}
                </span>
                <span style={{ fontSize: '0.7rem', color: wp >= 55 ? '#4ade80' : '#facc15', fontWeight: 700, marginLeft: 'auto' }}>{wp}%</span>
              </div>
            );
          })}
        </div>

        {/* By Prompt Version */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>By Prompt Version</div>
          {Object.entries(byPrompt).map(([ver, d]) => {
            const wp = pct(d.wins, d.losses);
            return (
              <div key={ver} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#a855f7' }}>{ver}</span>
                <span style={{ fontSize: '0.75rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {d.wins}-{d.losses}{d.pushes > 0 ? `-${d.pushes}` : ''}
                </span>
                <span style={{ fontSize: '0.7rem', color: wp >= 55 ? '#4ade80' : '#facc15', fontWeight: 700, marginLeft: 'auto' }}>{wp}%</span>
              </div>
            );
          })}
          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '8px', fontStyle: 'italic' }}>
            Bump PROMPT_VERSION in pregenerate-analysis to track prompt changes
          </div>
        </div>
      </div>

      {/* Performance metrics */}
      {performance && (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>AI Performance Metrics</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Avg Latency</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)' }}>
                {performance.avgLatency ? `${(performance.avgLatency / 1000).toFixed(1)}s` : '-'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Avg Tokens In</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)' }}>
                {performance.avgTokensIn ? performance.avgTokensIn.toLocaleString() : '-'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>Avg Tokens Out</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-primary)' }}>
                {performance.avgTokensOut ? performance.avgTokensOut.toLocaleString() : '-'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Daily trend */}
      {byDate?.length > 1 && (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>Daily Win Rate Trend</div>
          <div style={{ display: 'flex', gap: '2px', alignItems: 'end', height: '60px' }}>
            {byDate.map((d, i) => {
              const wp = pct(d.wins, d.losses);
              const h = Math.max(4, (wp / 100) * 60);
              return (
                <div key={i} title={`${d.date}: ${d.wins}W-${d.losses}L (${wp}%)`} style={{
                  flex: 1, height: `${h}px`, borderRadius: '2px 2px 0 0',
                  background: wp >= 55 ? '#4ade80' : wp >= 50 ? '#facc15' : '#f87171',
                  opacity: 0.7, cursor: 'pointer', minWidth: '4px',
                }} />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '4px' }}>
            <span>{byDate[0]?.date}</span>
            <span>{byDate[byDate.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Logs sub-view ─────────────────────────────────────────────────────────────
function LogsView({ data, page, onPageChange, expanded, onToggle, loading }) {
  const { logs, totalPages } = data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
        {data.total} audit log entries - Page {page} of {totalPages}
      </div>

      {logs.map(log => (
        <div key={log.id} style={{
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px',
          overflow: 'hidden', transition: 'border 0.15s',
          ...(expanded === log.id ? { borderColor: 'rgba(168,85,247,0.4)' } : {}),
        }}>
          {/* Summary row */}
          <div onClick={() => onToggle(log.id)} style={{
            display: 'flex', alignItems: 'center', gap: '8px', padding: '0.6rem 0.8rem',
            cursor: 'pointer', fontSize: '0.76rem',
          }}>
            <span style={{ fontWeight: 700, color: 'var(--text-secondary)', width: '36px', textAlign: 'center', fontSize: '0.62rem', textTransform: 'uppercase' }}>
              {log.sport}
            </span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 500, flex: 1 }}>
              {log.away_team} @ {log.home_team}
            </span>
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{log.game_date}</span>
            {log.prediction_result && <WinBadge result={log.prediction_result} />}
            {log.parsed_conf && (
              <span style={{
                fontSize: '0.58rem', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                color: log.parsed_conf === 'ELITE' ? '#a855f7' : log.parsed_conf === 'HIGH' ? '#4ade80' : '#facc15',
                background: log.parsed_conf === 'ELITE' ? 'rgba(168,85,247,0.1)' : log.parsed_conf === 'HIGH' ? 'rgba(74,222,128,0.1)' : 'rgba(250,204,21,0.1)',
              }}>{log.parsed_conf}</span>
            )}
            <span style={{ fontSize: '0.58rem', color: '#60a5fa' }}>{log.model_used || '-'}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', transform: expanded === log.id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
              v
            </span>
          </div>

          {/* Expanded detail */}
          {expanded === log.id && (
            <div style={{ padding: '0 0.8rem 0.8rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '8px' }}>
              {/* Metadata grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '6px', fontSize: '0.68rem' }}>
                <MetaItem label="Model Requested" value={log.model_requested} />
                <MetaItem label="Model Used" value={log.model_used} />
                <MetaItem label="Provider" value={log.provider} />
                <MetaItem label="Fallback?" value={log.was_fallback ? 'Yes' : 'No'} />
                <MetaItem label="Prompt Version" value={log.prompt_version} />
                <MetaItem label="Latency" value={log.latency_ms ? `${(log.latency_ms / 1000).toFixed(1)}s` : '-'} />
                <MetaItem label="Tokens In" value={log.tokens_in?.toLocaleString() || '-'} />
                <MetaItem label="Tokens Out" value={log.tokens_out?.toLocaleString() || '-'} />
                <MetaItem label="Trigger" value={log.trigger_source} />
                <MetaItem label="Pick" value={log.parsed_pick} />
                <MetaItem label="Edge Score" value={log.parsed_edge} />
                <MetaItem label="Final Score" value={log.final_score} />
              </div>

              {/* Odds context */}
              {log.odds_context && (
                <details style={{ fontSize: '0.68rem' }}>
                  <summary style={{ color: '#60a5fa', cursor: 'pointer', fontWeight: 600 }}>Odds Context Fed to AI</summary>
                  <pre style={{ background: 'var(--bg-primary)', padding: '8px', borderRadius: '6px', whiteSpace: 'pre-wrap', color: 'var(--text-muted)', fontSize: '0.62rem', marginTop: '4px', maxHeight: '150px', overflow: 'auto' }}>
                    {log.odds_context}
                  </pre>
                </details>
              )}

              {/* User prompt */}
              {log.user_prompt && (
                <details style={{ fontSize: '0.68rem' }}>
                  <summary style={{ color: '#a855f7', cursor: 'pointer', fontWeight: 600 }}>User Prompt Sent</summary>
                  <pre style={{ background: 'var(--bg-primary)', padding: '8px', borderRadius: '6px', whiteSpace: 'pre-wrap', color: 'var(--text-muted)', fontSize: '0.62rem', marginTop: '4px', maxHeight: '200px', overflow: 'auto' }}>
                    {log.user_prompt}
                  </pre>
                </details>
              )}

              {/* System prompt */}
              {log.system_prompt && (
                <details style={{ fontSize: '0.68rem' }}>
                  <summary style={{ color: '#facc15', cursor: 'pointer', fontWeight: 600 }}>System Prompt (v{log.prompt_version})</summary>
                  <pre style={{ background: 'var(--bg-primary)', padding: '8px', borderRadius: '6px', whiteSpace: 'pre-wrap', color: 'var(--text-muted)', fontSize: '0.62rem', marginTop: '4px', maxHeight: '200px', overflow: 'auto' }}>
                    {log.system_prompt}
                  </pre>
                </details>
              )}

              {/* Full AI response */}
              {log.raw_response && (
                <details style={{ fontSize: '0.68rem' }}>
                  <summary style={{ color: '#4ade80', cursor: 'pointer', fontWeight: 600 }}>Full AI Response</summary>
                  <pre style={{ background: 'var(--bg-primary)', padding: '8px', borderRadius: '6px', whiteSpace: 'pre-wrap', color: 'var(--text-muted)', fontSize: '0.62rem', marginTop: '4px', maxHeight: '300px', overflow: 'auto' }}>
                    {log.raw_response}
                  </pre>
                </details>
              )}

              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', display: 'flex', gap: '10px' }}>
                <span>Run: {log.run_id || '-'}</span>
                <span>Created: {log.created_at ? new Date(log.created_at).toLocaleString() : '-'}</span>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '0.5rem' }}>
          <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} style={{
            padding: '4px 12px', borderRadius: '6px', fontSize: '0.72rem', cursor: page <= 1 ? 'default' : 'pointer',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: page <= 1 ? 'var(--text-muted)' : 'var(--text-secondary)',
            opacity: page <= 1 ? 0.4 : 1,
          }}>Prev</button>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '4px 8px' }}>{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} style={{
            padding: '4px 12px', borderRadius: '6px', fontSize: '0.72rem', cursor: page >= totalPages ? 'default' : 'pointer',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: page >= totalPages ? 'var(--text-muted)' : 'var(--text-secondary)',
            opacity: page >= totalPages ? 0.4 : 1,
          }}>Next</button>
        </div>
      )}
    </div>
  );
}

function MetaItem({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-primary)', fontWeight: 500, wordBreak: 'break-all' }}>{value || '-'}</div>
    </div>
  );
}
