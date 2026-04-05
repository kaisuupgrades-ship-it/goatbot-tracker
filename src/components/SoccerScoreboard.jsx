'use client';
import { useState, useEffect, useCallback } from 'react';

// ── Mobile breakpoint hook ────────────────────────────────────────────────────
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    function check() { setIsMobile(window.innerWidth <= breakpoint); }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return isMobile;
}

// ── League options ────────────────────────────────────────────────────────────
const LEAGUES = [
  { id: 'usa.1',          label: 'MLS',            short: 'MLS', flag: '🇺🇸' },
  { id: 'eng.1',          label: 'Premier League', short: 'EPL', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 'esp.1',          label: 'La Liga',        short: 'ESP', flag: '🇪🇸' },
  { id: 'ger.1',          label: 'Bundesliga',     short: 'GER', flag: '🇩🇪' },
  { id: 'ita.1',          label: 'Serie A',        short: 'ITA', flag: '🇮🇹' },
  { id: 'fra.1',          label: 'Ligue 1',        short: 'FRA', flag: '🇫🇷' },
  { id: 'uefa.champions', label: 'Champions Lg',   short: 'UCL', flag: '⭐' },
];

// ── Single match card — Flashscore-style ─────────────────────────────────────
function MatchCard({ match }) {
  const comp        = match.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const away        = competitors.find(c => c.homeAway === 'away') || competitors[0] || {};
  const home        = competitors.find(c => c.homeAway === 'home') || competitors[1] || {};

  const status      = comp.status?.type;
  const isLive      = status?.state === 'in';
  const isFinal     = status?.state === 'post';
  const isPre       = status?.state === 'pre';
  const clockLabel  = status?.shortDetail || (isLive ? 'LIVE' : isFinal ? 'FT' : '');

  // Kickoff time
  const matchDate   = comp.date ? new Date(comp.date) : null;
  const kickTime    = matchDate ? matchDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const kickDay     = matchDate ? matchDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  const awayScore   = away.score != null ? String(away.score) : null;
  const homeScore   = home.score != null ? String(home.score) : null;
  const awayWin     = isFinal && parseInt(awayScore) > parseInt(homeScore);
  const homeWin     = isFinal && parseInt(homeScore) > parseInt(awayScore);
  const isDraw      = isFinal && parseInt(awayScore) === parseInt(homeScore);

  const awayName    = away.team?.displayName || away.team?.name || 'Away';
  const homeName    = home.team?.displayName || home.team?.name || 'Home';
  const awayLogo    = away.team?.logo;
  const homeLogo    = home.team?.logo;
  const venue       = comp.venue?.fullName || '';

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${isLive ? 'rgba(74,222,128,0.3)' : 'var(--border)'}`,
      borderRadius: '8px',
      overflow: 'hidden',
      boxShadow: isLive ? '0 2px 10px rgba(74,222,128,0.07)' : 'none',
      transition: 'border-color 0.15s',
    }}>
      {/* ── Status bar ── */}
      <div style={{
        padding: '4px 10px',
        background: isLive ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.015)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px',
      }}>
        {/* Left: clock / status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {isLive && (
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: '#4ade80', boxShadow: '0 0 4px #4ade80',
              display: 'inline-block', animation: 'live-pulse 1.5s ease-in-out infinite',
            }} />
          )}
          <span style={{
            fontSize: '0.65rem', fontWeight: 700,
            fontFamily: 'IBM Plex Mono, monospace',
            color: isLive ? '#4ade80' : isFinal ? '#94a3b8' : '#60a5fa',
          }}>
            {isLive ? clockLabel : isFinal ? 'FT' : isPre ? kickDay || 'Upcoming' : clockLabel}
          </span>
        </div>
        {/* Right: kickoff time for upcoming, venue for live/final */}
        {isPre && kickTime ? (
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#60a5fa', fontFamily: 'IBM Plex Mono' }}>
            {kickTime}
          </span>
        ) : venue ? (
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>
            📍 {venue}
          </span>
        ) : null}
      </div>

      {/* ── Match rows (away / home) ── */}
      <div style={{ padding: '8px 10px' }}>
        {[
          { name: awayName, logo: awayLogo, score: awayScore, won: awayWin },
          { name: homeName, logo: homeLogo, score: homeScore, won: homeWin },
        ].map((side, idx) => (
          <div key={idx} style={{
            display: 'grid',
            gridTemplateColumns: '22px 1fr auto',
            alignItems: 'center',
            gap: '8px',
            paddingTop: idx === 1 ? '6px' : 0,
            paddingBottom: idx === 0 ? '6px' : 0,
            borderTop: idx === 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            opacity: isFinal && !side.won && !isDraw ? 0.5 : 1,
          }}>
            {/* Team logo */}
            <div style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {side.logo ? (
                <img src={side.logo} alt="" style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                  onError={e => { e.target.style.display = 'none'; }} />
              ) : (
                <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>⚽</span>
              )}
            </div>
            {/* Team name */}
            <div style={{
              fontSize: '0.85rem',
              fontWeight: side.won || (isLive && idx === 0) ? 700 : 500,
              color: side.won ? 'var(--text-primary)' : 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {side.name}
            </div>
            {/* Score */}
            <div style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontWeight: 800,
              fontSize: '1rem',
              minWidth: '20px',
              textAlign: 'right',
              color: isLive ? '#4ade80'
                : side.won ? '#4ade80'
                : isDraw ? '#FFB800'
                : (isFinal ? 'var(--text-secondary)' : 'var(--text-muted)'),
            }}>
              {(isLive || isFinal) && side.score != null ? side.score : '—'}
            </div>
          </div>
        ))}

        {/* Upcoming: show kickoff pill */}
        {isPre && (kickDay || kickTime) && (
          <div style={{ marginTop: '6px', textAlign: 'center' }}>
            <span style={{
              fontSize: '0.72rem', color: '#60a5fa', fontWeight: 600,
              background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.18)',
              borderRadius: '20px', padding: '2px 10px', display: 'inline-block',
            }}>
              {kickDay}{kickTime ? ` · ${kickTime}` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SoccerScoreboard() {
  const [league, setLeague]   = useState('usa.1');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [filter, setFilter]   = useState('all');
  const isMobile              = useIsMobile();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`/api/sports?sport=soccer&league=${league}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load soccer data');
    } finally {
      setLoading(false);
    }
  }, [league]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 45 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const allMatches = data?.events || [];

  // Filter by status
  const filtered = allMatches.filter(m => {
    const state = m.competitions?.[0]?.status?.type?.state;
    if (filter === 'live')     return state === 'in';
    if (filter === 'final')    return state === 'post';
    if (filter === 'upcoming') return state === 'pre';
    return true;
  });

  // Sort: live → upcoming (by time) → final
  const sorted = [...filtered].sort((a, b) => {
    const order = { in: 0, pre: 1, post: 2 };
    const sa = order[a.competitions?.[0]?.status?.type?.state] ?? 1;
    const sb = order[b.competitions?.[0]?.status?.type?.state] ?? 1;
    if (sa !== sb) return sa - sb;
    return new Date(a.date || 0) - new Date(b.date || 0);
  });

  const liveCount    = allMatches.filter(m => m.competitions?.[0]?.status?.type?.state === 'in').length;
  const currentLeague = LEAGUES.find(l => l.id === league);

  return (
    <div className="fade-in">

      {/* ── League selector ── */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {LEAGUES.map(l => (
          <button
            key={l.id}
            onClick={() => { setLeague(l.id); setData(null); }}
            style={{
              padding: isMobile ? '4px 8px' : '5px 11px',
              borderRadius: '20px',
              fontSize: isMobile ? '0.72rem' : '0.77rem',
              cursor: 'pointer',
              border: `1px solid ${league === l.id ? '#06d6a0' : 'var(--border)'}`,
              background: league === l.id ? 'rgba(6,214,160,0.12)' : 'transparent',
              color: league === l.id ? '#06d6a0' : 'var(--text-muted)',
              fontWeight: league === l.id ? 700 : 400,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            {l.flag} {isMobile ? l.short : l.label}
          </button>
        ))}
        <button
          onClick={load}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px', fontSize: '0.75rem' }}
        >↻</button>
      </div>

      {/* ── Status filter pills ── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {[['all', 'All'], ['live', '● Live'], ['final', 'Final'], ['upcoming', 'Upcoming']].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} style={{
            padding: '3px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
            border: `1px solid ${filter === id ? '#06d6a0' : 'var(--border)'}`,
            background: filter === id ? 'rgba(6,214,160,0.08)' : 'transparent',
            color: filter === id ? '#06d6a0' : 'var(--text-muted)',
            fontWeight: filter === id ? 700 : 400,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Live badge ── */}
      {liveCount > 0 && (
        <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', animation: 'live-pulse 1.5s ease-in-out infinite', display: 'inline-block' }} />
          <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 700 }}>
            {liveCount} match{liveCount !== 1 ? 'es' : ''} in progress
          </span>
        </div>
      )}

      {/* ── Content ── */}
      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚽</div>
          <p style={{ fontSize: '0.85rem' }}>Loading {currentLeague?.label || 'soccer'} scores…</p>
        </div>

      ) : error ? (
        <div style={{ padding: '1.5rem', background: '#2b0d0d', border: '1px solid #991b1b', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
          <div style={{ marginBottom: '8px' }}>⚠️ Couldn't load {currentLeague?.label} data — ESPN may be temporarily unavailable.</div>
          <div style={{ fontSize: '0.75rem', color: 'rgba(248,113,113,0.7)', marginBottom: '10px' }}>{error}</div>
          <button onClick={load} style={{ background: 'none', border: '1px solid #f87171', borderRadius: '4px', color: '#f87171', cursor: 'pointer', padding: '3px 10px', fontSize: '0.75rem' }}>
            Retry
          </button>
        </div>

      ) : sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚽</div>
          <p style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
            No {filter === 'all' ? '' : filter + ' '}{currentLeague?.label} matches today
          </p>
          <p style={{ fontSize: '0.78rem' }}>
            {filter !== 'all'
              ? `Try switching to "All" to see upcoming fixtures.`
              : `Try a different league — ${LEAGUES.filter(l => l.id !== league).slice(0,3).map(l => l.label).join(', ')} may have matches.`}
          </p>
        </div>

      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 'min(280px, 100%)' : '270px'}, 1fr))`,
          gap: '8px',
        }}>
          {sorted.map((match, i) => (
            <MatchCard key={match.id || i} match={match} />
          ))}
        </div>
      )}
    </div>
  );
}
