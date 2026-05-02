/**
 * Quant pick engine — Elo vs market edge detection.
 *
 * MLB-first implementation. For a given game, computes:
 *   1. Elo-derived win probability for each team
 *   2. De-vigged market probability from odds_cache
 *   3. Edge = Elo prob − de-vigged market prob
 *   4. Pick recommendation only when edge ≥ MIN_EDGE_PCT
 *
 * Two entry points:
 *   computeMLBQuantPick({ ratings, homeTeam, awayTeam, oddsData })
 *     → per-game, pure function (no I/O). Caller provides pre-fetched data.
 *
 *   quantEnrichEvents({ supabase, events, sport })
 *     → batch enrichment for /api/sports. Fetches ratings + odds once for the
 *       whole card-deck, attaches .quant to each event.
 *
 * Truth metric: CLV+ over 500+ picks. Edge % here is the pre-game signal;
 * closing-line CLV is the post-game verdict. Both live in clv.js.
 */
import { getCurrentMLBRatings, predictMLBProb, mlbAbbrFromName } from './eloRatings.js';
import { devig } from './clv.js';

// Minimum edge (in percentage points) to emit a pick recommendation.
// Below this threshold the Elo signal is within normal model noise.
export const MIN_EDGE_PCT = 3.0;

// Books used for fallback (Pinnacle preferred; these for median fallback).
const FALLBACK_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'williamhill_us'];

/**
 * Extract ML odds from an odds_cache.odds_data blob.
 * Prefers Pinnacle (sharpest, lowest vig). Falls back to first known US book.
 *
 * @param {Object} oddsData - odds_cache.odds_data jsonb
 * @param {string} homeTeam - full team name (for bookmaker outcome matching)
 * @param {string} awayTeam
 * @returns {{ homeOdds: number, awayOdds: number, source: string } | null}
 */
function extractMLOdds(oddsData, homeTeam, awayTeam) {
  if (!oddsData) return null;

  // Preferred: Pinnacle
  const pin = oddsData.pinnacle;
  if (pin?.ml && Number.isFinite(pin.ml.home) && Number.isFinite(pin.ml.away)) {
    return { homeOdds: pin.ml.home, awayOdds: pin.ml.away, source: 'pinnacle' };
  }

  // Fallback: first available US book
  const books = Array.isArray(oddsData.bookmakers) ? oddsData.bookmakers : [];
  const htLower = (homeTeam || '').toLowerCase();
  const atLower = (awayTeam || '').toLowerCase();

  for (const book of books) {
    if (!FALLBACK_BOOKS.includes(book.key)) continue;
    const h2h = book.markets?.find(m => m.key === 'h2h');
    if (!h2h?.outcomes?.length) continue;

    // Match outcome names to team names (loose substring match)
    const hOut = h2h.outcomes.find(o => {
      const n = (o.name || '').toLowerCase();
      return htLower.includes(n) || n.includes(htLower.split(' ').pop());
    });
    const aOut = h2h.outcomes.find(o => {
      const n = (o.name || '').toLowerCase();
      return atLower.includes(n) || n.includes(atLower.split(' ').pop());
    });
    if (Number.isFinite(hOut?.price) && Number.isFinite(aOut?.price)) {
      return { homeOdds: hOut.price, awayOdds: aOut.price, source: book.key };
    }
  }

  return null;
}

/**
 * Compute a quant pick for a single MLB game.
 * Pure function — all I/O must be done by the caller before invoking this.
 *
 * @param {Object} args
 * @param {Object} args.ratings     - { ABBR: rating } from getCurrentMLBRatings
 * @param {string} args.homeTeam    - full team name, e.g. "New York Yankees"
 * @param {string} args.awayTeam    - full team name, e.g. "Baltimore Orioles"
 * @param {Object|null} args.oddsData - odds_cache.odds_data for this game, or null
 * @returns {Object} quant verdict (always has `available` boolean at top level)
 */
