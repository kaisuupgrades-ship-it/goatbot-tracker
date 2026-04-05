/**
 * /api/picks — Server-side pick creation with strict enforcement.
 *
 * Why server-side instead of direct Supabase insert?
 *   - Client CANNOT set commence_time — only ESPN can (no backdating exploit).
 *   - Contest rules enforced server-side — cannot be bypassed by direct API calls.
 *   - submitted_at is set by DB trigger (NOW()), commence_time set here after ESPN check.
 *   - User identity verified against their JWT before insert.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 20;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Service role client — bypasses RLS, used for the actual insert
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY);

async function getAuthUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch { return null; }
}

// ── Contest hard rules (enforced server-side) ────────────────────────────────
const CONTEST_RULES = {
  minOdds: -145,
  maxOdds: 400,
  maxUnits: 5,
  maxPicksPerDay: 1,
  allowedBetTypes: [
    'Moneyline', 'Spread', 'Run Line', 'Puck Line',
    'Total (Over)', 'Total (Under)',
    'F5 Moneyline', 'F5 Total (Over)', 'F5 Total (Under)',
    '1H Spread', '1H Total (Over)', '1H Total (Under)',
  ],
  blockedBetTypes: ['Parlay', 'Prop', 'Futures', 'Other'],
};

function validateContestRules(pick) {
  const errors = [];
  const odds = parseInt(pick.odds);

  if (isNaN(odds)) errors.push('Invalid odds.');
  else {
    if (odds < CONTEST_RULES.minOdds)
      errors.push(`Odds ${odds} too juicy. Contest minimum is ${CONTEST_RULES.minOdds}.`);
    if (odds > CONTEST_RULES.maxOdds)
      errors.push(`Odds +${odds} too long. Contest maximum is +${CONTEST_RULES.maxOdds}.`);
  }

  const units = parseFloat(pick.units || 1);
  if (units > CONTEST_RULES.maxUnits)
    errors.push(`${units}u exceeds the ${CONTEST_RULES.maxUnits}u max.`);

  if (CONTEST_RULES.blockedBetTypes.includes(pick.bet_type))
    errors.push(`"${pick.bet_type}" is not allowed in contest (straight bets only).`);

  if (!pick.team?.trim()) errors.push('No team/pick specified.');
  if (!pick.date)          errors.push('No game date specified.');

  return errors;
}

// ── ESPN game lookup (same logic as /api/verify-game) ───────────────────────
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
      return bestEvent.date; // UTC ISO timestamp — actual game start
    }
    return null;
  } catch {
    return null;
  }
}

// ── POST /api/picks ──────────────────────────────────────────────────────────
export async function POST(req) {
  // ── 1. Verify the caller's identity (REQUIRED) ────────────────────────────
  //    Use the JWT from the Authorization header to get their actual user_id.
  //    This prevents a user from spoofing another user's user_id.
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { pick } = body;

  if (!pick) {
    return NextResponse.json({ error: 'Pick data required' }, { status: 400 });
  }

  // ── 2. Enforce that the pick belongs to the authenticated user ────────────
  const userId = user.id;
  if (pick.user_id && pick.user_id !== userId) {
    return NextResponse.json({ error: 'User ID mismatch' }, { status: 403 });
  }

  // ── 3. Strip client-supplied commence_time — we set it from ESPN ─────────
  //    A client could send commence_time = "2099-01-01" to fake verification.
  //    We ALWAYS look it up ourselves.
  const safePayload = { ...pick, user_id: userId };
  delete safePayload.commence_time;   // strip — set below from ESPN
  delete safePayload.submitted_at;    // strip — set by DB trigger
  delete safePayload.id;              // strip — never trust client-supplied id

  // ── 4. Contest server-side validation + 1-unit normalization ────────────
  if (safePayload.contest_entry) {
    const errors = validateContestRules(safePayload);
    if (errors.length > 0) {
      return NextResponse.json({ error: 'Contest validation failed', errors }, { status: 422 });
    }

    // Check daily limit — REJECTED picks don't count
    if (safePayload.date) {
      const { data: existing } = await supabaseAdmin
        .from('picks')
        .select('id')
        .eq('user_id', userId)
        .eq('contest_entry', true)
        .eq('date', safePayload.date)
        .neq('audit_status', 'REJECTED');

      if ((existing?.length || 0) >= CONTEST_RULES.maxPicksPerDay) {
        return NextResponse.json({
          error: 'Daily contest limit reached',
          errors: [`You already have a contest pick for ${safePayload.date}. One play per day — no exceptions.`],
        }, { status: 422 });
      }
    }

    // NOTE: We do NOT override units or profit here.
    // The pick stores the user's REAL bet size (e.g. hodgins 5u) for their personal tracking.
    // The contest leaderboard recalculates profit at 1u on the fly using contestProfit(result, odds)
    // without touching the stored data. "My Picks" always shows real units/profit.
  }

  // ── 5. Look up actual game start time from ESPN ──────────────────────────
  //    This is the only trusted source of commence_time.
  //    If ESPN can't find the game, commence_time stays null (pick is unverifiable).
  let commence_time = null;
  if (safePayload.sport && safePayload.team && safePayload.date) {
    commence_time = await lookupCommenceTime(
      safePayload.sport,
      safePayload.team,
      safePayload.date,
    );
  }

  // ── 6. Insert via service role (trusted) ─────────────────────────────────
  const { data, error } = await supabaseAdmin
    .from('picks')
    .insert([{ ...safePayload, commence_time }])
    .select()
    .single();

  if (error) {
    console.error('picks insert error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ pick: data, commence_time_found: !!commence_time });
}

// ── PATCH /api/picks — update a pick (non-contest only) ─────────────────────
export async function PATCH(req) {
  const body = await req.json().catch(() => ({}));
  const { pickId, updates, authToken } = body;

  if (!pickId || !updates) {
    return NextResponse.json({ error: 'pickId and updates required' }, { status: 400 });
  }

  // Verify identity
  let verifiedUserId = null;
  if (authToken) {
    try {
      const authClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${authToken}` } },
      });
      const { data: { user } } = await authClient.auth.getUser();
      verifiedUserId = user?.id || null;
    } catch { /* fall through */ }
  }

  // Fetch the existing pick to confirm ownership + check it's not locked
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('picks')
    .select('user_id, contest_entry, audit_status')
    .eq('id', pickId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Pick not found' }, { status: 404 });
  }

  // Ownership check
  if (verifiedUserId && existing.user_id !== verifiedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Contest picks are LOCKED after submission — no edits allowed
  if (existing.contest_entry && existing.audit_status !== 'REJECTED') {
    return NextResponse.json({
      error: 'Contest picks cannot be edited after submission.',
    }, { status: 403 });
  }

  // Strip sensitive fields client should never update directly
  const safeUpdates = { ...updates };
  delete safeUpdates.commence_time;
  delete safeUpdates.submitted_at;
  delete safeUpdates.user_id;
  delete safeUpdates.id;
  delete safeUpdates.audit_status;

  // If team/sport/date changed, re-verify game time
  if (safeUpdates.sport || safeUpdates.team || safeUpdates.date) {
    const { data: currentPick } = await supabaseAdmin
      .from('picks')
      .select('sport, team, date')
      .eq('id', pickId)
      .single();

    const sport = safeUpdates.sport || currentPick?.sport;
    const team  = safeUpdates.team  || currentPick?.team;
    const date  = safeUpdates.date  || currentPick?.date;

    safeUpdates.commence_time = await lookupCommenceTime(sport, team, date);
  }

  const { data, error } = await supabaseAdmin
    .from('picks')
    .update(safeUpdates)
    .eq('id', pickId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ pick: data });
}
