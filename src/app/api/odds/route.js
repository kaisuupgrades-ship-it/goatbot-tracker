import { NextResponse } from 'next/server';

const ODDS_API_KEY  = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.odds-api.io/v3';

// odds-api.io sport slug + league slug for each of our sport keys
const SPORT_MAP = {
  mlb:   { sport: 'baseball',           leagueSlug: 'usa-mlb' },
  nfl:   { sport: 'american-football',  leagueSlug: 'usa-nfl' },
  nba:   { sport: 'basketball',         leagueSlug: 'usa-nba' },
  nhl:   { sport: 'ice-hockey',         leagueSlug: 'usa-nhl' },
  ncaaf: { sport: 'american-football',  leagueSlug: null },  // shows all college football
  ncaab: { sport: 'basketball',         leagueSlug: null },  // shows all college basketball
  mls:   { sport: 'football',           leagueSlug: 'usa-mls' },
  ufc:   { sport: 'mixed-martial-arts', leagueSlug: null },
};

// Free plan: max 2 bookmakers
const BOOKS = 'FanDuel,DraftKings';

// odds-api.io market names → our keys
const MARKET_KEY_MAP = {
  'ML':           'h2h',
  'Moneyline':    'h2h',
  'Spread':       'spreads',
  'AH':           'spreads',
  'Handicap':     'spreads',
  'Total':        'totals',
  'OU':           'totals',
  'Over/Under':   'totals',
};

// In-memory cache — 3 min TTL
const cache = new Map();
const CACHE_TTL = 3 * 60 * 1000;

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.time > CACHE_TTL) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data) {
  cache.set(key, { data, time: Date.now() });
}

// Convert decimal odds (e.g. "2.12") to American odds integer
function decimalToAmerican(decimal) {
  const d = parseFloat(decimal);
  if (!d || d <= 1) return null;
  if (d >= 2) return Math.round((d - 1) * 100);
  return Math.round(-100 / (d - 1));
}

// Convert a single event + its odds response into the format OddsTab expects
function normalizeEvent(ev, oddsData) {
  const bookmakers_obj = oddsData?.bookmakers || {};

  const bookmakers = Object.entries(bookmakers_obj).map(([bookName, markets]) => {
    const normalizedMarkets = (markets || []).map(mkt => {
      const key = MARKET_KEY_MAP[mkt.name] || mkt.name.toLowerCase();
      // Use the first odds line (main line)
      const firstOdds = (mkt.odds || [])[0] || {};
      let outcomes = [];

      if (key === 'h2h') {
        if (firstOdds.home != null) outcomes.push({ name: ev.home, price: decimalToAmerican(firstOdds.home) });
        if (firstOdds.away != null) outcomes.push({ name: ev.away, price: decimalToAmerican(firstOdds.away) });
      } else if (key === 'spreads') {
        const hdp = firstOdds.hdp ?? 0;
        if (firstOdds.home != null) outcomes.push({ name: ev.home, price: decimalToAmerican(firstOdds.home), point: -hdp });
        if (firstOdds.away != null) outcomes.push({ name: ev.away, price: decimalToAmerican(firstOdds.away), point: hdp });
      } else if (key === 'totals') {
        const total = firstOdds.hdp ?? firstOdds.total ?? null;
        if (firstOdds.over != null)  outcomes.push({ name: 'Over',  price: decimalToAmerican(firstOdds.over),  point: total });
        if (firstOdds.under != null) outcomes.push({ name: 'Under', price: decimalToAmerican(firstOdds.under), point: total });
      } else {
        // Generic fallback
        if (firstOdds.home != null) outcomes.push({ name: ev.home, price: decimalToAmerican(firstOdds.home) });
        if (firstOdds.away != null) outcomes.push({ name: ev.away, price: decimalToAmerican(firstOdds.away) });
      }

      return { key, outcomes };
    });

    return {
      key:         bookName.toLowerCase().replace(/[^a-z0-9]/g, ''),
      title:       bookName,
      last_update: markets[0]?.updatedAt || null,
      markets:     normalizedMarkets,
    };
  });

  return {
    id:           ev.id,
    home_team:    ev.home,
    away_team:    ev.away,
    commence_time: ev.date,
    sport_title:  ev.league?.name || '',
    status:       ev.status,
    bookmakers,
  };
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sportKey = searchParams.get('sport') || 'mlb';
  const market   = searchParams.get('market') || 'h2h';

  if (!ODDS_API_KEY) {
    return NextResponse.json({
      error: 'ODDS_API_KEY not configured',
      hint: 'Add ODDS_API_KEY to .env.local',
      configured: false,
    }, { status: 200 });
  }

  // 'all' or any market = same data (we always return all markets); normalize cache key
  const cacheKey = `${sportKey}-all`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  const config = SPORT_MAP[sportKey] || { sport: sportKey, leagueSlug: null };

  try {
    // Step 1: Fetch all events for this sport
    const eventsUrl = `${ODDS_API_BASE}/events?sport=${config.sport}&apiKey=${ODDS_API_KEY}`;
    const eventsRes = await fetch(eventsUrl, { next: { revalidate: 0 } });

    if (!eventsRes.ok) {
      const err = await eventsRes.json().catch(() => ({}));
      return NextResponse.json({
        error: err.error || `Events fetch failed (HTTP ${eventsRes.status})`,
        hint: 'Check your ODDS_API_KEY',
        configured: true,
      }, { status: eventsRes.status });
    }

    let events = await eventsRes.json();
    if (!Array.isArray(events)) events = events.data || [];

    // Filter by league slug if specified (e.g. 'usa-mlb')
    if (config.leagueSlug) {
      events = events.filter(e => e.league?.slug === config.leagueSlug);
    }

    // Only upcoming + live games
    events = events.filter(e => e.status === 'pending' || e.status === 'live');

    // Sort by start time, take first 10
    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    const topEvents = events.slice(0, 10);

    if (topEvents.length === 0) {
      const result = { data: [], configured: true, sport: config.sport, total: 0 };
      setCache(cacheKey, result);
      return NextResponse.json(result);
    }

    // Step 2: Fetch odds for each event concurrently (2 books max on free plan)
    const oddsResults = await Promise.allSettled(
      topEvents.map(async (ev) => {
        const url = `${ODDS_API_BASE}/odds?eventId=${ev.id}&bookmakers=${BOOKS}&apiKey=${ODDS_API_KEY}`;
        const res = await fetch(url, { next: { revalidate: 0 } });
        if (!res.ok) return { id: ev.id, data: null };
        const data = await res.json();
        return { id: ev.id, data };
      })
    );

    // Build odds map
    const oddsMap = {};
    oddsResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value) {
        oddsMap[r.value.id] = r.value.data;
      }
    });

    const normalized = topEvents.map(ev => normalizeEvent(ev, oddsMap[ev.id]));
    const result = {
      data:       normalized,
      configured: true,
      sport:      config.sport,
      total:      events.length,
    };
    setCache(cacheKey, result);
    return NextResponse.json(result);

  } catch (err) {
    return NextResponse.json({ error: err.message, configured: true }, { status: 500 });
  }
}
