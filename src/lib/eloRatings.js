/**
 * MLB Elo ratings provider.
 *
 * Persists ratings to the mlb_elo_ratings Supabase table so a cold cron
 * doesn't have to re-pull 30 team schedules from ESPN every run. Refreshes
 * the table from ESPN at most once every 24h (controlled by the freshest
 * row's updated_at).
 *
 * Public surface:
 *   getCurrentMLBRatings({ supabase, force })
 *     → { ratings: { TEAM: rating }, gameCount, lastDate, source: 'cache'|'rebuild' }
 *
 *   predictMLBProb(ratings, homeAbbr, awayAbbr)
 *     → { homeProb, awayProb, homeRating, awayRating } | null
 *
 * Both pure-ish — getCurrentMLBRatings does I/O, predictMLBProb is pure
 * math wrapping the eloMLB lib.
 */
import { buildMLBElo, predictMLBGame } from '@/lib/eloMLB';

const REBUILD_TTL_MS = 24 * 60 * 60 * 1000;
const SEASONS_TO_INGEST = 2; // current + previous

// In-process memo so multiple calls inside a single cron run don't re-hit DB
let processMemo = null;
const PROCESS_MEMO_TTL_MS = 5 * 60 * 1000; // 5 min within same warm container

async function fetchAllMLBGamesFromESPN(seasons) {
  // Get team list (30 MLB clubs)
  const teamsRes = await fetch(
    'https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams?limit=50',
    { next: { revalidate: 86400 } },
  );
  if (!teamsRes.ok) throw new Error(`ESPN teams ${teamsRes.status}`);
  const teamsJson = await teamsRes.json();
  const teamRefs = (teamsJson.sports?.[0]?.leagues?.[0]?.teams || [])
    .map(t => ({ id: t.team?.id, abbr: t.team?.abbreviation }))
    .filter(t => t.id && t.abbr);

  // Pull schedules in parallel, dedupe by event id
  const seen = new Set();
  const games = [];
  await Promise.all(teamRefs.flatMap(team =>
    seasons.map(async (season) => {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${team.id}/schedule?season=${season}&seasontype=2`;
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
      } catch { /* continue */ }
    })
  ));
  return games;
}

async function readRatingsFromTable(supabase) {
  const { data: rows, error } = await supabase
    .from('mlb_elo_ratings')
    .select('team, rating, game_count, last_game_date, updated_at');
  if (error) return null;
  if (!rows || !rows.length) return null;

  const ratings = {};
  let newestUpdate = null;
  let gameCount = 0;
  let lastDate = null;
  for (const r of rows) {
    ratings[r.team] = Number(r.rating);
    const u = r.updated_at ? new Date(r.updated_at).getTime() : 0;
    if (!newestUpdate || u > newestUpdate) newestUpdate = u;
    if ((r.game_count || 0) > gameCount) gameCount = r.game_count || 0;
    if (r.last_game_date && (!lastDate || r.last_game_date > lastDate)) lastDate = r.last_game_date;
  }
  return { ratings, gameCount, lastDate, updatedAtMs: newestUpdate };
}

async function writeRatingsToTable(supabase, ratings, gameCount, lastDate) {
  const rows = Object.entries(ratings).map(([team, rating]) => ({
    team,
    rating: Math.round(rating * 100) / 100,
    game_count: gameCount,
    last_game_date: lastDate || null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('mlb_elo_ratings')
    .upsert(rows, { onConflict: 'team' });
  if (error) console.warn('[eloRatings] write failed:', error.message);
}

/**
 * Returns current MLB Elo ratings. Reads from DB if fresh; rebuilds from
 * ESPN otherwise. First call in a fresh container takes ~5-10s to ingest;
 * subsequent calls within 5 min hit the in-process memo and return instantly.
 */
export async function getCurrentMLBRatings({ supabase, force = false }) {
  // In-process memo
  if (!force && processMemo && Date.now() - processMemo.ts < PROCESS_MEMO_TTL_MS) {
    return { ...processMemo.data, source: 'memo' };
  }

  // Try DB cache
  if (!force && supabase) {
    const cached = await readRatingsFromTable(supabase);
    if (cached && cached.updatedAtMs && Date.now() - cached.updatedAtMs < REBUILD_TTL_MS) {
      const data = { ratings: cached.ratings, gameCount: cached.gameCount, lastDate: cached.lastDate };
      processMemo = { ts: Date.now(), data };
      return { ...data, source: 'cache' };
    }
  }

  // Cold rebuild from ESPN
  const currentYear = new Date().getFullYear();
  const seasons = Array.from({ length: SEASONS_TO_INGEST }, (_, i) => currentYear - (SEASONS_TO_INGEST - 1 - i));
  const games = await fetchAllMLBGamesFromESPN(seasons);
  const { ratings, gameCount, lastDate } = buildMLBElo(games);

  if (supabase) {
    await writeRatingsToTable(supabase, ratings, gameCount, lastDate).catch(() => {});
  }
  const data = { ratings, gameCount, lastDate };
  processMemo = { ts: Date.now(), data };
  return { ...data, source: 'rebuild' };
}

/**
 * Pure prediction wrapper — given current ratings, returns probabilities for
 * an upcoming game. Returns null if either team isn't in the ratings table.
 */
export function predictMLBProb(ratings, homeAbbr, awayAbbr) {
  return predictMLBGame(ratings, homeAbbr, awayAbbr);
}

/**
 * Map full ESPN team names to the abbreviations used by the Elo ratings
 * table. Returns null if no match — caller treats as "Elo unavailable".
 */
const MLB_NAME_TO_ABBR = {
  'arizona diamondbacks': 'ARI',
  'atlanta braves': 'ATL',
  'baltimore orioles': 'BAL',
  'boston red sox': 'BOS',
  'chicago cubs': 'CHC',
  'chicago white sox': 'CWS',
  'cincinnati reds': 'CIN',
  'cleveland guardians': 'CLE',
  'colorado rockies': 'COL',
  'detroit tigers': 'DET',
  'houston astros': 'HOU',
  'kansas city royals': 'KC',
  'los angeles angels': 'LAA',
  'los angeles dodgers': 'LAD',
  'miami marlins': 'MIA',
  'milwaukee brewers': 'MIL',
  'minnesota twins': 'MIN',
  'new york mets': 'NYM',
  'new york yankees': 'NYY',
  'oakland athletics': 'OAK',
  'athletics':         'OAK',
  'philadelphia phillies': 'PHI',
  'pittsburgh pirates': 'PIT',
  'san diego padres': 'SD',
  'san francisco giants': 'SF',
  'seattle mariners': 'SEA',
  'st. louis cardinals': 'STL',
  'st louis cardinals':  'STL',
  'tampa bay rays': 'TB',
  'texas rangers': 'TEX',
  'toronto blue jays': 'TOR',
  'washington nationals': 'WSH',
};

export function mlbAbbrFromName(fullName) {
  if (!fullName) return null;
  return MLB_NAME_TO_ABBR[fullName.toLowerCase().trim()] || null;
}

/**
 * Render a "MODEL ANCHOR" prompt block for the LLM. Inserts the Elo-derived
 * probability into the analysis prompt as a quantitative starting point that
 * the LLM can defer to or reason against based on context.
 */
export function renderModelAnchorBlock({ homeAbbr, awayAbbr, prediction }) {
  if (!prediction) {
    return `=== MODEL ANCHOR ===
Elo: not available for this matchup (one or both teams missing from rating table).
LLM should reason from market odds + historical context only.`;
  }
  const homeFmt = (prediction.homeProb * 100).toFixed(1);
  const awayFmt = (prediction.awayProb * 100).toFixed(1);
  const hRating = Math.round(prediction.homeRating);
  const aRating = Math.round(prediction.awayRating);
  return `=== MODEL ANCHOR (Elo-based, before context adjustments) ===
Home: ${homeAbbr} — Elo ${hRating} → win prob ${homeFmt}%
Away: ${awayAbbr} — Elo ${aRating} → win prob ${awayFmt}%

This is a quantitative starting point. Treat it as the prior. Your job is to
identify when news, weather, pitching matchup, lineup changes, or other
context would justify deviating from this baseline. If your analysis aligns
with the model, that's confirmation. If you want to deviate by more than
±5 percentage points, you must explicitly justify what context overrides
the baseline.`;
}
