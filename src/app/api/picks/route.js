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
import { CONTEST_RULES, validateContestEligibility } from '@/lib/contestRules';

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

// CONTEST_RULES and validateContestEligibility are imported from @/lib/contestRules

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

    if (bestScore >= 50 && bestEvent?.date) {
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

// ── Verification Engine ──────────────────────────────────────────────────────
// Maps pick sport string → The Odds API cache key used in settings table
const SPORT_TO_ODDS_KEY = {
  MLB:   'baseball_mlb',          NBA:  'basketball_nba',
  NFL:   'americanfootball_nfl',  NHL:  'icehockey_nhl',
  NCAAF: 'americanfootball_ncaaf', NCAAB: 'basketball_ncaab',
  MLS:   'soccer_usa_mls',        WNBA: 'basketball_wnba',
};

// Maps bet_type label → odds API market key
function betTypeToMarketKey(betType) {
  const t = (betType || '').toLowerCase();
  if (t.includes('moneyline') || t === 'f5 moneyline' || t === 'draw') return 'h2h';
  if (t.includes('spread') || t.includes('run line') || t.includes('puck line')) return 'spreads';
  if (t.includes('over') || t.includes('under') || t.includes('total')) return 'totals';
  return null; // props, parlays, exotics — not verifiable via odds_cache
}

function normStr(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function teamsMatch(a, b) {
  const na = normStr(a), nb = normStr(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Last-word mascot match (e.g. "yankees" in "newyorkyankees")
  if (na.length >= 4 && nb.length >= 4) {
    const lastA = na.slice(-Math.min(7, na.length));
    const lastB = nb.slice(-Math.min(7, nb.length));
    if (lastA === lastB && lastA.length >= 4) return true;
  }
  return false;
}

// Find game in odds_cache settings key matching a team norm string
async function findGameInOddsCache(teamNorm, oddsKey) {
  try {
    const { data: row } = await supabaseAdmin
      .from('settings')
      .select('value')
      .eq('key', `odds_cache_${oddsKey}`)
      .maybeSingle();
    if (!row?.value) return null;
    const payload = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    const games = payload?.data || [];
    return games.find(g =>
      teamsMatch(g.home_team, teamNorm) || teamsMatch(g.away_team, teamNorm)
    ) || null;
  } catch { return null; }
}

// Check submitted odds + line against all bookmakers. Returns { found, medianOdds, marketLine, oddsDiff, lineDiff }
function checkOddsAndLine(game, marketKey, sideNorm, submittedOdds, submittedLine) {
  const prices = [];
  let marketLine = null;
  const isTotals = marketKey === 'totals';

  for (const bk of (game.bookmakers || [])) {
    const market = bk.markets?.find(m => m.key === marketKey);
    if (!market) continue;
    for (const outcome of (market.outcomes || [])) {
      let matches = false;
      if (isTotals) {
        // sideNorm is 'over' or 'under'
        matches = normStr(outcome.name) === sideNorm;
      } else {
        matches = teamsMatch(outcome.name, sideNorm);
      }
      if (matches && outcome.price != null) {
        const price = parseInt(outcome.price);
        if (!isNaN(price)) prices.push(price);
        if (outcome.point != null && marketLine == null) marketLine = parseFloat(outcome.point);
      }
    }
  }

  if (prices.length === 0) return { found: false };

  prices.sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const medianOdds = prices.length % 2 === 0
    ? Math.round((prices[mid - 1] + prices[mid]) / 2)
    : prices[mid];

  const oddsDiff = Math.abs(submittedOdds - medianOdds);
  const lineDiff = (submittedLine != null && marketLine != null)
    ? Math.abs(Math.abs(submittedLine) - Math.abs(marketLine))
    : null;

  return { found: true, medianOdds, marketLine, oddsDiff, lineDiff };
}

/**
 * Main auto-verification engine. Runs after ESPN commence_time lookup.
 * Returns { verified: bool, reasons: string[], marketOdds, marketLine, isLive }
 */
async function runVerificationEngine(pick, commenceTime) {
  const reasons = [];
  const now = new Date();

  // 1. Game must exist in ESPN (require commence_time)
  if (!commenceTime) {
    reasons.push('Game not found in ESPN — could not confirm timing or game existence');
    return { verified: false, reasons };
  }

  const gameStart = new Date(commenceTime);
  const GRACE_MS  = 2 * 60 * 1000; // 2-minute grace
  const isPregame = now.getTime() <= gameStart.getTime() + GRACE_MS;

  // 2. Look up game in odds_cache
  const oddsKey  = SPORT_TO_ODDS_KEY[(pick.sport || '').toUpperCase()];
  // Strip any line suffix from team name before matching (e.g. "Cowboys +3.5" → "Cowboys")
  const cleanedTeam = (pick.team || '').replace(/\s*[+-]\d+(?:\.\d+)?\s*$/, '');
  const teamNorm = normStr(cleanedTeam);
  let oddsGame = null;
  if (oddsKey && teamNorm) {
    oddsGame = await findGameInOddsCache(teamNorm, oddsKey);
  }

  // 3. Timing check
  if (!isPregame) {
    if (!oddsGame) {
      // Game started and is no longer in the live odds feed → no live bets
      const minsLate = Math.round((now.getTime() - gameStart.getTime()) / 60000);
      reasons.push(`Game started ${minsLate} minute${minsLate !== 1 ? 's' : ''} ago and is no longer accepting bets`);
      return { verified: false, reasons };
    }
    // Game has started but is still in odds_cache — live bet, allow verification to continue
  }

  // 4. Game must exist in odds_cache
  if (!oddsGame) {
    reasons.push('Game not found in odds cache — odds not yet available or sport not supported');
    return { verified: false, reasons };
  }

  // 5. Map bet_type to market
  const marketKey = betTypeToMarketKey(pick.bet_type);
  if (!marketKey) {
    reasons.push(`"${pick.bet_type}" cannot be automatically verified — only ML, spread, and totals are supported`);
    return { verified: false, reasons };
  }

  // For totals pick direction comes from the bet_type label
  let sideNorm = teamNorm;
  if (marketKey === 'totals') {
    sideNorm = (pick.bet_type || '').toLowerCase().includes('over') ? 'over' : 'under';
  }

  const submittedOdds = parseInt(pick.odds);
  const submittedLine = pick.line ?? null;
  const oddsCheck = checkOddsAndLine(oddsGame, marketKey, sideNorm, submittedOdds, submittedLine);

  if (!oddsCheck.found) {
    reasons.push(`Could not match "${pick.team}" to any bookmaker in the ${marketKey} market`);
    return { verified: false, reasons };
  }

  // 6. Odds within 20 points of median across bookmakers
  if (oddsCheck.oddsDiff > 20) {
    const sub = submittedOdds > 0 ? `+${submittedOdds}` : `${submittedOdds}`;
    const mkt = oddsCheck.medianOdds > 0 ? `+${oddsCheck.medianOdds}` : `${oddsCheck.medianOdds}`;
    reasons.push(`Odds differ from market by ${oddsCheck.oddsDiff} points (submitted: ${sub}, market median: ${mkt})`);
  }

  // 7. Line within 0.5 of market (spreads/totals only)
  if (oddsCheck.lineDiff !== null && oddsCheck.lineDiff > 0.5) {
    reasons.push(`Line differs from market by ${oddsCheck.lineDiff.toFixed(1)} (submitted: ${submittedLine}, market: ${oddsCheck.marketLine})`);
  }

  return {
    verified:    reasons.length === 0,
    reasons,
    marketOdds:  oddsCheck.medianOdds ?? null,
    marketLine:  oddsCheck.marketLine ?? null,
    isLive:      !isPregame,
  };
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

  // ── 3c. Record contest intent — server will set pick_type automatically ─
  //    Users opt into contest; the verification engine decides verified vs personal.
  //    Strip any client-supplied pick_type — the server is authoritative.
  const wantsContest = !!(safePayload.contest_entry || pick.pick_type === 'contest');
  delete safePayload.pick_type;    // server sets this below after verification
  safePayload.contest_entry = false; // will be set true only if contest passes

  // ── 4. Cross-market odds sanity check (spread vs ML) — kept as hard block ─
  //    A spread price better than the ML for an underdog is a data entry error.
  const spreadValidation = await validateSpreadVsML(safePayload);
  if (spreadValidation) {
    return NextResponse.json({
      error: 'Cross-market odds validation failed',
      errors: [spreadValidation.error],
    }, { status: 422 });
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

  // ── 5b. Auto-verification engine ─────────────────────────────────────────
  //    Checks: timing, game in odds_cache, odds within 20pt of median, line within 0.5.
  //    The result drives pick_type — no client override allowed.
  const verificationResult = await runVerificationEngine(safePayload, commence_time);

  // ── 5c. If contest was requested, validate contest rules on top of verification
  let contestValidation = { eligible: false, reasons: [] };
  if (wantsContest && verificationResult.verified) {
    // Check daily contest limit (REJECTED picks don't count)
    let dailyCount = 0;
    if (safePayload.date) {
      const { data: existing } = await supabaseAdmin
        .from('picks')
        .select('id')
        .eq('user_id', userId)
        .eq('contest_entry', true)
        .eq('date', safePayload.date)
        .neq('audit_status', 'REJECTED');
      dailyCount = existing?.length || 0;
    }
    contestValidation = validateContestEligibility(safePayload, dailyCount);
  } else if (wantsContest && !verificationResult.verified) {
    contestValidation.reasons = ['Pick must pass verification before it can enter the contest'];
  }

  // ── 5d. Set pick_type and verification columns based on results ──────────
  if (verificationResult.verified) {
    if (wantsContest && contestValidation.eligible) {
      safePayload.pick_type    = 'contest';
      safePayload.contest_entry = true;
    } else {
      safePayload.pick_type    = 'verified';
    }
  } else {
    safePayload.pick_type    = 'personal';
    safePayload.contest_entry = false;
  }
  safePayload.verification_status  = verificationResult.verified ? 'verified' : 'unverified';
  safePayload.verification_reasons = verificationResult.reasons?.length > 0
    ? verificationResult.reasons : null;

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

  return NextResponse.json({
    pick: data,
    commence_time_found: !!commence_time,
    verification: {
      status:          verificationResult.verified ? 'verified' : 'unverified',
      reasons:         verificationResult.reasons  || [],
      contest_eligible: wantsContest && verificationResult.verified && contestValidation.eligible,
      contest_reasons:  wantsContest ? (contestValidation.reasons || []) : [],
    },
  });
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