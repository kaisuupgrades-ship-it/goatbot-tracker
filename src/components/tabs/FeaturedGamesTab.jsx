'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { GameCard, sortAllSportsEvents, useStarredGames } from './ScoreboardTab';
import { InlineScorecardPanel } from '../GolfLeaderboard';

// ── helpers ───────────────────────────────────────────────────────────────────
function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

const SPORT_LABELS = {
  mlb:   { label: 'MLB',   emoji: '⚾' },
  nfl:   { label: 'NFL',   emoji: '🏈' },
  nba:   { label: 'NBA',   emoji: '🏀' },
  nhl:   { label: 'NHL',   emoji: '🏒' },
  ncaaf: { label: 'NCAAF', emoji: '🏈' },
  ncaab: { label: 'NCAAB', emoji: '🏀' },
  mls:   { label: 'MLS',   emoji: '⚽' },
  wnba:  { label: 'WNBA',  emoji: '🏀' },
};

// ── Extract competitors from ESPN event ───────────────────────────────────────
function getEventCompetitors(event) {
  const comp = event?.competitions?.[0]?.competitors || [];
  const away = comp.find(c => c.homeAway === 'away') || comp[0] || {};
  const home = comp.find(c => c.homeAway === 'home') || comp[1] || {};
  return { away, home };
}

// ── Match user picks to a game ────────────────────────────────────────────────
// Checks pick.team and pick.matchup against all team identifiers in the event
function matchPicksToGame(picks, event) {
  if (!picks?.length) return [];
  const { away, home } = getEventCompetitors(event);

  function teamTokens(team) {
    return [
      team?.abbreviation,
      team?.displayName,
      team?.name,
      team?.shortDisplayName,
      // Last word of display name catches "Cardinals", "Yankees", etc.
      team?.displayName?.split(' ')?.pop(),
    ].filter(t => t && t.length >= 2).map(t => t.toUpperCase());
  }

  const allTokens = [...teamTokens(away.team), ...teamTokens(home.team)];

  return (picks || []).filter(pick => {
    // Skip already-settled picks
    if (pick.result && pick.result !== 'PENDING' && pick.result !== '') return false;
    const haystack = ((pick.team || '') + ' ' + (pick.matchup || '')).toUpperCase();
    return allTokens.some(t => haystack.includes(t));
  });
}

// ── Calculate live bet tracking status ────────────────────────────────────────
// Returns { status: 'winning'|'losing'|'push'|null, detail: string|null }
function calcBetStatus(pick, event) {
  if (event?.status?.type?.state !== 'in') return { status: null, detail: null };

  const { away, home } = getEventCompetitors(event);
  const awayScore  = parseInt(away.score) || 0;
  const homeScore  = parseInt(home.score) || 0;
  const period     = event.status?.period || 1;
  const sportKey   = (event._sport || '').toLowerCase();

  const awayAbbr     = (away.team?.abbreviation   || '').toUpperCase();
  const homeAbbr     = (home.team?.abbreviation   || '').toUpperCase();
  const awayLastWord = (away.team?.displayName    || '').toUpperCase().split(' ').pop() || '';
  const homeLastWord = (home.team?.displayName    || '').toUpperCase().split(' ').pop() || '';

  const betTypeLower = (pick.bet_type || '').toLowerCase();
  const pickTeamUp   = (pick.team     || '').toUpperCase();

  // Which side did they pick?
  const pickIsAway = [awayAbbr, awayLastWord].some(t => t.length >= 2 && pickTeamUp.includes(t));
  const pickIsHome = [homeAbbr, homeLastWord].some(t => t.length >= 2 && pickTeamUp.includes(t));

  // ── Moneyline ──────────────────────────────────────────────────────────────
  if (/moneyline|^ml$|f5.?moneyline/.test(betTypeLower)) {
    if (!pickIsAway && !pickIsHome) return { status: null, detail: null };
    const pickedScore = pickIsAway ? awayScore : homeScore;
    const oppScore    = pickIsAway ? homeScore : awayScore;
    const pickedAbbr  = pickIsAway ? awayAbbr  : homeAbbr;
    const oppAbbr     = pickIsAway ? homeAbbr  : awayAbbr;
    if (pickedScore > oppScore)  return { status: 'winning', detail: `${pickedAbbr} leads ${pickedScore}-${oppScore}` };
    if (pickedScore === oppScore) return { status: 'push',   detail: `Tied ${pickedScore}-${oppScore}` };
    return { status: 'losing', detail: `${pickedAbbr} trails ${pickedScore}-${oppScore}` };
  }

  // ── Spread / Run Line / Puck Line ─────────────────────────────────────────
  if (/spread|run.?line|puck.?line/.test(betTypeLower)) {
    if (!pickIsAway && !pickIsHome) return { status: null, detail: null };
    const pickedScore = pickIsAway ? awayScore : homeScore;
    const oppScore    = pickIsAway ? homeScore : awayScore;
    const diff        = pickedScore - oppScore;
    const pickedAbbr  = pickIsAway ? awayAbbr : homeAbbr;
    // Heuristic: need >1.5 lead to be clearly covering a typical spread
    if (diff >= 2)   return { status: 'winning', detail: `${pickedAbbr} leads by ${diff}` };
    if (diff === 1)  return { status: 'push',   detail: `${pickedAbbr} +1 (on the line)` };
    if (diff === 0)  return { status: 'push',   detail: `Tied ${pickedScore}-${oppScore}` };
    return { status: 'losing', detail: `${pickedAbbr} trails by ${Math.abs(diff)}` };
  }

  // ── Total (Over) ──────────────────────────────────────────────────────────
  if (/over/.test(betTypeLower)) {
    const lineNum = parseFloat((pick.team || '').replace(/[^\d.]/g, '')) || null;
    const current = awayScore + homeScore;
    if (lineNum == null) return { status: null, detail: null };
    if (current > lineNum) return { status: 'winning', detail: `${current} scored (over ${lineNum})` };
    // MLB pace projection: current runs ÷ inning × 9
    if (sportKey === 'mlb' && period > 0) {
      const pace = ((current / period) * 9).toFixed(1);
      const paceN = parseFloat(pace);
      const detail = `${current} runs · pace ${pace}/9`;
      if (paceN >= lineNum - 0.5) return { status: 'push', detail };
      return { status: 'losing', detail };
    }
    if (current >= lineNum - 1) return { status: 'push', detail: `${current} scored, need ${lineNum}` };
    return { status: 'losing', detail: `${current} scored, need ${lineNum}` };
  }

  // ── Total (Under) ─────────────────────────────────────────────────────────
  if (/under/.test(betTypeLower)) {
    const lineNum = parseFloat((pick.team || '').replace(/[^\d.]/g, '')) || null;
    const current = awayScore + homeScore;
    if (lineNum == null) return { status: null, detail: null };
    if (current >= lineNum) return { status: 'losing', detail: `${current} scored (over ${lineNum})` };
    if (sportKey === 'mlb' && period > 0) {
      const pace = ((current / period) * 9).toFixed(1);
      const paceN = parseFloat(pace);
      const detail = `${current} runs · pace ${pace}/9`;
      if (paceN <= lineNum + 0.5) return { status: 'winning', detail };
      return { status: 'push', detail };
    }
    if (current <= lineNum - 2) return { status: 'winning', detail: `${current} scored, under ${lineNum}` };
    return { status: 'push', detail: `${current} scored, close to ${lineNum}` };
  }

  return { status: null, detail: null };
}

