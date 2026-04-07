/**
 * /api/odds — Live bookmaker odds
 *
 * Primary:  The Odds API (the-odds-api.com) — all games + all markets in ONE call
 * Fallback: odds-api.io (legacy, requires per-event calls)
 *
 * Used by: OddsTab (UI display), TrendsTab (client-side scan enrichment),
 *          BetSlipModal (quick-bet pre-fill via ScoreboardTab)
 *
 * Response shape (same for both sources):
 * {
 *   data: [{ id, home_team, away_team, commence_time, sport_title, bookmakers[] }],
 *   configured: bool, sport: string, total: number, cached: bool, source: string
 * }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 15;

// ── Supabase persistent cache (shared across ALL serverless instances) ──────────
// The in-memory Map was useless on Vercel — each cold start got a fresh empty
// cache, so every request hit The Odds API. Supabase acts as a global L2 cache.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// L2: Supabase TTL — 10 min during off-peak, 2 min during likely game windows
// With 20K plan we can afford faster refresh (~300 calls/day at 2min during 10h game window)
function getOddsCacheTTL() {
  const hour = new Date().getUTCHours(); // UTC
  // US game windows: ~17:00–04:00 UTC (noon–midnight ET)
  const isGameWindow = hour >= 17 || hour <= 4;
  return isGameWindow ? 2 * 60 * 1000 : 10 * 60 * 1000;
}

async function getSupabaseCache(sportKey) {
  try {
    const { data } = await supabase
      .from('settings')
      .select('value, updated_at')
      .eq('key', `odds_cache_${sportKey}`)
      .single();
    if (!data?.value) return null;
    const ageMs = Date.now() - new Date(data.updated_at).getTime();
    if (ageMs > getOddsCacheTTL()) return null; // stale
    const payload = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    return payload;
  } catch { return null; }
}

async function setSupabaseCache(sportKey, result) {
  try {
    await supabase.from('settings').upsert(
      [{ key: `odds_cache_${sportKey}`, value: JSON.stringify(result) }],
      { onConflict: 'key' }
    );
  } catch { /* cache write failure is non-fatal */ }
}

// L1: In-process memory cache (warm instances only — keeps latency low when
// the same serverless instance handles back-to-back requests within 5 min)
const memCache = new Map();
const MEM_TTL  = 2 * 60 * 1000; // 2 min — matches L2 game-window TTL

function getMemCache(key) {
  const e = memCache.get(key);
  if (!e || Date.now() - e.time > MEM_TTL) { memCache.delete(key); return null; }
  return e.data;
}
function setMemCache(key, data) { memCache.set(key, { data, time: Date.now() }); }

// ── Config ─────────────────────────────────────────────────────────────────────
const THE_ODDS_KEY  = process.env.THE_ODDS_API_KEY;
const LEGACY_KEY    = process.env.ODDS_API_KEY;        // odds-api.io (fallback only)

const THE_ODDS_BASE = 'https://api.the-odds-api.com/v4';
const LEGACY_BASE   = 'https://api.odds-api.io/v3';

// The Odds API sport keys
const SPORT_KEYS = {
  mlb:   'baseball_mlb',
  nfl:   'americanfootball_nfl',
  nba:   'basketball_nba',
  nhl:   'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
  ncaab: 'basketball_ncaab',
  mls:   'soccer_usa_mls',
  ufc:   'mma_mixed_martial_arts',
};

// Legacy odds-api.io sport slugs (fallback only)
const LEGACY_SPORT_MAP = {
  mlb:   { sport: 'baseball',           leagueSlug: 'usa-mlb' },
  nfl:   { sport: 'american-football',  leagueSlug: 'usa-nfl' },
  nba:   { sport: 'basketball',         leagueSlug: 'usa-nba' },
  nhl:   { sport: 'ice-hockey',         leagueSlug: 'usa-nhl' },
  ncaaf: { sport: 'american-football',  leagueSlug: null },
  ncaab: { sport: 'basketball',         leagueSlug: null },
  mls:   { sport: 'football',           leagueSlug: 'usa-mls' },
  ufc:   { sport: 'mixed-martial-arts', leagueSlug: null },
};

const LEGACY_MARKET_MAP = {
  ML: 'h2h', Moneyline: 'h2h', Spread: 'spreads', AH: 'spreads',
  Handicap: 'spreads', Total: 'totals', OU: 'totals', 'Over/Under': 'totals',
};


// ── Pinnacle (free, no key — sharpest book in the world) ─────────────────────
// Guest API: https://guest.api.arcadia.pinnacle.com/0.1
// No auth required. Used as a reality-check against The Odds API lines.
// Any game where a US book's ML is >15 pts off Pinnacle gets flagged suspectOdds=true.

