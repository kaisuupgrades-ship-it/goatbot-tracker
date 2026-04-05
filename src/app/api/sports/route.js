import { NextResponse } from 'next/server';

export const maxDuration = 15;

// ESPN unofficial API — free, no key needed
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const SPORT_PATHS = {
  mlb:    'baseball/mlb',
  nfl:    'football/nfl',
  nba:    'basketball/nba',
  nhl:    'hockey/nhl',
  ncaaf:  'football/college-football',
  ncaab:  'basketball/mens-college-basketball',
  mls:    'soccer/usa.1',
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

async function espnFetch(path) {
  const cached = getCached(path);
  if (cached) return cached;

  const res = await fetch(`${ESPN_BASE}/${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 20 },
  });
  if (!res.ok) throw new Error(`ESPN API ${res.status}: ${path}`);
  const data = await res.json();
  setCache(path, data);
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

    // Golf leaderboard needs ?league=pga query param
    if (sport === 'golf' && effectiveEndpoint === 'leaderboard') {
      path += '?league=pga';
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
