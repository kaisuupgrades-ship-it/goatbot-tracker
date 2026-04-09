/**
 * /api/cron/refresh-odds — Centralized odds cache refresh
 *
 * Runs every 15 minutes (vercel.json). This is the ONLY route that calls The Odds API
 * for full game slates. All other endpoints (odds, scoreboard, pregenerate) read from
 * the odds_cache Supabase table instead.
 *
 * Credit budget math (The Odds API):
 *  - Proximity TTL means most of the day games are >6h out → polled only ~2-3×/day/sport
 *  - Final hour before tip-off: 12-min TTL → ~5 polls/sport
 *  - Typical evening-game day: ~12 polls × 4 sports × 2 markets = ~96 credits/day
 *  - Off-peak skip (midnight–8am ET) eliminates overnight waste entirely
 *  - Monthly budget: 20K credits → 200+ days at current rate
 *  - TODO: revert to 3 markets (add totals back) after migrating to OddsPapi (unlimited)
 *
 * Smart refresh schedule (per sport):
 *  - Pre-match only:           commenceTimeFrom = now - 5min (live odds paused — v2 feature)
 *  - Off-peak (0–8am ET):      skip entirely (return early)
 *  - Shoulder (8–11am,         proximity TTLs ×1.8
 *    10pm–midnight ET):
 *  - Peak (11am–10pm ET):      proximity TTLs as-is:
 *      > 48h out → 6h TTL      (lines flat this far out)
 *      12–48h   → 2h TTL
 *       3–12h   → 60min TTL
 *       1–3h    → 25min TTL   (active movement window)
 *       < 1h    → 12min TTL   (final steam / closing line)
 *  - All post-game:            skip entirely
 *  - No games today:           skip (ESPN check)
 *  - Empty cache:              always refresh
 *  - Deduplication:            skip if cache < 10 min old
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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

// TODO: LIVE_TTL_MS dormant while pre-match-only mode is active (commenceTimeFrom = now - 5min).
// Re-enable (and restore 12h lookback) when live in-play odds come back (v2).
const LIVE_TTL_MS  = 90_000; // 90 sec for live games (dormant)

// Proximity-based TTL for pre-match games — lines barely move far out, sharps
// bet heavily in the final hour. Tighter TTL only when it actually matters.
//   > 48 h → 6 h      (2+ days out: lines essentially flat)
//   12–48 h → 2 h     (tomorrow's games: modest movement)
//    3–12 h → 60 min  (sharps start sizing positions)
//    1–3 h  → 25 min  (active line movement window)
//     < 1 h → 12 min  (final steam / closing line)
function proximityTtl(msToStart) {
  if (msToStart > 48 * 3600_000) return  6 * 3600_000;
  if (msToStart > 12 * 3600_000) return  2 * 3600_000;
  if (msToStart >  3 * 3600_000) return 60 *   60_000;
  if (msToStart >      3600_000) return 25 *   60_000;
  return 12 * 60_000;
}

// Deduplication guard — never re-fetch a sport if its cache is this fresh.
// Protects against Vercel retry storms / accidental double-fires.
const DEDUP_TTL_MS = 10 * 60_000;  // 10 min hard floor regardless of game state

// NFL in-season months (1-indexed): Sept (9) through Feb (2) — skip otherwise to save credits
const NFL_SEASON_MONTHS = new Set([9, 10, 11, 12, 1, 2]);

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

// ── Games-today check (ESPN, free) ────────────────────────────────────────────

const ESPN_SPORT_PATH = {
  mlb: 'baseball/mlb',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
  nfl: 'football/nfl',
  mls: 'soccer/usa.1',
};

/**
 * Returns true if ESPN reports at least one game for this sport today (UTC date).
 * Falls back to true on error so we don't accidentally suppress a real game day.
 */
