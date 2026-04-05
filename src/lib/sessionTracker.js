/**
 * BetOS Session Tracker
 * Logs device info, IP (server-side), and time spent to the admin panel.
 * Pings the admin API every 60s with cumulative duration, and on page unload.
 */

function getDeviceInfo() {
  const ua = navigator.userAgent;

  // Device type
  const deviceType = /Mobi|Android|iPhone|iPad|iPod/i.test(ua)
    ? /iPad|Tablet/i.test(ua) ? 'tablet' : 'mobile'
    : 'desktop';

  // OS
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown';

  // Browser
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Unknown';

  const screen = `${window.screen.width}x${window.screen.height}`;

  return { deviceType, os, browser, screen, startedAt: new Date().toISOString() };
}

function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

let _sessionId = null;
let _startTime = null;
let _userId    = null;
let _interval  = null;
let _deviceInfo = null;

async function ping() {
  if (!_userId || !_sessionId) return;
  const durationSeconds = Math.floor((Date.now() - _startTime) / 1000);
  try {
    await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'track_session',
        userId: _userId,
        sessionId: _sessionId,
        durationSeconds,
        deviceInfo: _deviceInfo,
      }),
    });
  } catch { /* non-critical */ }
}

export function startSessionTracking(userId) {
  if (_interval) return; // already running
  _userId     = userId;
  _sessionId  = generateSessionId();
  _startTime  = Date.now();
  _deviceInfo = getDeviceInfo();

  // Ping immediately, then every 60 seconds
  ping();
  _interval = setInterval(ping, 60_000);

  // Ping on tab close / navigation away
  window.addEventListener('beforeunload', ping);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ping();
  });
}

export function stopSessionTracking() {
  if (_interval) { clearInterval(_interval); _interval = null; }
  ping(); // final ping
  _userId = null;
  _sessionId = null;
}
