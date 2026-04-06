/**
 * POST /api/admin/auto-grade-analyses
 *
 * Automatically grades AI analysis predictions by checking ESPN final scores.
 *
 * Flow:
 *   1. Fetch all game_analyses rows where prediction_result IS NULL and game_date <= today
 *   2. Parse each row's analysis text for: THE PICK line (team, bet type, line)
 *   3. Look up ESPN final score for that game
 *   4. Determine WIN / LOSS / PUSH based on pick type
 *   5. Update the row with prediction_pick, prediction_conf, prediction_result, prediction_graded_at
 *
 * Auth: JWT — admin only.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isAdmin(email) { return ADMIN_EMAILS.includes((email || '').toLowerCase()); }

async function getAdminUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    if (!isAdmin(user.email)) return null;
    return user;
  } catch { return null; }
}

// ── ESPN lookup ─────────────────────────────────────────────────────────────────
const ESPN_ENDPOINTS = {
  nba: 'basketball/nba', ncaab: 'basketball/mens-college-basketball',
  wnba: 'basketball/wnba', nfl: 'football/nfl', ncaaf: 'football/college-football',
  mlb: 'baseball/mlb', nhl: 'hockey/nhl', mls: 'soccer/usa.1',
};

const scoresCache = {};

async function getScoreboard(sport, dateStr) {
  const sportPath = ESPN_ENDPOINTS[sport.toLowerCase()];
  if (!sportPath) return [];

  const key = `${sport}||${dateStr}`;
  if (scoresCache[key]) return scoresCache[key];

  const espnDate = dateStr?.replace(/-/g, '');
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sportPath}/scoreboard?limit=100${espnDate ? `&dates=${espnDate}` : ''}`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { scoresCache[key] = []; return []; }
    const json = await res.json();
    scoresCache[key] = json.events || [];
  } catch {
    scoresCache[key] = [];
  }
  return scoresCache[key];
}

/**
 * Find a finished game on ESPN matching the away/home teams.
 * Returns { homeScore, awayScore, totalScore, status } or null.
 */
function findGame(events, awayTeam, homeTeam) {
  const normalize = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const away = normalize(awayTeam);
  const home = normalize(homeTeam);

  for (const evt of events) {
    const comp = evt.competitions?.[0];
    if (!comp) continue;

    const status = comp.status?.type?.name; // 'STATUS_FINAL', 'STATUS_IN_PROGRESS', etc.
    if (status !== 'STATUS_FINAL') continue;

    const competitors = comp.competitors || [];
    const homeC = competitors.find(c => c.homeAway === 'home');
    const awayC = competitors.find(c => c.homeAway === 'away');
    if (!homeC || !awayC) continue;

    const homeNames = [homeC.team?.displayName, homeC.team?.shortDisplayName, homeC.team?.name, homeC.team?.abbreviation].filter(Boolean).map(normalize);
    const awayNames = [awayC.team?.displayName, awayC.team?.shortDisplayName, awayC.team?.name, awayC.team?.abbreviation].filter(Boolean).map(normalize);

    const homeMatch = homeNames.some(n => n.includes(home) || home.includes(n));
    const awayMatch = awayNames.some(n => n.includes(away) || away.includes(n));

    if (homeMatch && awayMatch) {
      const homeScore = parseInt(homeC.score);
      const awayScore = parseInt(awayC.score);
      return {
        homeScore, awayScore,
        totalScore: homeScore + awayScore,
        status: 'final',
        homeTeamName: homeC.team?.displayName,
        awayTeamName: awayC.team?.displayName,
      };
    }
  }
  return null;
}

// ── Pick parser ─────────────────────────────────────────────────────────────────
/**
 * Parse "THE PICK" line from analysis text.
 * Examples:
 *   "Cubs ML -136 FanDuel"       -> { team: 'Cubs', type: 'ml', line: -136 }
 *   "Pirates ML -131 ESPN"       -> { team: 'Pirates', type: 'ml', line: -131 }
 *   "Over 9 -110 at ESPN Bet"    -> { type: 'over', total: 9, line: -110 }
 *   "Under 8.5 -115"             -> { type: 'under', total: 8.5, line: -115 }
 *   "Nets +6.5 -110"             -> { team: 'Nets', type: 'spread', spread: 6.5, line: -110 }
 *   "Bucks -4.5 -110"            -> { team: 'Bucks', type: 'spread', spread: -4.5, line: -110 }
 */
