/**
 * Shared odds utility — The Odds API (the-odds-api.com)
 *
 * Returns all today's games + bookmaker odds in one API call per sport.
 * American odds format natively — no conversion math needed.
 * Free tier: 500 requests/month (each call to this module = 1 request).
 *
 * Also exports shared validators and helpers used across all consumers:
 *   validML, validSpreadJuice, validTotal, americanToDecimal,
 *   calcParlayOdds, bestBookmakerOdds, SPORT_KEY_MAP, formatOdds
 */

const THE_ODDS_API_KEY  = process.env.THE_ODDS_API_KEY;
const THE_ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

// Map our internal sport keys → The Odds API sport keys
export const SPORT_KEY_MAP = {
  mlb:   'baseball_mlb',
  nba:   'basketball_nba',
  nhl:   'icehockey_nhl',
  nfl:   'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  ncaab: 'basketball_ncaab',
  mls:   'soccer_usa_mls',
  ufc:   'mma_mixed_martial_arts',
};

// Legacy alias — keep old name working for existing callers
const SPORT_KEYS = SPORT_KEY_MAP;

const SPORT_EMOJI = {
  mlb: '⚾', nba: '🏀', nhl: '🏒', nfl: '🏈',
  ncaaf: '🏈', ncaab: '🏀', mls: '⚽', ufc: '🥊',
};

// ── Preferred book order for all market lookups ───────────────────────────────
const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm'];

// ── Price validators ──────────────────────────────────────────────────────────

/**
 * Valid moneyline price: absolute value between 100 and 1500.
 * Rejects futures prices, alt-lines, and data errors.
 */
export function validML(price) {
  return price != null && Math.abs(price) >= 100 && Math.abs(price) <= 1500;
}

/**
 * Valid spread juice: absolute value between 100 and 300.
 * Standard spread juice is -110; anything beyond ±300 is noise.
 */
export function validSpreadJuice(price) {
  return price != null && Math.abs(price) >= 100 && Math.abs(price) <= 300;
}

/**
 * Valid game total (over/under line point) for a given Odds API sport key.
 * Rejects lines outside the realistic range for each sport.
 *
 * Sport-specific ranges (inclusive):
 *   baseball_mlb            [1, 30]    typical game total 6.5–11
 *   basketball_nba          [170, 260] typical total 215–235
 *   icehockey_nhl           [1, 15]    typical total 5.5–6.5
 *   americanfootball_nfl    [20, 80]   typical total 43–49
 *   soccer_usa_mls          [0, 10]    typical total 2.5–3.5
 *
 * @param {number|null} point  - the over/under line value
 * @param {string}      sportKey - Odds API sport key (e.g. 'baseball_mlb')
 */
export function validTotal(point, sportKey) {
  if (point == null) return false;
  const ranges = {
    baseball_mlb:           [1,   30],
    basketball_nba:         [170, 260],
    icehockey_nhl:          [1,   15],
    americanfootball_nfl:   [20,  80],
    americanfootball_ncaaf: [25,  85],
    basketball_ncaab:       [100, 180],
    soccer_usa_mls:         [0,   10],
  };
  const [lo, hi] = ranges[sportKey] || [1, 300];
  return point >= lo && point <= hi;
}

// ── Odds math ─────────────────────────────────────────────────────────────────

/**
 * Convert American ML odds to decimal.
 * Returns null (not 1) for null / NaN / zero — callers must handle null.
 *
 * -150 → 1.67,  +130 → 2.30
 */
export function americanToDecimal(american) {
  const n = parseInt(american);
  if (isNaN(n) || n === 0) return null;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}

/**
 * Calculate combined American odds for a parlay.
 * Returns null if ANY leg has null/invalid odds — can't price an incomplete parlay.
 *
 * @param {Array<{odds: number|null}>} legs
 * @returns {number|null}
 */
export function calcParlayOdds(legs) {
  if (!legs || !legs.length) return null;
  let combined = 1;
  for (const leg of legs) {
    const d = americanToDecimal(leg.odds);
    if (d === null) return null; // any null leg → null result
    combined *= d;
  }
  // decimal → American
  if (combined <= 1) return -10000;
  if (combined >= 2) return Math.round((combined - 1) * 100);
  return Math.round(-100 / (combined - 1));
}

/**
 * Format American odds for display: -150 → '-150', +130 → '+130'.
 */
export function formatOdds(price) {
  if (price == null || isNaN(price)) return '—';
  return price > 0 ? `+${price}` : `${price}`;
}

// ── Bookmaker scanning ────────────────────────────────────────────────────────

/**
 * Return the best price for a given market + side from the priority book list.
 *
 * @param {Array}  bookmakers  - bookmaker array from Odds API event
 * @param {string} market      - market key: 'h2h' | 'spreads' | 'totals'
 * @param {string} side        - outcome name to match (team name, 'Over', 'Under')
 * @returns {number|null}
 */
export function bestBookmakerOdds(bookmakers, market, side) {
  const sorted = sortByPriority(bookmakers);
  for (const bk of sorted) {
    const mkt = bk.markets?.find(m => m.key === market);
    const outcome = mkt?.outcomes?.find(o => o.name === side);
    if (outcome?.price != null) return outcome.price;
  }
  return null;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

export function sortByPriority(bookmakers = []) {
  return [...bookmakers].sort((a, b) => {
    const ai = BOOK_PRIORITY.indexOf(a.key);
    const bi = BOOK_PRIORITY.indexOf(b.key);
    return (ai >= 0 ? ai : BOOK_PRIORITY.length) - (bi >= 0 ? bi : BOOK_PRIORITY.length);
  });
}

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
  // Prefer DraftKings, FanDuel; fall back to first available
  return bookmakers.find(b => b.key === 'draftkings')
      || bookmakers.find(b => b.key === 'fanduel')
      || bookmakers.find(b => b.key === 'betmgm')
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

  // Totals are disabled at the API level — fields are kept in the return shape for compatibility
  // but always resolve to null. Re-enable by passing markets=totals to The Odds API fetch.
  const total = null, overOdds = null, underOdds = null;
  void totals; // suppress unused-variable lint warning

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

// ── Public API fetch helpers ──────────────────────────────────────────────────

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
