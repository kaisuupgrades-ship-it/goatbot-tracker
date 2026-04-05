'use client';
import { useState, useEffect, useCallback } from 'react';

function setScoreCell(score, won) {
  // score is a set score like "6", "7", "3"; won indicates if this player won the set
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: '22px', height: '22px', borderRadius: '4px',
      background: won ? 'rgba(74,222,128,0.15)' : 'transparent',
      border: won ? '1px solid rgba(74,222,128,0.3)' : '1px solid transparent',
      fontFamily: 'IBM Plex Mono, monospace',
      fontWeight: won ? 800 : 500,
      fontSize: '0.82rem',
      color: won ? '#4ade80' : 'var(--text-muted)',
      margin: '0 2px',
    }}>
      {score ?? ''}
    </span>
  );
}

function MatchCard({ match }) {
  const comp = match.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const p1 = competitors[0] || {};
  const p2 = competitors[1] || {};

  const status = comp.status?.type;
  const isLive = status?.state === 'in';
  const isFinal = status?.state === 'post';
  const statusLabel = status?.shortDetail || (isLive ? 'LIVE' : isFinal ? 'Final' : 'Scheduled');

  // Parse set scores from linescores
  const p1Sets = p1.linescores || [];
  const p2Sets = p2.linescores || [];

  const p1SetsWon = isFinal || isLive ? parseInt(p1.score || 0) : null;
  const p2SetsWon = isFinal || isLive ? parseInt(p2.score || 0) : null;

  const surface = comp.venue?.description || match.competitions?.[0]?.neutralSite ? '' : '';
  const tournament = match.competitions?.[0]?.series?.name || match.name?.split(' - ')?.[0] || '';

  const p1Name = p1.athlete?.displayName || p1.athlete?.fullName || 'Player 1';
  const p2Name = p2.athlete?.displayName || p2.athlete?.fullName || 'Player 2';
  const p1Rank = p1.athlete?.seed ?? p1.rank;
  const p2Rank = p2.athlete?.seed ?? p2.rank;
  const p1Won  = isFinal && p1SetsWon > p2SetsWon;
  const p2Won  = isFinal && p2SetsWon > p1SetsWon;

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${isLive ? 'rgba(74,222,128,0.25)' : 'var(--border)'}`,
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: isLive ? '0 2px 12px rgba(74,222,128,0.08)' : '0 2px 6px rgba(0,0,0,0.2)',
    }}>
      {/* Header */}
      <div style={{
        padding: '6px 12px',
        background: isLive ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.02)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          {tournament || 'ATP Singles'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {isLive && (
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 5px #4ade80', animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-block' }} />
          )}
          <span style={{
            fontSize: '0.65rem', fontWeight: 700,
            color: isLive ? '#4ade80' : isFinal ? '#94a3b8' : '#60a5fa',
          }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Players + Scores */}
      <div style={{ padding: '8px 12px' }}>
        {[{ player: p1, name: p1Name, rank: p1Rank, won: p1Won, sets: p1Sets, setsWon: p1SetsWon, opponentSets: p2Sets },
          { player: p2, name: p2Name, rank: p2Rank, won: p2Won, sets: p2Sets, setsWon: p2SetsWon, opponentSets: p1Sets }].map((side, idx) => (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            paddingBottom: idx === 0 ? '6px' : 0,
            paddingTop: idx === 1 ? '6px' : 0,
            borderTop: idx === 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
            opacity: isFinal && !side.won ? 0.6 : 1,
          }}>
            {/* Rank seed */}
            <div style={{ width: '18px', fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center', flexShrink: 0 }}>
              {side.rank ? `(${side.rank})` : ''}
            </div>

            {/* Country flag */}
            <div style={{ width: '18px', flexShrink: 0 }}>
              {side.player.athlete?.flag?.href
                ? <img src={side.player.athlete.flag.href} alt="" style={{ width: '18px', height: '12px', objectFit: 'cover', borderRadius: '1px' }} />
                : null}
            </div>

            {/* Name */}
            <div style={{
              flex: 1, fontSize: '0.85rem', fontWeight: side.won ? 800 : 500,
              color: side.won ? 'var(--text-primary)' : 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {side.name}
              {side.won && <span style={{ marginLeft: '5px', fontSize: '0.65rem', color: '#4ade80' }}>✓</span>}
            </div>

            {/* Set scores */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1px', flexShrink: 0 }}>
              {side.sets.length > 0
                ? side.sets.map((set, si) => {
                    const oppSet = side.opponentSets[si];
                    const wonSet = parseInt(set.displayValue || 0) > parseInt(oppSet?.displayValue || 0);
                    return (
                      <span key={si}>
                        {setScoreCell(set.displayValue, wonSet)}
                      </span>
                    );
                  })
                : (isFinal || isLive) && side.setsWon !== null
                  ? <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.92rem', color: side.won ? '#4ade80' : 'var(--text-muted)' }}>
                      {side.setsWon}
                    </span>
                  : null}
            </div>
          </div>
        ))}
      </div>

      {/* Round info */}
      {comp.series?.name && (
        <div style={{ padding: '4px 12px 6px', fontSize: '0.62rem', color: 'var(--text-muted)' }}>
          {comp.series.name}
        </div>
      )}
    </div>
  );
}

function TournamentSection({ name, matches }) {
  const liveCount = matches.filter(m => m.competitions?.[0]?.status?.type?.state === 'in').length;
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
          {name}
        </h3>
        {liveCount > 0 && (
          <span style={{ fontSize: '0.65rem', color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: '10px', padding: '1px 7px', fontWeight: 700 }}>
            {liveCount} LIVE
          </span>
        )}
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{matches.length} match{matches.length !== 1 ? 'es' : ''}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '8px' }}>
        {matches.map((m, i) => <MatchCard key={m.id || i} match={m} />)}
      </div>
    </div>
  );
}

export default function TennisScoreboard({ initialTour = 'atp' }) {
  const [tour, setTour]       = useState(initialTour === 'tenniswta' ? 'tenniswta' : 'atp');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [filter, setFilter]   = useState('all'); // all | live | final | upcoming

  const tours = [
    { id: 'atp',  label: 'ATP (Men)',  emoji: '🎾' },
    { id: 'tenniswta', label: 'WTA (Women)', emoji: '🎾' },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // 'atp' maps to the 'tennis' key in the API; 'tenniswta' is its own key
      const sportParam = tour === 'atp' ? 'tennis' : tour;
      const res  = await fetch(`/api/sports?sport=${sportParam}&endpoint=scoreboard`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load tennis scores');
    } finally {
      setLoading(false);
    }
  }, [tour]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 60 * 1000); // refresh every minute
    return () => clearInterval(t);
  }, [load]);

  const allMatches = data?.events || [];

  // Filter
  const filtered = allMatches.filter(m => {
    const state = m.competitions?.[0]?.status?.type?.state;
    if (filter === 'live')     return state === 'in';
    if (filter === 'final')    return state === 'post';
    if (filter === 'upcoming') return state === 'pre';
    return true;
  });

  // Group by tournament name
  const grouped = {};
  for (const match of filtered) {
    const tournName = match.competitions?.[0]?.series?.name
      || match.name?.split(' - ')?.[0]
      || match.league?.name
      || 'Other Matches';
    if (!grouped[tournName]) grouped[tournName] = [];
    grouped[tournName].push(match);
  }

  const liveTotal = allMatches.filter(m => m.competitions?.[0]?.status?.type?.state === 'in').length;

  return (
    <div className="fade-in">
      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {tours.map(t => (
          <button key={t.id} onClick={() => setTour(t.id)} style={{
            padding: '5px 14px', borderRadius: '20px', fontSize: '0.78rem', cursor: 'pointer',
            border: `1px solid ${tour === t.id ? '#84cc16' : 'var(--border)'}`,
            background: tour === t.id ? 'rgba(132,204,22,0.12)' : 'transparent',
            color: tour === t.id ? '#84cc16' : 'var(--text-muted)',
            fontWeight: tour === t.id ? 700 : 400,
          }}>
            {t.emoji} {t.label}
          </button>
        ))}

        <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
          {[['all','All'], ['live','● Live'], ['final','Final'], ['upcoming','Upcoming']].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
              border: `1px solid ${filter === id ? 'var(--gold)' : 'var(--border)'}`,
              background: filter === id ? 'rgba(255,184,0,0.08)' : 'transparent',
              color: filter === id ? 'var(--gold)' : 'var(--text-muted)',
              fontWeight: filter === id ? 700 : 400,
            }}>{label}</button>
          ))}
        </div>

        <button onClick={load} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px', fontSize: '0.75rem' }}>
          ↻
        </button>
      </div>

      {/* Live badge */}
      {liveTotal > 0 && (
        <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', animation: 'pulse 1.5s ease-in-out infinite', display: 'inline-block' }} />
          <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 700 }}>{liveTotal} match{liveTotal !== 1 ? 'es' : ''} in progress</span>
        </div>
      )}

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎾</div>
          <p style={{ fontSize: '0.85rem' }}>Loading tennis scores…</p>
        </div>
      ) : error ? (
        <div style={{ padding: '1.5rem', background: '#2b0d0d', border: '1px solid #991b1b', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
          ⚠️ {error}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎾</div>
          <p>No {filter === 'all' ? '' : filter + ' '}matches available right now.</p>
        </div>
      ) : (
        Object.entries(grouped).map(([tournName, matches]) => (
          <TournamentSection key={tournName} name={tournName} matches={matches} />
        ))
      )}
    </div>
  );
}
