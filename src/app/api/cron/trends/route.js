/**
 * /api/cron/trends
 *
 * Automated daily trends pipeline — called by Vercel Cron at 9:00 AM and
 * 5:00 PM UTC (5 AM and 1 PM ET).
 *
 * Uses Grok 4 with live web search for maximum quality.
 * Falls back to Claude if Grok 4 is unavailable.
 *
 * Can also be triggered manually from Admin Panel → System → "Regenerate Now".
 *
 * Security: Vercel automatically sends Authorization: Bearer {CRON_SECRET}
 * We also accept the admin email header for manual triggers.
 */

import { NextResponse } from 'next/server';
import { createClient }  from '@supabase/supabase-js';
import { callAI }        from '@/lib/ai';

export const maxDuration = 120; // Grok 4 + web search can take a while

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
const GLOBAL_EDGES_KEY = 'ai_daily_edges';
const CRON_LOG_KEY     = 'cron_trends_last_run';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// ── Sport config ──────────────────────────────────────────────────────────────
const SPORT_MAP = {
  mlb: { sport: 'baseball',   league: 'mlb', emoji: '⚾' },
  nba: { sport: 'basketball', league: 'nba', emoji: '🏀' },
  nhl: { sport: 'hockey',     league: 'nhl', emoji: '🏒' },
  nfl: { sport: 'football',   league: 'nfl', emoji: '🏈' },
};

// ── Fetch today's games (odds_cache table → ESPN fallback, 0 Odds API credits) ──
async function fetchTodaysGames() {
  const today    = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const gameList = [];

  // Primary: read from the odds_cache table populated by the refresh-odds cron.
  // This costs 0 Odds API credits (was 12 credits via fetchOddsForSports).
  // Cutoff: accept rows fetched within the last hour so stale data isn't used.
  const cacheCutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  try {
    for (const [sp, info] of Object.entries(SPORT_MAP)) {
      const { data: rows, error } = await supabase
        .from('odds_cache')
        .select('home_team, away_team, commence_time, game_status, odds_data')
        .eq('sport', sp)
        .in('game_status', ['pre', 'live'])
        .gte('last_fetched_at', cacheCutoff)
        .order('commence_time')
        .limit(14);

      if (error || !rows?.length) continue;

      for (const row of rows) {
        const bookmakers = row.odds_data?.bookmakers || [];
        const book = bookmakers.find(b => b.key === 'fanduel')
                  || bookmakers.find(b => b.key === 'draftkings')
                  || bookmakers[0];

        const h2h    = book?.markets?.find(m => m.key === 'h2h');
        const spreads = book?.markets?.find(m => m.key === 'spreads');
        const totals  = book?.markets?.find(m => m.key === 'totals');

        const mlHome = h2h?.outcomes?.find(o => o.name === row.home_team)?.price ?? null;
        const mlAway = h2h?.outcomes?.find(o => o.name === row.away_team)?.price ?? null;
        const sHome  = spreads?.outcomes?.find(o => o.name === row.home_team);
        const ov     = totals?.outcomes?.find(o => o.name === 'Over');
        const un     = totals?.outcomes?.find(o => o.name === 'Under');

        const homeAbbr = row.home_team.split(' ').pop();
        const awayAbbr = row.away_team.split(' ').pop();

        gameList.push({
          sport:    sp.toUpperCase(),
          emoji:    info.emoji,
          matchup:  `${awayAbbr} @ ${homeAbbr}`,
          home:     row.home_team,
          away:     row.away_team,
          mlHome,
          mlAway,
          spread:   sHome?.point != null
            ? `${homeAbbr} ${sHome.point >= 0 ? '+' : ''}${sHome.point}`
            : null,
          total:     ov?.point     ?? null,
          overOdds:  ov?.price     ?? null,
          underOdds: un?.price     ?? null,
          status:    row.game_status === 'live' ? 'In Progress' : 'Scheduled',
          oddsSource: 'odds_cache',
        });
      }
    }
    if (gameList.length > 0) {
      console.log(`[cron/trends] Loaded ${gameList.length} games from odds_cache (0 API credits)`);
      return gameList;
    }
    console.warn('[cron/trends] odds_cache empty or stale — falling back to ESPN');
  } catch (err) {
    console.warn('[cron/trends] odds_cache read failed, using ESPN fallback:', err.message);
  }

  // ESPN fallback
  for (const [key, info] of Object.entries(SPORT_MAP)) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${info.sport}/${info.league}/scoreboard?dates=${today}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      for (const ev of (data.events || []).slice(0, 14)) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const teams = comp.competitors || [];
        const home  = teams.find(t => t.homeAway === 'home');
        const away  = teams.find(t => t.homeAway === 'away');
        if (!home || !away) continue;
        const odds = comp.odds?.[0];
        gameList.push({
          sport:   key.toUpperCase(),
          emoji:   info.emoji,
          matchup: `${away.team?.abbreviation} @ ${home.team?.abbreviation}`,
          home:    home.team?.displayName || home.team?.name,
          away:    away.team?.displayName  || away.team?.name,
          mlHome:  odds?.homeTeamOdds?.moneyLine ?? null,
          mlAway:  odds?.awayTeamOdds?.moneyLine ?? null,
          spread:  odds?.details || null,
          total:   odds?.overUnder ?? null,
          status:  ev.status?.type?.description || 'Scheduled',
          oddsSource: 'espn',
        });
      }
    } catch (e) { console.warn('[trends] ESPN game parse error (skipping):', e.message); }
  }
  return gameList;
}

