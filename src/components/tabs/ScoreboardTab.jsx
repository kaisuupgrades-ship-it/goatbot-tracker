'use client';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import BetSlipModal from '@/components/BetSlipModal';
import VoiceButton from '@/components/VoiceInput';
import { getUserPrefs, formatGameTime, getTzAbbr } from '@/lib/userPrefs';

// ── Star/Favorite persistence ──────────────────────────────────────────────────
const STARRED_KEY = 'betos_starred_games';

export function useStarredGames() {
  const [starred, setStarred] = useState({});

  function loadFromStorage() {
    try { setStarred(JSON.parse(localStorage.getItem(STARRED_KEY) || '{}')); } catch {}
  }

  useEffect(() => {
    loadFromStorage();
    // React to changes made by FeaturedGamesTab (same tab) or other tabs
    function onStorage(e) {
      if (!e.key || e.key === STARRED_KEY) loadFromStorage();
    }
    window.addEventListener('storage', onStorage);
    // Also poll every 1s to catch same-page updates (localStorage events don't fire within same page)
    const interval = setInterval(loadFromStorage, 1000);
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(interval);
    };
  }, []);

  function toggleStar(e, game) {
    e.stopPropagation();
    setStarred(prev => {
      const next = { ...prev };
      if (next[game.id]) { delete next[game.id]; }
      else { next[game.id] = game; }
      try { localStorage.setItem(STARRED_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  return { starred, toggleStar };
}

// ── Sport Config ──────────────────────────────────────────────────────────────
const SPORTS = [
  { key: 'all',    label: 'All',    emoji: '🏆', color: '#FFB800' },
  { key: 'mlb',    label: 'MLB',    emoji: '⚾', color: '#e63946' },
  { key: 'nfl',    label: 'NFL',    emoji: '🏈', color: '#2a9d8f' },
  { key: 'nba',    label: 'NBA',    emoji: '🏀', color: '#e76f51' },
  { key: 'nhl',    label: 'NHL',    emoji: '🏒', color: '#457b9d' },
  { key: 'ncaaf',  label: 'NCAAF',  emoji: '🏈', color: '#8338ec' },
  { key: 'ncaab',  label: 'NCAAB',  emoji: '🏀', color: '#fb8500' },
  { key: 'mls',    label: 'MLS',    emoji: '⚽', color: '#06d6a0' },
  { key: 'wnba',   label: 'WNBA',   emoji: '🏀', color: '#ff6b9d' },
  { key: 'tennis', label: 'Tennis', emoji: '🎾', color: '#84cc16' },
  { key: 'golf',   label: 'Golf',   emoji: '⛳', color: '#22c55e' },
];

// Sports fetched in "All" mode (skip 'all' key itself)
const ALL_SPORTS_KEYS = SPORTS.filter(s => s.key !== 'all').map(s => s.key);

// Merge new games into existing state by game ID, preserving object references for unchanged games
function mergeGames(prevGames, newGames) {
  if (!prevGames.length) return newGames; // first load, just set
  const prevMap = new Map(prevGames.map(g => [g.id, g]));
  return newGames.map(g => {
    const prev = prevMap.get(g.id);
    if (!prev) return g;

    // Preserve closing odds when ESPN drops them on live/final games
    const hasNewOdds  = (g.competitions?.[0]?.odds?.length   ?? 0) > 0;
    const hasPrevOdds = (prev.competitions?.[0]?.odds?.length ?? 0) > 0;

    let merged = g;
    if (!hasNewOdds && hasPrevOdds) {
      // Carry forward the last known odds, tag as closing line
      merged = {
        ...g,
        _closingLine: true,
        competitions: (g.competitions || []).map((comp, i) => ({
          ...comp,
          odds: comp.odds?.length ? comp.odds : (prev.competitions?.[i]?.odds ?? []),
        })),
      };
    } else if (prev._closingLine && hasNewOdds) {
      // Odds came back (unlikely but handle it) — clear the flag
      merged = { ...g, _closingLine: false };
    }

    // If nothing meaningful changed, keep old reference (avoids unnecessary re-renders)
    if (
      !merged._closingLine &&
      JSON.stringify(prev.competitions) === JSON.stringify(merged.competitions) &&
      prev.status?.type?.state === merged.status?.type?.state
    ) {
      return prev;
    }
    return merged;
  });
}

// Sort a mixed-sport event list: live → upcoming (chrono) → final (newest first)
export function sortAllSportsEvents(events) {
  const live     = events.filter(e => getGameState(e).state === 'live');
  const upcoming = events.filter(e => getGameState(e).state === 'pre');
  const final    = events.filter(e => getGameState(e).state === 'final');
  live.sort    ((a, b) => new Date(a.date) - new Date(b.date));
  upcoming.sort((a, b) => new Date(a.date) - new Date(b.date));
  final.sort   ((a, b) => new Date(b.date) - new Date(a.date));
  return [...live, ...upcoming, ...final];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Simple time formatter used only by getGameState (no timezone awareness needed there)
function fmtTimeBasic(dateStr) {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch { return dateStr; }
}

function getGameState(event) {
  const status = event?.status?.type;
  if (!status) return { state: 'pre', label: 'Scheduled', color: '#60a5fa' };
  if (status.state === 'in') return { state: 'live', label: status.shortDetail || 'LIVE', color: '#4ade80' };
  if (status.state === 'post') return { state: 'final', label: status.shortDetail || 'Final', color: '#888' };
  return { state: 'pre', label: fmtTimeBasic(event.date), color: '#60a5fa' };
}

function getCompetitors(event) {
  const comp = event?.competitions?.[0]?.competitors || [];
  const away = comp.find(c => c.homeAway === 'away') || comp[0] || {};
  const home = comp.find(c => c.homeAway === 'home') || comp[1] || {};
  return { away, home };
}

function getOdds(event) {
  const odds = event?.competitions?.[0]?.odds?.[0];
  if (!odds) return null;

  // ── Moneyline ─────────────────────────────────────────────────────────────
  let homeOdds = odds.homeTeamOdds?.moneyLine
    || odds.homeTeamOdds?.current?.moneyLine
    || null;
  let awayOdds = odds.awayTeamOdds?.moneyLine
    || odds.awayTeamOdds?.current?.moneyLine
    || null;

  // Fallback: ESPN details = "LAD -314" for MLB/NHL where -NNN IS the ML price
  if ((!homeOdds || !awayOdds) && odds.details) {
    const m = odds.details.match(/([A-Z]+)\s*([-+]?\d+)/);
    if (m) {
      const parsedOdds = parseInt(m[2]);
      if (Math.abs(parsedOdds) >= 100) {
        // The listed team gets the parsed odds; opposing team gets the other side
        const detailsTeamIsHome = event?.competitions?.[0]?.competitors
          ?.find(c => c.homeAway === 'home')?.team?.abbreviation === m[1];
        if (detailsTeamIsHome) {
          if (!homeOdds) homeOdds = parsedOdds;
        } else {
          if (!awayOdds) awayOdds = parsedOdds;
        }
      }
    }
  }

  // ── Spread / Run Line / Puck Line prices ──────────────────────────────────
  // Prefer enriched _real fields (from The Odds API); fall back to ESPN
  const homeSpreadOdds = odds._homeSpreadOdds
    ?? odds.homeTeamOdds?.spreadLine
    ?? odds.homeTeamOdds?.current?.pointSpread?.american
    ?? null;
  const awaySpreadOdds = odds._awaySpreadOdds
    ?? odds.awayTeamOdds?.spreadLine
    ?? odds.awayTeamOdds?.current?.pointSpread?.american
    ?? null;

  // ── Over / Under prices ────────────────────────────────────────────────────
  const overOdds  = odds._overOdds  ?? odds.overOdds  ?? odds.homeTeamOdds?.overLine  ?? null;
  const underOdds = odds._underOdds ?? odds.underOdds ?? odds.awayTeamOdds?.underLine ?? null;

  return {
    homeOdds,
    awayOdds,
    spread:   odds.details || null,
    total:    odds.overUnder ?? null,
    homeSpreadOdds,
    awaySpreadOdds,
    overOdds,
    underOdds,
    provider: odds._source || odds.provider?.name || '',
  };
}

function getBroadcast(event) {
  const broadcasts = event?.competitions?.[0]?.broadcasts || [];
  return broadcasts.map(b => b.names?.join(', ')).filter(Boolean).join(' • ') || null;
}

function getVenue(event) {
  const venue = event?.competitions?.[0]?.venue;
  if (!venue) return null;
  return `${venue.fullName}${venue.address?.city ? ', ' + venue.address.city : ''}`;
}

function getRecords(competitor) {
  const recs = competitor?.records || [];
  const total  = recs.find(r => r.type === 'total' || r.name === 'overall')?.summary;
  const home   = recs.find(r => r.type === 'home')?.summary;
  const away   = recs.find(r => r.type === 'road' || r.type === 'away')?.summary;
  return { total, home, away };
}

// ── MLB: Extract probable starting pitchers ────────────────────────────────────
function getProbablePitchers(event) {
  const comps = event?.competitions?.[0]?.competitors || [];
  const result = {};
  comps.forEach(c => {
    const prob = c.probables?.[0];
    if (prob?.athlete) {
      const statsMap = {};
      (prob.statistics || []).forEach(s => { statsMap[s.name] = s.displayValue; });
      const wins   = statsMap['wins']   || statsMap['W']   || null;
      const losses = statsMap['losses'] || statsMap['L']   || null;
      result[c.homeAway] = {
        name:     prob.athlete.shortName || prob.athlete.displayName || null,
        headshot: prob.athlete.headshot?.href || null,
        era:      statsMap['ERA']  || statsMap['era']  || null,
        record:   wins != null && losses != null ? `${wins}-${losses}` : null,
        hand:     prob.athlete.hand?.abbreviation ? `${prob.athlete.hand.abbreviation}HP` : null,
      };
    }
  });
  return Object.keys(result).length > 0 ? result : null;
}

// ── NHL: Extract starting/probable goalies ─────────────────────────────────────
function getStartingGoalies(event) {
  const comps = event?.competitions?.[0]?.competitors || [];
  const result = {};
  comps.forEach(c => {
    // ESPN NHL sometimes lists probable goalie in probables[]
    const prob = c.probables?.[0];
    if (prob?.athlete) {
      const statsMap = {};
      (prob.statistics || []).forEach(s => { statsMap[s.name] = s.displayValue; });
      result[c.homeAway] = {
        name:     prob.athlete.shortName || prob.athlete.displayName || null,
        headshot: prob.athlete.headshot?.href || null,
        savePct:  statsMap['savePctg'] || statsMap['savePct'] || statsMap['saves'] || null,
        gaa:      statsMap['goalsAgainstAverage'] || statsMap['GAA'] || null,
      };
    }
  });
  return Object.keys(result).length > 0 ? result : null;
}

function getSituation(event) {
  return event?.competitions?.[0]?.situation || null;
}

function getSeries(event) {
  return event?.competitions?.[0]?.series || null;
}

// ── Stadium database: team abbr → { lat, lon, orientation, dome, retractable } ─
// orientation = compass bearing from home plate → center field (degrees)
const MLB_STADIUMS = {
  ARI: { lat: 33.445, lon: -112.067, name: 'Chase Field',           retractable: true },
  ATL: { lat: 33.890, lon: -84.468,  name: 'Truist Park',           orientation: 58  },
  BAL: { lat: 39.284, lon: -76.622,  name: 'Oriole Park',           orientation: 30  },
  BOS: { lat: 42.347, lon: -71.097,  name: 'Fenway Park',           orientation: 90  },
  CHC: { lat: 41.948, lon: -87.656,  name: 'Wrigley Field',         orientation: 180 },
  CWS: { lat: 41.830, lon: -87.634,  name: 'Guaranteed Rate Field', orientation: 5   },
  CIN: { lat: 39.097, lon: -84.507,  name: 'Great American BP',     orientation: 25  },
  CLE: { lat: 41.496, lon: -81.685,  name: 'Progressive Field',     orientation: 30  },
  COL: { lat: 39.756, lon: -104.994, name: 'Coors Field',           orientation: 20  },
  DET: { lat: 42.339, lon: -83.048,  name: 'Comerica Park',         orientation: 20  },
  HOU: { lat: 29.757, lon: -95.355,  name: 'Minute Maid Park',      retractable: true },
  KC:  { lat: 39.051, lon: -94.480,  name: 'Kauffman Stadium',      orientation: 40  },
  LAA: { lat: 33.800, lon: -117.883, name: 'Angel Stadium',         orientation: 35  },
  LAD: { lat: 34.074, lon: -118.240, name: 'Dodger Stadium',        orientation: 35  },
  MIA: { lat: 25.778, lon: -80.220,  name: 'loanDepot park',        retractable: true },
  MIL: { lat: 43.028, lon: -87.971,  name: 'American Family Field', retractable: true },
  MIN: { lat: 44.982, lon: -93.278,  name: 'Target Field',          orientation: 20  },
  NYM: { lat: 40.757, lon: -73.846,  name: 'Citi Field',            orientation: 35  },
  NYY: { lat: 40.829, lon: -73.926,  name: 'Yankee Stadium',        orientation: 60  },
  OAK: { lat: 37.752, lon: -122.201, name: 'Oakland Coliseum',      orientation: 28  },
  PHI: { lat: 39.906, lon: -75.167,  name: 'Citizens Bank Park',    orientation: 10  },
  PIT: { lat: 40.447, lon: -80.006,  name: 'PNC Park',              orientation: 35  },
  SD:  { lat: 32.707, lon: -117.157, name: 'Petco Park',            orientation: 25  },
  SEA: { lat: 47.591, lon: -122.333, name: 'T-Mobile Park',         retractable: true },
  SF:  { lat: 37.778, lon: -122.389, name: 'Oracle Park',           orientation: 50  },
  STL: { lat: 38.623, lon: -90.193,  name: 'Busch Stadium',         orientation: 10  },
  TB:  { lat: 27.768, lon: -82.653,  name: 'Tropicana Field',       dome: true },
  TEX: { lat: 32.747, lon: -97.083,  name: 'Globe Life Field',      retractable: true },
  TOR: { lat: 43.641, lon: -79.389,  name: 'Rogers Centre',         retractable: true },
  WSH: { lat: 38.873, lon: -77.007,  name: 'Nationals Park',        orientation: 33  },
};

const NFL_STADIUMS = {
  BUF: { lat: 42.774, lon: -78.787,  name: 'Highmark Stadium',       orientation: 0   },
  NE:  { lat: 42.091, lon: -71.264,  name: 'Gillette Stadium',        orientation: 0   },
  NYG: { lat: 40.813, lon: -74.074,  name: 'MetLife Stadium',         orientation: 0   },
  NYJ: { lat: 40.813, lon: -74.074,  name: 'MetLife Stadium',         orientation: 0   },
  PHI: { lat: 39.901, lon: -75.168,  name: 'Lincoln Financial Field', orientation: 0   },
  PIT: { lat: 40.447, lon: -80.016,  name: 'Acrisure Stadium',        orientation: 0   },
  BAL: { lat: 39.278, lon: -76.623,  name: 'M&T Bank Stadium',        orientation: 0   },
  CLE: { lat: 41.506, lon: -81.699,  name: 'Cleveland Browns Stadium',orientation: 0   },
  CIN: { lat: 39.095, lon: -84.516,  name: 'Paycor Stadium',          orientation: 0   },
  TEN: { lat: 36.166, lon: -86.771,  name: 'Nissan Stadium',          orientation: 0   },
  JAX: { lat: 30.324, lon: -81.638,  name: 'EverBank Stadium',        orientation: 0   },
  HOU: { lat: 29.685, lon: -95.411,  name: 'NRG Stadium',             dome: true },
  IND: { lat: 39.760, lon: -86.164,  name: 'Lucas Oil Stadium',       dome: true },
  KC:  { lat: 39.049, lon: -94.484,  name: 'Arrowhead Stadium',       orientation: 0   },
  DEN: { lat: 39.744, lon: -105.020, name: "Empower Field",           orientation: 0   },
  LAC: { lat: 33.953, lon: -118.339, name: 'SoFi Stadium',            dome: true },
  LAR: { lat: 33.953, lon: -118.339, name: 'SoFi Stadium',            dome: true },
  LV:  { lat: 36.091, lon: -115.184, name: 'Allegiant Stadium',       dome: true },
  SEA: { lat: 47.595, lon: -122.332, name: 'Lumen Field',             orientation: 0   },
  SF:  { lat: 37.403, lon: -121.970, name: "Levi's Stadium",          orientation: 0   },
  ARI: { lat: 33.527, lon: -112.263, name: 'State Farm Stadium',      dome: true },
  MIA: { lat: 25.958, lon: -80.239,  name: 'Hard Rock Stadium',       orientation: 0   },
  TB:  { lat: 27.976, lon: -82.503,  name: 'Raymond James Stadium',   orientation: 0   },
  ATL: { lat: 33.755, lon: -84.401,  name: 'Mercedes-Benz Stadium',   dome: true },
  NO:  { lat: 29.951, lon: -90.081,  name: 'Caesars Superdome',       dome: true },
  CAR: { lat: 35.226, lon: -80.853,  name: 'Bank of America Stadium', orientation: 0   },
  CHI: { lat: 41.862, lon: -87.617,  name: 'Soldier Field',           orientation: 0   },
  GB:  { lat: 44.501, lon: -88.062,  name: 'Lambeau Field',           orientation: 0   },
  MIN: { lat: 44.974, lon: -93.258,  name: 'U.S. Bank Stadium',       dome: true },
  DET: { lat: 42.340, lon: -83.046,  name: 'Ford Field',              dome: true },
  DAL: { lat: 32.748, lon: -97.093,  name: 'AT&T Stadium',            retractable: true },
  WAS: { lat: 38.908, lon: -76.864,  name: 'Northwest Stadium',       orientation: 0   },
};

// ESPN sometimes returns different abbreviations than our stadium DB keys
const MLB_ESPN_ALIASES = {
  'CHW': 'CWS',  // Chicago White Sox (ESPN uses CHW, our DB uses CWS)
  'WSH': 'WSH',  // Washington Nationals — both the same, kept for clarity
};
const NFL_ESPN_ALIASES = {
  'WAS': 'WAS',  // Washington Commanders — ESPN uses WAS
};

function getStadiumInfo(sport, homeAbbr) {
  if (!homeAbbr) return null;
  if (sport === 'mlb') {
    const key = MLB_ESPN_ALIASES[homeAbbr] ?? homeAbbr;
    return MLB_STADIUMS[key] || null;
  }
  if (sport === 'nfl') {
    const key = NFL_ESPN_ALIASES[homeAbbr] ?? homeAbbr;
    return NFL_STADIUMS[key] || null;
  }
  return null;
}

// Sports where weather is never relevant (indoor arenas)
const INDOOR_SPORTS = new Set(['nba', 'nhl', 'ncaab', 'wnba']);

// ── WeatherWidget ────────────────────────────────────────────────────────────
function WeatherWidget({ stadium, gameDate, sport }) {
  const [wx, setWx]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!stadium?.lat) { setLoading(false); return; }
    const params = new URLSearchParams({
      lat: stadium.lat,
      lon: stadium.lon,
      ...(gameDate ? { gameTime: gameDate } : {}),
    });
    fetch(`/api/weather?${params}`)
      .then(r => r.json())
      .then(d => { setWx(d.error ? null : d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [stadium?.lat, stadium?.lon, gameDate]);

  if (stadium?.dome) {
    return (
      <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '1.4rem' }}>🏟️</span>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700 }}>{stadium.name}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>Domed stadium — weather not a factor</div>
        </div>
      </div>
    );
  }

  if (stadium?.retractable && !wx) {
    return (
      <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '1.4rem' }}>🏟️</span>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700 }}>{stadium.name}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>Retractable roof — check game-day status</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '0.65rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
        Loading game-time forecast…
      </div>
    );
  }

  if (!wx) {
    // Log weather failure to admin notifications (fire-and-forget)
    try {
      fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'log_event', event: 'weather_unavailable', stadium: stadium?.name, gameDate }),
      }).catch(() => {});
    } catch {}
    return (
      <div style={{
        padding: '0.75rem 0.85rem', background: 'rgba(255,255,255,0.025)', borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '10px',
      }}>
        <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>🌐</span>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700 }}>{stadium?.name || 'Outdoor Stadium'}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>
            Weather data temporarily unavailable — check back closer to game time
          </div>
        </div>
      </div>
    );
  }

  const isBad    = wx.code >= 61 || wx.precip_pct >= 50;
  const windHigh = wx.windspeed >= 15;
  const isCold   = wx.temp_f < 45;
  const isHot    = wx.temp_f > 92;

  // Wind arrow angle: wind blows FROM this compass direction
  // Arrow should point the direction wind is blowing TO (opposite of "from")
  const arrowDeg = (wx.winddir + 180) % 360;

  // Field orientation: if stadium has orientation, show wind relative to field
  const fieldAngle = stadium?.orientation ?? 0;
  // Wind angle relative to center field direction
  const relAngle = ((arrowDeg - fieldAngle) + 360) % 360;
  let windContext = '';
  if (wx.windspeed >= 8) {
    if (relAngle < 30 || relAngle > 330)         windContext = '→ Blowing out to CF';
    else if (relAngle > 150 && relAngle < 210)   windContext = '← Blowing in from CF';
    else if (relAngle >= 30 && relAngle <= 150)  windContext = '↗ Cross wind (LF side)';
    else                                          windContext = '↖ Cross wind (RF side)';
  }

  return (
    <div style={{ background: 'rgba(255,255,255,0.025)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '0.6rem 0.85rem 0.4rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '1rem' }}>{wx.emoji}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700 }}>
            {stadium?.name || 'Stadium'}
          </span>
          {stadium?.retractable && (
            <span style={{ fontSize: '0.58rem', color: '#60a5fa', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '3px', padding: '1px 4px' }}>
              RETRACTABLE
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {wx.historical ? '✓ Actual game-time conditions' : 'Game-time forecast'}
        </span>
      </div>

      <div style={{ padding: '0.75rem 0.85rem', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
        {/* Stadium SVG — clean top-down view */}
        <div style={{ flexShrink: 0, position: 'relative', width: '88px', height: '88px' }}>
          <svg viewBox="0 0 100 100" width="88" height="88">
            {sport === 'mlb' ? (
              <>
                {/* Outfield grass */}
                <path d="M 50 80 L 12 80 A 54 54 0 0 1 88 80 Z" fill="rgba(74,222,128,0.09)" stroke="rgba(74,222,128,0.25)" strokeWidth="1.2" />
                {/* Foul lines */}
                <line x1="50" y1="80" x2="14" y2="26" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                <line x1="50" y1="80" x2="86" y2="26" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                {/* Infield dirt */}
                <polygon points="50,46 66,62 50,78 34,62" fill="rgba(200,160,100,0.1)" stroke="rgba(200,160,100,0.25)" strokeWidth="1" />
                {/* Base paths */}
                <polygon points="50,46 66,62 50,78 34,62" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />
                {/* Bases */}
                <rect x="47.5" y="43.5" width="5" height="5" rx="1" fill="rgba(255,240,200,0.7)" />
                <rect x="63.5" y="59.5" width="5" height="5" rx="1" fill="rgba(255,240,200,0.7)" />
                <rect x="47.5" y="75.5" width="5" height="5" rx="1" fill="rgba(255,240,200,0.7)" />
                <rect x="31.5" y="59.5" width="5" height="5" rx="1" fill="rgba(255,240,200,0.7)" />
                {/* Pitcher mound */}
                <circle cx="50" cy="62" r="3" fill="rgba(200,160,100,0.3)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
              </>
            ) : (
              <>
                {/* Football field */}
                <rect x="12" y="24" width="76" height="52" rx="5" fill="rgba(74,222,128,0.08)" stroke="rgba(74,222,128,0.25)" strokeWidth="1.2" />
                {/* Yard lines */}
                {[25,38,50,62,75].map(x => (
                  <line key={x} x1={12 + (x/100)*76} y1="24" x2={12 + (x/100)*76} y2="76" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" />
                ))}
                {/* Center line */}
                <line x1="50" y1="24" x2="50" y2="76" stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                {/* End zones */}
                <rect x="12" y="24" width="10" height="52" rx="5" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />
                <rect x="78" y="24" width="10" height="52" rx="5" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" strokeWidth="0.6" />
              </>
            )}
          </svg>

          {/* Wind arrow — pure SVG, overlaid centered, pointing UP at 0deg rotation */}
          {wx.windspeed > 2 && (() => {
            const arrowLen = Math.min(20 + wx.windspeed * 0.7, 34);
            const opacity  = Math.min(0.55 + wx.windspeed / 30, 1);
            const glow     = windHigh ? `drop-shadow(0 0 5px rgba(147,197,253,0.75))` : 'none';
            return (
              <svg
                viewBox="-12 -20 24 40"
                width="24" height="40"
                style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: `translate(-50%, -50%) rotate(${arrowDeg}deg)`,
                  transition: 'transform 1s ease',
                  pointerEvents: 'none',
                  overflow: 'visible',
                  filter: glow,
                }}
              >
                {/* Shaft — draws from bottom toward tip (upward) */}
                <line
                  x1="0" y1="18"
                  x2="0" y2={-arrowLen + 12}
                  stroke={`rgba(147,197,253,${opacity})`}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                {/* Arrowhead — points UP (negative y = up in SVG) */}
                <polygon
                  points={`0,${-arrowLen + 4} -5,${-arrowLen + 14} 5,${-arrowLen + 14}`}
                  fill={`rgba(147,197,253,${opacity})`}
                />
              </svg>
            );
          })()}
          {wx.windspeed <= 2 && (
            <div style={{
              position: 'absolute', bottom: '4px', left: '50%', transform: 'translateX(-50%)',
              fontSize: '0.55rem', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em',
            }}>CALM</div>
          )}
        </div>

        {/* Stats grid */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
          {[
            { label: 'TEMP',   value: `${wx.temp_f}°F`,  alert: isCold || isHot, color: isCold ? '#60a5fa' : isHot ? '#f87171' : 'var(--text-primary)' },
            { label: 'WIND',   value: wx.windspeed > 0 ? `${wx.windspeed} mph ${wx.compass}` : 'Calm', alert: windHigh, color: windHigh ? '#fbbf24' : 'var(--text-primary)' },
            { label: 'PRECIP', value: `${wx.precip_pct}%`, alert: wx.precip_pct >= 40, color: wx.precip_pct >= 40 ? '#f87171' : 'var(--text-primary)' },
            { label: 'HUMID',  value: `${wx.humidity}%`,  alert: false, color: 'var(--text-secondary)' },
          ].map(({ label, value, alert, color }) => (
            <div key={label}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>{label}</div>
              <div style={{ color, fontSize: '0.82rem', fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', display: 'flex', alignItems: 'center', gap: '3px' }}>
                {alert && <span style={{ fontSize: '0.62rem' }}>⚠</span>}{value}
              </div>
            </div>
          ))}

          {/* Wind context — full width */}
          {windContext && (
            <div style={{ gridColumn: '1 / -1', marginTop: '2px', fontSize: '0.68rem', color: '#93c5fd', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span>{windContext}</span>
              {windHigh && sport === 'mlb' && <span style={{ color: 'var(--text-muted)' }}>· affects fly balls</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getH2H(event) {
  // ESPN sometimes embeds season-series info in notes or headlines
  const notes = event?.competitions?.[0]?.notes || [];
  for (const n of notes) {
    const t = n.text || n.headline || '';
    if (/series|h2h|head.to.head|season record/i.test(t)) return t;
  }
  const headlines = event?.competitions?.[0]?.headlines || [];
  for (const h of headlines) {
    const t = h.shortLinkText || h.description || h.text || '';
    if (/series|h2h/i.test(t)) return t;
  }
  // Fall back to series object
  const series = event?.competitions?.[0]?.series;
  if (series?.summary) return `${series.title || 'Series'}: ${series.summary}`;
  return null;
}

function formatOdds(n, oddsFormat = 'american') {
  if (n == null) return '—';
  if (oddsFormat === 'decimal') {
    const d = n > 0 ? (n / 100 + 1) : (100 / Math.abs(n) + 1);
    return d.toFixed(2);
  }
  return n > 0 ? `+${n}` : `${n}`;
}

function truncBroadcast(str, max = 40) {
  if (!str || str.length <= max) return str;
  return str.slice(0, max) + '…';
}

function getWinProb(event) {
  const prob = event?.competitions?.[0]?.situation?.probability;
  if (!prob) return null;
  const home = parseFloat(prob.homeWinPercentage) || 0;
  const tie  = parseFloat(prob.tiePercentage) || 0;
  return { home, away: Math.max(0, 1 - home - tie), tie };
}

// Implied probability from American odds
function impliedProb(odds) {
  if (!odds) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

// Win Probability Bar component
function WinProbBar({ homeTeam, awayTeam, homeProb, awayProb, homeOdds, awayOdds }) {
  const homePct = Math.round(homeProb * 100);
  const awayPct = Math.round(awayProb * 100);

  // Calculate AI edge vs market implied probability
  const homeImpl  = homeOdds ? impliedProb(homeOdds) : null;
  const awayImpl  = awayOdds ? impliedProb(awayOdds) : null;
  const homeEdge  = homeImpl != null ? (homeProb - homeImpl) * 100 : null;
  const awayEdge  = awayImpl != null ? (awayProb - awayImpl) * 100 : null;

  const edgeTeam  = homeEdge != null && awayEdge != null
    ? (Math.abs(homeEdge) > Math.abs(awayEdge) ? { name: homeTeam, edge: homeEdge } : { name: awayTeam, edge: awayEdge })
    : null;

  return (
    <div style={{ marginBottom: '0.75rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          📊 ESPN Win Probability
        </span>
        <span style={{ fontSize: '0.6rem', color: '#555' }}>via ESPN Analytics</span>
      </div>

      {/* Team labels and pcts */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700 }}>{awayTeam}</span>
          <span style={{ color: awayPct > 55 ? 'var(--green)' : awayPct < 30 ? 'var(--red)' : 'var(--text-primary)', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '1rem' }}>
            {awayPct}%
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: homePct > 55 ? 'var(--green)' : homePct < 30 ? 'var(--red)' : 'var(--text-primary)', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '1rem' }}>
            {homePct}%
          </span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700 }}>{homeTeam}</span>
        </div>
      </div>

      {/* Probability bar */}
      <div style={{ height: '8px', borderRadius: '4px', overflow: 'hidden', display: 'flex', background: 'var(--border)' }}>
        <div style={{
          width: `${awayPct}%`, height: '100%',
          background: awayPct > 60 ? 'var(--green)' : awayPct > 45 ? 'var(--blue)' : '#666',
          transition: 'width 0.6s ease',
        }} />
        <div style={{
          width: `${homePct}%`, height: '100%',
          background: homePct > 60 ? 'var(--green)' : homePct > 45 ? '#9B6DFF' : '#444',
          transition: 'width 0.6s ease',
        }} />
      </div>

      {/* AI Edge callout */}
      {edgeTeam && Math.abs(edgeTeam.edge) >= 3 && (
        <div style={{
          marginTop: '0.5rem', padding: '5px 10px', borderRadius: '6px',
          background: Math.abs(edgeTeam.edge) >= 8
            ? 'rgba(0,212,139,0.08)' : 'rgba(255,184,0,0.06)',
          border: `1px solid ${Math.abs(edgeTeam.edge) >= 8 ? 'rgba(0,212,139,0.25)' : 'rgba(255,184,0,0.2)'}`,
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ fontSize: '0.75rem' }}>{Math.abs(edgeTeam.edge) >= 8 ? '🔥' : '⚡'}</span>
          <span style={{ fontSize: '0.72rem', color: Math.abs(edgeTeam.edge) >= 8 ? 'var(--green)' : 'var(--gold)', fontWeight: 700 }}>
            AI EDGE: {edgeTeam.name} {edgeTeam.edge > 0 ? '+' : ''}{edgeTeam.edge.toFixed(1)}% vs market
          </span>
          {Math.abs(edgeTeam.edge) >= 8 && (
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>Sharp signal</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Game Card ─────────────────────────────────────────────────────────────────
export function GameCard({ event, sport, onAnalyze, onAddBet, starred, onStar, injuries, injuriesChecked, isAllMode, suppressHeader = false, externalExpanded = null, oddsFormat = 'american', timezone = 'America/New_York' }) {
  const [expanded, setExpanded] = useState(false);
  const isExpanded = suppressHeader ? (externalExpanded ?? false) : expanded;
  const [h2hData,  setH2hData]  = useState(null);   // { record, games } or null
  const [h2hLoad,  setH2hLoad]  = useState(false);
  const { away, home } = getCompetitors(event);
  const gameState  = getGameState(event);
  const odds       = getOdds(event);
  const broadcast  = getBroadcast(event);
  const venue      = getVenue(event);
  const situation  = getSituation(event);
  const series     = getSeries(event);
  const isStarred  = !!starred?.[event.id];

  const awayScore = away.score != null ? away.score : null;
  const homeScore = home.score != null ? home.score : null;
  const awayWin   = gameState.state === 'final' && away.winner;
  const homeWin   = gameState.state === 'final' && home.winner;

  const awayRec  = getRecords(away);
  const homeRec  = getRecords(home);
  const winProb  = getWinProb(event);

  const awayName = away.team?.displayName || away.team?.name || 'Away';
  const homeName = home.team?.displayName || home.team?.name || 'Home';

  // Sport-specific lineups
  const pitchers = sport === 'mlb' ? getProbablePitchers(event) : null;
  const goalies  = sport === 'nhl' ? getStartingGoalies(event) : null;
  const h2hNote  = getH2H(event);

  // Stadium / weather: MLB + NFL have our stadium DB; indoor sports never need weather
  const isIndoorSport = INDOOR_SPORTS.has(sport);
  const stadium = (!isIndoorSport && ['mlb', 'nfl'].includes(sport))
    ? getStadiumInfo(sport, home.team?.abbreviation)
    : null;

  // Injuries for both teams
  const awayTeamId   = away.team?.id;
  const homeTeamId   = home.team?.id;
  const awayInjuries = (injuries && awayTeamId) ? (injuries[awayTeamId] || []) : [];
  const homeInjuries = (injuries && homeTeamId) ? (injuries[homeTeamId] || []) : [];

  // Load H2H history when card first expands
  useEffect(() => {
    if (!expanded || h2hData || h2hLoad) return;
    if (!awayTeamId || !homeTeamId) return;
    setH2hLoad(true);
    fetch(`/api/h2h?sport=${sport}&team1=${homeTeamId}&team2=${awayTeamId}&abbrHome=${home.team?.abbreviation || 'HM'}&abbrAway=${away.team?.abbreviation || 'AW'}`)
      .then(r => r.json())
      .then(d => { if (d.record) setH2hData(d); })
      .catch(() => {})
      .finally(() => setH2hLoad(false));
  }, [expanded, h2hData, h2hLoad, awayTeamId, homeTeamId, sport, home.team?.abbreviation, away.team?.abbreviation]);

  return (
    <div
      style={suppressHeader ? {
        background: 'var(--bg-surface)',
        border: '1px solid rgba(255,69,96,0.18)',
        borderRadius: '0 0 10px 10px',
        borderTop: 'none',
        overflow: 'hidden',
      } : {
        background: 'var(--bg-surface)',
        border: `1px solid ${isExpanded ? 'rgba(255,184,0,0.35)' : isStarred ? 'rgba(255,184,0,0.2)' : 'var(--border)'}`,
        borderRadius: '10px', overflow: 'hidden',
        transition: 'border-color 0.15s',
        boxShadow: isStarred ? '0 0 16px rgba(255,184,0,0.06)' : 'none',
      }}
    >
      {/* Main row */}
      <div
        onClick={() => setExpanded(prev => !prev)}
        style={{
          display: suppressHeader ? 'none' : undefined,
          padding: '0.8rem 1rem',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.parentElement.style.borderColor = 'rgba(255,184,0,0.25)'; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.parentElement.style.borderColor = expanded ? 'rgba(255,184,0,0.35)' : isStarred ? 'rgba(255,184,0,0.2)' : 'var(--border)'; }}
      >
        {/* Status bar */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.65rem', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {/* Sport badge — only shown in All Sports mode */}
            {isAllMode && (() => {
              const sp = SPORTS.find(s => s.key === sport);
              return sp ? (
                <span style={{
                  fontSize: '0.6rem', fontWeight: 800, padding: '1px 5px', borderRadius: '4px',
                  background: sp.color + '22', color: sp.color, border: `1px solid ${sp.color}44`,
                  letterSpacing: '0.04em', flexShrink: 0,
                }}>
                  {sp.emoji} {sp.label}
                </span>
              ) : null;
            })()}
            {gameState.state === 'live' && (
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                background: '#4ade80', display: 'inline-block',
                boxShadow: '0 0 6px #4ade80', animation: 'live-pulse 2s infinite',
              }} />
            )}
            {/* For upcoming games: show timezone-aware start time; for live/final: show status label */}
            {gameState.state === 'pre' && event.date ? (
              <span style={{ color: '#60a5fa', fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                {formatGameTime(event.date, timezone)} {getTzAbbr(timezone)}
              </span>
            ) : (
              <span style={{ color: gameState.color, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                {gameState.label}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            {broadcast && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.66rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }} title={broadcast}>
                {truncBroadcast(broadcast, 36)}
              </span>
            )}
            {/* ＋ Bet button */}
            <button
              onClick={e => { e.stopPropagation(); onAddBet?.(event, sport); }}
              title="Add a bet on this game"
              style={{
                background: 'rgba(0,212,139,0.10)', border: '1px solid rgba(0,212,139,0.25)',
                borderRadius: '5px', cursor: 'pointer', padding: '2px 7px',
                fontSize: '0.64rem', fontWeight: 800, lineHeight: 1.4, flexShrink: 0,
                color: 'var(--green)', fontFamily: 'inherit',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,212,139,0.2)'; e.currentTarget.style.borderColor = 'rgba(0,212,139,0.5)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,212,139,0.10)'; e.currentTarget.style.borderColor = 'rgba(0,212,139,0.25)'; }}
            >
              ＋ Bet
            </button>

            {/* Star button */}
            <button
              onClick={e => onStar?.(e, { id: event.id, name: event.name, date: event.date, sport, awayName, homeName, awayAbbr: away.team?.abbreviation, homeAbbr: home.team?.abbreviation, state: gameState.state, label: gameState.label })}
              title={isStarred ? 'Unstar game' : 'Star for Featured Games'}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                fontSize: '0.9rem', lineHeight: 1, flexShrink: 0,
                color: isStarred ? '#FFB800' : 'var(--text-muted)',
                filter: isStarred ? 'drop-shadow(0 0 4px rgba(255,184,0,0.5))' : 'none',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#FFB800'; e.currentTarget.style.transform = 'scale(1.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = isStarred ? '#FFB800' : 'var(--text-muted)'; e.currentTarget.style.transform = ''; }}
            >
              {isStarred ? '★' : '☆'}
            </button>
          </div>
        </div>

        {/* Teams */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {[
            { team: away, score: awayScore, win: awayWin, label: 'Away', rec: awayRec, side: 'away' },
            { team: home, score: homeScore, win: homeWin, label: 'Home', rec: homeRec, side: 'home' },
          ].map(({ team, score, win, label, rec, side }) => {
            const pitcher = pitchers?.[side] || null;
            const goalie  = goalies?.[side]  || null;
            const ml = side === 'away' ? odds?.awayOdds : odds?.homeOdds;
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1 }}>
                  {team.team?.logo && (
                    <img src={team.team.logo} alt="" width={20} height={20}
                      style={{ objectFit: 'contain', flexShrink: 0, opacity: gameState.state === 'final' && !win ? 0.4 : 1 }}
                      onError={e => e.target.style.display = 'none'} />
                  )}
                  <span style={{
                    fontWeight: win ? 800 : gameState.state === 'final' ? 400 : 600,
                    color: win ? 'var(--text-primary)' : gameState.state === 'final' ? 'var(--text-muted)' : 'var(--text-secondary)',
                    fontSize: '0.88rem', flexShrink: 0,
                  }}>
                    {team.team?.abbreviation || label}
                  </span>
                  {rec.total && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', flexShrink: 0 }}>
                      {rec.total}
                    </span>
                  )}
                  {/* Inline pitcher (MLB) */}
                  {pitcher && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
                      · {pitcher.name}
                      {pitcher.era ? <span style={{ color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace' }}> {pitcher.era}</span> : null}
                    </span>
                  )}
                  {/* Inline goalie (NHL) */}
                  {goalie && (
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 1 }}>
                      · {goalie.name}
                    </span>
                  )}
                </div>
                {/* Right side: score (live/final) + moneyline (pre/live) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  {/* Moneyline — show for pre AND live */}
                  {(gameState.state === 'pre' || gameState.state === 'live') && ml != null && (
                    <span style={{
                      fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.78rem', fontWeight: 700,
                      color: ml > 0 ? 'var(--green)' : 'var(--text-secondary)',
                      minWidth: '40px', textAlign: 'right',
                      letterSpacing: '-0.02em', opacity: gameState.state === 'live' ? 0.75 : 1,
                    }}>
                      {formatOdds(ml, oddsFormat)}
                    </span>
                  )}
                  {/* Score — show for live/final */}
                  {score != null && (
                    <span style={{
                      fontWeight: win ? 800 : 400, fontSize: '1.05rem',
                      color: win ? 'var(--text-primary)' : 'var(--text-muted)',
                      fontFamily: 'IBM Plex Mono, monospace', minWidth: '24px', textAlign: 'right',
                    }}>
                      {score}
                    </span>
                  )}
                  {/* Pre-game: show moneyline in score column position if no score yet */}
                  {score == null && gameState.state === 'pre' && ml == null && (
                    <span style={{ minWidth: '24px' }} />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Odds strip — pre-game, live, and closing line */}
        {odds && (gameState.state !== 'final' || event._closingLine) && (odds.awayOdds || odds.homeOdds || odds.spread || odds.total != null) && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '0.6rem', paddingTop: '0.45rem', borderTop: '1px solid var(--border-subtle)', alignItems: 'center', flexWrap: 'wrap', opacity: gameState.state === 'live' ? 0.8 : 1 }}>
            {/* Source badge */}
            <span style={{
              fontSize: '0.6rem', fontWeight: 800, padding: '1px 6px', borderRadius: '4px',
              background: event._closingLine
                ? 'rgba(255,184,0,0.08)'
                : gameState.state === 'live' ? 'rgba(255,69,96,0.10)' : 'rgba(0,177,79,0.10)',
              color: event._closingLine
                ? 'var(--text-muted)'
                : gameState.state === 'live' ? '#FF4560' : '#00b14f',
              border: `1px solid ${event._closingLine
                ? 'rgba(255,255,255,0.08)'
                : gameState.state === 'live' ? 'rgba(255,69,96,0.22)' : 'rgba(0,177,79,0.22)'}`,
              letterSpacing: '0.04em', flexShrink: 0, fontFamily: 'IBM Plex Mono, monospace',
            }}
              title={event._closingLine ? 'Closing line — odds at game start' : undefined}
            >
              {event._closingLine ? 'CLOSE' : gameState.state === 'live' ? 'LIVE' : (odds.provider || 'ODDS')}
            </span>
            {/* Moneyline: away / home */}
            {(odds.awayOdds || odds.homeOdds) && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                {away.team?.abbreviation || 'AWY'}{' '}
                <strong style={{
                  color: odds.awayOdds > 0 ? 'var(--green)' : 'var(--text-secondary)',
                  fontFamily: 'IBM Plex Mono, monospace',
                }}>
                  {formatOdds(odds.awayOdds, oddsFormat)}
                </strong>
                {' / '}
                {home.team?.abbreviation || 'HME'}{' '}
                <strong style={{
                  color: odds.homeOdds > 0 ? 'var(--green)' : 'var(--text-secondary)',
                  fontFamily: 'IBM Plex Mono, monospace',
                }}>
                  {formatOdds(odds.homeOdds, oddsFormat)}
                </strong>
              </span>
            )}
            {odds.spread && !(odds.awayOdds || odds.homeOdds) && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                Spread <strong style={{ color: 'var(--gold)', fontFamily: 'IBM Plex Mono, monospace' }}>{odds.spread}</strong>
              </span>
            )}
            {odds.total != null && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                O/U <strong style={{ color: 'var(--gold)', fontFamily: 'IBM Plex Mono, monospace' }}>{odds.total}</strong>
              </span>
            )}
          </div>
        )}
        {/* For final games: show opener if ESPN still has data, otherwise nothing */}
        {odds && gameState.state === 'final' && (odds.spread || odds.total != null) && (
          <div style={{ display: 'flex', gap: '8px', marginTop: '0.6rem', paddingTop: '0.45rem', borderTop: '1px solid var(--border-subtle)', alignItems: 'center', flexWrap: 'wrap', opacity: 0.4 }}>
            <span style={{
              fontSize: '0.6rem', fontWeight: 800, padding: '1px 6px', borderRadius: '4px',
              background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)',
              border: '1px solid rgba(255,255,255,0.08)',
              letterSpacing: '0.04em', flexShrink: 0, fontFamily: 'IBM Plex Mono, monospace',
            }}>
              OPENER
            </span>
            {odds.spread && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                Spread <strong style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{odds.spread}</strong>
              </span>
            )}
            {odds.total != null && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                O/U <strong style={{ fontFamily: 'IBM Plex Mono, monospace' }}>{odds.total}</strong>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Expanded panel ────────────────────────────── */}
      {isExpanded && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ borderTop: suppressHeader ? 'none' : '1px solid var(--border)', background: 'var(--bg-base)', padding: '0.9rem 1rem' }}
        >

          {/* Venue */}
          {venue && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '0.75rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>📍</span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{venue}</span>
              {event.competitions?.[0]?.neutralSite && (
                <span style={{ padding: '1px 6px', background: 'var(--gold-subtle)', border: '1px solid rgba(255,184,0,0.3)', borderRadius: '4px', color: 'var(--gold)', fontSize: '0.65rem', fontWeight: 700 }}>
                  NEUTRAL SITE
                </span>
              )}
            </div>
          )}

          {/* Broadcast — full text in expanded */}
          {broadcast && (
            <div style={{ marginBottom: '0.75rem' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📺 Watch on  </span>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{broadcast}</span>
            </div>
          )}

          {/* Series info */}
          {series && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'var(--gold-subtle)', borderRadius: '6px', border: '1px solid rgba(255,184,0,0.2)' }}>
              <span style={{ color: 'var(--gold)', fontSize: '0.75rem', fontWeight: 700 }}>
                🏆 {series.title || 'Playoff Series'} — {series.summary || `${series.awayWins || 0}–${series.homeWins || 0}`}
              </span>
            </div>
          )}

          {/* Live situation */}
          {gameState.state === 'live' && situation && (
            <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(74,222,128,0.05)', borderRadius: '6px', border: '1px solid rgba(74,222,128,0.15)' }}>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {situation.balls != null && situation.strikes != null && (
                  <span style={{ color: '#4ade80', fontSize: '0.72rem', fontFamily: 'IBM Plex Mono, monospace' }}>
                    {situation.balls}-{situation.strikes} count
                    {situation.outs != null ? ` · ${situation.outs} out` : ''}
                  </span>
                )}
                {situation.shortDownDistanceText && (
                  <span style={{ color: '#4ade80', fontSize: '0.72rem' }}>{situation.shortDownDistanceText}</span>
                )}
                {situation.lastPlay?.text && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontStyle: 'italic' }}>{situation.lastPlay.text}</span>
                )}
              </div>
            </div>
          )}

          {/* Win Probability */}
          {winProb && (
            <WinProbBar
              homeTeam={home.team?.abbreviation || 'Home'}
              awayTeam={away.team?.abbreviation || 'Away'}
              homeProb={winProb.home}
              awayProb={winProb.away}
              homeOdds={odds?.homeOdds}
              awayOdds={odds?.awayOdds}
            />
          )}


          {/* ── Weather / Stadium / Indoor Matchup Context ─────────────── */}
          {isIndoorSport ? (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                {sport === 'nba' ? '🏀 Matchup Factors' : sport === 'nhl' ? '🏒 Game Factors' : sport === 'ncaab' ? '🏀 Game Factors' : '🏟️ Arena'}
              </div>
              {(() => {
                const venueName = venue?.split(',')[0] || 'Arena';
                const isDenver  = /denver|ball arena/i.test(venue || '');
                const notes     = event?.competitions?.[0]?.notes || [];
                const b2bAway   = notes.find(n => new RegExp(away.team?.abbreviation + '.{0,20}back.to.back|back.to.back.{0,20}' + away.team?.abbreviation, 'i').test(n.text || n.headline || ''));
                const b2bHome   = notes.find(n => new RegExp(home.team?.abbreviation + '.{0,20}back.to.back|back.to.back.{0,20}' + home.team?.abbreviation, 'i').test(n.text || n.headline || ''));
                const anyB2B    = notes.find(n => /back.to.back/i.test(n.text || n.headline || ''));

                // Parse records for H/A splits
                const awayAwayParts = (awayRec.away || '').match(/(\d+)-(\d+)/);
                const homeHomeParts = (homeRec.home || '').match(/(\d+)-(\d+)/);
                const awayAwayW = awayAwayParts ? parseInt(awayAwayParts[1]) : null;
                const awayAwayL = awayAwayParts ? parseInt(awayAwayParts[2]) : null;
                const homeHomeW = homeHomeParts ? parseInt(homeHomeParts[1]) : null;
                const homeHomeL = homeHomeParts ? parseInt(homeHomeParts[2]) : null;
                const awayRoadPct = (awayAwayW != null && awayAwayL != null) ? Math.round(awayAwayW / (awayAwayW + awayAwayL) * 100) : null;
                const homeCourtPct = (homeHomeW != null && homeHomeL != null) ? Math.round(homeHomeW / (homeHomeW + homeHomeL) * 100) : null;

                const rowStyle = { display: 'flex', alignItems: 'center', gap: '8px', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' };
                const labelStyle = { fontSize: '0.66rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, width: '90px', flexShrink: 0 };
                const valStyle   = { fontSize: '0.75rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 };

                return (
                  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.6rem 0.8rem', display: 'flex', flexDirection: 'column' }}>
                    {/* Arena */}
                    <div style={{ ...rowStyle }}>
                      <span style={{ ...labelStyle }}>🏟️ Arena</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        {venueName}
                        {isDenver && <span style={{ color: '#a0c4ff', fontSize: '0.65rem', marginLeft: '5px' }}>⛰️ 5,280 ft</span>}
                      </span>
                    </div>

                    {/* Back-to-back warning */}
                    {anyB2B && (
                      <div style={{ ...rowStyle }}>
                        <span style={{ ...labelStyle }}>⚠️ B2B</span>
                        <span style={{ fontSize: '0.72rem', color: '#facc15', fontWeight: 600 }}>
                          {anyB2B.text || anyB2B.headline || 'Back-to-back game'}
                        </span>
                      </div>
                    )}

                    {/* Away road record */}
                    {awayRec.away && (
                      <div style={{ ...rowStyle }}>
                        <span style={{ ...labelStyle }}>✈️ {away.team?.abbreviation} road</span>
                        <span style={{ ...valStyle, color: awayRoadPct != null ? (awayRoadPct >= 50 ? 'var(--green)' : 'var(--red)') : 'var(--text-secondary)' }}>
                          {awayRec.away}
                        </span>
                        {awayRoadPct != null && (
                          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>({awayRoadPct}%)</span>
                        )}
                      </div>
                    )}

                    {/* Home court record */}
                    {homeRec.home && (
                      <div style={{ ...rowStyle, borderBottom: sport === 'nhl' && goalies ? '1px solid var(--border-subtle)' : 'none' }}>
                        <span style={{ ...labelStyle }}>🏠 {home.team?.abbreviation} home</span>
                        <span style={{ ...valStyle, color: homeCourtPct != null ? (homeCourtPct >= 55 ? 'var(--green)' : homeCourtPct <= 40 ? 'var(--red)' : 'var(--text-secondary)') : 'var(--text-secondary)' }}>
                          {homeRec.home}
                        </span>
                        {homeCourtPct != null && (
                          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>({homeCourtPct}%)</span>
                        )}
                      </div>
                    )}

                    {/* NHL: goalie matchup */}
                    {sport === 'nhl' && goalies && Object.keys(goalies).length > 0 && (() => {
                      const awayG = goalies.away;
                      const homeG = goalies.home;
                      return (
                        <>
                          {awayG?.name && (
                            <div style={{ ...rowStyle }}>
                              <span style={{ ...labelStyle }}>🥅 {away.team?.abbreviation} G</span>
                              <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{awayG.name}</span>
                              {awayG.savePct && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', marginLeft: '4px' }}>.{awayG.savePct?.replace('.', '')} SV%</span>}
                              {awayG.gaa && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', marginLeft: '4px' }}>{awayG.gaa} GAA</span>}
                            </div>
                          )}
                          {homeG?.name && (
                            <div style={{ ...rowStyle, borderBottom: 'none' }}>
                              <span style={{ ...labelStyle }}>🥅 {home.team?.abbreviation} G</span>
                              <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{homeG.name}</span>
                              {homeG.savePct && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', marginLeft: '4px' }}>.{homeG.savePct?.replace('.', '')} SV%</span>}
                              {homeG.gaa && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', marginLeft: '4px' }}>{homeG.gaa} GAA</span>}
                            </div>
                          )}
                        </>
                      );
                    })()}

                    {/* NBA altitude note */}
                    {sport === 'nba' && isDenver && (
                      <div style={{ marginTop: '6px', padding: '4px 8px', background: 'rgba(160,196,255,0.08)', borderRadius: '5px', fontSize: '0.65rem', color: '#a0c4ff' }}>
                        ⛰️ Mile High effect: visiting teams avg ~3 fewer pts in 4th quarter at Ball Arena
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : stadium ? (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                🌤 Game-Time Weather
              </div>
              <WeatherWidget stadium={stadium} gameDate={event.date} sport={sport} />
            </div>
          ) : null}

          {/* ── NHL: Starting Goalies ──────────────────────────────────── */}
          {goalies && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
                🥅 Starting Goalies
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {['away', 'home'].map(side => {
                  const g    = goalies[side];
                  const team = side === 'away' ? away : home;
                  if (!g) return (
                    <div key={side} style={{ background: 'var(--bg-elevated)', borderRadius: '6px', padding: '8px' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.6rem', textTransform: 'uppercase', marginBottom: '2px' }}>{team.team?.abbreviation}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>TBD</div>
                    </div>
                  );
                  return (
                    <div key={side} style={{ background: 'var(--bg-elevated)', borderRadius: '6px', padding: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      {g.headshot && (
                        <img src={g.headshot} alt="" width={30} height={30}
                          style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid var(--border)' }}
                          onError={e => e.target.style.display = 'none'} />
                      )}
                      <div style={{ minWidth: 0 }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{team.team?.abbreviation}</div>
                        <div style={{ color: 'var(--text-primary)', fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.name}</div>
                        {(g.savePct || g.gaa) && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '1px' }}>
                            {[g.savePct ? `SV% ${g.savePct}` : null, g.gaa ? `GAA ${g.gaa}` : null].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Key Injuries ───────────────────────────────────────────── */}
          {(awayInjuries.length > 0 || homeInjuries.length > 0) && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  🚑 Key Injuries
                </div>
                {injuriesChecked && (
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                    checked {injuriesChecked.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {[
                  { abbr: away.team?.abbreviation || 'Away', list: awayInjuries },
                  { abbr: home.team?.abbreviation || 'Home', list: homeInjuries },
                ].map(({ abbr, list }) => list.length === 0 ? null : (
                  <div key={abbr} style={{ flex: 1, minWidth: '130px' }}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: '4px' }}>{abbr}</div>
                    {list.map((inj, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
                        <span style={{
                          fontSize: '0.58rem', fontWeight: 800, padding: '1px 5px', borderRadius: '3px', flexShrink: 0,
                          background: inj.status === 'Out' ? 'rgba(239,68,68,0.15)' : inj.status === 'Doubtful' ? 'rgba(251,146,60,0.12)' : 'rgba(250,204,21,0.1)',
                          color:      inj.status === 'Out' ? '#ef4444'              : inj.status === 'Doubtful' ? '#fb923c'                : '#facc15',
                          border:     `1px solid ${inj.status === 'Out' ? 'rgba(239,68,68,0.3)' : inj.status === 'Doubtful' ? 'rgba(251,146,60,0.25)' : 'rgba(250,204,21,0.2)'}`,
                        }}>
                          {inj.status === 'Questionable' ? 'Q' : inj.status === 'Doubtful' ? 'D' : 'OUT'}
                        </span>
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 500 }}>{inj.name}</span>
                        {inj.type && <span style={{ color: 'var(--text-muted)', fontSize: '0.63rem' }}>· {inj.type}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Head-to-Head ───────────────────────────────────────────── */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
              🔄 Head-to-Head
            </div>
            <div style={{ padding: '0.6rem 0.8rem', background: 'rgba(155,109,255,0.05)', border: '1px solid rgba(155,109,255,0.18)', borderRadius: '8px' }}>
              {/* Season series note (from ESPN) */}
              {h2hNote && (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.74rem', marginBottom: '8px', fontWeight: 600 }}>
                  {h2hNote}
                </div>
              )}
              {/* Last-20 record */}
              {h2hLoad && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>Loading history…</div>
              )}
              {h2hData && !h2hLoad && (() => {
                const { record, games, abbrHome, abbrAway } = h2hData;
                const homeWinPct = record.total > 0 ? Math.round((record.wins / record.total) * 100) : 0;
                return (
                  <div>
                    {/* Big record line */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '7px' }}>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {abbrHome} {record.wins}–{record.losses}
                      </span>
                      <span style={{ color: 'var(--violet)', fontSize: '0.72rem', fontWeight: 700 }}>
                        {abbrAway}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                        (last {record.total})
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: '0.68rem', fontFamily: 'IBM Plex Mono', color: homeWinPct >= 55 ? 'var(--green)' : homeWinPct <= 45 ? 'var(--red)' : 'var(--text-muted)' }}>
                        {homeWinPct}% {abbrHome}
                      </span>
                    </div>
                    {/* Dot history (newest → oldest, left to right) */}
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                      {games.slice(0, 20).map((g, i) => (
                        <div key={i} title={`${g.date} · ${abbrHome} ${g.score1}–${g.score2} ${abbrAway}`}
                          style={{
                            width: '10px', height: '10px', borderRadius: '2px',
                            background: g.t1Won ? 'var(--green)' : 'var(--red)',
                            opacity: 0.75 + (0.25 * (1 - i / 20)), // fade older games
                            cursor: 'default',
                          }}
                        />
                      ))}
                    </div>
                    <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      ◀ most recent &nbsp;·&nbsp; {games[0]?.season && games[games.length-1]?.season ? `${games[games.length-1].season}–${games[0].season}` : ''} &nbsp;·&nbsp; hover dot for score
                    </div>
                  </div>
                );
              })()}
              {!h2hData && !h2hLoad && !h2hNote && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>No matchup history available.</div>
              )}
            </div>
          </div>

          {/* ── Season Records ─────────────────────────────────────────── */}
          {(awayRec.total || homeRec.total) && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
                📋 Season Records
              </div>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                {[
                  { name: away.team?.abbreviation || 'Away', rec: awayRec, roleRec: awayRec.away, roleLabel: 'away' },
                  { name: home.team?.abbreviation || 'Home', rec: homeRec, roleRec: homeRec.home, roleLabel: 'home' },
                ].map(({ name, rec, roleRec, roleLabel }) => (rec.total || roleRec) ? (
                  <div key={name} style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700 }}>{name}</span>
                    {rec.total && <span style={{ color: 'var(--text-primary)', fontSize: '0.78rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600 }}>{rec.total}</span>}
                    {roleRec && (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>({roleRec} {roleLabel})</span>
                    )}
                  </div>
                ) : null)}
              </div>
            </div>
          )}

          {/* Action row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)', gap: '8px' }}>
            {!suppressHeader && (
              <div
                onClick={() => setExpanded(false)}
                style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '4px' }}
              >
                ▲ click to collapse
              </div>
            )}

            {onAnalyze && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const gameInfo = gameState.state === 'pre'
                    ? `${awayName} @ ${homeName} — ${gameState.label}`
                    : `${awayName} ${awayScore ?? ''} @ ${homeName} ${homeScore ?? ''} (${gameState.label})`;

                  // Calculate market-implied probabilities from real odds (pure math)
                  function calcImplied(ml) {
                    if (!ml) return null;
                    const p = ml > 0 ? 100 / (ml + 100) : Math.abs(ml) / (Math.abs(ml) + 100);
                    return (p * 100).toFixed(1);
                  }
                  const awayImpl = odds?.awayOdds ? calcImplied(odds.awayOdds) : null;
                  const homeImpl = odds?.homeOdds ? calcImplied(odds.homeOdds) : null;

                  // Build a verified data block Grok must treat as ground truth
                  const verifiedBlock = odds ? [
                    '--- VERIFIED ODDS (from live feed — treat as ground truth, do not search for different odds) ---',
                    `Matchup: ${awayName} @ ${homeName}`,
                    odds.awayOdds ? `${awayName} ML: ${formatOdds(odds.awayOdds)}${awayImpl ? ` (market implied: ${awayImpl}%)` : ''}` : '',
                    odds.homeOdds ? `${homeName} ML: ${formatOdds(odds.homeOdds)}${homeImpl ? ` (market implied: ${homeImpl}%)` : ''}` : '',
                    odds.spread   ? `Spread: ${odds.spread}` : '',
                    odds.total    ? `Over/Under: ${odds.total}` : '',
                    odds.provider ? `Source: ${odds.provider}` : '',
                    '--- END VERIFIED ODDS ---',
                  ].filter(Boolean).join('\n') : '';

                  const recInfo = `${awayName} record: ${awayRec.total || '—'} (away: ${awayRec.away || '—'}). ${homeName} record: ${homeRec.total || '—'} (home: ${homeRec.home || '—'}).`;
                  const venueInfo = venue ? `Venue: ${venue}.` : '';

                  const prompt = [
                    `Run a full BetOS analysis on ${gameInfo}.`,
                    verifiedBlock,
                    recInfo,
                    venueInfo,
                    'Use web search ONLY for: confirmed injury/lineup news, line movement history from open to now, public betting splits, and any sharp action signals. Do not invent or override any numbers in the verified block above.',
                  ].filter(Boolean).join('\n\n');
                  onAnalyze(prompt);
                }}
                style={{
                  padding: '6px 14px', borderRadius: '8px',
                  border: '1px solid rgba(255,184,0,0.4)',
                  background: 'rgba(255,184,0,0.08)',
                  color: 'var(--gold)', fontSize: '0.75rem', fontWeight: 700,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.16)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.08)'; e.currentTarget.style.transform = ''; }}
              >
                🎯 BetOS Analyze
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── News Card ─────────────────────────────────────────────────────────────────
function NewsCard({ article, sportKey }) {
  // Pick a sport accent color for the left border
  const SPORT_ACCENTS = { mlb: '#E31937', nba: '#F58426', nfl: '#5B8CFF', nhl: '#00A3E0', ncaaf: '#8B5CF6', ncaab: '#F97316', mls: '#00B14F', wnba: '#FF6B6B', ufc: '#D20A0A' };
  const accent = SPORT_ACCENTS[sportKey || article._sport] || '#FFB800';
  const teamLabel = article.categories?.find(c => c.type === 'team')?.description || '';
  const pubDate   = article.published ? new Date(article.published) : null;
  const ageHours  = pubDate ? (Date.now() - pubDate.getTime()) / 3600000 : 999;
  const dateStr   = pubDate
    ? ageHours < 1    ? 'Just now'
    : ageHours < 24   ? `${Math.floor(ageHours)}h ago`
    : pubDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  return (
    <a href={article.links?.web?.href || '#'} target="_blank" rel="noreferrer"
      style={{ display: 'block', textDecoration: 'none' }}>
      <div style={{
        background: 'var(--bg-elevated)', borderRadius: '8px',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accent}`,
        padding: '0.65rem 0.75rem',
        transition: 'background 0.12s, border-color 0.12s',
        cursor: 'pointer',
      }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-overlay)'; e.currentTarget.style.borderColor = accent + '55'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.borderLeftColor = accent; }}
      >
        <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          {article.images?.[0]?.url && (
            <img src={article.images[0].url} alt="" width={54} height={40}
              style={{ objectFit: 'cover', borderRadius: '4px', flexShrink: 0, opacity: 0.9 }}
              onError={e => e.target.style.display = 'none'} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{
              color: 'var(--text-primary)', fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.4, marginBottom: '4px',
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
            }}>
              {article.headline}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              {teamLabel && (
                <span style={{ fontSize: '0.64rem', color: accent, fontWeight: 700, opacity: 0.85 }}>{teamLabel}</span>
              )}
              {teamLabel && dateStr && <span style={{ color: 'var(--border)', fontSize: '0.6rem' }}>·</span>}
              {dateStr && <span style={{ color: 'var(--text-muted)', fontSize: '0.64rem' }}>{dateStr}</span>}
            </div>
          </div>
        </div>
      </div>
    </a>
  );
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function toESPNDate(date) {
  // ESPN scoreboard date param format: YYYYMMDD
  // Append T12:00:00 so JS parses as local noon, not UTC midnight (avoids -1 day offset in US timezones)
  const d = new Date(date + 'T12:00:00');
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function toLocalDateStr(date) {
  // YYYY-MM-DD in local timezone (for display)
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dateLabel(dateStr) {
  const today = toLocalDateStr(new Date());
  const yesterday = toLocalDateStr(new Date(Date.now() - 86400000));
  const tomorrow  = toLocalDateStr(new Date(Date.now() + 86400000));
  if (dateStr === today)     return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  if (dateStr === tomorrow)  return 'Tomorrow';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ScoreboardTab({ onAnalyze, user, picks, setPicks, isDemo, highlightGame, onHighlightConsumed }) {
  const todayStr = toLocalDateStr(new Date());
  const userPrefs = useMemo(() => getUserPrefs(user), [user]);

  const [betSlipGame, setBetSlipGame] = useState(null); // { event, sport } | null
  const [realOddsLookup, setRealOddsLookup] = useState({}); // home_team → bookmaker game data

  // Pick → Scoreboard highlight
  const [highlightedEventId, setHighlightedEventId] = useState(null);
  const gameCardRefs = useRef({});

  const [sport, setSport]       = useState('mlb');
  const [games, setGames]       = useState([]);
  const [news,  setNews]        = useState([]);
  const [loading, setLoading]   = useState(false);
  const [newsLoading, setNewsLoading] = useState(false);
  const [error, setError]       = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [nextRefreshIn, setNextRefreshIn] = useState(null); // seconds until next auto-refresh
  const [filter, setFilter]     = useState('all'); // all | live | upcoming | final | starred
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [injuries, setInjuries]               = useState({});  // { teamId: [{name, status, type},...] }
  const [injuriesChecked, setInjuriesChecked] = useState(null);
  const { starred, toggleStar } = useStarredGames();

  // ── Injury Intel sidebar ──────────────────────────────────────────────────
  const [sidebarTab,   setSidebarTab]   = useState('headlines'); // 'headlines' | 'intel'
  const [intelText,    setIntelText]    = useState('');
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError,   setIntelError]   = useState('');
  const [intelTs,      setIntelTs]      = useState(null);   // timestamp of last scan
  const [intelQuery,   setIntelQuery]   = useState('');     // custom query input
  const INTEL_REFRESH = 5 * 60 * 1000; // auto-scan every 5 min

  const runIntelScan = useCallback(async (s, customQuery = '') => {
    if (intelLoading) return; // debounce — don't fire while already scanning
    setIntelLoading(true);
    setIntelError('');

    // Client-side safety timeout: always clear spinner after 60s
    const safetyTimer = setTimeout(() => {
      setIntelLoading(false);
      setIntelError('Scan timed out — xAI is slow right now. Try again in a moment.');
    }, 60_000);

    try {
      const res = await fetch('/api/injury-intel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sport: s === 'all' ? 'mlb' : s, query: customQuery }),
      });
      const data = await res.json();
      if (data.error) { setIntelError(data.error); }
      else { setIntelText(data.intel || ''); setIntelTs(new Date()); }
    } catch (e) {
      setIntelError('Scan failed — check your connection');
    } finally {
      clearTimeout(safetyTimer);
      setIntelLoading(false);
    }
  }, [intelLoading]);

  const loadGames = useCallback(async (s, dateStr) => {
    setLoading(true);
    setError('');
    try {
      const espnDate = toESPNDate(dateStr || todayStr);

      if (s === 'all') {
        // Fetch all sports in parallel, tag each event with _sport
        const results = await Promise.allSettled(
          ALL_SPORTS_KEYS.map(key =>
            fetch(`/api/sports?sport=${key}&endpoint=scoreboard&date=${espnDate}`)
              .then(r => r.json())
              .then(data => (data.events || []).map(ev => ({ ...ev, _sport: key })))
              .catch(() => [])
          )
        );
        const merged = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
        setGames(prev => sortAllSportsEvents(mergeGames(prev, merged)));
      } else {
        const res = await fetch(`/api/sports?sport=${s}&endpoint=scoreboard&date=${espnDate}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setGames(prev => mergeGames(prev, data.events || []));
      }
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
      setGames([]);
    }
    setLoading(false);
  }, [todayStr]);

  const loadNews = useCallback(async (s) => {
    setNewsLoading(true);
    try {
      if (s === 'all') {
        // Pull headlines from MLB, NBA, NFL in parallel → interleave top stories
        const picks = ['mlb', 'nba', 'nfl'];
        const results = await Promise.allSettled(
          picks.map(key =>
            fetch(`/api/sports?sport=${key}&endpoint=news`)
              .then(r => r.json())
              .then(d => (d.articles || []).slice(0, 8).map(a => ({ ...a, _sport: key })))
              .catch(() => [])
          )
        );
        // Interleave: take 1 from each sport in round-robin until 20 articles
        const arrays = results.map(r => r.status === 'fulfilled' ? r.value : []);
        const merged = [];
        const maxLen = Math.max(...arrays.map(a => a.length));
        for (let i = 0; i < maxLen && merged.length < 20; i++) {
          for (const arr of arrays) {
            if (arr[i]) merged.push(arr[i]);
          }
        }
        setNews(merged.slice(0, 20));
      } else {
        const res = await fetch(`/api/sports?sport=${s}&endpoint=news`);
        const data = await res.json();
        setNews(data.articles || []);
      }
    } catch { setNews([]); }
    setNewsLoading(false);
  }, []);

  // Fetch real bookmaker odds (The Odds API) for bet-slip pre-fill
  const loadRealOdds = useCallback(async (s) => {
    if (s === 'all') return; // skip in multi-sport mode
    try {
      const res = await fetch(`/api/odds?sport=${s}`);
      if (!res.ok) return;
      const d = await res.json();
      const lookup = {};
      (d.data || []).forEach(game => {
        const key = (game.home_team || '').toLowerCase().replace(/\s+/g, '_');
        lookup[key] = game;
      });
      setRealOddsLookup(lookup);
    } catch { /* fail silently — real odds are a bonus */ }
  }, []);

  const loadInjuries = useCallback(async (s) => {
    if (s === 'all') return; // Skip injuries in All mode — too many parallel calls
    try {
      const res = await fetch(`/api/sports?sport=${s}&endpoint=injuries`);
      const data = await res.json();
      const map = {};
      (data.injuries || []).forEach(entry => {
        if (!entry.team?.id) return;
        map[entry.team.id] = (entry.injuries || [])
          .filter(inj => ['Out', 'Doubtful', 'Questionable'].includes(inj.status))
          .slice(0, 6)
          .map(inj => ({
            name:   inj.athlete?.shortName || inj.athlete?.displayName || '?',
            status: inj.status,
            type:   inj.details?.type || inj.type?.description || '',
          }));
      });
      setInjuries(map);
      setInjuriesChecked(new Date());
    } catch { /* fail silently — injuries are bonus info */ }
  }, []);

  // Derive liveCount early — needed by useEffect hooks below
  const liveCount = games.filter(e => getGameState(e).state === 'live').length;

  // Adaptive refresh rate: fast when live games are active, normal otherwise
  const REFRESH_LIVE    = 20_000;  // 20s while games are in progress
  const REFRESH_TODAY   = 45_000;  // 45s on today with no live games

  useEffect(() => {
    loadGames(sport, selectedDate);
    loadNews(sport);
    loadInjuries(sport);
    loadRealOdds(sport);

    if (selectedDate !== todayStr) return; // No auto-refresh on non-today dates

    // Start with a 45s interval; once we have game data we'll tighten it if live games exist
    let interval = setInterval(() => loadGames(sport, selectedDate), REFRESH_TODAY);

    return () => clearInterval(interval);
  }, [sport, selectedDate, loadGames, loadNews, loadInjuries, loadRealOdds, todayStr]);

  // Separate effect: tighten polling to 20s when live games are detected
  useEffect(() => {
    if (selectedDate !== todayStr) return;
    if (liveCount === 0) return;

    // Live games detected — poll scores every 20s, odds every 3 min
    const liveInterval  = setInterval(() => loadGames(sport, selectedDate), REFRESH_LIVE);
    const oddsInterval  = setInterval(() => loadRealOdds(sport), 3 * 60 * 1000);
    return () => { clearInterval(liveInterval); clearInterval(oddsInterval); };
  }, [liveCount, sport, selectedDate, loadGames, loadRealOdds, todayStr]);

  // Countdown timer — shows seconds until next refresh
  useEffect(() => {
    if (selectedDate !== todayStr || !lastUpdated) { setNextRefreshIn(null); return; }
    const interval = liveCount > 0 ? REFRESH_LIVE : REFRESH_TODAY;
    const tick = setInterval(() => {
      const elapsed = Date.now() - lastUpdated.getTime();
      const remaining = Math.max(0, Math.ceil((interval - elapsed) / 1000));
      setNextRefreshIn(remaining);
    }, 1000);
    return () => clearInterval(tick);
  }, [lastUpdated, liveCount, selectedDate, todayStr]);

  // ── Pick → Scoreboard: switch sport/date when a pick is passed in ────────────
  useEffect(() => {
    if (!highlightGame) return;
    const targetSport = (highlightGame.sport || '').toLowerCase();
    const validKeys = SPORTS.map(s => s.key);
    if (targetSport && validKeys.includes(targetSport)) {
      setSport(targetSport);
    }
    if (highlightGame.date) {
      setSelectedDate(highlightGame.date);
    }
    setFilter('all'); // show all statuses so the game is visible
  }, [highlightGame]); // eslint-disable-line

  // ── After games load, find the matching game and scroll/highlight it ─────────
  useEffect(() => {
    if (!highlightGame || !games.length) return;
    function norm(str) { return (str || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
    const pickTeam = norm(highlightGame.team);
    const pickHome = norm(highlightGame.home_team);
    const pickAway = norm(highlightGame.away_team);

    let foundId = null;
    for (const event of games) {
      const comps = event.competitions?.[0]?.competitors || [];
      const homeDisp = norm(comps.find(c => c.homeAway === 'home')?.team?.displayName || '');
      const awayDisp = norm(comps.find(c => c.homeAway === 'away')?.team?.displayName || '');
      const teamMatch = pickTeam && (homeDisp.includes(pickTeam) || awayDisp.includes(pickTeam) ||
                        pickTeam.includes(homeDisp.slice(-5)) || pickTeam.includes(awayDisp.slice(-5)));
      const homeMatch = pickHome && homeDisp.includes(pickHome.slice(-5));
      const awayMatch = pickAway && awayDisp.includes(pickAway.slice(-5));
      if (teamMatch || homeMatch || awayMatch) { foundId = event.id; break; }
    }

    if (foundId) {
      setHighlightedEventId(foundId);
      setTimeout(() => {
        const el = gameCardRefs.current[foundId];
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 350);
      if (onHighlightConsumed) onHighlightConsumed();
      // Auto-clear the highlight glow after 5s
      setTimeout(() => setHighlightedEventId(null), 5000);
    }
  }, [games, highlightGame]); // eslint-disable-line

  // Auto-scan injury intel when tab is active or sport changes, refresh every 5 min
  useEffect(() => {
    if (sidebarTab !== 'intel') return;
    runIntelScan(sport);
    const t = setInterval(() => runIntelScan(sport), INTEL_REFRESH);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarTab, sport]);

  const isAllMode = sport === 'all';

  // ── Merge The Odds API data into game events (single source of truth) ─────
  // This ensures GameCard, BetSlipModal, and every other consumer see the same odds.
  const enrichedGames = useMemo(() => {
    if (!Object.keys(realOddsLookup).length) return games;
    return games.map(event => {
      const competitors = event.competitions?.[0]?.competitors || [];
      const homeComp = competitors.find(c => c.homeAway === 'home') || competitors[1] || {};
      const awayComp = competitors.find(c => c.homeAway === 'away') || competitors[0] || {};
      const homeName = homeComp.team?.displayName || homeComp.team?.name || '';
      if (!homeName) return event;

      const homeKey  = homeName.toLowerCase().replace(/\s+/g, '_');
      const realGame = realOddsLookup[homeKey]
        || Object.values(realOddsLookup).find(g =>
            (g.home_team || '').toLowerCase().includes(homeName.split(' ').pop().toLowerCase())
          );
      if (!realGame) return event;

      const book    = realGame.bookmakers?.[0];
      const h2h     = book?.markets?.find(m => m.key === 'h2h');
      const spreads = book?.markets?.find(m => m.key === 'spreads');
      const totals  = book?.markets?.find(m => m.key === 'totals');

      const homeH2h  = h2h?.outcomes?.find(o => o.name === realGame.home_team);
      const awayH2h  = h2h?.outcomes?.find(o => o.name === realGame.away_team);
      const sHome    = spreads?.outcomes?.find(o => o.name === realGame.home_team);
      const sAway    = spreads?.outcomes?.find(o => o.name === realGame.away_team);
      const tOver    = totals?.outcomes?.find(o => o.name === 'Over');
      const tUnder   = totals?.outcomes?.find(o => o.name === 'Under');

      const existingOdds = event.competitions?.[0]?.odds?.[0] || {};
      const mergedOdds = {
        ...existingOdds,
        homeTeamOdds: {
          ...(existingOdds.homeTeamOdds || {}),
          moneyLine: homeH2h?.price ?? existingOdds.homeTeamOdds?.moneyLine ?? null,
          spreadLine: sHome?.price ?? existingOdds.homeTeamOdds?.spreadLine ?? null,
        },
        awayTeamOdds: {
          ...(existingOdds.awayTeamOdds || {}),
          moneyLine: awayH2h?.price ?? existingOdds.awayTeamOdds?.moneyLine ?? null,
          spreadLine: sAway?.price ?? existingOdds.awayTeamOdds?.spreadLine ?? null,
        },
        overUnder: tOver?.point ?? tUnder?.point ?? existingOdds.overUnder ?? null,
        details: sHome?.point != null
          ? `${realGame.home_team.split(' ').pop()} ${sHome.point >= 0 ? '+' : ''}${sHome.point}`
          : existingOdds.details ?? null,
        // Enriched over/under prices (ESPN doesn't expose these in a standard field)
        _overOdds:       tOver?.price  ?? null,
        _underOdds:      tUnder?.price ?? null,
        _awaySpreadOdds: sAway?.price  ?? null,
        _homeSpreadOdds: sHome?.price  ?? null,
        _source: book?.title || 'DK',
      };

      return {
        ...event,
        competitions: [
          {
            ...event.competitions[0],
            odds: [mergedOdds, ...(event.competitions[0]?.odds?.slice(1) || [])],
          },
          ...(event.competitions?.slice(1) || []),
        ],
      };
    });
  }, [games, realOddsLookup]);

  const filteredGames = enrichedGames.filter(e => {
    const state = getGameState(e).state;
    if (filter === 'live')    return state === 'live';
    if (filter === 'upcoming') return state === 'pre';
    if (filter === 'final')   return state === 'final';
    if (filter === 'starred') return !!starred[e.id];
    return true;
  });

  // Always sort: live first, then upcoming (chrono), finals shuffled to bottom
  const sortedFilteredGames = sortAllSportsEvents(filteredGames);

  const currentSport = SPORTS.find(s => s.key === sport);

  return (
    <>
    <div className="fade-in" style={{ display: 'flex', gap: '1.25rem' }}>

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Sport selector */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {SPORTS.map(s => (
            <button key={s.key} onClick={() => setSport(s.key)}
              style={{
                padding: '5px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer',
                background: sport === s.key ? s.color : '#1a1a1a',
                color: sport === s.key ? '#000' : '#888',
                fontWeight: sport === s.key ? 700 : 400, fontSize: '0.8rem',
                transition: 'all 0.15s',
              }}>
              {s.emoji} {s.label}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {lastUpdated && (
              <span>Updated {lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
            )}
            {liveCount > 0 && (
              <span style={{ color: '#4ade80', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', display: 'inline-block', boxShadow: '0 0 5px #4ade80', animation: 'live-pulse 1.5s infinite' }} />
                {liveCount} LIVE
                {nextRefreshIn != null && (
                  <span style={{ color: '#4ade8088', fontSize: '0.66rem', marginLeft: '2px' }}>· refresh in {nextRefreshIn}s</span>
                )}
              </span>
            )}
            {liveCount === 0 && nextRefreshIn != null && selectedDate === todayStr && (
              <span style={{ color: '#555', fontSize: '0.67rem' }}>auto-refresh in {nextRefreshIn}s</span>
            )}
          </span>
          <button onClick={() => { loadGames(sport, selectedDate); loadNews(sport); }}
            style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', color: 'var(--text-secondary)', padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem' }}>
            ↻ Refresh
          </button>
        </div>

        {/* Date navigation bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          {/* Prev / Next arrows */}
          <button
            onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00');
              d.setDate(d.getDate() - 1);
              setSelectedDate(toLocalDateStr(d));
            }}
            style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >‹</button>

          {/* Quick presets: Yesterday + Today + next 6 days */}
          <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '2px', flexShrink: 1 }}>
          {[-1, 0, 1, 2, 3, 4, 5, 6].map(offset => {
            const d = new Date(Date.now() + offset * 86400000);
            const ds = toLocalDateStr(d);
            const isActive = selectedDate === ds;
            const label = offset === -1 ? 'Yesterday'
              : offset === 0 ? 'Today'
              : offset === 1 ? 'Tomorrow'
              : d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
            return (
              <button key={offset} onClick={() => setSelectedDate(ds)}
                style={{
                  padding: '4px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer', fontWeight: isActive ? 700 : 400,
                  border: `1px solid ${isActive ? 'rgba(255,184,0,0.6)' : 'var(--border)'}`,
                  background: isActive ? 'rgba(255,184,0,0.1)' : 'transparent',
                  color: isActive ? 'var(--gold)' : offset > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
                  transition: 'all 0.12s', whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                {label}
              </button>
            );
          })}
          </div>

          {/* Custom date picker */}
          <input
            type="date"
            value={selectedDate}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px',
              color: 'var(--text-secondary)', padding: '3px 8px', fontSize: '0.75rem', cursor: 'pointer',
              colorScheme: 'dark',
            }}
          />

          {/* Current date label */}
          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: '4px' }}>
            {dateLabel(selectedDate)}
            {selectedDate !== todayStr && (
              <button onClick={() => setSelectedDate(todayStr)}
                style={{ marginLeft: '8px', background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: '0.68rem', padding: 0, textDecoration: 'underline' }}>
                back to today
              </button>
            )}
          </span>

          <button
            onClick={() => {
              const d = new Date(selectedDate + 'T12:00:00');
              d.setDate(d.getDate() + 1);
              setSelectedDate(toLocalDateStr(d));
            }}
            style={{ width: '30px', height: '30px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          >›</button>
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          {[
            { id: 'all',      label: 'All' },
            { id: 'live',     label: liveCount > 0 ? `● LIVE (${liveCount})` : 'Live' },
            { id: 'upcoming', label: 'Upcoming' },
            { id: 'final',    label: 'Final' },
            { id: 'starred',  label: `★ Starred${Object.keys(starred).length > 0 ? ` (${Object.keys(starred).length})` : ''}` },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              style={{
                padding: '4px 11px', borderRadius: '20px', cursor: 'pointer', fontSize: '0.75rem',
                border: `1px solid ${filter === f.id ? (f.id === 'starred' ? 'rgba(255,184,0,0.6)' : 'var(--gold)') : 'var(--border)'}`,
                background: filter === f.id ? (f.id === 'starred' ? 'rgba(255,184,0,0.1)' : 'var(--gold-subtle)') : 'transparent',
                color: filter === f.id ? 'var(--gold)' : 'var(--text-muted)',
                fontWeight: filter === f.id ? 700 : 400,
                transition: 'all 0.12s',
              }}>
              {f.label}
            </button>
          ))}
          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: '4px' }}>
            {sortedFilteredGames.length} game{sortedFilteredGames.length !== 1 ? 's' : ''}
            {isAllMode && sortedFilteredGames.length > 0 && (
              <span style={{ color: 'var(--text-muted)' }}> across {new Set(sortedFilteredGames.map(e => e._sport)).size} sports</span>
            )}
          </span>
        </div>

        {/* Games grid */}
        {loading && games.length === 0 ? (
          /* First-load skeleton only — never show this on background refresh */
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>{isAllMode ? '⏳' : currentSport?.emoji || '⏳'}</div>
            <p style={{ fontSize: '0.85rem' }}>
              {isAllMode ? 'Loading all sports in parallel…' : `Loading ${currentSport?.label} games…`}
            </p>
          </div>
        ) : error ? (
          <div style={{ padding: '1.5rem', background: '#2b0d0d', border: '1px solid #991b1b', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
            ⚠️ {error}
          </div>
        ) : sortedFilteredGames.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{currentSport?.emoji}</div>
            <p>No {filter === 'all' ? '' : filter} {currentSport?.label} games {selectedDate === todayStr ? 'today' : 'on this date'}.</p>
          </div>
        ) : (
          <div className="game-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px', alignItems: 'start' }}>
            {sortedFilteredGames.map(event => (
              <div
                key={`${event._sport || sport}-${event.id}`}
                ref={el => { if (el) gameCardRefs.current[event.id] = el; }}
                style={highlightedEventId === event.id ? {
                  borderRadius: '14px',
                  boxShadow: '0 0 0 2px #FFB800, 0 0 24px rgba(255,184,0,0.35)',
                  transition: 'box-shadow 0.4s ease',
                } : { transition: 'box-shadow 0.4s ease' }}
              >
                <GameCard
                  event={event}
                  sport={event._sport || sport}
                  onAnalyze={onAnalyze}
                  onAddBet={(ev, sp) => setBetSlipGame({ event: ev, sport: sp })}
                  starred={starred}
                  onStar={toggleStar}
                  injuries={injuries}
                  injuriesChecked={injuriesChecked}
                  isAllMode={isAllMode}
                  oddsFormat={userPrefs.odds_format}
                  timezone={userPrefs.timezone}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right sidebar — tabbed: Headlines | Injury Intel */}
      <div className="scoreboard-sidebar" style={{
        width: '300px', flexShrink: 0,
        display: 'flex', flexDirection: 'column',
        borderLeft: '1px solid var(--border)',
        paddingLeft: '1.1rem',
      }}>
        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '0.75rem', background: 'var(--bg-elevated)', borderRadius: '8px', padding: '3px' }}>
          {[
            { key: 'headlines', label: '📰 Headlines' },
            { key: 'intel',     label: '🏥 Injury Intel' },
          ].map(tab => (
            <button key={tab.key} onClick={() => setSidebarTab(tab.key)}
              style={{
                flex: 1, padding: '5px 8px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                fontSize: '0.72rem', fontWeight: 700, fontFamily: 'inherit',
                background: sidebarTab === tab.key ? 'var(--bg-overlay)' : 'transparent',
                color: sidebarTab === tab.key ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'all 0.12s',
                boxShadow: sidebarTab === tab.key ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
              }}
            >{tab.label}</button>
          ))}
        </div>

        {/* ── Headlines Tab ───────────────────────────────────────────── */}
        {sidebarTab === 'headlines' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                {isAllMode ? 'MLB · NBA · NFL top stories' : `Latest ${currentSport?.label} news`}
              </div>
              {newsLoading && <span style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>↻</span>}
            </div>
            {news.length === 0 && !newsLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                <div style={{ fontSize: '1.4rem', marginBottom: '6px', opacity: 0.4 }}>📰</div>
                No headlines available
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', flex: 1, paddingRight: '2px' }}>
                {news
                  .filter(a => {
                    if (!a.published) return true; // keep if no date
                    const ageHours = (Date.now() - new Date(a.published).getTime()) / 3600000;
                    return ageHours <= 72; // only show articles from last 72 hours
                  })
                  .slice(0, 20)
                  .map((article, i) => (
                    <NewsCard key={i} article={article} sportKey={isAllMode ? undefined : sport} />
                  ))}
              </div>
            )}
          </>
        )}

        {/* ── Injury Intel Tab ────────────────────────────────────────── */}
        {sidebarTab === 'intel' && (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            {/* Intel header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {isAllMode ? 'Multi-Sport' : currentSport?.label} Injury & Lineup Intel
                </div>
                {intelTs && (
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                    Scanned {intelTs.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · auto-refresh 5m
                  </div>
                )}
              </div>
              <button
                onClick={() => runIntelScan(sport)}
                disabled={intelLoading}
                style={{
                  background: intelLoading ? 'var(--bg-elevated)' : 'rgba(255,184,0,0.1)',
                  border: '1px solid rgba(255,184,0,0.25)',
                  borderRadius: '6px', padding: '3px 8px',
                  color: 'var(--gold)', fontSize: '0.66rem', fontWeight: 700,
                  cursor: intelLoading ? 'not-allowed' : 'pointer', opacity: intelLoading ? 0.5 : 1,
                  fontFamily: 'inherit',
                }}
              >
                {intelLoading ? '⟳ Scanning…' : '⚡ Scan Now'}
              </button>
            </div>

            {/* Custom query box */}
            <div style={{ display: 'flex', gap: '5px', marginBottom: '0.6rem' }}>
              <input
                value={intelQuery}
                onChange={e => setIntelQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && intelQuery.trim()) runIntelScan(sport, intelQuery); }}
                placeholder="Ask about a player or rumor…"
                style={{
                  flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: '6px', padding: '5px 8px',
                  color: 'var(--text-primary)', fontSize: '0.72rem', fontFamily: 'inherit',
                  outline: 'none',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(255,184,0,0.5)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
              <VoiceButton value={intelQuery} onChange={setIntelQuery} size="sm" />
              <button
                onClick={() => intelQuery.trim() && runIntelScan(sport, intelQuery)}
                disabled={intelLoading || !intelQuery.trim()}
                style={{
                  background: 'var(--gold)', color: '#0a0a0a',
                  border: 'none', borderRadius: '6px', padding: '5px 10px',
                  fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer',
                  opacity: (intelLoading || !intelQuery.trim()) ? 0.4 : 1,
                  fontFamily: 'inherit',
                }}
              >→</button>
            </div>

            {/* Results */}
            {intelLoading && !intelText && (
              <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '8px', animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</div>
                <div style={{ fontSize: '0.75rem' }}>Scanning Twitter/X,<br/>ESPN & beat reporters…</div>
              </div>
            )}
            {intelError && (
              <div style={{ padding: '0.6rem', background: 'var(--red-subtle)', borderRadius: '7px', color: 'var(--red)', fontSize: '0.72rem' }}>
                ⚠️ {intelError}
              </div>
            )}
            {intelText && !intelLoading && (
              <div style={{ overflowY: 'auto', flex: 1, paddingRight: '2px' }}>
                {/* Render response with status word highlighting */}
                {intelText.split('\n').map((line, i) => {
                  if (!line.trim()) return <div key={i} style={{ height: '4px' }} />;
                  const isHeader = line.startsWith('🏥') || line.startsWith('⚡');
                  const isPlayer = line.startsWith('•') || line.match(/^[A-Z][a-z]+ [A-Z]/);
                  const isSource = line.includes('📡');
                  // Color-code status keywords
                  const colorLine = line
                    .replace(/\b(OUT|SCRATCHED|OUT FOR SEASON)\b/g, '<span style="color:#f87171;font-weight:800;">$1</span>')
                    .replace(/\b(DOUBTFUL)\b/g, '<span style="color:#fb923c;font-weight:800;">$1</span>')
                    .replace(/\b(QUESTIONABLE|DAY-TO-DAY|DTD)\b/g, '<span style="color:#facc15;font-weight:800;">$1</span>')
                    .replace(/\b(PROBABLE|GAME-TIME)\b/g, '<span style="color:#86efac;font-weight:700;">$1</span>')
                    .replace(/\b(STARTING|ACTIVE)\b/g, '<span style="color:#4ade80;font-weight:700;">$1</span>');
                  return (
                    <div key={i} style={{
                      fontSize: isHeader ? '0.72rem' : isSource ? '0.62rem' : '0.74rem',
                      color: isHeader ? 'var(--gold)' : isSource ? 'var(--text-muted)' : 'var(--text-secondary)',
                      fontWeight: isHeader ? 800 : isPlayer ? 600 : 400,
                      marginBottom: isHeader ? '6px' : '2px',
                      marginTop: isHeader ? '8px' : 0,
                      lineHeight: 1.45,
                      paddingLeft: isSource ? '12px' : 0,
                    }}
                      dangerouslySetInnerHTML={{ __html: colorLine }}
                    />
                  );
                })}
              </div>
            )}
            {!intelText && !intelLoading && !intelError && (
              <div style={{ textAlign: 'center', padding: '2.5rem 0', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '1.8rem', marginBottom: '10px', opacity: 0.4 }}>🏥</div>
                <div style={{ fontSize: '0.78rem', marginBottom: '6px', fontWeight: 600 }}>No scan yet</div>
                <div style={{ fontSize: '0.68rem' }}>Click "Scan Now" or ask about<br/>a specific player above</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>

    {/* ── Bet Slip Modal ─────────────────────────────────────────────────── */}
    {betSlipGame && (() => {
      // Events are pre-enriched via enrichedGames — single source of truth, no separate merge needed
      const { away, home } = getCompetitors(betSlipGame.event);
      const odds = getOdds(betSlipGame.event);
      return (
        <BetSlipModal
          game={{ away, home, odds, date: betSlipGame.event?.date }}
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
    </>
  );
}
