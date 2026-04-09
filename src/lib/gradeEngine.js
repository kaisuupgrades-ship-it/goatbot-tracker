import { teamsMatch as _teamsMatch } from '@/lib/teamNormalizer';

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
    // Only strip suffixes like "FC", "SC" — NOT distinguishing words like "city", "united"
    .replace(/\b(fc|sc|cf|ac)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Wrapper around the shared teamsMatch from teamNormalizer.
 * Accepts an optional sport parameter for alias-aware disambiguation.
 * Kept as a named export for backward compatibility with grading callers.
 */
export function teamMatches(a, b, sport) {
  return _teamsMatch(a, b, sport);
}

/** "BOS @ TB" or "PHI vs COL" or "Tulsa at Auburn" → { away, home } normalized strings */
export function parseMatchupStr(matchup) {
  if (!matchup) return null;
  const lower = matchup.toLowerCase();
  const atIdx = lower.indexOf(' @ ');
  const vsIdx = lower.indexOf(' vs ');
  // " at " as a word — only treat as separator when surrounded by spaces
  // e.g. "Tulsa at Auburn" but not "Washington" containing "at"
  const atWordIdx = lower.search(/\s+at\s+/);
  if (atIdx > -1) return { away: normalize(matchup.slice(0, atIdx)),  home: normalize(matchup.slice(atIdx + 3)) };
  if (vsIdx > -1) return { away: normalize(matchup.slice(0, vsIdx)),  home: normalize(matchup.slice(vsIdx + 4)) };
  if (atWordIdx > -1) {
    const atWordMatch = lower.match(/^(.*?)\s+at\s+(.*?)$/);
    if (atWordMatch) return { away: normalize(atWordMatch[1]), home: normalize(atWordMatch[2]) };
  }
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
 * "Auburn -1.5 live spread" → -1.5  (number BEFORE keyword)
 */
export function parseLineFromNotes(notes) {
  if (!notes) return null;
  // Pattern 1: keyword THEN number  e.g. "spread -1.5" / "over 7.5"
  const m1 = notes.match(/(?:over|under|total|spread|line|o\/u|ou)\s*([+-]?\d+(?:\.\d+)?)/i);
  if (m1) return parseFloat(m1[1]);
  // Pattern 2: number THEN unit word  e.g. "-1.5 total points"
  const m2 = notes.match(/([+-]?\d+\.\d+)\s*(?:total|points|runs|goals|assists)/i);
  if (m2) return parseFloat(m2[1]);
  // Pattern 3: number immediately BEFORE spread/line keyword (possibly with words in between)
  // e.g. "Auburn -1.5 live spread" or "team -2.5 run line"
  const m3 = notes.match(/([+-]?\d+(?:\.\d+)?)\s+(?:\w+\s+)*(?:spread|run line|puck line|line)/i);
  if (m3) return parseFloat(m3[1]);
  return null;
}

/**
 * Extract spread/total line embedded in the team name field.
 * "UConn Huskies +6.5"  → 6.5
 * "Detroit Tigers -1.5"  → -1.5
 * "Michigan -6.5"        → -6.5
 * "Over 8.5"             → 8.5
 * "Cowboys +3"           → 3
 */
export function parseLineFromTeam(team) {
  if (!team) return null;
  const m = team.match(/[+-]\d+(?:\.\d+)?(?:\s*$)/);
  if (m) return parseFloat(m[0]);
  const m2 = team.match(/(?:over|under|o|u)\s*(\d+(?:\.\d+)?)/i);
  if (m2) return parseFloat(m2[1]);
  return null;
}

/**
 * Strip spread/line numbers from team name for cleaner ESPN matching.
 * "UConn Huskies +6.5" → "UConn Huskies"
 * "Detroit Tigers -1.5" → "Detroit Tigers"
 */
export function stripLineFromTeam(team) {
  if (!team) return team;
  return team
    .replace(/\s*[+-]\d+(?:\.\d+)?\s*$/, '')
    .replace(/\s+(?:ML|ml|Ml)\s*$/, '')
    .trim();
}

/**
 * Does this ESPN game match the pick's game?
 * Handles normal team names AND "ILL vs UCONN" style team fields.
 */
export function pickMatchesGame(pick, homeTeamName, awayTeamName) {
  // Strip embedded spread/line numbers before matching
  const teamField = stripLineFromTeam(pick.team || '');

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

  // Resolve line: stored column → parse from team name → parse from notes → null
  // Must produce null (not NaN) when nothing resolves — the spread/total guards check isNaN(line).
  const _rawLine = pick.line ?? parseLineFromTeam(pick.team) ?? parseLineFromNotes(pick.notes) ?? null;
  const _parsedLine = _rawLine !== null ? parseFloat(_rawLine) : null;
  const line = (_parsedLine !== null && !isNaN(_parsedLine)) ? _parsedLine : null;

  const total = homeScore + awayScore;

  // For side detection, strip the line number from team name first so "UConn Huskies +6.5"
  // matches against ESPN's "UConn Huskies" cleanly.
  const cleanPick = { ...pick, team: stripLineFromTeam(pick.team) };
  const side  = determineSide(cleanPick, homeTeamName, awayTeamName);

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
    if (line === null || isNaN(line)) {
      // No line value — cannot grade this spread bet (would silently PUSH otherwise)
      console.warn('[gradeEngine] Spread bet has no line for pick id:', pick.id, '— skipping');
      return null;
    }
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

    if (line !== null && !isNaN(line)) {
      if (total > line)      result = isOver  ? 'WIN' : isUnder ? 'LOSS' : null;
      else if (total < line) result = isUnder ? 'WIN' : isOver  ? 'LOSS' : null;
      else                   result = 'PUSH';
    } else {
      // line is null or NaN — cannot grade this total bet
      console.warn('[gradeEngine] Total bet has no line for pick id:', pick.id, '— skipping');
      return null;
    }
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
  if (result === 'WIN') {
    if (odds > 0) {
      profit = parseFloat(((odds / 100) * units).toFixed(3));
    } else if (odds < 0) {
      profit = parseFloat(((100 / Math.abs(odds)) * units).toFixed(3));
    } else {
      // No odds stored — default to 1:1 payout (treat as +100 even money)
      profit = parseFloat(units.toFixed(3));
    }
  } else if (result === 'LOSS') {
    profit = parseFloat((-units).toFixed(3));
  } else if (result === 'PUSH') {
    profit = 0;
  }

  return { result, profit, home_score: homeScore, away_score: awayScore };
}

// ESPN sport path map — used by all grading routes
export const SPORT_PATHS = {
  mlb:              'baseball/mlb',
  nfl:              'football/nfl',
  nba:              'basketball/nba',
  nhl:              'hockey/nhl',
  ncaaf:            'football/college-football',
  ncaab:            'basketball/mens-college-basketball',
  mls:              'soccer/usa.1',
  wnba:             'basketball/wnba',
  ufc:              'mma/ufc',
  // Soccer leagues (specific)
  'serie a':        'soccer/ita.1',
  'premier league': 'soccer/eng.1',
  'la liga':        'soccer/esp.1',
  'bundesliga':     'soccer/ger.1',
  'ligue 1':        'soccer/fra.1',
  'champions league': 'soccer/uefa.champions',
  'europa league':  'soccer/uefa.europa',
  'conference league': 'soccer/uefa.europa.conf',
  'eredivisie':     'soccer/ned.1',
  'brasileirao':    'soccer/bra.1',
  'primeira liga':  'soccer/por.1',
  'mls':            'soccer/usa.1',
};

// For generic "Soccer" picks, we try all soccer leagues in priority order
export const SOCCER_FALLBACK_PATHS = [
  'soccer/eng.1',       // Premier League
  'soccer/esp.1',       // La Liga
  'soccer/ita.1',       // Serie A
  'soccer/ger.1',       // Bundesliga
  'soccer/fra.1',       // Ligue 1
  'soccer/uefa.champions',
  'soccer/uefa.europa',
  'soccer/ned.1',
  'soccer/por.1',
  'soccer/usa.1',       // MLS
  'soccer/bra.1',
];

export async function fetchESPNScoreboard(sport, dateStr) {
  const espnDate = (dateStr || '').replace(/-/g, '');
  const sportKey = sport?.toLowerCase();
  const path = SPORT_PATHS[sportKey];

  // Generic "soccer" — try all leagues and merge events
  // NOTE: "other" does NOT fall into soccer — it's handled separately per pick type
  if (!path && sportKey === 'soccer') {
    return fetchESPNSoccerFallback(espnDate);
  }
  if (!path) return null;

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
 * For generic "Soccer" picks — fan out across all major leagues,
 * merge their events into a single synthetic scoreboard object.
 */
export async function fetchESPNSoccerFallback(espnDate) {
  const results = await Promise.allSettled(
    SOCCER_FALLBACK_PATHS.map(p =>
      fetch(
        `https://site.api.espn.com/apis/site/v2/sports/${p}/scoreboard?dates=${espnDate}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      ).then(r => r.ok ? r.json() : null).catch(() => null)
    )
  );
  const allEvents = [];
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.events?.length) {
      allEvents.push(...r.value.events);
    }
  }
  return allEvents.length ? { events: allEvents } : null;
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

      // Only grade truly finished games.
      // Accept STATUS_FINAL* (covers STATUS_FINAL_OT, STATUS_FINAL_SO, STATUS_FINAL_PEN, etc.)
      // and STATUS_FULL_TIME (soccer). Excludes STATUS_END_PERIOD (NHL/NBA intermission).
      if (!(statusName?.startsWith('STATUS_FINAL') || statusName === 'STATUS_FULL_TIME')) continue;

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
      if (!gradeResult) continue; // game matched but couldn't grade (e.g. no line) — try next game

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
