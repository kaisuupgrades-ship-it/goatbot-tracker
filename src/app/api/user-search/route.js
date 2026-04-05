import { NextResponse } from 'next/server';

export const maxDuration = 15;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const CONFIGURED = !!SUPABASE_URL && !!SUPABASE_KEY && !SUPABASE_URL.includes('placeholder');

// ── Demo data ────────────────────────────────────────────────────────────────
const DEMO_DATA = [
  { user_id:'d1', username:'SharpMike',   display_name:'SharpMike',  avatar_emoji:'🔥', wins:31, losses:14, pushes:2, total:47, units:18.4, roi:39.1, current_streak:3,  sport_focus:'NFL', recent_results:['WIN','WIN','WIN','LOSS','WIN','WIN','LOSS','WIN','WIN','LOSS'] },
  { user_id:'d2', username:'CLVQueen',    display_name:'CLV Queen',   avatar_emoji:'👑', wins:28, losses:17, pushes:1, total:46, units:14.2, roi:30.9, current_streak:2,  sport_focus:'NBA', recent_results:['WIN','WIN','LOSS','WIN','LOSS','WIN','WIN','LOSS','WIN','WIN'] },
  { user_id:'d3', username:'LineMover99', display_name:'LineMover99', avatar_emoji:'📈', wins:22, losses:15, pushes:3, total:40, units:10.7, roi:26.8, current_streak:-1, sport_focus:'MLB', recent_results:['LOSS','WIN','WIN','LOSS','WIN','WIN','PUSH','WIN','LOSS','WIN'] },
  { user_id:'d4', username:'GoatPunter',  display_name:'Goat Punter', avatar_emoji:'🐐', wins:19, losses:14, pushes:0, total:33, units:9.1,  roi:27.6, current_streak:1,  sport_focus:'NHL', recent_results:['WIN','LOSS','WIN','WIN','LOSS','WIN','LOSS','WIN','WIN','LOSS'] },
  { user_id:'d5', username:'DogHunter',   display_name:'Dog Hunter',  avatar_emoji:'🦅', wins:14, losses:12, pushes:0, total:26, units:6.8,  roi:26.2, current_streak:-2, sport_focus:'UFC', recent_results:['LOSS','LOSS','WIN','WIN','WIN','LOSS','WIN','LOSS','WIN','WIN'] },
];

// ── Profit from American odds ────────────────────────────────────────────────
function profit(result, odds, units = 1) {
  if (result === 'PUSH') return 0;
  if (result === 'LOSS') return -units;
  if (result === 'WIN')
    return odds < 0 ? (100 / Math.abs(odds)) * units : (odds / 100) * units;
  return 0;
}

