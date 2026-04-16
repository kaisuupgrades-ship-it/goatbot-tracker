import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { teamsMatch } from '@/lib/teamNormalizer';
import { requireAuth } from '@/lib/auth';

export const maxDuration = 15;

const THE_ODDS_KEY  = process.env.THE_ODDS_API_KEY?.trim();
const THE_ODDS_BASE = 'https://api.the-odds-api.com/v4';

// Supabase shared props cache — prevents multiple cold Vercel instances from each
// burning 5-14 credits for the same game's props within a short window.
// Keyed by props_cache_{sport}_{eventId} in the settings table. TTL: 15 minutes.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);
const SUPABASE_PROPS_TTL = 15 * 60_000; // 15 min

async function getPropsCache(sport, eventId) {
  try {
    const { data } = await supabase
      .from('settings')
      .select('value, updated_at')
      .eq('key', `props_cache_${sport}_${eventId}`)
      .single();
    if (!data?.value) return null;
    if (Date.now() - new Date(data.updated_at).getTime() > SUPABASE_PROPS_TTL) return null;
    return typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
  } catch { return null; }
}

async function setPropsCache(sport, eventId, result) {
  try {
    await supabase.from('settings').upsert(
      [{ key: `props_cache_${sport}_${eventId}`, value: JSON.stringify(result) }],
      { onConflict: 'key' }
    );
  } catch { /* cache write failure is non-fatal */ }
}

// The Odds API sport keys
const SPORT_KEYS = {
  mlb:   'baseball_mlb',
  nfl:   'americanfootball_nfl',
  nba:   'basketball_nba',
  nhl:   'icehockey_nhl',
  ncaaf: 'americanfootball_ncaaf',
  ncaab: 'basketball_ncaab',
};

// Per-sport prop market keys available in The Odds API, grouped into display categories.
// Each entry: { label, markets: [api_market_key, ...] }
const SPORT_PROP_MARKETS = {
  nfl: [
    { label: 'Passing',   markets: ['player_pass_yds', 'player_pass_tds', 'player_pass_completions', 'player_pass_attempts', 'player_pass_interceptions'] },
    { label: 'Rushing',   markets: ['player_rush_yds', 'player_rush_attempts', 'player_rush_tds'] },
    { label: 'Receiving', markets: ['player_reception_yds', 'player_receptions', 'player_receiving_tds'] },
    { label: 'Defense',   markets: ['player_sacks', 'player_solo_tackles'] },
    { label: 'Scorer',    markets: ['player_anytime_td', 'player_first_td'] },
  ],
  nba: [
    { label: 'Scoring',   markets: ['player_points'] },
    { label: 'Boards',    markets: ['player_rebounds'] },
    { label: 'Assists',   markets: ['player_assists'] },
    { label: 'Defense',   markets: ['player_steals', 'player_blocks'] },
    { label: '3-Pointers',markets: ['player_threes'] },
    { label: 'Combos',    markets: ['player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists', 'player_rebounds_assists'] },
  ],
  mlb: [
    { label: 'Pitching',  markets: ['pitcher_strikeouts', 'pitcher_hits_allowed', 'pitcher_walks', 'pitcher_earned_runs', 'pitcher_outs'] },
    { label: 'Hitting',   markets: ['batter_hits', 'batter_total_bases', 'batter_rbis', 'batter_home_runs', 'batter_runs_scored', 'batter_stolen_bases'] },
  ],
  nhl: [
    { label: 'Scoring',   markets: ['player_goals', 'player_assists', 'player_points'] },
    { label: 'Shots',     markets: ['player_shots_on_goal', 'player_blocked_shots'] },
  ],
  ncaaf: [
    { label: 'Passing',   markets: ['player_pass_yds', 'player_pass_tds', 'player_pass_completions'] },
    { label: 'Rushing',   markets: ['player_rush_yds', 'player_rush_tds'] },
    { label: 'Receiving', markets: ['player_reception_yds', 'player_receptions'] },
  ],
  ncaab: [
    { label: 'Scoring',   markets: ['player_points'] },
    { label: 'Boards',    markets: ['player_rebounds'] },
    { label: 'Assists',   markets: ['player_assists'] },
    { label: '3-Pointers',markets: ['player_threes'] },
  ],
};

