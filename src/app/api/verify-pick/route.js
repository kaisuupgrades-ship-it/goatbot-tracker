import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth';

export const maxDuration = 15;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ── Official Contest Rules ──────────────────────────────────────────────────
const CONTEST_RULES = {
  // ONE PLAY PER DAY
  maxPicksPerDay: 1,
  // MINIMUM ODDS: -145 (no heavy favorites)
  minOdds: -145,
  // Max odds: +400 (no extreme longshots)
  maxOdds: 400,
  // Bet types allowed (straight bets only)
  allowedBetTypes: ['Moneyline', 'Spread', 'Run Line', 'Puck Line', 'Total (Over)', 'Total (Under)', 'F5 Moneyline', 'F5 Total (Over)', 'F5 Total (Under)', '1H Spread', '1H Total (Over)', '1H Total (Under)'],
  excludedBetTypes: ['Parlay', 'Prop', 'Futures', 'Other'],
  // Max units
  maxUnits: 5,
  // LOCKED: once posted, no changing, editing, or deleting
  locked: true,
  // Reschedules ≠ void. Play stands for new date.
  reschedulePolicy: 'play_stands',
};

// ── Verify a single pick for contest eligibility ────────────────────────────
function verifyPick(pick) {
  const issues = [];
  const warnings = [];

  // 1. Odds range check — MINIMUM -145
  const odds = parseInt(pick.odds);
  if (!isNaN(odds)) {
    if (odds < CONTEST_RULES.minOdds) {
      issues.push(`Odds ${odds} too juicy — contest minimum is ${CONTEST_RULES.minOdds}. No heavy favorites allowed.`);
    }
    if (odds > CONTEST_RULES.maxOdds) {
      issues.push(`Odds +${odds} too long — contest maximum is +${CONTEST_RULES.maxOdds}.`);
    }
  } else {
    issues.push('Invalid odds — must be a valid American odds number (e.g. -110, +150).');
  }

  // 2. Bet type check (straight bets only)
  if (pick.bet_type) {
    if (CONTEST_RULES.excludedBetTypes.includes(pick.bet_type)) {
      issues.push(`"${pick.bet_type}" is not contest-eligible. Straight bets only (ML, spread, totals).`);
    } else if (!CONTEST_RULES.allowedBetTypes.includes(pick.bet_type)) {
      warnings.push(`"${pick.bet_type}" — will be reviewed for eligibility.`);
    }
  }

  // 3. Units check
  const units = parseFloat(pick.units);
  if (!isNaN(units) && units > CONTEST_RULES.maxUnits) {
    issues.push(`${units}u exceeds the ${CONTEST_RULES.maxUnits}u per-pick max.`);
  }

  // 4. Date required
  if (!pick.date) {
    issues.push('No date set — pick must have a game date.');
  }

  // 5. Team/pick required
  if (!pick.team?.trim()) {
    issues.push('No pick/team specified.');
  }

  const eligible = issues.length === 0;
  return { eligible, issues, warnings, rules: CONTEST_RULES };
}

// ── GET: Verify pick by ID + check contest lock status ──────────────────────
export async function GET(req) {
  const { user, error: authError } = await requireAuth(req);
  if (authError) return authError;

  const { searchParams } = new URL(req.url);
  const pickId = searchParams.get('pickId');
  const userId = searchParams.get('userId');
  const action = searchParams.get('action');

  // Action: get contest rules
  if (action === 'rules') {
    return NextResponse.json({ rules: CONTEST_RULES });
  }

  // Action: check if user already has a contest pick today
  if (action === 'daily-check' && userId) {
    const today = new Date().toISOString().split('T')[0];
    // Exclude REJECTED picks — those have been freed up for resubmission
    const { data: todayPicks } = await supabase
      .from('picks')
      .select('id, team, odds, date, bet_type, contest_entry, audit_status')
      .eq('user_id', userId)
      .eq('contest_entry', true)
      .eq('date', today)
      .neq('audit_status', 'REJECTED');

    return NextResponse.json({
      hasContestPickToday: (todayPicks?.length || 0) >= CONTEST_RULES.maxPicksPerDay,
      todayPicks: todayPicks || [],
      maxPerDay: CONTEST_RULES.maxPicksPerDay,
    });
  }

  if (!pickId) return NextResponse.json({ error: 'pickId required' }, { status: 400 });

  const { data: pick, error } = await supabase
    .from('picks')
    .select('*')
    .eq('id', pickId)
    .single();

  if (error || !pick) return NextResponse.json({ error: 'Pick not found' }, { status: 404 });
  if (userId && pick.user_id !== userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const result = verifyPick(pick);

  // If it's a contest entry, it's LOCKED
  const isLocked = pick.contest_entry === true;

  return NextResponse.json({ pickId, pick, ...result, locked: isLocked });
}

// ── POST: Pre-save validation + daily limit check ───────────────────────────
export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  const body = await req.json();
  const { pick, userId, contestEntry } = body;

  if (!pick) return NextResponse.json({ error: 'Pick data required' }, { status: 400 });

  const serverTimestamp = new Date().toISOString();
  const result = verifyPick(pick);

  // If entering contest, check daily limit
  // NOTE: REJECTED picks have contest_entry cleared to false, so they don't count.
  // neq('audit_status', 'REJECTED') is a belt-and-suspenders guard for edge cases.
  if (contestEntry && userId && pick.date) {
    const { data: existingPicks } = await supabase
      .from('picks')
      .select('id, team, odds, audit_status')
      .eq('user_id', userId)
      .eq('contest_entry', true)
      .eq('date', pick.date)
      .neq('audit_status', 'REJECTED');

    if ((existingPicks?.length || 0) >= CONTEST_RULES.maxPicksPerDay) {
      result.eligible = false;
      result.issues.push(`You already have a contest pick for ${pick.date}. One play per day — no exceptions.`);
    }
  }

  // Check if submitted before game (conservative: game date at 11:59 PM)
  let submittedBeforeGameStart = null;
  if (pick.date) {
    const gameDate = new Date(pick.date + 'T23:59:00');
    const now = new Date(serverTimestamp);
    submittedBeforeGameStart = now < gameDate;
    if (!submittedBeforeGameStart) {
      result.warnings = result.warnings || [];
      result.warnings.push(`Submitted after game date (${pick.date}) — will NOT count as verified.`);
    }
  }

  return NextResponse.json({
    ...result,
    serverTimestamp,
    submittedBeforeGameStart,
    contestRules: CONTEST_RULES,
    locked: contestEntry && result.eligible, // if entering contest and eligible, it will be locked
  });
}
