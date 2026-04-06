'use client';
import { useState, useEffect, useCallback } from 'react';

// ── Set score cell ─────────────────────────────────────────────────────────────
function SetCell({ score, won }) {
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

// ── Match card ────────────────────────────────────────────────────────────────
function MatchCard({ match }) {
  const [expanded, setExpanded] = useState(false);
  const comp = match.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const p1 = competitors[0] || {};
  const p2 = competitors[1] || {};

  const status     = comp.status?.type;
  const isLive     = status?.state === 'in';
  const isFinal    = status?.state === 'post';
  const isPre      = status?.state === 'pre';
  const statusLabel = status?.shortDetail || (isLive ? 'LIVE' : isFinal ? 'Final' : 'Upcoming');

  // Per-set linescores — ESPN may return these nested differently
  const p1Sets  = p1.linescores || [];
  const p2Sets  = p2.linescores || [];

  // Sets won: p1.score / p2.score is the total sets won as a string ("2", "1")
  const p1SetsWon = (isFinal || isLive) ? (parseInt(p1.score) || 0) : null;
  const p2SetsWon = (isFinal || isLive) ? (parseInt(p2.score) || 0) : null;

  // Has any real score data?
  const hasLinescores = p1Sets.length > 0 || p2Sets.length > 0;
  const hasSetsWon    = p1SetsWon !== null || p2SetsWon !== null;

  const p1Name  = p1.athlete?.displayName || p1.athlete?.fullName || 'Player 1';
  const p2Name  = p2.athlete?.displayName || p2.athlete?.fullName || 'Player 2';
  const p1Rank  = p1.athlete?.seed ?? p1.rank;
  const p2Rank  = p2.athlete?.seed ?? p2.rank;
  const p1Won   = isFinal && p1SetsWon > p2SetsWon;
  const p2Won   = isFinal && p2SetsWon > p1SetsWon;

  // Round label - extract from series name or competition note
  const round   = comp.series?.name || comp.notes?.[0]?.headline || match.name?.split(' - ').slice(-1)[0] || '';

  // Scheduled time - format nicely like Flashscore
  const matchDate = comp.date ? new Date(comp.date) : null;
  const startTime = matchDate ? matchDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const startDay  = matchDate ? matchDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${isLive ? 'rgba(74,222,128,0.25)' : 'var(--border)'}`,
      borderRadius: '9px',
      overflow: 'hidden',
      boxShadow: isLive ? '0 2px 10px rgba(74,222,128,0.07)' : 'none',
    }}>
      {/* ── Match header ── */}
      <div style={{
        padding: '6px 12px',
        background: isLive ? 'rgba(74,222,128,0.05)' : 'rgba(255,255,255,0.015)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          {round && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', padding: '1px 5px', flexShrink: 0 }}>
              {round}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexShrink: 0 }}>
          {isLive && (
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 5px #4ade80', animation: 'live-pulse 1.5s ease-in-out infinite', display: 'inline-block' }} />
          )}
          <span style={{
            fontSize: '0.65rem', fontWeight: 700,
            color: isLive ? '#4ade80' : isFinal ? '#94a3b8' : '#60a5fa',
          }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* ── Players + scores ── */}
      <div style={{ padding: '9px 12px' }}>
        {[
          { player: p1, name: p1Name, rank: p1Rank, won: p1Won, sets: p1Sets, setsWon: p1SetsWon, opponentSets: p2Sets },
          { player: p2, name: p2Name, rank: p2Rank, won: p2Won, sets: p2Sets, setsWon: p2SetsWon, opponentSets: p1Sets },
        ].map((side, idx) => (
          <div key={idx} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            paddingBottom: idx === 0 ? '6px' : 0,
            paddingTop: idx === 1 ? '6px' : 0,
            borderTop: idx === 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
            opacity: isFinal && !side.won ? 0.55 : 1,
          }}>
            {/* Seed */}
            <div style={{ width: '18px', fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center', flexShrink: 0 }}>
              {side.rank ? `(${side.rank})` : ''}
            </div>
            {/* Flag */}
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
              {side.won && <span style={{ marginLeft: '5px', fontSize: '0.65rem', color: '#4ade80' }}>[ok]</span>}
            </div>
            {/* Score area - set-by-set, total sets, or empty for upcoming */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1px', flexShrink: 0 }}>
              {hasLinescores
                ? side.sets.map((set, si) => {
                    const opp = side.opponentSets[si];
                    const wonSet = parseInt(set.displayValue || 0) > parseInt(opp?.displayValue || 0);
                    return <SetCell key={si} score={set.displayValue} won={wonSet} />;
                  })
                : hasSetsWon && side.setsWon !== null
                  ? <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.92rem', color: side.won ? '#4ade80' : 'var(--text-muted)', minWidth: '20px', textAlign: 'center' }}>
                      {side.setsWon}
                    </span>
                  : null}
            </div>
          </div>
        ))}

        {/* Upcoming: show start time like Flashscore instead of blank scores */}
        {isPre && (startDay || startTime) && (
          <div style={{ marginTop: '8px', textAlign: 'center' }}>
            <span style={{
              fontSize: '0.75rem', color: '#60a5fa', fontWeight: 700,
              background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)',
              borderRadius: '20px', padding: '3px 12px', display: 'inline-block',
            }}>
              {startDay}{startTime ? ` . ${startTime}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* ── Expandable details (venue, surface) ── */}
      {(comp.venue?.fullName || comp.neutralSite !== undefined) && (
        <div
          onClick={() => setExpanded(v => !v)}
          style={{ padding: '4px 12px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textDecoration: 'underline dotted' }}>
            {expanded ? 'Less ^' : 'Details v'}
          </span>
        </div>
      )}
      {expanded && (
        <div style={{ padding: '6px 12px 10px', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          {comp.venue?.fullName && (
            <div>
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Venue</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{comp.venue.fullName}</div>
            </div>
          )}
          {comp.venue?.address?.city && (
            <div>
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Location</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{comp.venue.address.city}{comp.venue.address.country ? `, ${comp.venue.address.country}` : ''}</div>
            </div>
          )}
          {match.season?.year && (
            <div>
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Season</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{match.season.year}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tournament section (collapsible) ─────────────────────────────────────────
function TournamentSection({ name, matches, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);

  const liveCount    = matches.filter(m => m.competitions?.[0]?.status?.type?.state === 'in').length;
  const finalCount   = matches.filter(m => m.competitions?.[0]?.status?.type?.state === 'post').length;
  const pendingCount = matches.filter(m => m.competitions?.[0]?.status?.type?.state === 'pre').length;

  // Build compact matchup previews for collapsed header
  const getMatchupLabel = (match) => {
    const comp = match.competitions?.[0];
    const competitors = comp?.competitors || [];
    const p1 = competitors[0];
    const p2 = competitors[1];
    if (!p1 || !p2) return null;
    const n1 = p1.athlete?.shortName || p1.athlete?.lastName || p1.athlete?.displayName || 'P1';
    const n2 = p2.athlete?.shortName || p2.athlete?.lastName || p2.athlete?.displayName || 'P2';
    const state = comp?.status?.type?.state;
    const isLive = state === 'in';
    const isFinal = state === 'post';
    // Score if available
    const p1Score = (isFinal || isLive) ? (parseInt(p1.score) ?? '') : '';
    const p2Score = (isFinal || isLive) ? (parseInt(p2.score) ?? '') : '';
    const scoreStr = (p1Score !== '' && p2Score !== '') ? ` ${p1Score}-${p2Score}` : '';
    return { label: `${n1} vs ${n2}${scoreStr}`, isLive, isFinal };
  };

  // Show live matches first in preview, then limit to 3
  const sortedForPreview = [...matches].sort((a, b) => {
    const aLive = a.competitions?.[0]?.status?.type?.state === 'in' ? 0 : 1;
    const bLive = b.competitions?.[0]?.status?.type?.state === 'in' ? 0 : 1;
    return aLive - bLive;
  });
  const previewMatchups = sortedForPreview.slice(0, 3).map(getMatchupLabel).filter(Boolean);
  const moreCount = matches.length - 3;

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${liveCount > 0 ? 'rgba(74,222,128,0.3)' : open ? 'rgba(255,184,0,0.2)' : 'var(--border)'}`,
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: liveCount > 0 ? '0 2px 12px rgba(74,222,128,0.07)' : 'none',
      transition: 'border-color 0.15s',
    }}>
      {/* ── Section header - clickable ── */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '10px 14px', cursor: 'pointer', userSelect: 'none',
          background: liveCount > 0 ? 'rgba(74,222,128,0.04)' : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!liveCount) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
        onMouseLeave={e => { if (!liveCount) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Live dot */}
        {liveCount > 0 && (
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 5px #4ade80', display: 'inline-block', animation: 'live-pulse 2s infinite', flexShrink: 0 }} />
        )}

        {/* Tournament name + badges */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
            <h3 style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              [tennis] {name}
            </h3>
            {liveCount > 0 && (
              <span style={{ fontSize: '0.6rem', color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: '10px', padding: '1px 7px', fontWeight: 800, flexShrink: 0 }}>
                {liveCount} LIVE
              </span>
            )}
          </div>
          {/* Match count summary + collapsed matchup preview */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '2px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>
              {matches.length} match{matches.length !== 1 ? 'es' : ''}
            </span>
            {finalCount > 0 && <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>. {finalCount} final</span>}
            {pendingCount > 0 && <span style={{ fontSize: '0.67rem', color: '#60a5fa' }}>. {pendingCount} upcoming</span>}
          </div>
          {/* Matchup previews — only shown when collapsed */}
          {!open && previewMatchups.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
              {previewMatchups.map((m, i) => (
                <span key={i} style={{
                  fontSize: '0.65rem', fontWeight: 600, padding: '2px 7px', borderRadius: '10px',
                  background: m.isLive ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${m.isLive ? 'rgba(74,222,128,0.25)' : 'rgba(255,255,255,0.08)'}`,
                  color: m.isLive ? '#4ade80' : 'var(--text-secondary)',
                  whiteSpace: 'nowrap',
                }}>
                  {m.isLive && <span style={{ marginRight: '3px' }}>*</span>}{m.label}
                </span>
              ))}
              {moreCount > 0 && (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', padding: '2px 4px' }}>
                  +{moreCount} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Expand chevron */}
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', transition: 'transform 0.2s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
          v
        </span>
      </div>

      {/* ── Match cards ── */}
      {open && (
        <div style={{ borderTop: `1px solid ${liveCount > 0 ? 'rgba(74,222,128,0.15)' : 'var(--border)'}`, padding: '10px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(290px, 100%), 1fr))', gap: '8px' }}>
            {matches.map((m, i) => <MatchCard key={m.id || i} match={m} />)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function TennisScoreboard({ initialTour = 'atp' }) {
  const [tour, setTour]     = useState(initialTour === 'tenniswta' ? 'tenniswta' : 'atp');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [filter, setFilter] = useState('all'); // all | live | final | upcoming

  const tours = [
    { id: 'atp',       label: 'ATP (Men)',   emoji: '[tennis]' },
    { id: 'tenniswta', label: 'WTA (Women)', emoji: '[tennis]' },
  ];

  const [lookAheadDays, setLookAheadDays] = useState(0); // 0 = today, >0 = peeking ahead

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const sportParam = tour === 'atp' ? 'tennis' : tour;

      // Helper: fetch a specific date (YYYYMMDD) or today if no date given
      async function fetchDate(dateStr) {
        const q = dateStr ? `&date=${dateStr}` : '';
        const res  = await fetch(`/api/sports?sport=${sportParam}&endpoint=scoreboard${q}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        return json;
      }

      // Try today first
      let json = await fetchDate('');
      if ((json.events || []).length > 0) {
        setLookAheadDays(0);
        setData(json);
        return;
      }

      // No matches today - look ahead up to 7 days to find upcoming tournament draws
      for (let d = 1; d <= 7; d++) {
        const future = new Date();
        future.setDate(future.getDate() + d);
        const dateStr = future.toISOString().slice(0, 10).replace(/-/g, '');
        json = await fetchDate(dateStr);
        if ((json.events || []).length > 0) {
          setLookAheadDays(d);
          setData(json);
          return;
        }
      }

      // Nothing found in the next week — show today's empty state
      setLookAheadDays(0);
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load tennis scores');
    } finally {
      setLoading(false);
    }
  }, [tour]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const allMatches = data?.events || [];

  // Apply filter
  const filtered = allMatches.filter(m => {
    const state = m.competitions?.[0]?.status?.type?.state;
    if (filter === 'live')     return state === 'in';
    if (filter === 'final')    return state === 'post';
    if (filter === 'upcoming') return state === 'pre';
    return true;
  });

  // Group by tournament name, preserving insert order
  const grouped = {};
  for (const match of filtered) {
    const key = match.competitions?.[0]?.series?.name
      || match.name?.split(' - ')?.[0]
      || match.league?.name
      || 'Other Matches';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(match);
  }

  // Sort groups: live tournaments first
  const sortedGroups = Object.entries(grouped).sort(([, a], [, b]) => {
    const aLive = a.some(m => m.competitions?.[0]?.status?.type?.state === 'in') ? 0 : 1;
    const bLive = b.some(m => m.competitions?.[0]?.status?.type?.state === 'in') ? 0 : 1;
    return aLive - bLive;
  });

  const liveTotal = allMatches.filter(m => m.competitions?.[0]?.status?.type?.state === 'in').length;

  return (
    <div className="fade-in">
      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Tour toggle */}
        {tours.map(t => (
          <button key={t.id} onClick={() => { setTour(t.id); setData(null); }} style={{
            padding: '5px 14px', borderRadius: '20px', fontSize: '0.78rem', cursor: 'pointer',
            border: `1px solid ${tour === t.id ? '#84cc16' : 'var(--border)'}`,
            background: tour === t.id ? 'rgba(132,204,22,0.12)' : 'transparent',
            color: tour === t.id ? '#84cc16' : 'var(--text-muted)',
            fontWeight: tour === t.id ? 700 : 400,
          }}>
            {t.emoji} {t.label}
          </button>
        ))}

        {/* State filter pills */}
        <div style={{ display: 'flex', gap: '4px', marginLeft: 'auto' }}>
          {[['all', 'All'], ['live', '* Live'], ['final', 'Final'], ['upcoming', 'Upcoming']].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} style={{
              padding: '3px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
              border: `1px solid ${filter === id ? 'var(--gold)' : 'var(--border)'}`,
              background: filter === id ? 'rgba(255,184,0,0.08)' : 'transparent',
              color: filter === id ? 'var(--gold)' : 'var(--text-muted)',
              fontWeight: filter === id ? 700 : 400,
            }}>
              {label}
            </button>
          ))}
        </div>

        <button onClick={load} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px', fontSize: '0.75rem' }}>
          [refresh]
        </button>
      </div>

      {/* Look-ahead notice — shown when no matches today and we're peeking into the future */}
      {lookAheadDays > 0 && (
        <div style={{
          marginBottom: '10px', padding: '7px 14px', borderRadius: '8px',
          background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.2)',
          fontSize: '0.78rem', color: '#93c5fd',
        }}>
          [date] No matches today - showing upcoming matches starting in {lookAheadDays === 1 ? 'tomorrow' : `${lookAheadDays} days`}.
        </div>
      )}

      {/* Live summary badge */}
      {liveTotal > 0 && (
        <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', animation: 'live-pulse 1.5s ease-in-out infinite', display: 'inline-block' }} />
          <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 700 }}>
            {liveTotal} match{liveTotal !== 1 ? 'es' : ''} in progress
          </span>
        </div>
      )}

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>[tennis]</div>
          <p style={{ fontSize: '0.85rem' }}>Loading tennis scores...</p>
        </div>
      ) : error ? (
        <div style={{ padding: '1.5rem', background: '#2b0d0d', border: '1px solid #991b1b', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
          [!] {error}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>[tennis]</div>
          {filter !== 'all' ? (
            <p style={{ fontSize: '0.85rem' }}>No {filter} matches - try switching to All.</p>
          ) : allMatches.length === 0 ? (
            <div>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                No {tour === 'atp' ? 'ATP' : 'WTA'} matches scheduled right now.
              </p>
              <p style={{ fontSize: '0.78rem' }}>
                The tour may be between events - check back soon or try the other tour.
              </p>
              <button
                onClick={load}
                style={{
                  marginTop: '14px', padding: '6px 18px', borderRadius: '20px',
                  background: 'rgba(132,204,22,0.1)', border: '1px solid rgba(132,204,22,0.3)',
                  color: '#84cc16', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600,
                }}
              >
                Try again
              </button>
            