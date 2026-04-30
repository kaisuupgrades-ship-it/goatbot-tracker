/**
 * Closing Line Value — the single best long-run predictor of betting edge.
 *
 * CLV = how much your bet's odds beat the closing odds, expressed as a
 * percentage of true probability. Positive CLV means the market moved against
 * the side you took (you got better odds than the closing market). Over a
 * large sample, CLV+ ≈ profitable, CLV- ≈ losing money even when W/L looks ok.
 *
 * The closing line is captured automatically by /api/cron/refresh-odds — when
 * a game flips to game_status='post', the last odds_data snapshot becomes the
 * de-facto closing line. We pull odds_data.pinnacle for CLV math because
 * Pinnacle's no-vig closing line is the industry standard reference.
 *
 * Usage:
 *   const closing = extractClosingOdds(oddsCacheRow);
 *   const clv = computeCLV({ pickOdds: -130, closingOdds: closing.ml.home });
 */

// ── American odds ↔ implied probability (no-vig single-side) ────────────────
// We're computing PER-SIDE implied prob. To get the true (de-vigged) market
// probability you'd combine both sides, but for CLV the per-side number is
// what matters because we're comparing your single-side bet to the same side
// at close.

/**
 * Convert American odds to implied probability (raw, with vig).
 * @param {number} odds - e.g. -150 or +120
 * @returns {number} probability between 0 and 1
 */
export function americanToProb(odds) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/**
 * Convert American odds to decimal (European) odds.
 * Used to compute payout multipliers.
 */
export function americanToDecimal(odds) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  if (odds > 0) return 1 + odds / 100;
  return 1 + 100 / Math.abs(odds);
}

/**
 * De-vig two American odds to get the no-vig fair probability for the first.
 * Use this when you want the "true" market estimate of probability rather
 * than the with-vig number that the book is offering.
 *
 * @param {number} sideOdds - American odds of the side you care about
 * @param {number} otherOdds - American odds of the opposing side
 * @returns {number} no-vig probability
 */
export function devig(sideOdds, otherOdds) {
  const p1 = americanToProb(sideOdds);
  const p2 = americanToProb(otherOdds);
  if (p1 == null || p2 == null) return null;
  return p1 / (p1 + p2);
}

/**
 * Compute CLV for a single bet.
 *
 * Two flavors are returned:
 *   - clvProbDelta: (closingProb - pickProb) — straight percentage-point delta
 *                   in implied probability. e.g. you took -130 (56.5%) and
 *                   the close was -150 (60.0%) → +3.5 percentage points.
 *                   This is the "did the line move toward me" number.
 *   - clvPct:       % return you'd theoretically earn flat-betting your line
 *                   vs the close. Standard tout-board number.
 *
 * @param {Object} args
 * @param {number} args.pickOdds      - American odds at time of pick
 * @param {number} args.closingOdds   - American odds at game start (closing)
 * @param {number} [args.otherClosingOdds] - opposing-side closing odds, for de-vig
 * @returns {Object|null} { pickProb, closingProb, fairClosingProb, clvProbDelta, clvPct }
 */
export function computeCLV({ pickOdds, closingOdds, otherClosingOdds = null }) {
  const pickProb    = americanToProb(pickOdds);
  const closingProb = americanToProb(closingOdds);
  if (pickProb == null || closingProb == null) return null;

  const fairClosingProb = otherClosingOdds != null
    ? devig(closingOdds, otherClosingOdds)
    : closingProb;

  // Pure implied-prob delta (positive = line moved toward your side after you bet)
  const clvProbDelta = (fairClosingProb ?? closingProb) - pickProb;

  // Percentage-return interpretation: how much would you earn flat-betting
  // your odds vs the closing odds, ignoring vig?
  const pickDecimal    = americanToDecimal(pickOdds);
  const closingDecimal = americanToDecimal(closingOdds);
  const clvPct = (pickDecimal != null && closingDecimal != null && closingDecimal > 0)
    ? ((pickDecimal / closingDecimal) - 1)
    : null;

  return {
    pickProb,
    closingProb,
    fairClosingProb,
    clvProbDelta,
    clvPct,
  };
}

// ── Extracting closing odds from odds_cache.odds_data ───────────────────────
// odds_cache stores the last pre-game snapshot. Schema-wise odds_data has:
//   { pinnacle: { ml: {home,away}, total: {...}, spread: {...} },
//     bookmakers: [{ key, markets: [{ key, outcomes: [...] }] }, ...] }
// Pinnacle is preferred (sharpest book, lowest vig). Fall back to the
// median across major US books if Pinnacle is missing for this game.

