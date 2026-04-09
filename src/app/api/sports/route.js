import { NextResponse } from 'next/server';

export const maxDuration = 15;

// ESPN unofficial API — free, no key needed
const ESPN_BASE      = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_WEB_BASE  = 'https://site.web.api.espn.com/apis/v2/sports';

// The Odds API (free /scores endpoint — doesn't count against quota)
const THE_ODDS_KEY   = process.env.THE_ODDS_API_KEY;
const THE_ODDS_BASE  = 'https://api.the-odds-api.com/v4';

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

// The Odds API sport keys (for /scores enrichment)
const ODDS_API_SPORTS = {
  mlb:   'baseball_mlb',
  nfl:   'americanfootball_nfl',
  nba:   'basketball_nba',
  nhl:   'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
  ncaab: 'basketball_ncaab',
  mls:   'soccer_usa_mls',
  ufc:   'mma_mixed_martial_arts',
};

// Sports that use a non-standard endpoint (not /scoreboard)
const SPORT_ENDPOINT_OVERRIDE = {
  golf: 'leaderboard', // PGA uses /leaderboard?league=pga, not /scoreboard
};

// Simple in-memory cache (resets on server restart)
const cache = new Map();
const CACHE_TTL = 15 * 1000; // 15 seconds — leveraging 20K plan for faster updates

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// ── The Odds API scores (FREE — no quota cost) ──────────────────────────────
// Fetches live scores from The Odds API to enrich ESPN data with event_id
// (which directly links to /api/odds events for perfect odds-to-game matching)
const scoresCache = new Map();
const SCORES_TTL  = 30 * 1000; // 30 seconds — matches their update frequency

