import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callAI } from '@/lib/ai';

export const maxDuration = 60;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const ADMIN_EMAIL = 'kaisuupgrades@gmail.com';

const RULES = {
  minOdds: -145,
  maxOdds: 400,
  excludedBetTypes: ['Parlay', 'Prop', 'Futures', 'Other'],
  maxUnits: 5,
  maxPicksPerDay: 1,
};

// ── Pinnacle real-time line check (free, no key) ────────────────────────────
// Maps our sport strings to Pinnacle league IDs
const PINNACLE_LEAGUES = {
  MLB:   246,  NBA:   487,  NFL:  889,
  NHL:   1456, NCAAB: 493, NCAAF: 880,
  MLS:   2764, UFC:   906,
};

function normName(s) {
  return (s || '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function teamMatches(pickTeam, pinnacleTeam) {
  const a = normName(pickTeam), b = normName(pinnacleTeam);
  if (!a || !b) return false;
  if (a === b) return true;
  const wordsA = a.split(' '), wordsB = b.split(' ');
  const lastA = wordsA[wordsA.length - 1], lastB = wordsB[wordsB.length - 1];
  // Last word match (mascot) is the strongest signal
  if (lastA === lastB && lastA.length > 3) return true;
  // Substring match for abbreviated names (e.g. "Michigan" in "Michigan Wolverines")
  return (a.includes(lastB) && lastB.length > 4) || (b.includes(lastA) && lastA.length > 4);
}

async function checkOddsAgainstPinnacle(pick) {
  const sport = (pick.sport || '').toUpperCase();
  const leagueId = PINNACLE_LEAGUES[sport];
  if (!leagueId) return null; // sport not on Pinnacle — skip check

  const submittedOdds = parseInt(pick.odds);
  if (isNaN(submittedOdds)) return null;

  try {
    const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 BetOS/1.0' };
    const [matchupsRes, marketsRes] = await Promise.all([
      fetch(`https://guest.api.arcadia.pinnacle.com/0.1/leagues/${leagueId}/matchups`, { headers, signal: AbortSignal.timeout(5000) }),
      fetch(`https://guest.api.arcadia.pinnacle.com/0.1/leagues/${leagueId}/markets/straight`, { headers, signal: AbortSignal.timeout(5000) }),
    ]);

    if (!matchupsRes.ok || !marketsRes.ok) return null;

    const matchups = await matchupsRes.json();
    const markets  = await marketsRes.json();
    if (!Array.isArray(matchups) || !Array.isArray(markets)) return null;

    // Build matchup map (id → home/away names)
    const matchupMap = {};
    for (const m of matchups) {
      if (m.special) continue;
      const home = m.participants?.find(p => p.alignment === 'home')?.name;
      const away = m.participants?.find(p => p.alignment === 'away')?.name;
      if (home && away) matchupMap[m.id] = { home, away };
    }

    // Find the game matching pick.team (check home and away)
    const matchedGame = Object.entries(matchupMap).find(([, g]) =>
      teamMatches(pick.team, g.home) || teamMatches(pick.team, g.away)
    );
    if (!matchedGame) return { found: false, reason: 'Game not found on Pinnacle (may be too early or unavailable)' };

    const [matchupId, game] = matchedGame;
    const isHome = teamMatches(pick.team, game.home);

    // Find the ML market for this game
    const mlMarket = markets.find(m => m.matchupId === parseInt(matchupId) && m.type === 'moneyline');
    if (!mlMarket) return { found: true, game, pinnacleOdds: null, reason: 'No ML market found on Pinnacle yet' };

    const prices  = mlMarket.prices || [];
    const side    = isHome ? 'home' : 'away';
    const pinOdds = prices.find(p => p.designation === side)?.price;
    if (pinOdds == null) return { found: true, game, pinnacleOdds: null };

    const diff = Math.abs(submittedOdds - pinOdds);
    return {
      found:        true,
      game,
      pinnacleOdds: pinOdds,
      submittedOdds,
      diff,
      // Flag if the submitted line is >20 pts off Pinnacle's sharp number
      suspicious:   diff > 20,
      reason:       diff > 20
        ? `Submitted ${submittedOdds > 0 ? '+' : ''}${submittedOdds} but Pinnacle shows ${pinOdds > 0 ? '+' : ''}${pinOdds} (${diff} pts off) — line may not be real`
        : null,
    };
  } catch (err) {
    console.warn('[contest-audit] Pinnacle check failed (non-fatal):', err.message);
    return null;
  }
}

// ── Main audit function ─────────────────────────────────────────────────────
async function aiAuditPick(pick) {
  // Step 1: Hard rule checks (instant, zero cost)
  const issues = [];
  const odds = parseInt(pick.odds);
  if (odds < RULES.minOdds) issues.push(`Odds ${odds} below minimum ${RULES.minOdds}`);
  if (odds > RULES.maxOdds) issues.push(`Odds +${odds} above maximum +${RULES.maxOdds}`);
  if (RULES.excludedBetTypes.includes(pick.bet_type)) issues.push(`${pick.bet_type} not allowed`);
  if (parseFloat(pick.units) > RULES.maxUnits) issues.push(`${pick.units}u exceeds ${RULES.maxUnits}u max`);
  if (issues.length > 0) {
    return { status: 'REJECTED', reason: issues.join('; '), confidence: 'RULE', aiUsed: false };
  }

  // Step 2: Pinnacle real-time line check (free, no AI tokens)
  // If the submitted odds are >20 pts off from Pinnacle's sharp number, flag immediately.
  const pinCheck = await checkOddsAgainstPinnacle(pick);
  if (pinCheck?.suspicious) {
    return {
      status: 'FLAGGED',
      reason: pinCheck.reason,
      confidence: 'PINNACLE',
      aiUsed: false,
      pinnacleOdds: pinCheck.pinnacleOdds,
      diff: pinCheck.diff,
    };
  }

  // Step 3: AI smell-test — only runs if Pinnacle couldn't find the game or confirmed odds are real
  // Include Pinnacle context in the prompt so the AI has real market data
  const pinContext = pinCheck?.found && pinCheck?.pinnacleOdds != null
    ? `\nPinnacle (sharp book) has this team at ${pinCheck.pinnacleOdds > 0 ? '+' : ''}${pinCheck.pinnacleOdds} — submitted line is ${pinCheck.diff} pts off, which is within acceptable range.`
    : pinCheck?.found === false
    ? '\nGame not found on Pinnacle (may be early line or niche market).'
    : '\nPinnacle check unavailable.';

  try {
    const prompt = `You are an AI auditor for a sports betting contest. Review this pick for legitimacy:
- Team: ${pick.team}
- Bet Type: ${pick.bet_type}
- Odds: ${pick.odds}
- Units: ${pick.units}
- Sport: ${pick.sport}
- Date: ${pick.date}
- Submitted: ${pick.created_at || 'unknown'}
${pinContext}

Check for: suspicious timing (submitted after game started), obvious data entry errors, implausible lines for the sport/matchup.
Respond with EXACTLY one line: APPROVED or FLAGGED followed by a brief reason.`;

    const result = await callAI({ user: prompt, maxTokens: 100, temperature: 0.1 });
    const answer = result.text;
    if (answer.startsWith('FLAGGED')) {
      return { status: 'FLAGGED', reason: answer.replace('FLAGGED', '').replace(/^[\s-]+/, ''), confidence: 'AI', aiUsed: true };
    }
    return { status: 'APPROVED', reason: answer.replace('APPROVED', '').replace(/^[\s-]+/, '') || 'Passed all checks', confidence: 'AI', aiUsed: true, pinnacleOdds: pinCheck?.pinnacleOdds };
  } catch (err) {
    console.warn('[contest-audit] AI check failed, approving by rules:', err.message);
    return { status: 'APPROVED', reason: 'Passed rule + Pinnacle checks (AI unavailable)', confidence: 'PINNACLE', aiUsed: false, pinnacleOdds: pinCheck?.pinnacleOdds };
  }
}

// ── GET: Fetch audit log for admin ──────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userEmail = searchParams.get('userEmail');
  const action = searchParams.get('action');

  if (userEmail !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  // Fetch contest picks with audit status
  if (action === 'log') {
    const { data: picks, error } = await supabase
      .from('picks')
      .select('*')
      .eq('contest_entry', true)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Get usernames
    const userIds = [...new Set((picks || []).map(p => p.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', userIds);
    const nameMap = {};
    (profiles || []).forEach(p => { nameMap[p.id] = p.username; });

    const enriched = (picks || []).map(p => ({
      ...p,
      username: nameMap[p.user_id] || 'Unknown',
      audit_status: p.audit_status || 'PENDING',
    }));

    return NextResponse.json({ picks: enriched, total: enriched.length });
  }

  // Fetch flagged picks only
  if (action === 'flagged') {
    const { data: picks } = await supabase
      .from('picks')
      .select('*')
      .eq('contest_entry', true)
      .eq('audit_status', 'FLAGGED')
      .order('created_at', { ascending: false });

    return NextResponse.json({ picks: picks || [] });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// ── POST: Run audit on a pick, or admin override ────────────────────────────
export async function POST(req) {
  const body = await req.json();
  const { action, pickId, userEmail, overrideStatus, overrideReason } = body;

  // Admin override: manually approve/reject a pick
  if (action === 'override' && userEmail === ADMIN_EMAIL && pickId) {
    const isRejected = (overrideStatus || 'APPROVED') === 'REJECTED';

    // First fetch the current pick so we can preserve contest_date on rejection
    const { data: existing } = await supabase
      .from('picks')
      .select('date, contest_entry')
      .eq('id', pickId)
      .single();

    const updatePayload = {
      audit_status: overrideStatus || 'APPROVED',
      audit_reason: overrideReason || 'Admin override',
      audit_override: true,
      audit_override_by: ADMIN_EMAIL,
      audit_override_at: new Date().toISOString(),
    };

    if (isRejected) {
      // Demote to personal pick so the daily contest limit is freed up
      // Store original contest date for audit trail
      updatePayload.contest_entry = false;
      updatePayload.contest_rejected_date = existing?.date || null;
      updatePayload.is_public = false;
    } else if (overrideStatus === 'APPROVED') {
      // Ensure approved picks are public (leaderboard-visible)
      updatePayload.is_public = true;
    }

    const { data, error } = await supabase
      .from('picks')
      .update(updatePayload)
      .eq('id', pickId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ pick: data, overridden: true, demoted: isRejected });
  }

  // Pre-save check: AI validates a pick BEFORE it's saved to the DB
  // Returns { status: 'APPROVED' | 'REJECTED', reason }
  if (action === 'pre-check') {
    const pick = body.pick;
    if (!pick) return NextResponse.json({ error: 'pick required' }, { status: 400 });
    const audit = await aiAuditPick(pick);
    return NextResponse.json({ status: audit.status, reason: audit.reason, aiUsed: audit.aiUsed });
  }

  // Auto-audit: run AI check on a contest pick
  if (action === 'audit' && pickId) {
    const { data: pick, error } = await supabase
      .from('picks')
      .select('*')
      .eq('id', pickId)
      .single();

    if (error || !pick) return NextResponse.json({ error: 'Pick not found' }, { status: 404 });

    const audit = await aiAuditPick(pick);

    // Save audit result to the pick
    await supabase
      .from('picks')
      .update({
        audit_status: audit.status,
        audit_reason: audit.reason,
        audit_ai_used: audit.aiUsed,
        audited_at: new Date().toISOString(),
      })
      .eq('id', pickId);

    // If approved, ensure pick is public (visible on leaderboard)
    if (audit.status === 'APPROVED') {
      await supabase
        .from('picks')
        .update({ is_public: true })
        .eq('id', pickId);
    }

    return NextResponse.json({ pickId, audit });
  }

  // Batch audit: process all unaudited contest picks
  if (action === 'batch-audit') {
    const { data: picks } = await supabase
      .from('picks')
      .select('*')
      .eq('contest_entry', true)
      .is('audit_status', null)
      .limit(50);

    const results = [];
    for (const pick of (picks || [])) {
      const audit = await aiAuditPick(pick);
      const batchUpdate = {
        audit_status: audit.status,
        audit_reason: audit.reason,
        audit_ai_used: audit.aiUsed,
        audited_at: new Date().toISOString(),
        is_public: audit.status === 'APPROVED',
      };
      // Demote REJECTED picks so users can resubmit
      if (audit.status === 'REJECTED') {
        batchUpdate.contest_entry = false;
        batchUpdate.contest_rejected_date = pick.date;
      }
      await supabase
        .from('picks')
        .update(batchUpdate)
        .eq('id', pick.id);
      results.push({ pickId: pick.id, ...audit });
    }

    return NextResponse.json({ audited: results.length, results });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
