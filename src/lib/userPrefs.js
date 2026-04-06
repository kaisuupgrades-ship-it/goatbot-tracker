/**
 * BetOS User Preferences
 * Provides timezone and odds format helpers used throughout the app.
 *
 * Usage:
 *   import { formatOdds, formatGameTime, getUserPrefs } from '@/lib/userPrefs';
 *
 *   const prefs = getUserPrefs(user);
 *   formatOdds(-150, prefs.odds_format)   -> '-150' or '1.67'
 *   formatGameTime('2026-04-05T19:10Z', prefs.timezone) -> '3:10 PM ET'
 */

// ── Odds formatting ──────────────────────────────────────────────────────────

/**
 * Convert American ML odds to decimal.
 * -150 -> 1.67,  +130 -> 2.30
 */
export function americanToDecimal(american) {
  const n = parseInt(american);
  if (!n || isNaN(n)) return null;
  return n > 0
    ? parseFloat((n / 100 + 1).toFixed(2))
    : parseFloat((100 / Math.abs(n) + 1).toFixed(2));
}

/**
 * Format odds for display.
 * @param {number|string} american  American ML odds (e.g. -150, +130)
 * @param {'american'|'decimal'} format
 */
export function formatOdds(american, format = 'american') {
  const n = parseInt(american);
  if (!n || isNaN(n)) return '-';
  if (format === 'decimal') {
    const d = americanToDecimal(n);
    return d !== null ? d.toFixed(2) : '-';
  }
  return n > 0 ? `+${n}` : `${n}`;
}

// ── Time formatting ──────────────────────────────────────────────────────────

/**
 * Format a UTC datetime string for display in the user's timezone.
 * @param {string} isoString   e.g. '2026-04-05T19:10:00Z'
 * @param {string} timezone    IANA timezone, e.g. 'America/New_York'
 * @param {boolean} includeDate include the date as well
 */
export function formatGameTime(isoString, timezone = 'America/New_York', includeDate = false) {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    const opts = {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    };
    if (includeDate) {
      opts.month = 'short';
      opts.day = 'numeric';
    }
    return date.toLocaleString('en-US', opts);
  } catch {
    return '';
  }
}

/**
 * Get the short timezone abbreviation for display (e.g. 'ET', 'CT', 'PT').
 */
export function getTzAbbr(timezone = 'America/New_York') {
  const TZ_ABBRS = {
    'America/New_York':    'ET',
    'America/Chicago':     'CT',
    'America/Denver':      'MT',
    'America/Phoenix':     'MT',
    'America/Los_Angeles': 'PT',
    'America/Anchorage':   'AKT',
    'Pacific/Honolulu':    'HT',
    'Europe/London':       'GMT',
    'Europe/Paris':        'CET',
    'Australia/Sydney':    'AEDT',
  };
  return TZ_ABBRS[timezone] || timezone.split('/').pop().replace('_', ' ');
}

// ── User prefs helpers ───────────────────────────────────────────────────────

const STORAGE_KEY = 'betos_user_prefs';

export function getUserPrefs(user) {
  const meta = user?.user_metadata || {};
  // Also try localStorage for non-auth scenarios
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch {}
  return {
    timezone:    meta.timezone    || stored.timezone    || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
    odds_format: meta.odds_format || stored.odds_format || 'american',
  };
}

export function saveLocalPrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
}

// ── Common timezones for the selector ────────────────────────────────────────
export const TIMEZONES = [
  { value: 'America/New_York',    label: 'Eastern Time (ET)' },
  { value: 'America/Chicago',     label: 'Central Time (CT)' },
  { value: 'America/Denver',      label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage',   label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu',    label: 'Hawaii Time (HT)' },
  { value: 'Europe/London',       label: 'London (GMT/BST)' },
  { value: 'Europe/Paris',        label: 'Central Europe (CET)' },
  { value: 'Europe/Berlin',       label: 'Berlin (CET)' },
  { value: 'Asia/Tokyo',          label: 'Tokyo (JST)' },
  { value: 'Australia/Sydney',    label: 'Sydney (AEDT)' },
];
