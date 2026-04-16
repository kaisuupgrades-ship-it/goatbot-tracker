import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export const maxDuration = 15;

// ── Sport → ESPN endpoint map ────────────────────────────────────────────────
const ESPN_ENDPOINTS = {
  // Basketball
  'NBA':       'basketball/nba',
  'NCAAB':     'basketball/mens-college-basketball',
  'WNBA':      'basketball/wnba',
  // Football
  'NFL':       'football/nfl',
  'NCAAF':     'football/college-football',
  // Baseball
  'MLB':       'baseball/mlb',
  // Hockey
  'NHL':       'hockey/nhl',
  // Soccer
  'MLS':       'soccer/usa.1',
  'EPL':       'soccer/eng.1',
  'UCL':       'soccer/uefa.champions',
  // Other
  'Golf':      null,
  'Tennis':    null,
  'MMA':       null,
  'Boxing':    null,
};

// Normalize sport string to ESPN key
function normalizeSport(sport) {
  if (!sport) return null;
  const s = sport.toUpperCase().trim();
  // Direct match
  if (ESPN_ENDPOINTS[s] !== undefined) return s;
  // Aliases
  const aliases = {
    'COLLEGE BASKETBALL': 'NCAAB',
    'CBB': 'NCAAB',
    'MENS COLLEGE BASKETBALL': 'NCAAB',
    "MEN'S COLLEGE BASKETBALL": 'NCAAB',
    'COLLEGE FOOTBALL': 'NCAAF',
    'CFB': 'NCAAF',
    'PREMIER LEAGUE': 'EPL',
    'CHAMPIONS LEAGUE': 'UCL',
  };
  return aliases[s] || null;
}

// Strip common suffixes for cleaner matching
function cleanTeamName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\s+(fc|sc|cf|af|ac|bc|city|united|athletic|athletics|national|state|university|college|wildcats|bulldogs|huskies|jayhawks|hoosiers|hawkeyes|badgers|buckeyes|spartans|wolverines|fighting illini|illini|tar heels|blue devils|cavaliers|orange|hurricanes|gators|tigers|eagles|falcons|bears|hawks|nets|knicks|sixers|celtics|heat|bucks|suns|jazz|clippers|lakers|rockets|mavericks|nuggets|thunder|warriors|kings|pelicans|grizzlies|pacers|pistons|raptors|wizards|magic|hornets|cavaliers|trail blazers|blazers)$/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim();
}

// Score how well an ESPN event matches the pick
function matchScore(event, teamQuery, dateStr) {
  const competitors = event.competitions?.[0]?.competitors || [];
  const names = competitors.flatMap(c => [
    c.team?.displayName || '',
    c.team?.shortDisplayName || '',
    c.team?.name || '',
    c.team?.abbreviation || '',
    c.team?.nickname || '',
  ]).map(n => n.toLowerCase());

  const query = cleanTeamName(teamQuery);
  const queryWords = query.split(/\s+/).filter(Boolean);

  let score = 0;

  // Exact name match = highest
  if (names.some(n => n === query)) score += 100;
  // Partial match
  else if (names.some(n => n.includes(query) || query.includes(n))) score += 60;
  // Word-level match
  else {
    const wordMatches = queryWords.filter(w => names.some(n => n.includes(w))).length;
    score += wordMatches * 20;
  }

  // Date match bonus
  if (dateStr) {
    const eventDate = event.date?.split('T')[0];
    if (eventDate === dateStr) score += 30;
  }

  return score;
}

// Fetch ESPN scoreboard for a sport on a given date
async function fetchESPNGames(sportKey, dateStr) {
  const path = ESPN_ENDPOINTS[sportKey];
  if (!path) return [];

  // ESPN dates are YYYYMMDD
  const espnDate = dateStr ? dateStr.replace(/-/g, '') : null;
  const dateParam = espnDate ? `&dates=${espnDate}` : '';

  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?limit=100${dateParam}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.events || [];
  } catch {
    return [];
  }
}

/**
 * GET /api/verify-game?sport=NCAAB&team=Illinois&date=2025-04-05
 *
 * Returns:
 * {
 *   found: true,
 *   game: {
 *     id, name, shortName,
 *     commence_time,          ← ISO timestamp of actual tip-off/start
 *     home: { name, abbr },
 *     away: { name, abbr },
 *     venue, status,
 *   },
 *   warning: string | null    ← e.g. "low confidence match"
 * }
 */
export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const sportRaw = searchParams.get('sport');
  const team     = searchParams.get('team') || '';
  const dateStr  = searchParams.get('date') || '';   // YYYY-MM-DD

  if (!sportRaw || !team) {
    return NextResponse.json({ found: false, error: 'sport and team are required' }, { status: 400 });
  }

  const sportKey = normalizeSport(sportRaw);
  if (!sportKey || ESPN_ENDPOINTS[sportKey] === null) {
    return NextResponse.json({
      found: false,
      error: `Sport "${sportRaw}" is not supported for game verification. commence_time will not be set.`,
      unsupported: true,
    });
  }

  // Fetch games — try the exact date first, then ±1 day if no results
  let events = await fetchESPNGames(sportKey, dateStr);

  // If empty for the exact date, try adjacent days (handles timezone edge cases)
  if (events.length === 0 && dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    const prev = new Date(d); prev.setDate(d.getDate() - 1);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    const prevStr = prev.toISOString().split('T')[0];
    const nextStr = next.toISOString().split('T')[0];
    const [e1, e2] = await Promise.all([
      fetchESPNGames(sportKey, prevStr),
      fetchESPNGames(sportKey, nextStr),
    ]);
    events = [...e1, ...e2];
  }

  if (events.length === 0) {
    return NextResponse.json({
      found: false,
      error: `No ${sportKey} games found on ${dateStr || 'that date'}.`,
    });
  }

  // Score all events and pick the best match
  const scored = events
    .map(e => ({ event: e, score: matchScore(e, team, dateStr) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (best.score < 20) {
    return NextResponse.json({
      found: false,
      error: `Could not find a ${sportKey} game matching "${team}" on ${dateStr}. Please check the team name.`,
    });
  }

  const evt = best.event;
  const comp = evt.competitions?.[0] || {};
  const competitors = comp.competitors || [];

  const home = competitors.find(c => c.homeAway === 'home')?.team || {};
  const away = competitors.find(c => c.homeAway === 'away')?.team || {};

  // ESPN date is UTC ISO — this is the actual scheduled start time
  const commenceTime = evt.date;   // e.g. "2025-04-06T01:20:00Z"

  const warning = best.score < 50
    ? `Low confidence match (score ${best.score}) — please verify "${evt.name}" is the correct game.`
    : null;

  return NextResponse.json({
    found: true,
    score: best.score,
    warning,
    game: {
      id:            evt.id,
      name:          evt.name,
      shortName:     evt.shortName,
      commence_time: commenceTime,
      home: {
        name:  home.displayName || home.name || '',
        abbr:  home.abbreviation || '',
      },
      away: {
        name:  away.displayName || away.name || '',
        abbr:  away.abbreviation || '',
      },
      venue:  comp.venue?.fullName || null,
      status: evt.status?.type?.description || 'Scheduled',
    },
  });
}