// ── Group picks into per-user stats ─────────────────────────────────────────
function groupByUser(picks) {
  const map = {};
  for (const p of picks) {
    const uid = p.user_id;
    if (!map[uid]) {
      map[uid] = {
        user_id: uid,
        username:     p.profiles?.username     || null,
        display_name: p.profiles?.display_name || null,
        avatar_emoji: p.profiles?.avatar_emoji || null,
        avatar_url:   p.profiles?.avatar_url   || null,
        wins: 0, losses: 0, pushes: 0, total: 0,
        units: 0, wagered: 0,
        picks_by_date: [], // [{result, created_at}]
        sports: {},
      };
    }
    const u = map[uid];
    if (p.result === 'WIN')  u.wins++;
    if (p.result === 'LOSS') u.losses++;
    if (p.result === 'PUSH') u.pushes++;
    u.total++;
    const pr = profit(p.result, p.odds || -110, p.units || 1);
    u.units += pr;
    if (p.result === 'WIN' || p.result === 'LOSS') u.wagered += (p.units || 1);
    u.picks_by_date.push({ result: p.result, created_at: p.created_at });
    if (p.sport) u.sports[p.sport] = (u.sports[p.sport] || 0) + 1;
  }

  return Object.values(map).map(u => {
    // Sort picks newest first, take last 10 for recent strip
    const sorted = u.picks_by_date.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const recent_results = sorted.slice(0, 10).map(r => r.result);

    // Compute current streak (consecutive same result from most recent)
    let streak = 0;
    if (sorted.length > 0) {
      const dir = sorted[0].result === 'WIN' ? 1 : sorted[0].result === 'LOSS' ? -1 : 0;
      for (const s of sorted) {
        if (dir === 1 && s.result === 'WIN') streak++;
        else if (dir === -1 && s.result === 'LOSS') streak--;
        else break;
      }
    }

    // Sport focus = sport with most picks
    const sport_focus = Object.entries(u.sports).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const roi = u.wagered > 0 ? (u.units / u.wagered) * 100 : 0;
    const win_pct = u.total > 0 ? (u.wins / u.total) * 100 : 0;

    return {
      user_id: u.user_id,
      username: u.username,
      display_name: u.display_name,
      avatar_emoji: u.avatar_emoji,
      avatar_url:   u.avatar_url,
      wins: u.wins,
      losses: u.losses,
      pushes: u.pushes,
      total: u.total,
      units: Math.round(u.units * 100) / 100,
      roi: Math.round(roi * 10) / 10,
      win_pct: Math.round(win_pct * 1) / 1,
      current_streak: streak,
      sport_focus,
      recent_results,
    };
  });
}

// ── Sort comparators ─────────────────────────────────────────────────────────
const SORTERS = {
  hot:     (a, b) => b.wins - a.wins,
  roi:     (a, b) => b.roi - a.roi,
  record:  (a, b) => b.win_pct - a.win_pct,
  streak:  (a, b) => Math.abs(b.current_streak) - Math.abs(a.current_streak),
  volume:  (a, b) => b.total - a.total,
  units:   (a, b) => b.units - a.units,
  contest: (a, b) => b.wins - a.wins, // fallback; real contest sort uses contest endpoint
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const isDemo   = searchParams.get('demo') === '1';
  const sort     = searchParams.get('sort')  || 'hot';
  const sport    = searchParams.get('sport') || '';
  const days     = parseInt(searchParams.get('days') || '7', 10);
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo   = searchParams.get('dateTo')   || '';
  const minPicks = parseInt(searchParams.get('minPicks') || '1', 10);

  if (isDemo || !CONFIGURED) {
    const sorted = [...DEMO_DATA].sort(SORTERS[sort] || SORTERS.hot);
    return NextResponse.json({ entries: sorted, isDemo: true, cachedAt: new Date().toISOString() });
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Build date bounds
    let fromDate = '';
    let toDate   = '';
    if (dateFrom && dateTo) {
      fromDate = new Date(dateFrom).toISOString();
      toDate   = new Date(dateTo + 'T23:59:59').toISOString();
    } else if (days > 0) {
      fromDate = new Date(Date.now() - days * 86_400_000).toISOString();
    }

    // Query all settled picks in range — no is_public gate so every
    // user who has placed and settled a pick appears in the directory.
    let query = supabase
      .from('picks')
      .select('user_id, result, odds, units, created_at, sport, profiles!picks_user_id_profiles_fkey(username, display_name, avatar_emoji, avatar_url)')
      .in('result', ['WIN', 'LOSS', 'PUSH']);

    if (fromDate) query = query.gte('created_at', fromDate);
    if (toDate)   query = query.lte('created_at', toDate);
    if (sport && sport !== 'All Sports') query = query.eq('sport', sport);

    const { data, error } = await query;
    if (error) throw error;

    const grouped = groupByUser(data || []).filter(u => u.total >= minPicks);
    const sorter  = SORTERS[sort] || SORTERS.hot;
    const sorted  = grouped.sort(sorter);

    return NextResponse.json({ entries: sorted, isDemo: false, cachedAt: new Date().toISOString() });
  } catch (err) {
    console.error('user-search error:', err.message);
    return NextResponse.json({ entries: [], error: err.message, cachedAt: new Date().toISOString() });
  }
}
