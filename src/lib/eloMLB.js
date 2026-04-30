/**
 * MLB Elo rating engine.
 *
 * Pure functions — no DB, no network. Input: array of completed games.
 * Output: power ratings per team that we can compare to market-implied
 * probabilities to find +EV bets.
 *
 * Tuning notes (these are the levers you'd touch to recalibrate):
 *   K_FACTOR        — how much each game moves a rating (4 is standard for MLB:
 *                     low because baseball is high-variance, single games are
 *                     weak signal, 30-game stretches matter more)
 *   HOME_FIELD      — Elo points added to the home team's effective rating
 *                     when computing win probability (~24 = ~3% home edge,
 *                     consistent with empirical MLB home win rate of 53%)
 *   SEASON_REGRESS  — at the start of each season, ratings get pulled this
 *                     fraction of the way back to the league mean (1500).
 *                     0.25 reflects roster turnover + regression to the mean.
 *   MOV_MULT        — margin-of-victory multiplier. A 10-run blowout teaches
 *                     us more than a 1-run win. Capped via log so a 20-run
 *                     game doesn't dominate.
 *
 * Win-probability formula uses the standard Elo expectation:
 *   P(home) = 1 / (1 + 10^((Elo_away - (Elo_home + HOME_FIELD)) / 400))
 */

const DEFAULT_RATING  = 1500;
const K_FACTOR        = 4;
const HOME_FIELD      = 24;
const SEASON_REGRESS  = 0.25;

// Margin-of-victory amplifier. log(rd+1) where rd = run differential.
function movMultiplier(homeScore, awayScore) {
  const rd = Math.abs((homeScore | 0) - (awayScore | 0));
  if (rd <= 0) return 1;
  return Math.log(rd + 1) / Math.log(2); // log2(rd+1): 1 run→1, 3 runs→2, 7 runs→3
}

function expectedHomeProb(homeRating, awayRating) {
  return 1 / (1 + Math.pow(10, (awayRating - (homeRating + HOME_FIELD)) / 400));
}

/**
 * Build current power ratings from a list of completed games.
 *
 * @param {Array} games - each: { home_team, away_team, home_score, away_score, game_date, season? }
 *                        Must be sorted ASC by game_date for season-regression to work.
 * @param {Object} opts - { initialRating?, kFactor?, regressOnSeasonChange? }
 * @returns {Object} { ratings: { TEAM: rating, ... }, gameCount, lastDate }
 */
export function buildMLBElo(games, opts = {}) {
  const initialRating = opts.initialRating ?? DEFAULT_RATING;
  const k             = opts.kFactor       ?? K_FACTOR;
  const regressFlag   = opts.regressOnSeasonChange !== false;

  const ratings = {};
  let lastSeason = null;
  let gameCount = 0;
  let lastDate  = null;

  // Stable iteration order: sort games asc by game_date if not already
  const sorted = [...games].sort((a, b) =>
    String(a.game_date || '').localeCompare(String(b.game_date || ''))
  );

  for (const g of sorted) {
    const home = g.home_team;
    const away = g.away_team;
    const hs   = Number(g.home_score);
    const as   = Number(g.away_score);

    if (!home || !away) continue;
    if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
    if (hs === as) continue; // tie / unfinished — skip

    // Season regression: when the season-tag changes, pull ratings 25% to mean
    const season = g.season ?? (g.game_date ? Number(String(g.game_date).slice(0, 4)) : null);
    if (regressFlag && season != null && lastSeason != null && season !== lastSeason) {
      for (const t of Object.keys(ratings)) {
        ratings[t] = ratings[t] * (1 - SEASON_REGRESS) + initialRating * SEASON_REGRESS;
      }
    }
    lastSeason = season;

    if (ratings[home] == null) ratings[home] = initialRating;
    if (ratings[away] == null) ratings[away] = initialRating;

    const expHome = expectedHomeProb(ratings[home], ratings[away]);
    const actualHome = hs > as ? 1 : 0;
    const mov = movMultiplier(hs, as);

    const delta = k * mov * (actualHome - expHome);
    ratings[home] += delta;
    ratings[away] -= delta;

    gameCount++;
    lastDate = g.game_date;
  }

  return { ratings, gameCount, lastDate };
}

/**
 * Predict win probability for an upcoming game given current ratings.
 *
 * @param {Object} ratings - { TEAM: number }
 * @param {string} homeTeam
 * @param {string} awayTeam
 * @returns {{ homeProb: number, awayProb: number, homeRating: number, awayRating: number }}
 *          Returns null if either team has no rating yet.
 */
export function predictMLBGame(ratings, homeTeam, awayTeam) {
  const homeRating = ratings?.[homeTeam];
  const awayRating = ratings?.[awayTeam];
  if (homeRating == null || awayRating == null) return null;
  const homeProb = expectedHomeProb(homeRating, awayRating);
  return {
    homeProb,
    awayProb: 1 - homeProb,
    homeRating,
    awayRating,
  };
}

/**
 * Top-N teams by rating, useful for sanity-checking the engine. If your top-5
 * doesn't roughly match Vegas/FanGraphs power rankings, the engine is broken
 * before you bet a single dollar based on it.
 */
export function topN(ratings, n = 10) {
  return Object.entries(ratings)
    .map(([team, rating]) => ({ team, rating: Math.round(rating * 10) / 10 }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, n);
}

/**
 * Standard exports for downstream consumers.
 */
export const ELO_CONSTANTS = {
  DEFAULT_RATING,
  K_FACTOR,
  HOME_FIELD,
  SEASON_REGRESS,
};
