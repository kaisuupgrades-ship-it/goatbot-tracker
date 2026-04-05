import { NextResponse } from 'next/server';

export const maxDuration = 15;

const CACHE_TTL = 30 * 1000; // 30 seconds
let cache = { data: null, ts: 0 };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_CONFIGURED =
  !!SUPABASE_URL &&
  !!SUPABASE_KEY &&
  SUPABASE_URL !== 'https://placeholder.supabase.co' &&
  !SUPABASE_URL.includes('placeholder');

// Demo data for when Supabase isn't configured
const DEMO_DATA = [
  { user_id: 'demo-1', username: 'SharpMike',   display_name: 'SharpMike',   avatar_emoji: '🔥', wins: 18, losses: 7,  pushes: 1, pending: 1, total_settled: 26, units: 11.4, roi: 43.8, streak: 3,  streak_type: 'W' },
  { user_id: 'demo-2', username: 'CLVQueen',     display_name: 'CLV Queen',   avatar_emoji: '👑', wins: 14, losses: 9,  pushes: 2, pending: 0, total_settled: 25, units:  7.2, roi: 28.8, streak: 1,  streak_type: 'W' },
  { user_id: 'demo-3', username: 'LineMover99',  display_name: 'LineMover99', avatar_emoji: '📈', wins: 12, losses: 10, pushes: 1, pending: 2, total_settled: 23, units:  4.1, roi: 17.8, streak: 2,  streak_type: 'L' },
  { user_id: 'demo-4', username: 'GoatPunter',   display_name: 'Goat Punter', avatar_emoji: '🐐', wins: 10, losses: 8,  pushes: 0, pending: 1, total_settled: 18, units:  3.8, roi: 21.1, streak: 1,  streak_type: 'W' },
  { user_id: 'demo-5', username: 'DogHunter',    display_name: 'Dog Hunter',  avatar_emoji: '🦅', wins:  8, losses: 9,  pushes: 1, pending: 0, total_settled: 18, units: -1.2, roi: -6.7,  streak: 2,  streak_type: 'L' },
];

function buildContestRows(picks, profiles) {
  const nameMap = {};
  (profiles || []).forEach(p => {
    nameMap[p.id] = { username: p.username, display_name: p.display_name || p.username, avatar_emoji: p.avatar_emoji || '🎯' };
  });

  const userMap = {};

  for (const pick of picks) {
    if (!userMap[pick.user_id]) {
      const prof = nameMap[pick.user_id] || {};
      userMap[pick.user_id] = {
        user_id:      pick.user_id,
        username:     prof.username     || 'Unknown',
        display_name: prof.display_name || 'Unknown',
        avatar_emoji: prof.avatar_emoji || '🎯',
        wins: 0, losses: 0, pushes: 0, pending: 0,
        total_settled: 0, units: 0,
        last_results: [], // track order for streak
      };
    }

    const u = userMap[pick.user_id];
    const result = pick.result;
    const profit = parseFloat(pick.profit) || 0;

    if (result === 'WIN')  { u.wins++;   u.total_settled++; u.units += profit; u.last_results.push('W'); }
    else if (result === 'LOSS') { u.losses++; u.total_settled++; u.units += profit; u.last_results.push('L'); }
    else if (result === 'PUSH') { u.pushes++; u.total_settled++; u.last_results.push('P'); }
    else { u.pending++; }
  }

  // Calculate ROI + streak for each user
  const rows = Object.values(userMap).map(u => {
    const roi = u.total_settled > 0 ? (u.units / u.total_settled) * 100 : 0;
    u.units = parseFloat(u.units.toFixed(2));
    u.roi   = parseFloat(roi.toFixed(1));

    // Current streak: count consecutive same results from the end
    const results = u.last_results;
    let streak = 0;
    let streak_type = null;
    if (results.length > 0) {
      const last = results[results.length - 1];
      streak_type = last;
      for (let i = results.length - 1; i >= 0; i--) {
        if (results[i] === last) streak++;
        else break;
      }
    }
    u.streak      = streak;
    u.streak_type = streak_type;
    delete u.last_results;
    return u;
  });

  // Sort: by units profit (most to least), then by win count
  rows.sort((a, b) => b.units - a.units || b.wins - a.wins);

  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const isDemo  = searchParams.get('demo') === '1';
  const userId  = searchParams.get('userId') || null;
  const month   = searchParams.get('month') || null; // YYYY-MM, optional filter

  if (isDemo || !SUPABASE_CONFIGURED) {
    const rows = DEMO_DATA.map((r, i) => ({ ...r, rank: i + 1 }));
    return NextResponse.json({ leaderboard: rows, total: rows.length, isDemo: true, cachedAt: new Date().toISOString() });
  }

  // Serve from cache if fresh
  const cacheKey = month || 'all';
  if (cache.data?.[cacheKey] && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(addUserEntry(cache.data[cacheKey], userId));
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Fetch all contest picks — include unaudited (null) and approved, exclude only rejected
    // NOTE: .neq() in Supabase excludes NULLs, so we must use .or() to include null audit_status
    let query = supabase
      .from('picks')
      .select('user_id, result, profit, created_at, audit_status')
      .eq('contest_entry', true)
      .or('audit_status.is.null,audit_status.eq.APPROVED');

    // Optional month filter — filter by the pick's created_at month
    if (month) {
      const start = `${month}-01T00:00:00.000Z`;
      const [y, m] = month.split('-').map(Number);
      const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      const end = `${nextMonth}-01T00:00:00.000Z`;
      query = query.gte('created_at', start).lt('created_at', end);
    }

    const { data: picks, error: picksErr } = await query;
    if (picksErr) throw picksErr;

    const userIds = [...new Set((picks || []).map(p => p.user_id))];
    let profiles = [];
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, username, display_name, avatar_emoji')
        .in('id', userIds);
      profiles = profs || [];
    }

    const rows = buildContestRows(picks || [], profiles);

    // Store in cache
    if (!cache.data) cache.data = {};
    cache.data[cacheKey] = rows;
    cache.ts = Date.now();

    return NextResponse.json(addUserEntry(rows, userId));
  } catch (err) {
    console.error('[contest-leaderboard] error:', err.message);
    return NextResponse.json({ leaderboard: [], total: 0, error: err.message, cachedAt: new Date().toISOString() });
  }
}

function addUserEntry(rows, userId) {
  const userEntry = userId ? rows.find(r => r.user_id === userId) : null;
  return {
    leaderboard: rows,
    total:       rows.length,
    userRank:    userEntry?.rank ?? null,
    userEntry:   userEntry ?? null,
    isDemo:      false,
    cachedAt:    new Date().toISOString(),
  };
}
