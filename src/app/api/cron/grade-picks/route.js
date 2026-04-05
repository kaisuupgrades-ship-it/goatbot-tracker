/**
 * /api/cron/grade-picks
 * Vercel Cron: auto-grades PENDING picks for ALL users every 30 min during game hours.
 *
 * Runs: every 30 minutes from 5pm–4am UTC (noon–midnight ET) — the main US sports window.
 * Vercel invokes this via GET with the CRON_SECRET header.
 *
 * Strategy:
 *  1. Find all PENDING picks whose date <= today (across ALL users)
 *  2. Group by sport + date to minimize ESPN calls (one scoreboard fetch per group)
 *  3. Grade each pick and update Supabase
 *  4. Return a summary { graded, users, skipped }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60; // Vercel Pro allows up to 300s; 60s is plenty for cron grading

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // must use service role to read all users' picks
);

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const SPORT_PATHS = {
  mlb:   'baseball/mlb',
  nfl:   'football/nfl',
  nba:   'basketball/nba',
  nhl:   'hockey/nhl',
  ncaaf: 'football/college-football',
  ncaab: 'basketball/mens-college-basketball',
  mls:   'soccer/usa.1',
  wnba:  'basketball/wnba',
  ufc:   'mma/ufc',
};

async function fetchScoreboard(sport, dateStr) {
  const path = SPORT_PATHS[sport];
  if (!path) return null;
  try {
    const res = await fetch(`${ESPN_BASE}/${path}/scoreboard?dates=${dateStr}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function normalize(str) {
  return (str || '').toLowerCase()
    .replace(/\b(fc|sc|cf|ac|united|city|town|utd)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function teamMatches(espnName, pickTeam) {
  const n1 = normalize(espnName);
  const n2 = normalize(pickTeam);
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

function gradePick(pick, game) {
  const comp = game.competitions?.[0];
  if (!comp) return null;

  const status = comp.status?.type?.name;
  if (!['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_PERIOD'].includes(status)) return null;

  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  const homeScore  = parseFloat(home.score || 0);
  const awayScore  = parseFloat(away.score || 0);
  const totalScore = homeScore + awayScore;

  const betType = (pick.bet_type || 'Moneyline').toLowerCase();
  const pickSide = (pick.side || '').toLowerCase();
  const line     = parseFloat(pick.line || pick.spread_line || 0);

  const pickedHome = teamMatches(home.team?.displayName || home.team?.name || '', pick.team) || pickSide === 'home';
  const pickedAway = teamMatches(away.team?.displayName || away.team?.name || '', pick.team) || pickSide === 'away';

  let result = 'PENDING';

  if (betType.includes('moneyline') || betType.includes('ml')) {
    const homeWon = homeScore > awayScore;
    if (pickedHome) result = homeWon ? 'WIN' : 'LOSS';
    else if (pickedAway) result = !homeWon ? 'WIN' : 'LOSS';
    if (homeScore === awayScore) result = 'PUSH';

  } else if (betType.includes('spread') || betType.includes('run line') || betType.includes('puck line')) {
    if (pickedHome) {
      const covered = (homeScore + line) > awayScore;
      const push    = (homeScore + line) === awayScore;
      result = push ? 'PUSH' : covered ? 'WIN' : 'LOSS';
    } else if (pickedAway) {
      const covered = (awayScore + line) > homeScore;
      const push    = (awayScore + line) === homeScore;
      result = push ? 'PUSH' : covered ? 'WIN' : 'LOSS';
    }

  } else if (betType.includes('over') || betType.includes('total')) {
    const isOver  = pickSide === 'over' || betType.includes('over');
    const isUnder = pickSide === 'under' || betType.includes('under');
    if (line > 0) {
      if (totalScore > line)       result = isOver  ? 'WIN' : 'LOSS';
      else if (totalScore < line)  result = isUnder ? 'WIN' : 'LOSS';
      else                         result = 'PUSH';
    }
  }

  return result === 'PENDING' ? null : {
    result,
    home_score: homeScore,
    away_score: awayScore,
    home_team: home.team?.displayName || home.team?.name,
    away_team: away.team?.displayName || away.team?.name,
  };
}

export async function GET(req) {
  // Verify this is a legitimate Vercel Cron invocation
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const started = Date.now();
  const todayStr = new Date().toISOString().split('T')[0];
  // Also look back 1 day to catch late-finishing or timezone-edge games from yesterday
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  // Fetch ALL PENDING picks across ALL users whose date is yesterday or today
  const { data: picks, error } = await supabase
    .from('picks')
    .select('*')
    .eq('result', 'PENDING')
    .gte('date', yesterdayStr)
    .lte('date', todayStr)
    .limit(500); // safety cap — adjust if you get many users

  if (error) {
    console.error('[cron/grade-picks] Supabase fetch error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!picks?.length) {
    return NextResponse.json({ graded: 0, users: 0, skipped: 0, duration_ms: Date.now() - started });
  }

  // Group by sport + date to batch ESPN calls.
  // Normalize sport to lowercase so SPORT_PATHS lookup works regardless of DB casing.
  const groups = {};
  picks.forEach(pick => {
    const key = `${(pick.sport || '').toLowerCase()}|${pick.date}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(pick);
  });

  // Cache ESPN scoreboards so we don't re-fetch for same sport+date across users
  const scoreboardCache = {};

  let gradedCount = 0;
  let skippedCount = 0;
  const affectedUsers = new Set();

  for (const [key, groupPicks] of Object.entries(groups)) {
    const [sport, dateStr] = key.split('|');

    // Fetch (and cache) ESPN scoreboard for this sport+date
    if (!scoreboardCache[key]) {
      const espnDate = dateStr.replace(/-/g, '');
      scoreboardCache[key] = await fetchScoreboard(sport, espnDate);
    }
    const scoreboard = scoreboardCache[key];
    if (!scoreboard?.events) { skippedCount += groupPicks.length; continue; }

    for (const pick of groupPicks) {
      // Find matching ESPN event
      let matchedGame = null;
      for (const event of scoreboard.events) {
        const comps    = event.competitions?.[0]?.competitors || [];
        const homeTeam = comps.find(c => c.homeAway === 'home')?.team;
        const awayTeam = comps.find(c => c.homeAway === 'away')?.team;

        const homeMatch = teamMatches(homeTeam?.displayName || homeTeam?.name || '', pick.team)
          || teamMatches(homeTeam?.displayName || homeTeam?.name || '', pick.home_team || '');
        const awayMatch = teamMatches(awayTeam?.displayName || awayTeam?.name || '', pick.team)
          || teamMatches(awayTeam?.displayName || awayTeam?.name || '', pick.away_team || '');

        if (homeMatch || awayMatch) { matchedGame = event; break; }
      }

      if (!matchedGame) { skippedCount++; continue; }

      const gradeResult = gradePick(pick, matchedGame);
      if (!gradeResult) { skippedCount++; continue; } // game not final yet

      // Calculate profit
      const odds = parseInt(pick.odds || 0);
      let profit = null;
      if (gradeResult.result === 'WIN' && odds) {
        profit = odds > 0
          ? parseFloat((odds / 100).toFixed(3))
          : parseFloat((100 / Math.abs(odds)).toFixed(3));
      } else if (gradeResult.result === 'LOSS') {
        profit = -1;
      } else if (gradeResult.result === 'PUSH') {
        profit = 0;
      }

      await supabase
        .from('picks')
        .update({
          result:            gradeResult.result,
          profit:            profit,
          graded_at:         new Date().toISOString(),
          graded_home_score: gradeResult.home_score,
          graded_away_score: gradeResult.away_score,
        })
        .eq('id', pick.id);

      gradedCount++;
      affectedUsers.add(pick.user_id);
    }
  }

  const summary = {
    graded:      gradedCount,
    users:       affectedUsers.size,
    skipped:     skippedCount,
    duration_ms: Date.now() - started,
    run_at:      new Date().toISOString(),
  };

  console.log('[cron/grade-picks]', summary);

  // Store last-run stats in settings table for Admin Panel visibility
  await supabase.from('settings').upsert(
    [{ key: 'cron_grade_last_run', value: JSON.stringify(summary) }],
    { onConflict: 'key' }
  ).catch(() => {});

  return NextResponse.json(summary);
}
