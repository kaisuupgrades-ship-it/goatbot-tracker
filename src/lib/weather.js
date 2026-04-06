/**
 * Open-Meteo weather enrichment for outdoor sports venues
 *
 * Free, no API key required. Used to surface wind/weather edges in the
 * Trends edge scan — particularly for MLB totals where wind is a proven edge.
 *
 * Endpoint: https://api.open-meteo.com/v1/forecast
 */

// MLB ballpark coordinates — outdoor stadiums only
// Domes and retractable roofs excluded (weather irrelevant)
const MLB_PARKS = {
  // Fully outdoor
  CHC: { name: 'Wrigley Field',        lat: 41.9484,  lon: -87.6553,  outdoor: true },
  COL: { name: 'Coors Field',          lat: 39.7559,  lon: -104.9942, outdoor: true },
  LAD: { name: 'Dodger Stadium',       lat: 34.0739,  lon: -118.2400, outdoor: true },
  SF:  { name: 'Oracle Park',          lat: 37.7786,  lon: -122.3893, outdoor: true },
  NYY: { name: 'Yankee Stadium',       lat: 40.8296,  lon: -73.9262,  outdoor: true },
  NYM: { name: 'Citi Field',           lat: 40.7571,  lon: -73.8458,  outdoor: true },
  BOS: { name: 'Fenway Park',          lat: 42.3467,  lon: -71.0972,  outdoor: true },
  CIN: { name: 'Great American BP',    lat: 39.0979,  lon: -84.5082,  outdoor: true },
  STL: { name: 'Busch Stadium',        lat: 38.6226,  lon: -90.1928,  outdoor: true },
  KC:  { name: 'Kauffman Stadium',     lat: 39.0517,  lon: -94.4803,  outdoor: true },
  MIN: { name: 'Target Field',         lat: 44.9817,  lon: -93.2781,  outdoor: true },
  DET: { name: 'Comerica Park',        lat: 42.3390,  lon: -83.0485,  outdoor: true },
  CLE: { name: 'Progressive Field',    lat: 41.4962,  lon: -81.6852,  outdoor: true },
  PIT: { name: 'PNC Park',             lat: 40.4469,  lon: -80.0057,  outdoor: true },
  PHI: { name: 'Citizens Bank Park',   lat: 39.9061,  lon: -75.1665,  outdoor: true },
  ATL: { name: 'Truist Park',          lat: 33.8908,  lon: -84.4678,  outdoor: true },
  MIA: { name: 'loanDepot park',       lat: 25.7781,  lon: -80.2197,  outdoor: false }, // retractable
  BAL: { name: 'Camden Yards',         lat: 39.2838,  lon: -76.6215,  outdoor: true },
  WAS: { name: 'Nationals Park',       lat: 38.8729,  lon: -77.0074,  outdoor: true },
  SD:  { name: 'Petco Park',           lat: 32.7073,  lon: -117.1566, outdoor: true },
  OAK: { name: 'Oakland Coliseum',     lat: 37.7516,  lon: -122.2008, outdoor: true },
  // Retractable/dome — excluded from weather analysis
  TB:  { name: 'Tropicana Field',      lat: 27.7683,  lon: -82.6534,  outdoor: false },
  TEX: { name: 'Globe Life Field',     lat: 32.7473,  lon: -97.0830,  outdoor: false },
  HOU: { name: 'Minute Maid Park',     lat: 29.7572,  lon: -95.3551,  outdoor: false },
  ARI: { name: 'Chase Field',          lat: 33.4453,  lon: -112.0667, outdoor: false },
  TOR: { name: 'Rogers Centre',        lat: 43.6414,  lon: -79.3894,  outdoor: false },
  MIL: { name: 'Am. Family Field',     lat: 43.0280,  lon: -87.9712,  outdoor: false },
  SEA: { name: 'T-Mobile Park',        lat: 47.5914,  lon: -122.3325, outdoor: false },
};

