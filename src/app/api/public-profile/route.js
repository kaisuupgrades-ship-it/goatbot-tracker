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
  const userId = searchParams.get('userId');
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  if (!CONFIGURED) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Fetch profile + all public picks in parallel
  const [profileRes, picksRes, followCountRes] = await Promise.all([
    supabase.from('profiles').select('username, display_name, avatar_emoji, is_public').eq('id', userId).maybeSingle(),
    supabase
      .from('picks')
      .select('id, team, sport, bet_type, odds, units, result, notes, created_at, audit_status, is_public')
      .eq('user_id', userId)
      .eq('is_public', true)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('follows').select('id', { count: 'exact', head: true }).eq('following_id', userId),
  ]);

  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 });

  const profile = profileRes.data;
  const allPicks = picksRes.data || [];

  // Settled vs pending
  const settled = allPicks.filter(p => ['WIN', 'LOSS', 'PUSH'].includes(p.result));
  const pending = allPicks.filter(p => !p.result || p.result === 'PENDING');

  // Compute profit per pick + aggregate stats
  let totalUnits = 0, wagered = 0;
  const settledWithProfit = settled.map(p => {
    const profit = calcProfit(p.result, p.odds || -110, p.units || 1);
    if (p.result !== 'PUSH') wagered += (p.units || 1);
    totalUnits += profit;
    return {
      id:           p.id,
      team:         p.team,
      sport:        p.sport,
      bet_type:     p.bet_type || 'Moneyline',
      odds:         p.odds,
      units:        p.units || 1,
      result:       p.result,
      notes:        p.notes || '',
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
    },
    stats: {
      wins, losses, pushes,
      total:          settled.length,
      units:          Math.round(totalUnits * 100) / 100,
      roi:            Math.round(roi * 10) / 10,
      verified_picks,
      current_streak: streak,
      pending_count:  pending.length,
      follower_count: followCountRes.count || 0,
    },
    settled_picks: settledWithProfit,
    sport_breakdown,
    cachedAt: new Date().toISOString(),
  });
}
