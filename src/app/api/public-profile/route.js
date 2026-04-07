import { NextResponse } from 'next/server';

export const maxDuration = 10;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CONFIGURED   = !!SUPABASE_URL && !!SUPABASE_KEY && !SUPABASE_URL.includes('placeholder');

function calcProfit(result, odds, units = 1) {
  if (result === 'PUSH') return 0;
  if (result === 'LOSS') return -units;
  if (result === 'WIN')
    return odds < 0 ? (100 / Math.abs(odds)) * units : (odds / 100) * units;
  return null;
}

// GET /api/public-profile?userId=xxx
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userId      = searchParams.get('userId');
  const contestOnly = searchParams.get('contestOnly') === 'true';
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  if (!CONFIGURED) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Check if the requester is the profile owner (optional auth)
  let isOwner = false;
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token) {
    try {
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user?.id === userId) isOwner = true;
    } catch { /* unauthenticated — treat as non-owner */ }
  }

  // Build picks query — show all picks for this user (no is_public filter).
  // is_public controls leaderboard visibility, but a profile should show all picks
  // so the record shown in the header matches what's in Pick History.
  let picksQuery = supabase
    .from('picks')
    .select('id, team, sport, bet_type, odds, units, result, profit, notes, created_at, audit_status, is_public, contest_id')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (contestOnly) picksQuery = picksQuery.eq('contest_entry', true);

  // Fetch profile + picks + follower count + following count in parallel
  const [profileRes, picksRes, followCountRes, followingCountRes] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_emoji, avatar_url, is_public').eq('id', userId).maybeSingle(),
    picksQuery,
    supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', userId),
    supabase.from('follows').select('id', { count: 'exact', head: true }).eq('follower_id', userId),
  ]);

  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 });

  const profile = profileRes.data;
  const allPicks = picksRes.data || [];

  // Settled vs pending — sorted by created_at desc for correct streak direction
  const settled = allPicks
    .filter(p => ['WIN', 'LOSS', 'PUSH'].includes(p.result))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const pending = allPicks.filter(p => !p.result || p.result === 'PENDING');

  // Pending picks — owner gets full details; non-owners get only sport + timestamp
  // (blurred in UI). This prevents competitors from seeing bets before game time.
  // Both views use the same underlying pending array so counts match.
  const pendingPicks = pending.map(p => isOwner ? {
    id:         p.id,
    team:       p.team,
    sport:      p.sport,
    bet_type:   p.bet_type || 'Moneyline',
    odds:       p.odds,
    units:      p.units || 1,
    notes:      p.notes || '',
    created_at: p.created_at,
  } : {
    id:         p.id,
    sport:      p.sport || 'Other',
    created_at: p.created_at,
  });

  // Use the stored profit from DB (consistent with TrackerTab and admin panel).
  // Skip picks with null odds from profit aggregation to avoid NaN in totals.
  let totalUnits = 0, wagered = 0;
  const settledWithProfit = settled.map(p => {
    // Read profit directly from DB; fall back to calc only if DB profit is missing AND odds exist
    const dbProfit = p.profit != null ? parseFloat(p.profit) : null;
    const profit = dbProfit != null ? dbProfit
      : (p.odds != null ? calcProfit(p.result, p.odds, p.units || 1) : null);
    if (p.result !== 'PUSH') wagered += (p.units || 1);
    if (profit != null) totalUnits += profit;
    return {
      id:           p.id,
      team:         p.team,
      sport:        p.sport,
      bet_type:     p.bet_type || 'Moneyline',
      odds:         p.odds,
      units:        p.units || 1,
      result:       p.result,
      notes:        isOwner ? (p.notes || '') : '',  // notes are private
      created_at:   p.created_at,
      verified:     p.audit_status === 'APPROVED',
      profit:       profit !== null ? Math.round(profit * 100) / 100 : null,
    };
  });

  const wins   = settled.filter(p => p.result === 'WIN').length;
  const losses = settled.filter(p => p.result === 'LOSS').length;
  const pushes = settled.filter(p => p.result === 'PUSH').length;
  const roi    = wagered > 0 ? (totalUnits / wagered) * 100 : 0;

  // Sport breakdown from settled
  const sportMap = {};
  for (const p of settledWithProfit) {
    if (!sportMap[p.sport]) sportMap[p.sport] = { wins: 0, losses: 0, pushes: 0, units: 0 };
    if (p.result === 'WIN')  sportMap[p.sport].wins++;
    if (p.result === 'LOSS') sportMap[p.sport].losses++;
    if (p.result === 'PUSH') sportMap[p.sport].pushes++;
    sportMap[p.sport].units += p.profit || 0;
  }
  const sport_breakdown = Object.entries(sportMap)
    .sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses))
    .map(([sport, s]) => ({ sport, ...s }));

  // Verified picks
  const verified_picks = settledWithProfit.filter(p => p.verified).length;

  // Current streak (consecutive from most recent)
  let streak = 0;
  if (settledWithProfit.length > 0) {
    const dir = settledWithProfit[0].result;
    for (const p of settledWithProfit) {
      if (p.result === dir) streak++;
      else break;
    }
    if (dir === 'LOSS') streak = -streak;
    if (dir === 'PUSH') streak = 0;
  }

  return NextResponse.json({
    profile: {
      user_id:      userId,
      username:     profile?.username || null,
      display_name: profile?.display_name || null,
      avatar_emoji: profile?.avatar_emoji || null,
      avatar_url:   profile?.avatar_url   || null,
    },
    stats: {
      wins, losses, pushes,
      total:          settled.length,
      units:          Math.round(totalUnits * 100) / 100,
      roi:            Math.round(roi * 10) / 10,
      verified_picks,
      current_streak: streak,
      pending_count:  pending.length,
      follower_count:  followCountRes.count  || 0,
      following_count: followingCountRes.count || 0,
    },
    settled_picks:  settledWithProfit,
    pending_picks:  pendingPicks,
    sport_breakdown,
    cachedAt: new Date().toISOString(),
  });
}
