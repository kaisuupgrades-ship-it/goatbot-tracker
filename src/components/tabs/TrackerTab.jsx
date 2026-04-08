'use client';
import { useMemo, useEffect, useState, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { getUserPrefs } from '@/lib/userPrefs';

// ── ESPN sport path map (client-side copy for live score fetching) ─────────────
const ESPN_SPORT_PATHS = {
  mlb:   'baseball/mlb',
  nfl:   'football/nfl',
  nba:   'basketball/nba',
  nhl:   'hockey/nhl',
  ncaaf: 'football/college-football',
  ncaab: 'basketball/mens-college-basketball',
  mls:   'soccer/usa.1',
  wnba:  'basketball/wnba',
};

/** Strip spread/line number from team field before matching */
function stripLine(team) {
  if (!team) return team;
  return team.replace(/\s*[+-]\d+(?:\.\d+)?\s*$/, '').replace(/\s+(?:ML|ml)\s*$/i, '').trim();
}

/** Fuzzy team name normalizer */
function normTeam(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Find the game matching this pick in an ESPN events array */
function findPickGame(pick, events) {
  if (!events?.length) return null;
  const teamRaw = stripLine(pick.team || pick.home_team || '');
  const teamN = normTeam(teamRaw);
  if (!teamN || teamN.length < 2) return null;

  for (const evt of events) {
    const comp = evt.competitions?.[0];
    if (!comp) continue;
    const comps = comp.competitors || [];
    const homeC = comps.find(c => c.homeAway === 'home');
    const awayC = comps.find(c => c.homeAway === 'away');
    if (!homeC || !awayC) continue;

    const homeNames = [
      homeC.team?.displayName, homeC.team?.shortDisplayName,
      homeC.team?.name, homeC.team?.abbreviation,
    ].filter(Boolean).map(normTeam);
    const awayNames = [
      awayC.team?.displayName, awayC.team?.shortDisplayName,
      awayC.team?.name, awayC.team?.abbreviation,
    ].filter(Boolean).map(normTeam);

    const allNames = [...homeNames, ...awayNames];
    const matched = allNames.some(n => n.length >= 2 && (n.includes(teamN) || teamN.includes(n)));
    if (!matched) continue;

    const statusType  = comp.status?.type;
    const state       = statusType?.state || '';
    const isLive      = state === 'in';
    const isFinal     = statusType?.completed || state === 'post';
    const homeScore   = parseInt(homeC.score || 0);
    const awayScore   = parseInt(awayC.score || 0);
    const shortDetail = statusType?.shortDetail || '';

    // Determine which side the pick is on (home / away / null)
    let side = null;
    const isOnHome = homeNames.some(n => n.length >= 2 && (n.includes(teamN) || teamN.includes(n)));
    const isOnAway = awayNames.some(n => n.length >= 2 && (n.includes(teamN) || teamN.includes(n)));
    if (isOnHome) side = 'home';
    else if (isOnAway) side = 'away';

    return {
      homeAbbr:     homeC.team?.abbreviation || homeC.team?.shortDisplayName || '?',
      awayAbbr:     awayC.team?.abbreviation || awayC.team?.shortDisplayName || '?',
      homeScore, awayScore,
      isLive, isFinal, side,
      shortDetail,
      startTime: evt.date,
    };
  }
  return null;
}

/** Calculate live trend: 'WIN' | 'LOSS' | 'NEUTRAL' | null */
function calcTrend(pick, game) {
  if (!game || !game.isLive) return null; // only for live games
  const betType = (pick.bet_type || 'Moneyline').toLowerCase();
  const { homeScore, awayScore, side } = game;

  if (betType.includes('over') || betType.includes('under')) {
    const line = parseFloat(pick.line) || 0;
    if (!line) return 'NEUTRAL';
    const total = homeScore + awayScore;
    const isOver = betType.includes('over');
    if (total > line) return isOver ? 'WIN' : 'LOSS';
    if (total < line) return isOver ? 'LOSS' : 'WIN';
    return 'NEUTRAL';
  }

  if (!side) return 'NEUTRAL';
  const pickedScore = side === 'home' ? homeScore : awayScore;
  const oppScore    = side === 'home' ? awayScore : homeScore;

  if (betType.includes('spread') || betType.includes('run line') || betType.includes('puck line')) {
    const line = parseFloat(pick.line) || 0;
    const adj  = pickedScore + line;
    if (adj > oppScore) return 'WIN';
    if (adj < oppScore) return 'LOSS';
    return 'NEUTRAL';
  }

  // Moneyline
  if (pickedScore > oppScore) return 'WIN';
  if (pickedScore < oppScore) return 'LOSS';
  return 'NEUTRAL';
}

// ── Live score fetching hook ──────────────────────────────────────────────────
function useLiveScores(picks) {
  const [scoreMap, setScoreMap] = useState({}); // key: "sport|date" → ESPN events[]

  useEffect(() => {
    if (!picks?.length) return;

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    // Fetch for pending picks (live/recent) and picks from today/yesterday without graded scores
    const needsFetch = picks.filter(p => {
      if (p.result && p.result !== 'PENDING' && p.graded_home_score != null) return false;
      return p.date >= yesterday;
    });
    if (!needsFetch.length) return;

    const sportDates = [...new Set(
      needsFetch.map(p => `${(p.sport || '').toLowerCase()}|${p.date}`)
    )];

    let cancelled = false;
    sportDates.forEach(async key => {
      const [sport, date] = key.split('|');
      const path = ESPN_SPORT_PATHS[sport];
      if (!path || !date) return;
      try {
        const dateStr = date.replace(/-/g, '');
        const res = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dateStr}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setScoreMap(prev => ({ ...prev, [key]: data.events || [] }));
      } catch { /* non-critical */ }
    });

    return () => { cancelled = true; };
  }, [picks]);

  return scoreMap;
}

// ── MiniScoreBug component ────────────────────────────────────────────────────
function MiniScoreBug({ pick, game }) {
  if (!game) return null;

  const { homeAbbr, awayAbbr, homeScore, awayScore, isLive, isFinal, shortDetail, startTime } = game;

  if (!isLive && !isFinal) {
    // Upcoming: show game time
    if (!startTime) return null;
    const dt = new Date(startTime);
    const timeStr = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
        <span>🕐</span>
        <span>{timeStr}</span>
      </div>
    );
  }

  const scoreColor = (score, opp) => score > opp ? '#4ade80' : score < opp ? '#f87171' : 'var(--text-secondary)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.65rem', fontFamily: 'IBM Plex Mono, monospace' }}>
      {isLive && (
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <span style={{
            width: '5px', height: '5px', borderRadius: '50%', background: '#f87171',
            animation: 'pulse 1.2s ease-in-out infinite', display: 'inline-block', flexShrink: 0,
          }} />
          <span style={{ color: '#f87171', fontWeight: 700, fontSize: '0.6rem' }}>LIVE</span>
        </span>
      )}
      {isFinal && <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem', fontWeight: 700 }}>F</span>}
      <span style={{ color: scoreColor(awayScore, homeScore), fontWeight: 700 }}>{awayAbbr}</span>
      <span style={{ color: scoreColor(awayScore, homeScore), fontWeight: 800 }}>{awayScore}</span>
      <span style={{ color: 'var(--text-muted)' }}>-</span>
      <span style={{ color: scoreColor(homeScore, awayScore), fontWeight: 800 }}>{homeScore}</span>
      <span style={{ color: scoreColor(homeScore, awayScore), fontWeight: 700 }}>{homeAbbr}</span>
      {isLive && shortDetail && (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.58rem', marginLeft: '2px' }}>| {shortDetail}</span>
      )}
    </div>
  );
}

