/**
 * /api/cron/refresh-enrichment — Persistent enrichment maintenance.
 *
 * For each active sport, pulls today's ESPN scoreboard, then for every game
 * decides what's stale based on per-piece fetched_at timestamps:
 *   - stadium  → never refresh (stadium data doesn't change mid-season)
 *   - h2h      → refresh if older than 24h (records only change after games)
 *   - weather  → refresh if older than 15 min for upcoming games (within 24h)
 *                refresh if older than 4h for further-out games
 *
 * Stale pieces are fetched in parallel via the shared lib functions, then
 * upserted into game_enrichment. Subsequent /api/sports?enrich=1 reads the
 * table directly — no more live upstream fetches per request.
 *
 * Idempotent: safe to run as often as every minute. Real cadence target is
 * every 5 min during peak hours, less off-peak.
 *
 * Auth: Bearer ${CRON_SECRET} header.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getH2HData, getWeatherData } from '@/lib/enrichment';
import { getStadiumInfo, INDOOR_SPORTS } from '@/lib/stadiums';

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SPORT_PATHS = {
  mlb:   'baseball/mlb',
  nfl:   'football/nfl',
  nba:   'basketball/nba',
  nhl:   'hockey/nhl',
  ncaaf: 'football/college-football',
  ncaab: 'basketball/mens-college-basketball',
  mls:   'soccer/usa.1',
  wnba:  'basketball/wnba',
};

const ACTIVE_SPORTS = ['mlb', 'nba', 'nhl', 'nfl', 'mls'];

// Refresh thresholds in milliseconds
const H2H_TTL_MS              = 24 * 60 * 60 * 1000;       // 24h
const WEATHER_NEAR_TTL_MS     = 15 * 60 * 1000;            // 15 min for games < 24h out
const WEATHER_FAR_TTL_MS      = 4 * 60 * 60 * 1000;        // 4h for games > 24h out
const NEAR_HORIZON_MS         = 24 * 60 * 60 * 1000;       // 24h

function isStale(fetchedAt, ttlMs) {
  if (!fetchedAt) return true;
  return Date.now() - new Date(fetchedAt).getTime() > ttlMs;
}

// Pull today's scoreboard from ESPN for one sport.
async function fetchScoreboard(sport, dateStr) {
  const path = SPORT_PATHS[sport];
  if (!path) return [];
  const url = dateStr
    ? `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${dateStr}`
    : `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.events || [];
  } catch {
    return [];
  }
}

// Convert today's date in ESPN's expected YYYYMMDD format
function espnDate(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

// Process a single event: figure out what's stale, fetch, return upsert row.
async function buildUpsertRow(sport, event, existing) {
  const comp = event.competitions?.[0];
  if (!comp) return null;
  const home = comp.competitors?.find(c => c.homeAway === 'home');
  const away = comp.competitors?.find(c => c.homeAway === 'away');
  if (!home?.team?.id || !away?.team?.id) return null;

  const homeAbbr = home.team.abbreviation;
  const awayAbbr = away.team.abbreviation;
  const indoor = INDOOR_SPORTS.has(sport);
  const stadium = (!indoor && ['mlb', 'nfl'].includes(sport))
    ? getStadiumInfo(sport, homeAbbr)
    : null;

  // Decide what to refetch
  const refetchH2H = isStale(existing?.h2h_fetched_at, H2H_TTL_MS);
  const commenceMs = event.date ? new Date(event.date).getTime() : null;
  const isNearHorizon = commenceMs && commenceMs - Date.now() < NEAR_HORIZON_MS;
  const wxTtl = isNearHorizon ? WEATHER_NEAR_TTL_MS : WEATHER_FAR_TTL_MS;
  const wantWeather = stadium?.lat && !stadium.dome;
  const refetchWeather = wantWeather && isStale(existing?.weather_fetched_at, wxTtl);
  const refetchStadium = stadium && !existing?.stadium;

  // Fetch in parallel — failures fall through to keep previous value
  const tasks = [];
  if (refetchH2H) {
    tasks.push(getH2HData({
      sport,
      team1: home.team.id,
      team2: away.team.id,
      abbrHome: homeAbbr,
      abbrAway: awayAbbr,
    }).then(v => ({ key: 'h2h', value: v })).catch(() => null));
  }
  if (refetchWeather) {
    tasks.push(getWeatherData({
      lat: stadium.lat,
      lon: stadium.lon,
      gameTime: event.date,
    }).then(v => ({ key: 'weather', value: v })).catch(() => null));
  }
  const results = await Promise.allSettled(tasks);
  const fetched = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) fetched[r.value.key] = r.value.value;
  }

  // Only update fetched_at if we actually got a non-null value back —
  // a null (failure) leaves the previous good data in place.
  const now = new Date().toISOString();
  const stadiumPayload = stadium ? {
    name:        stadium.name,
    lat:         stadium.lat,
    lon:         stadium.lon,
    dome:        !!stadium.dome,
    retractable: !!stadium.retractable,
    orientation: stadium.orientation ?? null,
  } : null;

  return {
    sport,
    game_id:        event.id,
    game_date:      event.date?.substring(0, 10) || null,
    commence_time:  event.date || null,
    home_team:      home.team.displayName || home.team.shortDisplayName,
    away_team:      away.team.displayName || away.team.shortDisplayName,
    home_team_id:   String(home.team.id),
    away_team_id:   String(away.team.id),
    home_abbr:      homeAbbr,
    away_abbr:      awayAbbr,

    // Only overwrite when we successfully fetched new data
    ...(refetchH2H && fetched.h2h !== undefined
      ? { h2h: fetched.h2h, h2h_fetched_at: fetched.h2h ? now : existing?.h2h_fetched_at }
      : {}),
    ...(refetchWeather && fetched.weather !== undefined
      ? { weather: fetched.weather, weather_fetched_at: fetched.weather ? now : existing?.weather_fetched_at }
      : {}),
    ...(refetchStadium
      ? { stadium: stadiumPayload, stadium_fetched_at: now }
      : {}),
  };
}

export async function GET(req) {
  // Auth — fail closed if CRON_SECRET isn't set
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const sportsFilter = searchParams.get('sport');         // optional: limit to one sport
  const sportsToProcess = sportsFilter
    ? [sportsFilter].filter(s => ACTIVE_SPORTS.includes(s))
    : ACTIVE_SPORTS;

  const t0 = Date.now();
  const summary = { sports: {}, totalUpserts: 0, totalSkipped: 0, elapsedMs: 0 };

  for (const sport of sportsToProcess) {
    const sportT0 = Date.now();
    const events = await fetchScoreboard(sport, espnDate());
    if (!events.length) {
      summary.sports[sport] = { events: 0, upserts: 0, skipped: 0, elapsedMs: Date.now() - sportT0 };
      continue;
    }

    // Pull existing rows for these games in one query
    const gameIds = events.map(e => e.id).filter(Boolean);
    const { data: existingRows = [] } = await supabase
      .from('game_enrichment')
      .select('game_id, h2h_fetched_at, weather_fetched_at, stadium, stadium_fetched_at')
      .eq('sport', sport)
      .in('game_id', gameIds);
    const existingByGameId = new Map((existingRows || []).map(r => [r.game_id, r]));

    // Build upsert rows in parallel — but cap concurrency to avoid hammering
    // upstream APIs. ESPN/Open-Meteo can rate-limit if we slam them.
    const CONCURRENCY = 6;
    const queue = [...events];
    const upsertRows = [];
    let skipped = 0;

    async function worker() {
      while (queue.length) {
        const ev = queue.shift();
        if (!ev) break;
        const existing = existingByGameId.get(ev.id);
        const row = await buildUpsertRow(sport, ev, existing);
        if (!row) { skipped++; continue; }
        // Skip if no piece needed updating AND row already exists
        const willUpdate = ('h2h' in row) || ('weather' in row) || ('stadium' in row) || !existing;
        if (!willUpdate) { skipped++; continue; }
        upsertRows.push(row);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    if (upsertRows.length > 0) {
      const { error } = await supabase
        .from('game_enrichment')
        .upsert(upsertRows, { onConflict: 'sport,game_id' });
      if (error) {
        console.error(`[refresh-enrichment] upsert error for ${sport}:`, error.message);
      }
    }

    summary.sports[sport] = {
      events: events.length,
      upserts: upsertRows.length,
      skipped,
      elapsedMs: Date.now() - sportT0,
    };
    summary.totalUpserts += upsertRows.length;
    summary.totalSkipped += skipped;
  }

  summary.elapsedMs = Date.now() - t0;
  return NextResponse.json(summary);
}
