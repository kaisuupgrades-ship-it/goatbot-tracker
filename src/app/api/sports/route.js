import { NextResponse } from 'next/server';

export const maxDuration = 15;

// ESPN unofficial API — free, no key needed
const ESPN_BASE      = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_WEB_BASE  = 'https://site.web.api.espn.com/apis/v2/sports';

const SPORT_PATHS = {
  mlb:    'baseball/mlb',
  nfl:    'football/nfl',
  nba:    'basketball/nba',
  nhl:    'hockey/nhl',
  ncaaf:  'football/college-football',
  ncaab:  'basketball/mens-college-basketball',
  mls:    'soccer/usa.1',
  soccer: 'soccer/usa.1', // overridden by ?league= param below
  wnba:   'basketball/wnba',
  ufc:    'mma/ufc',
  tennis: 'tennis/atp',
  tenniswta: 'tennis/wta',
  golf:   'golf/pga',
};

// Sports that use a non-standard endpoint (not /scoreboard)
const SPORT_ENDPOINT_OVERRIDE = {
  golf: 'leaderboard', // PGA uses /leaderboard?league=pga, not /scoreboard
};

// Simple in-memory cache (resets on server restart)
const cache = new Map();
const CACHE_TTL = 20 * 1000; // 20 seconds — fast enough for near-live scores

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

async function espnFetch(path, base = ESPN_BASE) {
  const key = `${base}/${path}`;
  const cached = getCached(key);
  if (cached) return cached;

  const res = await fetch(`${base}/${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 20 },
  });
  if (!res.ok) throw new Error(`ESPN API ${res.status}: ${path}`);
  const data = await res.json();
  setCache(key, data);
  return data;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sport    = searchParams.get('sport') || 'mlb';
  const endpoint = searchParams.get('endpoint') || 'scoreboard'; // scoreboard | news | standings | injuries | teams
  const date     = searchParams.get('date') || '';

  const sportPath = SPORT_PATHS[sport];
  if (!sportPath) {
    return NextResponse.json({ error: `Unknown sport: ${sport}` }, { status: 400 });
  }

  try {
    // Use endpoint override if the sport has a special primary endpoint
    const effectiveEndpoint = SPORT_ENDPOINT_OVERRIDE[sport] || endpoint;
    let path = `${sportPath}/${effectiveEndpoint}`;

    // Golf leaderboard: ESPN requires the league as a query param at the top-level
    // path, NOT as a sub-path — correct URL is golf/leaderboard?league=pga
    // (NOT golf/pga/leaderboard?league=pga which 404s)
    if (sport === 'golf' && effectiveEndpoint === 'leaderboard') {
      const golfLeague = searchParams.get('league') || 'pga';
      path = `golf/leaderboard?league=${golfLeague}`;
    } else if (sport === 'golf' && endpoint === 'scorecard') {
      // Per-player scorecard: uses ESPN web API
      // https://site.web.api.espn.com/apis/v2/sports/golf/{league}/scorecards/{athleteId}?event={eventId}
      const golfLeague = searchParams.get('league') || 'pga';
      const athleteId  = searchParams.get('athleteId');
      const eventId    = searchParams.get('eventId');
      if (!athleteId || !eventId) {
        return NextResponse.json({ error: 'athleteId and eventId required for golf scorecard' }, { status: 400 });
      }
      try {
        const data = await espnFetch(`golf/${golfLeague}/scorecards/${athleteId}?event=${eventId}`, ESPN_WEB_BASE);
        return NextResponse.json(data);
      } catch (err) {
        console.error('Golf scorecard error:', err.message);
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
    } else if (sport === 'soccer') {
      // Soccer uses a dynamic league param — e.g. ?league=eng.1 for Premier League
      const soccerLeague = searchParams.get('league') || 'usa.1';
      path = `soccer/${soccerLeague}/scoreboard`;
    } else if (endpoint === 'scoreboard' && date) {
      path += `?dates=${date}`;
    }

    const data = await espnFetch(path);
    return NextResponse.json(data);
  } catch (err) {
    console.error('ESPN API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
