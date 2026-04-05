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
      // Per-player scorecard: try multiple ESPN endpoints
      const golfLeague = searchParams.get('league') || 'pga';
      const athleteId  = searchParams.get('athleteId');
      const eventId    = searchParams.get('eventId');
      if (!athleteId || !eventId) {
        return NextResponse.json({ error: 'athleteId and eventId required for golf scorecard' }, { status: 400 });
      }

      // Endpoint 1: site.web.api scorecards (most detailed — has par per hole)
      try {
        const data = await espnFetch(`golf/${golfLeague}/scorecards/${athleteId}?event=${eventId}`, ESPN_WEB_BASE);
        const rounds = data?.rounds || data?.player?.rounds || [];
        if (rounds.length > 0) return NextResponse.json(data);
      } catch (err) {
        console.warn('Golf scorecard primary endpoint failed:', err.message);
      }

      // Endpoint 2: site.web.api competitor detail (sometimes has round-by-round linescores)
      try {
        const data = await espnFetch(
          `golf/${golfLeague}/leaderboard/${eventId}/playersummary?player=${athleteId}`,
          ESPN_WEB_BASE
        );
        if (data?.rounds?.length || data?.player?.rounds?.length) {
          return NextResponse.json(data);
        }
      } catch (err) {
        console.warn('Golf player summary fallback failed:', err.message);
      }

      // Endpoint 3: Try the main leaderboard and extract this player's linescores
      try {
        const lb = await espnFetch(`golf/leaderboard?league=${golfLeague}`);
        const events = lb?.events || [];
        for (const evt of events) {
          if (String(evt.id) !== String(eventId)) continue;
          const competitors = evt.competitions?.[0]?.competitors || [];
          const player = competitors.find(c =>
            String(c.id) === String(athleteId) ||
            String(c.athlete?.id) === String(athleteId)
          );
          if (player) {
            // Build rounds from per-round statistics if available
            const linescores = player.linescores || [];
            const stats = player.statistics || [];
            const roundScores = [];
            // stats[0]=toPar, stats[1]=thru, stats[2]=today, stats[3+]=round scores
            for (let i = 3; i < stats.length; i++) {
              const val = stats[i]?.displayValue;
              if (val && !isNaN(parseInt(val))) {
                roundScores.push({
                  number: i - 2,
                  total: parseInt(val),
                  value: null, // don't know par for the round from this data
                  holes: [], // no per-hole data from leaderboard
                });
              }
            }
            return NextResponse.json({
              rounds: roundScores,
              linescores,
              player: { displayName: player.athlete?.displayName },
              _source: 'leaderboard_fallback',
            });
          }
        }
      } catch (err) {
        console.warn('Golf leaderboard fallback failed:', err.message);
      }

      return NextResponse.json({ error: 'Scorecard not available for this player/event', rounds: [] }, { status: 200 });
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
