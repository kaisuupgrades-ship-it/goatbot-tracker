/**
 * /api/bot-performance — Public read of the BetOS AI's pick history & stats.
 *
 * Returns a single object with everything the Bot Performance tab needs:
 *   - top-line counts (total / W / L / P / ungraded / passes)
 *   - by-sport breakdown
 *   - by-confidence breakdown (calibration check)
 *   - rough ROI for picks where odds are parseable from the pick text
 *   - weekly trend
 *   - recent picks list (last 30)
 *
 * GET ?range=all|30d|7d   (defaults to all)
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { teamsMatch } from '@/lib/teamNormalizer';
import { extractClosingOdds } from '@/lib/clv';

export const maxDuration = 15;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// "Pass" picks are the AI declining to bet — they don't count W/L
// They show as PUSH in the DB (or as "Pass — ..." text).
function isPassPick(pick, result) {
  if (!pick) return result === 'PUSH';
  const trimmed = pick.trim();
  return /^pass\b/i.test(trimmed) || /insufficient/i.test(trimmed);
}

// Pull American odds out of pick text. Handles:
//   "(-150)" / "(+120)"             — parens
//   "ML -150 FanDuel"               — keyword + number
//   "Celtics -5.5 -115 DraftKings"  — last odds-shaped number (the trailing
//                                     "-115" is the price; "-5.5" is the
//                                     spread point and is filtered out by
//                                     the |n| ≥ 100 check)
//   "Royals ML +109 BetOnline"      — last odds-shaped number works here too
// Heuristic: find every signed integer in the string, keep ones with
// |n| ∈ [100, 1500] (American-odds range), return the LAST one — the price
// reliably comes after the line in conventional pick syntax.
function parseOdds(pickText) {
  if (!pickText) return null;
  // Parens win — they're an unambiguous odds delimiter
  const paren = pickText.match(/\(([+\-]?\d{2,4})\b/);
  if (paren) {
    const n = parseInt(paren[1], 10);
    if (Math.abs(n) >= 100 && Math.abs(n) <= 1500) return n;
  }
  // Sweep for ALL signed integers, keep American-odds-shaped ones, take last.
  const candidates = [...pickText.matchAll(/[+\-]\d{2,4}\b/g)]
    .map(m => parseInt(m[0], 10))
    .filter(n => Number.isFinite(n) && Math.abs(n) >= 100 && Math.abs(n) <= 1500);
  if (candidates.length > 0) return candidates[candidates.length - 1];
  return null;
}

function profitFor(odds, result) {
  if (result === 'PUSH') return 0;
  if (result === 'WIN') {
    if (odds > 0) return odds / 100;
    if (odds < 0) return 100 / Math.abs(odds);
    return 0;
  }
  return -1; // LOSS
}

// Detect which side the AI picked by stripping bet-type words ("ML", spread
// number, book name) and matching the remainder against home/away team names
// using the sport-aware teamsMatch helper.
function detectPickedSide(pickText, homeTeam, awayTeam, sport) {
  if (!pickText || !homeTeam || !awayTeam) return null;
  const sportUpper = (sport || '').toUpperCase();
  // Strip everything that isn't the team name: "ML", "moneyline",
  // "(G2)" doubleheader markers, leading/trailing whitespace.
  const cleaned = pickText
    .replace(/\bmoneyline\b/i, '')
    .replace(/\bml\b/i, '')
    .replace(/\(g\d+\)/i, '')
    .trim();
  if (teamsMatch(cleaned, homeTeam, sportUpper)) return 'home';
  if (teamsMatch(cleaned, awayTeam, sportUpper)) return 'away';
  // Try the first 4 words (handles "Tampa Bay Rays ML extra noise")
  const firstChunk = cleaned.split(/\s+/).slice(0, 4).join(' ');
  if (teamsMatch(firstChunk, homeTeam, sportUpper)) return 'home';
  if (teamsMatch(firstChunk, awayTeam, sportUpper)) return 'away';
  return null;
}

// Load odds_cache rows for the (sport, date) combos in our analyses set, so
// when the AI's pick text didn't include odds (e.g. "Tampa Bay Rays ML") we
// can still compute ROI from the Pinnacle closing line. One batched query
// per sport keeps this O(1) DB hits regardless of how many picks we have.
async function loadOddsForAnalyses(supabase, analyses) {
  const bySport = new Map(); // sport → Set<game_date>
  for (const r of analyses) {
    if (!r.sport || !r.game_date) continue;
    if (!bySport.has(r.sport)) bySport.set(r.sport, new Set());
    bySport.get(r.sport).add(r.game_date);
  }
  if (bySport.size === 0) return [];

  const tasks = [];
  for (const [sport, dates] of bySport) {
    const dateList = [...dates].sort();
    const minDate = dateList[0];
    const maxDate = dateList[dateList.length - 1];
    // commence_time is a timestamptz — convert dates to a wide ISO range that
    // covers the full UTC days
    const minIso = `${minDate}T00:00:00Z`;
    const maxIso = `${maxDate}T23:59:59Z`;
    tasks.push(
      supabase.from('odds_cache')
        .select('sport, home_team, away_team, commence_time, odds_data')
        .eq('sport', sport)
        .gte('commence_time', minIso)
        .lte('commence_time', maxIso)
        .then(r => r.data || [])
    );
  }
  const chunks = await Promise.all(tasks);
  return chunks.flat();
}

// Match a single game_analyses row to an odds_cache row.
function findOddsRow(oddsRows, analysis) {
  if (!analysis.sport || !analysis.game_date) return null;
  const sportUpper = analysis.sport.toUpperCase();
  return oddsRows.find(o =>
    o.sport === analysis.sport &&
    typeof o.commence_time === 'string' &&
    o.commence_time.slice(0, 10) === analysis.game_date &&
    teamsMatch(o.home_team, analysis.home_team, sportUpper) &&
    teamsMatch(o.away_team, analysis.away_team, sportUpper)
  ) || null;
}

function isoWeek(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T12:00:00Z');
  // ISO week year & week number
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((target - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const range = searchParams.get('range') || 'all';

  // Compute lower-bound game_date for the requested range
  const now = new Date();
  let minDate = null;
  if (range === '30d') {
    const d = new Date(now.getTime() - 30 * 86400000);
    minDate = d.toISOString().slice(0, 10);
  } else if (range === '7d') {
    const d = new Date(now.getTime() - 7 * 86400000);
    minDate = d.toISOString().slice(0, 10);
  }

  let query = supabase
    .from('game_analyses')
    .select('id, sport, game_date, away_team, home_team, prediction_pick, prediction_conf, prediction_result, final_score, prediction_edge, generated_at, prediction_graded_at')
    .order('game_date', { ascending: false })
    .limit(1500);

  if (minDate) query = query.gte('game_date', minDate);

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ error: 'Failed to load analyses', detail: error.message }, { status: 500 });
  }

  const all = rows || [];

  // Load odds_cache once for the date range covering all analyses so we can
  // fall back to Pinnacle closing-line odds when the AI's pick text didn't
  // include odds (e.g. "Tampa Bay Rays ML" with no number). This makes ROI
  // share the SAME denominator as Record — no more "9-11 record but ROI on
  // only 6 picks" disparity. Failures are non-fatal: if odds_cache is empty
  // for some games (older picks before the cron started), we just skip them.
  const gradedAnalyses = all.filter(r =>
    r.prediction_result === 'WIN' || r.prediction_result === 'LOSS'
  );
  const oddsRows = await loadOddsForAnalyses(supabase, gradedAnalyses).catch(() => []);

  // ── Top-line counts ────────────────────────────────────────────────────────
  // We deliberately ONLY surface graded W/L picks — passes (AI declined to bet),
  // unparseable PUSHes, and ungraded analyses are all dropped from the stats so
  // the displayed record is the AI's actual betting decisions.
  const totals = { wins: 0, losses: 0 };
  // by sport
  const bySportMap = new Map();
  // by confidence
  const byConfMap = new Map();
  // weekly bucket
  const weeklyMap = new Map();
  // ROI
  let roiPicks = 0, roiNetUnits = 0;

  // recent picks (latest 30 graded)
  const recent = [];
  // pending picks (today + future, not yet graded)
  const pending = [];
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const r of all) {
    const result = r.prediction_result || null;
    const pass = isPassPick(r.prediction_pick, result);

    // Only WIN/LOSS picks count toward record — pushes (mostly unparseable),
    // passes (AI declined to bet), and ungraded analyses are dropped.
    if (!pass && result === 'WIN')  totals.wins++;
    if (!pass && result === 'LOSS') totals.losses++;

    if (!pass && (result === 'WIN' || result === 'LOSS')) {
      const sport = r.sport || 'unknown';
      if (!bySportMap.has(sport)) bySportMap.set(sport, { wins: 0, losses: 0 });
      const s = bySportMap.get(sport);
      if (result === 'WIN') s.wins++; else s.losses++;

      const conf = r.prediction_conf || 'UNCAL';
      if (!byConfMap.has(conf)) byConfMap.set(conf, { wins: 0, losses: 0 });
      const c = byConfMap.get(conf);
      if (result === 'WIN') c.wins++; else c.losses++;

      const wk = isoWeek(r.game_date);
      if (wk) {
        if (!weeklyMap.has(wk)) weeklyMap.set(wk, { wins: 0, losses: 0 });
        const w = weeklyMap.get(wk);
        if (result === 'WIN') w.wins++; else w.losses++;
      }

      // ROI — prefer odds parsed from the pick text (that's the line the
      // user/AI actually saw at pick time), fall back to Pinnacle closing
      // line from odds_cache when text didn't include odds. Both numbers
      // are American, both produce honest ROI; the fallback just lets us
      // include picks like "Tampa Bay Rays ML" that have no odds in text.
      let odds = parseOdds(r.prediction_pick);
      if (odds == null || !Number.isFinite(odds) || Math.abs(odds) > 1500) {
        const oddsRow = findOddsRow(oddsRows, r);
        if (oddsRow) {
          const closing = extractClosingOdds(oddsRow.odds_data, oddsRow.home_team, oddsRow.away_team);
          if (closing?.ml) {
            const side = detectPickedSide(r.prediction_pick, r.home_team, r.away_team, r.sport);
            if (side === 'home') odds = closing.ml.home;
            else if (side === 'away') odds = closing.ml.away;
          }
        }
      }
      if (odds != null && Number.isFinite(odds) && Math.abs(odds) <= 1500) {
        roiPicks++;
        roiNetUnits += profitFor(odds, result);
      }
    }

    // Recent picks (only the picks that count — exclude passes/pushes/ungraded)
    if (!pass && (result === 'WIN' || result === 'LOSS') && recent.length < 30) {
      recent.push({
        sport:        r.sport,
        game_date:    r.game_date,
        matchup:      `${r.away_team} @ ${r.home_team}`,
        pick:         r.prediction_pick,
        conf:         r.prediction_conf,
        edge:         r.prediction_edge,
        result,
        final_score:  r.final_score,
      });
    }

    // Pending picks: today + future, has a real pick, not yet graded, not a pass.
    // These are the AI's open positions — what we're "currently betting on".
    if (
      !pass &&
      !result &&
      r.game_date &&
      r.game_date >= todayStr &&
      r.prediction_pick
    ) {
      pending.push({
        sport:     r.sport,
        game_date: r.game_date,
        matchup:   `${r.away_team} @ ${r.home_team}`,
        pick:      r.prediction_pick,
        conf:      r.prediction_conf,
        edge:      r.prediction_edge,
      });
    }
  }

  // Soonest games first
  pending.sort((a, b) => (a.game_date || '').localeCompare(b.game_date || ''));

  // Convert maps to sorted arrays
  const SPORT_ORDER = ['mlb', 'nba', 'nhl', 'nfl', 'ncaaf', 'ncaab', 'wnba', 'mls', 'soccer', 'tennis', 'ufc', 'mma', 'golf'];
  const bySport = [...bySportMap.entries()]
    .map(([sport, s]) => ({
      sport,
      wins: s.wins,
      losses: s.losses,
      total: s.wins + s.losses,
      win_pct: s.wins + s.losses === 0 ? null : (100 * s.wins) / (s.wins + s.losses),
    }))
    .sort((a, b) => {
      const ai = SPORT_ORDER.indexOf(a.sport);
      const bi = SPORT_ORDER.indexOf(b.sport);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

  const CONF_ORDER = ['ELITE', 'HIGH', 'MEDIUM', 'LOW', 'UNCAL'];
  const byConf = CONF_ORDER
    .map(conf => {
      const c = byConfMap.get(conf);
      if (!c) return null;
      return {
        conf,
        wins: c.wins,
        losses: c.losses,
        total: c.wins + c.losses,
        win_pct: c.wins + c.losses === 0 ? null : (100 * c.wins) / (c.wins + c.losses),
      };
    })
    .filter(Boolean);

  const weekly = [...weeklyMap.entries()]
    .map(([week, w]) => ({ week, wins: w.wins, losses: w.losses, win_pct: 100 * w.wins / (w.wins + w.losses) }))
    .sort((a, b) => a.week.localeCompare(b.week));

  // Top-line summary
  const wlTotal = totals.wins + totals.losses;
  const winPct = wlTotal === 0 ? null : (100 * totals.wins) / wlTotal;
  const roiPct = roiPicks === 0 ? null : (100 * roiNetUnits) / roiPicks;

  return NextResponse.json({
    range,
    generated_at: new Date().toISOString(),
    summary: {
      total: wlTotal, // W + L; matches the record exactly
      wins: totals.wins,
      losses: totals.losses,
      win_pct: winPct,
      roi: {
        picks: roiPicks,
        net_units: roiNetUnits,
        roi_pct: roiPct,
      },
    },
    by_sport: bySport,
    by_conf: byConf,
    weekly,
    pending,
    recent,
  });
}
