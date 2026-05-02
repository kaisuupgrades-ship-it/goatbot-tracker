import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { teamsMatch } from '@/lib/teamNormalizer';
import { quantEnrichEvents } from '@/lib/quantPick';

export const maxDuration = 15;

// Supabase client for reading enrichment that the cron writes
const supabaseEnrich = (process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY))
  ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  : null;

// ESPN unofficial API — free, no key needed
const ESPN_BASE          = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_WEB_BASE      = 'https://site.web.api.espn.com/apis/v2/sports';
// site.web.api uses /apis/site/v2 for most endpoints (playersummary, etc.)
const ESPN_WEB_SITE_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports';

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
      teamsMatch(oa.home_team, homeName) && teamsMatch(oa.away_team, awayName)
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

// ── Per-event H2H + weather enrichment (DB-backed) ─────────────────────────
// Reads pre-computed enrichment from the game_enrichment Supabase table —
// written by /api/cron/refresh-enrichment on a schedule. Single SELECT per
// scoreboard request, no upstream API calls in the hot path.
//
// Failed cron fetches don't poison the cache: the cron only overwrites a
// piece (h2h/weather/stadium) when it successfully fetched a non-null value,
// so a transient ESPN/Open-Meteo blip leaves the previous good data in place.
//
// If a game isn't in the table yet (brand-new event the cron hasn't seen),
// the event comes back without enrichment and the client's existing per-card
// fetchH2H/fetchWeather fallback kicks in. So this is purely additive — old
// behavior remains as a safety net.
async function enrichEvents(sport, events) {
  if (!Array.isArray(events) || events.length === 0) return events;
  if (!supabaseEnrich) return events;

  const gameIds = events.map(e => e.id).filter(Boolean);
  if (!gameIds.length) return events;

  const { data: rows, error } = await supabaseEnrich
    .from('game_enrichment')
    .select('game_id, h2h, weather, stadium')
    .eq('sport', sport)
    .in('game_id', gameIds);
  if (error || !rows) {
    console.warn('[enrichEvents] DB read failed:', error?.message);
    return events; // safe fallback — client per-card fetch still works
  }

  const byGameId = new Map(rows.map(r => [r.game_id, r]));
  return events.map(ev => {
    const row = byGameId.get(ev.id);
    if (!row) return ev;
    return {
      ...ev,
      enrichment: {
        h2h:     row.h2h     || null,
        weather: row.weather || null,
        stadium: row.stadium || null,
      },
    };
  });
}

async function espnFetch(path, base = ESPN_BASE, { timeout } = {}) {
  const key = `${base}/${path}`;
  const cached = getCached(key);
  if (cached) return cached;

  const opts = {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 20 },
  };
  if (timeout) opts.signal = AbortSignal.timeout(timeout);

  const res = await fetch(`${base}/${path}`, opts);
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
  const enrich   = searchParams.get('enrich') === '1';

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

      // Endpoint 1 (best): playersummary?player= via site.web.api — confirmed working.
      // Returns per-round linescores with hole-by-hole data + to-par displayValue.
      // Try player= first (confirmed 200), then athlete= (returns 400 but kept for future).
      for (const param of ['player', 'athlete']) {
        try {
          const data = await espnFetch(
            `golf/${golfLeague}/leaderboard/${eventId}/playersummary?${param}=${athleteId}`,
            ESPN_WEB_SITE_BASE,
            { timeout: 8000 },
          );
          if (data?.rounds?.length || data?.player?.rounds?.length) {
            return NextResponse.json(data);
          }
        } catch (err) {
          console.warn(`Golf playersummary (${param}=) failed:`, err.message);
        }
      }

      // Endpoint 2: scorecards via site.web.api (detailed — may work for some events)
      try {
        const data = await espnFetch(`golf/${golfLeague}/scorecards/${athleteId}?event=${eventId}`, ESPN_WEB_BASE, { timeout: 6000 });
        const rounds = data?.rounds || data?.player?.rounds || [];
        if (rounds.length > 0) return NextResponse.json(data);
      } catch (err) {
        console.warn('Golf scorecard web endpoint failed:', err.message);
      }

      // Endpoint 2b: scorecards via public ESPN base
      try {
        const data = await espnFetch(`golf/${golfLeague}/scorecards/${athleteId}?event=${eventId}`, ESPN_BASE, { timeout: 6000 });
        const rounds = data?.rounds || data?.player?.rounds || [];
        if (rounds.length > 0) return NextResponse.json(data);
      } catch (err) {
        console.warn('Golf scorecard public endpoint failed:', err.message);
      }

      // Endpoint 3: event summary (may be slow/502 — short timeout, last resort before leaderboard)
      try {
        const data = await espnFetch(`golf/${golfLeague}/summary?event=${eventId}`, ESPN_BASE, { timeout: 5000 });
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

      return NextResponse.json({ error: 'Scorecard not available for this player/event', rounds: [] }, { status: 404 });
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
      let enriched = oddsApiScores ? enrichWithOddsApiScores(espnData, oddsApiScores) : espnData;

      // Bake H2H + weather into each event so the scoreboard renders instantly
      // with no per-card client fetches. Behind ?enrich=1 because this adds
      // latency to the response (~1-3s on a cold cache). Cached aggressively.
      if (enrich && Array.isArray(enriched.events) && enriched.events.length > 0) {
        let events = await enrichEvents(sport, enriched.events);

        // MLB-only: attach quant pick (Elo vs market edge) to each event.
        // quantEnrichEvents is safe to call for all sports — it no-ops for non-MLB.
        // Runs after enrichEvents so quant data doesn't block H2H/weather enrichment.
        if (supabaseEnrich) {
          events = await quantEnrichEvents({ supabase: supabaseEnrich, events, sport });
        }

        enriched = { ...enriched, events };
      }

      const body = { ...enriched, _oddsApiConnected: !!oddsApiScores?.length };
      // Edge-cache the enriched scoreboard for 60s so all users hitting the
      // same (sport, date) share one upstream fetch. SWR keeps it warm.
      const headers = enrich
        ? { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' }
        : undefined;
      return NextResponse.json(body, headers ? { headers } : undefined);
    }

    const data = await espnFetch(path);
    return NextResponse.json(data);
  } catch (err) {
    console.error('ESPN API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
