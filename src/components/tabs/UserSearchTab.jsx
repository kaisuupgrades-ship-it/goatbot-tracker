'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ── Sort options (independent of date range) ──────────────────────────────────
const SORT_OPTIONS = [
  { id: 'hot',    label: '🔥 Hot',         desc: 'Most wins in selected period' },
  { id: 'roi',    label: '📈 Top ROI',      desc: 'Best return on investment' },
  { id: 'streak', label: '⚡ Best Streak',  desc: 'Longest current win streak' },
  { id: 'units',  label: '💰 Most Units',   desc: 'Highest unit profit' },
  { id: 'record', label: '🏅 Best Record',  desc: 'Highest win rate' },
  { id: 'volume', label: '📊 Most Active',  desc: 'Most picks logged' },
];

// ── Date range presets ─────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { id: '7',   label: '7d' },
  { id: '14',  label: '14d' },
  { id: '30',  label: '30d' },
  { id: '90',  label: '90d' },
  { id: '0',   label: 'All Time' },
  { id: 'custom', label: '📅 Custom' },
];

const SPORT_FILTERS = ['All Sports', 'MLB', 'NBA', 'NFL', 'NHL', 'NCAAF', 'NCAAB', 'Soccer', 'UFC'];

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

// ── W/L/P icon strip ─────────────────────────────────────────────────────────
function ResultStrip({ results = [] }) {
  if (!results.length) return null;
  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center', flexShrink: 0 }}>
      {results.map((r, i) => (
        <div
          key={i}
          title={r}
          style={{
            width: '16px', height: '16px', borderRadius: '3px', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.55rem', fontWeight: 800, letterSpacing: 0,
            background:
              r === 'WIN'  ? 'rgba(74,222,128,0.15)' :
              r === 'LOSS' ? 'rgba(248,113,113,0.15)' :
              'rgba(148,163,184,0.15)',
            color:
              r === 'WIN'  ? '#4ade80' :
              r === 'LOSS' ? '#f87171' :
              '#94a3b8',
            border: `1px solid ${
              r === 'WIN'  ? 'rgba(74,222,128,0.25)' :
              r === 'LOSS' ? 'rgba(248,113,113,0.25)' :
              'rgba(148,163,184,0.25)'
            }`,
          }}
        >
          {r === 'WIN' ? 'W' : r === 'LOSS' ? 'L' : 'P'}
        </div>
      ))}
    </div>
  );
}