// Human-readable labels for market keys
const MARKET_LABELS = {
  player_pass_yds:               'Passing Yards',
  player_pass_tds:               'Passing TDs',
  player_pass_completions:       'Completions',
  player_pass_attempts:          'Pass Attempts',
  player_pass_interceptions:     'Interceptions',
  player_rush_yds:               'Rushing Yards',
  player_rush_attempts:          'Rush Attempts',
  player_rush_tds:               'Rushing TDs',
  player_reception_yds:          'Receiving Yards',
  player_receptions:             'Receptions',
  player_receiving_tds:          'Receiving TDs',
  player_sacks:                  'Sacks',
  player_solo_tackles:           'Tackles',
  player_anytime_td:             'Anytime TD',
  player_first_td:               'First TD Scorer',
  player_points:                 'Points',
  player_rebounds:               'Rebounds',
  player_assists:                'Assists',
  player_steals:                 'Steals',
  player_blocks:                 'Blocks',
  player_threes:                 'Threes Made',
  player_points_rebounds_assists:'Pts+Reb+Ast',
  player_points_rebounds:        'Pts+Reb',
  player_points_assists:         'Pts+Ast',
  player_rebounds_assists:       'Reb+Ast',
  pitcher_strikeouts:            'Strikeouts',
  pitcher_hits_allowed:          'Hits Allowed',
  pitcher_walks:                 'Walks',
  pitcher_earned_runs:           'Earned Runs',
  pitcher_outs:                  'Pitcher Outs',
  batter_hits:                   'Hits',
  batter_total_bases:            'Total Bases',
  batter_rbis:                   'RBIs',
  batter_home_runs:              'Home Runs',
  batter_runs_scored:            'Runs Scored',
  batter_stolen_bases:           'Stolen Bases',
  player_goals:                  'Goals',
  player_shots_on_goal:          'Shots on Goal',
  player_blocked_shots:          'Blocked Shots',
};

// Simple in-memory cache — props don't change often pre-game
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

function getCached(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.time > CACHE_TTL) { cache.delete(key); return null; }
  return e.data;
}
function setCache(key, data) { cache.set(key, { data, time: Date.now() }); }