const PINNACLE_BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';

const PINNACLE_LEAGUE_IDS = {
  nba:   487,
  nfl:   889,
  mlb:   246,
  nhl:   1456,
  ncaab: 493,
  ncaaf: 880,
  mls:   2764,
  ufc:   906,
};

const PIN_HEADERS = {
  'Accept':          'application/json',
  'User-Agent':      'Mozilla/5.0 BetOS/1.0',
};

// Pinnacle's guest API returns prices in DECIMAL (European) format.
// American odds are ≥ +100 or ≤ -100. Any price between -99 and +99
// that isn't 0 is almost certainly decimal — convert it.
function pinPriceToAmerican(price) {
  if (price == null) return null;
  // Already American format (≤ -100 or ≥ +100)
  if (price <= -100 || price >= 100) return price;
  // Decimal odds: favorite < 2.0, underdog >= 2.0
  if (price >= 2.0) return Math.round((price - 1) * 100);   // e.g. 2.94 → +194
  if (price > 1.0)  return Math.round(-100 / (price - 1));   // e.g. 1.34 → -294
  return null; // invalid
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
  // Last word is usually the mascot — strongest signal
  const lastA = wordsA[wordsA.length - 1], lastB = wordsB[wordsB.length - 1];
  if (lastA && lastA === lastB && lastA.length > 3) return true;
  // Also check if one name contains the other's last word (e.g. "LA Lakers" vs "Los Angeles Lakers")
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

    // Build matchupId → teams
    const matchupMap = {};
    for (const m of matchups) {
      if (m.special) continue;
      const home = m.participants?.find(p => p.alignment === 'home')?.name;
      const away = m.participants?.find(p => p.alignment === 'away')?.name;
      if (home && away) matchupMap[m.id] = { home, away };
    }

    // Build matchupId → odds
    const oddsMap = {};
    for (const mkt of markets) {
      const mid = mkt.matchupId;
      if (!matchupMap[mid]) continue;
      if (!oddsMap[mid]) oddsMap[mid] = {};

      const prices = mkt.prices || [];
      if (mkt.type === 'moneyline') {
        // First-wins: standard game ML comes first; later entries are alternate/live variants
        if (!oddsMap[mid].ml) {
          const h = prices.find(p => p.designation === 'home');
          const a = prices.find(p => p.designation === 'away');
          if (h && a) {
            const hP = pinPriceToAmerican(h.price);
            const aP = pinPriceToAmerican(a.price);
            if (hP != null && aP != null) {
              // After conversion, one side must be negative (favorite) and the other positive
              const homeNeg = hP < 0, awayNeg = aP < 0;
              if (homeNeg !== awayNeg) {
                oddsMap[mid].ml = { home: hP, away: aP };
              }
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
            // Select the spread line whose juice is closest to standard (-110).
            // This avoids alt lines like -1.5 (-909) in NBA.
            const juiceScore = Math.abs(Math.abs(hP) - 110) + Math.abs(Math.abs(aP) - 110);
            if (!oddsMap[mid].spread) {
              oddsMap[mid].spread = { homePoint: h.points, homePrice: hP, awayPoint: a.points, awayPrice: aP, _juiceScore: juiceScore };
            } else if (juiceScore < oddsMap[mid].spread._juiceScore) {
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
            // Pick the total whose juice is CLOSEST to standard (-110 on both sides).
            const juiceScore = Math.abs(Math.abs(ovP) - 110) + Math.abs(Math.abs(unP) - 110);
            if (!oddsMap[mid].total || juiceScore < oddsMap[mid].total._juiceScore) {
              oddsMap[mid].total = { point: ov.points, overPrice: ovP, underPrice: unP, _juiceScore: juiceScore };
            }
          }
        }
      }
    }

    return Object.entries(oddsMap)
      .filter(([, o]) => o.ml) // only return games that have a ML
      .map(([id, odds]) => ({ matchupId: parseInt(id), ...matchupMap[parseInt(id)], ...odds }));
  } catch (err) {
    console.warn('[Pinnacle] fetch failed (non-fatal):', err.message);
    return null;
  }
}

function enrichWithPinnacle(events, pinnacleGames) {
  if (!Array.isArray(pinnacleGames) || pinnacleGames.length === 0) return events;

  return events.map(event => {
    // Find matching Pinnacle game by home+away team name similarity
    const pg = pinnacleGames.find(g =>
      teamsMatch(event.home_team, g.home) && teamsMatch(event.away_team, g.away)
    );
    if (!pg) return event;

    // Build Pinnacle as a bookmaker entry so UI can display it
    const pinBook = {
      key: 'pinnacle',
      title: 'Pinnacle ⚡',
      last_update: new Date().toISOString(),
      markets: [],
    };
    if (pg.ml) {
      // Only emit h2h if one side is negative (real sportsbook rule: one team must be favored)
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

    // Flag any book whose home ML is >15 pts off from Pinnacle
    let suspectOdds = false;
    if (pg.ml) {
      for (const bm of (event.bookmakers || [])) {
        const h2h = bm.markets?.find(m => m.key === 'h2h');
        if (!h2h) continue;
        const bookHome = h2h.outcomes?.find(o => teamsMatch(o.name, event.home_team))?.price;
        if (bookHome == null) continue;
        if (Math.abs(bookHome - pg.ml.home) > 15) { suspectOdds = true; break; }
      }
    }

    return {
      ...event,
      bookmakers:  [...(event.bookmakers || []), pinBook],
      pinnacle:    { ml: pg.ml, spread: pg.spread ?? null, total: pg.total ?? null },
      suspectOdds,
    };
  });
}

// ── ML vs Spread sanity check ─────────────────────────────────────────────────
// If a team is +1.5 (underdog on spread), their spread odds should be MORE negative
// (worse payout) than their ML — because getting 1.5 points makes them more likely to cover.
// If the spread shows BETTER odds than ML for the same direction, the data is stale/wrong.
// Similarly for -1.5 (favorite): their spread odds should be MORE positive than ML.
function sanitizeOddsConsistency(events) {
  if (!Array.isArray(events)) return events;

  return events.map(event => {
    const bookmakers = event.bookmakers?.map(bk => {
      const h2h     = bk.markets?.find(m => m.key === 'h2h');
      const spreads = bk.markets?.find(m => m.key === 'spreads');
      if (!h2h || !spreads) return bk;

      const homeMLOut = h2h.outcomes?.find(o => o.name === event.home_team);
      const awayMLOut = h2h.outcomes?.find(o => o.name === event.away_team);
      const homeSprOut = spreads.outcomes?.find(o => o.name === event.home_team);
      const awaySprOut = spreads.outcomes?.find(o => o.name === event.away_team);

      if (!homeMLOut?.price || !awayMLOut?.price || !homeSprOut?.price || !awaySprOut?.price) return bk;

      // Check each side: underdog getting +points should have worse odds than their ML
      let invalid = false;

      // Away team check
      if (awaySprOut.point > 0) {
        // Underdog getting points: spread odds should be worse (more negative) than ML
        if (awaySprOut.price > awayMLOut.price + 15) invalid = true;
      } else if (awaySprOut.point < 0) {
        // Favorite giving points: spread odds should be better (more positive) than ML
        if (awaySprOut.price < awayMLOut.price - 15) invalid = true;
      }

      // Home team check
      if (homeSprOut.point > 0) {
        if (homeSprOut.price > homeMLOut.price + 15) invalid = true;
      } else if (homeSprOut.point < 0) {
        if (homeSprOut.price < homeMLOut.price - 15) invalid = true;
      }

      if (invalid) {
        // Remove the inconsistent spread market from this bookmaker
        console.warn(`[odds] Inconsistent ML/spread for ${bk.title} on ${event.away_team} @ ${event.home_team}: ML=${awayMLOut.price}/${homeMLOut.price}, Spread=${awaySprOut.point}@${awaySprOut.price}/${homeSprOut.point}@${homeSprOut.price}`);
        return {
          ...bk,
          markets: bk.markets.filter(m => m.key !== 'spreads'),
          _spreadRemoved: 'inconsistent_with_ml',
        };
      }
      return bk;
    });

    return { ...event, bookmakers };
  });
}

// ── The Odds API (primary) ────────────────────────────────────────────────────
async function fetchFromTheOddsAPI(sportKey) {
  const apiKey = SPORT_KEYS[sportKey];
  if (!apiKey) throw new Error(`Unknown sport: ${sportKey}`);

  const url = new URL(`${THE_ODDS_BASE}/sports/${apiKey}/odds/`);
  url.searchParams.set('apiKey', THE_ODDS_KEY);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'h2h,spreads,totals');
  url.searchParams.set('oddsFormat', 'american');
  // commenceTimeFrom = 12 h ago so live/in-progress games (past commence_time) are included
  // commenceTimeTo   = 2 days from now to cover upcoming games
  const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const to   = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  url.searchParams.set('commenceTimeFrom', from);
  url.searchParams.set('commenceTimeTo',   to);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message || `The Odds API HTTP ${res.status}`);
  }

  // The Odds API returns data already in our expected shape — no transform needed
  const events = await res.json();
  if (!Array.isArray(events)) throw new Error('Unexpected response shape');

  return {
    data:       events,
    configured: true,
    sport:      apiKey,
    total:      events.length,
    source:     'the-odds-api',
  };
}

