import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

const ADMIN_EMAIL = 'kaisuupgrades@gmail.com';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcROI(wins, losses, avgOdds) {
  if (!wins && !losses) return 0;
  const total = wins + losses;
  // For negative odds: profit per win = 100/|odds|, risk = 1 unit
  // For positive odds: profit per win = odds/100, risk = 1 unit
  let avgProfit;
  if (avgOdds < 0) {
    avgProfit = (wins * (100 / Math.abs(avgOdds))) - losses;
  } else {
    avgProfit = (wins * (avgOdds / 100)) - losses;
  }
  return parseFloat(((avgProfit / total) * 100).toFixed(2));
}

function americanToImplied(ml) {
  if (!ml) return 0.5;
  return ml < 0 ? Math.abs(ml) / (Math.abs(ml) + 100) : 100 / (ml + 100);
}

function avgAmericanOdds(oddsArr) {
  if (!oddsArr.length) return null;
  const avgProb = oddsArr.reduce((s, o) => s + americanToImplied(o), 0) / oddsArr.length;
  return avgProb >= 0.5
    ? -Math.round((avgProb * 100) / (1 - avgProb))
    : Math.round(((1 - avgProb) * 100) / avgProb);
}

// ── Parse CSV rows into game objects ─────────────────────────────────────────
// Accepts flexible column naming (covers.com, Kaggle, The Odds History formats)
function parseCSVRows(rows, sport, season) {
  const games = [];
  for (const row of rows) {
    const r = {};
    // Normalize keys: lowercase, strip spaces/underscores
    for (const [k, v] of Object.entries(row)) {
      r[k.toLowerCase().replace(/[\s_]+/g, '')] = v?.toString().trim();
    }

    const homeScore = parseInt(r.homescore ?? r.homepts ?? r.h ?? r.hscore) || null;
    const awayScore = parseInt(r.awayscore ?? r.awaypts ?? r.a ?? r.ascore) || null;
    const homeML    = parseInt(r.homeml ?? r.mlhome ?? r.hml ?? r.homeodds) || null;
    const awayML    = parseInt(r.awayml ?? r.mlaway ?? r.aml ?? r.awayodds) || null;
    const spread    = parseFloat(r.spread ?? r.homespread ?? r.line ?? r.hspread) || null;
    const total     = parseFloat(r.total ?? r.ou ?? r.overunder ?? r.totals) || null;

    const rawDate = r.date ?? r.gamedate ?? r.gametime ?? '';
    const gameDate = rawDate ? new Date(rawDate).toISOString().split('T')[0] : null;
    if (!gameDate) continue;

    const home = r.home ?? r.hometeam ?? r.hteam ?? '';
    const away = r.away ?? r.awayteam ?? r.ateam ?? '';
    if (!home || !away) continue;

    // Derive results
    let homeCover = null, overHit = null, homeMLWin = null;
    if (homeScore != null && awayScore != null) {
      homeMLWin = homeScore > awayScore;
      if (spread != null) {
        const adjusted = homeScore + spread; // positive spread = home dog
        homeCover = adjusted > awayScore ? true : adjusted < awayScore ? false : null; // null = push
      }
      if (total != null) {
        const combined = homeScore + awayScore;
        overHit = combined > total ? true : combined < total ? false : null;
      }
    }

    games.push({
      sport:     sport.toUpperCase(),
      season:    parseInt(season) || new Date(gameDate).getFullYear(),
      game_date: gameDate,
      home_team: home,
      away_team: away,
      home_score: homeScore,
      away_score: awayScore,
      home_ml:   homeML,
      away_ml:   awayML,
      spread_line: spread,
      total_line:  total,
      home_cover:  homeCover,
      over_hit:    overHit,
      home_ml_win: homeMLWin,
      source: 'csv_import',
    });
  }
  return games;
}

