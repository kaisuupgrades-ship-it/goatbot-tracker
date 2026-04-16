import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

export const maxDuration = 15;

// Open-Meteo — free, no API key needed
// Forecast docs: https://open-meteo.com/en/docs
// Archive docs:  https://open-meteo.com/en/docs/historical-weather-api
const OPEN_METEO         = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

const cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 min (longer for historical — it won't change)
const HIST_CACHE_TTL = 60 * 60 * 1000; // 1 hr for historical

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  const ttl = entry.historical ? HIST_CACHE_TTL : CACHE_TTL;
  if (Date.now() - entry.time > ttl) { cache.delete(key); return null; }
  return entry.data;
}

// Weather code → description + emoji
function describeWeather(code) {
  if (code === 0) return { desc: 'Clear', emoji: '☀️' };
  if (code <= 2)  return { desc: 'Partly Cloudy', emoji: '⛅' };
  if (code === 3) return { desc: 'Overcast', emoji: '☁️' };
  if (code <= 49) return { desc: 'Foggy', emoji: '🌫️' };
  if (code <= 59) return { desc: 'Drizzle', emoji: '🌦️' };
  if (code <= 69) return { desc: 'Rain', emoji: '🌧️' };
  if (code <= 79) return { desc: 'Snow', emoji: '❄️' };
  if (code <= 84) return { desc: 'Rain Showers', emoji: '🌧️' };
  if (code <= 86) return { desc: 'Snow Showers', emoji: '🌨️' };
  if (code >= 95) return { desc: 'Thunderstorm', emoji: '⛈️' };
  return { desc: 'Mixed', emoji: '🌥️' };
}

// Cardinal direction from degrees
function compassDir(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// Convert mm of rain to a rough "chance" percentage for display parity with forecast API
function rainToChance(mm) {
  if (mm == null || mm <= 0) return 0;
  if (mm < 0.1) return 5;
  if (mm < 0.5) return 20;
  if (mm < 2.0) return 50;
  if (mm < 5.0) return 75;
  return 90;
}

// Find index closest to target timestamp in an array of ISO time strings
function closestIndex(hours, targetMs) {
  let idx = 0, minDiff = Infinity;
  hours.forEach((h, i) => {
    const diff = Math.abs(new Date(h).getTime() - targetMs);
    if (diff < minDiff) { minDiff = diff; idx = i; }
  });
  return idx;
}

export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const lat      = parseFloat(searchParams.get('lat'));
  const lon      = parseFloat(searchParams.get('lon'));
  const gameTime = searchParams.get('gameTime'); // ISO string

  if (!lat || !lon) {
    return NextResponse.json({ error: 'lat and lon required' }, { status: 400 });
  }

  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${gameTime || 'now'}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  // Determine if we need historical data (game was more than 1 hour ago)
  const gameMs = gameTime ? new Date(gameTime).getTime() : null;
  const isPast = gameMs && gameMs < Date.now() - 3600_000;

  try {
    let result;

    if (isPast) {
      // ── Historical: Open-Meteo Archive API ──────────────────────────────
      // Archive API uses start_date/end_date (YYYY-MM-DD), same timezone=auto
      const gameDate = new Date(gameMs);
      const dateStr  = gameDate.toISOString().slice(0, 10); // YYYY-MM-DD

      const url = `${OPEN_METEO_ARCHIVE}?latitude=${lat}&longitude=${lon}`
        + `&start_date=${dateStr}&end_date=${dateStr}`
        + `&hourly=temperature_2m,windspeed_10m,winddirection_10m,rain,relativehumidity_2m,weathercode`
        + `&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Archive API ${res.status}`);
      const data = await res.json();

      const hours    = data.hourly?.time         || [];
      const temps    = data.hourly?.temperature_2m    || [];
      const winds    = data.hourly?.windspeed_10m     || [];
      const windDirs = data.hourly?.winddirection_10m || [];
      const rain     = data.hourly?.rain              || [];
      const humidity = data.hourly?.relativehumidity_2m || [];
      const codes    = data.hourly?.weathercode       || [];

      if (hours.length === 0) throw new Error('Archive returned no data');

      const idx     = closestIndex(hours, gameMs);
      const weather = describeWeather(codes[idx] ?? 0);

      result = {
        time:       hours[idx],
        temp_f:     Math.round(temps[idx]    ?? 72),
        windspeed:  Math.round(winds[idx]    ?? 0),
        winddir:    Math.round(windDirs[idx] ?? 0),
        compass:    compassDir(windDirs[idx] ?? 0),
        precip_pct: rainToChance(rain[idx]),
        humidity:   Math.round(humidity[idx] ?? 50),
        code:       codes[idx] ?? 0,
        desc:       weather.desc,
        emoji:      weather.emoji,
        historical: true, // ← tells UI to say "Actual conditions" not "Forecast"
      };

    } else {
      // ── Forecast: Open-Meteo Forecast API ───────────────────────────────
      const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lon}`
        + `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,relativehumidity_2m,weathercode`
        + `&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&forecast_days=3`;

      const res = await fetch(url, { next: { revalidate: 600 } });
      if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
      const data = await res.json();

      const hours    = data.hourly?.time                        || [];
      const temps    = data.hourly?.temperature_2m              || [];
      const winds    = data.hourly?.windspeed_10m               || [];
      const windDirs = data.hourly?.winddirection_10m           || [];
      const precips  = data.hourly?.precipitation_probability   || [];
      const humidity = data.hourly?.relativehumidity_2m         || [];
      const codes    = data.hourly?.weathercode                 || [];

      // Find the index closest to gameTime (or next upcoming hour)
      let idx = 0;
      if (gameMs) {
        idx = closestIndex(hours, gameMs);
      } else {
        // Default to next upcoming hour
        const now = Date.now();
        for (let i = 0; i < hours.length; i++) {
          if (new Date(hours[i]).getTime() >= now) { idx = i; break; }
        }
      }

      const weather = describeWeather(codes[idx] ?? 0);
      result = {
        time:       hours[idx],
        temp_f:     Math.round(temps[idx]    ?? 72),
        windspeed:  Math.round(winds[idx]    ?? 0),
        winddir:    Math.round(windDirs[idx] ?? 0),
        compass:    compassDir(windDirs[idx] ?? 0),
        precip_pct: Math.round(precips[idx]  ?? 0),
        humidity:   Math.round(humidity[idx] ?? 50),
        code:       codes[idx] ?? 0,
        desc:       weather.desc,
        emoji:      weather.emoji,
        historical: false,
      };
    }

    cache.set(cacheKey, { data: result, time: Date.now(), historical: isPast });
    return NextResponse.json(result);

  } catch (err) {
    console.error('Weather API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