// ── Legacy fallback: odds-api.io ──────────────────────────────────────────────
function decimalToAmerican(decimal) {
  const d = parseFloat(decimal);
  if (!d || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}

function normalizeLegacyEvent(ev, oddsData) {
  const bookmakers = Object.entries(oddsData?.bookmakers || {}).map(([name, markets]) => ({
    key:         name.toLowerCase().replace(/[^a-z0-9]/g, ''),
    title:       name,
    last_update: markets[0]?.updatedAt || null,
    markets:     (markets || []).map(mkt => {
      const key     = LEGACY_MARKET_MAP[mkt.name] || mkt.name.toLowerCase();
      const allOdds = mkt.odds || [];
      let outcomes  = [];

      if (key === 'h2h') {
        const line = allOdds[0] || {};
        if (line.home != null) outcomes.push({ name: ev.home, price: decimalToAmerican(line.home) });
        if (line.away != null) outcomes.push({ name: ev.away, price: decimalToAmerican(line.away) });
      } else if (key === 'spreads') {
        const line = allOdds[0] || {};
        const hdp  = line.hdp ?? 0;
        if (line.home != null) outcomes.push({ name: ev.home, price: decimalToAmerican(line.home), point: -hdp });
        if (line.away != null) outcomes.push({ name: ev.away, price: decimalToAmerican(line.away), point:  hdp });
      } else if (key === 'totals') {
        const standard = allOdds.find(o => {
          const ov = decimalToAmerican(o.over);
          const un = decimalToAmerican(o.under);
          return ov != null && un != null && ov >= -135 && ov <= 120 && un >= -135 && un <= 120;
        }) || allOdds[allOdds.length - 1] || {};
        const total = standard.hdp ?? standard.total ?? null;
        if (standard.over  != null) outcomes.push({ name: 'Over',  price: decimalToAmerican(standard.over),  point: total });
        if (standard.under != null) outcomes.push({ name: 'Under', price: decimalToAmerican(standard.under), point: total });
      }
      return { key, outcomes };
    }),
  }));

  return {
    id:            ev.id,
    home_team:     ev.home,
    away_team:     ev.away,
    commence_time: ev.date,
    sport_title:   ev.league?.name || '',
    bookmakers,
  };
}

async function fetchFromLegacy(sportKey) {
  const config = LEGACY_SPORT_MAP[sportKey];
  if (!config) throw new Error(`Unknown sport: ${sportKey}`);

  const eventsRes = await fetch(
    `${LEGACY_BASE}/events?sport=${config.sport}&apiKey=${LEGACY_KEY}`,
    { signal: AbortSignal.timeout(10000) }
  );
  if (!eventsRes.ok) throw new Error(`odds-api.io HTTP ${eventsRes.status}`);

  let events = await eventsRes.json();
  if (!Array.isArray(events)) events = events.data || [];
  if (config.leagueSlug) events = events.filter(e => e.league?.slug === config.leagueSlug);
  events = events.filter(e => e.status === 'pending' || e.status === 'live');
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  const top = events.slice(0, 10);

  if (top.length === 0) return { data: [], configured: true, sport: config.sport, total: 0, source: 'legacy' };

  const oddsResults = await Promise.allSettled(
    top.map(async ev => {
      const res = await fetch(
        `${LEGACY_BASE}/odds?eventId=${ev.id}&bookmakers=FanDuel,DraftKings&apiKey=${LEGACY_KEY}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return { id: ev.id, data: null };
      return { id: ev.id, data: await res.json() };
    })
  );

  const oddsMap = {};
  oddsResults.forEach(r => { if (r.status === 'fulfilled' && r.value) oddsMap[r.value.id] = r.value.data; });

  return {
    data:       top.map(ev => normalizeLegacyEvent(ev, oddsMap[ev.id])),
    configured: true,
    sport:      config.sport,
    total:      events.length,
    source:     'legacy',
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sportKey = (searchParams.get('sport') || 'mlb').toLowerCase();

  // ?live=1 — called by ScoreboardTab when in-play games are active.
  // Bypasses normal cache, uses a 30-second TTL matching The Odds API update frequency.
  // This costs quota but live odds are moving fast — stale data causes logical impossibilities.
  const isLive = searchParams.get('live') === '1';

  if (!THE_ODDS_KEY && !LEGACY_KEY) {
    return NextResponse.json({
      error: 'No odds API key configured',
      hint: 'Add THE_ODDS_API_KEY (the-odds-api.com) to env vars',
      configured: false,
      data: [],
    }, { status: 200 });
  }

  // Live path: use a separate short-TTL cache so live requests don't pollute pre-game cache
  const cacheKey = isLive ? `${sportKey}_live` : sportKey;
  const LIVE_TTL = 30 * 1000; // 30s — matches The Odds API live update frequency

  // L1 memory cache check
  const memHit = getMemCache(cacheKey);
  if (memHit) {
    // For live requests, respect the tighter 30s TTL within the L1 entry
    if (!isLive || (Date.now() - (memCache.get(cacheKey)?.time || 0)) < LIVE_TTL) {
      return NextResponse.json({ ...memHit, cached: true, liveMode: isLive });
    }
  }

  // L2: Supabase persistent cache (skip for live requests — too slow for 30s window)
  if (!isLive) {
    const sbHit = await getSupabaseCache(sportKey);
    if (sbHit) {
      setMemCache(cacheKey, sbHit); // warm L1 for this instance
      return NextResponse.json({ ...sbHit, cached: true });
    }
  }

  // Cache miss (or live bypass) — fetch live data
  // Try The Odds API + Pinnacle in parallel (Pinnacle is free, adds sharp reference line)
  if (THE_ODDS_KEY) {
    try {
      const [result, pinnacleResult] = await Promise.allSettled([
        fetchFromTheOddsAPI(sportKey),
        fetchPinnacleLines(sportKey),   // free, no key — silently skipped if it fails
      ]);
      if (result.status !== 'fulfilled') throw new Error(result.reason?.message || 'The Odds API failed');
      const oddsResult = result.value;
      const pinnacleGames = pinnacleResult.status === 'fulfilled' ? pinnacleResult.value : null;
      const pinnacleUnavailable = pinnacleResult.status !== 'fulfilled';
      if (pinnacleUnavailable) console.warn('[/api/odds] Pinnacle unavailable:', pinnacleResult.reason?.message);
      // Enrich each event with Pinnacle line + suspectOdds flag
      if (oddsResult?.data) {
        oddsResult.data = sanitizeOddsConsistency(oddsResult.data);
        oddsResult.data = enrichWithPinnacle(oddsResult.data, pinnacleGames);
      }
      oddsResult.pinnacleConnected = Array.isArray(pinnacleGames) && pinnacleGames.length > 0;
      oddsResult.pinnacleUnavailable = pinnacleUnavailable;
      // Only cache if we got actual data back (0 games is valid off-season, errors are not)
      if (oddsResult?.data?.length >= 0) {
        setMemCache(cacheKey, oddsResult);
        await setSupabaseCache(sportKey, oddsResult);
      }
      return NextResponse.json({ ...oddsResult, cached: false });
    } catch (err) {
      console.warn('[/api/odds] The Odds API failed, trying legacy:', err.message);
    }
  }

  // Fallback: odds-api.io (+ Pinnacle still runs in parallel)
  if (LEGACY_KEY) {
    try {
      const [legacyResult, pinnacleResult] = await Promise.allSettled([
        fetchFromLegacy(sportKey),
        fetchPinnacleLines(sportKey),
      ]);
      if (legacyResult.status !== 'fulfilled') throw new Error(legacyResult.reason?.message || 'Legacy API failed');
      const result = legacyResult.value;
      const pinnacleGames = pinnacleResult.status === 'fulfilled' ? pinnacleResult.value : null;
      if (pinnacleResult.status !== 'fulfilled') console.warn('[/api/odds] Pinnacle unavailable (legacy path):', pinnacleResult.reason?.message);
      if (result?.data) {
        result.data = sanitizeOddsConsistency(result.data);
        result.data = enrichWithPinnacle(result.data, pinnacleGames);
      }
      result.pinnacleConnected = Array.isArray(pinnacleGames) && pinnacleGames.length > 0;
      result.pinnacleUnavailable = pinnacleResult.status !== 'fulfilled';
      if (result?.data?.length > 0) {
        setMemCache(cacheKey, result);
        await setSupabaseCache(sportKey, result);
      }
      return NextResponse.json({ ...result, cached: false });
    } catch (err) {
      console.error('[/api/odds] Both odds providers failed:', err.message);
      return NextResponse.json({
        configured: true, data: [], total: 0, source: 'none', cached: false,
        error: true, message: 'Odds data temporarily unavailable',
      }, { status: 503 });
    }
  }

  return NextResponse.json({ configured: false, data: [], total: 0, source: 'none', cached: false });
}