async function hasGamesToday(sport) {
  const path = ESPN_SPORT_PATH[sport];
  if (!path) return true; // unknown sport — fail open

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${today}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return true; // ESPN unavailable — fail open
    const data = await res.json();
    const events = data?.events ?? data?.games ?? [];
    return Array.isArray(events) && events.length > 0;
  } catch {
    return true; // network error — fail open
  }
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function fetchSportOdds(sport) {
  const apiSportKey = SPORT_KEYS[sport];
  if (!apiSportKey) throw new Error(`Unknown sport: ${sport}`);

  const url = new URL(`${THE_ODDS_BASE}/sports/${apiSportKey}/odds/`);
  url.searchParams.set('apiKey', THE_ODDS_KEY);
  url.searchParams.set('regions', 'us');
  // TODO: add totals back (3rd market) after migrating to OddsPapi (unlimited credits)
  url.searchParams.set('markets', 'h2h,spreads');
  url.searchParams.set('oddsFormat', 'american');
  // Pre-match only — live in-play odds are paused (v2 feature). A 5-min lookback buffer
  // catches games whose commence_time just ticked past now without missing their final pre-match line.
  // TODO: restore commenceTimeFrom to now - 12h when live in-play odds are re-enabled.
  const from = new Date(Date.now() -  5 *   60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const to   = new Date(Date.now() + 48 * 3600_000).toISOString().replace(/\.\d{3}Z$/, 'Z'); // 48h — no value in caching lines further out
  url.searchParams.set('commenceTimeFrom', from);
  url.searchParams.set('commenceTimeTo',   to);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = res.status === 401 ? 'invalid API key'
      : res.status === 403 ? 'quota exhausted or key forbidden'
      : res.status === 429 ? 'rate limited'
      : res.status >= 500 ? 'server error'
      : 'request error';
    throw new Error(`The Odds API HTTP ${res.status} (${detail})${err?.message ? `: ${err.message}` : ''}`);
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

// Returns threshold ms (cache must be older than this to trigger a re-fetch),
// or null meaning "all games are done, skip this sport entirely".
//
// shoulderMultiplier > 1 stretches all TTLs during low-traffic hours so we
// poll less without changing the proximity-based logic.
function getRefreshThreshold(games, shoulderMultiplier = 1) {
  if (!games.length) return 0; // empty cache → always refresh

  const now = Date.now();
  const hasLive = games.some(g => g.game_status === 'live');
  if (hasLive) return LIVE_TTL_MS; // dormant in pre-match-only mode

  const preGames = games.filter(g => g.game_status === 'pre');
  if (!preGames.length) return null; // all post — skip

  // The soonest game drives the TTL — it's the one whose line is moving most.
  let minTtl = Infinity;
  for (const g of preGames) {
    const msToStart = Math.max(0, new Date(g.commence_time).getTime() - now);
    const ttl = proximityTtl(msToStart);
    if (ttl < minTtl) minTtl = ttl;
  }

  return Math.round(minTtl * shoulderMultiplier);
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

  // ── Time-of-day throttle (US Eastern) ────────────────────────────────────────
  // Vercel Intl is fully timezone-aware; this handles EDT/EST transitions automatically.
  // TODO: revisit thresholds when live odds are re-enabled and/or API plan upgraded to $119/mo tier.
  const etHour = parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false })
  );

  // Off-peak: midnight–8am ET — US users are asleep; skip entirely (~32% credit savings)
  if (etHour < 8) {
    console.log(`[refresh-odds] Off-peak ET (${etHour}:xx) — skipping refresh to save credits`);
    return NextResponse.json({ ok: true, skipped: true, reason: 'off-peak-ET', etHour });
  }

  // Shoulder: 8–11am ET and 10pm–midnight ET — stretch all proximity TTLs by ×1.8
  // Peak:     11am–10pm ET — use proximity TTLs as-is (multiplier = 1)
  const isShoulderHour = etHour < 11 || etHour >= 22;
  const shoulderMultiplier = isShoulderHour ? 1.8 : 1;
  if (isShoulderHour) {
    console.log(`[refresh-odds] Shoulder ET (${etHour}:xx) — proximity TTLs ×1.8`);
  }

  const results = [];
  const now = Date.now();

  const currentMonth = new Date().getUTCMonth() + 1; // 1-indexed

  for (const sport of ACTIVE_SPORTS) {
    try {
      // Skip NFL when out of season — no games Sept-Feb means no credits wasted
      if (sport === 'nfl' && !NFL_SEASON_MONTHS.has(currentMonth)) {
        results.push({ sport, action: 'skip', reason: 'NFL out of season' });
        continue;
      }

      // Check ESPN for games today before touching The Odds API
      const gamesExist = await hasGamesToday(sport);
      if (!gamesExist) {
        results.push({ sport, action: 'skip', reason: 'no games today (ESPN)' });
        continue;
      }

      const games     = await getSportCacheState(sport);
      const threshold = getRefreshThreshold(games, shoulderMultiplier);

      if (threshold === null) {
        results.push({ sport, action: 'skip', reason: 'all post-game' });
        continue;
      }

      // Find the most recent fetch time across all cached games for this sport
      const latestFetch = games.length
        ? Math.max(...games.map(g => new Date(g.last_fetched_at).getTime()))
        : 0;
      const ageMs = now - latestFetch;

      // Deduplication guard: never hit the API if cache is under 10 min old,
      // regardless of game state — protects against Vercel retry storms
      if (ageMs < DEDUP_TTL_MS) {
        results.push({ sport, action: 'skip', reason: `dedup (${Math.round(ageMs / 1000)}s old, floor ${DEDUP_TTL_MS / 1000}s)` });
        continue;
      }

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
        const errMsg = oddsResult.reason?.message || 'Odds API call failed';
        const isAuth    = errMsg.includes('401') || errMsg.includes('403');
        const isRate    = errMsg.includes('429');
        const isNetwork = errMsg.toLowerCase().includes('timeout') || errMsg.toLowerCase().includes('network') || errMsg.toLowerCase().includes('fetch');
        if (isAuth) {
          console.error(`[refresh-odds] ❌ ${sport}: Odds API auth/quota error — ${errMsg}. Existing cache preserved; downstream will serve stale data.`);
        } else if (isRate) {
          console.warn(`[refresh-odds] ⚠️ ${sport}: Odds API rate limited — ${errMsg}. Existing cache preserved.`);
        } else if (isNetwork) {
          console.warn(`[refresh-odds] ⚠️ ${sport}: Network/timeout error — ${errMsg}. Existing cache preserved.`);
        } else {
          console.error(`[refresh-odds] ❌ ${sport}: Odds API error — ${errMsg}. Existing cache preserved.`);
        }
        results.push({ sport, action: 'error', error: errMsg, cachePreserved: true });
        continue;
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
