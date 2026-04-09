/**
 * contestValidation.js — pure code contest entry validation.
 * Zero AI tokens. Deterministic. Runs on client (instant UI feedback)
 * AND on the server (enforcement at save time).
 *
 * Usage:
 *   const { valid, errors, warnings } = validateContestEntry(pick, rules);
 *
 * rules shape (all fields optional — omit to skip that check):
 * {
 *   allowed_sports:       string[]   // e.g. ['MLB', 'NBA']
 *   allowed_bet_types:    string[]   // e.g. ['Moneyline', 'Spread']
 *   no_parlays:           boolean
 *   min_odds:             number     // e.g. -200 (American)
 *   max_odds:             number     // e.g. +500
 *   require_odds:         boolean    // odds field must be filled
 *   start_date:           string     // 'YYYY-MM-DD'
 *   end_date:             string     // 'YYYY-MM-DD'
 *   max_picks_per_day:    number
 *   picks_today:          number     // pass in from DB query
 *   require_matchup:      boolean    // matchup field must be filled
 *   min_units:            number     // minimum bet size
 *   max_units:            number     // maximum bet size
 * }
 */

export function validateContestEntry(pick, rules = {}) {
  const errors   = [];
  const warnings = [];

  if (!pick) return { valid: false, errors: ['No pick data provided'], warnings };

  // ── Sport filter ────────────────────────────────────────────────────────────
  if (rules.allowed_sports?.length) {
    const pickSport = (pick.sport || '').toUpperCase();
    const allowed   = rules.allowed_sports.map(s => s.toUpperCase());
    if (!allowed.includes(pickSport)) {
      errors.push(`Sport "${pick.sport}" is not allowed. Contest accepts: ${rules.allowed_sports.join(', ')}.`);
    }
  }

  // ── Bet type filter ─────────────────────────────────────────────────────────
  if (rules.allowed_bet_types?.length) {
    const pickType = (pick.bet_type || '').toLowerCase();
    const allowed  = rules.allowed_bet_types.map(t => t.toLowerCase());
    if (!allowed.some(a => pickType === a)) {
      errors.push(`Bet type "${pick.bet_type}" is not allowed. Contest accepts: ${rules.allowed_bet_types.join(', ')}.`);
    }
  }

  // ── No parlays ──────────────────────────────────────────────────────────────
  if (rules.no_parlays && (pick.bet_type || '').toLowerCase() === 'parlay') {
    errors.push('Parlays are not allowed in this contest.');
  }

  // ── Odds range ──────────────────────────────────────────────────────────────
  const odds = parseFloat(pick.odds);
  if (rules.require_odds && (!pick.odds || isNaN(odds))) {
    errors.push('Odds are required for contest entries.');
  }
  if (!isNaN(odds) && pick.odds) {
    if (rules.min_odds != null && odds < rules.min_odds) {
      errors.push(`Odds too short — contest minimum is ${rules.min_odds > 0 ? '+' : ''}${rules.min_odds}.`);
    }
    if (rules.max_odds != null && odds > rules.max_odds) {
      errors.push(`Odds too high — contest maximum is ${rules.max_odds > 0 ? '+' : ''}${rules.max_odds}.`);
    }
  }

  // ── Date range ──────────────────────────────────────────────────────────────
  if (pick.date) {
    if (rules.start_date && pick.date < rules.start_date) {
      errors.push(`Pick date (${pick.date}) is before the contest start date (${rules.start_date}).`);
    }
    if (rules.end_date && pick.date > rules.end_date) {
      errors.push(`Pick date (${pick.date}) is after the contest end date (${rules.end_date}).`);
    }
  }

  // ── Daily pick limit ────────────────────────────────────────────────────────
  if (rules.max_picks_per_day != null && rules.picks_today != null) {
    if (rules.picks_today >= rules.max_picks_per_day) {
      errors.push(`Daily limit reached — max ${rules.max_picks_per_day} contest pick${rules.max_picks_per_day !== 1 ? 's' : ''} per day.`);
    } else if (rules.picks_today >= rules.max_picks_per_day - 1) {
      warnings.push(`This is your last contest pick for today (limit: ${rules.max_picks_per_day}/day).`);
    }
  }

  // ── Matchup required ────────────────────────────────────────────────────────
  if (rules.require_matchup && !pick.matchup?.trim()) {
    errors.push('Matchup field is required for contest entries (e.g. "BOS @ TB").');
  }

  // ── Units range ─────────────────────────────────────────────────────────────
  const units = parseFloat(pick.units ?? 1);
  if (rules.min_units != null && units < rules.min_units) {
    errors.push(`Minimum bet size for contest entries is ${rules.min_units}u.`);
  }
  if (rules.max_units != null && units > rules.max_units) {
    errors.push(`Maximum bet size for contest entries is ${rules.max_units}u.`);
  }

  // ── Soft warnings (never block) ─────────────────────────────────────────────
  if (!pick.team?.trim()) {
    warnings.push('Team name is empty — grading may not work correctly.');
  }
  if (!pick.odds || isNaN(parseInt(pick.odds))) {
    warnings.push('No odds entered — profit/loss calculations will be unavailable.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Default contest rules used when no custom rules are configured.
 * Conservative defaults that work for a general sports betting contest.
 */
export const DEFAULT_CONTEST_RULES = {
  require_odds:    true,
  require_matchup: false,
  no_parlays:      false,
  min_odds:        -350, // reject extreme chalk
  max_picks_per_day: 5,
};

/**
 * Human-readable summary of active rules (for displaying in UI).
 */
export function describeRules(rules = {}) {
  const parts = [];
  if (rules.allowed_sports?.length)    parts.push(`Sports: ${rules.allowed_sports.join(', ')}`);
  if (rules.allowed_bet_types?.length) parts.push(`Bet types: ${rules.allowed_bet_types.join(', ')}`);
  if (rules.no_parlays)                parts.push('No parlays');
  if (rules.min_odds != null)          parts.push(`Min odds: ${rules.min_odds > 0 ? '+' : ''}${rules.min_odds}`);
  if (rules.max_odds != null)          parts.push(`Max odds: ${rules.max_odds > 0 ? '+' : ''}${rules.max_odds}`);
  if (rules.max_picks_per_day != null) parts.push(`Max ${rules.max_picks_per_day} picks/day`);
  if (rules.start_date)                parts.push(`From ${rules.start_date}`);
  if (rules.end_date)                  parts.push(`Until ${rules.end_date}`);
  return parts;
}
