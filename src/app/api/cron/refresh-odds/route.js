/**
 * /api/cron/refresh-odds
 *
 * Smart odds cache refresher — determines which games need fresh lines
 * based on proximity to game time and updates the odds_cache table.
 *
 * TTL tiers:
 *   Live (in progress):       90s   — always refresh on each 2-min run
 *   Pre-game < 1 hour:        3 min
 *   Pre-game 1–12 hours:      12 min
 *   Pre-game > 12 hours:      skip  (not needed soon enough)
 *   Post-game (completed):    skip  (never refresh)
 *
 * Schedule: every 2 min (see vercel.json)
 * Auth:     Bearer CRON_SECRET (fail-closed — 503 if unset)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const THE_ODDS_KEY  = process.env.THE_ODDS_API_KEY?.trim();
const THE_ODDS_BASE = 'https://api.the-odds-api.com/v4';

// Sports to monitor — The Odds API keys
const SPORT_KEYS = [
  'americanfootball_nfl',
  'basketball_nba',
  'baseball_mlb',
  'icehockey_nhl',
  'soccer_usa_mls',
];

// TTL constants (ms)
const TTL_LIVE          = 90  * 1000;        // 90 seconds
const TTL_PRE_IMMINENT  = 3   * 60 * 1000;   // 3 min  (< 1h to start)
const TTL_PRE_NORMAL    = 12  * 60 * 1000;   // 12 min (1–12h to start)
const MAX_PRE_LOOKAHEAD = 12  * 60 * 60 * 1000; // 12 h — skip games farther out
const MAX_LIVE_WINDOW   = 4   * 60 * 60 * 1000; // 4 h after kickoff → assume completed
const DISCOVERY_TTL     = 15  * 60 * 1000;   // re-check sports with no cached games every 15 min

// Low-quota circuit breaker: stop refreshing non-critical sports when running low
const QUOTA_WARN_THRESHOLD = 50; // remaining API calls

/**
 * Returns the applicable TTL for a cached game row, or null if it should be skipped.
 * @param {{ commence_time: string, game_status: string, last_fetched_at: string }} game
 */
function getGameTTL(game) {
  const commence = new Date(game.commence_time).getTime();
  const now      = Date.now();
  const status   = game.game_status || '';

  // Skip any completed game
  if (['post', 'completed', 'STATUS_FINAL'].includes(status)) return null;

  // Explicit live status
  if (['in', 'live', 'STATUS_IN_PROGRESS'].includes(status)) return TTL_LIVE;

  const elapsed  = now - commence;
  const timeLeft = commence - now;

  if (elapsed > 0) {
    // Commenced in the past — no explicit live status yet
    if (elapsed > MAX_LIVE_WINDOW) return null; // assume it ended
    return TTL_LIVE;                             // assume still in progress
  }

  // Pre-game
  if (timeLeft > MAX_PRE_LOOKAHEAD) return null;   // too far out
  if (timeLeft < 60 * 60 * 1000)    return TTL_PRE_IMMINENT;
  return TTL_PRE_NORMAL;
}

/**
 * Infer game_status from commence_time when the API doesn't tell us directly.
 */
function inferStatus(commenceTimeISO) {
  const commence = new Date(commenceTimeISO).getTime();
  const elapsed  = Date.now() - commence;
  if (elapsed < 0)             return 'pre';
  if (elapsed < MAX_LIVE_WINDOW) return 'in';
  return 'post';
}

/**
 * Fetch all odds for a single sport key from The Odds API.
 * Returns { events, remaining, used }.
 */
async function fetchSportOdds(sportKey) {
  const url = new URL(`${THE_ODDS_BASE}/sports/${sportKey}/odds/`);
  url.searchParams.set('apiKey',          THE_ODDS_KEY);
  url.searchParams.set('regions',         'us');
  url.searchParams.set('markets',         'h2h,spreads,totals');
  url.searchParams.set('oddsFormat',      'american');

  // Include games that started up to 12 h ago (catches live/in-progress)
  const from = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const to   = new Date(Date.now() +  2 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  url.searchParams.set('commenceTimeFrom', from);
  url.searchParams.set('commenceTimeTo',   to);

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(12000) });

  const remaining = res.headers.get('x-requests-remaining');
  const used      = res.headers.get('x-requests-used');

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || `The Odds API HTTP ${res.status}`);
  }

  const events = await res.json();
  if (!Array.isArray(events)) throw new Error('Unexpected response shape from The Odds API');

  return {
    events,
    remaining: remaining != null ? parseInt(remaining, 10) : null,
    used:      used      != null ? parseInt(used,      10) : null,
  };
}

