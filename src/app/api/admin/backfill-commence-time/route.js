/**
 * POST /api/admin/backfill-commence-time
 *
 * One-time (or re-runnable) script that backfills `commence_time` on historical
 * picks that have NULL commence_time.  Uses the same ESPN scoreboard lookup that
 * the POST /api/picks route uses for new picks.
 *
 * Auth: JWT — admin only.
 *
 * Body (optional):
 *   { "limit": 50, "dryRun": false }
 *
 * The script processes picks in batches, with a 200ms delay between ESPN calls
 * to be kind to the ESPN API.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 120; // 2 minute timeout — backfill can be slow

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isAdmin(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

async function getAdminUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    if (!isAdmin(user.email)) return null;
    return user;
  } catch { return null; }
}

// ── ESPN lookup (copied from /api/picks) ────────────────────────────────────
const ESPN_ENDPOINTS = {
  NBA: 'basketball/nba', NCAAB: 'basketball/mens-college-basketball',
  WNBA: 'basketball/wnba', NFL: 'football/nfl', NCAAF: 'football/college-football',
  MLB: 'baseball/mlb', NHL: 'hockey/nhl', MLS: 'soccer/usa.1',
  EPL: 'soccer/eng.1', UCL: 'soccer/uefa.champions',
};

function normalizeSport(sport) {
  if (!sport) return null;
  const s = sport.toUpperCase().trim();
  if (ESPN_ENDPOINTS[s] !== undefined) return s;
  const aliases = {
    'COLLEGE BASKETBALL': 'NCAAB', 'CBB': 'NCAAB',
    "MEN'S COLLEGE BASKETBALL": 'NCAAB', 'COLLEGE FOOTBALL': 'NCAAF',
    'CFB': 'NCAAF', 'PREMIER LEAGUE': 'EPL', 'CHAMPIONS LEAGUE': 'UCL',
  };
  return aliases[s] || null;
}

async function lookupCommenceTime(sport, team, dateStr) {
  const sportKey = normalizeSport(sport);
  if (!sportKey || !ESPN_ENDPOINTS[sportKey]) return null;

  const espnDate = dateStr?.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_ENDPOINTS[sportKey]}/scoreboard?limit=100${espnDate ? `&dates=${espnDate}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const events = json.events || [];

    const query = (team || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const queryWords = query.split(/\s+/).filter(Boolean);

    let bestEvent = null;
    let bestScore = 0;

    for (const evt of events) {
      const comps = evt.competitions?.[0]?.competitors || [];
      const names = comps.flatMap(c => [
        c.team?.displayName, c.team?.shortDisplayName,
        c.team?.name, c.team?.abbreviation, c.team?.nickname,
      ]).filter(Boolean).map(n => n.toLowerCase());

      let score = 0;
      if (names.some(n => n === query)) score = 100;
      else if (names.some(n => n.includes(query) || query.includes(n))) score = 60;
      else score = queryWords.filter(w => names.some(n => n.includes(w))).length * 20;

      if (dateStr && evt.date?.split('T')[0] === dateStr) score += 30;

      if (score > bestScore) { bestScore = score; bestEvent = evt; }
    }

    if (bestScore >= 20 && bestEvent?.date) {
      return bestEvent.date;
    }
    return null;
  } catch {
    return null;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Fetch all events for a sport+date from ESPN and return the raw events array.
 * Results are cached so we only hit ESPN once per sport+date combo.
 */
const eventsCache = {};

async function getEventsForDate(sport, dateStr) {
  const sportKey = normalizeSport(sport);
  if (!sportKey || !ESPN_ENDPOINTS[sportKey]) return [];

  const key = `${sportKey}||${dateStr}`;
  if (eventsCache[key] !== undefined) return eventsCache[key];

  const espnDate = dateStr?.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${ESPN_ENDPOINTS[sportKey]}/scoreboard?limit=100${espnDate ? `&dates=${espnDate}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) { eventsCache[key] = []; return []; }
    const json = await res.json();
    eventsCache[key] = json.events || [];
    await sleep(150); // rate limit
  } catch {
    eventsCache[key] = [];
  }
  return eventsCache[key];
}

/**
 * Match a team name against cached events to find the commence_time.
 */
function matchTeamInEvents(events, team, dateStr) {
  const query = (team || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const queryWords = query.split(/\s+/).filter(Boolean);
  if (!query) return null;

  let bestEvent = null;
  let bestScore = 0;

  for (const evt of events) {
    const comps = evt.competitions?.[0]?.competitors || [];
    const names = comps.flatMap(c => [
      c.team?.displayName, c.team?.shortDisplayName,
      c.team?.name, c.team?.abbreviation, c.team?.nickname,
    ]).filter(Boolean).map(n => n.toLowerCase());

    let score = 0;
    if (names.some(n => n === query)) score = 100;
    else if (names.some(n => n.includes(query) || query.includes(n))) score = 60;
    else score = queryWords.filter(w => names.some(n => n.includes(w))).length * 20;

    if (dateStr && evt.date?.split('T')[0] === dateStr) score += 30;
    if (score > bestScore) { bestScore = score; bestEvent = evt; }
  }

  if (bestScore >= 20 && bestEvent?.date) return bestEvent.date;
  return null;
}

export async function POST(req) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const limit  = Math.min(body.limit || 500, 1000);
  const dryRun = !!body.dryRun;

  // Fetch picks that have NULL commence_time and have a sport, team, and date
  const { data: picks, error: fetchErr } = await supabaseAdmin
    .from('picks')
    .select('id, sport, team, date, created_at')
    .is('commence_time', null)
    .not('sport', 'is', null)
    .not('team', 'is', null)
    .not('date', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!picks.length) {
    return NextResponse.json({ message: 'No picks need backfilling', total: 0, updated: 0, failed: 0 });
  }

  const results = { total: picks.length, updated: 0, failed: 0, skipped: 0, details: [] };

  for (const pick of picks) {
    // Get events (cached per sport+date, so ESPN is only called once per combo)
    const events = await getEventsForDate(pick.sport, pick.date);
    const ct = matchTeamInEvents(events, pick.team, pick.date);

    if (!ct) {
      results.skipped++;
      results.details.push({ id: pick.id.slice(0, 8), team: pick.team, date: pick.date, status: 'not_found' });
      continue;
    }

    if (dryRun) {
      results.updated++;
      results.details.push({ id: pick.id.slice(0, 8), team: pick.team, date: pick.date, commence_time: ct, status: 'dry_run' });
      continue;
    }

    // Update the pick
    const { error: updateErr } = await supabaseAdmin
      .from('picks')
      .update({ commence_time: ct })
      .eq('id', pick.id)
      .is('commence_time', null); // safety: don't overwrite if already set

    if (updateErr) {
      results.failed++;
      results.details.push({ id: pick.id.slice(0, 8), team: pick.team, date: pick.date, status: 'error', error: updateErr.message });
    } else {
      results.updated++;
      results.details.push({ id: pick.id.slice(0, 8), team: pick.team, date: pick.date, commence_time: ct, status: 'updated' });
    }
  }

  const espnCallCount = Object.keys(eventsCache).length;

  return NextResponse.json({
    message: dryRun ? 'Dry run complete - no changes made' : 'Backfill complete',
    ...results,
    espnCalls: espnCallCount,
    adminEmail: admin.email,
  });
}
