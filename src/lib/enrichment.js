/**
 * Server-side enrichment helpers.
 *
 * These pull H2H history from ESPN and weather from Open-Meteo without
 * requiring auth or going through our /api/h2h or /api/weather endpoints.
 * Used by /api/sports when ?enrich=1 is set, so the scoreboard payload
 * arrives at the client with everything baked in — no per-card fetches.
 */

// ── H2H ────────────────────────────────────────────────────────────────────
const H2H_SPORT_MAP = {
  mlb:   'baseball/mlb',
  nfl:   'football/nfl',
  nba:   'basketball/nba',
  nhl:   'hockey/nhl',
  ncaaf: 'football/college-football',
  ncaab: 'basketball/mens-college-basketball',
  mls:   'soccer/usa.1',
  wnba:  'basketball/wnba',
};

const h2hMemo = new Map();
const H2H_MEMO_TTL = 60 * 60 * 1000;

export async function getH2HData({ sport, team1, team2, abbrHome = '?', abbrAway = '?' }) {
  const espnPath = H2H_SPORT_MAP[sport];
  if (!espnPath || !team1 || !team2) return null;

  const cacheKey = `${sport}-${team1}-${team2}`;
  const cached = h2hMemo.get(cacheKey);
  if (cached && Date.now() - cached.ts < H2H_MEMO_TTL) return cached.data;

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];
  const allGames = [];

  for (const year of years) {
    if (allGames.length >= 20) break;
    const url = `https://site.api.espn.com/apis/site/v2/sports/${espnPath}/teams/${team1}/schedule?season=${year}&seasontype=2`;
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } });
      if (!res.ok) continue;
      const data = await res.json();

      for (const event of (data.events || [])) {
        const comp = event.competitions?.[0];
        if (!comp) continue;
        const completed = event.status?.type?.completed || comp.status?.type?.completed;
        if (!completed) continue;

        const comps = comp.competitors || [];
        if (!comps.some(c => String(c.team?.id) === String(team2))) continue;

        const t1 = comps.find(c => String(c.team?.id) === String(team1));
        const t2 = comps.find(c => String(c.team?.id) === String(team2));
        if (!t1 || !t2) continue;

        const s1 = parseInt(t1.score ?? 0);
        const s2 = parseInt(t2.score ?? 0);
        const t1Won = t1.winner === true || (!t1.winner && !t2.winner && s1 > s2);
        const isHome = t1.homeAway === 'home';

        allGames.push({
          date:   event.date?.substring(0, 10) || '',
          season: year,
          score1: s1,
          score2: s2,
          t1Won,
          isHome,
        });
      }
    } catch {
      /* skip year */
    }
  }

  allGames.sort((a, b) => (b.date > a.date ? 1 : -1));
  const last20 = allGames.slice(0, 20);
  const wins   = last20.filter(g => g.t1Won).length;
  const losses = last20.filter(g => !g.t1Won).length;

  const result = {
    abbrHome,
    abbrAway,
    record: { wins, losses, total: last20.length },
    games: last20,
  };

  h2hMemo.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

// ── Weather ────────────────────────────────────────────────────────────────
const OPEN_METEO         = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

const wxMemo = new Map();
const WX_TTL = 10 * 60 * 1000;
const WX_HIST_TTL = 60 * 60 * 1000;

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

function compassDir(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function rainToChance(mm) {
  if (mm == null || mm <= 0) return 0;
  if (mm < 0.1) return 5;
  if (mm < 0.5) return 20;
  if (mm < 2.0) return 50;
  if (mm < 5.0) return 75;
  return 90;
}

function closestIndex(hours, targetMs) {
  let idx = 0, minDiff = Infinity;
  hours.forEach((h, i) => {
    const diff = Math.abs(new Date(h).getTime() - targetMs);
    if (diff < minDiff) { minDiff = diff; idx = i; }
  });
  return idx;
}

export async function getWeatherData({ lat, lon, gameTime }) {
  if (!lat || !lon) return null;

  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${gameTime || 'now'}`;
  const cached = wxMemo.get(cacheKey);
  if (cached) {
    const ttl = cached.historical ? WX_HIST_TTL : WX_TTL;
    if (Date.now() - cached.ts < ttl) return cached.data;
  }

  const gameMs = gameTime ? new Date(gameTime).getTime() : null;
  const isPast = gameMs && gameMs < Date.now() - 3600_000;

  try {
    let result;
    if (isPast) {
      const dateStr = new Date(gameMs).toISOString().slice(0, 10);
      const url = `${OPEN_METEO_ARCHIVE}?latitude=${lat}&longitude=${lon}`
        + `&start_date=${dateStr}&end_date=${dateStr}`
        + `&hourly=temperature_2m,windspeed_10m,winddirection_10m,rain,relativehumidity_2m,weathercode`
        + `&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto`;

      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();

      const hours    = data.hourly?.time              || [];
      const temps    = data.hourly?.temperature_2m    || [];
      const winds    = data.hourly?.windspeed_10m     || [];
      const windDirs = data.hourly?.winddirection_10m || [];
      const rain     = data.hourly?.rain              || [];
      const humidity = data.hourly?.relativehumidity_2m || [];
      const codes    = data.hourly?.weathercode       || [];
      if (!hours.length) return null;

      const idx = closestIndex(hours, gameMs);
      const w   = describeWeather(codes[idx] ?? 0);
      result = {
        time:       hours[idx],
        temp_f:     Math.round(temps[idx]    ?? 72),
        windspeed:  Math.round(winds[idx]    ?? 0),
        winddir:    Math.round(windDirs[idx] ?? 0),
        compass:    compassDir(windDirs[idx] ?? 0),
        precip_pct: rainToChance(rain[idx]),
        humidity:   Math.round(humidity[idx] ?? 50),
        code:       codes[idx] ?? 0,
        desc:       w.desc,
        emoji:      w.emoji,
        historical: true,
      };
    } else {
      const url = `${OPEN_METEO}?latitude=${lat}&longitude=${lon}`
        + `&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation_probability,relativehumidity_2m,weathercode`
        + `&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&forecast_days=3`;

      const res = await fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const data = await res.json();

      const hours    = data.hourly?.time                      || [];
      const temps    = data.hourly?.temperature_2m            || [];
      const winds    = data.hourly?.windspeed_10m             || [];
      const windDirs = data.hourly?.winddirection_10m         || [];
      const precips  = data.hourly?.precipitation_probability || [];
      const humidity = data.hourly?.relativehumidity_2m       || [];
      const codes    = data.hourly?.weathercode               || [];

      let idx = 0;
      if (gameMs) {
        idx = closestIndex(hours, gameMs);
      } else {
        const now = Date.now();
        for (let i = 0; i < hours.length; i++) {
          if (new Date(hours[i]).getTime() >= now) { idx = i; break; }
        }
      }
      const w = describeWeather(codes[idx] ?? 0);
      result = {
        time:       hours[idx],
        temp_f:     Math.round(temps[idx]    ?? 72),
        windspeed:  Math.round(winds[idx]    ?? 0),
        winddir:    Math.round(windDirs[idx] ?? 0),
        compass:    compassDir(windDirs[idx] ?? 0),
        precip_pct: Math.round(precips[idx]  ?? 0),
        humidity:   Math.round(humidity[idx] ?? 50),
        code:       codes[idx] ?? 0,
        desc:       w.desc,
        emoji:      w.emoji,
        historical: false,
      };
    }

    wxMemo.set(cacheKey, { data: result, ts: Date.now(), historical: isPast });
    return result;
  } catch {
    return null;
  }
}
