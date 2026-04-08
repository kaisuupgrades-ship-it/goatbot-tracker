import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CONTEST_RULES, validateContestEligibility } from '@/lib/contestRules';

export const maxDuration = 15;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ── Verify a single pick for contest eligibility ────────────────────────────
function verifyPick(pick) {
  const { eligible, reasons } = validateContestEligibility(pick);
  return { eligible, issues: reasons, warnings: [], rules: CONTEST_RULES };
}

// ── GET: Verify pick by ID + check contest lock status ──────────────────────
export async function GET(req) {
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
