/**
 * Shared odds utility — The Odds API (the-odds-api.com)
 *
 * Returns all today's games + bookmaker odds in one API call per sport.
 * American odds format natively — no conversion math needed.
 * Free tier: 500 requests/month (each call to this module = 1 request).
 */

const THE_ODDS_API_KEY  = process.env.THE_ODDS_API_KEY;
const THE_ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Map our internal sport keys → The Odds API sport keys
const SPORT_KEYS = {
  mlb: 'baseball_mlb',
  nba: 'basketball_nba',
  nhl: 'icehockey_nhl',
  nfl: 'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  ncaab: 'basketball_ncaab',
  mls:  'soccer_usa_mls',
  ufc:  'mma_mixed_martial_arts',
};

const SPORT_EMOJI = {
  mlb: '⚾', nba: '🏀', nhl: '🏒', nfl: '🏈',
  ncaaf: '🏈', ncaab: '🏀', mls: '⚽', ufc: '🥊',
};

/**
 * fetchOddsForSport(sportKey)
 *
 * Fetches upcoming + live odds for a single sport from The Odds API.
 * Returns an array of game objects:
 * {
 *   id, sport, emoji, home, away, matchup,
 *   mlHome, mlAway,
 *   spreadHome, spreadHomePoint, spreadAway, spreadAwayPoint,
 *   total, overOdds, underOdds,
 *   commenceTime, status
 * }
 */
export async function fetchOddsForSport(sportKey, { timeoutMs = 8000 } = {}) {
  if (!THE_ODDS_API_KEY) {
    throw new Error('THE_ODDS_API_KEY not configured');
  }

  const apiSportKey = SPORT_KEYS[sportKey];
  if (!apiSportKey) throw new Error(`Unknown sport key: ${sportKey}`);

  const url = new URL(`${THE_ODDS_API_BASE}/sports/${apiSportKey}/odds/`);
  url.searchParams.set('apiKey', THE_ODDS_API_KEY);
  url.searchParams.set('regions', 'us');
  // TODO: add totals back after migrating to OddsPapi (unlimited credits)
  url.searchParams.set('markets', 'h2h,spreads');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('daysFrom', '1'); // today only

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `The Odds API returned ${res.status}`);
  }

  const events = await res.json();
  if (!Array.isArray(events)) return [];

  return events.map(ev => extractOdds(ev, sportKey));
}

/**
 * fetchOddsForSports(sportKeys)
 *
 * Fetches odds for multiple sports in parallel.
 * Returns { [sport]: game[] } — sports that fail are silently skipped.
 */
export async function fetchOddsForSports(sportKeys = ['mlb', 'nba', 'nhl', 'nfl']) {
  const results = await Promise.allSettled(
    sportKeys.map(async sp => ({ sport: sp, games: await fetchOddsForSport(sp) }))
  );

  const map = {};
  for (const r of results) {
    if (r.status === 'fulfilled') {
      map[r.value.sport] = r.value.games;
    }
  }
  return map;
}

/**
 * buildOddsLookup(oddsMap)
 *
 * Builds a team-name → odds object for fast lookup during game list merging.
 * Keys are normalized team names (lowercase, spaces replaced with _).
 *
 * @param {Object} oddsMap - result of fetchOddsForSports()
 * @returns {Object} lookup[normalizedHomeName] = gameOdds
 */
export function buildOddsLookup(oddsMap) {
  const lookup = {};
  for (const games of Object.values(oddsMap)) {
    for (const g of games) {
      const key = normalize(g.home);
      lookup[key] = g;
    }
  }
  return lookup;
}

/**
 * mergeOddsIntoGameList(gameList, oddsLookup)
 *
 * Enriches a game list (built from ESPN scoreboard) with real bookmaker odds.
 * Matches by home team name — exact first, then "last word" abbreviation match.
 *
 * @param {Array} gameList  - array of { home, away, mlHome, mlAway, spread, total, ... }
 * @param {Object} lookup   - result of buildOddsLookup()
 * @returns {Array}          - same array, odds fields overwritten where real data exists
 */
