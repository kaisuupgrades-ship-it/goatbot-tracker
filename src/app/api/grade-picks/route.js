/**
 * /api/grade-picks
 * Auto-grades pending picks by checking ESPN for final scores.
 *
 * POST { userId } → grades all PENDING picks for that user whose game date has passed
 * Returns { graded: [{ id, result, home_score, away_score }], count }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 45;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
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
  // Only grade if game is truly final
  if (!['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_PERIOD'].includes(status)) return null;

  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === 'home');
  const away = competitors.find(c => c.homeAway === 'away');
  if (!home || !away) return null;

  const homeScore = parseFloat(home.score || 0);
  const awayScore = parseFloat(away.score || 0);
  const totalScore = homeScore + awayScore;

  const betType = (pick.bet_type || 'Moneyline').toLowerCase();
  const pickTeam = (pick.team || '').toLowerCase();
  const pickSide = (pick.side || '').toLowerCase(); // 'home' | 'away' | 'over' | 'under'
  const line = parseFloat(pick.line || pick.spread_line || 0);

  // Determine which side the user picked
  const pickedHome = teamMatches(home.team?.displayName || home.team?.name || '', pick.team)
    || pickSide === 'home';
  const pickedAway = teamMatches(away.team?.displayName || away.team?.name || '', pick.team)
    || pickSide === 'away';

  let result = 'PENDING';

  if (betType.includes('moneyline') || betType.includes('ml')) {
    const homeWon = homeScore > awayScore;
    if (pickedHome) result = homeWon ? 'WIN' : 'LOSS';
    else if (pickedAway) result = !homeWon ? 'WIN' : 'LOSS';
    // Tie → push (rare in these sports)
    if (homeScore === awayScore) result = 'PUSH';

  } else if (betType.includes('spread') || betType.includes('run line') || betType.includes('puck line')) {
    // Positive line = underdog, negative = favorite
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
      if (totalScore > line)  result = isOver ? 'WIN' : 'LOSS';
      else if (totalScore < line) result = isUnder ? 'WIN' : 'LOSS';
      else result = 'PUSH';
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

export async function POST(req) {
  try {
    const body = await req.json();
    const { userId, force = false } = body;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    // Grade picks whose game_date <= today (not just yesterday).
    // gradePick() already checks ESPN for STATUS_FINAL so in-progress games are skipped safely.
    const todayStr = new Date().toISOString().split('T')[0];

    let query = supabase
      .from('picks')
      .select('*')
      .eq('user_id', userId)
      .lte('game_date', todayStr)
      .limit(100);

    // Normal mode: only PENDING picks. Force mode: re-check recent picks too (last 7 days).
    if (force) {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      query = supabase
        .from('picks')
        .select('*')
        .eq('user_id', userId)
        .gte('game_date', weekAgo)
        .lte('game_date', todayStr)
        .limit(100);
    } else {
      query = query.eq('result', 'PENDING');
    }

    const { data: picks, error } = await query;

    if (error) throw error;
    if (!picks?.length) return NextResponse.json({ graded: [], count: 0 });

    // Group picks by sport + date to minimize ESPN calls
    const groups = {};
    picks.forEach(pick => {
      const key = `${pick.sport}|${pick.game_date}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(pick);
    });

    const graded = [];

    for (const [key, groupPicks] of Object.entries(groups)) {
      const [sport, dateStr] = key.split('|');
      const espnDate = dateStr.replace(/-/g, '');
      const scoreboard = await fetchScoreboard(sport, espnDate);
      if (!scoreboard?.events) continue;

      for (const pick of groupPicks) {
        // Find matching game in ESPN events
        let matchedGame = null;
        for (const event of scoreboard.events) {
          const comps = event.competitions?.[0]?.competitors || [];
          const homeTeam = comps.find(c => c.homeAway === 'home')?.team;
          const awayTeam = comps.find(c => c.homeAway === 'away')?.team;

          const homeMatch = teamMatches(homeTeam?.displayName || homeTeam?.name || '', pick.team)
            || teamMatches(homeTeam?.displayName || homeTeam?.name || '', pick.home_team || '');
          const awayMatch = teamMatches(awayTeam?.displayName || awayTeam?.name || '', pick.team)
            || teamMatches(awayTeam?.displayName || awayTeam?.name || '', pick.away_team || '');

          if (homeMatch || awayMatch) {
            matchedGame = event;
            break;
          }
        }

        if (!matchedGame) continue;

        const gradeResult = gradePick(pick, matchedGame);
        if (!gradeResult) continue;

        // Calculate profit
        const odds = parseInt(pick.odds || 0);
        let profit = null;
        if (gradeResult.result === 'WIN' && odds) {
          profit = odds > 0 ? parseFloat((odds / 100).toFixed(3)) : parseFloat((100 / Math.abs(odds)).toFixed(3));
        } else if (gradeResult.result === 'LOSS') {
          profit = -1;
        } else if (gradeResult.result === 'PUSH') {
          profit = 0;
        }

        // Update the pick in Supabase
        await supabase
          .from('picks')
          .update({
            result: gradeResult.result,
            profit: profit,
            graded_at: new Date().toISOString(),
            graded_home_score: gradeResult.home_score,
            graded_away_score: gradeResult.away_score,
          })
          .eq('id', pick.id);

        graded.push({ id: pick.id, result: gradeResult.result, ...gradeResult });
      }
    }

    return NextResponse.json({ graded, count: graded.length });
  } catch (err) {
    console.error('grade-picks error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
