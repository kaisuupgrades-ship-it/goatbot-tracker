/**
 * /api/grade-game
 * Client-triggered instant grading when ScoreboardTab / HistoryTab detects STATUS_FINAL.
 * Accepts final score data directly — no ESPN fetch needed. Grades ALL users' PENDING picks
 * for that game and returns the graded list so the caller can update UI immediately.
 *
 * POST { sport, homeTeam, awayTeam, homeScore, awayScore, gameDate }
 * → { graded: [{ id, user_id, result, profit, home_score, away_score }], count }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function normalize(str) {
  return (str || '').toLowerCase()
    .replace(/\b(fc|sc|cf|ac|united|city|town|utd)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function teamMatches(a, b) {
  if (!a || !b) return false;
  const n1 = normalize(a);
  const n2 = normalize(b);
  if (!n1 || !n2) return false;
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

function parseMatchup(matchup) {
  if (!matchup) return null;
  const lower = matchup.toLowerCase();
  const atIdx = lower.indexOf(' @ ');
  const vsIdx = lower.indexOf(' vs ');
  if (atIdx > -1) return { away: normalize(matchup.slice(0, atIdx)), home: normalize(matchup.slice(atIdx + 3)) };
  if (vsIdx > -1) return { away: normalize(matchup.slice(0, vsIdx)), home: normalize(matchup.slice(vsIdx + 4)) };
  return null;
}

function pickBelongsToGame(pick, homeTeam, awayTeam) {
  // Does this pick belong to this game?
  if (teamMatches(homeTeam, pick.team) || teamMatches(awayTeam, pick.team)) return true;
  if (pick.home_team && (teamMatches(homeTeam, pick.home_team) || teamMatches(awayTeam, pick.home_team))) return true;
  if (pick.away_team && (teamMatches(homeTeam, pick.away_team) || teamMatches(awayTeam, pick.away_team))) return true;
  // Parse matchup hint e.g. "BOS @ TB"
  if (pick.matchup) {
    const parsed = parseMatchup(pick.matchup);
    if (parsed) {
      const homeN = normalize(homeTeam);
      const awayN = normalize(awayTeam);
      if ((parsed.home && (homeN.includes(parsed.home) || parsed.home.includes(homeN.slice(0, 3)))) ||
          (parsed.away && (awayN.includes(parsed.away) || parsed.away.includes(awayN.slice(0, 3))))) {
        return true;
      }
    }
  }
  return false;
}

function determinePickSide(pick, homeTeam, awayTeam) {
  // Returns 'home' | 'away' | null
  if ((pick.side || '').toLowerCase() === 'home') return 'home';
  if ((pick.side || '').toLowerCase() === 'away') return 'away';

  // Match by team name
  if (teamMatches(homeTeam, pick.team)) return 'home';
  if (teamMatches(awayTeam, pick.team)) return 'away';

  // Stored home_team / away_team fields
  if (pick.home_team && teamMatches(homeTeam, pick.home_team)) return 'home';
  if (pick.away_team && teamMatches(awayTeam, pick.away_team)) return 'away';

  // Parse matchup abbreviation
  if (pick.matchup) {
    const parsed = parseMatchup(pick.matchup);
    if (parsed) {
      const teamN = normalize(pick.team);
      if (parsed.away && parsed.away.length >= 2 && (teamN.includes(parsed.away) || parsed.away.includes(teamN.slice(0, 4)))) return 'away';
      if (parsed.home && parsed.home.length >= 2 && (teamN.includes(parsed.home) || parsed.home.includes(teamN.slice(0, 4)))) return 'home';
    }
  }
  return null;
}

function gradePickDirect(pick, homeTeam, awayTeam, homeScore, awayScore) {
  const betType  = (pick.bet_type || 'Moneyline').toLowerCase();
  const line     = parseFloat(pick.line || pick.spread_line || 0);
  const total    = homeScore + awayScore;

  const side = determinePickSide(pick, homeTeam, awayTeam);
  let result = 'PENDING';

  if (betType.includes('moneyline') || betType.includes('ml')) {
    const homeWon = homeScore > awayScore;
    if (homeScore === awayScore) {
      result = 'PUSH';
    } else if (side === 'home') {
      result = homeWon ? 'WIN' : 'LOSS';
    } else if (side === 'away') {
      result = !homeWon ? 'WIN' : 'LOSS';
    }
  } else if (betType.includes('spread') || betType.includes('run line') || betType.includes('puck line')) {
    if (side === 'home') {
      const covered = (homeScore + line) > awayScore;
      const push    = (homeScore + line) === awayScore;
      result = push ? 'PUSH' : covered ? 'WIN' : 'LOSS';
    } else if (side === 'away') {
      const covered = (awayScore + line) > homeScore;
      const push    = (awayScore + line) === homeScore;
      result = push ? 'PUSH' : covered ? 'WIN' : 'LOSS';
    }
  } else if (betType.includes('over') || betType.includes('under') || betType.includes('total')) {
    const isOver  = betType.includes('over')  || (pick.side || '').toLowerCase() === 'over';
    const isUnder = betType.includes('under') || (pick.side || '').toLowerCase() === 'under';
    if (line > 0) {
      if (total > line)      result = isOver  ? 'WIN' : isUnder ? 'LOSS' : 'PENDING';
      else if (total < line) result = isUnder ? 'WIN' : isOver  ? 'LOSS' : 'PENDING';
      else                   result = 'PUSH';
    }
  }

  return result === 'PENDING' ? null : result;
}

export async function POST(req) {
  try {
    const { sport, homeTeam, awayTeam, homeScore, awayScore, gameDate } = await req.json();

    if (!homeTeam || !awayTeam || !gameDate) {
      return NextResponse.json({ error: 'homeTeam, awayTeam, gameDate required' }, { status: 400 });
    }

    // Find ALL PENDING picks for this date + sport across all users
    let query = supabase
      .from('picks')
      .select('*')
      .eq('result', 'PENDING')
      .eq('date', gameDate);

    if (sport) {
      // Match case-insensitively by filtering client-side (sport stored as 'NHL', 'MLB', etc.)
      const { data: allPending } = await query;
      const sportLower = sport.toLowerCase();
      var picks = (allPending || []).filter(p => (p.sport || '').toLowerCase() === sportLower);
    } else {
      const { data } = await query.limit(500);
      var picks = data || [];
    }

    if (!picks.length) return NextResponse.json({ graded: [], count: 0 });

    const graded = [];

    for (const pick of picks) {
      // Check if this pick is for this specific game
      if (!pickBelongsToGame(pick, homeTeam, awayTeam)) continue;

      const result = gradePickDirect(pick, homeTeam, awayTeam, homeScore, awayScore);
      if (!result) continue;

      const odds = parseInt(pick.odds || 0);
      let profit = null;
      if (result === 'WIN' && odds) {
        profit = odds > 0
          ? parseFloat((odds / 100).toFixed(3))
          : parseFloat((100 / Math.abs(odds)).toFixed(3));
      } else if (result === 'LOSS') {
        profit = -1;
      } else if (result === 'PUSH') {
        profit = 0;
      }

      const { error } = await supabase
        .from('picks')
        .update({
          result,
          profit,
          graded_at:         new Date().toISOString(),
          graded_home_score: homeScore,
          graded_away_score: awayScore,
        })
        .eq('id', pick.id);

      if (!error) {
        graded.push({
          id:         pick.id,
          user_id:    pick.user_id,
          result,
          profit,
          home_score: homeScore,
          away_score: awayScore,
          contest_entry: pick.contest_entry,
        });
      }
    }

    console.log(`[grade-game] ${homeTeam} vs ${awayTeam} ${homeScore}-${awayScore}: graded ${graded.length} picks`);
    return NextResponse.json({ graded, count: graded.length });

  } catch (err) {
    console.error('[grade-game] error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