export function mergeOddsIntoGameList(gameList, lookup) {
  return gameList.map(game => {
    const realOdds = findMatch(game.home, game.away, lookup);
    if (!realOdds) return game;

    return {
      ...game,
      mlHome:  realOdds.mlHome  ?? game.mlHome,
      mlAway:  realOdds.mlAway  ?? game.mlAway,
      spread:  realOdds.spreadHome != null
        ? `${realOdds.home} ${realOdds.spreadHomePoint >= 0 ? '+' : ''}${realOdds.spreadHomePoint}`
        : game.spread,
      total:   realOdds.total   ?? game.total,
      overOdds:  realOdds.overOdds,
      underOdds: realOdds.underOdds,
      oddsSource: 'the-odds-api',
    };
  });
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function normalize(name = '') {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function findMatch(home, away, lookup) {
  // 1. Exact home team match
  const exact = lookup[normalize(home)];
  if (exact) return exact;

  // 2. Partial match — check if any lookup key contains the last word of the home team
  const lastWord = home.split(' ').pop().toLowerCase();
  const partialKey = Object.keys(lookup).find(k => k.includes(lastWord));
  if (partialKey) return lookup[partialKey];

  // 3. Try matching by away team in case home/away is flipped
  const awayWord = away.split(' ').pop().toLowerCase();
  const awayKey = Object.keys(lookup).find(k => {
    const g = lookup[k];
    return normalize(g.away).includes(awayWord);
  });
  if (awayKey) return lookup[awayKey];

  return null;
}

function pickBestBookmaker(bookmakers = []) {
  // Prefer FanDuel or DraftKings; fall back to first available
  return bookmakers.find(b => b.key === 'fanduel')
      || bookmakers.find(b => b.key === 'draftkings')
      || bookmakers[0]
      || null;
}

function extractOdds(ev, sportKey) {
  const book = pickBestBookmaker(ev.bookmakers || []);
  const markets = book?.markets || [];

  const h2h      = markets.find(m => m.key === 'h2h');
  const spreads  = markets.find(m => m.key === 'spreads');
  const totals   = markets.find(m => m.key === 'totals');

  // Moneyline
  const mlHome = h2h?.outcomes?.find(o => o.name === ev.home_team)?.price ?? null;
  const mlAway = h2h?.outcomes?.find(o => o.name === ev.away_team)?.price ?? null;

  // Spread
  const sHome = spreads?.outcomes?.find(o => o.name === ev.home_team);
  const sAway = spreads?.outcomes?.find(o => o.name === ev.away_team);
  const spreadHome      = sHome?.price ?? null;
  const spreadHomePoint = sHome?.point ?? null;
  const spreadAway      = sAway?.price ?? null;
  const spreadAwayPoint = sAway?.point ?? null;

  // Total (game total — pick the standard line close to -110)
  const totalOutcomes = totals?.outcomes || [];
  const over  = totalOutcomes.find(o => o.name === 'Over');
  const under = totalOutcomes.find(o => o.name === 'Under');
  const total    = over?.point ?? null;
  const overOdds  = over?.price  ?? null;
  const underOdds = under?.price ?? null;

  const homeAbbr = ev.home_team.split(' ').pop();
  const awayAbbr = ev.away_team.split(' ').pop();

  return {
    id:      ev.id,
    sport:   sportKey.toUpperCase(),
    emoji:   SPORT_EMOJI[sportKey] || '🏆',
    home:    ev.home_team,
    away:    ev.away_team,
    matchup: `${awayAbbr} @ ${homeAbbr}`,
    mlHome, mlAway,
    spreadHome, spreadHomePoint,
    spreadAway, spreadAwayPoint,
    total, overOdds, underOdds,
    commenceTime: ev.commence_time,
    status: 'Scheduled',
    bookmaker: book?.title || 'Unknown',
  };
}