// ── TrendingBadge component ───────────────────────────────────────────────────
function TrendingBadge({ trend }) {
  if (!trend || trend === 'NEUTRAL') return null;
  const isWin  = trend === 'WIN';
  return (
    <span style={{
      padding: '1px 5px', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 800,
      background: isWin ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)',
      color: isWin ? '#4ade80' : '#f87171',
      border: `1px solid ${isWin ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
      whiteSpace: 'nowrap',
    }}>
      {isWin ? '↑ WIN' : '↓ LOSS'}
    </span>
  );
}

// Count-up animation hook
function useCountUp(target, duration = 800) {
  const [value, setValue] = useState(0);
  const raf = useRef();
  useEffect(() => {
    const start = performance.now();
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, duration]);
  return value;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function calcStats(picks) {
  const settled = picks.filter(p => p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH');
  const wins    = settled.filter(p => p.result === 'WIN').length;
  const losses  = settled.filter(p => p.result === 'LOSS').length;
  const units   = settled.reduce((sum, p) => sum + (parseFloat(p.profit) || 0), 0);
  const roi     = settled.length ? (units / settled.length) * 100 : 0;
  const streak  = calcStreak(settled);
  const pending = picks.filter(p => !p.result || p.result === 'PENDING').length;
  // Avg implied probability — more meaningful than averaged American odds (non-linear scale)
  const oddsWithValues = settled.filter(p => p.odds && parseInt(p.odds) !== 0);
  let avgImpliedProb = null;
  if (oddsWithValues.length) {
    const totalProb = oddsWithValues.reduce((sum, p) => {
      const o = parseInt(p.odds);
      return sum + (o > 0 ? 100 / (o + 100) : Math.abs(o) / (Math.abs(o) + 100));
    }, 0);
    avgImpliedProb = Math.round(totalProb / oddsWithValues.length * 1000) / 10; // e.g. 52.3
  }
  const biggestWin = settled.filter(p => p.result === 'WIN')
    .reduce((max, p) => Math.max(max, parseFloat(p.profit) || 0), 0);
  return { wins, losses, total: settled.length, units, roi, streak, pending, avgImpliedProb, biggestWin };
}

function calcStreak(settled) {
  if (!settled.length) return { count: 0, type: '-' };
  // Sort desc so index 0 = most recent pick, ensuring correct streak direction
  const desc = [...settled].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const last = desc[0].result;
  let count = 0;
  for (const p of desc) {
    if (p.result === last) count++;
    else break;
  }
  return { count, type: last };
}

function buildEquityCurve(picks) {
  const sorted = [...picks]
    .filter(p => p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let running = 0;
  const curve = [{ label: 'Start', units: 0 }];
  sorted.forEach((p, i) => {
    running += parseFloat(p.profit) || 0;
    curve.push({
      label: `#${i + 1}`,
      units: parseFloat(running.toFixed(3)),
      date: p.date,
      team: p.team,
    });
  });
  return curve;
}

function buildSportBreakdown(picks) {
  const map = {};
  picks
    .filter(p => p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH')
    .forEach(p => {
      const s = (p.sport || 'Other').toUpperCase();
      if (!map[s]) map[s] = { sport: s, wins: 0, losses: 0, units: 0 };
      if (p.result === 'WIN')  map[s].wins++;
      if (p.result === 'LOSS') map[s].losses++;
      map[s].units += parseFloat(p.profit) || 0;
    });
  return Object.values(map).sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses));
}

