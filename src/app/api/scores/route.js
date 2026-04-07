/**
 * /api/scores — Unified live scores
 *
 * Primary:  The Odds API /v4/sports/{sport}/scores/ — FREE (doesn't count against quota)
 *           Updates ~every 30 seconds for live games. Returns scores + commence times.
 *
 * Fallback: ESPN unofficial API — free, broader sport coverage, play-by-play detail.
 *
 * Strategy:
 *   - The Odds API provides scores for major US sports (MLB, NFL, NBA, NHL, NCAAF, NCAAB, MLS, UFC)
 *   - ESPN provides scores for ALL sports (golf, tennis, WNBA, etc.) + detailed game state
 *   - We merge them: The Odds API scores (fast, reliable, structured event IDs that match odds)
 *     enriched with ESPN game state detail (period, clock, situation, play-by-play)
 *   - For sports not covered by The Odds API (golf, tennis, WNBA), ESPN is sole source
 *
 * Response shape:
 * {
 *   games: [{ id, event_id, home_team, away_team, home_score, away_score,
 *             commence_time, completed, status, period, clock, ... }],
 *   source: 'the-odds-api' | 'espn' | 'merged',
 *   sport, total, cached
 * }
 */
import { NextResponse } from 'next/server';

export const maxDuration = 15;

// ── Config ────────────────────────────────────────────────────────────────────
const THE_ODDS_KEY  = process.env.THE_ODDS_API_KEY;
const THE_ODDS_BASE = 'https://api.the-odds-api.com/v4';
const ESPN_BASE     = 'https://site.api.espn.com/apis/site/v2/sports';

// The Odds API sport keys (same as /api/odds)
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

// ESPN sport paths
const ESPN_PATHS = {
  mlb:    'baseball/mlb',
  nfl:    'football/nfl',
  nba:    'basketball/nba',
  nhl:    'hockey/nhl',
  ncaaf:  'football/college-football',
  ncaab:  'basketball/mens-college-basketball',
  mls:    'soccer/usa.1',
  wnba:   'basketball/wnba',
  ufc:    'mma/ufc',
  golf:   'golf/pga',
  tennis: 'tennis/atp',
};

// ── In-memory cache (per-instance, short TTL for live data) ──────────────────
const cache = new Map();

function getCached(key, ttlMs) {
  const e = cache.get(key);
  if (!e || Date.now() - e.time > ttlMs) { cache.delete(key); return null; }
  return e.data;
}
function setCache(key, data) { cache.set(key, { data, time: Date.now() }); }

// ── The Odds API Scores (FREE — no quota cost) ──────────────────────────────
async function fetchOddsApiScores(sport) {
  const sportKey = ODDS_API_SPORTS[sport];
  if (!sportKey || !THE_ODDS_KEY) return null;

  try {
    // daysFrom=1 gets completed games from last 24h + upcoming/live
    const url = `${THE_ODDS_BASE}/sports/${sportKey}/scores/?apiKey=${THE_ODDS_KEY}&daysFrom=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!res.ok) {
      console.warn(`[scores] The Odds API returned ${res.status} for ${sport}`);
      return null;
    }

    const events = await res.json();
    if (!Array.isArray(events)) return null;

    return events.map(ev => ({
      event_id:       ev.id,
      home_team:      ev.home_team,
      away_team:      ev.away_team,
      commence_time:  ev.commence_time,
      completed:      ev.completed || false,
      home_score:     ev.scores?.find(s => s.name === ev.home_team)?.score ?? null,
      away_score:     ev.scores?.find(s => s.name === ev.away_team)?.score ?? null,
      last_update:    ev.last_update || null,
      _source:        'the-odds-api',
    }));
  } catch (err) {
    console.warn(`[scores] The Odds API fetch failed for ${sport}:`, err.message);
    return null;
  }
}

// ── ESPN Scores (detailed game state) ────────────────────────────────────────
async function fetchEspnScores(sport, date) {
  const espnPath = ESPN_PATHS[sport];
  if (!espnPath) return null;

  try {
    let url = `${ESPN_BASE}/${espnPath}/scoreboard`;
    if (date) url += `?dates=${date.replace(/-/g, '')}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    const events = data?.events || [];
    return events.map(ev => {
      const comp = ev.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === 'home');
      const away = comp?.competitors?.find(c => c.homeAway === 'away');
      const status = comp?.status || ev.status || {};

      return {
        espn_id:        ev.id,
        home_team:      home?.team?.displayName || home?.team?.shortDisplayName || '',
        away_team:      away?.team?.displayName || away?.team?.shortDisplayName || '',
        home_abbr:      home?.team?.abbreviation || '',
        away_abbr:      away?.team?.abbreviation || '',
        home_score:     home?.score != null ? parseInt(home.score) : null,
        away_score:     away?.score != null ? parseInt(away.score) : null,
        home_logo:      home?.team?.logo || null,
        away_logo:      away?.team?.logo || null,
        home_record:    home?.records?.[0]?.summary || '',
        away_record:    away?.records?.[0]?.summary || '',
        commence_time:  ev.date || comp?.date,
        completed:      status.type?.completed || false,
        status_state:   status.type?.state || 'pre',   // pre | in | post
        status_detail:  status.type?.shortDetail || status.type?.detail || '',
        period:         status.period || null,
        clock:          status.displayClock || null,
        situation:      comp?.situation || null,
        odds_detail:    comp?.odds?.[0]?.details || null,    // ESPN's own line (e.g. "DET -1.5")
        odds_overUnder: comp?.odds?.[0]?.overUnder || null,
        broadcast:      comp?.broadcasts?.[0]?.names?.[0] || null,
        venue:          comp?.venue?.fullName || null,
        linescores:     { home: home?.linescores || [], away: away?.linescores || [] },
        _source:        'espn',
      };
    });
  } catch (err) {
    console.warn(`[scores] ESPN fetch failed for ${sport}:`, err.message);
    return null;
  }
}

