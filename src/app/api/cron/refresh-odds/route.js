/**
 * /api/cron/refresh-odds — Centralized odds cache refresh
 *
 * Runs every 2 minutes (vercel.json). This is the ONLY route that calls The Odds API
 * for full game slates. All other endpoints (odds, scoreboard, pregenerate) read from
 * the odds_cache Supabase table instead.
 *
 * Smart refresh schedule (per sport):
 *  - Live games present:     refresh every 90 sec (every cron run at 2-min cadence)
 *  - < 1 hr to first pitch:  refresh every 3 min
 *  - > 1 hr to first pitch:  refresh every 12 min
 *  - All post-game:          skip entirely
 *  - Empty cache:            always refresh
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const THE_ODDS_KEY  = process.env.THE_ODDS_API_KEY?.trim();
const THE_ODDS_BASE = 'https://api.the-odds-api.com/v4';

const ACTIVE_SPORTS = ['mlb', 'nba', 'nhl', 'mls', 'nfl'];

const SPORT_KEYS = {
  mlb: 'baseball_mlb',
  nba: 'basketball_nba',
  nhl: 'icehockey_nhl',
  nfl: 'americanfootball_nfl',
  mls: 'soccer_usa_mls',
};

// Thresholds — how old the cache can be before triggering a re-fetch
const LIVE_TTL_MS    = 90_000;        // 90 sec for live games
const NEAR_TTL_MS    = 3 * 60_000;    // 3 min when game < 1 hr away
const DEFAULT_TTL_MS = 12 * 60_000;   // 12 min for regular pre-game

// ── Pinnacle (free sharp reference line) ──────────────────────────────────────
const PINNACLE_BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';

const PINNACLE_LEAGUE_IDS = {
  nba: 487, nfl: 889, mlb: 246, nhl: 1456, mls: 2764,
};

const PIN_HEADERS = {
  Accept:       'application/json',
  'User-Agent': 'Mozilla/5.0 BetOS/1.0',
};

function pinPriceToAmerican(price) {
  if (price == null) return null;
  if (price <= -100 || price >= 100) return price;
  if (price >= 2.0) return Math.round((price - 1) * 100);
  if (price > 1.0)  return Math.round(-100 / (price - 1));
  return null;
}

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

async function fetchPinnacleLines(sportKey) {
  const leagueId = PINNACLE_LEAGUE_IDS[sportKey];
  if (!leagueId) return null;

  try {
    const [matchupsRes, marketsRes] = await Promise.all([
      fetch(`${PINNACLE_BASE}/leagues/${leagueId}/matchups`, {
        headers: PIN_HEADERS, signal: AbortSignal.timeout(6000),
      }),
      fetch(`${PINNACLE_BASE}/leagues/${leagueId}/markets/straight`, {
        headers: PIN_HEADERS, signal: AbortSignal.timeout(6000),
      }),
    ]);
    if (!matchupsRes.ok || !marketsRes.ok) return null;

    const matchups = await matchupsRes.json();
    const markets  = await marketsRes.json();
    if (!Array.isArray(matchups) || !Array.isArray(markets)) return null;

    const matchupMap = {};
    for (const m of matchups) {
      if (m.special) continue;
      const home = m.participants?.find(p => p.alignment === 'home')?.name;
      const away = m.participants?.find(p => p.alignment === 'away')?.name;
      if (home && away) matchupMap[m.id] = { home, away };
    }

    const oddsMap = {};
    for (const mkt of markets) {
      const mid = mkt.matchupId;
      if (!matchupMap[mid]) continue;
      if (!oddsMap[mid]) oddsMap[mid] = {};

      const prices = mkt.prices || [];
      if (mkt.type === 'moneyline') {
        if (!oddsMap[mid].ml) {
          const h = prices.find(p => p.designation === 'home');
          const a = prices.find(p => p.designation === 'away');
          if (h && a) {
            const hP = pinPriceToAmerican(h.price);
            const aP = pinPriceToAmerican(a.price);
            if (hP != null && aP != null && (hP < 0) !== (aP < 0)) {
              oddsMap[mid].ml = { home: hP, away: aP };
            }
          }
        }
      } else if (mkt.type === 'spread') {
        const h = prices.find(p => p.designation === 'home');
        const a = prices.find(p => p.designation === 'away');
        if (h && a && h.points != null) {
          const hP = pinPriceToAmerican(h.price);
          const aP = pinPriceToAmerican(a.price);
          if (hP != null && aP != null) {
            const juiceScore = Math.abs(Math.abs(hP) - 110) + Math.abs(Math.abs(aP) - 110);
            if (!oddsMap[mid].spread || juiceScore < oddsMap[mid].spread._juiceScore) {
              oddsMap[mid].spread = { homePoint: h.points, homePrice: hP, awayPoint: a.points, awayPrice: aP, _juiceScore: juiceScore };
            }
          }
        }
      } else if (mkt.type === 'total') {
        const ov = prices.find(p => p.designation === 'over');
        const un = prices.find(p => p.designation === 'under');
        if (ov && un && ov.points != null) {
          const ovP = pinPriceToAmerican(ov.price);
          const unP = pinPriceToAmerican(un.price);
          if (ovP != null && unP != null) {
            const juiceScore = Math.abs(Math.abs(ovP) - 110) + Math.abs(Math.abs(unP) - 110);
            if (!oddsMap[mid].total || juiceScore < oddsMap[mid].total._juiceScore) {
              oddsMap[mid].total = { point: ov.points, overPrice: ovP, underPrice: unP, _juiceScore: juiceScore };
            }
          }
        }
      }
    }

    return Object.entries(oddsMap)
      .filter(([, o]) => o.ml)
      .map(([id, odds]) => ({ matchupId: parseInt(id), ...matchupMap[parseInt(id)], ...odds }));
  } catch (err) {
    console.warn('[refresh-odds] Pinnacle fetch failed (non-fatal):', err.message);
    return null;
  }
}

function enrichWithPinnacle(events, pinnacleGames) {
  if (!Array.isArray(pinnacleGames) || !pinnacleGames.length) return events;

  return events.map(event => {
    const pg = pinnacleGames.find(g =>
      teamsMatch(event.home_team, g.home) && teamsMatch(event.away_team, g.away)
    );
    if (!pg) return event;

    const pinBook = {
      key: 'pinnacle', title: 'Pinnacle ⚡',
      last_update: new Date().toISOString(), markets: [],
    };
    if (pg.ml) {
      const homeNeg = pg.ml.home < 0, awayNeg = pg.ml.away < 0;
      if (homeNeg !== awayNeg) {
        pinBook.markets.push({ key: 'h2h', outcomes: [
          { name: event.home_team, price: pg.ml.home },
          { name: event.away_team, price: pg.ml.away },
        ]});
      }
    }
    if (pg.spread) {
      pinBook.markets.push({ key: 'spreads', outcomes: [
        { name: event.home_team, price: pg.spread.homePrice, point: pg.spread.homePoint },
        { name: event.away_team, price: pg.spread.awayPrice, point: pg.spread.awayPoint },
      ]});
    }
    if (pg.total) {
      pinBook.markets.push({ key: 'totals', outcomes: [
        { name: 'Over',  price: pg.total.overPrice,  point: pg.total.point },
        { name: 'Under', price: pg.total.underPrice, point: pg.total.point },
      ]});
    }

    let suspectOdds = false;
    if (pg.ml) {
      for (const bm of (event.bookmakers || [])) {
        const h2h = bm.markets?.find(m => m.key === 'h2h');
        if (!h2h) continue;
        const bookHome = h2h.outcomes?.find(o => teamsMatch(o.name, event.home_team))?.price;
        if (bookHome != null && Math.abs(bookHome - pg.ml.home) > 15) { suspectOdds = true; break; }
      }
    }

    return {
      ...event,
      bookmakers: [...(event.bookmakers || []), pinBook],
      pinnacle:   { ml: pg.ml, spread: pg.spread ?? null, total: pg.total ?? null },
      suspectOdds,
    };
  });
}

function sanitizeOddsConsistency(events) {
  if (!Array.isArray(events)) return events;
  return events.map(event => {
    const bookmakers = event.bookmakers?.map(bk => {
      const h2h     = bk.markets?.find(m => m.key === 'h2h');
      const spreads = bk.markets?.find(m => m.key === 'spreads');
      if (!h2h || !spreads) return bk;

      const homeMLOut  = h2h.outcomes?.find(o => o.name === event.home_team);
      const awayMLOut  = h2h.outcomes?.find(o => o.name === event.away_team);
      const homeSprOut = spreads.outcomes?.find(o => o.name === event.home_team);
      const awaySprOut = spreads.outcomes?.find(o => o.name === event.away_team);
      if (!homeMLOut?.price || !awayMLOut?.price || !homeSprOut?.price || !awaySprOut?.price) return bk;

      let invalid = false;
      if (awaySprOut.point > 0  && awaySprOut.price > awayMLOut.price + 15) invalid = true;
      if (awaySprOut.point < 0  && awaySprOut.price < awayMLOut.price - 15) invalid = true;
      if (homeSprOut.point > 0  && homeSprOut.price > homeMLOut.price + 15) invalid = true;
      if (homeSprOut.point < 0  && homeSprOut.price < homeMLOut.price - 15) invalid = true;

      if (invalid) {
        console.warn(`[refresh-odds] Removing inconsistent spread for ${bk.title} on ${event.away_team}@${event.home_team}`);
        return { ...bk, markets: bk.markets.filter(m => m.key !== 'spreads'), _spreadRemoved: 'inconsistent_with_ml' };
      }
      return bk;
    });
    return { ...event, bookmakers };
  });
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function fetchSportOdds(sport) {
  const apiSportKey = SPORT_KEYS[sport];
  if (!apiSportKey) throw new Error(`Unknown sport: ${sport}`);

  const url = new URL(`${THE_ODDS_BASE}/sports/${apiSportKey}/odds/`);
  url.searchParams.set('apiKey', THE_ODDS_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'h2h,spreads,totals');
  url.searchParams.set('oddsFormat', 'american');
  // Include games up to 12 hrs in the past (live/recently started) and 2 days ahead
  const from = new Date(Date.now() - 12 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const to   = new Date(Date.now() + 2 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  url.searchParams.set('commenceTimeFrom', from);
  url.searchParams.set('commenceTimeTo',   to);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `The Odds API HTTP ${res.status}`);
  }

  const events = await res.json();
  if (!Array.isArray(events)) throw new Error('Unexpected response shape');
  return events;
}

// Derive game status from commence_time (The Odds API main endpoint doesn't flag live state)
// Games are typically: MLB ~3hr, NBA ~2.5hr, NHL ~2.5hr, NFL ~3.5hr, MLS ~2hr
// Using 5hr window to safely cover all sports + overtime
function deriveStatus(commenceTime) {
  const now   = Date.now();
  const start = new Date(commenceTime).getTime();
  if (start > now + 2 * 60_000) return 'pre';    // hasn't started (2-min buffer)
  if (start > now - 5 * 3600_000) return 'live';  // started < 5 hrs ago = probably live
  return 'post';
}

// ── Smart scheduling ──────────────────────────────────────────────────────────

async function getSportCacheState(sport) {
  const { data: rows, error } = await supabase
    .from('odds_cache')
    .select('game_status, commence_time, last_fetched_at')
    .eq('sport', sport)
    .order('last_fetched_at', { ascending: false })
    .limit(50);

  if (error) console.warn(`[refresh-odds] Cache state query error for ${sport}:`, error.message);
  return rows || [];
}

// Returns threshold ms (cache must be older than this to trigger refresh),
// or null meaning "all games are done, skip this sport".
function getRefreshThreshold(games) {
  if (!games.length) return 0; // empty cache → always refresh

  const now = Date.now();
  const hasLive = games.some(g => g.game_status === 'live');
  if (hasLive) return LIVE_TTL_MS;

  const preGames = games.filter(g => g.game_status === 'pre');
  if (!preGames.length) return null; // all post — skip

  let minMsToStart = Infinity;
  for (const g of preGames) {
    const ms = new Date(g.commence_time).getTime() - now;
    if (ms > 0 && ms < minMsToStart) minMsToStart = ms;
  }

  return minMsToStart < 3600_000 ? NEAR_TTL_MS : DEFAULT_TTL_MS;
}

// ── Upsert enriched games into odds_cache ─────────────────────────────────────

async function upsertGames(sport, events) {
  const now = new Date().toISOString();
  const rows = events.map(ev => ({
    sport,
    game_id:        ev.id,
    home_team:      ev.home_team,
    away_team:      ev.away_team,
    commence_time:  ev.commence_time,
    game_status:    deriveStatus(ev.commence_time),
    odds_data: {
      bookmakers:  ev.bookmakers  || [],
      sport_title: ev.sport_title || '',
      pinnacle:    ev.pinnacle    || null,
      suspectOdds: ev.suspectOdds || false,
    },
    last_fetched_at: now,
  }));

  const { error } = await supabase
    .from('odds_cache')
    .upsert(rows, { onConflict: 'sport,game_id' });

  if (error) throw new Error(`DB upsert failed: ${error.message}`);
  return rows.length;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req) {
  // Fail-closed: CRON_SECRET must be set
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!THE_ODDS_KEY) {
    return NextResponse.json({ error: 'THE_ODDS_API_KEY not configured' }, { status: 503 });
  }

  const results = [];
  const now = Date.now();

  for (const sport of ACTIVE_SPORTS) {
    try {
      const games     = await getSportCacheState(sport);
      const threshold = getRefreshThreshold(games);

      if (threshold === null) {
        results.push({ sport, action: 'skip', reason: 'all post-game' });
        continue;
      }

      // Find the most recent fetch time across all cached games for this sport
      const latestFetch = games.length
        ? Math.max(...games.map(g => new Date(g.last_fetched_at).getTime()))
        : 0;
      const ageMs = now - latestFetch;

      if (ageMs < threshold) {
        results.push({ sport, action: 'skip', reason: `fresh (${Math.round(ageMs / 1000)}s old, threshold ${threshold / 1000}s)` });
        continue;
      }

      // Fetch from The Odds API + Pinnacle in parallel
      const [oddsResult, pinnacleResult] = await Promise.allSettled([
        fetchSportOdds(sport),
        fetchPinnacleLines(sport),
      ]);

      if (oddsResult.status !== 'fulfilled') {
        throw new Error(oddsResult.reason?.message || 'Odds API call failed');
      }

      let events = oddsResult.value;
      events = sanitizeOddsConsistency(events);

      const pinnacleGames = pinnacleResult.status === 'fulfilled' ? pinnacleResult.value : null;
      if (pinnacleResult.status !== 'fulfilled') {
        console.warn(`[refresh-odds] Pinnacle unavailable for ${sport}:`, pinnacleResult.reason?.message);
      }
      events = enrichWithPinnacle(events, pinnacleGames);

      const stored = await upsertGames(sport, events);

      results.push({
        sport,
        action:    'fetched',
        games:     stored,
        pinnacle:  !!pinnacleGames,
        ageWas:    `${Math.round(ageMs / 1000)}s`,
      });

    } catch (err) {
      console.error(`[refresh-odds] Failed for ${sport}:`, err.message);
      results.push({ sport, action: 'error', error: err.message });
    }
  }

  const fetched = results.filter(r => r.action === 'fetched').length;
  const skipped = results.filter(r => r.action === 'skip').length;
  console.log(`[refresh-odds] Done — fetched ${fetched} sports, skipped ${skipped}`);

  return NextResponse.json({
    ok:      true,
    ts:      new Date().toISOString(),
    fetched,
    skipped,
    results,
  });
}