function parsePick(analysis) {
  const pickMatch = analysis?.match(/THE PICK[:\s]+([^\n]{5,150})/i);
  if (!pickMatch) return null;
  const pickLine = pickMatch[1].trim();

  const confMatch = analysis?.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
  const conf = confMatch?.[1] || null;

  // Over/Under total
  const overMatch = pickLine.match(/^Over\s+([\d.]+)\s/i);
  if (overMatch) return { type: 'over', total: parseFloat(overMatch[1]), raw: pickLine, conf };

  const underMatch = pickLine.match(/^Under\s+([\d.]+)\s/i);
  if (underMatch) return { type: 'under', total: parseFloat(underMatch[1]), raw: pickLine, conf };

  // Team ML
  const mlMatch = pickLine.match(/^(.+?)\s+ML\s+([+-]?\d+)/i);
  if (mlMatch) return { team: mlMatch[1].trim(), type: 'ml', line: parseInt(mlMatch[2]), raw: pickLine, conf };

  // Team spread (e.g., "Nets +6.5 -110" or "Bucks -4.5 -110")
  const spreadMatch = pickLine.match(/^(.+?)\s+([+-][\d.]+)\s+[+-]?\d+/i);
  if (spreadMatch) {
    const spread = parseFloat(spreadMatch[2]);
    // Distinguish spread from ML: if spread is not a whole number or is > 20, it's a spread
    // Also if it has a decimal it's definitely a spread
    if (spread !== Math.floor(spread) || Math.abs(spread) > 20) {
      return { team: spreadMatch[1].trim(), type: 'spread', spread, raw: pickLine, conf };
    }
  }

  // Fallback: try to find a team name in the first few words (assume ML if we see a team)
  const fallbackMatch = pickLine.match(/^([A-Z][a-zA-Z\s]+?)(?:\s+ML|\s+[+-]?\d)/i);
  if (fallbackMatch) return { team: fallbackMatch[1].trim(), type: 'ml', raw: pickLine, conf };

  return { type: 'unknown', raw: pickLine, conf };
}

// ── Grading logic ───────────────────────────────────────────────────────────────
/**
 * Grade a parsed pick against final scores.
 * Returns 'WIN' | 'LOSS' | 'PUSH' | null (can't determine)
 */
function gradePick(pick, game, awayTeam, homeTeam) {
  if (!pick || !game) return null;

  const { homeScore, awayScore, totalScore } = game;

  // --- Over / Under ---
  if (pick.type === 'over') {
    if (totalScore > pick.total) return 'WIN';
    if (totalScore < pick.total) return 'LOSS';
    return 'PUSH';
  }
  if (pick.type === 'under') {
    if (totalScore < pick.total) return 'WIN';
    if (totalScore > pick.total) return 'LOSS';
    return 'PUSH';
  }

  // --- Moneyline ---
  if (pick.type === 'ml') {
    // Determine which side the pick is on
    const pickedSide = identifySide(pick.team, awayTeam, homeTeam);
    if (!pickedSide) return null;

    if (pickedSide === 'home') {
      if (homeScore > awayScore) return 'WIN';
      if (homeScore < awayScore) return 'LOSS';
      return 'PUSH';
    } else {
      if (awayScore > homeScore) return 'WIN';
      if (awayScore < homeScore) return 'LOSS';
      return 'PUSH';
    }
  }

  // --- Spread ---
  if (pick.type === 'spread') {
    const pickedSide = identifySide(pick.team, awayTeam, homeTeam);
    if (!pickedSide) return null;

    // Spread is from the picked team's perspective
    // e.g., "Nets +6.5" means Nets score + 6.5 vs opponent
    const pickedScore = pickedSide === 'home' ? homeScore : awayScore;
    const oppScore    = pickedSide === 'home' ? awayScore : homeScore;
    const adjusted = pickedScore + pick.spread;

    if (adjusted > oppScore) return 'WIN';
    if (adjusted < oppScore) return 'LOSS';
    return 'PUSH';
  }

  return null;
}

