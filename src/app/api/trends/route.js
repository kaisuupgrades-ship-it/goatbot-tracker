import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { callAI } from '@/lib/ai';
import { fetchOddsForSports, buildOddsLookup } from '@/lib/odds';
import { fetchWeatherForGames } from '@/lib/weather';

export const maxDuration = 60;

const ADMIN_EMAIL = 'kaisuupgrades@gmail.com';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Keys in the settings table
const GLOBAL_EDGES_KEY = 'ai_daily_edges';

// ── RATE LIMITING ─────────────────────────────────────────────────────────────
const DAILY_AI_LIMIT = 5;

async function checkAndIncrementUsage(userId) {
  if (!userId) return { allowed: false, remaining: 0, reason: 'Not logged in' };
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data: existing } = await supabase
      .from('ai_usage')
      .select('count')
      .eq('user_id', userId)
      .eq('date', today)
      .single();
    const currentCount = existing?.count || 0;
    if (currentCount >= DAILY_AI_LIMIT) {
      return { allowed: false, remaining: 0, reason: `Daily limit of ${DAILY_AI_LIMIT} AI queries reached. Resets at midnight.` };
    }
    await supabase
      .from('ai_usage')
      .upsert([{ user_id: userId, date: today, count: currentCount + 1 }], { onConflict: 'user_id,date' });
    return { allowed: true, remaining: DAILY_AI_LIMIT - currentCount - 1 };
  } catch {
    return { allowed: true, remaining: DAILY_AI_LIMIT - 1, tableNeeded: true };
  }
}

// ── ESPN game fetcher (server-side) ──────────────────────────────────────────
const SPORT_MAP = {
  mlb: { sport: 'baseball',    league: 'mlb',           emoji: '⚾' },
  nba: { sport: 'basketball',  league: 'nba',           emoji: '🏀' },
  nhl: { sport: 'hockey',      league: 'nhl',           emoji: '🏒' },
  nfl: { sport: 'football',    league: 'nfl',           emoji: '🏈' },
};

async function fetchTodaysGames() {
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const gameList = [];

  // ── Primary: The Odds API — real bookmaker lines, all games in one call ──
  try {
    const oddsMap  = await fetchOddsForSports(['mlb', 'nba', 'nhl', 'nfl']);
    const lookup   = buildOddsLookup(oddsMap);

    // Flatten all sports into a game list
    for (const [sp, games] of Object.entries(oddsMap)) {
      for (const g of games.slice(0, 12)) {
        gameList.push({
          sport:   sp.toUpperCase(),
          emoji:   g.emoji,
          matchup: g.matchup,
          home:    g.home,
          away:    g.away,
          mlHome:  g.mlHome,
          mlAway:  g.mlAway,
          spread:  g.spreadHomePoint != null
            ? `${g.home.split(' ').pop()} ${g.spreadHomePoint >= 0 ? '+' : ''}${g.spreadHomePoint}`
            : null,
          total:    g.total,
          overOdds: g.overOdds,
          underOdds: g.underOdds,
          status:   g.status || 'Scheduled',
          oddsSource: 'the-odds-api',
        });
      }
    }

    if (gameList.length > 0) return gameList;
  } catch (err) {
    console.warn('[fetchTodaysGames] The Odds API failed, falling back to ESPN:', err.message);
  }

  // ── Fallback: ESPN scoreboard (odds often null but gives game schedule) ──
  for (const [key, info] of Object.entries(SPORT_MAP)) {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${info.sport}/${info.league}/scoreboard?dates=${today}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();

      for (const ev of (data.events || []).slice(0, 12)) {
        const comp = ev.competitions?.[0];
        if (!comp) continue;
        const teams = comp.competitors || [];
        const home = teams.find(t => t.homeAway === 'home');
        const away = teams.find(t => t.homeAway === 'away');
        if (!home || !away) continue;

        const odds = comp.odds?.[0];
        const mlHome = odds?.homeTeamOdds?.moneyLine ?? odds?.homeTeamOdds?.current?.moneyLine ?? null;
        const mlAway = odds?.awayTeamOdds?.moneyLine ?? odds?.awayTeamOdds?.current?.moneyLine ?? null;
        const spread = odds?.details || null;
        const total  = odds?.overUnder ?? null;

        gameList.push({
          sport:   key.toUpperCase(),
          emoji:   info.emoji,
          matchup: `${away.team?.abbreviation} @ ${home.team?.abbreviation}`,
          home:    home.team?.displayName || home.team?.name,
          away:    away.team?.displayName || away.team?.name,
          mlHome, mlAway, spread, total,
          status:  ev.status?.type?.description || 'Scheduled',
          oddsSource: 'espn',
        });
      }
    } catch { /* skip failed league */ }
  }

  return gameList;
}

