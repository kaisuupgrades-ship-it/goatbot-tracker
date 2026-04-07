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
import { normalizeTeam } from '@/lib/teamNormalizer';

export const maxDuration = 20;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Service role client — bypasses RLS, used for the actual insert
// Fail-closed: if SERVICE_KEY is missing, requests will get a clear error instead of silently using anon key
const supabaseAdmin = SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY)
  : null;

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

    if (bestScore >= 40 && bestEvent?.date) {
      return bestEvent.date; // UTC ISO timestamp — actual game start
    }
    return null;
  } catch {
    return null;
  }
}

// ── Cross-market odds sanity check ──────────────────────────────────────────
// For Spread/Run Line/Puck Line picks: if the team is a moneyline underdog
// (ML positive), the spread odds should be MORE negative (worse) than the ML,
// not better. A spread price better than the ML for an underdog is a sign of
// data entry error or line shopping fraud.
const SPREAD_BET_TYPES = ['spread', 'run line', 'puck line'];

async function validateSpreadVsML(pick) {
  const betTypeLower = (pick.bet_type || '').toLowerCase();
  if (!SPREAD_BET_TYPES.some(t => betTypeLower.includes(t))) return null; // not a spread bet
  if (!pick.odds || !pick.sport || !pick.team) return null;

  const submittedOdds = parseInt(pick.odds);
  if (isNaN(submittedOdds)) return null;

  // Map pick sport to odds API cache key
  const sportKeyMap = {
    mlb: 'baseball_mlb', nba: 'basketball_nba', nfl: 'americanfootball_nfl',
    nhl: 'icehockey_nhl', ncaaf: 'americanfootball_ncaaf', ncaab: 'basketball_ncaab',
    mls: 'soccer_usa_mls',
  };
  const sportKey = sportKeyMap[(pick.sport || '').toLowerCase()];
  if (!sportKey) return null;

  try {
    const { data: cached } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', `odds_cache_${sportKey}`)
      .maybeSingle();
    if (!cached?.value) return null;

    const payload = typeof cached.value === 'string' ? JSON.parse(cached.value) : cached.value;
    const games = payload?.data || [];
    if (!games.length) return null;

    // Find the game containing this team
    const teamNorm = (pick.team || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const game = games.find(g =>
      (g.home_team || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(teamNorm) ||
      (g.away_team || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(teamNorm) ||
      teamNorm.includes((g.home_team || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)) ||
      teamNorm.includes((g.away_team || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5))
    );
    if (!game) return null;

    // Find ML odds for this team from any bookmaker
    let mlOdds = null;
    for (const bk of (game.bookmakers || [])) {
      const h2h = bk.markets?.find(m => m.key === 'h2h');
      if (!h2h) continue;
      const outcome = h2h.outcomes?.find(o =>
        (o.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(teamNorm) ||
        teamNorm.includes((o.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5))
      );
      if (outcome?.price != null) { mlOdds = parseInt(outcome.price); break; }
    }
    if (mlOdds == null) return null;

    // If the team is an underdog on the ML (mlOdds > 0), the spread juice should
    // be MORE negative (worse payout) than the ML, not better.
    // e.g. Cubs ML +180 → Cubs +1.5 spread should be something like -130, not +220
    if (mlOdds > 0 && submittedOdds > mlOdds) {
      return {
        error: `Spread odds validation failed: ${pick.team} is a +${mlOdds} ML underdog but the submitted spread odds (+${submittedOdds}) are better than the ML. Check your odds entry — spread odds for an underdog getting +1.5 runs should be worse (more negative) than the moneyline.`,
        mlOdds,
        submittedOdds,
      };
    }
  } catch { /* non-fatal — don't block picks if validation fails */ }
  return null;
}

// ── POST /api/picks ──────────────────────────────────────────────────────────
export async function POST(req) {
  // Fail-closed: if service key is not configured, refuse to process picks
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server configuration error — please contact support' }, { status: 503 });
  }
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

  // Normalize team name deterministically (no AI call needed)
  // e.g. "Detroit" (MLB) → "Detroit Tigers", "Cubs" → "Chicago Cubs"
  if (safePayload.team && safePayload.sport) {
    safePayload.team = normalizeTeam(safePayload.team, safePayload.sport);
  }
  delete safePayload.id;              // strip — never trust client-supplied id

  // ── 3b. Extract and store structured line/side from team name ───────────
  //    "UConn Huskies +6.5" → line=6.5, cleaned team for ESPN matching
  //    This ensures the grading engine has structured data to work with.
  const betTypeLower = (safePayload.bet_type || '').toLowerCase();
  const isSpreadBet = betTypeLower.includes('spread') || betTypeLower.includes('run line') || betTypeLower.includes('puck line');
  const isTotalBet  = betTypeLower.includes('over') || betTypeLower.includes('under') || betTypeLower.includes('total');

  if (!safePayload.line && safePayload.team) {
    // Extract line from team name: "Cowboys +3.5" → 3.5, "UConn Huskies +6.5" → 6.5
    const lineMatch = safePayload.team.match(/([+-]\d+(?:\.\d+)?)\s*$/);
    if (lineMatch) {
      safePayload.line = parseFloat(lineMatch[1]);
    }
    // For totals, parse from team name: "Over 8.5" → 8.5
    if (!safePayload.line && isTotalBet) {
      const totalMatch = safePayload.team.match(/(?:over|under|o|u)\s*(\d+(?:\.\d+)?)/i);
      if (totalMatch) safePayload.line = parseFloat(totalMatch[1]);
    }
  }

  // ── 3c. Set pick_type — 'contest', 'verified', or 'personal' ───────────
  //    pick_type determines which leaderboards the pick feeds into.
  //    Contest = 1u normalized on contest board. Verified = Sharp Board with real units.
  //    Personal = dashboard only, no restrictions.
  if (safePayload.contest_entry || safePayload.pick_type === 'contest') {
    safePayload.pick_type = 'contest';
    safePayload.contest_entry = true;  // keep backward compat
  } else if (safePayload.pick_type === 'verified') {
    safePayload.pick_type = 'verified';
  } else {
    safePayload.pick_type = safePayload.pick_type || 'personal';
  }

  // ── 4. Contest/Verified server-side validation ─────────────────────────
  if (safePayload.pick_type === 'contest') {
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

  // ── 4b. Cross-market odds sanity check (spread vs ML) ────────────────────
  const spreadValidation = await validateSpreadVsML(safePayload);
  if (spreadValidation) {
    return NextResponse.json({
      error: 'Cross-market odds validation failed',
      errors: [spreadValidation.error],
    }, { status: 422 });
  }

  // ── 4c. Odds sign validation for contest/verified picks ────────────────
  //    Cross-reference submitted odds against cached Odds API data.
  //    If user submits +350 but market shows -350, flag it.
  //    This prevents accidental sign errors that massively inflate profits.
  if ((safePayload.pick_type === 'contest' || safePayload.pick_type === 'verified') && safePayload.odds && safePayload.team) {
    try {
      const oddsApiSport = {
        MLB: 'mlb', NBA: 'nba', NFL: 'nfl', NHL: 'nhl',
        NCAAB: 'ncaab', NCAAF: 'ncaaf', MLS: 'mls',
      }[(safePayload.sport || '').toUpperCase()];
      if (oddsApiSport) {
        const oddsRes = await fetch(`${SUPABASE_URL.replace('.supabase.co', '.supabase.co')}/rest/v1/settings?key=eq.odds_cache_${oddsApiSport}&select=value`, {
          headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
        });
        const oddsRows = await oddsRes.json().catch(() => []);
        if (oddsRows?.[0]?.value) {
          const cached = typeof oddsRows[0].value === 'string' ? JSON.parse(oddsRows[0].value) : oddsRows[0].value;
          const events = cached?.data || [];
          // Find the matching game
          const cleanTeam = (safePayload.team || '').replace(/\s*[+-]\d+(?:\.\d+)?\s*$/, '').toLowerCase();
          for (const ev of events) {
            const home = (ev.home_team || '').toLowerCase();
            const away = (ev.away_team || '').toLowerCase();
            if (home.includes(cleanTeam) || away.includes(cleanTeam) || cleanTeam.includes(home.split(' ').pop()) || cleanTeam.includes(away.split(' ').pop())) {
              // Found the game — check if odds sign is correct
              const bestBook = ev.bookmakers?.find(b => b.key === 'fanduel') || ev.bookmakers?.find(b => b.key === 'draftkings') || ev.bookmakers?.[0];
              const h2h = bestBook?.markets?.find(m => m.key === 'h2h');
              if (h2h?.outcomes) {
                const submittedOdds = parseInt(safePayload.odds);
                // Find the team the user bet on
                const matchedOutcome = h2h.outcomes.find(o =>
                  o.name.toLowerCase().includes(cleanTeam) || cleanTeam.includes(o.name.toLowerCase().split(' ').pop())
                );
                if (matchedOutcome) {
                  const marketOdds = matchedOutcome.price;
                  // Check for sign mismatch (user says + but market says -, or vice versa)
                  if ((submittedOdds > 0 && marketOdds < -150) || (submittedOdds < -150 && marketOdds > 0)) {
                    return NextResponse.json({
                      error: 'Odds sign mismatch detected',
                      errors: [
                        `You entered ${submittedOdds > 0 ? '+' : ''}${submittedOdds} but the market has ${matchedOutcome.name} at ${marketOdds > 0 ? '+' : ''}${marketOdds}. Did you mean ${marketOdds > 0 ? '+' : ''}${marketOdds}?`,
                        'Please double-check your odds and resubmit.',
                      ],
                      marketOdds,
                      submittedOdds,
                    }, { status: 422 });
                  }
                  // Check for wildly different magnitude (>100 pts off)
                  if (Math.abs(submittedOdds - marketOdds) > 100) {
                    // Don't hard-block, but flag for audit
                    safePayload.audit_status = 'FLAGGED';
                    safePayload.audit_reason = `Odds discrepancy: submitted ${submittedOdds}, market shows ${marketOdds} for ${matchedOutcome.name}`;
                  }
                }
              }
              break;
            }
          }
        }
      }
    } catch (err) {
      // Odds validation is non-fatal — don't block picks if cache lookup fails
      console.warn('[picks] Odds validation failed:', err.message);
    }
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

  // ── 5b. HARD BLOCK: contest/verified picks must be submitted BEFORE game ──
  //    This is the definitive integrity check. We just fetched the real game
  //    start from ESPN — if the clock has already passed it, the pick is dead.
  //    Contest picks = hard block. Verified picks = downgrade to personal.
  //    Personal picks = no timing restrictions (user's own tracking).
  if ((safePayload.pick_type === 'contest' || safePayload.pick_type === 'verified') && commence_time) {
    const submittedAt = new Date();
    const gameStart   = new Date(commence_time);
    const GRACE_MS    = 2 * 60 * 1000; // 2-minute grace window

    if (submittedAt.getTime() > gameStart.getTime() + GRACE_MS) {
      const startedAgo = Math.round((submittedAt - gameStart) / 60000);

      if (safePayload.pick_type === 'contest') {
        // Contest = hard block, no in-game picks allowed
        return NextResponse.json({
          error: 'Game already started',
          errors: [
            `This game started ${startedAgo} minute${startedAgo !== 1 ? 's' : ''} ago — contest picks must be submitted before game time.`,
            'You can still log it as a personal pick.',
          ],
          commence_time,
          submitted_at: submittedAt.toISOString(),
        }, { status: 422 });
      } else {
        // Verified → downgrade to personal (live bets can still be tracked, just not verified)
        safePayload.pick_type = 'personal';
      }
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

  // ── Award XP for submitting a pick (+5 XP) ───────────────────────────────
  try {
    const RANKS = [
      { title: 'Degenerate', minXp: 0 }, { title: 'Square', minXp: 100 },
      { title: 'Handicapper', minXp: 300 }, { title: 'Sharp', minXp: 700 },
      { title: 'Steam Chaser', minXp: 1500 }, { title: 'Wiseguy', minXp: 3000 },
      { title: 'Line Mover', minXp: 6000 }, { title: 'Syndicate', minXp: 10000 },
      { title: 'Whale', minXp: 20000 }, { title: 'Legend', minXp: 40000 },
    ];
    const { data: profile } = await supabaseAdmin.from('profiles').select('xp').eq('id', userId).single();
    const newXp = (profile?.xp || 0) + 5;
    let rank = RANKS[0];
    for (const r of RANKS) { if (newXp >= r.minXp) rank = r; }
    await supabaseAdmin.from('profiles').update({ xp: newXp, rank_title: rank.title }).eq('id', userId);
  } catch { /* non-critical */ }

  return NextResponse.json({ pick: data, commence_time_found: !!commence_time });
}

// ── PATCH /api/picks — update a pick ─────────────────────────────────────────
// Users can edit picks BEFORE the game starts (fixes typos, etc.).
// If the game has already started the edit is blocked — the pick stays as-is.
// Already-graded picks (result != null) cannot be edited.
export async function PATCH(req) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 503 });
  }
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
    .select('user_id, contest_entry, audit_status, result, commence_time, sport, team, date, pick_type')
    .eq('id', pickId)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Pick not found' }, { status: 404 });
  }

  // Ownership check — require valid auth
  if (!verifiedUserId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (existing.user_id !== verifiedUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Already-graded picks cannot be edited
  if (existing.result && existing.result !== 'PENDING') {
    return NextResponse.json({ error: 'This pick has already been graded and cannot be edited.' }, { status: 403 });
  }

  // Check if game has started — if so, block the edit
  const EDIT_GRACE_MS = 2 * 60 * 1000;
  let gameStarted = false;
  if (existing.commence_time) {
    gameStarted = Date.now() > new Date(existing.commence_time).getTime() + EDIT_GRACE_MS;
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
    delete safeUpdates.pick_type;
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