// ── Apply filter conditions to a game row ─────────────────────────────────────
function matchesFilters(game, filters) {
  const { situation, minDogOdds, maxDogOdds, side, totalMin, totalMax, seasonStart, seasonEnd, sport } = filters;

  if (sport && sport !== 'ALL' && game.sport !== sport) return false;
  if (seasonStart && game.season < parseInt(seasonStart)) return false;
  if (seasonEnd   && game.season > parseInt(seasonEnd))   return false;

  const homeOdds = game.home_ml;
  const awayOdds = game.away_ml;

  // Side filter: which team we're betting
  const bettingHome = side === 'home' || (situation === 'home_dog' || situation === 'home_fav');
  const dogOdds     = bettingHome ? homeOdds : awayOdds;

  if (minDogOdds && dogOdds != null && dogOdds < parseInt(minDogOdds)) return false;
  if (maxDogOdds && dogOdds != null && dogOdds > parseInt(maxDogOdds)) return false;

  if (totalMin && game.total_line != null && game.total_line < parseFloat(totalMin)) return false;
  if (totalMax && game.total_line != null && game.total_line > parseFloat(totalMax)) return false;

  // Situation-specific
  switch (situation) {
    case 'home_dog':
      if (!homeOdds || homeOdds <= 100) return false; // home must be dog (positive ML)
      break;
    case 'away_dog':
      if (!awayOdds || awayOdds <= 100) return false;
      break;
    case 'home_fav':
      if (!homeOdds || homeOdds >= -100) return false;
      break;
    case 'away_fav':
      if (!awayOdds || awayOdds >= -100) return false;
      break;
    case 'pick_em':
      if (!homeOdds || !awayOdds) return false;
      if (Math.abs(homeOdds) > 115 || Math.abs(awayOdds) > 115) return false;
      break;
    case 'home_big_dog':
      if (!homeOdds || homeOdds < 150) return false;
      break;
    case 'away_big_dog':
      if (!awayOdds || awayOdds < 150) return false;
      break;
    case 'all':
    default:
      break;
  }

  return true;
}

// ── Compute result for a specific bet type ────────────────────────────────────
function getBetResult(game, betType, side) {
  const bettingHome = side === 'home' || betType?.toLowerCase().includes('home');

  switch (betType) {
    case 'ML':
      return bettingHome ? game.home_ml_win : (game.home_ml_win === null ? null : !game.home_ml_win);
    case 'Spread':
      return bettingHome ? game.home_cover : (game.home_cover === null ? null : !game.home_cover);
    case 'Over':
      return game.over_hit;
    case 'Under':
      return game.over_hit === null ? null : !game.over_hit;
    default:
      return null;
  }
}

function getRelevantOdds(game, betType, side) {
  const bettingHome = side === 'home';
  switch (betType) {
    case 'ML': return bettingHome ? game.home_ml : game.away_ml;
    case 'Spread': return -110; // standard juice
    case 'Over':
    case 'Under': return -110;
    default: return null;
  }
}

