/**
 * /api/cron/trends
 *
 * Automated daily trends pipeline — called by Vercel Cron at 9:00 AM and
 * 5:00 PM UTC (5 AM and 1 PM ET).
 *
 * Uses Grok 4 with live web search for maximum quality.
 * Falls back to Claude if Grok 4 is unavailable.
 *
 * Can also be triggered manually from Admin Panel -> System -> "Regenerate Now".
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
  mlb: { sport: 'baseball',   league: 'mlb', emoji: '[MLB]' },
  nba: { sport: 'basketball', league: 'nba', emoji: '[NBA]' },
  nhl: { sport: 'hockey',     league: 'nhl', emoji: '[NHL]' },
  nfl: { sport: 'football',   league: 'nfl', emoji: '[NFL]' },
};

// ── Fetch today's games (Odds API -> ESPN fallback) ────────────────────────────
async function fetchTodaysGames() {
  const today    = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const gameList = [];

  // Try The Odds API shared lib first
  try {
    const { fetchOddsForSports, buildOddsLookup } = await import('@/lib/odds');
    const oddsMap = await fetchOddsForSports(['mlb', 'nba', 'nhl', 'nfl']);
    for (const [sp, games] of Object.entries(oddsMap)) {
      for (const g of games.slice(0, 14)) {
        gameList.push({
          sport:    sp.toUpperCase(),
          emoji:    g.emoji || SPORT_MAP[sp]?.emoji || '[trophy]',
          matchup:  g.matchup,
          home:     g.home,
          away:     g.away,
          mlHome:   g.mlHome,
          mlAway:   g.mlAway,
          spread:   g.spreadHomePoint != null
            ? `${g.home.split(' ').pop()} ${g.spreadHomePoint >= 0 ? '+' : ''}${g.spreadHomePoint}`
            : null,
          total:     g.total,
          overOdds:  g.overOdds,
          underOdds: g.underOdds,
          status:    g.status || 'Scheduled',
          oddsSource: 'the-odds-api',
        });
      }
    }
    if (gameList.length > 0) return gameList;
  } catch (err) {
    console.warn('[cron/trends] Odds API failed, using ESPN fallback:', err.message);
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
    } catch { /* skip */ }
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

  return `You are BetOS - a sharp sports betting analyst with access to live injury reports, line movement data, and historical situational trends. Today is ${dateStr}.

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
  "sport_emoji": "[MLB]|[NBA]|[NHL]|[NFL]",
  "pick": "Team name or Over/Under X",
  "bet_type": "Moneyline|Spread|Total (Over)|Total (Under)",
  "odds": <integer American odds or null>,
  "confidence": "HIGH|MEDIUM|LOW",
  "sharp": true|false,
  "reason": "One sentence - the specific edge with live context",
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
    last_run_at:  new Date().toISOString(),
    edge_count:   edges.length,
    game_count:   gameList.length,
    ai_provider:  aiResult.provider,
    ai_model:     aiResult.model,
    duration_ms:  Date.now() - startTime,
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
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
