import { NextResponse } from 'next/server';

export const maxDuration = 15;

// NOTE: No in-memory cache here. Vercel runs multiple serverless instances
// simultaneously, each with isolated memory — a module-level cache causes
// different users to see different (stale) data depending on which instance
// handles their request. The leaderboard_stats view is fast enough to query
// directly on every request (~20-50ms). Supabase PostgREST handles caching.

// ── Demo leaderboard data ─────────────────────────────────────────────────────
const DUMMY_DATA = [
  { user_id: 'demo-1', username: 'SharpMike',     display_name: 'SharpMike',      avatar_emoji: '[fire]', wins: 31, losses: 14, pushes: 2, total: 47, units: 18.4, roi: 39.1, verified_picks: 28, sharp_score: 62.3 },
  { user_id: 'demo-2', username: 'CLVQueen',      display_name: 'CLV Queen',       avatar_emoji: '[crown]', wins: 28, losses: 17, pushes: 1, total: 46, units: 14.2, roi: 30.9, verified_picks: 33, sharp_score: 51.8 },
  { user_id: 'demo-3', username: 'LineMover99',   display_name: 'LineMover99',     avatar_emoji: '[up]', wins: 22, losses: 15, pushes: 3, total: 40, units: 10.7, roi: 26.8, verified_picks: 25, sharp_score: 38.9 },
  { user_id: 'demo-4', username: 'GoatPunter',    display_name: 'Goat Punter',     avatar_emoji: '[GOAT]', wins: 19, losses: 14, pushes: 0, total: 33, units:  9.1, roi: 27.6, verified_picks: 18, sharp_score: 34.1 },
  { user_id: 'demo-5', username: 'TheEdgeFinder', display_name: 'Edge Finder',     avatar_emoji: '[sharp]', wins: 17, losses: 16, pushes: 1, total: 34, units:  5.3, roi: 15.6, verified_picks: 21, sharp_score: 20.8 },
  { user_id: 'demo-6', username: 'DogHunter',     display_name: 'Dog Hunter',      avatar_emoji: '[?]', wins: 14, losses: 12, pushes: 0, total: 26, units:  6.8, roi: 26.2, verified_picks: 14, sharp_score: 18.5 },
  { user_id: 'demo-7', username: 'Fades4Days',    display_name: 'Fades4Days',      avatar_emoji: '[gem]', wins: 12, losses: 11, pushes: 2, total: 25, units:  3.2, roi: 12.8, verified_picks: 11, sharp_score:  9.7 },
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
  const userId   = searchParams.get('userId');
  const isDemo   = searchParams.get('demo') === '1';
  // 'verified' = only audit-approved picks feed the stats
  // 'all'      = all public settled picks (default)
  const filter   = searchParams.get('filter') === 'verified' ? 'verified' : 'all';

  // ── Demo mode or no Supabase -> serve demo data ────────────────────────────
  if (isDemo || !SUPABASE_CONFIGURED) {
    return NextResponse.json(withUserRank(applyFilter(DUMMY_DATA, filter), null, true, filter));
  }

  // ── Query Supabase fresh every time ──────────────────────────────────────
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const sortCol = filter === 'verified' ? 'verified_sharp_score' : 'sharp_score';

    const { data, error } = await supabase
      .from('leaderboard_stats')
      .select('*')
      .order(sortCol, { ascending: false })
      .limit(100);

    if (error) throw error;

    // Apply filter projection and rank
    let projected = applyFilter(data || [], filter);

    // Graceful fallback: if the user requested 'verified' but NO users have verified picks,
    // automatically fall back to 'all' so the leaderboard isn't empty.
    // This prevents the "No public handicappers yet" issue when commence_time hasn't
    // been backfilled yet or ESPN lookup is failing.
    let actualFilter = filter;
    if (filter === 'verified' && projected.length === 0 && (data || []).length > 0) {
      projected = applyFilter(data || [], 'all');
      actualFilter = 'all_fallback'; // signal to the UI that we fell back
    }

    const ranked = projected.map((row, i) => ({ ...row, rank: i + 1 }));

    return NextResponse.json(withUserRank(ranked, userId, false, actualFilter));
  } catch (err) {
    console.warn('Leaderboard: Supabase error.', err.message);
    return NextResponse.json({ leaderboard: [], userRank: null, userEntry: null, total: 0, filter, error: 'Temporarily unavailable', cachedAt: new Date().toISOString() });
  }
}

// ── Project row fields based on filter ────────────────────────────────────────
// In 'verified' mode, use ONLY verified stats and filter out users with 0 verified picks.
// A pick is "verified" when it has commence_time set (ESPN confirmed the game) and was
// submitted before game start (submitted_at < commence_time). This is what makes the
// Sharp Board trustworthy — every pick shown was provably placed before tipoff/start.
function applyFilter(rows, filter) {
  if (filter !== 'verified') return rows;
  return rows
    .map(r => ({
      ...r,
      wins:        r.verified_wins   || 0,
      losses:      r.verified_losses || 0,
      pushes:      r.verified_pushes || 0,
      total:       r.verified_picks  || 0,
      units:       r.verified_units  || 0,
      roi:         r.verified_roi    || 0,
      sharp_score: r.verified_sharp_score || 0,
      _all_wins:   r.wins,
      _all_losses: r.losses,
      _all_total:  (r.wins ?? 0) + (r.losses ?? 0) + (r.pushes ?? 0),
    }))
    .filter(r => r.total > 0);  // Only show users who have at least 1 verified pick
}

function withUserRank(ranked, userId, isDemo, filter = 'all') {
  const userEntry = userId ? ranked.find(r => r.user_id === userId) : null;
  return {
    leaderboard: ranked,
    userRank:  userEntry?.rank  ?? null,
    userEntry: userEntry        ?? null,
    total:     ranked.length,
    isDemo:    isDemo || false,
    filter,
    cachedAt:  new Date().toISOString(),
  };
}