// ── Build the deep-analysis prompt ────────────────────────────────────────────
function buildPrompt(gameList, dateStr) {
  const gameLines = gameList.map(g =>
    `${g.emoji} ${g.sport}: ${g.matchup} (${g.away} @ ${g.home})` +
    (g.mlAway != null ? ` | ML: Away ${g.mlAway > 0 ? '+' : ''}${g.mlAway} / Home ${g.mlHome > 0 ? '+' : ''}${g.mlHome}` : '') +
    (g.spread ? ` | Spread: ${g.spread}` : '') +
    (g.total != null ? ` | Total: ${g.total}` +
      (g.overOdds  != null ? ` (O ${g.overOdds > 0  ? '+' : ''}${g.overOdds}` : '') +
      (g.underOdds != null ? ` / U ${g.underOdds > 0 ? '+' : ''}${g.underOdds})` : (g.overOdds != null ? ')' : '')) : '')
  ).join('\n');

  return `You are BetOS — a sharp sports betting analyst with access to live injury reports, line movement data, and historical situational trends. Today is ${dateStr}.

Here are today's games with current bookmaker odds:
${gameLines}

Search the web for:
1. Latest injury reports for today's key players
2. Significant line movements from the opener to current
3. Weather conditions for outdoor games
4. Revenge spots, schedule advantages, rest edges

Then identify the 5-8 BEST situational betting edges from this slate. Focus on:
- Home/away underdog value with specific reasoning
- Back-to-back fatigue and travel situations
- Pitching matchup edges with current form (MLB)
- Line value vs sharp money positioning
- Public fade spots (heavy chalk that is overpriced)
- Total plays backed by weather, pace, or pitching angles

Return ONLY a valid JSON array. Each object must have ALL these exact fields:
{
  "matchup": "AWAY @ HOME (short form)",
  "sport": "MLB|NBA|NHL|NFL",
  "sport_emoji": "⚾|🏀|🏒|🏈",
  "pick": "Team name or Over/Under X",
  "bet_type": "Moneyline|Spread|Total (Over)|Total (Under)",
  "odds": <integer American odds or null>,
  "confidence": "HIGH|MEDIUM|LOW",
  "sharp": true|false,
  "reason": "One sentence — the specific edge with live context",
  "analysis": "2-4 sentences of detailed analysis including any live injury/weather/line movement context",
  "trend_record": "e.g. 58-42 (58%) ATS last 3 seasons or null",
  "trend_roi": "e.g. +4.2% ROI or null",
  "sample_size": "e.g. n=100, 2022-2024 or null"
}

Return ONLY the JSON array, no other text or markdown.`;
}

