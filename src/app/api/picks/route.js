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
  SOCCER: 'soccer/usa.1',  // generic fallback — also tries other leagues below
  'LA LIGA': 'soccer/esp.1', 'SERIE A': 'soccer/ita.1',
  'BUNDESLIGA': 'soccer/ger.1', 'LIGUE 1': 'soccer/fra.1',
};

// Additional soccer league paths to try when sport is generic "Soccer"
const SOCCER_FALLBACK_LEAGUES = [
  'soccer/eng.1', 'soccer/esp.1', 'soccer/ita.1', 'soccer/ger.1',
  'soccer/fra.1', 'soccer/uefa.champions', 'soccer/uefa.europa',
];

function normalizeSport(sport) {
  if (!sport) return null;
  const s = sport.toUpperCase().trim();
  if (ESPN_ENDPOINTS[s] !== undefined) return s;
  const aliases = {
    'COLLEGE BASKETBALL': 'NCAAB', 'CBB': 'NCAAB',
    "MEN'S COLLEGE BASKETBALL": 'NCAAB', 'COLLEGE FOOTBALL': 'NCAAF',
    'CFB': 'NCAAF', 'PREMIER LEAGUE': 'EPL', 'CHAMPIONS LEAGUE': 'UCL',
    'SOCCER': 'SOCCER', 'FUTBOL': 'SOCCER', 'FOOTBALL (SOCCER)': 'SOCCER',
  };
  return aliases[s] || null;
}

/**
 * Clean team name for ESPN matching — strip bet type suffixes like "ML", "-1.5",
 * odds like "+110", and common noise that users add to the team field.
 */
function cleanTeamForLookup(team) {
  if (!team) return '';
  return team
    .replace(/\s+(ML|ml|Ml)\b/g, '')                     // "Cubs ML" → "Cubs"
    .replace(/\s+[+-]?\d+\.?\d*\s*$/g, '')                // "Tigers -1.5" → "Tigers"
    .replace(/\s+\([+-]?\d+\)/g, '')                       // "Cubs (+110)" → "Cubs"
    .replace(/\s+(over|under|o|u)\s+[\d.]+/gi, '')         // "Cubs over 8.5" → "Cubs"
    .replace(/\s+(spread|run line|puck line)/gi, '')        // "Cubs spread" → "Cubs"
    .trim();
}

async function lookupCommenceTime(sport, team, dateStr) {
  const sportKey = normalizeSport(sport);
  if (!sportKey) return null;

  const cleaned = cleanTeamForLookup(team);
  const espnDate = dateStr?.replace(/-/g, '');

  // Build list of ESPN paths to try
  const paths = [];
  if (ESPN_ENDPOINTS[sportKey]) paths.push(ESPN_ENDPOINTS[sportKey]);
  // For generic "Soccer", also try all major leagues
  if (sportKey === 'SOCCER') {
    for (const p of SOCCER_FALLBACK_LEAGUES) {
      if (!paths.includes(p)) paths.push(p);
    }
  }

  for (const path of paths) {
    const result = await searchESPNScoreboard(path, cleaned, espnDate, dateStr);
    if (result) return result;
  }

  // Last resort: try with the original (uncleaned) team name in case cleaning was too aggressive
  if (cleaned !== team) {
    for (const path of paths) {
      const result = await searchESPNScoreboard(path, team, espnDate, dateStr);
      if (result) return result;
    }
  }

  return null;
}

async function searchESPNScoreboard(path, team, espnDate, dateStr) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?limit=100${espnDate ? `&dates=${espnDate}` : ''}`;

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

  // ── 5b. HARD BLOCK: contest picks must be submitted BEFORE game starts ───
  //    This is the definitive integrity check. We just fetched the real game
  //    start from ESPN — if the clock has already passed it, the pick is dead.
  //    We give a 2-minute grace window to account for close submissions and
  //    clock skew, but no more.
  if (safePayload.contest_entry && commence_time) {
    const submittedAt = new Date();
    const gameStart   = new Date(commence_time);
    const GRACE_MS    = 2 * 60 * 1000; // 2-minute grace window

    if (submittedAt.getTime() > gameStart.getTime() + GRACE_MS) {
      const startedAgo = Math.round((submittedAt - gameStart) / 60000);
      return NextResponse.json({
        error: 'Game already started',
        errors: [
          `This game started ${startedAgo} minute${startedAgo !== 1 ? 's' : ''} ago — contest picks must be submitted before game time.`,
          'You can still log it as a personal pick (uncheck "Contest Entry").',
        ],
        commence_time,
        submitted_at: submittedAt.toISOString(),
      }, { status: 422 });
    }
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

// ── PATCH /api/picks — update a pick ─────────────────────────────────────────
// Users can edit picks BEFORE the game starts (fixes typos, etc.).
// If the game has already started the edit is blocked — the pick stays as-is.
// Already-graded picks (result != null) cannot be edited.
export async function PATCH(req) {
  const body = await req.json().catch(() => ({}));
  const { pickId, updates, authToken } = body;

  if (!pickId || !updates) {
    return NextResponse.json({ error: 'pickId and updates required' }, { status: 400 });
  }

  // Verify identity — prefer Authorization header, fall back to body token
  let verifiedUserId = null;
  const headerAuth = req.headers.get('authorization') || '';
  const token = headerAuth.replace(/^Bearer\s+/i, '').trim() || authToken;
  if (token) {
    try {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && user) verifiedUserId = user.id;
    } catch { /* fall through */ }
  }

  // Fetch the existing pick to confirm ownership + check lock status
  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('picks')
    .select('user_id, contest_entry, audit_status, result, commence_time, sport, team, date')
    .eq('id', pickId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Pick not found' }, { status: 404 });
  }

  // Ownership check
  if (verifiedUserId && existing.user_id !== verifiedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Already-graded picks cannot be edited
  if (existing.result && existing.result !== 'PENDING') {
    return NextResponse.json({ error: 'This pick has already been graded and cannot be edited.' }, { status: 403 });
  }

  // Check if game has started — if so, block the edit
  const GRACE_MS = 2 * 60 * 1000; // 2-minute grace window
  let gameStarted = false;
  if (existing.commence_time) {
    gameStarted = Date.now() > new Date(existing.commence_time).getTime() + GRACE_MS;
  }
  if (gameStarted) {
    return NextResponse.json({
      error: 'This game has already started — edits are locked to protect your verified record.',
    }, { status: 403 });
  }

  // Strip sensitive fields client should never update directly
  const safeUpdates = { ...updates };
  delete safeUpdates.commence_time;
  delete safeUpdates.submitted_at;
  delete safeUpdates.user_id;
  delete safeUpdates.id;
  delete safeUpdates.audit_status;
  delete safeUpdates.result;
  delete safeUpdates.profit;

  // Contest picks: only allow cosmetic edits (notes, typos in team name).
  // Cannot change sport, bet_type, odds, or contest_entry flag.
  if (existing.contest_entry && existing.audit_status !== 'REJECTED') {
    delete safeUpdates.sport;
    delete safeUpdates.bet_type;
    delete safeUpdates.odds;
    delete safeUpdates.units;
    delete safeUpdates.contest_entry;
    delete safeUpdates.date;
  }

  // If team/sport/date changed, re-verify game time from ESPN
  if (safeUpdates.sport || safeUpdates.team || safeUpdates.date) {
    const sport = safeUpdates.sport || existing.sport;
    const team  = safeUpdates.team  || existing.team;
    const date  = safeUpdates.date  || existing.date;
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