/**
 * Identify which side (home/away) the pick team matches.
 */
function identifySide(pickTeam, awayTeam, homeTeam) {
  const p = (pickTeam || '').toLowerCase().trim();
  const a = (awayTeam || '').toLowerCase().trim();
  const h = (homeTeam || '').toLowerCase().trim();

  // Check home first
  if (h.includes(p) || p.includes(h) || h.split(' ').pop() === p.split(' ').pop()) return 'home';
  if (a.includes(p) || p.includes(a) || a.split(' ').pop() === p.split(' ').pop()) return 'away';

  // Try last word match (e.g., "Cubs" matches "Chicago Cubs")
  const pLast = p.split(' ').pop();
  if (h.split(' ').some(w => w === pLast)) return 'home';
  if (a.split(' ').some(w => w === pLast)) return 'away';

  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main handler ────────────────────────────────────────────────────────────────
export async function POST(req) {
  const admin = await getAdminUser(req);
  if (!admin) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const today = new Date().toISOString().split('T')[0];

  // Fetch all ungraded analyses where game_date is today or earlier
  const { data: analyses, error: fetchErr } = await supabaseAdmin
    .from('game_analyses')
    .select('id, sport, away_team, home_team, game_date, analysis, prediction_pick, prediction_conf, prediction_result')
    .is('prediction_result', null)
    .lte('game_date', today)
    .order('game_date', { ascending: false })
    .limit(500);

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  if (!analyses?.length) {
    return NextResponse.json({ message: 'No ungraded analyses found', graded: 0, skipped: 0, noScore: 0, wins: 0, losses: 0, pushes: 0 });
  }

  const results = { graded: 0, skipped: 0, noScore: 0, wins: 0, losses: 0, pushes: 0, errors: 0, details: [] };

  for (const row of analyses) {
    // 1. Parse the pick
    const pick = parsePick(row.analysis);
    if (!pick || pick.type === 'unknown') {
      results.skipped++;
      results.details.push({ id: row.id.slice(0, 8), reason: 'could not parse pick' });
      continue;
    }

    // 2. Look up ESPN final score (cached per sport+date)
    const events = await getScoreboard(row.sport, row.game_date);
    if (!events.length) {
      // Need to rate-limit ESPN calls
      await sleep(100);
    }

    const game = findGame(events, row.away_team, row.home_team);
    if (!game) {
      results.noScore++;
      results.details.push({ id: row.id.slice(0, 8), game: `${row.away_team} @ ${row.home_team}`, reason: 'no final score found' });
      continue;
    }

    // 3. Grade it
    const result = gradePick(pick, game, row.away_team, row.home_team);
    if (!result) {
      results.skipped++;
      results.details.push({ id: row.id.slice(0, 8), pick: pick.raw, reason: 'could not determine result' });
      continue;
    }

    // 4. Update the row
    const { error: updateErr } = await supabaseAdmin
      .from('game_analyses')
      .update({
        prediction_result:    result,
        prediction_pick:      pick.raw,
        prediction_conf:      pick.conf,
        prediction_graded_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .is('prediction_result', null); // idempotency guard

    if (updateErr) {
      results.errors++;
    } else {
      results.graded++;
      if (result === 'WIN') results.wins++;
      if (result === 'LOSS') results.losses++;
      if (result === 'PUSH') results.pushes++;
      results.details.push({
        id: row.id.slice(0, 8),
        game: `${row.away_team} @ ${row.home_team}`,
        pick: pick.raw,
        score: `${game.awayScore}-${game.homeScore}`,
        result,
      });
    }
  }

  return NextResponse.json({
    message: 'Auto-grade complete',
    ...results,
    total: analyses.length,
    espnCalls: Object.keys(scoresCache).length,
  });
}