// Fetch event ID from The Odds API by matching home/away team names.
// Used as fallback when ESPN doesn't have odds_api_event_id for an event.
async function resolveEventId(sportKey, homeTeam, awayTeam) {
  try {
    const url = new URL(`${THE_ODDS_BASE}/sports/${sportKey}/events`);
    url.searchParams.set('apiKey', THE_ODDS_KEY);
    url.searchParams.set('dateFormat', 'iso');
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const events = await res.json();
    if (!Array.isArray(events)) return null;
    const match = events.find(ev =>
      teamsMatch(ev.home_team, homeTeam) && teamsMatch(ev.away_team, awayTeam)
    );
    return match?.id || null;
  } catch { return null; }
}

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const sport     = searchParams.get('sport');     // e.g. 'nfl'
  let   eventId   = searchParams.get('eventId');   // The Odds API event UUID (may be empty)
  const homeTeam  = searchParams.get('homeTeam');  // fallback: home team display name
  const awayTeam  = searchParams.get('awayTeam');  // fallback: away team display name

  if (!sport) {
    return NextResponse.json({ error: 'sport required' }, { status: 400 });
  }

  const sportKey = SPORT_KEYS[sport];
  if (!sportKey) {
    return NextResponse.json({ props: [], categories: [], note: 'Props not available for this sport' });
  }

  if (!THE_ODDS_KEY) {
    return NextResponse.json({ props: [], categories: [], note: 'THE_ODDS_API_KEY not configured' });
  }

  // Event ID resolution — happy path: use the eventId the client passed (ESPN
  // tags its events with odds_api_event_id from the /scores match). Only hit
  // the /events endpoint (which costs a credit) when we genuinely don't have
  // one. The downstream fetch below has its own retry-on-404 that will fall
  // back to team-name resolution if the ESPN-supplied id turns out stale.
  if (!eventId && homeTeam && awayTeam) {
    console.log(`[/api/props] No eventId for ${awayTeam} @ ${homeTeam} — attempting lookup by team name`);
    eventId = await resolveEventId(sportKey, homeTeam, awayTeam);
    if (eventId) {
      console.log(`[/api/props] Resolved eventId: ${eventId}`);
    } else {
      console.warn(`[/api/props] Could not resolve event for ${awayTeam} @ ${homeTeam}`);
      return NextResponse.json({
        props: [], categories: [],
        note: `Event not found for ${awayTeam} @ ${homeTeam} — props may not be available yet`,
      });
    }
  }

  if (!eventId) {
    return NextResponse.json({ error: 'eventId required (or provide homeTeam + awayTeam)' }, { status: 400 });
  }

  const cacheKey = `props_${sport}_${eventId}`;

  // L1: in-process memory cache (warm instances only)
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  // L2: Supabase shared cache — shared across all Vercel instances (15-min TTL)
  // Prevents cold-start duplicate calls: each market key = 1 credit, NFL = 14 credits/call
  const sbCached = await getPropsCache(sport, eventId);
  if (sbCached) {
    setCache(cacheKey, sbCached); // warm L1 for this instance
    return NextResponse.json({ ...sbCached, cached: true });
  }

  const groups = SPORT_PROP_MARKETS[sport] || [];
  // Flatten all market keys for this sport into a single comma-separated string
  const allMarkets = groups.flatMap(g => g.markets).join(',');
  if (!allMarkets) return NextResponse.json({ props: [], categories: [] });

  // Helper: fetch odds for a given eventId. Returns { ok: true, data } or
  // { ok: false, status, message }. Kept as a named step so the retry path
  // below can reuse it without duplicating the URL construction.
  async function fetchOddsForEvent(eid) {
    const url = new URL(`${THE_ODDS_BASE}/sports/${sportKey}/events/${eid}/odds`);
    url.searchParams.set('apiKey', THE_ODDS_KEY);
    url.searchParams.set('regions', 'us');
    url.searchParams.set('markets', allMarkets);
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('bookmakers', 'draftkings,fanduel,betmgm');
    const reqUrl = url.toString();
    console.log('[/api/props] Fetching:', reqUrl.replace(THE_ODDS_KEY, '***'));
    const res = await fetch(reqUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      return { ok: false, status: res.status, message: errBody?.message || `HTTP ${res.status}` };
    }
    return { ok: true, data: await res.json() };
  }

  try {
    // Primary fetch + optional retry-on-stale-id rolled into a single const
    // assignment via IIFE. Named `oddsResponse` (not `result`) to avoid
    // colliding with the `const result = { categories, ... }` declaration
    // further down in this block — a same-scope redeclaration is the real
    // reason the build was failing (SWC phrases it as "cannot reassign to
    // a variable declared with const" / "result redefined here", which
    // reads like a reassignment error but is actually a TDZ collision).
    //
    // Retry semantics: The Odds API sometimes reissues an event's id on
    // postponement/reschedule. ESPN's scoreboard can carry the old id for
    // hours. If the primary fetch 404s and we have team names, re-resolve
    // via /events and retry once. Cache key stays keyed on the original
    // client-supplied id — future requests arriving with the same stale id
    // hit warm cache instead of re-re-resolving.
    const oddsResponse = await (async () => {
      const primary = await fetchOddsForEvent(eventId);
      if (primary.ok) return primary;

      const looksStale = primary.status === 404 || /not found/i.test(primary.message);
      if (!looksStale || !homeTeam || !awayTeam) return primary;

      console.warn(`[/api/props] Primary fetch failed (${primary.status}) for ${awayTeam} @ ${homeTeam}; re-resolving eventId`);
      const freshId = await resolveEventId(sportKey, homeTeam, awayTeam);
      if (!freshId || freshId === eventId) return primary;

      console.log(`[/api/props] Retrying with resolved eventId ${freshId} (was ${eventId})`);
      return fetchOddsForEvent(freshId);
    })();

    if (!oddsResponse.ok) {
      console.error('[/api/props] Odds API error:', oddsResponse.status, oddsResponse.message, {
        sport, sportKey, eventId,
        keyPresent: !!THE_ODDS_KEY,
        keyLength: THE_ODDS_KEY?.length,
      });
      return NextResponse.json({ props: [], categories: [], note: oddsResponse.message });
    }

    const data = oddsResponse.data;
    const bookmakers = data?.bookmakers || [];

    // Collect all markets across bookmakers, prefer DraftKings → FanDuel → BetMGM
    // Build a map: marketKey → playerName → { line, overOdds, underOdds, book }
    const propMap = new Map(); // key: `${marketKey}:${playerName}`

    const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm'];
    // Process in reverse priority so highest-priority book overwrites lower ones
    for (const bookKey of [...BOOK_PRIORITY].reverse()) {
      const bk = bookmakers.find(b => b.key === bookKey);
      if (!bk) continue;

      for (const mkt of bk.markets || []) {
        const marketKey = mkt.key;
        const label = MARKET_LABELS[marketKey] || marketKey;

        // Group outcomes by player (description field)
        const byPlayer = new Map();
        for (const outcome of mkt.outcomes || []) {
          const player = outcome.description || outcome.name;
          const dir    = outcome.name?.toLowerCase(); // 'over' or 'under'
          const line   = outcome.point;
          const price  = outcome.price;
          if (!player || line == null || price == null) continue;

          if (!byPlayer.has(player)) byPlayer.set(player, { player, line, overOdds: null, underOdds: null });
          const entry = byPlayer.get(player);
          // Keep the most favourable line (books may vary slightly)
          entry.line = line;
          if (dir === 'over')  entry.overOdds  = price;
          if (dir === 'under') entry.underOdds = price;
        }

        for (const [player, data] of byPlayer) {
          const mapKey = `${marketKey}:${player}`;
          propMap.set(mapKey, {
            marketKey,
            label,
            player,
            line:      data.line,
            overOdds:  data.overOdds,
            underOdds: data.underOdds,
            book: bookKey,
          });
        }
      }
    }

    // Build categorised output using the group definitions
    const categories = groups.map(group => ({
      label:   group.label,
      markets: group.markets
        .map(mk => {
          // Collect all players for this market key
          const players = [];
          for (const [key, val] of propMap) {
            if (val.marketKey === mk) players.push(val);
          }
          if (!players.length) return null;
          // Sort by player name
          players.sort((a, b) => a.player.localeCompare(b.player));
          return { key: mk, label: MARKET_LABELS[mk] || mk, players };
        })
        .filter(Boolean),
    })).filter(g => g.markets.length > 0);

    const result = { categories, total: propMap.size, eventId, sport };
    setCache(cacheKey, result);                          // L1: warm this instance
    setPropsCache(sport, eventId, result);               // L2: write shared Supabase cache
    return NextResponse.json({ ...result, cached: false });

  } catch (err) {
    console.error('[/api/props] Fetch failed:', err.message, { sport, eventId });
    return NextResponse.json({ props: [], categories: [], note: err.message });
  }
}