// ── User profile modal — fetches real picks ────────────────────────────────────
function UserProfileModal({ entry, currentUserId, onClose, onOpenInbox }) {
  const [following,     setFollowing]     = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [profileData,   setProfileData]   = useState(null);
  const [loadingPicks,  setLoadingPicks]  = useState(true);
  const [activeTab,     setActiveTab]     = useState('picks'); // 'picks' | 'breakdown'

  const isMe = entry.user_id === currentUserId;

  // Check follow status
  useEffect(() => {
    if (!currentUserId || !entry.user_id || isMe) return;
    fetch(`/api/follow?followerId=${currentUserId}&followingId=${entry.user_id}`)
      .then(r => r.json()).then(d => setFollowing(d.following || false)).catch(() => {});
  }, [currentUserId, entry.user_id, isMe]);

  // Fetch real profile data
  useEffect(() => {
    if (!entry.user_id) { setLoadingPicks(false); return; }
    fetch(`/api/public-profile?userId=${entry.user_id}`)
      .then(r => r.json()).then(d => { setProfileData(d); setLoadingPicks(false); })
      .catch(() => setLoadingPicks(false));
  }, [entry.user_id]);

  const toggleFollow = async () => {
    if (!currentUserId || followLoading) return;
    setFollowLoading(true);
    try {
      await fetch('/api/follow', {
        method: following ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ followerId: currentUserId, followingId: entry.user_id }),
      });
      setFollowing(f => !f);
    } finally { setFollowLoading(false); }
  };

  // Prefer fetched stats, fall back to search entry stats
  const stats  = profileData?.stats;
  const picks  = profileData?.settled_picks || [];
  const sports = profileData?.sport_breakdown || [];

  const wins   = stats?.wins   ?? entry.wins   ?? 0;
  const losses = stats?.losses ?? entry.losses ?? 0;
  const pushes = stats?.pushes ?? entry.pushes ?? 0;
  const total  = stats?.total  ?? entry.total  ?? 0;
  const units  = stats?.units  ?? entry.units  ?? 0;
  const roi    = stats?.roi    ?? entry.roi    ?? 0;
  const pendingCount = stats?.pending_count ?? 0;
  const winPct = total > 0 ? ((wins / total) * 100).toFixed(0) : '—';

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '16px',
        width: '100%', maxWidth: '520px', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)', overflow: 'hidden',
      }}>
        {/* Gold shimmer top bar */}
        <div style={{ height: '3px', flexShrink: 0, background: 'linear-gradient(90deg, transparent, #FFB800 30%, #FFD700 50%, #FF9500 70%, transparent)', backgroundSize: '200% auto', animation: 'prize-shimmer 2.5s linear infinite' }} />

        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid var(--border)', background: 'linear-gradient(180deg, rgba(255,184,0,0.04) 0%, transparent 100%)', flexShrink: 0 }}>
          {/* Avatar */}
          <div style={{ width: '52px', height: '52px', borderRadius: '50%', flexShrink: 0, background: 'var(--bg-elevated)', border: '2px solid rgba(255,184,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', overflow: 'hidden', position: 'relative' }}>
            {SUPABASE_URL && <img src={`${SUPABASE_URL}/storage/v1/object/public/avatars/${entry.user_id}.jpg`} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />}
            <span style={{ position: 'relative', zIndex: 1 }}>{entry.avatar_emoji || '🎯'}</span>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>{entry.display_name || entry.username}</div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
              @{entry.username}
              {entry.sport_focus && <span style={{ marginLeft: '8px', color: '#60a5fa', fontSize: '0.7rem' }}>{entry.sport_focus} focused</span>}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
            {!isMe && currentUserId && (
              <>
                <button onClick={toggleFollow} disabled={followLoading} style={{
                  padding: '5px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700,
                  cursor: followLoading ? 'default' : 'pointer',
                  background: following ? 'rgba(74,222,128,0.12)' : 'rgba(255,184,0,0.12)',
                  border: `1px solid ${following ? 'rgba(74,222,128,0.4)' : 'rgba(255,184,0,0.4)'}`,
                  color: following ? '#4ade80' : 'var(--gold)', transition: 'all 0.15s',
                }}>
                  {following ? '✓ Following' : '+ Follow'}
                </button>
                {onOpenInbox && (
                  <button
                    onClick={() => { onClose(); onOpenInbox({ id: entry.user_id, username: entry.username, display_name: entry.display_name, avatar_emoji: entry.avatar_emoji }); }}
                    style={{
                      padding: '5px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700,
                      background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.35)',
                      color: '#60a5fa', cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    💬 Message
                  </button>
                )}
              </>
            )}
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1, padding: '2px' }}>×</button>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1px', background: 'var(--border)', flexShrink: 0 }}>
          {[
            { label: 'Record', value: `${wins}–${losses}${pushes > 0 ? `–${pushes}P` : ''}` },
            { label: 'Win %',  value: winPct === '—' ? '—' : `${winPct}%`, color: parseInt(winPct) >= 55 ? '#4ade80' : undefined },
            { label: 'Units',  value: `${units >= 0 ? '+' : ''}${units.toFixed(2)}u`, color: units >= 0 ? '#4ade80' : '#f87171' },
            { label: 'ROI',    value: `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`, color: roi >= 0 ? '#4ade80' : '#f87171' },
            { label: 'Picks',  value: String(total) },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--bg-elevated)', padding: '10px 6px', textAlign: 'center' }}>
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>{s.label}</div>
              <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.88rem', color: s.color || 'var(--text-primary)' }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {[{ id: 'picks', label: '📋 Pick History' }, { id: 'breakdown', label: '📊 Breakdown' }].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
              flex: 1, padding: '0.6rem', border: 'none', cursor: 'pointer',
              background: activeTab === t.id ? 'var(--bg-elevated)' : 'transparent',
              color: activeTab === t.id ? 'var(--gold)' : 'var(--text-muted)',
              fontSize: '0.76rem', fontWeight: activeTab === t.id ? 700 : 400,
              borderBottom: activeTab === t.id ? '2px solid var(--gold)' : '2px solid transparent',
              transition: 'all 0.15s',
            }}>{t.label}</button>
          ))}
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
          {/* ── Pick History ── */}
          {activeTab === 'picks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {loadingPicks && [...Array(3)].map((_, i) => (
                <div key={i} style={{ height: '50px', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)', animation: 'pulse 1.4s ease-in-out infinite', opacity: 1 - i * 0.25 }} />
              ))}

              {/* Blurred pending */}
              {!loadingPicks && pendingCount > 0 && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '5px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span>⏳ Active ({pendingCount})</span>
                    <span style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '4px', padding: '1px 5px' }}>🔒 Hidden until settled</span>
                  </div>
                  {[...Array(Math.min(pendingCount, 2))].map((_, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.6rem 0.8rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '7px', marginBottom: '4px', filter: 'blur(4px)', userSelect: 'none' }}>
                      <span style={{ fontSize: '0.65rem', color: '#60a5fa', fontWeight: 700, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '4px', padding: '1px 5px' }}>LIVE</span>
                      <span style={{ flex: 1, fontSize: '0.8rem', fontWeight: 600 }}>████ @ ████</span>
                    </div>
                  ))}
                </div>
              )}

              {!loadingPicks && picks.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>No settled public picks yet.</div>
              )}

              {!loadingPicks && picks.length > 0 && (
                <>
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '4px' }}>Settled ({picks.length})</div>
                  {picks.map(p => {
                    const rc = p.result === 'WIN' ? 'var(--green)' : p.result === 'PUSH' ? '#94a3b8' : 'var(--red)';
                    const oddsNum = parseInt(p.odds);
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.55rem 0.8rem', background: 'var(--bg-elevated)', border: `1px solid ${p.result === 'WIN' ? 'rgba(74,222,128,0.15)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.1)' : 'rgba(255,69,96,0.12)'}`, borderRadius: '8px', borderLeft: `3px solid ${rc}` }}>
                        <span style={{ fontSize: '0.6rem', fontWeight: 800, padding: '2px 5px', borderRadius: '4px', color: rc, background: p.result === 'WIN' ? 'rgba(74,222,128,0.12)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.08)' : 'rgba(255,69,96,0.1)', border: `1px solid ${p.result === 'WIN' ? 'rgba(74,222,128,0.3)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.25)' : 'rgba(255,69,96,0.25)'}`, minWidth: '22px', textAlign: 'center', flexShrink: 0 }}>
                          {p.result === 'WIN' ? 'W' : p.result === 'PUSH' ? 'P' : 'L'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0 4px', fontWeight: 700 }}>{p.sport}</span>
                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.team} — {p.bet_type || 'ML'}</span>
                            {p.verified && <span style={{ fontSize: '0.58rem', color: '#4ade80', fontWeight: 700, flexShrink: 0 }}>✓</span>}
                          </div>
                          {p.notes && <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.notes}</div>}
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>{new Date(p.created_at).toLocaleDateString()}</div>
                        </div>
                        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>{!isNaN(oddsNum) ? (oddsNum > 0 ? `+${oddsNum}` : oddsNum) : '—'}</span>
                        {p.profit !== null && (
                          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.78rem', fontWeight: 700, color: p.profit >= 0 ? 'var(--green)' : 'var(--red)', minWidth: '44px', textAlign: 'right', flexShrink: 0 }}>
                            {p.profit >= 0 ? '+' : ''}{p.profit.toFixed(2)}u
                          </span>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ── Breakdown ── */}
          {activeTab === 'breakdown' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Recent form */}
              {picks.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '7px', fontWeight: 700 }}>
                    Recent Form (last {Math.min(picks.length, 10)})
                  </div>
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {picks.slice(0, 10).map((p, i) => (
                      <div key={i} style={{
                        width: '30px', height: '30px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: p.result === 'WIN' ? 'rgba(0,212,139,0.15)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.1)' : 'rgba(255,69,96,0.15)',
                        border: `1px solid ${p.result === 'WIN' ? 'rgba(0,212,139,0.35)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.3)' : 'rgba(255,69,96,0.35)'}`,
                        fontSize: '0.65rem', fontWeight: 800, color: p.result === 'WIN' ? 'var(--green)' : p.result === 'PUSH' ? '#94a3b8' : 'var(--red)',
                      }}>
                        {p.result === 'WIN' ? 'W' : p.result === 'PUSH' ? 'P' : 'L'}
                      </div>
                    ))}
                    <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', paddingLeft: '3px' }}>← most recent</span>
                  </div>
                </div>
              )}

              {/* Sport breakdown */}
              {sports.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '7px', fontWeight: 700 }}>By Sport</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    {sports.map(({ sport, wins: sw, losses: sl }) => {
                      const wr = sw + sl > 0 ? (sw / (sw + sl)) * 100 : 0;
                      return (
                        <div key={sport} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', minWidth: '44px' }}>{sport}</span>
                          <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', minWidth: '42px' }}>{sw}–{sl}</span>
                          <div style={{ flex: 1, height: '5px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: '3px', width: `${wr}%`, background: wr >= 55 ? 'var(--green)' : wr >= 45 ? '#fbbf24' : 'var(--red)', transition: 'width 0.5s ease' }} />
                          </div>
                          <span style={{ fontSize: '0.67rem', fontFamily: 'IBM Plex Mono', color: wr >= 55 ? 'var(--green)' : 'var(--text-muted)', minWidth: '36px', textAlign: 'right' }}>{wr.toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {loadingPicks && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem' }}>Loading stats…</div>}
              {!loadingPicks && picks.length === 0 && sports.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem' }}>No public pick data yet.</div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '0.65rem 1.25rem', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '0.7rem' }}>🔒</span>
          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Pending picks hidden until settled. Only public picks shown.</span>
        </div>
      </div>
    </div>
  );
}

// ── UserCard row ─────────────────────────────────────────────────────────────
function UserCard({ entry, rank, currentUserId, onViewProfile }) {
  const isYou = entry.user_id === currentUserId;
  const roi = entry.roi ?? 0;
  const streak = entry.current_streak ?? 0;
  const roiColor = roi >= 0 ? '#4ade80' : '#f87171';
  const streakColor = streak > 0 ? '#4ade80' : streak < 0 ? '#f87171' : '#94a3b8';

  return (
    <div
      onClick={() => onViewProfile(entry)}
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${isYou ? 'rgba(255,184,0,0.35)' : 'var(--border)'}`,
        borderLeft: `3px solid ${rank <= 3 ? ['#FFB800','#94a3b8','#cd7f32'][rank-1] : 'var(--border)'}`,
        borderRadius: '10px', cursor: 'pointer',
        padding: '12px 16px',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = isYou ? 'rgba(255,184,0,0.6)' : 'rgba(96,165,250,0.35)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.3)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = isYou ? 'rgba(255,184,0,0.35)' : 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {/* Rank badge */}
        <div style={{
          width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0,
          background: rank <= 3 ? ['rgba(255,184,0,0.15)','rgba(148,163,184,0.15)','rgba(205,127,50,0.15)'][rank-1] : 'var(--bg-elevated)',
          border: `1px solid ${rank <= 3 ? ['rgba(255,184,0,0.4)','rgba(148,163,184,0.4)','rgba(205,127,50,0.4)'][rank-1] : 'var(--border)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.78rem',
          color: rank <= 3 ? ['#FFB800','#94a3b8','#cd7f32'][rank-1] : 'var(--text-muted)',
        }}>
          {rank}
        </div>

        {/* Avatar */}
        <div style={{
          width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem', overflow: 'hidden', position: 'relative',
        }}>
          {SUPABASE_URL
            ? <img src={`${SUPABASE_URL}/storage/v1/object/public/avatars/${entry.user_id}.jpg`}
                alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0 }}
                onError={e => { e.target.style.display = 'none'; }}
              />
            : null}
          <span style={{ position: 'relative', zIndex: 1 }}>{entry.avatar_emoji || (entry.username?.[0]?.toUpperCase() || '?')}</span>
        </div>

        {/* Name + record + strip — flex grow */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {entry.display_name || entry.username || 'Anonymous'}
            </span>
            {isYou && (
              <span style={{ fontSize: '0.6rem', color: 'var(--gold)', background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.3)', borderRadius: '4px', padding: '1px 5px', fontWeight: 700 }}>
                YOU
              </span>
            )}
            {entry.sport_focus && (
              <span style={{ fontSize: '0.6rem', color: '#60a5fa', background: 'rgba(96,165,250,0.1)', padding: '1px 5px', borderRadius: '4px', flexShrink: 0 }}>
                {entry.sport_focus}
              </span>
            )}
          </div>

          {/* Record text + W/L strip */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
              {entry.wins}W–{entry.losses}L{(entry.pushes ?? 0) > 0 ? `–${entry.pushes}P` : ''} · {entry.total} picks
            </span>
            <ResultStrip results={entry.recent_results || []} />
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '16px', flexShrink: 0, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.56rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>ROI</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.88rem', color: roiColor }}>
              {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '0.56rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Units</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.88rem', color: (entry.units ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>
              {(entry.units ?? 0) >= 0 ? '+' : ''}{(entry.units ?? 0).toFixed(2)}u
            </div>
          </div>
          <div style={{ textAlign: 'right', minWidth: '36px' }}>
            <div style={{ fontSize: '0.56rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Streak</div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.88rem', color: streakColor }}>
              {streak > 0 ? `W${streak}` : streak < 0 ? `L${Math.abs(streak)}` : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function UserSearchTab({ user, isDemo, onOpenInbox }) {
  const [sort, setSort]               = useState('hot');
  const [datePreset, setDatePreset]   = useState('7');
  const [dateFrom, setDateFrom]       = useState('');
  const [dateTo, setDateTo]           = useState('');
  const [sportFilter, setSportFilter] = useState('All Sports');
  const [search, setSearch]           = useState('');
  const [entries, setEntries]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [viewProfile, setViewProfile] = useState(null);
  const debounceRef = useRef(null);

  const load = useCallback(async (overrides = {}) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      const _sort       = overrides.sort        ?? sort;
      const _preset     = overrides.datePreset  ?? datePreset;
      const _dateFrom   = overrides.dateFrom    ?? dateFrom;
      const _dateTo     = overrides.dateTo      ?? dateTo;
      const _sport      = overrides.sportFilter ?? sportFilter;

      params.set('sort', _sort);
      if (_preset === 'custom') {
        if (_dateFrom) params.set('dateFrom', _dateFrom);
        if (_dateTo)   params.set('dateTo',   _dateTo);
      } else {
        params.set('days', _preset);
      }
      if (_sport && _sport !== 'All Sports') params.set('sport', _sport);
      if (isDemo) params.set('demo', '1');

      const res  = await fetch(`/api/user-search?${params}`);
      const json = await res.json();
      if (json.error && !json.entries) throw new Error(json.error);
      setEntries(json.entries || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sort, datePreset, dateFrom, dateTo, sportFilter, isDemo]);

  useEffect(() => { load(); }, [load]);

  // Custom date range: auto-load after user finishes typing
  useEffect(() => {
    if (datePreset !== 'custom') return;
    if (!dateFrom || !dateTo) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load({ datePreset: 'custom', dateFrom, dateTo }), 500);
    return () => clearTimeout(debounceRef.current);
  }, [dateFrom, dateTo]); // eslint-disable-line

  const handleSort = (s) => { setSort(s); load({ sort: s }); };
  const handlePreset = (p) => {
    setDatePreset(p);
    if (p !== 'custom') load({ datePreset: p });
  };
  const handleSport = (s) => { setSportFilter(s); load({ sportFilter: s }); };

  const filtered = search.trim()
    ? entries.filter(e => (e.username || '').toLowerCase().includes(search.trim().toLowerCase()) || (e.display_name || '').toLowerCase().includes(search.trim().toLowerCase()))
    : entries;

  const selectedSort = SORT_OPTIONS.find(o => o.id === sort);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Header */}
      <div>
        <h2 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f0f0f0', marginBottom: '2px' }}>
          🔍 User Search
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', margin: 0 }}>
          Find the sharpest bettors — filter by sport, date range, and performance.
        </p>
      </div>

      {/* Sort pills */}
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => handleSort(opt.id)}
            title={opt.desc}
            style={{
              padding: '5px 11px', borderRadius: '20px', fontSize: '0.77rem', cursor: 'pointer',
              border: `1px solid ${sort === opt.id ? 'var(--gold)' : 'var(--border)'}`,
              background: sort === opt.id ? 'rgba(255,184,0,0.1)' : 'var(--bg-surface)',
              color: sort === opt.id ? 'var(--gold)' : 'var(--text-secondary)',
              fontWeight: sort === opt.id ? 700 : 400,
              transition: 'all 0.15s',
            }}
          >{opt.label}</button>
        ))}
      </div>

      {/* Date range row */}
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginRight: '2px' }}>Range:</span>
        {DATE_PRESETS.map(p => (
          <button
            key={p.id}
            onClick={() => handlePreset(p.id)}
            style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '0.74rem', cursor: 'pointer',
              border: `1px solid ${datePreset === p.id ? 'rgba(96,165,250,0.6)' : 'var(--border)'}`,
              background: datePreset === p.id ? 'rgba(96,165,250,0.12)' : 'transparent',
              color: datePreset === p.id ? '#60a5fa' : 'var(--text-muted)',
              fontWeight: datePreset === p.id ? 700 : 400,
              transition: 'all 0.15s',
            }}
          >{p.label}</button>
        ))}

        {/* Custom date inputs */}
        {datePreset === 'custom' && (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: '4px' }}>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{ padding: '3px 8px', fontSize: '0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer' }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>→</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{ padding: '3px 8px', fontSize: '0.75rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer' }}
            />
          </div>
        )}
      </div>

      {/* Sport filter + search */}
      <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
        {SPORT_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => handleSport(s)}
            style={{
              padding: '3px 9px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
              border: `1px solid ${sportFilter === s ? 'rgba(255,184,0,0.5)' : 'var(--border)'}`,
              background: sportFilter === s ? 'rgba(255,184,0,0.08)' : 'transparent',
              color: sportFilter === s ? 'var(--gold)' : 'var(--text-muted)',
              fontWeight: sportFilter === s ? 700 : 400,
              transition: 'all 0.15s',
            }}
          >{s}</button>
        ))}
        <input
          type="text"
          placeholder="Search username…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ marginLeft: 'auto', width: '165px', padding: '4px 10px', fontSize: '0.78rem', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
        />
      </div>

      {/* Sort description */}
      {selectedSort && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '-4px' }}>
          {selectedSort.desc}
          {datePreset !== 'custom' && datePreset !== '0' && ` · last ${datePreset} days`}
          {datePreset === 'custom' && dateFrom && dateTo && ` · ${dateFrom} → ${dateTo}`}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ height: '64px', background: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border)', opacity: 1 - i * 0.15, animation: 'pulse 1.5s ease-in-out infinite' }} />
          ))}
        </div>
      ) : error ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#f87171', fontSize: '0.85rem' }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '3rem 2rem', textAlign: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔍</div>
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>No bettors found</div>
          <div style={{ fontSize: '0.78rem' }}>Try a wider date range or different filter.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {filtered.map((entry, i) => (
            <UserCard
              key={entry.user_id || i}
              entry={entry}
              rank={i + 1}
              currentUserId={user?.id}
              onViewProfile={setViewProfile}
            />
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        Only bettors with public settled picks are shown. Click any row to view profile.
        {isDemo && ' (Demo data)'}
      </div>

      {/* Profile modal */}
      {viewProfile && (
        <UserProfileModal
          entry={viewProfile}
          currentUserId={user?.id}
          onClose={() => setViewProfile(null)}
          onOpenInbox={onOpenInbox}
        />
      )}
    </div>
  );
}
