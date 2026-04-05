/**
 * gradeEngine.js — shared, battle-tested pick grading logic.
 *
 * Used by:
 *  - /api/grade-picks     (user-triggered, single user)
 *  - /api/cron/grade-picks (scheduled, all users)
 *  - /api/grade-game      (client-triggered instant grading)
 *
 * Key fixes vs old code:
 *  1. teamMatches() guards empty strings (no false positives)
 *  2. parseLineFromNotes() extracts spread/total when pick.line is null
 *  3. extractTeamFromMatchup() handles "ILL vs UCONN" style team fields
 *  4. 4-tier home/away detection (side → team name → home/away fields → matchup parse)
 *  5. Totals grade correctly even without a stored line column
 */

export function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/\b(fc|sc|cf|ac|united|city|town|utd)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/** Never return true when either side is blank — prevents ghost matches */
export function teamMatches(a, b) {
  if (!a || !b) return false;
  const n1 = normalize(a);
  const n2 = normalize(b);
  if (!n1 || !n2) return false;
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}

/** "BOS @ TB" or "PHI vs COL" → { away, home } normalized strings */
export function parseMatchupStr(matchup) {
  if (!matchup) return null;
  const lower = matchup.toLowerCase();
  const atIdx = lower.indexOf(' @ ');
  const vsIdx = lower.indexOf(' vs ');
  if (atIdx > -1) return { away: normalize(matchup.slice(0, atIdx)),  home: normalize(matchup.slice(atIdx + 3)) };
  if (vsIdx > -1) return { away: normalize(matchup.slice(0, vsIdx)),  home: normalize(matchup.slice(vsIdx + 4)) };
  return null;
}

/**
 * When a user types "ILL vs UCONN" into the team field for a total bet,
 * we can't match on a single team — extract both sides and try each against ESPN.
 */
export function isMatchupString(str) {
  if (!str) return false;
  const s = str.toLowerCase();
  return s.includes(' vs ') || s.includes(' @ ');
}

/**
 * Try to extract the spread/total line from the notes field.
 * "Under 139.5 total points" → 139.5
 * "LAD -1.5 run line"       → -1.5
 * "Over 7.5"                → 7.5
 */
export function parseLineFromNotes(notes) {
  if (!notes) return null;
  // Look for a number that follows over/under/total/spread keywords
  const match = notes.match(/(?:over|under|total|spread|line|o\/u|ou)\s*([+-]?\d+(?:\.\d+)?)/i)
    || notes.match(/([+-]?\d+\.\d+)\s*(?:total|points|runs|goals|assists)/i);
  if (match) return parseFloat(match[1]);
  return null;
}

/**
 * Does this ESPN game match the pick's game?
 * Handles normal team names AND "ILL vs UCONN" style team fields.
 */