// ── Merge: The Odds API scores + ESPN detail ─────────────────────────────────
// Team name normalization for matching across sources
function normTeam(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\b(the|a|an|fc|sc|city|united|sporting)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamsMatch(a, b) {
  const na = normTeam(a), nb = normTeam(b);
  if (na === nb) return true;
  const wordsA = na.split(' '), wordsB = nb.split(' ');
  const lastA = wordsA[wordsA.length - 1], lastB = wordsB[wordsB.length - 1];
  if (lastA && lastA === lastB && lastA.length > 3) return true;
  return (na.includes(lastB) && lastB.length > 4) || (nb.includes(lastA) && lastA.length > 4);
}

function mergeScores(oddsApiGames, espnGames) {
  if (!oddsApiGames?.length && !espnGames?.length) return [];
  if (!oddsApiGames?.length) return espnGames || [];
  if (!espnGames?.length) return oddsApiGames || [];

  // Build merged list: start with ESPN games (richer data), enrich with Odds API event_id + scores
  const merged = espnGames.map(espn => {
    // Find matching Odds API game
    const match = oddsApiGames.find(oa =>
      teamsMatch(oa.home_team, espn.home_team) && teamsMatch(oa.away_team, espn.away_team)
    );

    if (match) {
      return {
        ...espn,
        event_id:     match.event_id,  // The Odds API event ID — links to /api/odds data
        // Use Odds API scores if ESPN scores are null (happens for upcoming games)
        home_score:   espn.home_score ?? match.home_score,
        away_score:   espn.away_score ?? match.away_score,
        oa_completed: match.completed,
        _source:      'merged',
      };
    }

    return espn; // No Odds API match — ESPN-only game
  });

  // Add any Odds API games that weren't matched to ESPN (shouldn't happen often)
  for (const oa of oddsApiGames) {
    const alreadyMerged = merged.some(m => m.event_id === oa.event_id);
    if (!alreadyMerged) {
      merged.push({ ...oa, _source: 'the-odds-api-only' });
    }
  }

  return merged;
}

// ── Handler ──────────────────────────────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sport = (searchParams.get('sport') || 'mlb').toLowerCase();
  const date  = searchParams.get('date') || '';

  const cacheKey = `scores_${sport}_${date}`;

  // Determine if any games are likely live (use shorter TTL)
  // During game windows: 15s cache. Off-hours: 60s cache.
  const hour = new Date().getUTCHours();
  const isGameWindow = hour >= 17 || hour <= 7; // noon-3am ET
  const ttl = isGameWindow ? 15_000 : 60_000;

  const cached = getCached(cacheKey, ttl);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  // Fetch from both sources in parallel
  const hasOddsApi = !!ODDS_API_SPORTS[sport] && !!THE_ODDS_KEY;

  const [oddsApiResult, espnResult] = await Promise.allSettled([
    hasOddsApi ? fetchOddsApiScores(sport) : Promise.resolve(null),
    fetchEspnScores(sport, date),
  ]);

  const oddsApiGames = oddsApiResult.status === 'fulfilled' ? oddsApiResult.value : null;
  const espnGames    = espnResult.status === 'fulfilled' ? espnResult.value : null;

  const games = mergeScores(oddsApiGames, espnGames);

  // Determine source attribution
  let source = 'none';
  if (oddsApiGames?.length && espnGames?.length) source = 'merged';
  else if (oddsApiGames?.length) source = 'the-odds-api';
  else if (espnGames?.length) source = 'espn';

  const result = {
    games,
    source,
    sport,
    total: games.length,
    oddsApiConnected: !!oddsApiGames?.length,
    espnConnected:    !!espnGames?.length,
  };

  if (games.length > 0) setCache(cacheKey, result);

  return NextResponse.json({ ...result, cached: false });
}