async function fetchOddsApiScores(sport) {
  const sportKey = ODDS_API_SPORTS[sport];
  if (!sportKey || !THE_ODDS_KEY) return null;

  const cacheKey = `oa_scores_${sport}`;
  const cached = scoresCache.get(cacheKey);
  if (cached && Date.now() - cached.time < SCORES_TTL) return cached.data;

  try {
    const url = `${THE_ODDS_BASE}/sports/${sportKey}/scores/?apiKey=${THE_ODDS_KEY}&daysFrom=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const events = await res.json();
    if (!Array.isArray(events)) return null;
    scoresCache.set(cacheKey, { data: events, time: Date.now() });
    return events;
  } catch {
    return null;
  }
}

function normTeamName(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function teamNamesMatch(a, b) {
  const na = normTeamName(a), nb = normTeamName(b);
  if (na === nb) return true;
  const wordsA = na.split(' '), wordsB = nb.split(' ');
  const lastA = wordsA[wordsA.length - 1], lastB = wordsB[wordsB.length - 1];
  if (lastA && lastA === lastB && lastA.length >= 3) return true;
  return (na.includes(lastB) && lastB.length >= 3) || (nb.includes(lastA) && lastA.length >= 3);
}

// Enrich ESPN events with The Odds API event_id + live scores
function enrichWithOddsApiScores(espnData, oddsApiScores) {
  if (!oddsApiScores?.length || !espnData?.events?.length) return espnData;

  const enrichedEvents = espnData.events.map(ev => {
    const comp = ev.competitions?.[0];
    if (!comp) return ev;

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) return ev;

    const homeName = home.team?.displayName || home.team?.shortDisplayName || '';
    const awayName = away.team?.displayName || away.team?.shortDisplayName || '';

    // Find matching Odds API event
    const match = oddsApiScores.find(oa =>
      teamNamesMatch(oa.home_team, homeName) && teamNamesMatch(oa.away_team, awayName)
    );

    if (!match) return ev;

    return {
      ...ev,
      odds_api_event_id:  match.id,           // Links to /api/odds events
      odds_api_completed: match.completed,
      odds_api_scores:    match.scores || null,
      odds_api_updated:   match.last_update || null,
    };
  });

  return { ...espnData, events: enrichedEvents };
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
    // ── Golf scorecard: handle BEFORE effectiveEndpoint override (which always maps golf→leaderboard)
    if (sport === 'golf' && endpoint === 'scorecard') {
      // Per-player scorecard: try multiple ESPN endpoints
      const golfLeague = searchParams.get('league') || 'pga';
      const athleteId  = searchParams.get('athleteId');
      const eventId    = searchParams.get('eventId');
      if (!athleteId || !eventId) {
        return NextResponse.json({ error: 'athleteId and eventId required for golf scorecard' }, { status: 400 });
      }

      // Helper: extract individual round stroke counts from ESPN statistics array.
      // ESPN puts per-round stroke counts (63–82 typical) at stats[3+], but sometimes
      // stats[3] is the total tournament stroke count (268). Filter by realistic range.
      function extractRoundScores(stats) {
        const roundScores = [];
        for (let i = 3; i < stats.length; i++) {
          const val = stats[i]?.displayValue;
          if (!val) continue;
          const n = parseInt(val);
          // Accept only realistic individual round stroke counts (55–90).
          // This excludes total-tournament scores (260–290) and to-par strings like "-12"
          // that would be caught by the negative-number check.
          if (!isNaN(n) && n >= 55 && n <= 90) {
            roundScores.push({
              number: roundScores.length + 1, // sequential: always R1, R2, R3, R4
              total:  n,
              value:  null, // to-par per round unknown from leaderboard stats
              holes:  [],
            });
          }
        }
        return roundScores;
      }

      // Endpoint 1: site.web.api scorecards (most detailed — has par per hole)
      try {
        const data = await espnFetch(`golf/${golfLeague}/scorecards/${athleteId}?event=${eventId}`, ESPN_WEB_BASE);
        const rounds = data?.rounds || data?.player?.rounds || [];
        if (rounds.length > 0) return NextResponse.json(data);
      } catch (err) {
        console.warn('Golf scorecard web endpoint failed:', err.message);
      }

      // Endpoint 1b: same scorecard path but via the public ESPN base (site.api.espn.com)
      try {
        const data = await espnFetch(`golf/${golfLeague}/scorecards/${athleteId}?event=${eventId}`);
        const rounds = data?.rounds || data?.player?.rounds || [];
        if (rounds.length > 0) return NextResponse.json(data);
      } catch (err) {
        console.warn('Golf scorecard public endpoint failed:', err.message);
      }

      // Endpoint 2: event summary — sometimes includes full competitor round data
      try {
        const data = await espnFetch(`golf/${golfLeague}/summary?event=${eventId}`);
        const competitors = data?.competitors || data?.competition?.competitors || [];
        const player = competitors.find(c =>
          String(c.id) === String(athleteId) ||
          String(c.athlete?.id) === String(athleteId)
        );
        if (player) {
          const rounds = player.rounds || player.athlete?.rounds || [];
          if (rounds.length > 0) return NextResponse.json({ rounds, player: { displayName: player.athlete?.displayName }, _source: 'summary' });
        }
      } catch (err) {
        console.warn('Golf summary endpoint failed:', err.message);
      }

      // Endpoint 2b: site.web.api competitor detail
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

      // Endpoint 3: Pull from the main leaderboard — always succeeds when an event is active.
      // Extracts round-by-round totals from statistics array + live hole data from linescores.
      try {
        const [lb, eventLb] = await Promise.allSettled([
          espnFetch(`golf/leaderboard?league=${golfLeague}`),
          // Event-specific leaderboard (web API may fail — that's OK)
          espnFetch(`golf/${golfLeague}/leaderboard/${eventId}`, ESPN_WEB_BASE).catch(() => null),
        ]);
        const lbData  = lb.status    === 'fulfilled' ? lb.value    : null;
        const evtData = eventLb.status === 'fulfilled' ? eventLb.value : null;

        // Merge event lists; prefer event-specific data first
        const events = [
          ...(evtData?.events || []),
          ...(lbData?.events  || []),
        ];

        for (const evt of events) {
          if (String(evt.id) !== String(eventId)) continue;
          const competitors = evt.competitions?.[0]?.competitors || [];
          const player = competitors.find(c =>
            String(c.id) === String(athleteId) ||
            String(c.athlete?.id) === String(athleteId)
          );
          if (!player) continue;

          const linescores = player.linescores || [];
          const stats      = player.statistics || [];
          const roundScores = extractRoundScores(stats);

          return NextResponse.json({
            rounds:     roundScores,
            linescores,
            player: { displayName: player.athlete?.displayName },
            _source: 'leaderboard_fallback',
          });
        }
      } catch (err) {
        console.warn('Golf leaderboard fallback failed:', err.message);
      }

      return NextResponse.json({ error: 'Scorecard not available for this player/event', rounds: [] }, { status: 200 });
    }

    // Use endpoint override if the sport has a special primary endpoint
    const effectiveEndpoint = SPORT_ENDPOINT_OVERRIDE[sport] || endpoint;
    let path = `${sportPath}/${effectiveEndpoint}`;

    // Golf leaderboard: ESPN requires the league as a query param at the top-level
    if (sport === 'golf' && effectiveEndpoint === 'leaderboard') {
      const golfLeague = searchParams.get('league') || 'pga';
      path = `golf/leaderboard?league=${golfLeague}`;
    } else if (sport === 'soccer') {
      // Soccer uses a dynamic league param — e.g. ?league=eng.1 for Premier League
      const soccerLeague = searchParams.get('league') || 'usa.1';
      path = `soccer/${soccerLeague}/scoreboard`;
    } else if (endpoint === 'scoreboard' && date) {
      path += `?dates=${date}`;
    }

    // For scoreboard requests: fetch ESPN + Odds API scores in parallel
    // Odds API scores are FREE (no quota cost) and give us event_id for odds linking
    if (effectiveEndpoint === 'scoreboard' || effectiveEndpoint === 'leaderboard') {
      const [espnData, oddsApiScores] = await Promise.all([
        espnFetch(path),
        (effectiveEndpoint === 'scoreboard') ? fetchOddsApiScores(sport) : Promise.resolve(null),
      ]);

      // Enrich ESPN data with Odds API event IDs
      const enriched = oddsApiScores ? enrichWithOddsApiScores(espnData, oddsApiScores) : espnData;
      return NextResponse.json({ ...enriched, _oddsApiConnected: !!oddsApiScores?.length });
    }

    const data = await espnFetch(path);
    return NextResponse.json(data);
  } catch (err) {
    console.error('ESPN API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