export function computeMLBQuantPick({ ratings, homeTeam, awayTeam, oddsData }) {
  const homeAbbr = mlbAbbrFromName(homeTeam);
  const awayAbbr = mlbAbbrFromName(awayTeam);

  if (!homeAbbr || !awayAbbr) {
    return {
      available: false,
      reason: 'team_not_mapped',
      homeTeam,
      awayTeam,
    };
  }

  const prediction = predictMLBProb(ratings, homeAbbr, awayAbbr);
  if (!prediction) {
    return {
      available: false,
      reason: 'elo_prediction_null',
      homeAbbr,
      awayAbbr,
    };
  }

  const eloHomeProb = prediction.homeProb;
  const eloAwayProb = prediction.awayProb;

  // ── Market odds ─────────────────────────────────────────────────────────────
  const mktOdds = extractMLOdds(oddsData, homeTeam, awayTeam);
  let marketHomeProb = null, marketAwayProb = null;
  let homeEdgePct = null, awayEdgePct = null;
  let hasPick = false, pick = null, pickOdds = null, edgePct = null, edgeSide = null;

  if (mktOdds) {
    marketHomeProb = devig(mktOdds.homeOdds, mktOdds.awayOdds);
    marketAwayProb = devig(mktOdds.awayOdds, mktOdds.homeOdds);

    if (marketHomeProb != null && marketAwayProb != null) {
      homeEdgePct = +((eloHomeProb - marketHomeProb) * 100).toFixed(1);
      awayEdgePct = +((eloAwayProb - marketAwayProb) * 100).toFixed(1);

      // Only emit a pick on sides where Elo says we're getting positive value
      if (homeEdgePct >= MIN_EDGE_PCT) {
        hasPick = true;
        edgeSide = 'home';
        pick = `${homeAbbr} ML`;
        pickOdds = mktOdds.homeOdds;
        edgePct = homeEdgePct;
      } else if (awayEdgePct >= MIN_EDGE_PCT) {
        hasPick = true;
        edgeSide = 'away';
        pick = `${awayAbbr} ML`;
        pickOdds = mktOdds.awayOdds;
        edgePct = awayEdgePct;
      }
    }
  }

  return {
    available: true,
    // Elo
    homeAbbr,
    awayAbbr,
    homeRating: Math.round(prediction.homeRating),
    awayRating: Math.round(prediction.awayRating),
    eloHomeProb: +eloHomeProb.toFixed(4),
    eloAwayProb: +eloAwayProb.toFixed(4),
    // Market
    marketHomeProb: marketHomeProb != null ? +marketHomeProb.toFixed(4) : null,
    marketAwayProb: marketAwayProb != null ? +marketAwayProb.toFixed(4) : null,
    marketHomeOdds: mktOdds?.homeOdds ?? null,
    marketAwayOdds: mktOdds?.awayOdds ?? null,
    oddsSource: mktOdds?.source ?? 'none',
    // Edge (percentage points)
    homeEdgePct,
    awayEdgePct,
    // Pick recommendation (only set when edge ≥ MIN_EDGE_PCT)
    hasPick,
    edgeSide,  // 'home' | 'away' | null
    pick,      // e.g. "NYY ML"
    pickOdds,
    edgePct,   // the edge of the recommended side
    minEdgePct: MIN_EDGE_PCT,
    source: 'elo_v1',
  };
}

/**
 * Batch-enrich a list of ESPN scoreboard events with quant picks.
 * Fetches Elo ratings and today's odds_cache rows once for the whole batch,
 * then runs computeMLBQuantPick for each event.
 *
 * Returns the same events array with `.quant` attached to each element.
 * On any error the original events are returned unchanged (safe fallback).
 *
 * @param {Object} args
 * @param {Object} args.supabase - Supabase service-role client
 * @param {Array}  args.events   - ESPN scoreboard events
 * @param {string} args.sport    - 'mlb' (only MLB supported right now)
 */
export async function quantEnrichEvents({ supabase, events, sport }) {
  if (sport !== 'mlb' || !events?.length || !supabase) return events;

  try {
    // 1. Elo ratings — cached in-process for 5 min (see eloRatings.js)
    const { ratings } = await getCurrentMLBRatings({ supabase });

    // 2. Batch-fetch today's MLB odds_cache rows (single DB round-trip)
    const today = new Date().toISOString().slice(0, 10);
    const { data: oddsRows, error: oddsErr } = await supabase
      .from('odds_cache')
      .select('home_team, away_team, odds_data')
      .like('sport_key', 'baseball_mlb%')
      .gte('commence_time', `${today}T00:00:00`)
      .lte('commence_time', `${today}T23:59:59`);

    if (oddsErr) {
      console.warn('[quantEnrichEvents] odds_cache fetch error:', oddsErr.message);
    }
    const oddsIndex = (oddsRows || []);

    // 3. For each event attach a quant pick
    return events.map(ev => {
      const comp    = ev.competitions?.[0];
      const homeC   = comp?.competitors?.find(c => c.homeAway === 'home');
      const awayC   = comp?.competitors?.find(c => c.homeAway === 'away');
      const homeName = homeC?.team?.displayName || homeC?.team?.name;
      const awayName = awayC?.team?.displayName || awayC?.team?.name;

      if (!homeName || !awayName) return ev;

      // Fuzzy match odds row by last word of team name (e.g. "yankees" in "New York Yankees")
      const htLast = homeName.split(' ').pop().toLowerCase();
      const atLast = awayName.split(' ').pop().toLowerCase();
      const oddsRow = oddsIndex.find(r =>
        (r.home_team || '').toLowerCase().includes(htLast) &&
        (r.away_team || '').toLowerCase().includes(atLast),
      );

      const quant = computeMLBQuantPick({
        ratings,
        homeTeam: homeName,
        awayTeam: awayName,
        oddsData: oddsRow?.odds_data ?? null,
      });

      return { ...ev, quant };
    });
  } catch (err) {
    console.warn('[quantEnrichEvents] error:', err.message);
    return events; // safe fallback — scoreboard still loads without quant data
  }
}
