import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_BASE = 'https://api.x.ai/v1';

const ADMIN_EMAIL = 'kaisuupgrades@gmail.com';

// Contest rules (same as verify-pick)
const RULES = {
  minOdds: -145,
  maxOdds: 400,
  excludedBetTypes: ['Parlay', 'Prop', 'Futures', 'Other'],
  maxUnits: 5,
  maxPicksPerDay: 1,
};

// ── AI Audit: verify a contest pick is legitimate ───────────────────────────
async function aiAuditPick(pick) {
  // Basic rule checks first (no AI needed)
  const issues = [];
  const odds = parseInt(pick.odds);
  if (odds < RULES.minOdds) issues.push(`Odds ${odds} below minimum ${RULES.minOdds}`);
  if (odds > RULES.maxOdds) issues.push(`Odds +${odds} above maximum +${RULES.maxOdds}`);
  if (RULES.excludedBetTypes.includes(pick.bet_type)) issues.push(`${pick.bet_type} not allowed`);
  if (parseFloat(pick.units) > RULES.maxUnits) issues.push(`${pick.units}u exceeds ${RULES.maxUnits}u max`);

  if (issues.length > 0) {
    return { status: 'REJECTED', reason: issues.join('; '), confidence: 'RULE', aiUsed: false };
  }

  // If XAI available, do a quick smell-test for suspicious activity
  if (XAI_API_KEY) {
    try {
      const prompt = `You are an AI auditor for a sports betting contest. Review this pick for legitimacy:
- Team: ${pick.team}
- Bet Type: ${pick.bet_type}
- Odds: ${pick.odds}
- Units: ${pick.units}
- Sport: ${pick.sport}
- Date: ${pick.date}
- Submitted: ${pick.created_at || 'unknown'}

Check for: suspicious timing (pick submitted after game started), implausible odds, obvious errors.
Respond with EXACTLY one line: APPROVED or FLAGGED followed by a brief reason.
Examples: "APPROVED - Standard moneyline bet, odds in range" or "FLAGGED - Odds seem implausible for this matchup"`;

      const res = await fetch(`${XAI_BASE}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${XAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'grok-3',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 100,
          temperature: 0.1,
        }),
      });
      const data = await res.json();
      const answer = data.choices?.[0]?.message?.content?.trim() || '';

      if (answer.startsWith('FLAGGED')) {
        return { status: 'FLAGGED', reason: answer.replace('FLAGGED', '').replace(/^[\s-]+/, ''), confidence: 'AI', aiUsed: true };
      }
      return { status: 'APPROVED', reason: answer.replace('APPROVED', '').replace(/^[\s-]+/, '') || 'Passed all checks', confidence: 'AI', aiUsed: true };
    } catch {
      // AI failed — fall through to rule-based approval
    }
  }

  // No AI available — approve based on rules alone
  return { status: 'APPROVED', reason: 'Passed rule checks (AI unavailable)', confidence: 'RULE', aiUsed: false };
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
    const { data, error } = await supabase
      .from('picks')
      .update({
        audit_status: overrideStatus || 'APPROVED',
        audit_reason: overrideReason || 'Admin override',
        audit_override: true,
        audit_override_by: ADMIN_EMAIL,
        audit_override_at: new Date().toISOString(),
      })
      .eq('id', pickId)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ pick: data, overridden: true });
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
      await supabase
        .from('picks')
        .update({
          audit_status: audit.status,
          audit_reason: audit.reason,
          audit_ai_used: audit.aiUsed,
          audited_at: new Date().toISOString(),
          is_public: audit.status === 'APPROVED',
        })
        .eq('id', pick.id);
      results.push({ pickId: pick.id, ...audit });
    }

    return NextResponse.json({ audited: results.length, results });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
