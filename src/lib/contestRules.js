// ── Contest hard rules — single source of truth ───────────────────────────────
// Imported by: picks/route.js, verify-pick/route.js, contest-audit/route.js
// Never duplicate these constants elsewhere.

export const CONTEST_RULES = {
  minOdds:        -145,
  maxOdds:         400,
  maxUnits:          5,
  maxPicksPerDay:    1,
  allowedBetTypes: [
    'Moneyline', 'Spread', 'Run Line', 'Puck Line',
    'Total (Over)', 'Total (Under)',
    'F5 Moneyline', 'F5 Total (Over)', 'F5 Total (Under)',
    '1H Spread', '1H Total (Over)', '1H Total (Under)',
  ],
  blockedBetTypes: ['Parlay', 'Prop', 'Futures', 'Other'],
  // LOCKED: once posted, no changing, editing, or deleting
  locked: true,
  // Reschedules ≠ void. Play stands for new date.
  reschedulePolicy: 'play_stands',
};

/**
 * Validate a pick against contest rules.
 *
 * @param {object} pick        — pick fields: odds, units, bet_type, team, date
 * @param {number} dailyCount  — contest picks already logged for this date (default 0)
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
export function validateContestEligibility(pick, dailyCount = 0) {
  const reasons = [];

  const odds = parseInt(pick.odds);
  if (isNaN(odds)) {
    reasons.push('Invalid odds — must be a valid American odds number (e.g. -110, +150).');
  } else {
    if (odds < CONTEST_RULES.minOdds)
      reasons.push(`Odds ${odds} too juicy — contest minimum is ${CONTEST_RULES.minOdds}. No heavy favorites allowed.`);
    if (odds > CONTEST_RULES.maxOdds)
      reasons.push(`Odds +${odds} too long — contest maximum is +${CONTEST_RULES.maxOdds}.`);
  }

  const units = parseFloat(pick.units ?? 1);
  if (units > CONTEST_RULES.maxUnits)
    reasons.push(`${units}u exceeds the ${CONTEST_RULES.maxUnits}u per-pick max.`);

  if (CONTEST_RULES.blockedBetTypes.includes(pick.bet_type))
    reasons.push(`"${pick.bet_type}" is not allowed in contest (straight bets only — ML, spread, totals).`);

  if (!pick.team?.trim())
    reasons.push('No team/pick specified.');

  if (!pick.date)
    reasons.push('No game date specified.');

  if (dailyCount >= CONTEST_RULES.maxPicksPerDay)
    reasons.push(`Already have a contest pick for ${pick.date}. One play per day — no exceptions.`);

  return { eligible: reasons.length === 0, reasons };
}
