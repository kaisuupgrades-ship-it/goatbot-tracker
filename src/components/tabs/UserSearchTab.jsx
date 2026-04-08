'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import PublicProfileModal from '../PublicProfileModal';

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

// ── Avatar (only shows uploaded photo when avatar_url is explicitly set) ─────
const AVATAR_BG_COLORS = [
  'rgba(99,102,241,0.25)', 'rgba(20,184,166,0.25)', 'rgba(245,158,11,0.22)',
  'rgba(239,68,68,0.22)',  'rgba(59,130,246,0.25)', 'rgba(168,85,247,0.22)',
  'rgba(16,185,129,0.22)', 'rgba(251,146,60,0.22)',
];
function UserSearchAvatar({ entry, size = 36 }) {
  const [imgErr, setImgErr] = useState(false);
  const hasPhoto = !!entry.avatar_url && !imgErr;

  function getBg() {
    const name = entry.username || entry.display_name || '';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffff;
    return AVATAR_BG_COLORS[Math.abs(h) % AVATAR_BG_COLORS.length];
  }
  function getInitials() {
    const name = entry.display_name || entry.username || '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: hasPhoto ? 'var(--bg-elevated)' : getBg(),
      border: '1px solid var(--border)',
    }}>
      {hasPhoto ? (
        <img src={entry.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setImgErr(true)} />
      ) : entry.avatar_emoji ? (
        <span style={{ fontSize: size * 0.55, lineHeight: 1, userSelect: 'none' }}>{entry.avatar_emoji}</span>
      ) : (
        <span style={{ fontSize: size * 0.38, fontWeight: 700, color: 'var(--text-primary)', userSelect: 'none' }}>{getInitials()}</span>
      )}
    </div>
  );
}

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


// ── UserCard row ─────────────────────────────────────────────────────────────
function UserCard({ entry, rank, currentUserId, onViewProfile }) {
  const isYou = entry.user_id === currentUserId;
  const roi = entry.roi ?? 0;
  const streak = entry.current_streak ?? 0;
  const roiColor = roi >= 0 ? '#4ade80' : '#f87171';
  const streakColor = streak > 0 ? '#4ade80' : streak < 0 ? '#f87171' : '#94a3b8';

  return (
    <div
      onClick={(e) => onViewProfile(entry, e)}
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

        {/* Avatar — only show uploaded photo if avatar_url is explicitly set */}
        <UserSearchAvatar entry={entry} />

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
              {entry.wins}W-{entry.losses}L{(entry.pushes ?? 0) > 0 ? `-${entry.pushes}P` : ''} · {entry.total} picks
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
  const [viewAnchor,  setViewAnchor]  = useState(null);
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
              onViewProfile={(entry, e) => { setViewProfile(entry); setViewAnchor(e ? { x: e.clientX, y: e.clientY } : null); }}
            />
          ))}
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        Only bettors with settled picks are shown. Click any row to view profile.
        {isDemo && ' (Demo data)'}
      </div>

      {/* Profile modal */}
      {viewProfile && (
        <PublicProfileModal
          entry={viewProfile}
          onClose={() => { setViewProfile(null); setViewAnchor(null); }}
          onOpenInbox={onOpenInbox}
          currentUser={user}
          anchorPos={viewAnchor}
        />
      )}
    </div>
  );
}
