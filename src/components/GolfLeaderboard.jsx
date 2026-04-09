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
    const newPosition = p.status?.position?.displayName || '—';
    const newToPar    = stats[0]?.displayValue ?? p.score?.displayValue ?? '—';
    const newThru     = String(p.status?.thru ?? stats[1]?.displayValue ?? '—');
    const newToday    = stats[2]?.displayValue ?? '—';
    const newTournament = tournamentName || starred[id].tournament;

    // Only write if something actually changed — avoids spurious storage events that
    // cause FeaturedGamesTab to re-render even when no data changed.
    const cur = starred[id];
    if (
      cur.position === newPosition &&
      cur.toPar === newToPar &&
      cur.thru === newThru &&
      cur.today === newToday &&
      cur.tournament === newTournament
    ) continue;

    starred[id] = {
      ...cur,
      tournament: newTournament,
      position:   newPosition,
      toPar:      newToPar,
      thru:       newThru,
      today:      newToday,
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

// ── Robust golf statistics parser ────────────────────────────────────────────
// ESPN sometimes injects win odds (e.g. +208) at statistics[2] for featured
// players, which shifts all subsequent stats. Detect and handle this gracefully.
function parseGolfStats(statistics) {
  const stats = statistics || [];
  const toPar  = stats[0]?.displayValue ?? '—';
  const thru   = stats[1]?.displayValue ?? '—';

  let today    = '—';
  let total    = '—';
  let winOdds  = null;

  // stats[2] is normally "today" but ESPN sometimes puts win-odds there for featured players.
  // A golf round score relative to par is always between -15 and +18 at most (pros never
  // shoot higher). Any integer outside that range is almost certainly odds, not a score.
  const raw2 = stats[2]?.displayValue;
  if (raw2 != null) {
    const n2 = parseInt(raw2);
    const looksLikeScore = !isNaN(n2) && n2 >= -15 && n2 <= 18;
    if (!isNaN(n2) && !looksLikeScore) {
      // Out-of-range for a golf round score → treat as win odds
      winOdds = n2 > 0 ? `+${n2}` : `${n2}`;
      today   = stats[3]?.displayValue ?? '—';
      total   = stats[4]?.displayValue ?? stats[3]?.displayValue ?? '—';
    } else if (raw2 !== null && raw2 !== undefined) {
      today = raw2;
      total = stats[3]?.displayValue ?? '—';
    }
  }

  return { toPar, thru, today, total, winOdds };
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
  // Fallback: use today's round score pace (use robust parser to avoid odds contamination)
  const parsed_   = parseGolfStats(player.statistics);
  const todayStr  = parsed_.today;
  const thruVal   = player.status?.thru ?? parsed_.thru;
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

// ── Score cell — colored circle matching Flashscore style ────────────────────
function ScoreCell({ hole }) {
  const meta  = scoreTypeMeta(hole?.scoreType?.name);
  const score = hole?.displayValue ?? (hole?.score != null ? String(hole.score) : null);
  if (score == null) return <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: '0.68rem' }}>–</span>;

  // Eagle/albatross: double circle (two nested squares visually done with outline + fill)
  // Birdie: single filled circle
  // Par: just the number
  // Bogey: single square outline
  // Double bogey: double square
  const isEagle  = meta && (meta.label === 'Eagle' || meta.label === '2-Eagle' || meta.label === 'Albatross');
  const isBirdie = meta?.label === 'Birdie';
  const isBogey  = meta?.label === 'Bogey';
  const isDblBog = meta?.label === 'Dbl Bogey' || meta?.label === 'Triple+';
  const isPar    = meta?.label === 'Par';

  const baseStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.72rem',
    width: '22px', height: '22px', lineHeight: 1,
    color: meta?.color || 'var(--text-secondary)',
    position: 'relative',
  };

  if (isEagle) {
    return (
      <span style={{ ...baseStyle, borderRadius: '50%', background: meta.bg, border: `2px solid ${meta.color}`, outline: `1px solid ${meta.color}`, outlineOffset: '2px' }}>
        {score}
      </span>
    );
  }
  if (isBirdie) {
    return (
      <span style={{ ...baseStyle, borderRadius: '50%', background: meta.bg, border: `1.5px solid ${meta.color}` }}>
        {score}
      </span>
    );
  }
  if (isDblBog) {
    return (
      <span style={{ ...baseStyle, borderRadius: '2px', background: meta.bg, border: `2px solid ${meta.color}`, outline: `1px solid ${meta.color}`, outlineOffset: '2px' }}>
        {score}
      </span>
    );
  }
  if (isBogey) {
    return (
      <span style={{ ...baseStyle, borderRadius: '2px', background: meta.bg, border: `1.5px solid ${meta.color}` }}>
        {score}
      </span>
    );
  }
  // Par or unknown
  return <span style={{ ...baseStyle, color: isPar ? '#94a3b8' : 'var(--text-secondary)' }}>{score}</span>;
}