// ── Status badge styles ────────────────────────────────────────────────────────
const STATUS_STYLES = {
  winning: { bg: 'rgba(0,212,139,0.12)', border: 'rgba(0,212,139,0.35)', color: '#00d48b', icon: '✅', label: 'WINNING' },
  push:    { bg: 'rgba(255,184,0,0.10)', border: 'rgba(255,184,0,0.35)',  color: '#FFB800', icon: '⚡', label: 'ON EDGE' },
  losing:  { bg: 'rgba(255,69,96,0.10)', border: 'rgba(255,69,96,0.30)',  color: '#FF4560', icon: '❌', label: 'LOSING'  },
};

// ── SCORE BUG ─────────────────────────────────────────────────────────────────
// Prominent live score display shown above the GameCard for in-progress games
function ScoreBug({ event, sport, isStarred = false, onUnstar, expanded = false, onToggleExpand }) {
  const { away, home } = getEventCompetitors(event);
  const awayScore    = away.score != null ? String(away.score) : null;
  const homeScore    = home.score != null ? String(home.score) : null;
  const awayAbbr     = away.team?.abbreviation || 'AWY';
  const homeAbbr     = home.team?.abbreviation || 'HME';
  const awayLogo     = away.team?.logo || null;
  const homeLogo     = home.team?.logo || null;
  const awayInt      = parseInt(awayScore) || 0;
  const homeInt      = parseInt(homeScore) || 0;
  const awayLeading  = awayScore != null && homeScore != null && awayInt > homeInt;
  const homeLeading  = awayScore != null && homeScore != null && homeInt > awayInt;
  const shortDetail  = event.status?.type?.shortDetail || 'LIVE';
  const displayClock = event.status?.displayClock;

  // Compose period label  e.g. "BOT 3RD" for MLB, "Q2  4:23" for NBA
  const periodLabel = [shortDetail, displayClock && displayClock !== '0:00' ? displayClock : null]
    .filter(Boolean).join('  ');

  return (
    <div style={{
      background: 'linear-gradient(160deg, #0d0d14 0%, #12121e 100%)',
      border: '1px solid rgba(255,69,96,0.28)',
      borderRadius: expanded ? '10px 10px 0 0' : '10px',
      padding: '0.85rem 1.1rem 0.8rem',
      boxShadow: expanded ? 'none' : '0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
    }}>

      {/* Top bar: LIVE badge + period + sport label */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Pulsing LIVE badge */}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '5px',
            background: 'rgba(255,69,96,0.18)', border: '1px solid rgba(255,69,96,0.45)',
            borderRadius: '4px', padding: '2px 8px',
            color: '#FF4560', fontSize: '0.6rem', fontWeight: 900, letterSpacing: '0.10em',
          }}>
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%', background: '#FF4560',
              display: 'inline-block', animation: 'live-pulse 1.5s ease-in-out infinite',
            }} />
            LIVE
          </span>
          {/* Period / clock */}
          {shortDetail && (
            <span style={{
              color: 'rgba(255,255,255,0.65)', fontSize: '0.72rem', fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              fontFamily: 'IBM Plex Mono, monospace',
            }}>
              {periodLabel}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {SPORT_LABELS[sport] && (
            <span style={{
              fontSize: '0.63rem', color: 'rgba(255,255,255,0.28)', fontWeight: 600,
              letterSpacing: '0.04em',
            }}>
              {SPORT_LABELS[sport].emoji} {SPORT_LABELS[sport].label}
            </span>
          )}
          <button
            onClick={e => onUnstar?.(e)}
            title={isStarred ? 'Unstar this game' : 'Star this game'}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
              fontSize: '0.9rem', lineHeight: 1, flexShrink: 0,
              color: isStarred ? '#FFB800' : 'rgba(255,255,255,0.3)',
              filter: isStarred ? 'drop-shadow(0 0 4px rgba(255,184,0,0.5))' : 'none',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#FFB800'; e.currentTarget.style.transform = 'scale(1.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = isStarred ? '#FFB800' : 'rgba(255,255,255,0.3)'; e.currentTarget.style.transform = ''; }}
          >
            {isStarred ? '★' : '☆'}
          </button>
        </div>
      </div>

      {/* Big score row */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: '8px',
      }}>

        {/* Away team */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {awayLogo && (
              <img src={awayLogo} alt="" width={24} height={24}
                style={{ objectFit: 'contain', opacity: awayLeading ? 1 : 0.65 }}
                onError={e => { e.target.style.display = 'none'; }} />
            )}
            <span style={{
              fontSize: '0.78rem', fontWeight: awayLeading ? 800 : 600,
              color: awayLeading ? '#fff' : 'rgba(255,255,255,0.55)',
              letterSpacing: '0.06em',
            }}>
              {awayAbbr}
            </span>
          </div>
          <span style={{
            fontSize: awayScore != null ? '2.8rem' : '2rem',
            fontWeight: 900, lineHeight: 1,
            fontFamily: 'IBM Plex Mono, monospace',
            color: awayLeading ? '#ffffff' : 'rgba(255,255,255,0.70)',
            textShadow: awayLeading ? '0 0 24px rgba(255,255,255,0.15)' : 'none',
            letterSpacing: '-0.04em',
          }}>
            {awayScore ?? '–'}
          </span>
          <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.05em' }}>AWAY</span>
        </div>

        {/* Center dot separator */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.18)', fontSize: '2rem', fontWeight: 200,
          paddingBottom: '14px',  /* align with score numbers visually */
          userSelect: 'none',
        }}>
          ·
        </div>

        {/* Home team */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              fontSize: '0.78rem', fontWeight: homeLeading ? 800 : 600,
              color: homeLeading ? '#fff' : 'rgba(255,255,255,0.55)',
              letterSpacing: '0.06em',
            }}>
              {homeAbbr}
            </span>
            {homeLogo && (
              <img src={homeLogo} alt="" width={24} height={24}
                style={{ objectFit: 'contain', opacity: homeLeading ? 1 : 0.65 }}
                onError={e => { e.target.style.display = 'none'; }} />
            )}
          </div>
          <span style={{
            fontSize: homeScore != null ? '2.8rem' : '2rem',
            fontWeight: 900, lineHeight: 1,
            fontFamily: 'IBM Plex Mono, monospace',
            color: homeLeading ? '#ffffff' : 'rgba(255,255,255,0.70)',
            textShadow: homeLeading ? '0 0 24px rgba(255,255,255,0.15)' : 'none',
            letterSpacing: '-0.04em',
          }}>
            {homeScore ?? '–'}
          </span>
          <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.05em' }}>HOME</span>
        </div>

      </div>

      {/* Expand / collapse toggle */}
      <div
        onClick={onToggleExpand}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
          marginTop: '0.6rem', paddingTop: '0.45rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          cursor: 'pointer', color: 'rgba(255,255,255,0.28)',
          fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em',
          userSelect: 'none', transition: 'color 0.12s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.28)'; }}
      >
        {expanded ? '▲ HIDE DETAILS' : '▼ DETAILS'}
      </div>
    </div>
  );
}

