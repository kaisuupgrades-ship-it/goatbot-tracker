'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

// ── Starred golfers persistence ───────────────────────────────────────────────
const GOLF_STAR_KEY = 'betos_starred_golfers';

function getStarredGolfers() {
  try { return JSON.parse(localStorage.getItem(GOLF_STAR_KEY) || '{}'); } catch { return {}; }
}

function toggleStarGolfer(player, tournamentName) {
  const starred = getStarredGolfers();
  const id = player.id || player.athlete?.id;
  if (!id) return;
  if (starred[id]) {
    delete starred[id];
  } else {
    starred[id] = {
      id,
      name: player.athlete?.displayName || player.athlete?.fullName || '?',
      tournament: tournamentName || '',
      starredAt: new Date().toISOString(),
    };
  }
  try { localStorage.setItem(GOLF_STAR_KEY, JSON.stringify(starred)); } catch {}
  window.dispatchEvent(new Event('storage'));
}

function isGolferStarred(player) {
  const id = player.id || player.athlete?.id;
  if (!id) return false;
  return !!getStarredGolfers()[id];
}

// Updates position/score for all currently-starred golfers from fresh data
function syncStarredGolferStats(players, tournamentName) {
  const starred = getStarredGolfers();
  let changed = false;
  for (const p of players) {
    const id = p.id || p.athlete?.id;
    if (!id || !starred[id]) continue;
    const stats = p.statistics || [];
    starred[id] = {
      ...starred[id],
      tournament: tournamentName || starred[id].tournament,
      position:  p.status?.position?.displayName || '—',
      toPar:     stats[0]?.displayValue ?? p.score?.displayValue ?? '—',
      thru:      p.status?.thru ?? stats[1]?.displayValue ?? '—',
      today:     stats[2]?.displayValue ?? '—',
      updatedAt: new Date().toISOString(),
    };
    changed = true;
  }
  if (changed) {
    try { localStorage.setItem(GOLF_STAR_KEY, JSON.stringify(starred)); } catch {}
    window.dispatchEvent(new Event('storage'));
  }
}

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

// ── Score helpers ─────────────────────────────────────────────────────────────
function scoreColor(val) {
  const n = val === 'E' ? 0 : parseInt(val);
  if (isNaN(n)) return '#94a3b8';
  if (n < 0) return '#4ade80';
  if (n > 0) return '#f87171';
  return '#94a3b8';
}