const PREFERRED_FALLBACK_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'williamhill_us'];

function median(nums) {
  const xs = nums.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * Extract closing American odds from an odds_cache row's odds_data.
 *
 * @param {Object} oddsData - the odds_data jsonb column
 * @param {string} homeTeam - home team name (matches outcomes[].name)
 * @param {string} awayTeam
 * @returns {Object|null}
 *   {
 *     ml: { home, away },                    // American odds, both sides
 *     spread: { homePoint, homePrice, awayPoint, awayPrice },
 *     total: { point, overPrice, underPrice },
 *     source: 'pinnacle' | 'median' | null,
 *   }
 */
export function extractClosingOdds(oddsData, homeTeam, awayTeam) {
  if (!oddsData) return null;

  // ── Preferred: Pinnacle (sharp book, used as industry CLV reference) ─────
  const pin = oddsData.pinnacle;
  if (pin?.ml && Number.isFinite(pin.ml.home) && Number.isFinite(pin.ml.away)) {
    return {
      ml: { home: pin.ml.home, away: pin.ml.away },
      spread: pin.spread ? {
        homePoint: pin.spread.homePoint ?? null,
        homePrice: pin.spread.homePrice ?? null,
        awayPoint: pin.spread.awayPoint ?? null,
        awayPrice: pin.spread.awayPrice ?? null,
      } : null,
      total: pin.total ? {
        point:       pin.total.point      ?? null,
        overPrice:   pin.total.overPrice  ?? null,
        underPrice:  pin.total.underPrice ?? null,
      } : null,
      source: 'pinnacle',
    };
  }

  // ── Fallback: median of major US books ─────────────────────────────────────
  const books = Array.isArray(oddsData.bookmakers) ? oddsData.bookmakers : [];
  if (!books.length || !homeTeam || !awayTeam) return null;

  const mlHomeAll  = [];
  const mlAwayAll  = [];
  const sprHpAll   = []; // home points
  const sprHprAll  = []; // home price
  const sprAprAll  = []; // away price
  const totPtAll   = [];
  const totOvAll   = [];
  const totUnAll   = [];

  for (const book of books) {
    if (!PREFERRED_FALLBACK_BOOKS.includes(book.key)) continue;
    for (const market of (book.markets || [])) {
      if (market.key === 'h2h') {
        for (const o of (market.outcomes || [])) {
          if (o.name === homeTeam) mlHomeAll.push(o.price);
          if (o.name === awayTeam) mlAwayAll.push(o.price);
        }
      } else if (market.key === 'spreads') {
        for (const o of (market.outcomes || [])) {
          if (o.name === homeTeam) { sprHpAll.push(o.point); sprHprAll.push(o.price); }
          if (o.name === awayTeam) { sprAprAll.push(o.price); }
        }
      } else if (market.key === 'totals') {
        for (const o of (market.outcomes || [])) {
          if (o.name === 'Over')  { totPtAll.push(o.point); totOvAll.push(o.price); }
          if (o.name === 'Under') { totUnAll.push(o.price); }
        }
      }
    }
  }

  const mlHome = median(mlHomeAll);
  const mlAway = median(mlAwayAll);
  if (mlHome == null || mlAway == null) return null;

  return {
    ml: { home: mlHome, away: mlAway },
    spread: {
      homePoint: median(sprHpAll),
      homePrice: median(sprHprAll),
      awayPoint: sprHpAll.length ? -median(sprHpAll) : null,
      awayPrice: median(sprAprAll),
    },
    total: {
      point:       median(totPtAll),
      overPrice:   median(totOvAll),
      underPrice:  median(totUnAll),
    },
    source: 'median',
  };
}

/**
 * Try to parse American odds out of a free-form pick string like
 * "NYY ML -150" or "Over 8.5 (-110 at DK)". Returns null when no number
 * looks like odds. Keep this conservative — false matches poison CLV stats.
 */
export function parsePickOdds(pickText) {
  if (!pickText) return null;
  // Explicit American odds in parens, e.g. (+120) or (-150)
  const paren = pickText.match(/\(([+\-]?\d{2,4})\b/);
  if (paren) {
    const n = parseInt(paren[1], 10);
    if (Math.abs(n) >= 100 && Math.abs(n) <= 1500) return n;
  }
  const inline = pickText.match(/(?:ML|moneyline|spread|over|under|o|u|line)[\s:]*([+\-]?\d{2,4})\b/i);
  if (inline) {
    const n = parseInt(inline[1], 10);
    if (Math.abs(n) >= 100 && Math.abs(n) <= 1500) return n;
  }
  return null;
}
