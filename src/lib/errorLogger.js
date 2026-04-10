'use client';
/**
 * Client-side error logger.
 *
 * - Installs global window.onerror + window.onunhandledrejection handlers
 * - Exports logError(message, opts) for manual logging
 * - Batches and debounces to avoid API spam
 * - POSTs to /api/admin/error-log
 *
 * Usage:
 *   import { initErrorLogger, logError } from '@/lib/errorLogger';
 *   initErrorLogger(); // call once in a top-level client component
 *   logError('something went wrong', { endpoint: '/api/foo', metadata: { extra: 'data' } });
 */

const ENDPOINT  = '/api/admin/error-log';
const MAX_QUEUE = 20;   // max entries held before flush
const DEBOUNCE_MS = 3_000;  // wait this long after last error before flushing
const DEDUPE_WINDOW_MS = 10_000; // suppress identical messages within this window

let queue    = [];
let timer    = null;
let lastSeen = {}; // message → timestamp (dedupe)
let initialized = false;

function getToken() {
  // Pull JWT from supabase local storage — avoids importing the heavy supabase client
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const v = JSON.parse(localStorage.getItem(k) || '{}');
        return v?.access_token || null;
      }
    }
  } catch { /* SSR or storage blocked */ }
  return null;
}

function isDupe(message) {
  const now = Date.now();
  const last = lastSeen[message];
  if (last && now - last < DEDUPE_WINDOW_MS) return true;
  lastSeen[message] = now;
  // Prune old entries
  if (Object.keys(lastSeen).length > 200) {
    for (const k of Object.keys(lastSeen)) {
      if (now - lastSeen[k] > DEDUPE_WINDOW_MS) delete lastSeen[k];
    }
  }
  return false;
}

async function flush() {
  if (!queue.length) return;
  const batch = queue.splice(0, MAX_QUEUE);
  timer = null;

  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  for (const entry of batch) {
    try {
      await fetch(ENDPOINT, {
        method:  'POST',
        headers,
        body:    JSON.stringify(entry),
        // keepalive ensures the request survives page unload
        keepalive: true,
      });
    } catch { /* network failure — silently drop */ }
  }
}

function scheduleFlush() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, DEBOUNCE_MS);
  // Force flush if queue is full
  if (queue.length >= MAX_QUEUE) {
    clearTimeout(timer);
    timer = null;
    flush();
  }
}

function enqueue(entry) {
  if (isDupe(entry.message)) return;
  queue.push(entry);
  scheduleFlush();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Log an error from anywhere in client code.
 * @param {string} message
 * @param {{ level?: 'error'|'warn'|'info', endpoint?: string, stack?: string, metadata?: object }} opts
 */
export function logError(message, opts = {}) {
  if (typeof window === 'undefined') return; // SSR guard
  enqueue({
    level:    opts.level    || 'error',
    source:   'client',
    endpoint: opts.endpoint || (typeof window !== 'undefined' ? window.location.pathname : null),
    message:  String(message).slice(0, 5000),
    stack:    opts.stack    || null,
    metadata: opts.metadata || null,
  });
}

/**
 * Log a warning from client code.
 */
export function logWarn(message, opts = {}) {
  logError(message, { ...opts, level: 'warn' });
}

/**
 * Log an informational event.
 */
export function logInfo(message, opts = {}) {
  logError(message, { ...opts, level: 'info' });
}

/**
 * Install global error handlers. Call once at app startup.
 * Safe to call multiple times — installs only once.
 */
export function initErrorLogger() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  const prev_onerror = window.onerror;
  window.onerror = function (msg, src, line, col, err) {
    // Ignore benign browser extension errors and cross-origin script errors
    const message = String(msg);
    if (message === 'Script error.' || message.includes('extension')) {
      return prev_onerror?.apply(this, arguments);
    }
    enqueue({
      level:    'error',
      source:   'client',
      endpoint: window.location.pathname,
      message:  message.slice(0, 5000),
      stack:    err?.stack ? String(err.stack).slice(0, 10000) : `${src}:${line}:${col}`,
      metadata: { src, line, col },
    });
    return prev_onerror?.apply(this, arguments);
  };

  const prev_unhandled = window.onunhandledrejection;
  window.onunhandledrejection = function (event) {
    const reason = event.reason;
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : JSON.stringify(reason);

    // Suppress AbortError — these are expected (fetch cancellations on navigation)
    if (reason?.name === 'AbortError') return prev_unhandled?.call(this, event);

    enqueue({
      level:    'error',
      source:   'client',
      endpoint: window.location.pathname,
      message:  String(message).slice(0, 5000),
      stack:    reason instanceof Error ? (reason.stack || null) : null,
      metadata: { type: 'unhandledrejection' },
    });
    return prev_unhandled?.call(this, event);
  };

  // Flush on page unload
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