function fmtScore(val) {
  if (val === null || val === undefined || val === '') return '—';
  if (val === 'E' || val === 'Even') return 'E';
  const n = typeof val === 'string' ? parseInt(val) : val;
  if (isNaN(n)) return val;
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

// ── Score type helpers ────────────────────────────────────────────────────────
function scoreTypeMeta(typeName) {
  const t = (typeName || '').toLowerCase();
  if (t === 'eagle' || t === 'double eagle' || t === 'albatross')
    return { label: t === 'eagle' ? 'Eagle' : t === 'double eagle' ? '2-Eagle' : 'Albatross', color: '#FFB800', bg: 'rgba(255,184,0,0.15)', border: 'rgba(255,184,0,0.4)' };
  if (t === 'birdie')
    return { label: 'Birdie', color: '#4ade80', bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.35)' };
  if (t === 'par')
    return { label: 'Par', color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)' };
  if (t === 'bogey')
    return { label: 'Bogey', color: '#fb923c', bg: 'rgba(251,146,60,0.1)', border: 'rgba(251,146,60,0.3)' };
  if (t.includes('double bogey') || t === 'double bogey')
    return { label: 'Dbl Bogey', color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.35)' };
  if (t.includes('bogey'))
    return { label: 'Triple+', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.4)' };
  return null;
}

// Compute hot/cold from linescores (per-hole) or fall back to today's pace
function getHotCold(player) {
  const linescores = player.linescores || [];
  // If we have scoreType-annotated linescores, use last 3-5 holes
  const withType = linescores.filter(ls => ls.scoreType?.name);
  if (withType.length >= 2) {
    const recent = withType.slice(-5);
    const birdies = recent.filter(h => {
      const t = h.scoreType.name.toLowerCase();
      return t === 'birdie' || t === 'eagle' || t === 'double eagle' || t === 'albatross';
    }).length;
    const bogeys = recent.filter(h => {
      const t = h.scoreType.name.toLowerCase();
      return t.includes('bogey');
    }).length;
    if (birdies >= 2) return 'hot';
    if (bogeys >= 2) return 'cold';
    return null;
  }
  // Fallback: use today's round score pace
  const stats    = player.statistics || [];
  const todayStr = stats[2]?.displayValue ?? '—';
  const thruVal  = player.status?.thru ?? stats[1]?.displayValue;
  if (todayStr === '—' || !thruVal || thruVal === 'F') return null;
  const today = todayStr === 'E' ? 0 : parseInt(todayStr);
  const thru  = parseInt(thruVal);
  if (isNaN(today) || isNaN(thru) || thru < 4) return null;
  // -2 or better through 4+ holes = hot; +2 or worse = cold
  if (today <= -2) return 'hot';
  if (today >= 2) return 'cold';
  return null;
}

// Get the most recent hole result from linescores
function getLastHole(player) {
  const linescores = player.linescores || [];
  const withType = linescores.filter(ls => ls.scoreType?.name);
  if (!withType.length) return null;
  return withType[withType.length - 1];
}

// ── Scorecard Modal ───────────────────────────────────────────────────────────
function ScorecardModal({ player, eventId, league, onClose }) {
  const [rounds, setRounds] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const overlayRef = useRef(null);

  const athleteId = player.id || player.athlete?.id;
  const name      = player.athlete?.displayName || player.athlete?.fullName || 'Player';

  useEffect(() => {
    if (!athleteId || !eventId) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/sports?sport=golf&endpoint=scorecard&league=${league || 'pga'}&athleteId=${athleteId}&eventId=${eventId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        // ESPN scorecard returns rounds array
        const r = d.rounds || d.player?.rounds || [];
        setRounds(r);
      })
      .catch(e => setError(e.message || 'Could not load scorecard'))
      .finally(() => setLoading(false));
  }, [athleteId, eventId, league]);

  // Also try to build scorecard from linescores if API fails
  const linescoredRounds = (() => {
    if (rounds?.length) return null; // use API data
    const ls = player.linescores || [];
    if (!ls.length) return null;
    return [{ number: 'Current', holes: ls.map((h, i) => ({
      number: h.period || (i + 1),
      par: h.par,
      score: h.value,
      displayValue: h.displayValue,
      scoreType: h.scoreType,
    }))}];
  })();

  const displayRounds = rounds?.length ? rounds : (linescoredRounds || []);

  function hdlOverlay(e) { if (e.target === overlayRef.current) onClose(); }

  return (
    <div
      ref={overlayRef}
      onClick={hdlOverlay}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div style={{
        background: 'var(--bg-surface, #1a1a2e)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '12px',
        width: '100%', maxWidth: '660px',
        maxHeight: '85vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.02)',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary, #fff)' }}>{name}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted, #94a3b8)', marginTop: '2px' }}>Scorecard</div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-muted, #94a3b8)',
            borderRadius: '6px', cursor: 'pointer', padding: '4px 10px', fontSize: '0.78rem',
          }}>✕ Close</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '12px 14px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted, #94a3b8)' }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⛳</div>
              <p style={{ fontSize: '0.82rem' }}>Loading scorecard…</p>
            </div>
          ) : error && !displayRounds.length ? (
            <div style={{ padding: '1rem', color: '#f87171', fontSize: '0.82rem', textAlign: 'center' }}>
              <div style={{ marginBottom: '6px' }}>⚠️ {error}</div>
              <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '0.72rem' }}>
                Detailed scorecard may not be available yet. Check back during or after the round.
              </div>
            </div>
          ) : !displayRounds.length ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted, #94a3b8)', fontSize: '0.82rem' }}>
              No scorecard data available yet. Check back once the round starts.
            </div>
          ) : (
            displayRounds.map((round, ri) => (
              <div key={ri} style={{ marginBottom: '18px' }}>
                <div style={{
                  fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em',
                  color: '#22c55e', marginBottom: '8px',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  Round {round.number}
                  {round.total != null && (
                    <span style={{ fontFamily: 'IBM Plex Mono', color: scoreColor(round.total - (round.par || 72)), fontWeight: 800, textTransform: 'none', fontSize: '0.78rem' }}>
                      {round.displayTotal || fmtScore(round.total - (round.par || 72))}
                    </span>
                  )}
                </div>

                {/* Hole grid */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: '0.72rem' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <th style={{ padding: '4px 6px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', minWidth: '36px' }}>Hole</th>
                        {(round.holes || []).map(h => (
                          <th key={h.number} style={{ padding: '4px 5px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600, textAlign: 'center', minWidth: '28px' }}>
                            {h.number}
                          </th>
                        ))}
                        <th style={{ padding: '4px 6px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600, textAlign: 'center' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Par row */}
                      {(round.holes || []).some(h => h.par != null) && (
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '3px 6px', color: 'var(--text-muted, #94a3b8)', fontWeight: 600, fontSize: '0.65rem' }}>Par</td>
                          {(round.holes || []).map(h => (
                            <td key={h.number} style={{ padding: '3px 5px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)', fontFamily: 'IBM Plex Mono' }}>
                              {h.par ?? '—'}
                            </td>
                          ))}
                          <td style={{ padding: '3px 6px', textAlign: 'center', color: 'var(--text-muted, #94a3b8)', fontFamily: 'IBM Plex Mono' }}>
                            {(round.holes || []).reduce((s, h) => s + (h.par || 0), 0) || round.par || '—'}
                          </td>
                        </tr>
                      )}
                      {/* Score row */}
                      <tr>
                        <td style={{ padding: '5px 6px', fontWeight: 700, fontSize: '0.68rem', color: 'var(--text-secondary, #cbd5e1)' }}>Score</td>
                        {(round.holes || []).map(h => {
                          const meta = scoreTypeMeta(h.scoreType?.name);
                          const score = h.displayValue ?? (h.score != null ? String(h.score) : null);
                          return (
                            <td key={h.number} style={{ padding: '3px 3px', textAlign: 'center' }}>
                              {score != null ? (
                                <span style={{
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  width: '22px', height: '22px', borderRadius: '50%',
                                  fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.75rem',
                                  background: meta?.bg || 'transparent',
                                  color: meta?.color || 'var(--text-primary, #fff)',
                                  border: meta ? `1px solid ${meta.border}` : 'none',
                                }}>
                                  {score}
                                </span>
                              ) : (
                                <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.65rem' }}>–</span>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ padding: '5px 6px', textAlign: 'center', fontFamily: 'IBM Plex Mono', fontWeight: 800, color: round.total != null ? scoreColor(round.total - (round.par || 72)) : 'var(--text-muted, #94a3b8)' }}>
                          {round.total ?? '—'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Score type legend for this round */}
                {(round.holes || []).some(h => h.scoreType?.name) && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                    {['Eagle', 'Birdie', 'Par', 'Bogey', 'Dbl Bogey'].map(label => {
                      const meta = scoreTypeMeta(label === 'Dbl Bogey' ? 'double bogey' : label.toLowerCase());
                      if (!meta) return null;
                      return (
                        <span key={label} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          fontSize: '0.6rem', color: meta.color, padding: '1px 6px',
                          background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: '10px',
                        }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: meta.color, display: 'inline-block' }} />
                          {label}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Player row ────────────────────────────────────────────────────────────────
function PlayerRow({ player, isMobile, tournamentName, eventId, league }) {
  const stats      = player.statistics || [];
  const toPar      = stats[0]?.displayValue ?? player.score?.displayValue ?? '—';
  const thru       = player.status?.thru ?? stats[1]?.displayValue ?? '—';
  const todayScore = stats[2]?.displayValue ?? '—';
  const totalScore = stats[3]?.displayValue ?? player.score?.value ?? '—';
  const toParNum   = toPar === 'E' ? 0 : parseInt(toPar);
  const todayNum   = todayScore === 'E' ? 0 : parseInt(todayScore);
  const isLead     = player.status?.position?.displayName === '1' || player._isLead;
  const isCut      = player.status?.type === 'cut';
  const pos        = player.status?.position?.displayName || '—';

  const hotCold    = getHotCold(player);
  const lastHole   = getLastHole(player);
  const lastMeta   = lastHole ? scoreTypeMeta(lastHole.scoreType?.name) : null;

  const [starred, setStarred]         = useState(() => isGolferStarred(player));
  const [showScorecard, setScorecard] = useState(false);

  useEffect(() => {
    const handler = () => setStarred(isGolferStarred(player));
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [player]);

  function handleStar(e) {
    e.stopPropagation();
    toggleStarGolfer(player, tournamentName);
    setStarred(v => !v);
  }

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile
          ? '30px 1fr 44px 40px 40px 28px'
          : '40px 32px 1fr 56px 50px 50px 60px 28px',
        alignItems: 'center',
        padding: isMobile ? '7px 12px' : '7px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        background: isLead ? 'rgba(74,222,128,0.04)' : 'transparent',
        opacity: isCut ? 0.45 : 1,
      }}>
        {/* Pos */}
        <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', fontWeight: isLead ? 800 : 500, color: isLead ? '#FFB800' : 'var(--text-muted)' }}>
          {pos}
        </div>
        {/* Flag — desktop only */}
        {!isMobile && (
          <div style={{ textAlign: 'center' }}>
            {player.athlete?.flag?.href
              ? <img src={player.athlete.flag.href} alt="" style={{ width: '18px', height: '12px', objectFit: 'cover', borderRadius: '1px' }} />
              : <span style={{ fontSize: '0.8rem', opacity: 0.4 }}>🏌️</span>}
          </div>
        )}
        {/* Name + hot/cold + last hole badge */}
        <div style={{ overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden' }}>
            <button
              onClick={() => setScorecard(true)}
              title="View scorecard"
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: isMobile ? '0.82rem' : '0.85rem', fontWeight: 600,
                color: 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textDecoration: 'underline', textDecorationColor: 'rgba(255,255,255,0.15)',
                textUnderlineOffset: '2px',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#60a5fa'; e.currentTarget.style.textDecorationColor = '#60a5fa'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.textDecorationColor = 'rgba(255,255,255,0.15)'; }}
            >
              {player.athlete?.displayName || player.athlete?.fullName || '—'}
            </button>
            {/* Hot/cold emoji */}
            {hotCold === 'hot' && <span title="Hot round" style={{ fontSize: '0.75rem', flexShrink: 0 }}>🔥</span>}
            {hotCold === 'cold' && <span title="Cold round" style={{ fontSize: '0.75rem', flexShrink: 0 }}>❄️</span>}
          </div>
          {/* Last hole badge + CUT */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px', flexWrap: 'wrap' }}>
            {isCut && <div style={{ fontSize: '0.58rem', color: '#f87171', fontWeight: 700 }}>CUT</div>}
            {lastMeta && (
              <span style={{
                fontSize: '0.55rem', fontWeight: 700, padding: '1px 5px', borderRadius: '8px',
                background: lastMeta.bg, color: lastMeta.color, border: `1px solid ${lastMeta.border}`,
                lineHeight: 1.4, flexShrink: 0,
              }}>
                {lastMeta.label}
              </span>
            )}
          </div>
        </div>
        {/* To Par */}
        <div style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: isMobile ? '0.85rem' : '0.9rem', color: scoreColor(toParNum) }}>
          {fmtScore(toPar)}
        </div>
        {/* Today */}
        <div style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono', fontSize: '0.78rem', color: scoreColor(todayNum) }}>
          {todayScore !== '—' ? fmtScore(todayScore) : '—'}
        </div>
        {/* Thru */}
        <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {thru}
        </div>
        {/* Total — desktop only */}
        {!isMobile && (
          <div style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            {totalScore !== '—' ? totalScore : '—'}
          </div>
        )}
        {/* Star button */}
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={handleStar}
            title={starred ? 'Remove from Featured' : 'Track in Featured tab'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
              fontSize: '0.85rem', lineHeight: 1,
              color: starred ? '#FFB800' : 'rgba(255,255,255,0.2)',
              transition: 'color 0.15s, transform 0.15s',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#FFB800'; e.currentTarget.style.transform = 'scale(1.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = starred ? '#FFB800' : 'rgba(255,255,255,0.2)'; e.currentTarget.style.transform = 'scale(1)'; }}
          >
            {starred ? '★' : '☆'}
          </button>
        </div>
      </div>

      {/* Scorecard modal */}
      {showScorecard && (
        <ScorecardModal
          player={player}
          eventId={eventId}
          league={league}
          onClose={() => setScorecard(false)}
        />
      )}
    </>
  );
}

// ── Tournament card (expandable) ──────────────────────────────────────────────
function TournamentCard({ event, defaultOpen, search, isMobile, league }) {
  const [open, setOpen] = useState(defaultOpen);

  const name       = event.name || event.shortName || 'Tournament';
  const eventId    = event.id;
  const comp       = event.competitions?.[0] ?? {};
  const venue      = comp.venue?.fullName || event.venue?.fullName || '';
  const city       = comp.venue?.address?.city || '';
  const stateAbbr  = comp.venue?.address?.state || '';
  const purse      = event.purse || comp.purse;
  const purseLabel = purse ? `$${(purse / 1_000_000).toFixed(1)}M` : '';
  const statusType = event.status?.type;
  const isLive     = statusType?.state === 'in';
  const isComplete = statusType?.state === 'post';
  const roundLabel = statusType?.detail || statusType?.shortDetail
    || (isComplete ? 'Final' : isLive ? 'In Progress' : 'Upcoming');

  // Surface / category badges from links or notes
  const category = event.links?.[0]?.text || '';

  // Players — competitors array inside competitions[0]
  const rawPlayers = comp.competitors || event.competitors || event.leaderboard || [];

  // Sort by numeric position (handles ties like "T2" → 2, "CUT" → 999)
  function parsePos(pos) {
    if (!pos || pos === '—' || pos === 'CUT') return 9999;
    const n = parseInt(String(pos).replace(/[^0-9]/g, ''));
    return isNaN(n) ? 9999 : n;
  }
  const players = [...rawPlayers].sort((a, b) =>
    parsePos(a.status?.position?.displayName) - parsePos(b.status?.position?.displayName)
  );

  const filtered = search.trim()
    ? players.filter(p => (p.athlete?.displayName || p.athlete?.fullName || '').toLowerCase().includes(search.toLowerCase()))
    : players;

  // Leader preview — first player after sort = position 1
  const leader      = players[0];
  const leaderName  = leader?.athlete?.displayName?.split(' ').slice(-1)[0] || '';
  const leaderScore = leader?.statistics?.[0]?.displayValue || leader?.score?.displayValue || '';

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${isLive ? 'rgba(74,222,128,0.35)' : open ? 'rgba(255,184,0,0.25)' : 'var(--border)'}`,
      borderRadius: '10px',
      overflow: 'hidden',
      boxShadow: isLive ? '0 2px 14px rgba(74,222,128,0.08)' : 'none',
      transition: 'border-color 0.15s',
    }}>
      {/* ── Header row — always visible, click to expand ── */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: isMobile ? '10px 12px' : '11px 16px',
          cursor: 'pointer', userSelect: 'none',
          background: isLive ? 'rgba(74,222,128,0.04)' : 'transparent',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { if (!isLive) e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
        onMouseLeave={e => { if (!isLive) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Live dot or status icon */}
        <div style={{ flexShrink: 0 }}>
          {isLive
            ? <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', display: 'inline-block', animation: 'live-pulse 2s infinite' }} />
            : isComplete
            ? <span style={{ fontSize: '0.75rem' }}>✅</span>
            : <span style={{ fontSize: '0.75rem' }}>⏰</span>}
        </div>

        {/* Tournament info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: isMobile ? '0.88rem' : '0.92rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile ? '180px' : 'none' }}>
              {name}
            </span>
            {isLive && (
              <span style={{ fontSize: '0.6rem', background: 'rgba(74,222,128,0.12)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.3)', borderRadius: '10px', padding: '1px 7px', fontWeight: 800, flexShrink: 0 }}>
                LIVE
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '2px', flexWrap: 'wrap' }}>
            {venue && <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>📍 {venue}{city ? `, ${city}` : ''}{stateAbbr && city ? ` ${stateAbbr}` : ''}</span>}
          </div>
        </div>

        {/* Right stats */}
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexShrink: 0 }}>
          {purseLabel && !isMobile && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.57rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Purse</div>
              <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.8rem', color: '#FFB800' }}>{purseLabel}</div>
            </div>
          )}
          {!isMobile && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.57rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Status</div>
              <div style={{ fontSize: '0.72rem', color: isLive ? '#4ade80' : isComplete ? 'var(--text-muted)' : '#60a5fa', fontWeight: 600, whiteSpace: 'nowrap' }}>{roundLabel}</div>
            </div>
          )}
          {!open && players.length > 0 && leaderName && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '0.57rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Leader</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {leaderName}&nbsp;
                <span style={{ fontFamily: 'IBM Plex Mono', color: scoreColor(leaderScore === 'E' ? 0 : parseInt(leaderScore)) }}>
                  {fmtScore(leaderScore)}
                </span>
              </div>
            </div>
          )}
          {/* Expand chevron */}
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', transition: 'transform 0.2s', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
        </div>
      </div>

      {/* ── Expanded leaderboard ── */}
      {open && (
        <div style={{ borderTop: `1px solid ${isLive ? 'rgba(74,222,128,0.15)' : 'var(--border)'}` }}>
          {/* Status / purse strip */}
          <div style={{ display: 'flex', gap: '12px', padding: isMobile ? '5px 12px' : '5px 16px', background: 'rgba(255,255,255,0.015)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', color: isLive ? '#4ade80' : isComplete ? 'var(--text-muted)' : '#60a5fa', fontWeight: 700 }}>
              {roundLabel}
            </span>
            {purseLabel && (
              <span style={{ fontSize: '0.7rem', fontFamily: 'IBM Plex Mono', color: '#FFB800', fontWeight: 700 }}>💰 {purseLabel}</span>
            )}
            <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {players.length} players
            </span>
          </div>

          {players.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              No leaderboard data yet — check back when the round starts.
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile
                  ? '30px 1fr 44px 40px 40px 28px'
                  : '40px 32px 1fr 56px 50px 50px 60px 28px',
                padding: isMobile ? '5px 12px' : '5px 14px',
                background: 'rgba(255,255,255,0.02)',
                borderTop: '1px solid rgba(255,255,255,0.04)',
              }}>
                {(isMobile
                  ? ['Pos', 'Player', 'Par', 'Today', 'Thru', '']
                  : ['Pos', '', 'Player', 'To Par', 'Today', 'Thru', 'Total', '']
                ).map((h, i) => (
                  <div key={i} style={{
                    fontSize: '0.57rem', textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: 'var(--text-muted)',
                    textAlign: i >= (isMobile ? 2 : 3) ? 'center' : 'left',
                    ...(i === 6 ? { textAlign: 'right' } : {}),
                  }}>
                    {h}
                  </div>
                ))}
              </div>

              {/* Player rows — sync starred stats on every render with fresh data */}
              {(() => { syncStarredGolferStats(players, name); return null; })()}
              {filtered.slice(0, 60).map((player, i) => (
                <PlayerRow
                  key={player.id || player.athlete?.id || i}
                  player={{ ...player, _isLead: i === 0 }}
                  isMobile={isMobile}
                  tournamentName={name}
                  eventId={eventId}
                  league={league}
                />
              ))}

              {filtered.length > 60 && (
                <div style={{ padding: '8px', textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                  Showing top 60 of {filtered.length} players
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function GolfLeaderboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [league, setLeague]   = useState('pga');
  const isMobile              = useIsMobile();

  const leagues = [
    { id: 'pga',  label: 'PGA Tour', emoji: '🇺🇸' },
    { id: 'lpga', label: 'LPGA',     emoji: '👩' },
    { id: 'euro', label: 'DP World', emoji: '🇪🇺' },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`/api/sports?sport=golf&endpoint=leaderboard&league=${league}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load golf data');
    } finally {
      setLoading(false);
    }
  }, [league]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  // ESPN golf leaderboard response nests events differently depending on version
  const events =
    data?.events ||
    data?.sports?.[0]?.leagues?.[0]?.events ||
    data?.leagues?.[0]?.events ||
    [];

  // Sort: live first, then upcoming, then completed
  const sorted = [...events].sort((a, b) => {
    const stateOrder = { in: 0, pre: 1, post: 2 };
    const sa = stateOrder[a.status?.type?.state] ?? 1;
    const sb = stateOrder[b.status?.type?.state] ?? 1;
    return sa - sb;
  });

  const liveCount = events.filter(e => e.status?.type?.state === 'in').length;

  return (
    <div className="fade-in">
      {/* Controls */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {leagues.map(l => (
          <button key={l.id} onClick={() => { setLeague(l.id); setSearch(''); }} style={{
            padding: '5px 12px', borderRadius: '20px', fontSize: '0.78rem', cursor: 'pointer',
            border: `1px solid ${league === l.id ? '#22c55e' : 'var(--border)'}`,
            background: league === l.id ? 'rgba(34,197,94,0.12)' : 'transparent',
            color: league === l.id ? '#22c55e' : 'var(--text-muted)',
            fontWeight: league === l.id ? 700 : 400,
          }}>
            {l.emoji} {l.label}
          </button>
        ))}
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search player…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input"
            style={{ width: '140px', padding: '4px 10px', fontSize: '0.78rem' }}
          />
          <button onClick={load} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px', fontSize: '0.75rem' }}>
            ↻
          </button>
        </div>
      </div>

      {/* Live badge */}
      {liveCount > 0 && (
        <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', animation: 'live-pulse 2s infinite', display: 'inline-block' }} />
          <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 700 }}>
            {liveCount} tournament{liveCount !== 1 ? 's' : ''} in progress
          </span>
        </div>
      )}

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⛳</div>
          <p style={{ fontSize: '0.85rem' }}>Loading golf tournaments…</p>
        </div>
      ) : error ? (
        <div style={{ padding: '1.5rem', background: '#2b0d0d', border: '1px solid #991b1b', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
          ⚠️ {error}
          <button onClick={load} style={{ marginLeft: '12px', background: 'none', border: '1px solid #f87171', borderRadius: '4px', color: '#f87171', cursor: 'pointer', padding: '2px 8px', fontSize: '0.75rem' }}>
            Retry
          </button>
        </div>
      ) : sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⛳</div>
          <p>No tournaments available right now.</p>
          <p style={{ fontSize: '0.78rem', marginTop: '4px' }}>Check back during tournament rounds (Thu–Sun).</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {sorted.map((event, i) => (
            <TournamentCard
              key={event.id || i}
              event={event}
              defaultOpen={i === 0}
              search={search}
              isMobile={isMobile}
              league={league}
            />
          ))}
        </div>
      )}
    </div>
  );
}
