/**
 * Scoreboard module-level caches + fetch helpers.
 *
 * Extracted from the monolithic ScoreboardTab.jsx so callers (and any future
 * scoreboard sub-components) share one authoritative cache.
 *
 * H2H cache:     keyed by `${sport}_${homeTeamId}_${awayTeamId}`. Positive
 *                hits live forever (a team's historical record doesn't
 *                change until they play again). Negative hits get a 5-min
 *                TTL so transient failures clear themselves.
 *
 * Weather cache: keyed by `${lat}_${lon}_${gameDate}`. 30-min TTL — game-
 *                time forecasts rarely swing materially within that window.
 *
 * In-flight dedupe: concurrent calls for the same key share a single promise
 * instead of double-firing the API (e.g. hover-prefetch then click).
 */
import { supabase } from '@/lib/supabase';

const H2H_NEG_TTL_MS = 5 * 60 * 1000;
const WEATHER_TTL_MS = 30 * 60 * 1000;

export const h2hCache       = new Map();
export const weatherCache   = new Map();
const h2hInFlight           = new Map();
const weatherInFlight       = new Map();

// Sports the /api/h2h endpoint actually supports — short-circuit anything
// else (incl. the 'all' meta-sport) to avoid spamming /api/h2h with 400s.
const H2H_VALID_SPORTS = new Set(['mlb','nfl','nba','nhl','ncaaf','ncaab','mls','wnba']);

export function weatherCacheLookup(lat, lon, gameDate) {
  if (!lat) return null;
  const key = `${lat}_${lon}_${gameDate || ''}`;
  const entry = weatherCache.get(key);
  if (!entry) return null;
  return Date.now() - entry.time < WEATHER_TTL_MS ? entry.data : null;
}

export function h2hCacheLookup(key) {
  const entry = h2hCache.get(key);
  if (!entry) return undefined;
  if (entry.ok) return entry.data;
  if (Date.now() - entry.time < H2H_NEG_TTL_MS) return null;
  h2hCache.delete(key);
  return undefined;
}

export function fetchH2H({ sport, homeTeamId, awayTeamId, homeAbbr, awayAbbr }) {
  if (!sport || !homeTeamId || !awayTeamId || !H2H_VALID_SPORTS.has(sport)) {
    return Promise.resolve(null);
  }

  const key = `${sport}_${homeTeamId}_${awayTeamId}`;
  const cached = h2hCacheLookup(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const pending = h2hInFlight.get(key);
  if (pending) return pending;

  const url = `/api/h2h?sport=${sport}&team1=${homeTeamId}&team2=${awayTeamId}`
    + `&abbrHome=${homeAbbr || 'HM'}&abbrAway=${awayAbbr || 'AW'}`;

  const promise = supabase.auth.getSession()
    .then(({ data: { session } }) => {
      const headers = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      return fetch(url, { headers });
    })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (d && d.record) {
        h2hCache.set(key, { data: d, time: Date.now(), ok: true });
        return d;
      }
      h2hCache.set(key, { data: null, time: Date.now(), ok: false });
      return null;
    })
    .catch(() => {
      h2hCache.set(key, { data: null, time: Date.now(), ok: false });
      return null;
    })
    .finally(() => { h2hInFlight.delete(key); });

  h2hInFlight.set(key, promise);
  return promise;
}

export function fetchWeather({ lat, lon, gameDate }) {
  if (!lat) return Promise.resolve(null);
  const key = `${lat}_${lon}_${gameDate || ''}`;
  const cached = weatherCache.get(key);
  if (cached && Date.now() - cached.time < WEATHER_TTL_MS) {
    return Promise.resolve(cached.data);
  }
  const pending = weatherInFlight.get(key);
  if (pending) return pending;

  const params = new URLSearchParams({ lat, lon, ...(gameDate ? { gameTime: gameDate } : {}) });

  const promise = supabase.auth.getSession()
    .then(({ data: { session } }) => {
      const headers = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      return fetch(`/api/weather?${params}`, { headers });
    })
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      const data = d && !d.error ? d : null;
      if (data) weatherCache.set(key, { data, time: Date.now() });
      return data;
    })
    .catch(() => null)
    .finally(() => { weatherInFlight.delete(key); });

  weatherInFlight.set(key, promise);
  return promise;
}