// ── PICKS PANEL ───────────────────────────────────────────────────────────────
// Shows matching user picks + live bet tracking status below a GameCard
function PicksPanel({ picks, event }) {
  if (!picks?.length) return null;
  const isLive  = event?.status?.type?.state === 'in';
  const isFinal = event?.status?.type?.state === 'post';

  function fmtOdds(n) {
    if (n == null || n === '') return '';
    const num = parseInt(n);
    if (isNaN(num)) return '';
    return num > 0 ? `+${num}` : `${num}`;
  }

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderTop: '1px solid rgba(255,184,0,0.18)',
      borderRadius: '10px',
      padding: '0.7rem 1rem 0.8rem',
      marginTop: '4px',
    }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '0.55rem' }}>
        <span style={{
          fontSize: '0.6rem', fontWeight: 900, letterSpacing: '0.07em', color: 'var(--gold)',
        }}>
          📋 YOUR BETS
        </span>
        <span style={{
          fontSize: '0.58rem', padding: '0px 5px', borderRadius: '3px',
          background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.25)',
          color: 'var(--gold)', fontWeight: 700,
        }}>
          {picks.length}
        </span>
        {isLive && (
          <span style={{
            marginLeft: 'auto', fontSize: '0.58rem', color: '#4ade80',
            display: 'inline-flex', alignItems: 'center', gap: '4px',
          }}>
            <span style={{
              width: '5px', height: '5px', borderRadius: '50%',
              background: '#4ade80', display: 'inline-block',
              animation: 'live-pulse 2s infinite',
            }} />
            tracking live
          </span>
        )}
      </div>

      {/* Pick rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        {picks.map(pick => {
          const { status, detail } = isLive
            ? calcBetStatus(pick, event)
            : { status: null, detail: null };
          const ss = status ? STATUS_STYLES[status] : null;
          const oddsStr = fmtOdds(pick.odds);
          const units = pick.units ? `${pick.units}u` : (pick.amount ? `$${pick.amount}` : '');

          return (
            <div key={pick.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '8px', padding: '6px 9px', borderRadius: '7px',
              background: ss ? ss.bg : 'rgba(255,255,255,0.03)',
              border: `1px solid ${ss ? ss.border : 'rgba(255,255,255,0.06)'}`,
              transition: 'background 0.3s, border-color 0.3s',
            }}>
              {/* Left: team + bet type + detail */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: '0.73rem', fontWeight: 700, color: 'var(--text-secondary)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px',
                  }}>
                    {pick.team}
                  </span>
                  {oddsStr && (
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 800,
                      fontFamily: 'IBM Plex Mono, monospace',
                      color: parseInt(pick.odds) > 0 ? 'var(--green)' : 'var(--text-muted)',
                    }}>
                      {oddsStr}
                    </span>
                  )}
                  {units && (
                    <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)' }}>{units}</span>
                  )}
                  {pick.book && (
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', opacity: 0.7 }}>
                      {pick.book}
                    </span>
                  )}
                </div>
                {/* Status detail text or bet type */}
                <span style={{
                  fontSize: '0.63rem',
                  color: ss ? ss.color : 'var(--text-muted)',
                  lineHeight: 1.3,
                }}>
                  {detail || pick.bet_type || ''}
                </span>
              </div>

              {/* Right: live status badge OR settled result */}
              {status && ss && (
                <span style={{
                  fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.05em',
                  color: ss.color, padding: '2px 6px', borderRadius: '4px',
                  background: ss.bg, border: `1px solid ${ss.border}`,
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {ss.icon} {ss.label}
                </span>
              )}
              {!status && pick.result && (pick.result === 'WIN' || pick.result === 'LOSS' || pick.result === 'PUSH') && (
                <span style={{
                  fontSize: '0.65rem', fontWeight: 800, padding: '2px 7px', borderRadius: '4px',
                  background: pick.result === 'WIN'  ? 'rgba(0,212,139,0.12)' :
                              pick.result === 'LOSS' ? 'rgba(255,69,96,0.10)' : 'rgba(255,184,0,0.10)',
                  color:      pick.result === 'WIN'  ? '#00d48b' :
                              pick.result === 'LOSS' ? '#FF4560' : '#FFB800',
                  border: `1px solid ${pick.result === 'WIN'  ? 'rgba(0,212,139,0.3)'  :
                                       pick.result === 'LOSS' ? 'rgba(255,69,96,0.25)' : 'rgba(255,184,0,0.3)'}`,
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  {pick.result}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyStars() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '4rem 2rem', textAlign: 'center',
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: '12px',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem', filter: 'grayscale(1)', opacity: 0.3 }}>★</div>
      <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>No featured games yet</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: '300px', lineHeight: 1.6 }}>
        Head to the <strong style={{ color: 'var(--gold)' }}>Scoreboard</strong> and tap ☆ on any game to pin it here. You'll get a live view of just those games.
      </div>
    </div>
  );
}

// ── Day navigation helpers ─────────────────────────────────────────────────────
function offsetDate(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}
function formatNavDate(d) {
  const today = new Date();
  const yesterday = offsetDate(today, -1);
  const tomorrow  = offsetDate(today,  1);
  if (isSameDay(d, today))     return 'Today';
  if (isSameDay(d, yesterday)) return 'Yesterday';
  if (isSameDay(d, tomorrow))  return 'Tomorrow';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FeaturedGamesTab({ onAnalyze, user, picks, setPicks, isDemo }) {
  const { starred, toggleStar } = useStarredGames();

  const [liveData,    setLiveData]    = useState({});
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [countdown,   setCountdown]   = useState(null);
  const [viewDate,    setViewDate]    = useState(() => new Date());

  const [injuries,        setInjuries]        = useState({});   // eslint-disable-line
  const [injuriesChecked, setInjuriesChecked] = useState(null); // eslint-disable-line

  const refreshTimerRef = useRef(null);
  const countdownRef    = useRef(null);

  const starredList   = Object.values(starred);
  const starredSports = [...new Set(starredList.map(g => g.sport).filter(Boolean))];

  const isToday = isSameDay(viewDate, new Date());

  const goDay = (delta) => {
    setLiveData({});
    setViewDate(prev => offsetDate(prev, delta));
  };

  // ── Fetch ESPN scoreboard for all starred sports ──────────────────────────
  const fetchAll = useCallback(async () => {
    if (starredSports.length === 0) return;
    setLoading(true);
    const espnDate = toLocalDateStr(viewDate);

    const results = await Promise.allSettled(
      starredSports.map(async (s) => {
        const res  = await fetch(`/api/sports?sport=${s}&endpoint=scoreboard&date=${espnDate}`);
        const data = await res.json();
        return { sport: s, events: data.events || [] };
      })
    );

    const merged = {};
    results.forEach(r => {
      if (r.status === 'fulfilled') merged[r.value.sport] = r.value.events;
    });

    setLiveData(merged);
    setLastUpdated(new Date());
    setLoading(false);
  }, [starredSports.join(','), toLocalDateStr(viewDate)]); // eslint-disable-line

  // ── Auto-refresh: 20s when any game is live, 45s otherwise ───────────────
  const allEvents = Object.values(liveData).flat();
  const hasLive   = allEvents.some(e => e?.status?.type?.state === 'in');
  const interval  = hasLive ? 20 : 45;

  useEffect(() => {
    fetchAll();
  }, [starredSports.join(','), toLocalDateStr(viewDate)]); // eslint-disable-line

  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (countdownRef.current)    clearInterval(countdownRef.current);

    refreshTimerRef.current = setInterval(fetchAll, interval * 1000);

    let secs = interval;
    setCountdown(secs);
    countdownRef.current = setInterval(() => {
      secs -= 1;
      if (secs <= 0) secs = interval;
      setCountdown(secs);
    }, 1000);

    return () => {
      clearInterval(refreshTimerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [fetchAll, interval]);

  // ── My Golfers: read starred golfers from localStorage ───────────────────
  // Lazy initialization reads localStorage on the first render so My Golfers
  // appears immediately on mount — no flash of empty state while waiting for
  // the useEffect to fire.
  const [expandedGolfer, setExpandedGolfer] = useState(null); // id of expanded golfer for scorecard
  const [starredGolfers, setStarredGolfers] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('betos_starred_golfers') || '{}');
    } catch { return {}; }
  });
  useEffect(() => {
    // Track last raw string so we only call setStarredGolfers when the data
    // actually changed. Without this, JSON.parse always produces a new object
    // reference → React always sees a state change → unnecessary re-render every
    // time ANY storage event fires (including GolfLeaderboard's 3-min stat sync).
    // Seed lastRaw from localStorage so the guard is in sync with the lazy
    // initial state — prevents a spurious setStarredGolfers call on mount when
    // the data hasn't changed since the lazy initializer read it.
    let lastRaw = (() => { try { return localStorage.getItem('betos_starred_golfers') || '{}'; } catch { return '{}'; } })();
    function syncGolfers() {
      try {
        const raw = localStorage.getItem('betos_starred_golfers') || '{}';
        if (raw !== lastRaw) {
          lastRaw = raw;
          setStarredGolfers(JSON.parse(raw));
        }
      } catch {}
    }
    // Register the listener — don't call syncGolfers() here because the lazy
    // initializer already loaded the data; the listener handles future changes.
    window.addEventListener('storage', syncGolfers);
    return () => window.removeEventListener('storage', syncGolfers);
  }, []);

  // ── Build sorted featured event list ─────────────────────────────────────
  // Memoized so the 1-second countdown timer (setCountdown) doesn't produce
  // new event object references on every tick, which would force ScoreBug and
  // GameCard to re-render even when game data hasn't changed.
  const starredIdStr = starredList.map(g => g.id).sort().join(',');
  const featuredEvents = useMemo(() => {
    const starredIds = new Set(starredList.map(g => g.id));
    // Fallback 1: match by stored awayAbbr@homeAbbr (new data)
    const starredMatchups = new Set(
      starredList
        .filter(g => g.awayAbbr && g.homeAbbr)
        .map(g => `${g.awayAbbr}@${g.homeAbbr}`.toLowerCase())
    );
    // Fallback 2: match by awayName/homeName (old data without abbreviations)
    const starredNamePairs = starredList
      .filter(g => g.awayName && g.homeName)
      .map(g => ({ away: g.awayName.toLowerCase(), home: g.homeName.toLowerCase() }));

    return sortAllSportsEvents(
      Object.entries(liveData).flatMap(([sport, events]) =>
        events
          .filter(e => {
            if (starredIds.has(e.id)) return true;
            const comp = e.competitions?.[0]?.competitors || [];
            const awayC = comp.find(c => c.homeAway === 'away') || comp[0] || {};
            const homeC = comp.find(c => c.homeAway === 'home') || comp[1] || {};
            const awayAbbr = (awayC.team?.abbreviation || '').toLowerCase();
            const homeAbbr = (homeC.team?.abbreviation || '').toLowerCase();
            const matchup = `${awayAbbr}@${homeAbbr}`;
            if (matchup.length > 2 && starredMatchups.has(matchup)) return true;
            // Name-based fallback for old starred data
            const awayDisplay = (awayC.team?.displayName || awayC.team?.name || '').toLowerCase();
            const homeDisplay = (homeC.team?.displayName || homeC.team?.name || '').toLowerCase();
            return awayDisplay && homeDisplay && starredNamePairs.some(p =>
              (awayDisplay.includes(p.away) || p.away.includes(awayAbbr)) &&
              (homeDisplay.includes(p.home) || p.home.includes(homeAbbr))
            );
          })
          .map(e => ({ ...e, _sport: sport }))
      )
    );
  }, [liveData, starredIdStr]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Expand state for live ScoreBug cards ─────────────────────────────────
  const [expandedIds, setExpandedIds] = useState(new Set());
  const toggleExpand = (id) => setExpandedIds(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── BetSlip modal ─────────────────────────────────────────────────────────
  const [betSlipGame,  setBetSlipGame]  = useState(null);
  const [BetSlipModal, setBetSlipModal] = useState(null);
  useEffect(() => {
    import('@/components/BetSlipModal').then(m => setBetSlipModal(() => m.default)).catch(() => {});
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{
            fontWeight: 900, fontSize: '1.4rem', color: 'var(--gold)',
            letterSpacing: '-0.02em', margin: 0,
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            ★ Featured Games
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '3px 0 0' }}>
            {starredList.length > 0
              ? `${starredList.length} starred game${starredList.length !== 1 ? 's' : ''} · scores + bet tracking`
              : 'Star games from the Scoreboard to track them here'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>

          {/* Day navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={() => goDay(-1)}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
                color: 'var(--text-muted)', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem',
              }}
              title="Previous day"
            >‹</button>
            <span style={{
              fontSize: '0.73rem', fontWeight: 700, color: isToday ? 'var(--gold)' : 'var(--text-secondary)',
              padding: '4px 10px', border: '1px solid var(--border)', borderRadius: '6px',
              background: 'var(--bg-surface)', minWidth: '72px', textAlign: 'center',
            }}>
              {formatNavDate(viewDate)}
            </span>
            <button
              onClick={() => goDay(1)}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
                color: 'var(--text-muted)', padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem',
              }}
              title="Next day"
            >›</button>
            {!isToday && (
              <button
                onClick={() => { setLiveData({}); setViewDate(new Date()); }}
                style={{
                  background: 'none', border: '1px solid rgba(255,184,0,0.35)', borderRadius: '6px',
                  color: 'var(--gold)', padding: '4px 8px', cursor: 'pointer', fontSize: '0.68rem', fontWeight: 700,
                }}
                title="Jump to today"
              >Today</button>
            )}
          </div>

          {starredList.length > 0 && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {hasLive
                ? <span style={{ color: '#4ade80' }}>● LIVE · {countdown}s</span>
                : `↻ ${countdown}s`
              }
            </span>
          )}
          {starredList.length > 0 && (
            <button
              onClick={fetchAll}
              disabled={loading}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
                color: 'var(--text-muted)', padding: '4px 9px', cursor: 'pointer',
                fontSize: '0.75rem', fontFamily: 'inherit', opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? '…' : '↻'}
            </button>
          )}
          {starredList.length > 0 && (
            <button
              onClick={() => starredList.forEach(g => toggleStar({ stopPropagation: () => {} }, g))}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
                color: 'var(--text-muted)', padding: '4px 9px', cursor: 'pointer', fontSize: '0.75rem',
              }}
            >
              Unstar all
            </button>
          )}
        </div>
      </div>

      {/* ── My Golfers widget ── */}
      {Object.keys(starredGolfers).length > 0 && (() => {
        const golferList = Object.values(starredGolfers);
        function fmtScore(v) {
          if (!v || v === '—') return '—';
          if (v === 'E' || v === 'Even') return 'E';
          const n = parseInt(v);
          if (isNaN(n)) return v;
          if (n === 0) return 'E';
          return n > 0 ? `+${n}` : `${n}`;
        }
        function scoreColor(v) {
          const n = v === 'E' ? 0 : parseInt(v);
          if (isNaN(n)) return 'var(--text-muted)';
          if (n < 0) return '#4ade80';
          if (n > 0) return '#f87171';
          return 'var(--text-muted)';
        }
        return (
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid rgba(255,184,0,0.25)',
            borderRadius: '10px',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              padding: '10px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'rgba(255,184,0,0.04)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <span style={{ fontSize: '0.9rem' }}>⛳</span>
                <span style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--gold)' }}>My Golfers</span>
                <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{golferList.length} tracked</span>
              </div>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                Updated from Golf tab · ★ to manage
              </span>
            </div>
            {/* Golfer rows */}
            <div>
              {golferList.map((g, i) => {
                const toPar    = g.toPar || '—';
                const today    = g.today || '—';
                const pos      = g.position || '—';
                const thru     = g.thru || '—';
                const isExpanded = expandedGolfer === g.id;
                return (
                  <div key={g.id || i}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '34px 1fr 54px 44px 40px 24px',
                      alignItems: 'center',
                      padding: '7px 14px',
                      borderBottom: (!isExpanded && i < golferList.length - 1) ? '1px solid rgba(255,255,255,0.04)' : 'none',
                      gap: '6px',
                      background: isExpanded ? 'rgba(96,165,250,0.04)' : 'transparent',
                    }}>
                      {/* Position */}
                      <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', fontWeight: 700, color: pos === '1' ? '#FFB800' : 'var(--text-muted)' }}>
                        {pos}
                      </div>
                      {/* Name + tournament — click to expand scorecard */}
                      <div style={{ overflow: 'hidden' }}>
                        <button
                          onClick={() => setExpandedGolfer(isExpanded ? null : g.id)}
                          title={isExpanded ? 'Close scorecard' : 'View scorecard'}
                          style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            fontSize: '0.85rem', fontWeight: 600,
                            color: isExpanded ? '#60a5fa' : 'var(--text-primary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            display: 'block', width: '100%', textAlign: 'left',
                            textDecoration: 'underline',
                            textDecorationColor: isExpanded ? '#60a5fa' : 'rgba(255,255,255,0.15)',
                            textUnderlineOffset: '2px',
                          }}
                        >
                          {g.name}
                        </button>
                        {g.tournament && (
                          <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {g.tournament}
                          </div>
                        )}
                      </div>
                      {/* To Par */}
                      <div style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.88rem', color: scoreColor(toPar) }}>
                        {toPar !== '—' ? fmtScore(toPar) : '—'}
                      </div>
                      {/* Today */}
                      <div style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', color: scoreColor(today) }}>
                        {today !== '—' ? fmtScore(today) : '—'}
                      </div>
                      {/* Thru */}
                      <div style={{ textAlign: 'center', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {thru}
                      </div>
                      {/* Unstar button */}
                      <button
                        onClick={() => {
                          const updated = JSON.parse(localStorage.getItem('betos_starred_golfers') || '{}');
                          delete updated[g.id];
                          localStorage.setItem('betos_starred_golfers', JSON.stringify(updated));
                          window.dispatchEvent(new Event('storage'));
                        }}
                        title="Remove"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.25)', fontSize: '0.75rem', padding: '2px', lineHeight: 1 }}
                        onMouseEnter={e => e.currentTarget.style.color = '#f87171'}
                        onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.25)'}
                      >✕</button>
                    </div>
                    {/* Inline scorecard panel — rendered when golfer is expanded */}
                    {isExpanded && (
                      g.eventId ? (
                        <InlineScorecardPanel
                          player={{
                            id: g.id,
                            athlete: { id: g.id, displayName: g.name },
                            statistics: [
                              { displayValue: g.toPar },
                              { displayValue: g.thru },
                              { displayValue: g.today },
                            ],
                            status: { thru: g.thru },
                          }}
                          eventId={g.eventId}
                          league={g.league || 'pga'}
                          onClose={() => setExpandedGolfer(null)}
                        />
                      ) : (
                        <div style={{ padding: '8px 14px 10px', background: 'rgba(255,255,255,0.02)', borderBottom: i < golferList.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          ⛳ Open the Golf tab and the scorecard will appear here next time.
                        </div>
                      )
                    )}
                  </div>
                );
              })}
            </div>
            {/* Column headers row */}
            <div style={{
              display: 'grid', gridTemplateColumns: '34px 1fr 54px 44px 40px 24px',
              padding: '4px 14px', borderTop: '1px solid rgba(255,255,255,0.04)',
              background: 'rgba(255,255,255,0.01)', gap: '6px',
            }}>
              {['Pos', 'Player', 'Par', 'Today', 'Thru', ''].map((h, i) => (
                <div key={i} style={{ fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', textAlign: i >= 2 ? 'center' : 'left' }}>{h}</div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Content */}
      {starredList.length === 0 && Object.keys(starredGolfers).length === 0 ? (
        <EmptyStars />

      ) : loading && featuredEvents.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {starredList.slice(0, 3).map((g, i) => (
            <div key={i} style={{
              height: '88px', borderRadius: '10px',
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          ))}
        </div>

      ) : featuredEvents.length === 0 ? (
        <div style={{
          padding: '2rem', textAlign: 'center',
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📅</div>
          <div style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '4px' }}>
            No data for your starred games today
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.6 }}>
            Your {starredList.length} starred game{starredList.length !== 1 ? 's' : ''} may not be scheduled today, or ESPN hasn't posted lines yet.
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {starredList.map(g => (
              <span key={g.id} style={{
                display: 'inline-flex', alignItems: 'center', gap: '5px',
                fontSize: '0.72rem', padding: '3px 6px 3px 8px', borderRadius: '5px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                color: 'var(--text-muted)',
              }}>
                {SPORT_LABELS[g.sport]?.emoji} {g.awayAbbr} @ {g.homeAbbr}
                <button
                  onClick={(e) => toggleStar(e, g)}
                  title="Remove star"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                    color: 'rgba(255,255,255,0.3)', fontSize: '0.75rem', lineHeight: 1,
                    display: 'inline-flex', alignItems: 'center',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = '#FF4560'}
                  onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
                >×</button>
              </span>
            ))}
          </div>
        </div>

      ) : (
        <div className="game-cards-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '12px',
          alignItems: 'start',
        }}>
          {featuredEvents.map(event => {
            const isLive       = event.status?.type?.state === 'in';
            const relatedPicks = matchPicksToGame(picks, event);
            const isExpanded   = expandedIds.has(event.id);
            const starredEntry = starredList.find(g => g.id === event.id);

            return (
              <div key={event.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>

                {isLive ? (
                  /* ── Live: ScoreBug (single header) + expandable details ── */
                  <>
                    <ScoreBug
                      event={event}
                      sport={event._sport}
                      isStarred={!!starred?.[event.id]}
                      onUnstar={(e) => starredEntry && toggleStar(e, starredEntry)}
                      expanded={isExpanded}
                      onToggleExpand={() => toggleExpand(event.id)}
                    />
                    {/* GameCard with header suppressed — only shows expandable details */}
                    <GameCard
                      event={event}
                      sport={event._sport}
                      onAnalyze={(prompt) => onAnalyze?.(prompt)}
                      onAddBet={(ev, sp) => setBetSlipGame({ event: ev, sport: sp })}
                      starred={starred}
                      onStar={toggleStar}
                      injuries={injuries}
                      injuriesChecked={injuriesChecked}
                      isAllMode={starredSports.length > 1}
                      suppressHeader={true}
                      externalExpanded={isExpanded}
                    />
                  </>
                ) : (
                  /* ── Non-live: standard GameCard with its own header ── */
                  <GameCard
                    event={event}
                    sport={event._sport}
                    onAnalyze={(prompt) => onAnalyze?.(prompt)}
                    onAddBet={(ev, sp) => setBetSlipGame({ event: ev, sport: sp })}
                    starred={starred}
                    onStar={toggleStar}
                    injuries={injuries}
                    injuriesChecked={injuriesChecked}
                    isAllMode={starredSports.length > 1}
                  />
                )}

                {/* ── Related Picks + Bet Tracker ── */}
                {relatedPicks.length > 0 && (
                  <PicksPanel picks={relatedPicks} event={event} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Last updated timestamp */}
      {lastUpdated && featuredEvents.length > 0 && (
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>
          Last updated {lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
        </div>
      )}

      {/* BetSlip modal */}
      {betSlipGame && BetSlipModal && (() => {
        const { away, home } = getEventCompetitors(betSlipGame.event);
        // Extract odds from the enriched event (real odds already merged in via Scoreboard's enrichedGames,
        // or directly from ESPN's odds structure for events fetched here)
        const ev = betSlipGame.event;
        const rawOdds = ev?.competitions?.[0]?.odds?.[0];
        let odds = null;
        if (rawOdds) {
          let homeOdds = rawOdds._homeML ?? rawOdds.homeTeamOdds?.moneyLine ?? rawOdds.homeTeamOdds?.current?.moneyLine ?? null;
          let awayOdds = rawOdds._awayML ?? rawOdds.awayTeamOdds?.moneyLine ?? rawOdds.awayTeamOdds?.current?.moneyLine ?? null;
          if (homeOdds === 0) homeOdds = null;
          if (awayOdds === 0) awayOdds = null;
          if ((!homeOdds || !awayOdds) && rawOdds.details) {
            const m = rawOdds.details.match(/([A-Z]+)\s*([-+]?\d+)/);
            if (m) {
              const p = parseInt(m[2]);
              if (Math.abs(p) >= 100) {
                const isHome = ev?.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation === m[1];
                if (isHome) { if (!homeOdds) homeOdds = p; } else { if (!awayOdds) awayOdds = p; }
              }
            }
          }
          odds = {
            homeOdds, awayOdds,
            spread:          rawOdds.details || null,
            total:           rawOdds.overUnder ?? null,
            homeSpreadOdds:  rawOdds._homeSpreadOdds ?? rawOdds.homeTeamOdds?.spreadLine ?? null,
            awaySpreadOdds:  rawOdds._awaySpreadOdds ?? rawOdds.awayTeamOdds?.spreadLine ?? null,
            overOdds:        rawOdds._overOdds  ?? rawOdds.overOdds  ?? null,
            underOdds:       rawOdds._underOdds ?? rawOdds.underOdds ?? null,
            provider:        rawOdds._source    ?? rawOdds.provider?.name ?? '',
          };
        }
        return (
          <BetSlipModal
            game={{ away, home, odds, date: ev?.date }}
            sport={betSlipGame.sport}
            user={user}
            picks={picks}
            setPicks={setPicks}
            isDemo={isDemo}
            onAnalyze={onAnalyze}
            onClose={() => setBetSlipGame(null)}
          />
        );
      })()}
    </div>
  );
}