// NFL stadiums (selected outdoor ones) — for totals/weather analysis
const NFL_PARKS = {
  BUF: { name: 'Highmark Stadium',    lat: 42.7738,  lon: -78.7870, outdoor: true },
  CHI: { name: 'Soldier Field',       lat: 41.8623,  lon: -87.6167, outdoor: true },
  CLE: { name: 'Cleveland Browns S.', lat: 41.5061,  lon: -81.6995, outdoor: true },
  DEN: { name: 'Empower Field',       lat: 39.7439,  lon: -105.0201,outdoor: true },
  GB:  { name: 'Lambeau Field',       lat: 44.5013,  lon: -88.0622, outdoor: true },
  KC:  { name: 'Arrowhead Stadium',   lat: 39.0489,  lon: -94.4839, outdoor: true },
  NYG: { name: 'MetLife Stadium',     lat: 40.8135,  lon: -74.0745, outdoor: true },
  NYJ: { name: 'MetLife Stadium',     lat: 40.8135,  lon: -74.0745, outdoor: true },
  NE:  { name: 'Gillette Stadium',    lat: 42.0909,  lon: -71.2643, outdoor: true },
  PIT: { name: 'Acrisure Stadium',    lat: 40.4468,  lon: -80.0158, outdoor: true },
  SEA: { name: 'Lumen Field',         lat: 47.5952,  lon: -122.3316,outdoor: true },
  SF:  { name: 'Levi\'s Stadium',     lat: 37.4033,  lon: -121.9694,outdoor: true },
  WAS: { name: 'FedExField',          lat: 38.9077,  lon: -76.8645, outdoor: true },
};

// Cardinal directions for wind
function windDirection(degrees) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(degrees / 22.5) % 16];
}

// Simple text description of wind effect on MLB totals
function mlbWindEffect(speedMph, dirDeg) {
  if (speedMph < 5) return 'calm (negligible effect)';
  const dir = windDirection(dirDeg);
  // "Out" = toward CF (roughly) -> favor overs; "In" = from CF -> favor unders
  const outDirs = ['S', 'SSW', 'SW', 'SSE', 'SE'];
  const inDirs  = ['N', 'NNW', 'NW', 'NNE', 'NE'];
  const isOut   = outDirs.includes(dir);
  const isIn    = inDirs.includes(dir);
  const strength = speedMph >= 15 ? 'STRONG' : speedMph >= 10 ? 'moderate' : 'light';
  if (isOut)  return `${strength} blowing OUT (${speedMph}mph ${dir}) - favors OVER`;
  if (isIn)   return `${strength} blowing IN  (${speedMph}mph ${dir}) - favors UNDER`;
  return `${strength} crosswind (${speedMph}mph ${dir})`;
}

/**
 * fetchWeatherForGames(games)
 *
 * @param {Array} games - array of { sport, home, away, matchup }
 * @returns {Object} weatherMap - keyed by matchup string, value is weather string
 *
 * Only fetches outdoor MLB (and NFL) games. Domes return null.
 */
export async function fetchWeatherForGames(games) {
  const weatherMap = {};
  const toFetch = [];

  for (const g of games) {
    if (g.sport !== 'MLB' && g.sport !== 'NFL') continue;

    const parkDb = g.sport === 'MLB' ? MLB_PARKS : NFL_PARKS;

    // Try to match home team abbreviation to a park
    const homeAbbr = g.home?.split(' ').pop()?.toUpperCase()
      || g.matchup?.split('@')[1]?.trim()?.toUpperCase();

    const park = parkDb[homeAbbr];
    if (!park || !park.outdoor) continue;

    toFetch.push({ matchup: g.matchup, park, sport: g.sport });
  }

  if (toFetch.length === 0) return weatherMap;

  // Deduplicate by coordinates (same stadium hosting double-headers etc.)
  const coordSet = new Map();
  for (const item of toFetch) {
    const key = `${item.park.lat},${item.park.lon}`;
    if (!coordSet.has(key)) coordSet.set(key, { ...item, matchups: [item.matchup] });
    else coordSet.get(key).matchups.push(item.matchup);
  }

  // Fetch weather in parallel
  await Promise.allSettled(
    [...coordSet.values()].map(async ({ park, sport, matchups }) => {
      try {
        const url = `https://api.open-meteo.com/v1/forecast` +
          `?latitude=${park.lat}&longitude=${park.lon}` +
          `&current=temperature_2m,wind_speed_10m,wind_direction_10m,precipitation,weather_code` +
          `&wind_speed_unit=mph&temperature_unit=fahrenheit` +
          `&forecast_days=1`;

        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return;

        const data = await res.json();
        const cur = data.current;
        if (!cur) return;

        const tempF   = Math.round(cur.temperature_2m ?? 70);
        const windMph = Math.round(cur.wind_speed_10m ?? 0);
        const windDir = cur.wind_direction_10m ?? 0;
        const precip  = cur.precipitation ?? 0;

        let desc = `${tempF}degF`;
        if (sport === 'MLB') {
          desc += `, ${mlbWindEffect(windMph, windDir)}`;
        } else {
          desc += `, wind ${windMph}mph ${windDirection(windDir)}`;
        }
        if (precip > 0.05) desc += `, rain (${precip.toFixed(1)}mm)`;

        for (const m of matchups) weatherMap[m] = desc;
      } catch { /* skip — weather is supplemental, never blocking */ }
    })
  );

  return weatherMap;
}