// ── Calendar helpers ──────────────────────────────────────────────────────────

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay(); // 0=Sun
}
function isoDate(d, timezone) {
  // Use the user's profile timezone if provided, otherwise fall back to local browser time.
  // NEVER use toISOString() here — it gives UTC and causes off-by-one at night.
  if (timezone) {
    // 'sv' locale returns YYYY-MM-DD format natively
    return d.toLocaleDateString('sv', { timeZone: timezone });
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Group picks by date string
function picksByDate(picks) {
  const map = {};
  picks.forEach(p => {
    if (!p.date) return;
    if (!map[p.date]) map[p.date] = [];
    map[p.date].push(p);
  });
  return map;
}

const SPORT_EMOJI = {
  MLB: '⚾', NBA: '🏀', NFL: '🏈', NHL: '🏒', NCAAF: '🏈',
  NCAAB: '🏀', MLS: '⚽', WNBA: '🏀', UFC: '🥊', Tennis: '🎾',
};
function sportEmoji(sport) {
  return SPORT_EMOJI[(sport || '').toUpperCase()] || '🎯';
}

// Build date range from preset key — uses user's timezone so "today" is correct
function presetRange(key, picks, timezone) {
  const today = new Date();
  const todayStr = isoDate(today, timezone);
  if (key === 'all') return { start: null, end: null };
  if (key === 'month') {
    const d = new Date(today);
    const y = timezone ? parseInt(d.toLocaleDateString('sv', { timeZone: timezone }).slice(0, 4)) : d.getFullYear();
    const mo = timezone ? parseInt(d.toLocaleDateString('sv', { timeZone: timezone }).slice(5, 7)) : d.getMonth() + 1;
    return { start: `${y}-${String(mo).padStart(2, '0')}-01`, end: todayStr };
  }
  if (key === '30d') {
    const d = new Date(today); d.setDate(d.getDate() - 30);
    return { start: isoDate(d, timezone), end: todayStr };
  }
  if (key === '90d') {
    const d = new Date(today); d.setDate(d.getDate() - 90);
    return { start: isoDate(d, timezone), end: todayStr };
  }
  return { start: null, end: null };
}

// ── Pick Calendar — Heat Tile Design ─────────────────────────────────────────
// Revolutionary: GitHub-style heat tiles × betting dashboard

const WEEKDAYS_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function PickCalendar({ picks, dateRange, onRangeChange, timezone }) {
  const today = new Date();
  // Use profile timezone for "today" — prevents UTC rollover showing tomorrow at night
  const todayLocal = timezone ? today.toLocaleDateString('sv', { timeZone: timezone }) : isoDate(today);
  const todayYear  = parseInt(todayLocal.slice(0, 4));
  const todayMonth = parseInt(todayLocal.slice(5, 7)) - 1; // 0-indexed
  const [viewYear, setViewYear]   = useState(todayYear);
  const [viewMonth, setViewMonth] = useState(todayMonth);
  const [selected, setSelected]   = useState(null);
  const [isMobile, setIsMobile]   = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 640);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (dateRange?.start) {
      const d = new Date(dateRange.start + 'T12:00:00');
      setViewYear(d.getFullYear()); setViewMonth(d.getMonth());
    }
  }, [dateRange?.start]);

  const byDate   = useMemo(() => picksByDate(picks), [picks]);
  const daysInMo = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth);

  const monthStats = useMemo(() => {
    let pl = 0, w = 0, l = 0;
    for (let d = 1; d <= daysInMo; d++) {
      const key = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      (byDate[key] || []).forEach(p => {
        pl += parseFloat(p.profit) || 0;
        if (p.result === 'WIN') w++;
        if (p.result === 'LOSS') l++;
      });
    }
    return { pl, w, l };
  }, [byDate, viewYear, viewMonth, daysInMo]);

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
    setSelected(null);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
    setSelected(null);
  }

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMo; d++) cells.push(d);
  const todayStr = todayLocal; // already computed in profile timezone

  // Compute color for a tile based on P/L
  function tileStyle(dayPL, hasSettled, hasPending, isSelected, isToday) {
    if (isSelected) return {
      bg: 'rgba(255,184,0,0.18)',
      border: 'rgba(255,184,0,0.7)',
      glow: '0 0 12px rgba(255,184,0,0.25)',
    };
    if (!hasSettled && hasPending) return {
      bg: 'rgba(255,184,0,0.07)',
      border: 'rgba(255,184,0,0.35)',
      glow: 'none',
    };
    if (!hasSettled && !hasPending) return {
      bg: isToday ? 'rgba(255,184,0,0.04)' : 'rgba(255,255,255,0.015)',
      border: isToday ? 'rgba(255,184,0,0.4)' : 'rgba(255,255,255,0.06)',
      glow: 'none',
    };
    const absVal = Math.abs(dayPL);
    const intensity = Math.min(absVal / 2.5, 1); // saturate at ~2.5u
    if (dayPL > 0) return {
      bg: `rgba(74,222,128,${0.05 + intensity * 0.18})`,
      border: `rgba(74,222,128,${0.15 + intensity * 0.45})`,
      glow: intensity > 0.5 ? `0 0 10px rgba(74,222,128,${intensity * 0.2})` : 'none',
    };
    return {
      bg: `rgba(248,113,113,${0.05 + intensity * 0.15})`,
      border: `rgba(248,113,113,${0.15 + intensity * 0.4})`,
      glow: intensity > 0.5 ? `0 0 8px rgba(248,113,113,${intensity * 0.15})` : 'none',
    };
  }

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '0.6rem 0.75rem' : '0.85rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div>
          <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: isMobile ? '0.9rem' : '1rem' }}>{MONTHS[viewMonth]} {viewYear}</div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '2px' }}>
            <span style={{ color: monthStats.pl >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '0.72rem', fontFamily: 'IBM Plex Mono', fontWeight: 700 }}>
              {monthStats.pl >= 0 ? '+' : ''}{monthStats.pl.toFixed(2)}u
            </span>
            {monthStats.w + monthStats.l > 0 && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                {monthStats.w}-{monthStats.l} &nbsp;({((monthStats.w / (monthStats.w + monthStats.l)) * 100).toFixed(0)}% win)
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          <button onClick={prevMonth} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1 }}>‹</button>
          <button onClick={() => { setViewYear(todayYear); setViewMonth(todayMonth); setSelected(null); }}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 600 }}>Today</button>
          <button onClick={nextMonth} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1 }}>›</button>
        </div>
      </div>

      {/* Day-of-week labels */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: isMobile ? '4px 6px 1px' : '6px 8px 2px', flexShrink: 0 }}>
        {WEEKDAYS_SHORT.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', fontSize: isMobile ? '0.55rem' : '0.62rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{d}</div>
        ))}
      </div>

      {/* Heat tile grid */}
      <div style={{ padding: isMobile ? '3px 6px 6px' : '4px 8px 8px', flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: isMobile ? '2px' : '3px' }}>
          {cells.map((day, idx) => {
            if (!day) return <div key={`e${idx}`} style={{ borderRadius: isMobile ? '6px' : '8px', minHeight: isMobile ? '52px' : '76px', background: 'rgba(255,255,255,0.01)' }} />;

            const dateKey   = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const dayPicks  = byDate[dateKey] || [];
            const settled   = dayPicks.filter(p => p.result === 'WIN' || p.result === 'LOSS');
            const wins      = dayPicks.filter(p => p.result === 'WIN').length;
            const losses    = dayPicks.filter(p => p.result === 'LOSS').length;
            const pending   = dayPicks.filter(p => !p.result || p.result === 'PENDING').length;
            const dayPL     = settled.reduce((s, p) => s + (parseFloat(p.profit) || 0), 0);
            const isToday   = dateKey === todayStr;
            const isSel     = dateKey === selected;
            const ts        = tileStyle(dayPL, settled.length > 0, pending > 0, isSel, isToday);

            // First pick for display
            const firstPick = dayPicks[0];
            const n = dayPicks.length;
            // Density levels: D1=1, D2=2-3, D3=4-6, D4=7+
            const density = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4;
            // Team name length shrinks with density: 9 → 7 → 4 → 0
            const teamNameLen = density === 1 ? 9 : density === 2 ? 7 : 4;
            const teamShort = firstPick ? ((firstPick.team || '').split(' ').pop().slice(0, teamNameLen)) : '';
            // Emoji size shrinks: 0.90 → 0.80 → 0.70 → hidden (smaller on mobile)
            const emojiSize = isMobile
              ? (density === 1 ? '0.62rem' : density === 2 ? '0.55rem' : '0.48rem')
              : (density === 1 ? '0.9rem'  : density === 2 ? '0.80rem' : '0.70rem');
            // Text label size: 0.65 → 0.58 → 0.52 (smaller on mobile)
            const labelSize = isMobile
              ? (density === 1 ? '0.52rem' : density === 2 ? '0.48rem' : '0.44rem')
              : (density === 1 ? '0.65rem' : density === 2 ? '0.58rem' : '0.52rem');
            // Date number shrinks slightly when very crowded (even smaller on mobile)
            const dateNumSize = isMobile ? (density >= 3 ? '0.56rem' : '0.62rem') : (density >= 3 ? '0.68rem' : '0.78rem');
            // P/L font shrinks too
            const plSize = isMobile ? (density >= 3 ? '0.5rem' : '0.58rem') : (density >= 3 ? '0.60rem' : '0.72rem');

            return (
              <div
                key={dateKey}
                onClick={() => dayPicks.length && setSelected(isSel ? null : dateKey)}
                style={{
                  borderRadius: isMobile ? '6px' : '8px',
                  border: `1px solid ${ts.border}`,
                  background: ts.bg,
                  boxShadow: ts.glow,
                  padding: isMobile
                    ? (density >= 3 ? '3px 2px 3px' : '4px 4px 3px')
                    : (density >= 3 ? '5px 4px 4px' : '6px 6px 5px'),
                  cursor: dayPicks.length ? 'pointer' : 'default',
                  display: 'flex', flexDirection: 'column', gap: isMobile ? '1px' : (density >= 3 ? '2px' : '3px'),
                  minHeight: isMobile ? '52px' : '76px',
                  transition: 'all 0.15s',
                  position: 'relative', overflow: 'hidden',
                }}
                onMouseEnter={e => { if (!isMobile && dayPicks.length) { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.zIndex = '2'; } }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.zIndex = ''; }}
              >
                {/* Date + P/L on same row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: dateNumSize, fontWeight: isToday ? 800 : dayPicks.length ? 600 : 400,
                    color: isToday ? 'var(--gold)' : dayPicks.length ? 'var(--text-secondary)' : 'var(--text-muted)',
                    lineHeight: 1,
                  }}>{day}</span>
                  {settled.length > 0 && (
                    <span style={{
                      fontSize: plSize, fontFamily: 'IBM Plex Mono', fontWeight: 800,
                      color: dayPL >= 0 ? '#4ade80' : '#f87171', lineHeight: 1,
                    }}>
                      {dayPL >= 0 ? '+' : ''}{dayPL.toFixed(1)}u
                    </span>
                  )}
                </div>

                {/* Pick content — D1: single pick */}
                {density === 1 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px', overflow: 'hidden' }}>
                    <span style={{
                      fontSize: emojiSize, lineHeight: 1, flexShrink: 0,
                      opacity: firstPick?.result === 'LOSS' ? 0.5 : 1,
                      filter: firstPick?.result === 'LOSS' ? 'grayscale(60%)' : 'none',
                    }}>
                      {sportEmoji(firstPick?.sport)}
                    </span>
                    <span style={{
                      fontSize: labelSize, color: 'var(--text-secondary)', fontWeight: 700,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      lineHeight: 1,
                    }}>
                      {teamShort}
                    </span>
                  </div>
                )}

                {/* D2: 2-3 picks — emoji row + W/L/P badges */}
                {density === 2 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '1px' }}>
                    <div style={{ display: 'flex', gap: '1px', flexWrap: 'wrap' }}>
                      {dayPicks.slice(0, 3).map((p, i) => (
                        <span key={i} style={{
                          fontSize: emojiSize, lineHeight: 1,
                          opacity: p.result === 'LOSS' ? 0.4 : 1,
                          filter: p.result === 'LOSS' ? 'grayscale(70%)' : 'none',
                        }}>{sportEmoji(p.sport)}</span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: '3px' }}>
                      {wins > 0 && <span style={{ fontSize: labelSize, fontWeight: 800, color: '#4ade80' }}>{wins}W</span>}
                      {losses > 0 && <span style={{ fontSize: labelSize, fontWeight: 800, color: '#f87171' }}>{losses}L</span>}
                      {pending > 0 && <span style={{ fontSize: labelSize, fontWeight: 800, color: '#FFB800' }}>{pending}P</span>}
                    </div>
                  </div>
                )}

                {/* D3: 4-6 picks — tiny emoji row (max 4) + overflow count + W/L/P */}
                {density === 3 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '1px' }}>
                    <div style={{ display: 'flex', gap: '1px', alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden' }}>
                      {dayPicks.slice(0, 4).map((p, i) => (
                        <span key={i} style={{
                          fontSize: emojiSize, lineHeight: 1,
                          opacity: p.result === 'LOSS' ? 0.4 : 1,
                          filter: p.result === 'LOSS' ? 'grayscale(70%)' : 'none',
                        }}>{sportEmoji(p.sport)}</span>
                      ))}
                      {n > 4 && <span style={{ fontSize: '0.5rem', color: 'var(--text-muted)', alignSelf: 'center', marginLeft: '1px' }}>+{n - 4}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      {wins > 0 && <span style={{ fontSize: labelSize, fontWeight: 800, color: '#4ade80' }}>{wins}W</span>}
                      {losses > 0 && <span style={{ fontSize: labelSize, fontWeight: 800, color: '#f87171' }}>{losses}L</span>}
                      {pending > 0 && <span style={{ fontSize: labelSize, fontWeight: 800, color: '#FFB800' }}>{pending}P</span>}
                    </div>
                  </div>
                )}

                {/* D4: 7+ picks — ultra-compact: just count + W/L/P numbers */}
                {density === 4 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '2px' }}>
                    <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontWeight: 700, lineHeight: 1 }}>{n} picks</span>
                    <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
                      {wins > 0 && <span style={{ fontSize: '0.52rem', fontWeight: 800, color: '#4ade80' }}>{wins}W</span>}
                      {losses > 0 && <span style={{ fontSize: '0.52rem', fontWeight: 800, color: '#f87171' }}>{losses}L</span>}
                      {pending > 0 && <span style={{ fontSize: '0.52rem', fontWeight: 800, color: '#FFB800' }}>{pending}P</span>}
                    </div>
                  </div>
                )}

                {/* Pending dot */}
                {pending > 0 && settled.length === 0 && (
                  <div style={{ position: 'absolute', top: '5px', right: '5px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--gold)', boxShadow: '0 0 5px rgba(255,184,0,0.7)' }} />
                )}

                {/* Bottom W/L bar */}
                {(wins > 0 || losses > 0) && (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px', display: 'flex', borderRadius: '0 0 7px 7px', overflow: 'hidden' }}>
                    {wins > 0 && <div style={{ flex: wins, background: '#4ade80', opacity: 0.85 }} />}
                    {losses > 0 && <div style={{ flex: losses, background: '#f87171', opacity: 0.85 }} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day detail slide-in */}
      {selected && byDate[selected]?.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '0.8rem 1rem', flexShrink: 0, background: 'var(--bg-base)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--gold)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {new Date(selected + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem', padding: '0 2px' }}>✕</button>
          </div>
          {byDate[selected].map(p => {
            const profit = parseFloat(p.profit);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ fontSize: '0.9rem', flexShrink: 0 }}>{sportEmoji(p.sport)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.team}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.bet_type} · {p.sport}
                    {(p.matchup || (p.home_team && p.away_team)) && (
                      <span style={{ marginLeft: '4px', opacity: 0.75 }}>· {p.matchup || `${p.away_team} @ ${p.home_team}`}</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexShrink: 0 }}>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', color: parseInt(p.odds) > 0 ? 'var(--green)' : 'var(--text-secondary)' }}>
                    {parseInt(p.odds) > 0 ? '+' : ''}{p.odds}
                  </span>
                  <span style={{
                    padding: '1px 6px', borderRadius: '4px', fontSize: '0.66rem', fontWeight: 800,
                    background: p.result === 'WIN' ? 'rgba(74,222,128,0.15)' : p.result === 'LOSS' ? 'rgba(248,113,113,0.15)' : 'rgba(255,184,0,0.12)',
                    color: p.result === 'WIN' ? 'var(--green)' : p.result === 'LOSS' ? 'var(--red)' : 'var(--gold)',
                  }}>{p.result || 'PENDING'}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', fontWeight: 700, color: profit >= 0 ? 'var(--green)' : 'var(--red)', minWidth: '40px', textAlign: 'right' }}>
                    {p.profit != null && p.profit !== '' ? `${profit >= 0 ? '+' : ''}${profit.toFixed(2)}u` : '—'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Momentum Strip ─────────────────────────────────────────────────────────────

function MomentumStrip({ picks }) {
  const settled = [...picks]
    .filter(p => p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH')
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const last = settled.slice(-15);
  if (last.length === 0) return null;

  const last5  = settled.slice(-5);
  const last10 = settled.slice(-10);
  const w5 = last5.filter(p => p.result === 'WIN').length;
  const w10 = last10.filter(p => p.result === 'WIN').length;
  const pl10 = last10.reduce((s, p) => s + (parseFloat(p.profit) || 0), 0);

  let heatEmoji = '🧊', heatLabel = 'Cold', heatColor = '#60a5fa';
  if (w5 >= 4) { heatEmoji = '🔥'; heatLabel = 'On Fire'; heatColor = '#FF6B35'; }
  else if (w5 === 3) { heatEmoji = '✅'; heatLabel = 'Warm'; heatColor = '#4ade80'; }
  else if (w5 <= 1) { heatEmoji = '🧊'; heatLabel = 'Cold'; heatColor = '#60a5fa'; }
  else { heatEmoji = '⚖️'; heatLabel = 'Neutral'; heatColor = 'var(--text-muted)'; }

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1.1rem' }}>{heatEmoji}</span>
          <div>
            <div style={{ fontWeight: 800, color: heatColor, fontSize: '0.85rem' }}>{heatLabel}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>Last 5 picks: {w5}-{5 - w5}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.85rem', color: w10 / Math.max(last10.length, 1) >= 0.5 ? 'var(--green)' : 'var(--red)' }}>
              {w10}-{last10.length - w10}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>Last 10 W-L</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.85rem', color: pl10 >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {pl10 >= 0 ? '+' : ''}{pl10.toFixed(2)}u
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>Last 10 P/L</div>
          </div>
        </div>
      </div>

      {/* Pick strip */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', alignSelf: 'center', marginRight: '2px' }}>← older</span>
        {last.map((p, i) => (
          <div
            key={i}
            title={`${p.team} (${p.sport}) ${p.result} ${p.profit ? (parseFloat(p.profit) >= 0 ? '+' : '') + parseFloat(p.profit).toFixed(2) + 'u' : ''}`}
            style={{
              width: '28px', height: '28px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.68rem', fontWeight: 800, cursor: 'default',
              background: p.result === 'WIN' ? 'rgba(74,222,128,0.18)' : p.result === 'LOSS' ? 'rgba(248,113,113,0.18)' : 'rgba(255,184,0,0.12)',
              color: p.result === 'WIN' ? '#4ade80' : p.result === 'LOSS' ? '#f87171' : '#FFB800',
              border: `1px solid ${p.result === 'WIN' ? 'rgba(74,222,128,0.3)' : p.result === 'LOSS' ? 'rgba(248,113,113,0.3)' : 'rgba(255,184,0,0.2)'}`,
              transition: 'transform 0.1s',
            }}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'}
            onMouseLeave={e => e.currentTarget.style.transform = ''}
          >
            {p.result === 'WIN' ? 'W' : p.result === 'LOSS' ? 'L' : 'P'}
          </div>
        ))}
        <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', alignSelf: 'center', marginLeft: '2px' }}>recent →</span>
      </div>
    </div>
  );
}

// ── Day of Week Heatmap ───────────────────────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function DayOfWeekGrid({ picks }) {
  const settled = picks.filter(p => p.result === 'WIN' || p.result === 'LOSS');
  if (settled.length < 5) return null;

  const byDow = Array.from({ length: 7 }, (_, i) => {
    const group = settled.filter(p => {
      if (!p.date) return false;
      return new Date(p.date + 'T12:00:00').getDay() === i;
    });
    const wins  = group.filter(p => p.result === 'WIN').length;
    const total = group.length;
    const pl    = group.reduce((s, p) => s + (parseFloat(p.profit) || 0), 0);
    const wr    = total ? wins / total : 0;
    return { label: DOW_LABELS[i], wins, total, pl, wr };
  });

  const maxPL = Math.max(...byDow.map(d => Math.abs(d.pl)), 0.1);

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1rem 1.25rem' }}>
      <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
        📆 Win Rate by Day of Week
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
        {byDow.map(d => {
          const pct = (d.wr * 100);
          const barH = d.total ? Math.max((d.pl / maxPL) * 40, 4) : 0;
          const barColor = d.pl >= 0 ? 'rgba(74,222,128,0.6)' : 'rgba(248,113,113,0.6)';
          return (
            <div key={d.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px' }}>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>{d.label}</div>
              <div style={{ width: '100%', height: '44px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                {d.total > 0 ? (
                  <div style={{ width: '80%', height: `${Math.max((Math.abs(d.pl) / maxPL) * 44, 4)}px`, background: barColor, borderRadius: '3px 3px 0 0', transition: 'height 0.4s' }} />
                ) : (
                  <div style={{ width: '80%', height: '4px', background: 'var(--border)', borderRadius: '2px' }} />
                )}
              </div>
              <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.7rem', fontWeight: 800, color: d.total === 0 ? 'var(--text-muted)' : d.wr >= 0.55 ? 'var(--green)' : d.wr < 0.4 ? 'var(--red)' : 'var(--text-secondary)' }}>
                {d.total > 0 ? `${Math.round(pct)}%` : '—'}
              </div>
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>
                {d.total > 0 ? `${d.wins}-${d.total - d.wins}` : '–'}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, tone }) {
  return (
    <div className={`stat-card ${tone || ''}`} style={{ flex: '1 1 130px' }}>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{
        color: tone === 'positive' ? 'var(--green)' : tone === 'negative' ? 'var(--red)' : tone === 'brand' ? 'var(--gold)' : 'var(--text-primary)'
      }}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ── Custom Tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div style={{ background: '#1a1a1a', border: '1px solid #FFB800', borderRadius: '8px', padding: '0.6rem 0.9rem', fontSize: '0.8rem' }}>
      <p style={{ color: '#888', marginBottom: '2px' }}>{label}</p>
      <p style={{ color: val >= 0 ? '#4ade80' : '#f87171', fontWeight: 700, fontSize: '1rem' }}>
        {val >= 0 ? '+' : ''}{val.toFixed(2)}u
      </p>
    </div>
  );
}

// ── Neutral Summary Bar ───────────────────────────────────────────────────────
// Compact top-of-page widget: key stats + momentum all in one row

function NeutralSummaryBar({ stats, picks }) {
  const winPct = stats.total > 0 ? ((stats.wins / stats.total) * 100).toFixed(1) : null;
  const avgProbDisplay = stats.avgImpliedProb != null ? `${stats.avgImpliedProb}%` : '—';

  const settled = [...picks].filter(p => p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH').sort((a,b) => new Date(a.date)-new Date(b.date));
  const last5 = settled.slice(-5);
  const w5 = last5.filter(p => p.result === 'WIN').length;
  let heatEmoji = '🧊', heatColor = '#60a5fa';
  if (w5 >= 4) { heatEmoji = '🔥'; heatColor = '#FF6B35'; }
  else if (w5 === 3) { heatEmoji = '✅'; heatColor = '#4ade80'; }
  else if (w5 === 2) { heatEmoji = '⚖️'; heatColor = 'var(--text-muted)'; }
  else { heatEmoji = '🧊'; heatColor = '#60a5fa'; }

  const statItems = [
    { label: 'Record',    value: `${stats.wins}-${stats.losses}`, sub: winPct ? `${winPct}%` : null, tone: stats.wins > stats.losses ? 'green' : stats.losses > stats.wins ? 'red' : null },
    { label: 'Units P/L', value: `${stats.units >= 0 ? '+' : ''}${stats.units.toFixed(2)}u`, sub: `${stats.total} settled`, tone: stats.units >= 0 ? 'green' : 'red' },
    { label: 'ROI',       value: `${stats.roi >= 0 ? '+' : ''}${stats.roi.toFixed(1)}%`, sub: 'per pick', tone: stats.roi >= 0 ? 'green' : 'red' },
    { label: 'Streak',    value: stats.streak.count > 0 ? `${stats.streak.type === 'WIN' ? 'W' : 'L'}${stats.streak.count}` : '—', sub: 'current', tone: stats.streak.type === 'WIN' ? 'green' : stats.streak.type === 'LOSS' ? 'red' : null },
    { label: 'Avg Implied', value: avgProbDisplay, sub: 'implied prob', tone: 'gold' },
    { label: 'Best Win',  value: stats.biggestWin > 0 ? `+${stats.biggestWin.toFixed(2)}u` : '—', sub: 'single pick', tone: stats.biggestWin > 0 ? 'green' : null },
    ...(stats.pending > 0 ? [{ label: 'Pending', value: stats.pending, sub: 'awaiting', tone: 'gold' }] : []),
  ];

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.9rem 1.25rem' }}>
      {/* Heat indicator + title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '1.1rem' }}>{heatEmoji}</span>
        <span style={{ fontWeight: 800, color: heatColor, fontSize: '0.88rem' }}>
          {w5 >= 4 ? 'On Fire' : w5 === 3 ? 'Warm' : w5 <= 1 ? 'Cold' : 'Neutral'}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>· Last 5: {w5}-{last5.length - w5}</span>
        {/* Mini strip */}
        <div style={{ display: 'flex', gap: '3px', marginLeft: '4px' }}>
          {settled.slice(-10).map((p, i) => (
            <div key={i} style={{
              width: '14px', height: '14px', borderRadius: '3px',
              background: p.result === 'WIN' ? 'rgba(74,222,128,0.7)' : p.result === 'LOSS' ? 'rgba(248,113,113,0.7)' : 'rgba(255,184,0,0.5)',
              fontSize: '0.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: p.result === 'WIN' ? '#000' : p.result === 'LOSS' ? '#fff' : '#000',
            }}>
              {p.result === 'WIN' ? 'W' : p.result === 'LOSS' ? 'L' : 'P'}
            </div>
          ))}
        </div>
      </div>
      {/* Stats row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {statItems.map(item => (
          <div key={item.label} style={{
            flex: '1 1 90px', background: 'var(--bg-elevated)', borderRadius: '8px',
            padding: '0.55rem 0.75rem', border: '1px solid var(--border-subtle)',
          }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '2px' }}>{item.label}</div>
            <div style={{
              fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.92rem',
              color: item.tone === 'green' ? 'var(--green)' : item.tone === 'red' ? 'var(--red)' : item.tone === 'gold' ? 'var(--gold)' : 'var(--text-primary)',
            }}>{item.value}</div>
            {item.sub && <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>{item.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Date Range Selector ───────────────────────────────────────────────────────

function DateRangeSelector({ range, onChange }) {
  const presets = [
    { key: 'all',   label: 'All Time' },
    { key: 'month', label: 'This Month' },
    { key: '30d',   label: 'Last 30d' },
    { key: '90d',   label: 'Last 90d' },
  ];
  const [activePreset, setActivePreset] = useState('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd]     = useState('');
  const [showCustom, setShowCustom]   = useState(false);

  function applyPreset(key) {
    setActivePreset(key);
    setShowCustom(false);
    onChange(presetRange(key));
  }

  function applyCustom() {
    setActivePreset('custom');
    onChange({ start: customStart || null, end: customEnd || null });
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginRight: '2px' }}>Range:</span>
      {presets.map(p => (
        <button key={p.key} onClick={() => applyPreset(p.key)} style={{
          padding: '4px 12px', borderRadius: '20px', border: `1px solid ${activePreset === p.key ? 'var(--gold)' : 'var(--border)'}`,
          background: activePreset === p.key ? 'var(--gold-subtle)' : 'transparent',
          color: activePreset === p.key ? 'var(--gold)' : 'var(--text-muted)',
          fontSize: '0.75rem', fontWeight: activePreset === p.key ? 700 : 400,
          cursor: 'pointer', transition: 'all 0.12s',
        }}>{p.label}</button>
      ))}
      <button onClick={() => setShowCustom(s => !s)} style={{
        padding: '4px 12px', borderRadius: '20px',
        border: `1px solid ${activePreset === 'custom' ? 'var(--gold)' : 'var(--border)'}`,
        background: activePreset === 'custom' ? 'var(--gold-subtle)' : 'transparent',
        color: activePreset === 'custom' ? 'var(--gold)' : 'var(--text-muted)',
        fontSize: '0.75rem', cursor: 'pointer', transition: 'all 0.12s',
      }}>Custom {showCustom ? '▲' : '▼'}</button>

      {showCustom && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
          <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', padding: '3px 8px', fontSize: '0.75rem' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>→</span>
          <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', padding: '3px 8px', fontSize: '0.75rem' }} />
          <button onClick={applyCustom} style={{
            padding: '3px 10px', borderRadius: '6px', background: 'var(--gold)', color: '#000',
            border: 'none', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
          }}>Apply</button>
        </div>
      )}

      {(range.start || range.end) && (
        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
          {range.start || '…'} → {range.end || 'today'}
        </span>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TrackerTab({ picks, user, onViewGame }) {
  const { timezone } = getUserPrefs(user);
  const [dateRange, setDateRange] = useState({ start: null, end: null });
  const liveScores = useLiveScores(picks);

  // Filter picks by date range
  const filteredPicks = useMemo(() => {
    if (!dateRange.start && !dateRange.end) return picks;
    return picks.filter(p => {
      if (!p.date) return true;
      if (dateRange.start && p.date < dateRange.start) return false;
      if (dateRange.end   && p.date > dateRange.end)   return false;
      return true;
    });
  }, [picks, dateRange]);

  const stats     = useMemo(() => calcStats(picks), [picks]);          // always full stats for summary bar
  const filtStats = useMemo(() => calcStats(filteredPicks), [filteredPicks]);
  const curve     = useMemo(() => buildEquityCurve(filteredPicks), [filteredPicks]);
  const breakdown = useMemo(() => buildSportBreakdown(filteredPicks), [filteredPicks]);

  if (picks.length === 0) {
    return (
      <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 1rem', gap: '1rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', opacity: 0.4 }}>📊</div>
        <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1.1rem' }}>No picks yet</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', maxWidth: '320px', lineHeight: 1.6 }}>
          Add your first pick to start tracking your record and ROI. Use the <strong style={{ color: 'var(--gold)' }}>+ Add Pick</strong> button to get started.
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* ── Neutral summary bar (always full dataset) ── */}
      <NeutralSummaryBar stats={stats} picks={picks} />

      {/* ── Date range selector ── */}
      <DateRangeSelector range={dateRange} onChange={setDateRange} />

      {/* ── Calendar + Equity Curve side by side — matched heights ── */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'stretch', flexWrap: 'wrap' }}>

        {/* Calendar — ~57%, stacks to full width on mobile */}
        <div style={{ flex: '3 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <PickCalendar picks={filteredPicks} dateRange={dateRange} onRangeChange={setDateRange} timezone={timezone} />
        </div>

        {/* Equity Curve — ~43%, stacks to full width on mobile */}
        <div style={{ flex: '2 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px',
            padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', flex: 1,
          }}>
            {/* Curve header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.85rem', flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.95rem' }}>📈 Equity Curve</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>
                  {filtStats.total} picks settled
                  {(dateRange.start || dateRange.end) && <span style={{ color: 'var(--gold)', marginLeft: '6px' }}>· filtered</span>}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '1.1rem', color: filtStats.units >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {filtStats.units >= 0 ? '+' : ''}{filtStats.units.toFixed(2)}u
                </div>
                <div style={{ fontSize: '0.65rem', color: filtStats.roi >= 0 ? 'var(--green)' : 'var(--red)', fontFamily: 'IBM Plex Mono' }}>
                  {filtStats.roi >= 0 ? '+' : ''}{filtStats.roi.toFixed(1)}% ROI
                </div>
              </div>
            </div>

            {/* Chart — fills remaining space */}
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {curve.length < 2 ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '8px' }}>
                  <div style={{ fontSize: '2rem', opacity: 0.4 }}>📊</div>
                  <div style={{ fontSize: '0.8rem', textAlign: 'center' }}>No settled picks yet.<br />Your equity curve will appear here.</div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%" minHeight={140}>
                  <AreaChart data={curve} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
                    <defs>
                      <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#FFB800" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#FFB800" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 9 }} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="units" stroke="#FFB800" strokeWidth={2.5}
                      fill="url(#goldGrad)" dot={false} activeDot={{ r: 5, fill: '#FFB800', strokeWidth: 0 }} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Mini stats row at bottom of curve panel */}
            {filtStats.total > 0 && (
              <div style={{ display: 'flex', gap: '0', marginTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.6rem', flexShrink: 0 }}>
                {[
                  { label: 'W-L', value: `${filtStats.wins}-${filtStats.losses}`, color: filtStats.wins > filtStats.losses ? 'var(--green)' : 'var(--red)' },
                  { label: 'Win%', value: filtStats.total > 0 ? `${((filtStats.wins / filtStats.total) * 100).toFixed(0)}%` : '—', color: 'var(--text-secondary)' },
                  { label: 'Streak', value: filtStats.streak.count > 0 ? `${filtStats.streak.type === 'WIN' ? 'W' : 'L'}${filtStats.streak.count}` : '—', color: filtStats.streak.type === 'WIN' ? 'var(--green)' : filtStats.streak.type === 'LOSS' ? 'var(--red)' : 'var(--text-muted)' },
                ].map(s => (
                  <div key={s.label} style={{ flex: 1, textAlign: 'center', borderRight: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 700, fontSize: '0.82rem', color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                  </div>
                ))}
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 700, fontSize: '0.82rem', color: 'var(--gold)' }}>
                    {filtStats.avgImpliedProb != null ? `${filtStats.avgImpliedProb}%` : '—'}
                  </div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Avg Implied</div>
                </div>
              </div>
            )}
          </div>

          {/* Day of Week grid below curve */}
          <DayOfWeekGrid picks={filteredPicks} />
        </div>
      </div>

      {/* ── Sport Breakdown ── */}
      {breakdown.length > 0 && (
        <div className="surface" style={{ padding: '1.1rem 1.25rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>By Sport</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '80px 70px 1fr 80px', gap: '8px', padding: '0 4px', marginBottom: '2px' }}>
              {['Sport', 'Record', 'Units', 'ROI'].map(h => (
                <span key={h} style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
              ))}
            </div>
            {breakdown.map(row => {
              const total = row.wins + row.losses;
              const roi   = total ? (row.units / total) * 100 : 0;
              return (
                <div key={row.sport} className="surface-elevated" style={{ display: 'grid', gridTemplateColumns: '80px 70px 1fr 80px', gap: '8px', padding: '0.55rem', borderRadius: '6px', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.82rem' }}>{sportEmoji(row.sport)} {row.sport}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.82rem', color: row.wins > row.losses ? 'var(--green)' : row.losses > row.wins ? 'var(--red)' : 'var(--text-secondary)' }}>{row.wins}-{row.losses}</span>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.82rem', color: row.units >= 0 ? 'var(--green)' : 'var(--red)' }}>{row.units >= 0 ? '+' : ''}{row.units.toFixed(2)}u</span>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.78rem', color: roi >= 0 ? 'var(--green)' : 'var(--red)' }}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Recent Picks ── */}
      {picks.length > 0 && (
        <div className="surface" style={{ padding: '1.1rem 1.25rem' }}>
          <h2 style={{ fontWeight: 700, fontSize: '0.88rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Recent Picks</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[...picks].reverse().slice(0, 8).map((p) => {
              // Resolve live game data: prefer graded scores for settled picks, else live ESPN
              const scoreKey = `${(p.sport || '').toLowerCase()}|${p.date}`;
              const espnEvents = liveScores[scoreKey] || [];
              let game = null;

              if ((p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH')
                  && p.graded_home_score != null && p.graded_away_score != null) {
                // Build a synthetic "game" from graded score columns
                const teamRaw = stripLine(p.team || '');
                game = {
                  homeAbbr:  p.home_team ? (p.home_team.split(' ').pop()) : 'HM',
                  awayAbbr:  p.away_team ? (p.away_team.split(' ').pop()) : 'AW',
                  homeScore: parseInt(p.graded_home_score),
                  awayScore: parseInt(p.graded_away_score),
                  isLive: false, isFinal: true, side: null, shortDetail: '',
                };
              } else if (espnEvents.length) {
                game = findPickGame(p, espnEvents);
              }

              const trend = calcTrend(p, game);
              const units = parseFloat(p.units) || 1;

              return (
                <div key={p.id} className="surface-elevated" style={{ padding: '0.7rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {/* Top row: emoji, date, team, sport/type, units badge */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
                      <span style={{ fontSize: '0.88rem', flexShrink: 0 }}>{sportEmoji(p.sport)}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', flexShrink: 0 }}>{p.date}</span>
                      {onViewGame
                        ? (
                          <button onClick={() => onViewGame(p)} style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            fontWeight: 600, color: 'var(--gold)', fontSize: '0.88rem',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            textDecoration: 'underline dotted', textUnderlineOffset: '2px',
                            fontFamily: 'inherit',
                          }} title="View on Scoreboard">{p.team}</button>
                        ) : (
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.team}</span>
                        )
                      }
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', flexShrink: 0, whiteSpace: 'nowrap' }}>{p.sport} · {p.bet_type}</span>
                      {(p.matchup || (p.home_team && p.away_team)) && (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', flexShrink: 0, whiteSpace: 'nowrap', opacity: 0.8 }}>
                          · {p.matchup || `${p.away_team} @ ${p.home_team}`}
                        </span>
                      )}
                    </div>
                    {/* Units badge */}
                    <span style={{
                      padding: '1px 6px', borderRadius: '4px', fontSize: '0.65rem', fontWeight: 700,
                      background: 'rgba(255,184,0,0.1)', color: 'var(--gold)',
                      border: '1px solid rgba(255,184,0,0.2)', flexShrink: 0,
                    }}>{units}u</span>
                  </div>

                  {/* Bottom row: scorebug + trend + odds + result + P/L */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    {/* Left: scorebug + trend */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <MiniScoreBug pick={p} game={game} />
                      <TrendingBadge trend={trend} />
                    </div>
                    {/* Right: odds, result badge, P/L */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
                      <span style={{ color: parseInt(p.odds) > 0 ? 'var(--green)' : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.82rem', fontFamily: 'IBM Plex Mono' }}>
                        {parseInt(p.odds) > 0 ? '+' : ''}{p.odds}
                      </span>
                      <span className={`badge-${p.result?.toLowerCase() || 'pending'}`} style={{ padding: '2px 7px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>
                        {p.result || 'PENDING'}
                      </span>
                      <span style={{ color: parseFloat(p.profit) >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600, fontSize: '0.82rem', fontFamily: 'IBM Plex Mono', minWidth: '50px', textAlign: 'right' }}>
                        {p.profit != null && p.profit !== '' ? `${parseFloat(p.profit) >= 0 ? '+' : ''}${parseFloat(p.profit).toFixed(2)}u` : '—'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}