export function pickMatchesGame(pick, homeTeamName, awayTeamName) {
  const teamField = pick.team || '';

  if (isMatchupString(teamField)) {
    // Both sides of the matchup field need to match the ESPN game
    const parsed = parseMatchupStr(teamField);
    if (parsed) {
      const homeMatch = parsed.home && (
        normalize(homeTeamName).includes(parsed.home) || parsed.home.includes(normalize(homeTeamName).slice(0, 4))
      );
      const awayMatch = parsed.away && (
        normalize(awayTeamName).includes(parsed.away) || parsed.away.includes(normalize(awayTeamName).slice(0, 4))
      );
      if (homeMatch && awayMatch) return true;
    }
  }

  // Normal single-team match
  if (teamMatches(homeTeamName, teamField) || teamMatches(awayTeamName, teamField)) return true;

  // Fallback: stored home_team / away_team columns
  if (pick.home_team && teamMatches(homeTeamName, pick.home_team)) return true;
  if (pick.away_team && teamMatches(awayTeamName, pick.away_team)) return true;

  // Fallback: parse matchup column (separate from team field)
  if (pick.matchup) {
    const parsed = parseMatchupStr(pick.matchup);
    if (parsed) {
      const homeN = normalize(homeTeamName);
      const awayN = normalize(awayTeamName);
      if ((parsed.home && (homeN.includes(parsed.home) || parsed.home.includes(homeN.slice(0, 3)))) ||
          (parsed.away && (awayN.includes(parsed.away) || parsed.away.includes(awayN.slice(0, 3))))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 4-tier home/away detection.
 * Returns 'home' | 'away' | null
 */
export function determineSide(pick, homeTeamName, awayTeamName) {
  // Tier 1: explicit side column
  const explicitSide = (pick.side || '').toLowerCase();
  if (explicitSide === 'home') return 'home';
  if (explicitSide === 'away') return 'away';

  // Tier 2: match pick.team against ESPN names (skip if team field looks like a matchup)
  if (!isMatchupString(pick.team)) {
    if (teamMatches(homeTeamName, pick.team)) return 'home';
    if (teamMatches(awayTeamName, pick.team)) return 'away';
  }

  // Tier 3: stored home_team / away_team columns
  if (pick.home_team && teamMatches(homeTeamName, pick.home_team)) return 'home';
  if (pick.away_team && teamMatches(awayTeamName, pick.away_team)) return 'away';

  // Tier 4: parse matchup string from pick.matchup
  if (pick.matchup) {
    const parsed = parseMatchupStr(pick.matchup);
    if (parsed) {
      const teamN = normalize(pick.team);
      if (parsed.away && parsed.away.length >= 2 && (teamN.includes(parsed.away) || parsed.away.includes(teamN.slice(0, 4)))) return 'away';
      if (parsed.home && parsed.home.length >= 2 && (teamN.includes(parsed.home) || parsed.home.includes(teamN.slice(0, 4)))) return 'home';
    }
  }

  return null;
}

/**
 * Grade a single pick given the final score.
 * Returns { result: 'WIN'|'LOSS'|'PUSH', home_score, away_score } or null if can't grade.
 */
export function gradePick(pick, homeTeamName, awayTeamName, homeScore, awayScore) {
  const betType = (pick.bet_type || 'Moneyline').toLowerCase();
  const pickSide = (pick.side || '').toLowerCase(); // explicit side field

  // Resolve line: stored column → parse from notes → 0
  const line = parseFloat(pick.line ?? parseLineFromNotes(pick.notes) ?? 0);

  const total = homeScore + awayScore;
  const side  = determineSide(pick, homeTeamName, awayTeamName);

  let result = null;

  // ── Moneyline ──────────────────────────────────────────────────────────────
  if (betType.includes('moneyline') || betType === 'ml') {
    if (homeScore === awayScore) {
      result = 'PUSH';
    } else if (side === 'home') {
      result = homeScore > awayScore ? 'WIN' : 'LOSS';
    } else if (side === 'away') {
      result = awayScore > homeScore ? 'WIN' : 'LOSS';
    }

  // ── Spread / Run Line / Puck Line ─────────────────────────────────────────
  } else if (betType.includes('spread') || betType.includes('run line') || betType.includes('puck line')) {
    if (side === 'home') {
      const adj   = homeScore + line;
      result = adj > awayScore ? 'WIN' : adj < awayScore ? 'LOSS' : 'PUSH';
    } else if (side === 'away') {
      const adj   = awayScore + line;
      result = adj > homeScore ? 'WIN' : adj < homeScore ? 'LOSS' : 'PUSH';
    }

  // ── Totals (Over/Under) ───────────────────────────────────────────────────
  } else if (
    betType.includes('over') || betType.includes('under') ||
    betType.includes('total') || betType.includes('o/u')
  ) {
    const isOver  = betType.includes('over')  || pickSide === 'over'  || betType === 'total (over)';
    const isUnder = betType.includes('under') || pickSide === 'under' || betType === 'total (under)';

    if (line > 0) {
      if (total > line)      result = isOver  ? 'WIN' : isUnder ? 'LOSS' : null;
      else if (total < line) result = isUnder ? 'WIN' : isOver  ? 'LOSS' : null;
      else                   result = 'PUSH';
    }
    // No line → can't grade; return null
  }

  if (!result) return null;

  // Calculate profit using the actual units the user risked.
  // Contest 1-unit normalization happens at the leaderboard display layer
  // (contest-leaderboard/route.js → contestProfit), NOT here.
  // This keeps "My Picks" showing real units (e.g. hodgins 5u = +4.545u)
  // while the contest leaderboard shows 1u scoring for everyone.
  const odds  = parseInt(pick.odds || 0);
  const units = parseFloat(pick.units || 1);
  let profit  = null;
  if (result === 'WIN' && odds) {
    profit = odds > 0
      ? parseFloat(((odds / 100) * units).toFixed(3))
      : parseFloat(((100 / Math.abs(odds)) * units).toFixed(3));
  } else if (result === 'LOSS') {
    profit = parseFloat((-units).toFixed(3));
  } else if (result === 'PUSH') {
    profit = 0;
  }

  return { result, profit, home_score: homeScore, away_score: awayScore };
}

// ESPN sport path map — used by all grading routes
export const SPORT_PATHS = {
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

export async function fetchESPNScoreboard(sport, dateStr) {
  const path = SPORT_PATHS[sport?.toLowerCase()];
  if (!path) return null;
  const espnDate = (dateStr || '').replace(/-/g, '');
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${espnDate}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Grade a batch of picks against a scoreboard response.
 * Returns array of { id, result, profit, home_score, away_score, home_team, away_team }
 */
export function gradePicksAgainstScoreboard(picks, scoreboard) {
  const results = [];
  const events  = scoreboard?.events || [];

  for (const pick of picks) {
    for (const event of events) {
      const comp        = event.competitions?.[0];
      const statusName  = comp?.status?.type?.name;

      // Only grade FINAL games
      if (!['STATUS_FINAL', 'STATUS_FULL_TIME', 'STATUS_END_PERIOD'].includes(statusName)) continue;

      const competitors = comp?.competitors || [];
      const homeComp    = competitors.find(c => c.homeAway === 'home');
      const awayComp    = competitors.find(c => c.homeAway === 'away');
      if (!homeComp || !awayComp) continue;

      const homeTeamName = homeComp.team?.displayName || homeComp.team?.name || '';
      const awayTeamName = awayComp.team?.displayName || awayComp.team?.name || '';
      const homeScore    = parseFloat(homeComp.score ?? 0);
      const awayScore    = parseFloat(awayComp.score ?? 0);

      if (!pickMatchesGame(pick, homeTeamName, awayTeamName)) continue;

      const gradeResult = gradePick(pick, homeTeamName, awayTeamName, homeScore, awayScore);
      if (!gradeResult) break; // game matched but couldn't grade (e.g. no line) — stop searching

      results.push({
        id:        pick.id,
        user_id:   pick.user_id,
        result:    gradeResult.result,
        profit:    gradeResult.profit,
        home_score: homeScore,
        away_score: awayScore,
        home_team:  homeTeamName,
        away_team:  awayTeamName,
        contest_entry: pick.contest_entry,
      });
      break; // matched — move to next pick
    }
  }

  return results;
}