// ── Inline scorecard panel ─────────────────────────────────────────────────────
function InlineScorecardPanel({ player, eventId, league, onClose }) {
  const [rounds, setRounds]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [activeRound, setActiveRound] = useState(0);

  const athleteId = player.id || player.athlete?.id;
  const name      = player.athlete?.displayName || player.athlete?.fullName || 'Player';
  const stats     = player.statistics || [];
  const toPar     = stats[0]?.displayValue ?? '—';
  const thru      = player.status?.thru ?? stats[1]?.displayValue ?? '—';

  // Normalize a raw hole/linescore entry — ESPN uses 'period' + 'value', some
  // endpoints use 'number' + 'score'. Accept both and produce a consistent shape.
  function normalizeHole(h, i) {
    return {
      number:       h.period  ?? h.number ?? (i + 1),
      par:          h.par     ?? null,
      score:        h.value   ?? h.score  ?? null,
      displayValue: h.displayValue ?? null,
      scoreType:    h.scoreType    ?? null,
    };
  }

  // Normalize a round — ESPN returns linescores (not holes) inside each round.
  function normalizeRound(r) {
    const rawHoles = r.holes || r.linescores || [];
    return {
      number: r.number,
      value:  r.value ?? r.scoreToPar ?? null,
      par:    r.par   ?? null,
      total:  r.score ?? r.total ?? null,
      holes:  rawHoles.map(normalizeHole),
    };
  }

  useEffect(() => {
    if (!athleteId || !eventId) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/sports?sport=golf&endpoint=scorecard&league=${league || 'pga'}&athleteId=${athleteId}&eventId=${eventId}`)
      .then(r => r.json())
      .then(d => {
        if (d.error && !d.rounds?.length) throw new Error(d.error);
        // ESPN may nest rounds under d.player.rounds or return them at the top level
        const rawRounds = d.rounds || d.player?.rounds || [];
        // Accept rounds with hole data AND rounds with just totals (from leaderboard fallback)
        const withHoles = rawRounds.map(normalizeRound).filter(r => r.holes.length > 0);
        if (withHoles.length > 0) {
          setRounds(withHoles);
          setActiveRound(withHoles.length - 1);
        } else if (rawRounds.length > 0) {
          // Rounds exist but without per-hole data — keep them for round-score display
          const roundSummaries = rawRounds.map(r => ({
            number: r.number,
            value:  r.value ?? r.scoreToPar ?? null,
            par:    r.par ?? null,
            total:  r.score ?? r.total ?? null,
            holes:  [],
          })).filter(r => r.total != null);
          setRounds(roundSummaries);
          if (roundSummaries.length > 0) setActiveRound(roundSummaries.length - 1);
        }
      })
      .catch(e => setError(e.message || 'Could not load scorecard'))
      .finally(() => setLoading(false));
  }, [athleteId, eventId, league]); // eslint-disable-line react-hooks/exhaustive-deps

  // Build from linescores as fallback (leaderboard data — may have hole-by-hole)
  const fallbackRounds = (() => {
    if (rounds?.length) return null;
    const ls = player.linescores || [];

    // Check for per-hole data in linescores
    const hasHoleData = ls.some(h => h.scoreType || h.par != null);
    if (hasHoleData && ls.length > 0) {
      return [{ number: 'Current', value: null, holes: ls.map(normalizeHole) }];
    }

    // Build round-level scores from player.statistics (indices 3+ may be round stroke counts).
    // Filter to realistic individual round scores (55–90) to exclude total-tournament scores
    // (typically 260–290) that ESPN sometimes puts at stats[3].
    const stats = player.statistics || [];
    const roundScores = [];
    for (let i = 3; i < stats.length; i++) {
      const val = stats[i]?.displayValue;
      if (!val) continue;
      const n = parseInt(val);
      if (!isNaN(n) && n >= 55 && n <= 90) {
        roundScores.push({
          number: roundScores.length + 1, // sequential: R1, R2, R3, R4
          total:  n,
          value:  null,
          par:    null,
          holes:  [],
        });
      }
    }
    if (roundScores.length > 0) return roundScores;

    return null;
  })();

  const displayRounds = rounds?.length ? rounds : (fallbackRounds || []);
  const round = displayRounds[activeRound] || displayRounds[0];
  const holes = round?.holes || [];

  // Split front 9 / back 9
  const front9 = holes.filter(h => h.number <= 9);
  const back9  = holes.filter(h => h.number >= 10);
  const front9Par   = front9.reduce((s, h) => s + (h.par || 0), 0);
  const back9Par    = back9.reduce((s, h) => s + (h.par || 0), 0);
  const front9Score = front9.reduce((s, h) => s + (h.score ?? 0), 0);
  const back9Score  = back9.reduce((s, h) => s + (h.score ?? 0), 0);
  const hasPar  = holes.some(h => h.par != null);

  // Row style builder
  function rowStyle(isHeader) {
    return {
      display: 'flex', alignItems: 'center',
      background: isHeader ? 'rgba(255,255,255,0.03)' : 'transparent',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
    };
  }
  const cellBase = {
    fontFamily: 'IBM Plex Mono', fontSize: '0.7rem',
    textAlign: 'center', flexShrink: 0,
    width: '26px', padding: '4px 1px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
  const labelCell = { ...cellBase, width: '44px', textAlign: 'left', paddingLeft: '8px', fontWeight: 700, fontSize: '0.65rem', color: 'var(--text-muted)' };
  const subtotalCell = { ...cellBase, width: '34px', fontWeight: 800, borderLeft: '1px solid rgba(255,255,255,0.08)', borderRight: '1px solid rgba(255,255,255,0.08)' };

  // Scorecard row for a set of holes
  function ScorecardRow({ type, holeSet, subtotal, subtotalPar }) {
    const isHeader = type === 'header';
    const isPar    = type === 'par';
    const isScore  = type === 'score';
    const isSubPar = type === 'sub-par';

    return (
      <div style={rowStyle(isHeader)}>
        <div style={labelCell}>
          {isHeader ? 'Hole' : isPar ? 'Par' : isScore ? 'Score' : ''}
        </div>
        {holeSet.map((h, i) => {
          const val = isHeader ? h.number : isPar ? (h.par ?? '—') : isScore ? null : null;
          return (
            <div key={i} style={{ ...cellBase, color: isPar ? '#94a3b8' : 'var(--text-primary)', fontWeight: isHeader ? 700 : 500 }}>
              {isHeader && <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{h.number}</span>}
              {isPar && <span>{h.par ?? '—'}</span>}
              {isScore && <ScoreCell hole={h} />}
            </div>
          );
        })}
        {/* Subtotal */}
        {subtotal !== undefined && (
          <div style={{
            ...subtotalCell,
            color: isHeader ? 'var(--text-muted)' : isPar ? '#94a3b8' : scoreColor(subtotalPar != null && subtotal != null ? subtotal - subtotalPar : 0),
          }}>
            {isHeader ? (holeSet[0]?.number <= 9 ? 'OUT' : 'IN') : (subtotal || '—')}
          </div>
        )}
      </div>
    );
  }

  const roundToParNum = round?.value ?? (round?.total != null && round?.par != null ? round.total - round.par : null);

  return (
    <div style={{
      gridColumn: '1 / -1', // span all columns in the parent grid
      background: 'rgba(34,197,94,0.04)',
      borderTop: '1px solid rgba(34,197,94,0.15)',
      borderBottom: '1px solid rgba(34,197,94,0.15)',
      padding: '10px 12px',
    }}>
      {/* Header: player name + round total + close */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{name}</span>
          <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.82rem', color: scoreColor(toPar === 'E' ? 0 : parseInt(toPar)) }}>
            {fmtScore(toPar)}
          </span>
          {thru && thru !== '—' && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Thru {thru}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Round tabs */}
          {displayRounds.length > 1 && displayRounds.map((r, i) => (
            <button
              key={i}
              onClick={() => setActiveRound(i)}
              style={{
                padding: '2px 8px', borderRadius: '5px', fontSize: '0.65rem', cursor: 'pointer', fontWeight: 700,
                border: `1px solid ${activeRound === i ? 'rgba(34,197,94,0.5)' : 'var(--border)'}`,
                background: activeRound === i ? 'rgba(34,197,94,0.12)' : 'transparent',
                color: activeRound === i ? '#22c55e' : 'var(--text-muted)',
              }}
            >
              R{r.number}
              {r.value != null && (
                <span style={{ marginLeft: '3px', color: scoreColor(r.value) }}>
                  {fmtScore(r.value)}
                </span>
              )}
            </button>
          ))}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', padding: '2px 6px', borderRadius: '4px' }}
          >
            ▲ collapse
          </button>
        </div>
      </div>

      {/* Scorecard body */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          ⛳ Loading scorecard…
        </div>
      ) : error && !displayRounds.length ? (
        <div style={{ padding: '0.75rem', color: '#f87171', fontSize: '0.75rem', background: 'rgba(248,113,113,0.06)', borderRadius: '6px' }}>
          ⚠️ Scorecard not available yet — check back during or after the round.
        </div>
      ) : !displayRounds.length ? (
        <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
          No hole-by-hole data available yet.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: '480px' }}>
            {/* Round score summary pill */}
            {round && (
              <div style={{ display: 'flex', gap: '10px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Round {round.number}
                </span>
                {roundToParNum != null && (
                  <span style={{
                    fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.8rem',
                    color: scoreColor(roundToParNum),
                    background: roundToParNum < 0 ? 'rgba(74,222,128,0.08)' : roundToParNum > 0 ? 'rgba(248,113,113,0.08)' : 'rgba(148,163,184,0.08)',
                    border: `1px solid ${roundToParNum < 0 ? 'rgba(74,222,128,0.25)' : roundToParNum > 0 ? 'rgba(248,113,113,0.25)' : 'rgba(148,163,184,0.2)'}`,
                    borderRadius: '6px', padding: '1px 8px',
                  }}>
                    {fmtScore(roundToParNum)}
                  </span>
                )}
                {round.total != null && (
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {round.total} strokes
                  </span>
                )}
              </div>
            )}

            {holes.length === 0 ? (
              <div style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                {/* Show round-by-round summary even without hole data */}
                {displayRounds.length > 0 && displayRounds.some(r => r.total != null) ? (
                  <div>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
                      Round-by-Round Scores
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {displayRounds.map((r, i) => {
                        const toPar = r.value ?? (r.total && r.par ? r.total - r.par : null);
                        return (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '8px 14px', borderRadius: '8px',
                            background: activeRound === i ? 'rgba(34,197,94,0.08)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${activeRound === i ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.06)'}`,
                            cursor: 'pointer',
                          }} onClick={() => setActiveRound(i)}>
                            <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)' }}>R{r.number}</span>
                            <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                              {r.total ?? '—'}
                            </span>
                            {toPar != null && (
                              <span style={{
                                fontFamily: 'IBM Plex Mono', fontSize: '0.72rem', fontWeight: 700,
                                color: scoreColor(toPar),
                                background: toPar < 0 ? 'rgba(74,222,128,0.1)' : toPar > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(148,163,184,0.08)',
                                padding: '1px 6px', borderRadius: '4px',
                              }}>
                                {fmtScore(toPar)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '0.65rem', color: 'var(--text-muted)', opacity: 0.6 }}>
                      Hole-by-hole detail not available from ESPN for this event.
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: 'center' }}>Hole-by-hole data will appear once this round starts.</div>
                )}
              </div>
            ) : (
              <>
                {/* Front 9 */}
                {front9.length > 0 && (
                  <div style={{ marginBottom: '8px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', overflow: 'hidden' }}>
                    {/* Header */}
                    <div style={rowStyle(true)}>
                      <div style={labelCell}>Hole</div>
                      {front9.map(h => <div key={h.number} style={{ ...cellBase, color: 'var(--text-muted)', fontWeight: 700 }}>{h.number}</div>)}
                      <div style={{ ...subtotalCell, color: 'var(--text-muted)', fontWeight: 700 }}>OUT</div>
                    </div>
                    {/* Par row */}
                    {hasPar && (
                      <div style={rowStyle(false)}>
                        <div style={labelCell}>Par</div>
                        {front9.map(h => <div key={h.number} style={{ ...cellBase, color: '#94a3b8' }}>{h.par ?? '—'}</div>)}
                        <div style={{ ...subtotalCell, color: '#94a3b8' }}>{front9Par || '—'}</div>
                      </div>
                    )}
                    {/* Score row */}
                    <div style={{ ...rowStyle(false), background: 'rgba(255,255,255,0.015)' }}>
                      <div style={{ ...labelCell, color: 'var(--text-secondary)', fontWeight: 700 }}>Score</div>
                      {front9.map(h => <div key={h.number} style={{ ...cellBase }}><ScoreCell hole={h} /></div>)}
                      <div style={{
                        ...subtotalCell,
                        fontWeight: 800,
                        color: hasPar && front9Par ? scoreColor(front9Score - front9Par) : 'var(--text-primary)',
                      }}>
                        {front9.some(h => h.score != null) ? front9Score : '—'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Back 9 */}
                {back9.length > 0 && (
                  <div style={{ marginBottom: '8px', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={rowStyle(true)}>
                      <div style={labelCell}>Hole</div>
                      {back9.map(h => <div key={h.number} style={{ ...cellBase, color: 'var(--text-muted)', fontWeight: 700 }}>{h.number}</div>)}
                      <div style={{ ...subtotalCell, color: 'var(--text-muted)', fontWeight: 700 }}>IN</div>
                    </div>
                    {hasPar && (
                      <div style={rowStyle(false)}>
                        <div style={labelCell}>Par</div>
                        {back9.map(h => <div key={h.number} style={{ ...cellBase, color: '#94a3b8' }}>{h.par ?? '—'}</div>)}
                        <div style={{ ...subtotalCell, color: '#94a3b8' }}>{back9Par || '—'}</div>
                      </div>
                    )}
                    <div style={{ ...rowStyle(false), background: 'rgba(255,255,255,0.015)' }}>
                      <div style={{ ...labelCell, color: 'var(--text-secondary)', fontWeight: 700 }}>Score</div>
                      {back9.map(h => <div key={h.number} style={{ ...cellBase }}><ScoreCell hole={h} /></div>)}
                      <div style={{
                        ...subtotalCell,
                        fontWeight: 800,
                        color: hasPar && back9Par ? scoreColor(back9Score - back9Par) : 'var(--text-primary)',
                      }}>
                        {back9.some(h => h.score != null) ? back9Score : '—'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Legend */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                  {[
                    { label: 'Eagle', desc: '2+ under', color: '#FFB800', shape: 'circle-double' },
                    { label: 'Birdie', desc: '1 under', color: '#4ade80', shape: 'circle' },
                    { label: 'Par', desc: 'Even', color: '#94a3b8', shape: 'none' },
                    { label: 'Bogey', desc: '1 over', color: '#fb923c', shape: 'square' },
                    { label: 'Dbl+', desc: '2+ over', color: '#f87171', shape: 'square-double' },
                  ].map(({ label, color, shape }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '14px', height: '14px', fontSize: '0.6rem', fontFamily: 'IBM Plex Mono', fontWeight: 800,
                        color,
                        borderRadius: shape.includes('circle') ? '50%' : shape === 'none' ? 0 : '2px',
                        border: shape === 'none' ? 'none' : `1.5px solid ${color}`,
                        outline: shape.includes('double') ? `1px solid ${color}` : 'none',
                        outlineOffset: shape.includes('double') ? '2px' : 0,
                      }}>
                        {label === 'Par' ? '4' : label === 'Birdie' ? '3' : label === 'Eagle' ? '2' : label === 'Bogey' ? '5' : '6'}
                      </span>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Player row ────────────────────────────────────────────────────────────────
function PlayerRow({ player, isMobile, tournamentName, eventId, league }) {
  const parsed     = parseGolfStats(player.statistics);
  const toPar      = parsed.toPar !== '—' ? parsed.toPar : (player.score?.displayValue ?? '—');
  const thru       = player.status?.thru ?? parsed.thru;
  const todayScore = parsed.today;
  const totalScore = parsed.total !== '—' ? parsed.total : (player.score?.value ?? '—');
  const winOdds    = parsed.winOdds;
  const toParNum   = toPar === 'E' ? 0 : parseInt(toPar);
  const todayNum   = todayScore === 'E' ? 0 : parseInt(todayScore);
  const isLead     = player.status?.position?.displayName === '1' || player._isLead;
  const isCut      = player.status?.type === 'cut';
  const pos        = player.status?.position?.displayName || '—';

  const hotCold    = getHotCold(player);
  const lastHole   = getLastHole(player);
  const lastMeta   = lastHole ? scoreTypeMeta(lastHole.scoreType?.name) : null;

  const [starred, setStarred]           = useState(() => isGolferStarred(player));
  const [showScorecard, setScorecard]   = useState(false);
  const toggleScorecard = () => setScorecard(v => !v);

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
          : '40px 32px 1fr 56px 50px 50px 60px 56px 28px',
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
              onClick={toggleScorecard}
              title={showScorecard ? 'Close scorecard' : 'View scorecard'}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: isMobile ? '0.82rem' : '0.85rem', fontWeight: 600,
                color: showScorecard ? '#60a5fa' : 'var(--text-primary)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textDecoration: 'underline',
                textDecorationColor: showScorecard ? '#60a5fa' : 'rgba(255,255,255,0.15)',
                textUnderlineOffset: '2px',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#60a5fa'; e.currentTarget.style.textDecorationColor = '#60a5fa'; }}
              onMouseLeave={e => { e.currentTarget.style.color = showScorecard ? '#60a5fa' : 'var(--text-primary)'; e.currentTarget.style.textDecorationColor = showScorecard ? '#60a5fa' : 'rgba(255,255,255,0.15)'; }}
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
        {/* Win Odds — desktop only */}
        {!isMobile && (
          <div style={{ textAlign: 'center' }}>
            {winOdds ? (
              <span style={{
                fontSize: '0.65rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px',
                background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)',
                color: '#93c5fd', fontFamily: 'IBM Plex Mono, monospace',
              }}>
                {winOdds}
              </span>
            ) : <span style={{ color: 'rgba(255,255,255,0.12)', fontSize: '0.68rem' }}>—</span>}
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

      {/* Inline scorecard — spans full width below this row */}
      {showScorecard && (
        <InlineScorecardPanel
          player={player}
          eventId={eventId}
          onClose={toggleScorecard}
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

  // Sync starred golfer stats (position/score) whenever fresh data arrives from ESPN.
  // This must be in a useEffect — NOT inline in JSX — to avoid a render-time side effect
  // that dispatches a storage event, which would re-trigger ScoreboardTab's useStarredGames
  // listener and cause an infinite re-render loop crashing the browser tab.
  //
  // We deliberately serialize rawPlayers to a JSON string as the dep key. The rawPlayers
  // array is a new reference on every render (inline || chain), so using it directly would
  // run the effect on every render. The JSON string only changes when player data changes.
  const rawPlayersKey = JSON.stringify(rawPlayers);
  useEffect(() => {
    syncStarredGolferStats(rawPlayers, name);
  }, [rawPlayersKey, name]); // eslint-disable-line react-hooks/exhaustive-deps

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
                  : '40px 32px 1fr 56px 50px 50px 60px 56px 28px',
                padding: isMobile ? '5px 12px' : '5px 14px',
                background: 'rgba(255,255,255,0.02)',
                borderTop: '1px solid rgba(255,255,255,0.04)',
              }}>
                {(isMobile
                  ? ['Pos', 'Player', 'Par', 'Today', 'Thru', '']
                  : ['Pos', '', 'Player', 'To Par', 'Today', 'Thru', 'Total', 'Odds', '']
                ).map((h, i) => (
                  <div key={i} style={{
                    fontSize: '0.57rem', textTransform: 'uppercase', letterSpacing: '0.08em',
                    color: h === 'Odds' ? '#93c5fd' : 'var(--text-muted)',
                    textAlign: i >= (isMobile ? 2 : 3) ? 'center' : 'left',
                    ...(i === 6 ? { textAlign: 'right' } : {}),
                  }}>
                    {h}
                  </div>
                ))}
              </div>

              {/* Player rows */}
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
const ALL_LEAGUES = [
  { id: 'pga',  label: 'PGA Tour', emoji: '🇺🇸' },
  { id: 'lpga', label: 'LPGA',     emoji: '👩' },
  { id: 'euro', label: 'DP World', emoji: '🇪🇺' },
];

export default function GolfLeaderboard() {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [search, setSearch]           = useState('');
  const [league, setLeague]           = useState('pga');
  // Only show leagues whose ESPN endpoint responds without error
  const [availableLeagues, setAvailableLeagues] = useState(ALL_LEAGUES);
  const [probing, setProbing]         = useState(true);
  const isMobile                      = useIsMobile();

  // On mount: probe all leagues in parallel and hide any that return an API error
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      const results = await Promise.allSettled(
        ALL_LEAGUES.map(l =>
          fetch(`/api/sports?sport=golf&endpoint=leaderboard&league=${l.id}`)
            .then(r => r.json())
            .then(json => ({ id: l.id, ok: !json.error }))
            .catch(() => ({ id: l.id, ok: false }))
        )
      );
      if (cancelled) return;
      const available = ALL_LEAGUES.filter((l, i) => {
        const r = results[i];
        return r.status === 'fulfilled' && r.value.ok;
      });
      // Fall back to PGA if nothing is available (shouldn't happen)
      const finalList = available.length > 0 ? available : [ALL_LEAGUES[0]];
      setAvailableLeagues(finalList);
      // Auto-select first available league (prefer PGA if it's in the list)
      const pgaAvailable = finalList.some(l => l.id === 'pga');
      setLeague(pgaAvailable ? 'pga' : finalList[0].id);
      setProbing(false);
    }
    probe();
    return () => { cancelled = true; };
  }, []);

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

  useEffect(() => { if (!probing) load(); }, [load, probing]);
  useEffect(() => {
    if (probing) return;
    const t = setInterval(load, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, [load, probing]);

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
        {availableLeagues.map(l => (
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
