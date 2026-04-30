/**
 * /api/admin/elo-mlb — Bootstrap MLB Elo from ESPN, return current ratings.
 *
 * Used as a sanity-check for the eloMLB engine before we wire it into pick
 * generation. Pulls 2 seasons of MLB schedule from ESPN, runs buildMLBElo,
 * and returns top/bottom teams. If the top of the leaderboard doesn't roughly
 * match Vegas/FanGraphs power rankings, the engine has a bug and we DO NOT
 * generate picks based on it.
 *
 * Admin-only: requires a Supabase JWT for an email in ADMIN_EMAILS or a
 * profile with role='admin'.
 *
 * GET ?seasons=2  (default 2)
 *
 * Response:
 *   {
 *     gameCount, lastDate,
 *     top10:    [{ team, rating }],
 *     bottom10: [{ team, rating }],
 *     all:      { TEAM_ABBR: rating },
 *     elapsedMs,
 *   }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildMLBElo, topN } from '@/lib/eloMLB';

export const maxDuration = 30;

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function getAdminUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    if (!user) return null;
    if (ADMIN_EMAILS.includes((user.email || '').toLowerCase())) return user;
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role === 'admin') return user;
    return null;
  } catch { return null; }
}

// Cached in-memory across hot serverless invocations (cleared on cold start).
// 1-hour TTL — Elo doesn't move materially within an hour during the season.
let memo = null;
const MEMO_TTL_MS = 60 * 60 * 1000;

// Pull every team's full schedule for a given season. The ESPN teams index
// lists 30 MLB clubs with stable IDs we can iterate over.
async function fetchAllMLBGames(seasons) {
  // Step 1: fetch the team list (30 clubs)
  const teamsRes = await fetch(
    'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams?limit=50',
    { next: { revalidate: 86400 } } // teams change ~yearly
  );
  if (!teamsRes.ok) throw new Error(`ESPN teams ${teamsRes.status}`);
  const teamsJson = await teamsRes.json();
  const teamRefs = (teamsJson.sports?.[0]?.leagues?.[0]?.teams || [])
    .map(t => ({ id: t.team?.id, abbr: t.team?.abbreviation }))
    .filter(t => t.id && t.abbr);

  // Step 2: pull each team's schedule for each requested season in parallel.
  // We dedupe games by ESPN event id so each game contributes once even
  // though both teams' schedules contain it.
  const seen = new Set();
  const games = [];

  const tasks = [];
  for (const team of teamRefs) {
    for (const season of seasons) {
      tasks.push((async () => {
        const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${team.id}/schedule?season=${season}&seasontype=2`;
        try {
          const res = await fetch(url, { next: { revalidate: 3600 } });
          if (!res.ok) return;
          const data = await res.json();
          for (const ev of (data.events || [])) {
            if (seen.has(ev.id)) continue;
            const comp = ev.competitions?.[0];
            if (!comp) continue;
            const completed = ev.status?.type?.completed || comp.status?.type?.completed;
            if (!completed) continue;
            const home = comp.competitors?.find(c => c.homeAway === 'home');
            const away = comp.competitors?.find(c => c.homeAway === 'away');
            if (!home?.team?.abbreviation || !away?.team?.abbreviation) continue;
            const hs = parseInt(home.score ?? 0, 10);
            const as = parseInt(away.score ?? 0, 10);
            if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
            seen.add(ev.id);
            games.push({
              home_team:  home.team.abbreviation,
              away_team:  away.team.abbreviation,
              home_score: hs,
              away_score: as,
              game_date:  ev.date?.substring(0, 10) || '',
              season,
            });
          }
        } catch { /* per-team failure is fine, continue */ }
      })());
    }
  }
  await Promise.all(tasks);

  return games;
}

export async function GET(req) {
  const adminUser = await getAdminUser(req);
  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const seasonCount = Math.min(5, Math.max(1, parseInt(searchParams.get('seasons') || '2', 10)));
  const force = searchParams.get('force') === '1';

  // Memo cache
  if (!force && memo && Date.now() - memo.ts < MEMO_TTL_MS && memo.seasonCount === seasonCount) {
    return NextResponse.json({ ...memo.data, _cached: true });
  }

  const t0 = Date.now();
  try {
    const currentYear = new Date().getFullYear();
    const seasons = [];
    for (let i = seasonCount - 1; i >= 0; i--) seasons.push(currentYear - i);

    const games = await fetchAllMLBGames(seasons);
    if (!games.length) {
      return NextResponse.json({ error: 'No completed games found from ESPN' }, { status: 502 });
    }

    const { ratings, gameCount, lastDate } = buildMLBElo(games);

    const data = {
      seasons,
      gameCount,
      lastDate,
      top10:    topN(ratings, 10),
      bottom10: topN(
        Object.fromEntries(Object.entries(ratings).map(([k, v]) => [k, -v])),
        10,
      ).map(({ team, rating }) => ({ team, rating: Math.round(-rating * 10) / 10 })),
      all: Object.fromEntries(
        Object.entries(ratings).map(([k, v]) => [k, Math.round(v * 10) / 10])
      ),
      elapsedMs: Date.now() - t0,
    };

    memo = { ts: Date.now(), seasonCount, data };
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
