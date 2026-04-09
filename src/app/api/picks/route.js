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

async function lookupCommenceTime(sport, team, dateStr, clientMatchup) {
  const sportKey = normalizeSport(sport);
  if (!sportKey) return null;

  // For total picks the team field is "Over 7.5" / "Under 6" — not a real team name.
  // Use the client-sent matchup string to extract a searchable team name instead.
  const isTotalTeam = /^(over|under)\s+[\d.]+$/i.test((team || '').trim());
  let cleaned = isTotalTeam ? null : cleanTeamForLookup(team);
  if (isTotalTeam && clientMatchup) {
    // clientMatchup is like "NYY @ BOS" — pull out the first token as the search term
    const parts = clientMatchup.split(/\s*[@vs]+\s*/i).filter(Boolean);
    cleaned = parts[0]?.trim() || null;
  }

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

  if (cleaned) {
    for (const path of paths) {
      const result = await searchESPNScoreboard(path, cleaned, espnDate, dateStr);
      if (result) return result;
    }

    // Last resort: try with the original (uncleaned) team name in case cleaning was too aggressive
    if (cleaned !== team && !isTotalTeam) {
      for (const path of paths) {
        const result = await searchESPNScoreboard(path, team, espnDate, dateStr);
        if (result) return result;
      }
    }
  }

  // Fallback: search odds cache by team name when ESPN doesn't find the game
  if (!isTotalTeam && cleaned && supabaseAdmin) {
    try {
      const sportKeyMap = {
        MLB: 'mlb', NBA: 'nba', NFL: 'nfl', NHL: 'nhl',
        NCAAB: 'ncaab', NCAAF: 'ncaaf', MLS: 'mls',
      };
      const oddsKey = sportKeyMap[sportKey];
      if (oddsKey) {
        const { data: cached } = await supabaseAdmin
          .from('settings').select('value').eq('key', `odds_cache_${oddsKey}`).maybeSingle();
        if (cached?.value) {
          const payload = typeof cached.value === 'string' ? JSON.parse(cached.value) : cached.value;
          const games = payload?.data || [];
          const teamNorm = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
          const game = games.find(g =>
            (g.home_team || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(teamNorm) ||
            (g.away_team || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(teamNorm) ||
            teamNorm.includes((g.home_team || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)) ||
            teamNorm.includes((g.away_team || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5))
          );
          if (game?.home_team && game?.away_team) {
            return {
              date:      game.commence_time || null,
              homeTeam:  game.home_team,
              awayTeam:  game.away_team,
            };
          }
        }
      }
    } catch { /* non-fatal */ }
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

    if (bestScore >= 50 && bestEvent?.date) {
      // Extract home/away team names from the best matching event
      const bestComps = bestEvent.competitions?.[0]?.competitors || [];
      const homeComp  = bestComps.find(c => c.homeAway === 'home');
      const awayComp  = bestComps.find(c => c.homeAway === 'away');
      return {
        date:      bestEvent.date,
        homeTeam:  homeComp?.team?.displayName || homeComp?.team?.name || null,
        awayTeam:  awayComp?.team?.displayName || awayComp?.team?.name || null,
      };
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

// ── Parlay odds helpers ───────────────────────────────────────────────────────
function americanToDecimal(american) {
  const n = parseInt(american);
  if (isNaN(n) || n === 0) return 1;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
function decimalToAmerican(decimal) {
  if (decimal <= 1) return -10000;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}
function calcParlayOdds(legs) {
  const decimal = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  return decimalToAmerican(decimal);
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
  const { pick, parlay_legs: parlayLegsInput } = body;

  // ── Parlay submission path ────────────────────────────────────────────────
  if (pick?.is_parlay || parlayLegsInput?.length >= 2) {
    return handleParlayPost(req, user, pick, parlayLegsInput);
  }

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

  // ── 3b. Extract line BEFORE team name normalization ──────────────────────
  //    MUST run before normalizeTeam() — the fuzzy normalizer strips trailing
  //    line numbers ("Boston Celtics -4.5" → "Boston Celtics") which would
  //    cause line extraction to find nothing and grade the pick as a PUSH.
  const betTypeLower = (safePayload.bet_type || '').toLowerCase();
  const isSpreadBet = betTypeLower.includes('spread') || betTypeLower.includes('run line') || betTypeLower.includes('puck line');
  const isTotalBet  = betTypeLower.includes('over') || betTypeLower.includes('under') || betTypeLower.includes('total');

  if (!safePayload.line && safePayload.team) {
    // Extract line from team name: "Boston Celtics -4.5" → -4.5, "Cowboys +3.5" → 3.5
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

  // ── 3b-ii. Clean team name — strip bet descriptions users sometimes paste in ──
  // e.g. "St. Louis Cardinals Moneyline -135" → "St. Louis Cardinals"
  // e.g. "Yankees -1.5" → "Yankees" (line already stored in safePayload.line above)
  // For total picks the team field is "Over 8.5" / "Under 8.5" — leave those as-is.
  if (safePayload.team && !isTotalBet) {
    const cleaned = safePayload.team
      .replace(/\s+(Moneyline|Money Line|ML)\b/gi, '')       // strip "Moneyline" / "ML"
      .replace(/\s+(Run Line|Puck Line|Spread)\b/gi, '')      // strip spread-type labels
      .replace(/\s+[+-]\d+(?:\.\d+)?\s*$/g, '')              // strip trailing line/odds numbers
      .replace(/\s+\([+-]?\d+\)/g, '')                        // strip odds in parens like "(+150)"
      .trim();
    if (cleaned) safePayload.team = cleaned;
  }

  // Normalize team name AFTER line extraction — normalizeTeam's fuzzy match strips
  // trailing numbers ("Boston Celtics -4.5" → "Boston Celtics"), which would
  // silently drop the line before we can save it.
  // e.g. "Detroit" (MLB) → "Detroit Tigers", "Cubs" → "Chicago Cubs"
  if (safePayload.team && safePayload.sport) {
    safePayload.team = normalizeTeam(safePayload.team, safePayload.sport);
  }

  // ── 3c. Resolve pick tier — 'contest', 'verified', or 'personal' ─────────
  //    pickTier drives timing and validation logic within this request.
  //    pick_type column will be set to the normalized BET CATEGORY below (step 3d).
  let pickTier;
  if (safePayload.contest_entry || safePayload.pick_type === 'contest') {
    pickTier = 'contest';
    safePayload.contest_entry = true;  // keep backward compat
  } else if (safePayload.pick_type === 'verified') {
    pickTier = 'verified';
  } else {
    pickTier = 'personal';
  }

  // ── 3d. Validate line for spread/total picks, then set side + normalized pick_type ──
  //    Spread picks with no line would silently grade as PUSH — reject early instead.
  if ((isSpreadBet || isTotalBet) && (safePayload.line === undefined || safePayload.line === null || isNaN(safePayload.line))) {
    return NextResponse.json({
      error: 'Spread/total picks require a line value (e.g., \'Team -3.5\' or \'Over 8.5\')',
    }, { status: 400 });
  }

  // Normalize pick_type to the bet category (moneyline / spread / total / prop).
  // This is stored in the DB and consumed by gradeEngine for quick bet-type lookups.
  if (isSpreadBet) {
    safePayload.pick_type = 'spread';
  } else if (isTotalBet) {
    safePayload.pick_type = 'total';
  } else if (betTypeLower.includes('moneyline') || betTypeLower === 'ml' || betTypeLower.includes('f5') || betTypeLower.includes('1h')) {
    safePayload.pick_type = 'moneyline';
  } else if (betTypeLower.includes('prop') || betTypeLower.includes('player')) {
    safePayload.pick_type = 'prop';
  } else {
    safePayload.pick_type = 'moneyline'; // safe default for unknown types
  }

  // ── 4. Contest/Verified server-side validation ─────────────────────────
  if (pickTier === 'contest') {
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
  if ((pickTier === 'contest' || pickTier === 'verified') && safePayload.odds && safePayload.team) {
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
  //    Also extracts home/away team names to populate matchup context.
  //    If ESPN can't find the game, commence_time stays null (pick is unverifiable).
  let commence_time = null;
  if (safePayload.sport && safePayload.team && safePayload.date) {
    const espnInfo = await lookupCommenceTime(
      safePayload.sport,
      safePayload.team,
      safePayload.date,
      safePayload.matchup,
    );
    if (espnInfo) {
      commence_time = espnInfo.date || null;
      // Populate matchup fields from ESPN if not already set by the client
      if (espnInfo.homeTeam && !safePayload.home_team) safePayload.home_team = espnInfo.homeTeam;
      if (espnInfo.awayTeam && !safePayload.away_team) safePayload.away_team = espnInfo.awayTeam;
      if (espnInfo.homeTeam && espnInfo.awayTeam && !safePayload.matchup) {
        safePayload.matchup = `${espnInfo.awayTeam} @ ${espnInfo.homeTeam}`;
      }
    }
  }

  // ── 5b-i. Populate side column if not already set ───────────────────────
  //    home/away for moneyline & spread; over/under for totals.
  //    Uses the ESPN-resolved home_team/away_team set above.
  if (!safePayload.side) {
    if (isTotalBet) {
      const teamLower = (safePayload.team || '').toLowerCase().trim();
      if (teamLower.startsWith('over'))  safePayload.side = 'over';
      if (teamLower.startsWith('under')) safePayload.side = 'under';
      // Also check bet_type itself for "Total (Over)" / "Total (Under)" style
      if (!safePayload.side) {
        if (betTypeLower.includes('over'))  safePayload.side = 'over';
        if (betTypeLower.includes('under')) safePayload.side = 'under';
      }
    } else if (safePayload.home_team || safePayload.away_team) {
      const cleanedTeam = (safePayload.team || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const homeNorm    = (safePayload.home_team || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const awayNorm    = (safePayload.away_team || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (homeNorm && (homeNorm.includes(cleanedTeam) || cleanedTeam.includes(homeNorm))) {
        safePayload.side = 'home';
      } else if (awayNorm && (awayNorm.includes(cleanedTeam) || cleanedTeam.includes(awayNorm))) {
        safePayload.side = 'away';
      }
    }
  }

  // ── 5b. HARD BLOCK: contest/verified picks must be submitted BEFORE game ──
  //    This is the definitive integrity check. We just fetched the real game
  //    start from ESPN — if the clock has already passed it, the pick is dead.
  //    Contest picks = hard block. Verified picks = downgrade to personal.
  //    Personal picks = no timing restrictions (user's own tracking).
  if ((pickTier === 'contest' || pickTier === 'verified') && commence_time) {
    const submittedAt = new Date();
    const gameStart   = new Date(commence_time);
    const GRACE_MS    = 2 * 60 * 1000; // 2-minute grace window

    if (submittedAt.getTime() > gameStart.getTime() + GRACE_MS) {
      const startedAgo = Math.round((submittedAt - gameStart) / 60000);

      if (pickTier === 'contest') {
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
        pickTier = 'personal';
        safePayload.contest_entry = false;
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

// ── handleParlayPost — parlay submission ──────────────────────────────────────
async function handleParlayPost(req, user, pick, legs) {
  if (!Array.isArray(legs) || legs.length < 2) {
    return NextResponse.json({ error: 'A parlay requires at least 2 legs' }, { status: 422 });
  }
  if (legs.length > 12) {
    return NextResponse.json({ error: 'Maximum 12 legs per parlay' }, { status: 422 });
  }

  // Validate each leg has required fields + valid odds
  for (const [i, leg] of legs.entries()) {
    if (!leg.team?.trim())    return NextResponse.json({ error: `Leg ${i + 1}: team is required` }, { status: 422 });
    if (!leg.sport?.trim())   return NextResponse.json({ error: `Leg ${i + 1}: sport is required` }, { status: 422 });
    if (!leg.bet_type?.trim()) return NextResponse.json({ error: `Leg ${i + 1}: bet_type is required` }, { status: 422 });
    const o = parseInt(leg.odds);
    if (isNaN(o) || o === 0 || Math.abs(o) < 100) {
      return NextResponse.json({ error: `Leg ${i + 1}: invalid odds (${leg.odds})` }, { status: 422 });
    }
  }

  const userId           = user.id;
  const combinedOdds     = calcParlayOdds(legs);
  const legCount         = legs.length;
  const firstGameDate    = legs.find(l => l.game_date)?.game_date
    || new Date().toISOString().split('T')[0];

  // Build the parent pick row — contest_entry is never allowed for parlays
  const pickRow = {
    user_id:               userId,
    team:                  `${legCount}-Leg Parlay`,
    sport:                 'PARLAY',
    bet_type:              'Parlay',
    odds:                  combinedOdds,
    units:                 pick?.units ?? 1,
    date:                  pick?.date  ?? firstGameDate,
    notes:                 pick?.notes ?? legs.map(l => `${l.team} ${l.bet_type}`).join(' / '),
    result:                'PENDING',
    contest_entry:         false,          // parlays are never contest picks
    pick_type:             'personal',
    is_parlay:             true,
    parlay_leg_count:      legCount,
    parlay_combined_odds:  combinedOdds,
    book:                  pick?.book ?? null,
  };

  const { data: savedPick, error: pickErr } = await supabaseAdmin
    .from('picks')
    .insert([pickRow])
    .select()
    .single();

  if (pickErr) {
    console.error('[picks] parlay insert error:', pickErr);
    return NextResponse.json({ error: pickErr.message }, { status: 500 });
  }

  // Insert each leg into parlay_legs
  const legRows = legs.map((leg, i) => ({
    pick_id:    savedPick.id,
    leg_number: i + 1,
    team:       (leg.team || '').trim(),
    sport:      (leg.sport || '').toUpperCase().trim(),
    bet_type:   (leg.bet_type || '').trim(),
    line:       leg.line != null ? parseFloat(leg.line) : null,
    odds:       parseInt(leg.odds),
    game_id:    leg.game_id  ?? null,
    home_team:  leg.home_team ?? null,
    away_team:  leg.away_team ?? null,
    game_date:  leg.game_date ?? null,
    result:     null,
  }));

  const { error: legsErr } = await supabaseAdmin.from('parlay_legs').insert(legRows);
  if (legsErr) {
    // Roll back the parent pick so we don't have an orphaned row
    await supabaseAdmin.from('picks').delete().eq('id', savedPick.id);
    console.error('[picks] parlay_legs insert error:', legsErr);
    return NextResponse.json({ error: legsErr.message }, { status: 500 });
  }

  // Award XP (+10 for a parlay — harder to build)
  try {
    const RANKS = [
      { title: 'Degenerate', minXp: 0 }, { title: 'Square', minXp: 100 },
      { title: 'Handicapper', minXp: 300 }, { title: 'Sharp', minXp: 700 },
      { title: 'Steam Chaser', minXp: 1500 }, { title: 'Wiseguy', minXp: 3000 },
      { title: 'Line Mover', minXp: 6000 }, { title: 'Syndicate', minXp: 10000 },
      { title: 'Whale', minXp: 20000 }, { title: 'Legend', minXp: 40000 },
    ];
    const { data: profile } = await supabaseAdmin.from('profiles').select('xp').eq('id', userId).single();
    const newXp = (profile?.xp || 0) + 10;
    let rank = RANKS[0];
    for (const r of RANKS) { if (newXp >= r.minXp) rank = r; }
    await supabaseAdmin.from('profiles').update({ xp: newXp, rank_title: rank.title }).eq('id', userId);
  } catch { /* non-critical */ }

  return NextResponse.json({ pick: savedPick, parlay_legs: legRows, combined_odds: combinedOdds });
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