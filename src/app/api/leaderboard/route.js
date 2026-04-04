import { NextResponse } from 'next/server';

export const maxDuration = 15;

const CACHE_TTL = 60 * 1000; // 1 min
let cache = { data: null, ts: 0 };

// ── Demo leaderboard data ─────────────────────────────────────────────────────
const DUMMY_DATA = [
  { user_id: 'demo-1', username: 'SharpMike',     display_name: 'SharpMike',      avatar_emoji: '🔥', wins: 31, losses: 14, pushes: 2, total: 47, units: 18.4, roi: 39.1, verified_picks: 28, sharp_score: 62.3 },
  { user_id: 'demo-2', username: 'CLVQueen',      display_name: 'CLV Queen',       avatar_emoji: '👑', wins: 28, losses: 17, pushes: 1, total: 46, units: 14.2, roi: 30.9, verified_picks: 33, sharp_score: 51.8 },
  { user_id: 'demo-3', username: 'LineMover99',   display_name: 'LineMover99',     avatar_emoji: '📈', wins: 22, losses: 15, pushes: 3, total: 40, units: 10.7, roi: 26.8, verified_picks: 25, sharp_score: 38.9 },
  { user_id: 'demo-4', username: 'GoatPunter',    display_name: 'Goat Punter',     avatar_emoji: '🐐', wins: 19, losses: 14, pushes: 0, total: 33, units:  9.1, roi: 27.6, verified_picks: 18, sharp_score: 34.1 },
  { user_id: 'demo-5', username: 'TheEdgeFinder', display_name: 'Edge Finder',     avatar_emoji: '⚡', wins: 17, losses: 16, pushes: 1, total: 34, units:  5.3, roi: 15.6, verified_picks: 21, sharp_score: 20.8 },
  { user_id: 'demo-6', username: 'DogHunter',     display_name: 'Dog Hunter',      avatar_emoji: '🦅', wins: 14, losses: 12, pushes: 0, total: 26, units:  6.8, roi: 26.2, verified_picks: 14, sharp_score: 18.5 },
  { user_id: 'demo-7', username: 'Fades4Days',    display_name: 'Fades4Days',      avatar_emoji: '💎', wins: 12, losses: 11, pushes: 2, total: 25, units:  3.2, roi: 12.8, verified_picks: 11, sharp_score:  9.7 },
].map((r, i) => ({ ...r, rank: i + 1 }));

// ── Check if Supabase is actually configured ──────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_CONFIGURED =
  !!SUPABASE_URL &&
  !!SUPABASE_KEY &&
  SUPABASE_URL !== 'https://placeholder.supabase.co' &&
  !SUPABASE_URL.includes('placeholder');

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const userId  = searchParams.get('userId');
  const isDemo  = searchParams.get('demo') === '1';

  // ── Demo mode or no Supabase → serve demo data ────────────────────────────
  if (isDemo || !SUPABASE_CONFIGURED) {
    return NextResponse.json(withUserRank(DUMMY_DATA, null, true));
  }

  // ── Serve from cache if fresh ─────────────────────────────────────────────
  if (cache.data && Date.now() - cache.ts < CACHE_TTL) {
    return NextResponse.json(withUserRank(cache.data, userId, false));
  }

  // ── Try Supabase ──────────────────────────────────────────────────────────
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data, error } = await supabase
      .from('leaderboard_stats')
      .select('*')
      .order('sharp_score', { ascending: false })
      .limit(100);

    if (error) throw error;

    // Real data only — never inject dummy entries for real users
    const ranked = (data || []).map((row, i) => ({ ...row, rank: i + 1 }));

    cache = { data: ranked, ts: Date.now() };
    return NextResponse.json(withUserRank(ranked, userId, false));
  } catch (err) {
    console.warn('Leaderboard: Supabase error.', err.message);
    // Still no dummy data for real users — return empty with error flag
    return NextResponse.json({ leaderboard: [], userRank: null, userEntry: null, total: 0, error: 'Temporarily unavailable', cachedAt: new Date().toISOString() });
  }
}

function withUserRank(ranked, userId, isDemo) {
  const userEntry = userId ? ranked.find(r => r.user_id === userId) : null;
  return {
    leaderboard: ranked,
    userRank:  userEntry?.rank  ?? null,
    userEntry: userEntry        ?? null,
    total:     ranked.length,
    isDemo:    isDemo || false,
    cachedAt:  new Date().toISOString(),
  };
}