export async function GET(req) {
  // ── Auth: fail-closed CRON_SECRET ──────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!THE_ODDS_KEY) {
    return NextResponse.json({ error: 'THE_ODDS_API_KEY not configured' }, { status: 503 });
  }

  const runStarted  = Date.now();
  const runStartISO = new Date().toISOString();

  // ── Load all non-completed cached games ────────────────────────────────────
  const { data: cachedGames, error: cacheQueryError } = await supabase
    .from('odds_cache')
    .select('sport, game_id, commence_time, game_status, last_fetched_at')
    .not('game_status', 'in', '("post","completed","STATUS_FINAL")');

  if (cacheQueryError) {
    console.error('[refresh-odds] odds_cache query failed:', cacheQueryError.message);
    return NextResponse.json({ error: 'odds_cache query failed', details: cacheQueryError.message }, { status: 500 });
  }

  // ── Load per-sport discovery timestamps (for cold-start detection) ─────────
  const discoveryKeys = SPORT_KEYS.map(s => `refresh_odds_discovery_${s}`);
  const { data: discoveryRows } = await supabase
    .from('settings')
    .select('key, updated_at')
    .in('key', discoveryKeys);

  const discoveryMap = {};
  for (const row of (discoveryRows || [])) {
    const sport = row.key.replace('refresh_odds_discovery_', '');
    discoveryMap[sport] = new Date(row.updated_at).getTime();
  }

  // ── Determine which sports need a fetch ────────────────────────────────────
  const gamesBySport = {};
  for (const game of (cachedGames || [])) {
    if (!gamesBySport[game.sport]) gamesBySport[game.sport] = [];
    gamesBySport[game.sport].push(game);
  }

  const sportsToFetch = new Set();

  for (const sportKey of SPORT_KEYS) {
    const sportGames = gamesBySport[sportKey] || [];

    if (sportGames.length === 0) {
      // Cold start for this sport — fetch if discovery TTL has expired
      const lastDiscovery = discoveryMap[sportKey] || 0;
      if (Date.now() - lastDiscovery > DISCOVERY_TTL) {
        sportsToFetch.add(sportKey);
      }
      continue;
    }

    // Check if any game is past its TTL
    for (const game of sportGames) {
      const ttl = getGameTTL(game);
      if (ttl === null) continue; // skip post-game

      const age = Date.now() - new Date(game.last_fetched_at).getTime();
      if (age > ttl) {
        sportsToFetch.add(sportKey);
        break; // one stale game is enough to trigger the sport fetch
      }
    }
  }

  if (sportsToFetch.size === 0) {
    return NextResponse.json({
      ok:      true,
      message: 'All cached odds are within TTL — nothing to refresh',
      elapsed: Date.now() - runStarted,
    });
  }

  // ── Fetch fresh odds for each stale sport ──────────────────────────────────
  const results       = [];
  let totalUpserted   = 0;
  let apiRemaining    = null;
  let quotaLow        = false;

  for (const sportKey of sportsToFetch) {
    // Circuit breaker: skip non-live sports when quota is running low
    if (quotaLow) {
      const hasLive = (gamesBySport[sportKey] || []).some(g =>
        ['in', 'live', 'STATUS_IN_PROGRESS'].includes(g.game_status) ||
        (new Date(g.commence_time).getTime() < Date.now() &&
         Date.now() - new Date(g.commence_time).getTime() < MAX_LIVE_WINDOW)
      );
      if (!hasLive) {
        results.push({ sport: sportKey, skipped: true, reason: 'quota_low' });
        continue;
      }
    }

    try {
      const { events, remaining, used } = await fetchSportOdds(sportKey);

      if (remaining != null) {
        apiRemaining = remaining;
        if (remaining < QUOTA_WARN_THRESHOLD) quotaLow = true;
      }

      const fetchedAt = new Date().toISOString();

      const upsertRows = events.map(event => ({
        sport:          sportKey,
        game_id:        event.id,
        home_team:      event.home_team,
        away_team:      event.away_team,
        commence_time:  event.commence_time,
        odds_data:      { bookmakers: event.bookmakers, sport_title: event.sport_title },
        game_status:    inferStatus(event.commence_time),
        last_fetched_at: fetchedAt,
      }));

      if (upsertRows.length > 0) {
        const { error: upsertError } = await supabase
          .from('odds_cache')
          .upsert(upsertRows, { onConflict: 'sport,game_id' });

        if (upsertError) {
          console.error(`[refresh-odds] Upsert failed for ${sportKey}:`, upsertError.message);
          results.push({ sport: sportKey, error: upsertError.message });
        } else {
          totalUpserted += upsertRows.length;
          results.push({ sport: sportKey, upserted: upsertRows.length, apiCallsUsed: used });
        }
      } else {
        results.push({ sport: sportKey, upserted: 0, note: 'No active games returned' });
      }

      // Update discovery timestamp for this sport (marks it as recently checked)
      await supabase.from('settings').upsert(
        [{ key: `refresh_odds_discovery_${sportKey}`, value: fetchedAt }],
        { onConflict: 'key' }
      ).catch(() => { /* non-fatal */ });

    } catch (err) {
      console.error(`[refresh-odds] Fetch failed for ${sportKey}:`, err.message);
      results.push({ sport: sportKey, error: err.message });
    }
  }

  const elapsed = Date.now() - runStarted;

  // ── Log run to settings for health-check visibility ────────────────────────
  await supabase.from('settings').upsert(
    [{ key: 'cron_refresh_odds_last_run', value: JSON.stringify({
      at:              runStartISO,
      elapsed,
      sportsChecked:  SPORT_KEYS.length,
      sportsRefreshed: [...sportsToFetch],
      totalUpserted,
      apiRemaining,
      quotaLow,
      results,
    })}],
    { onConflict: 'key' }
  ).catch(() => { /* non-fatal */ });

  console.log(`[refresh-odds] Done in ${elapsed}ms — refreshed ${[...sportsToFetch].join(', ')} — upserted ${totalUpserted} games`);

  return NextResponse.json({
    ok:              true,
    sportsChecked:   SPORT_KEYS.length,
    sportsRefreshed: [...sportsToFetch],
    totalUpserted,
    apiRemaining,
    quotaLow,
    results,
    elapsed,
  });
}