// ── GET — fetch edges + game count ────────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'edges';

  if (action === 'edges') {
    const { data: edges } = await supabase
      .from('sharp_edges')
      .select('*')
      .order('roi', { ascending: false });
    return NextResponse.json({ edges: edges || [] });
  }

  if (action === 'game-count') {
    const sport = searchParams.get('sport') || 'ALL';
    let q = supabase.from('historical_games').select('id', { count: 'exact', head: true });
    if (sport !== 'ALL') q = q.eq('sport', sport);
    const { count } = await q;
    return NextResponse.json({ count: count || 0 });
  }

  if (action === 'active-edges') {
    const { data: edges } = await supabase
      .from('sharp_edges')
      .select('name,description,sport,bet_type,wins,losses,win_pct,roi,avg_odds,season_range')
      .eq('is_active', true)
      .order('roi', { ascending: false });
    return NextResponse.json({ edges: edges || [] });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// ── POST — import CSV / run backtest / save edge / toggle edge ────────────────
export async function POST(req) {
  const body = await req.json();
  const { action, userEmail } = body;

  if (userEmail?.toLowerCase() !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  // ── Import CSV data ──────────────────────────────────────────────────────
  if (action === 'import-csv') {
    const { rows, sport, season } = body;
    if (!Array.isArray(rows) || !rows.length) {
      return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
    }

    const games = parseCSVRows(rows, sport || 'MLB', season || new Date().getFullYear());
    if (!games.length) {
      return NextResponse.json({ error: 'Could not parse any valid game rows. Check column names.' }, { status: 400 });
    }

    // Insert in chunks of 500
    let inserted = 0;
    for (let i = 0; i < games.length; i += 500) {
      const chunk = games.slice(i, i + 500);
      const { error } = await supabase.from('historical_games').insert(chunk);
      if (!error) inserted += chunk.length;
    }

    return NextResponse.json({ success: true, inserted, total_parsed: games.length });
  }

  // ── Run backtest ─────────────────────────────────────────────────────────
  if (action === 'run-backtest') {
    const { filters, betType, side } = body;

    let query = supabase.from('historical_games').select('*');
    if (filters.sport && filters.sport !== 'ALL') query = query.eq('sport', filters.sport);
    if (filters.seasonStart) query = query.gte('season', parseInt(filters.seasonStart));
    if (filters.seasonEnd)   query = query.lte('season', parseInt(filters.seasonEnd));

    const { data: games, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!games?.length) return NextResponse.json({ error: 'No historical data found for selected sport/season range. Import data first.' }, { status: 404 });

    const matched = games.filter(g => matchesFilters(g, filters));
    if (!matched.length) return NextResponse.json({ results: { wins: 0, losses: 0, pushes: 0, total: 0, win_pct: 0, roi: 0, avg_odds: null, sample_games: [] } });

    let wins = 0, losses = 0, pushes = 0;
    const oddsUsed = [];
    const sampleGames = [];

    for (const game of matched) {
      const result = getBetResult(game, betType, side);
      const odds   = getRelevantOdds(game, betType, side);
      if (odds) oddsUsed.push(odds);

      if (result === true)  wins++;
      else if (result === false) losses++;
      else pushes++;

      if (sampleGames.length < 10) {
        sampleGames.push({
          date:      game.game_date,
          matchup:   `${game.away_team} @ ${game.home_team}`,
          score:     game.home_score != null ? `${game.away_score}-${game.home_score}` : 'N/A',
          home_ml:   game.home_ml,
          away_ml:   game.away_ml,
          spread:    game.spread_line,
          total:     game.total_line,
          result:    result === true ? 'WIN' : result === false ? 'LOSS' : 'PUSH',
        });
      }
    }

    const total    = wins + losses + pushes;
    const avgOdds  = avgAmericanOdds(oddsUsed);
    const winPct   = total > 0 ? parseFloat(((wins / (wins + losses)) * 100).toFixed(1)) : 0;
    const roi      = calcROI(wins, losses, avgOdds || -110);

    return NextResponse.json({
      results: { wins, losses, pushes, total, win_pct: winPct, roi, avg_odds: avgOdds, sample_games: sampleGames },
    });
  }

  // ── Save sharp edge ──────────────────────────────────────────────────────
  if (action === 'save-edge') {
    const { name, description, results, filters, betType, side } = body;
    if (!name?.trim()) return NextResponse.json({ error: 'Edge name required' }, { status: 400 });

    const seasonRange = filters.seasonStart && filters.seasonEnd
      ? `${filters.seasonStart}–${filters.seasonEnd}`
      : filters.seasonStart || filters.seasonEnd || 'All seasons';

    const { data, error } = await supabase.from('sharp_edges').insert([{
      name:        name.trim(),
      description: description?.trim() || null,
      sport:       filters.sport || 'ALL',
      bet_type:    betType,
      filter_json: { ...filters, side },
      wins:        results.wins,
      losses:      results.losses,
      pushes:      results.pushes,
      total_games: results.total,
      win_pct:     results.win_pct,
      roi:         results.roi,
      avg_odds:    results.avg_odds,
      season_range: seasonRange,
      is_active:   true,
    }]).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, edge: data });
  }

  // ── Toggle edge active/inactive ──────────────────────────────────────────
  if (action === 'toggle-edge') {
    const { edgeId, isActive } = body;
    const { error } = await supabase
      .from('sharp_edges')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', edgeId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // ── Delete edge ──────────────────────────────────────────────────────────
  if (action === 'delete-edge') {
    const { edgeId } = body;
    const { error } = await supabase.from('sharp_edges').delete().eq('id', edgeId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