// ── Core pipeline ─────────────────────────────────────────────────────────────
async function runTrendsPipeline() {
  const startTime = Date.now();
  console.log('[cron/trends] Starting daily trends pipeline...');

  // 1. Fetch games
  const gameList = await fetchTodaysGames();
  if (gameList.length === 0) {
    return { success: false, error: 'No games found for today', games: 0 };
  }
  console.log(`[cron/trends] Found ${gameList.length} games across all sports`);

  // 2. Build date string
  const todayISO = new Date().toISOString().split('T')[0];
  const dateStr  = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  // 3. Run Grok 4 with web search
  const aiResult = await callAI({
    system: 'You are BetOS, a sharp sports betting analyst with deep knowledge of situational edges and live betting data. Return ONLY valid JSON arrays, no markdown, no explanation.',
    user:   buildPrompt(gameList, dateStr),
    maxTokens:   3000,
    temperature: 0.4,
    useGrok4:    true,  // Use Grok 4 for highest quality analysis
    webSearch:   true,  // Live injury reports, line movement, weather
    requireSearch: true,
  });

  // 4. Parse and validate
  const raw     = aiResult.text || '';
  const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
  if (!cleaned.startsWith('[')) {
    throw new Error(`AI returned non-JSON: ${cleaned.substring(0, 120)}`);
  }
  const edges = JSON.parse(cleaned);
  if (!Array.isArray(edges) || edges.length === 0) {
    throw new Error('AI returned empty edges array');
  }
  console.log(`[cron/trends] AI (${aiResult.provider}/${aiResult.model}) returned ${edges.length} edges`);

  // 5. Save to Supabase settings table
  const payload = JSON.stringify({
    date:       todayISO,
    edges,
    generated_by:  'cron',
    ai_provider:   aiResult.provider,
    ai_model:      aiResult.model,
    games_analyzed: gameList.length,
    generated_at:  new Date().toISOString(),
  });

  await supabase
    .from('settings')
    .upsert([{ key: GLOBAL_EDGES_KEY, value: payload }], { onConflict: 'key' });

  // 6. Log the run
  const logPayload = JSON.stringify({
    run_at:       new Date().toISOString(),
    edge_count:   edges.length,
    game_count:   gameList.length,
    ai_provider:  aiResult.provider,
    ai_model:     aiResult.model,
    duration_ms:  Date.now() - startTime,
    status:       'ok',
  });
  await supabase
    .from('settings')
    .upsert([{ key: CRON_LOG_KEY, value: logPayload }], { onConflict: 'key' });

  return {
    success:    true,
    edges:      edges.length,
    games:      gameList.length,
    provider:   aiResult.provider,
    model:      aiResult.model,
    date:       todayISO,
    duration_ms: Date.now() - startTime,
  };
}

// ── GET (Vercel Cron calls this) ──────────────────────────────────────────────
export async function GET(req) {
  // Verify cron secret — Vercel injects this automatically for cron routes
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // Also allow manual trigger with admin email param (for testing)
  const { searchParams } = new URL(req.url);
  const adminEmail = searchParams.get('adminEmail');
  const isAdmin    = ADMIN_EMAILS.includes(adminEmail?.toLowerCase());

  if (!isAdmin) {
    // Fail-closed: if CRON_SECRET is not configured, return 503
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }

    // Require CRON_SECRET header
    if (authHeader !== `Bearer ${cronSecret}`) {
      console.warn('[cron/trends] Unauthorized request - missing or invalid CRON_SECRET');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Check admin-controlled enable flag
  const { data: enabledSetting } = await supabase
    .from('settings').select('value').eq('key', 'cron_trends_enabled').maybeSingle();
  if (enabledSetting?.value === 'false') {
    return NextResponse.json({ skipped: true, reason: 'Disabled by admin' });
  }

  try {
    const result = await runTrendsPipeline();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron/trends] Pipeline failed:', err.message);
    // Log the failure so the timestamp stays current and the error is visible in admin
    try {
      await supabase.from('settings').upsert(
        [{ key: CRON_LOG_KEY, value: JSON.stringify({
          run_at:     new Date().toISOString(),
          status:     'error',
          error:      err.message,
        }) }],
        { onConflict: 'key' }
      );
    } catch { /* non-critical */ }
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── POST (Admin Panel manual trigger) ─────────────────────────────────────────
export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (!ADMIN_EMAILS.includes(body.userEmail?.toLowerCase())) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }

  try {
    const result = await runTrendsPipeline();
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron/trends] Manual trigger failed:', err.message);
    try {
      await supabase.from('settings').upsert(
        [{ key: CRON_LOG_KEY, value: JSON.stringify({
          run_at:     new Date().toISOString(),
          status:     'error',
          error:      err.message,
        }) }],
        { onConflict: 'key' }
      );
    } catch { /* non-critical */ }
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
