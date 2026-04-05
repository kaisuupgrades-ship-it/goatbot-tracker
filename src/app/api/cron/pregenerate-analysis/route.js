/**
 * /api/cron/pregenerate-analysis
 *
 * Vercel Cron: runs at 8 AM ET and 4 PM ET every day.
 * Fetches all today's games from ESPN (MLB, NHL, NBA, NFL, MLS),
 * generates a full BetOS analysis for each matchup using Grok-4 + web search,
 * and stores the results in the game_analyses table.
 *
 * When users hit the GoatBot Analyzer, it checks this cache first and
 * returns the pre-generated report (~instant) + a quick news-delta check
 * instead of waiting 60–90s for a fresh full analysis.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300; // full 5 min — many games to process

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const XAI_BASE  = 'https://api.x.ai/v1';

const SPORT_PATHS = {
  mlb:  'baseball/mlb',
  nba:  'basketball/nba',
  nhl:  'hockey/nhl',
  nfl:  'football/nfl',
  mls:  'soccer/usa.1',
  wnba: 'basketball/wnba',
};

const ANALYSIS_SYSTEM = `You are BetOS — a sharp AI sports analyst. Produce a concise but complete pre-game analysis report for the given matchup. Use live web search to gather:
- Starting pitcher/goalie/lineup news confirmed for this specific date
- Current moneyline, spread, and total odds from major books
- Line movement since open (direction and key movers)
- Injury/availability reports from beat reporters
- Situational angles: rest, travel, weather (outdoor), motivation

Output format — follow exactly:

THE PICK: [Team + Bet Type + Odds + Book] — your sharpest recommended play

EDGE BREAKDOWN: [2–3 sentences. What the market implies, what you found that shifts it. Specific numbers only.]

KEY FACTORS:
1. [Best verified finding with specific numbers]
2. [Matchup or starter angle with real context]
3. [Situational factor — weather/rest/travel/motivation]

CONFIDENCE: [LOW / MEDIUM / HIGH / ELITE]

EDGE SCORE: [X/10]

BetOS PROBABILITY ESTIMATE: [Market implied: X%. Adjusted to Y–Z% based on: brief reasoning.]

RECORD IMPACT: [One sentence on unit sizing.]

Rules: No markdown asterisks. No invented numbers. If you can't verify a stat, say so. Be decisive.`;

async function fetchTodaysGames(sport, dateStr) {
  const path = SPORT_PATHS[sport];
  if (!path) return [];
  try {
    const res = await fetch(`${ESPN_BASE}/${path}/scoreboard?dates=${dateStr}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events || []).filter(ev => {
      // Only pre-generate for games that haven't started yet.
      // 'pre' = scheduled/upcoming. Skip 'in' (live) and 'post' (final) —
      // the 8am run covers the full slate; the 4pm run just fills any gaps.
      const state = ev.competitions?.[0]?.status?.type?.state;
      return state === 'pre';
    });
  } catch {
    return [];
  }
}

async function generateAnalysis(sport, homeTeam, awayTeam, gameDate, oddsContext) {
  const prompt = `Analyze this ${sport.toUpperCase()} matchup for ${gameDate}:

${awayTeam} @ ${homeTeam}
${oddsContext ? `\nKnown odds context:\n${oddsContext}` : ''}

Provide a full BetOS sharp analysis report. Search for confirmed lineups/starters, current odds and line movement, injury reports, and any situational edges. Pick the sharpest play.`;

  const xaiKey = process.env.XAI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;

  // Tier 1: Grok-4 + web search (primary for pre-generation — thorough)
  if (xaiKey) {
    try {
      const res = await fetch(`${XAI_BASE}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${xaiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-4',
          instructions: ANALYSIS_SYSTEM,
          input: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search' }],
          max_output_tokens: 2500,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (res.ok) {
        const data = await res.json();
        const texts = (data.output || [])
          .filter(item => item.type === 'message')
          .flatMap(msg => (msg.content || []).filter(c => c.type === 'output_text').map(c => c.text));
        const text = texts.join('\n\n').trim();
        if (text) return { text, model: 'BetOS AI' };
      }
    } catch (e) {
      console.log(`[pregenerate] grok-4 failed for ${awayTeam}@${homeTeam}:`, e.message);
    }
  }

  // Tier 2: Claude Opus 4.6 + web search
  if (claudeKey) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': claudeKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-6',
          system: ANALYSIS_SYSTEM,
          tools: [{ type: 'web_search_20260209' }],
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2500,
          temperature: 1,
        }),
        signal: AbortSignal.timeout(80_000),
      });
      if (res.ok) {
        const data = await res.json();
        const text = (data.content || [])
          .filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
        if (text) return { text, model: 'BetOS AI' };
      }
    } catch (e) {
      console.log(`[pregenerate] Claude failed for ${awayTeam}@${homeTeam}:`, e.message);
    }
  }

  return null;
}

export async function GET(req) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check admin-controlled enable flag
  const { data: enabledSetting } = await supabase
    .from('settings').select('value').eq('key', 'cron_pregenerate_enabled').maybeSingle();
  if (enabledSetting?.value === 'false') {
    return NextResponse.json({ skipped: true, reason: 'Disabled by admin' });
  }

  const params   = new URL(req.url).searchParams;
  const force    = params.get('force') === 'true';
  // Optional: filter to a single sport (used by admin per-sport calls to stay within timeout)
  const sportFilter = params.get('sport') || null;

  const started = Date.now();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const espnDate = todayStr.replace(/-/g, '');

  console.log(`[pregenerate-analysis] Starting for ${todayStr}, force=${force}, sport=${sportFilter || 'all'}`);

  // If not force, skip analyses generated in the last 3.5 hours
  const staleAfter = new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString();

  const generated = [];
  const skipped   = [];
  const errors    = [];

  // Filter to a single sport if specified (allows fast per-sport admin calls)
  const sportsToProcess = sportFilter
    ? Object.entries(SPORT_PATHS).filter(([key]) => key === sportFilter)
    : Object.entries(SPORT_PATHS);

  for (const [sport, _] of sportsToProcess) {
    const events = await fetchTodaysGames(sport, espnDate);
    if (!events.length) continue;

    for (const event of events) {
      const comps   = event.competitions?.[0]?.competitors || [];
      const homeComp = comps.find(c => c.homeAway === 'home');
      const awayComp = comps.find(c => c.homeAway === 'away');
      if (!homeComp || !awayComp) continue;

      const homeTeam = homeComp.team?.displayName || homeComp.team?.name || '';
      const awayTeam = awayComp.team?.displayName || awayComp.team?.name || '';
      if (!homeTeam || !awayTeam) continue;

      // Check if we already have a fresh analysis for this game
      if (!force) {
        const { data: existing } = await supabase
          .from('game_analyses')
          .select('id, updated_at')
          .eq('sport', sport)
          .eq('game_date', todayStr)
          .ilike('home_team', homeTeam)
          .ilike('away_team', awayTeam)
          .single();

        if (existing && existing.updated_at > staleAfter) {
          skipped.push(`${awayTeam}@${homeTeam}`);
          continue;
        }
      }

      // Build odds context from ESPN if available
      const espnOdds = event.competitions?.[0]?.odds?.[0];
      const oddsContext = espnOdds
        ? `Spread: ${espnOdds.details || 'N/A'} | O/U: ${espnOdds.overUnder || 'N/A'}`
        : '';

      const gameTime = event.competitions?.[0]?.date
        ? new Date(event.competitions[0].date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        : '';

      console.log(`[pregenerate] Generating: ${awayTeam} @ ${homeTeam} (${sport.toUpperCase()}) ${gameTime}`);

      try {
        const result = await generateAnalysis(sport, homeTeam, awayTeam, todayStr, oddsContext);
        if (!result) { errors.push(`${awayTeam}@${homeTeam}: no AI response`); continue; }

        // Upsert into game_analyses table
        await supabase.from('game_analyses').upsert(
          [{
            sport,
            game_date:  todayStr,
            home_team:  homeTeam,
            away_team:  awayTeam,
            analysis:   result.text,
            model:      result.model,
            generated_at: new Date().toISOString(),
            updated_at:   new Date().toISOString(),
          }],
          { onConflict: 'sport,game_date,home_team,away_team', ignoreDuplicates: false }
        );

        generated.push(`${awayTeam}@${homeTeam} (${sport.toUpperCase()})`);
        // Small delay between games to avoid rate limiting
        await new Promise(r => setTimeout(r, 1000));
      } catch (e) {
        errors.push(`${awayTeam}@${homeTeam}: ${e.message}`);
      }
    }
  }

  const summary = {
    generated: generated.length,
    skipped:   skipped.length,
    errors:    errors.length,
    games:     generated,
    error_list: errors,
    duration_ms: Date.now() - started,
    run_at: new Date().toISOString(),
  };

  console.log('[pregenerate-analysis]', summary);

  // Store summary for Admin Panel
  await supabase.from('settings').upsert(
    [{ key: 'cron_pregenerate_last_run', value: JSON.stringify(summary) }],
    { onConflict: 'key' }
  ).catch(() => {});

  return NextResponse.json(summary);
}

/**
 * POST /api/cron/pregenerate-analysis
 * Admin-only manual trigger — same logic as GET but authenticated via admin email.
 * Called from the Admin Panel "Pre-Generate Analyses" button.
 */
export async function POST(req) {
  const ADMIN_EMAIL = 'kaisuupgrades@gmail.com';
  try {
    const body = await req.json();
    const { userEmail, force = true, sport = null } = body;
    if (userEmail?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    // Reuse the same GET logic by constructing a fake request with the cron secret
    const fakeUrl = new URL('http://localhost/api/cron/pregenerate-analysis');
    if (force) fakeUrl.searchParams.set('force', 'true');
    if (sport)  fakeUrl.searchParams.set('sport', sport);
    const fakeReq = new Request(fakeUrl.toString(), {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
    });
    return await GET(fakeReq);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
