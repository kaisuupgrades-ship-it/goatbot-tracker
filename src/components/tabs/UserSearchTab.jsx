'use client';
import { useState, useEffect, useCallback } from 'react';

// ── Sort presets ───────────────────────────────────────────────────────────────
const SORT_OPTIONS = [
  { id: 'hot7',       label: '🔥 Hot (Last 7d)',    desc: 'Most wins in the last 7 days' },
  { id: 'roi14',      label: '📈 Top ROI (14d)',     desc: 'Highest return on investment, last 14 days' },
  { id: 'streak',     label: '⚡ Best Streak',       desc: 'Longest current win streak' },
  { id: 'roi_all',    label: '💰 All-Time ROI',      desc: 'Best overall ROI, min 10 picks' },
  { id: 'record',     label: '🏅 Best Record',       desc: 'Highest win rate, min 10 picks' },
  { id: 'volume',     label: '📊 Most Active',       desc: 'Most picks logged overall' },
  { id: 'contest',    label: '🏆 Contest Leaders',   desc: 'Top performers in the current contest' },
];

const SPORT_FILTERS = ['All Sports', 'MLB', 'NBA', 'NFL', 'NHL', 'NCAAF', 'NCAAB', 'Soccer', 'UFC'];

function UserCard({ entry, rank, currentUserId }) {
  const isYou = entry.user_id === currentUserId;
  const roiColor = (entry.roi ?? 0) >= 0 ? '#4ade80' : '#f87171';
  const streakColor = (entry.current_streak ?? 0) > 0 ? '#4ade80' : (entry.current_streak ?? 0) < 0 ? '#f87171' : '#94a3b8';

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${isYou ? 'rgba(255,184,0,0.35)' : 'var(--border)'}`,
      borderLeft: `3px solid ${rank <= 3 ? ['#FFB800', '#94a3b8', '#cd7f32'][rank - 1] : 'var(--border)'}`,
      borderRadius: '10px',
      padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: '14px',
      transition: 'border-color 0.15s, box-shadow 0.15s',
    }}
    onMouseEnter={e => { e.currentTarget.style.borderColor = isYou ? 'rgba(255,184,0,0.6)' : 'rgba(96,165,250,0.3)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.3)'; }}
    onMouseLeave={e => { e.currentTarget.style.borderColor = isYou ? 'rgba(255,184,0,0.35)' : 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Rank */}
      <div style={{
        width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
        background: rank <= 3 ? ['rgba(255,184,0,0.15)', 'rgba(148,163,184,0.15)', 'rgba(205,127,50,0.15)'][rank - 1] : 'var(--bg-elevated)',
        border: `1px solid ${rank <= 3 ? ['rgba(255,184,0,0.4)', 'rgba(148,163,184,0.4)', 'rgba(205,127,50,0.4)'][rank - 1] : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.82rem',
        color: rank <= 3 ? ['#FFB800', '#94a3b8', '#cd7f32'][rank - 1] : 'var(--text-muted)',
      }}>
        {rank}
      </div>

      {/* Avatar */}
      <div style={{
        width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1rem', color: 'var(--text-muted)', overflow: 'hidden',
      }}>
        {entry.avatar_url
          ? <img src={entry.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : (entry.username?.[0]?.toUpperCase() || '?')}
      </div>

      {/* Name + badge */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{
            fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {entry.username || 'Anonymous'}
          </span>
          {isYou && (
            <span style={{
              fontSize: '0.62rem', color: 'var(--gold)',
              background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.3)',
              borderRadius: '4px', padding: '1px 5px', fontWeight: 700,
            }}>YOU</span>
          )}
          {entry.verified && (
            <span title="Verified record" style={{ fontSize: '0.75rem' }}>✓</span>
          )}
          {entry.sport_focus && (
            <span style={{
              fontSize: '0.62rem', color: '#60a5fa',
              background: 'rgba(96,165,250,0.1)', padding: '1px 5px', borderRadius: '4px',
            }}>{entry.sport_focus}</span>
          )}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
          {entry.wins ?? 0}W–{entry.losses ?? 0}L{(entry.pushes ?? 0) > 0 ? `–${entry.pushes}P` : ''} &nbsp;·&nbsp; {entry.total_picks ?? 0} picks
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '20px', flexShrink: 0 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>ROI</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.92rem', color: roiColor }}>
            {(entry.roi ?? 0) >= 0 ? '+' : ''}{(entry.roi ?? 0).toFixed(1)}%
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>Units</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.92rem', color: (entry.units ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>
            {(entry.units ?? 0) >= 0 ? '+' : ''}{(entry.units ?? 0).toFixed(2)}u
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>Streak</div>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.92rem', color: streakColor }}>
            {(entry.current_streak ?? 0) > 0 ? `W${entry.current_streak}` : (entry.current_streak ?? 0) < 0 ? `L${Math.abs(entry.current_streak)}` : '—'}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UserSearchTab({ user, isDemo }) {
  const [sort, setSort]               = useState('hot7');
  const [sportFilter, setSportFilter] = useState('All Sports');
  const [search, setSearch]           = useState('');
  const [entries, setEntries]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ sort });
      if (sportFilter !== 'All Sports') params.set('sport', sportFilter);
      if (isDemo) params.set('demo', '1');
      const res  = await fetch(`/api/leaderboard?${params.toString()}`);
      const json = await res.json();
      if (json.error && !json.leaderboard) throw new Error(json.error);
      setEntries(json.leaderboard || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sort, sportFilter, isDemo]);

  useEffect(() => { load(); }, [load]);

  // Client-side search filter
  const filtered = search.trim()
    ? entries.filter(e => (e.username || '').toLowerCase().includes(search.trim().toLowerCase()))
    : entries;

  const selectedSort = SORT_OPTIONS.find(o => o.id === sort);

  return (
    <div className="fade-in">
      {/* Header */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f0f0f0', marginBottom: '4px' }}>
          🔍 User Search
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          Find the sharpest bettors in the community — filter by sport, sort by performance, and see who's running hot.
        </p>
      </div>

      {/* Sort presets */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {SORT_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => setSort(opt.id)}
            title={opt.desc}
            style={{
              padding: '5px 12px', borderRadius: '20px', fontSize: '0.78rem', cursor: 'pointer',
              border: `1px solid ${sort === opt.id ? 'var(--gold)' : 'var(--border)'}`,
              background: sort === opt.id ? 'rgba(255,184,0,0.1)' : 'var(--bg-surface)',
              color: sort === opt.id ? 'var(--gold)' : 'var(--text-secondary)',
              fontWeight: sort === opt.id ? 700 : 400,
              transition: 'all 0.15s',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Sport filter + search */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {SPORT_FILTERS.map(s => (
          <button
            key={s}
            onClick={() => setSportFilter(s)}
            style={{
              padding: '4px 10px', borderRadius: '6px', fontSize: '0.74rem', cursor: 'pointer',
              border: `1px solid ${sportFilter === s ? 'rgba(96,165,250,0.6)' : 'var(--border)'}`,
              background: sportFilter === s ? 'rgba(96,165,250,0.1)' : 'transparent',
              color: sportFilter === s ? '#60a5fa' : 'var(--text-muted)',
              fontWeight: sportFilter === s ? 700 : 400,
            }}
          >{s}</button>
        ))}
        <input
          type="text"
          placeholder="Search by username…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input"
          style={{ marginLeft: 'auto', width: '180px', padding: '5px 10px', fontSize: '0.8rem' }}
        />
      </div>

      {/* Sort description */}
      {selectedSort && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem', fontStyle: 'italic' }}>
          {selectedSort.desc}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading community rankings…
        </div>
      ) : error ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: '#f87171' }}>
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          No bettors found. Try a different filter or search.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map((entry, i) => (
            <UserCard
              key={entry.user_id || i}
              entry={entry}
              rank={i + 1}
              currentUserId={user?.id}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        Only bettors with public picks and 5+ verified picks are shown.
        {isDemo && ' (Showing demo data)'}
      </div>
    </div>
  );
}