function buildEdgePrompt(gameList, dateStr, weatherMap = {}) {
  const weatherLines = Object.entries(weatherMap)
    .map(([matchup, w]) => `  ${matchup}: ${w}`)
    .join('\n');

  return `You are BetOS — a sharp sports betting analyst. Today is ${dateStr}.

Here are today's games with current FanDuel/DraftKings odds:
${gameList.map(g =>
  `${g.emoji} ${g.sport}: ${g.matchup} (${g.away} @ ${g.home})` +
  (g.mlAway != null ? ` | ML: Away ${g.mlAway > 0 ? '+' : ''}${g.mlAway} / Home ${g.mlHome > 0 ? '+' : ''}${g.mlHome}` : '') +
  (g.spread ? ` | Spread: ${g.spread}` : '') +
  (g.total != null ? ` | Total: ${g.total}` +
    (g.overOdds  != null ? ` (O ${g.overOdds > 0 ? '+' : ''}${g.overOdds}`  : '') +
    (g.underOdds != null ? ` / U ${g.underOdds > 0 ? '+' : ''}${g.underOdds})` : (g.overOdds != null ? ')' : '')) : '') +
  (weatherMap[g.matchup] ? ` | Weather: ${weatherMap[g.matchup]}` : '')
).join('\n')}
${weatherLines ? `\nOutdoor stadium weather conditions:\n${weatherLines}` : ''}

Identify the 4-8 BEST situational betting edges from this slate. For each edge, consider:
- Home/away underdog value spots
- Back-to-back fatigue situations
- Rest advantages
- Weather/dome factors for totals
- Pitcher matchup edges (MLB)
- Line value vs market expectation
- Public fade spots (heavy chalk that is overpriced)

Return ONLY a valid JSON array. Each object must have these exact fields:
{
  "matchup": "AWAY @ HOME (short form)",
  "sport": "MLB|NBA|NHL|NFL",
  "sport_emoji": "⚾|🏀|🏒|🏈",
  "pick": "Team name or Over/Under X",
  "bet_type": "Moneyline|Spread|Total (Over)|Total (Under)",
  "odds": <integer American odds or null>,
  "confidence": "HIGH|MEDIUM|LOW",
  "sharp": true|false,
  "reason": "One sentence — the specific edge",
  "analysis": "2-3 sentences of detailed analysis with the why",
  "trend_record": "e.g. 58-42 (58%) ATS last 3 seasons or null",
  "trend_roi": "e.g. +4.2% ROI or null",
  "sample_size": "e.g. n=100, 2022-2024 or null"
}

Return ONLY the JSON array, no other text.`;
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'usage';
  const userId = searchParams.get('userId') || '';

  // Return the admin-generated global edge cards for today
  if (action === 'global-edges') {
    try {
      const { data: cached } = await supabase
        .from('settings')
        .select('value, updated_at')
        .eq('key', GLOBAL_EDGES_KEY)
        .single();

      if (cached?.value) {
        const payload = typeof cached.value === 'string' ? JSON.parse(cached.value) : cached.value;
        const today = new Date().toISOString().split('T')[0];

        if (payload?.date === today && Array.isArray(payload?.edges) && payload.edges.length > 0) {
          return NextResponse.json({
            edges: payload.edges,
            date: payload.date,
            cached: true,
            pushed_at: cached.updated_at,
          });
        }
      }
    } catch { /* settings table may not exist yet */ }

    return NextResponse.json({ edges: [], cached: false });
  }

  // Per-user daily usage count
  if (action === 'usage') {
    if (!userId) return NextResponse.json({ remaining: DAILY_AI_LIMIT, limit: DAILY_AI_LIMIT });
    const today = new Date().toISOString().split('T')[0];
    try {
      const { data } = await supabase
        .from('ai_usage')
        .select('count')
        .eq('user_id', userId)
        .eq('date', today)
        .single();
      const used = data?.count || 0;
      return NextResponse.json({ remaining: Math.max(0, DAILY_AI_LIMIT - used), limit: DAILY_AI_LIMIT, used });
    } catch {
      return NextResponse.json({ remaining: DAILY_AI_LIMIT, limit: DAILY_AI_LIMIT, used: 0 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req) {
  const body = await req.json();

  // ── Admin: Push today's edges site-wide ──────────────────────────────────
  if (body.action === 'scan-edges') {
    const { userEmail } = body;
    if (userEmail !== ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    try {
      // 1. Fetch today's games from ESPN
      const gameList = await fetchTodaysGames();

      if (gameList.length === 0) {
        return NextResponse.json({ error: 'No games found for today. ESPN may not have updated yet.' }, { status: 404 });
      }

      // 2. Fetch weather for outdoor MLB/NFL games (parallel, non-blocking)
      const weatherMap = await fetchWeatherForGames(gameList).catch(() => ({}));

      // 3. Run AI edge analysis
      const today = new Date().toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      });
      const todayISO = new Date().toISOString().split('T')[0];

      const aiResult = await callAI({
        system: 'You are BetOS, a sharp sports betting analyst. Return ONLY valid JSON arrays, no markdown or explanation.',
        user: buildEdgePrompt(gameList, today, weatherMap),
        maxTokens: 2000,
        temperature: 0.5,
        useGrok4: true,   // use the most capable model for site-wide published analysis
        webSearch: true,  // enable live web search for latest injury news, line movement, etc.
      });

      const raw     = aiResult.text || '';
      const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
      const edges   = JSON.parse(cleaned);

      if (!Array.isArray(edges) || edges.length === 0) {
        return NextResponse.json({ error: 'AI returned no edges. Try again shortly.' }, { status: 500 });
      }

      // 3. Save to settings table (overwrites previous)
      const payload = JSON.stringify({ date: todayISO, edges, pushed_by: userEmail, pushed_at: new Date().toISOString() });

      await supabase
        .from('settings')
        .upsert([{ key: GLOBAL_EDGES_KEY, value: payload }], { onConflict: 'key' });

      return NextResponse.json({
        success: true,
        count: edges.length,
        date: todayISO,
        games_scanned: gameList.length,
        provider: aiResult.provider,
      });

    } catch (err) {
      console.error('[scan-edges]', err.message);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
  }

  // ── User: Rate-limited AI Q&A ─────────────────────────────────────────────
  const { question, userId, isEdgeScan } = body;

  if (!question?.trim()) {
    return NextResponse.json({ error: 'Question is required' }, { status: 400 });
  }

  // Edge scans from TrendsTab are not rate-limited (they use the edge prompt, not a general Q)
  if (!isEdgeScan) {
    const usage = await checkAndIncrementUsage(userId);
    if (!usage.allowed) {
      return NextResponse.json({ error: usage.reason, rateLimited: true }, { status: 429 });
    }
    // General analyst Q&A
    try {
      const aiResult = await callAI({
        system: `You are BetOS Trends Analyst — a sharp sports betting researcher with deep knowledge of situational betting, line movement, and statistical edges.

Answer questions about sports betting trends and edges. Rules:
- Be honest about uncertainty — say "research suggests" not "proven fact" for statistical claims
- Give actionable advice with specific parameters (e.g. "fade road B2B teams when they are -3 or more chalk")
- Mention sample size caveats when discussing trends
- Never invent specific win/loss records or ROI percentages you don't actually know
- End every response with a concrete "Bottom line:" action sentence
- Keep responses under 220 words, direct and practical`,
        user: question,
        maxTokens: 350,
        temperature: 0.6,
      });
      return NextResponse.json({ answer: aiResult.text, remaining: usage.remaining, source: aiResult.provider });
    } catch (err) {
      console.error('AI trends error:', err.message);
      return NextResponse.json({
        answer: 'AI analysis is temporarily unavailable. Please try again shortly.',
        remaining: usage.remaining,
        source: 'error',
      });
    }
  }

  // isEdgeScan: true → full slate scan from TrendsTab (no rate limit consumed, uses shared endpoint)
  try {
    const aiResult = await callAI({
      system: 'You are BetOS, a sharp sports betting analyst. Return ONLY valid JSON arrays, no markdown or explanation.',
      user: question,
      maxTokens: 2000,
      temperature: 0.5,
    });

    // Strip markdown fences and validate the response is a JSON array before sending to client
    const raw     = aiResult.text || '';
    const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();

    // If AI returned an error string instead of JSON, treat it as a failure
    if (!cleaned.startsWith('[')) {
      console.warn('[edge-scan] AI returned non-JSON:', cleaned.substring(0, 120));
      return NextResponse.json({ error: 'AI returned an unexpected response. Please try again.' }, { status: 502 });
    }

    // Validate it parses correctly before sending
    try { JSON.parse(cleaned); } catch {
      return NextResponse.json({ error: 'AI response was malformed JSON. Please try again.' }, { status: 502 });
    }

    return NextResponse.json({ answer: cleaned, source: aiResult.provider });
  } catch (err) {
    console.error('Edge scan AI error:', err.message);
    return NextResponse.json({ error: 'AI unavailable. Try again in a moment.' }, { status: 503 });
  }
}
