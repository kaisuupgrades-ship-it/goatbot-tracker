/**
 * Server-side error logger — writes directly to Supabase via service role key.
 * Import in any API route catch block.
 *
 * Usage:
 *   import { logServerError } from '@/lib/serverErrorLogger';
 *
 *   try { ... } catch (e) {
 *     await logServerError('/api/my-route', e.message, { stack: e.stack, source: 'api' });
 *   }
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

const DEDUPE_MAP = new Map(); // in-memory dedup within the same process
const DEDUPE_MS  = 60_000;   // suppress identical messages for 1 minute

function isDupe(key) {
  const now = Date.now();
  const last = DEDUPE_MAP.get(key);
  if (last && now - last < DEDUPE_MS) return true;
  DEDUPE_MAP.set(key, now);
  // Prune old entries
  if (DEDUPE_MAP.size > 500) {
    for (const [k, t] of DEDUPE_MAP) {
      if (now - t > DEDUPE_MS) DEDUPE_MAP.delete(k);
    }
  }
  return false;
}

/**
 * Log an error from a server-side API route or cron job.
 *
 * @param {string} endpoint — the route path, e.g. '/api/goatbot'
 * @param {string} message  — error message
 * @param {{
 *   level?:    'error'|'warn'|'info',
 *   source?:   'api'|'cron'|'webhook'|'client',
 *   stack?:    string,
 *   metadata?: object,
 *   userId?:   string,
 * }} opts
 * @returns {Promise<void>}
 */
export async function logServerError(endpoint, message, opts = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) return; // silently skip if not configured

  const level  = opts.level  || 'error';
  const source = opts.source || 'api';

  const dedupeKey = `${source}:${endpoint}:${String(message).slice(0, 200)}`;
  if (isDupe(dedupeKey)) return;

  const body = {
    level,
    source,
    endpoint:  endpoint ? String(endpoint).slice(0, 500)  : null,
    message:   String(message).slice(0, 5000),
    stack:     opts.stack    ? String(opts.stack).slice(0, 10000) : null,
    metadata:  opts.metadata || null,
    user_id:   opts.userId   || null,
  };

  try {
    // Use the CRON_SECRET pattern so the API route trusts this as a server call
    const cronSecret = process.env.CRON_SECRET;
    const headers = {
      'Content-Type':  'application/json',
      'Authorization': cronSecret ? `Bearer ${cronSecret}` : `Bearer ${SERVICE_KEY}`,
    };

    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/error_log`, {
      method: 'POST',
      headers: {
        ...headers,
        'apikey':  SERVICE_KEY,
        'Prefer':  'return=minimal',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok && res.status !== 201) {
      // Fall back to logging directly via our own API if direct REST fails
      const site = process.env.NEXT_PUBLIC_SITE_URL || 'https://betos.win';
      await fetch(`${site}/api/admin/error-log`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': cronSecret ? `Bearer ${cronSecret}` : `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify(body),
      }).catch(() => {});
    }
  } catch {
    // Never throw from logger — errors in error logging should be silent
  }
}

/**
 * Convenience wrapper for cron job errors.
 */
export async function logCronError(cronName, message, opts = {}) {
  return logServerError(`/api/cron/${cronName}`, message, {
    source: 'cron',
    ...opts,
  });
}

/**
 * Convenience wrapper for warning-level logs.
 */
export async function logServerWarn(endpoint, message, opts = {}) {
  return logServerError(endpoint, message, { ...opts, level: 'warn' });
}
