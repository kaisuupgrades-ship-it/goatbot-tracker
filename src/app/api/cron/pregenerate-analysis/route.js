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
import { buildPerformanceContext } from '@/lib/feedbackLoop';

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

// ── Prompt versioning ─────────────────────────────────────────────────────────
// Bump this when you change the system prompt so we can A/B test performance
const PROMPT_VERSION = 'v1.0';

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
      const comp  = ev.competitions?.[0];
      const state = comp?.status?.type?.state;
      // Always include pre-game (scheduled/upcoming)
      if (state === 'pre') return true;
      // Also include recently-started games (within 90 min of first pitch/tipoff)
      // so that late-afternoon cron runs can still generate for early games that
      // started between the 8am and 4pm runs. Skip 'post' (final) games.
      if (state === 'in' && comp?.date) {
        const started = new Date(comp.date).getTime();
        const elapsed = Date.now() - started;
        return elapsed < 90 * 60 * 1000; // less than 90 min ago
      }
      return false;
    });
  } catch {
    return [];
  }
}

// Fetch cached odds from settings table and find the matching game
// Returns a rich multi-bookmaker odds string for the AI prompt
async function fetchCachedOdds(sport, homeTeam, awayTeam) {
  try {
    // Map sport codes to odds cache keys
    const sportKeyMap = {
      mlb: 'mlb', nba: 'nba', nhl: 'nhl', nfl: 'nfl', mls: 'mls', wnba: 'wnba',
    };
    const cacheKey = `odds_cache_${sportKeyMap[sport] || sport}`;
    const { data } = await supabase
      .from('settings').select('value').eq('key', cacheKey).maybeSingle();
    if (!data?.value) return '';

    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const odds = parsed.data || parsed;
    if (!Array.isArray(odds)) return '';

    // Find the matching game (fuzzy match on team names)
    const ht = homeTeam.toLowerCase();
    const at = awayTeam.toLowerCase();
    const game = odds.find(g =>
      g.home_team?.toLowerCase().includes(ht.split(' ').pop()) &&
      g.away_team?.toLowerCase().includes(at.split(' ').pop())
    );
    if (!game || !game.bookmakers?.length) return '';

    // Build a rich odds summary from up to 4 bookmakers
    const lines = [];
    const books = game.bookmakers.slice(0, 4);
    for (const book of books) {
      const bookLines = [];
      for (const market of (book.markets || [])) {
        const key = market.key;
        const outcomes = (market.outcomes || []).map(o =>
          `${o.name} ${o.point != null ? (o.point > 0 ? '+' : '') + o.point : ''} (${o.price > 0 ? '+' : ''}${o.price})`
        ).join(' / ');
        if (outcomes) bookLines.push(`${key}: ${outcomes}`);
      }
      if (bookLines.length) lines.push(`${book.title || book.key}: ${bookLines.join(' | ')}`);
    }
    return lines.length
      ? `LIVE ODDS (from The Odds API cache):\n${lines.join('\n')}`
      : '';
  } catch (e) {
    console.log(`[pregenerate] odds cache fetch failed for ${sport}:`, e.message);
    return '';
  }
}

async function generateAnalysis(sport, homeTeam, awayTeam, gameDate, oddsContext, performanceContext) {
  const prompt = `Analyze this ${sport.toUpperCase()} matchup for ${gameDate}:

${awayTeam} @ ${homeTeam}
${oddsContext ? `\nKnown odds context:\n${oddsContext}` : ''}
${performanceContext || ''}

Provide a full BetOS sharp analysis report. Search for confirmed lineups/starters, current odds and line movement, injury reports, and any situational edges. Pick the sharpest play.`;

  const xaiKey = process.env.XAI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;

  // Tier 1: Grok-4 + web search (primary for pre-generation — thorough)
  if (xaiKey) {
    try {
      const t0 = Date.now();
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
        const latency = Date.now() - t0;
        const texts = (data.output || [])
          .filter(item => item.type === 'message')
          .flatMap(msg => (msg.content || []).filter(c => c.type === 'output_text').map(c => c.text));
        const text = texts.join('\n\n').trim();
        if (text) return {
          text,
          model: 'BetOS AI',
          model_used: 'grok-4',
          provider: 'xai',
          was_fallback: false,
          latency_ms: latency,
          tokens_in: data.usage?.input_tokens || null,
          tokens_out: data.usage?.output_tokens || null,
          system_prompt: ANALYSIS_SYSTEM,
          user_prompt: prompt,
          prompt_version: PROMPT_VERSION,
        };
      }
    } catch (e) {
      console.log(`[pregenerate] grok-4 failed for ${awayTeam}@${homeTeam}:`, e.message);
    }
  }

  // Tier 2: Claude Opus 4.6 + web search
  if (claudeKey) {
    try {
      const t0 = Date.now();
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
        const latency = Date.now() - t0;
        const text = (data.content || [])
          .filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
        if (text) return {
          text,
          model: 'BetOS AI',
          model_used: 'claude-opus-4-6',
          provider: 'claude',
          was_fallback: true,
          latency_ms: latency,
          tokens_in: data.usage?.input_tokens || null,
          tokens_out: data.usage?.output_tokens || null,
          system_prompt: ANALYSIS_SYSTEM,
          user_prompt: prompt,
          prompt_version: PROMPT_VERSION,
        };
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
  // Optional: override date (YYYY-MM-DD). Used by admin "Generate for Tomorrow" button.
  const dateOverride = params.get('date') || null;

  const started = Date.now();
  // Use ET (America/New_York) for "today" so late-night cron runs don't accidentally
  // process the wrong date. When dateOverride is given (admin buttons), use it directly.
  let todayStr;
  if (dateOverride) {
    todayStr = dateOverride;
  } else {
    const etFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    todayStr = etFormatter.format(new Date()); // YYYY-MM-DD in ET
  }
  const espnDate = todayStr.replace(/-/g, '');
  // Unique run ID groups all analyses from this single cron/admin invocation
  const runId = `run_${todayStr}_${Date.now()}`;

  console.log(`[pregenerate-analysis] Starting for ${todayStr}, force=${force}, sport=${sportFilter || 'all'}`);

  // Pre-warm odds cache: fetch fresh odds from The Odds API for each sport
  // so analyses have the best available line data. This uses the same API key
  // as /api/odds and caches to the same settings keys.
  const THE_ODDS_KEY = process.env.THE_ODDS_API_KEY;
  const ODDS_SPORT_KEYS = {
    mlb: 'baseball_mlb', nba: 'basketball_nba', nhl: 'icehockey_nhl',
    nfl: 'americanfootball_nfl', mls: 'soccer_usa_mls', wnba: 'basketball_wnba',
  };
  if (THE_ODDS_KEY) {
    const sportsToPrime = sportFilter ? [sportFilter] : Object.keys(ODDS_SPORT_KEYS);
    for (const sk of sportsToPrime) {
      const oddsKey = ODDS_SPORT_KEYS[sk];
      if (!oddsKey) continue;
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/odds?apiKey=${THE_ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const data = await res.json();
          await supabase.from('settings').upsert(
            [{ key: `odds_cache_${sk}`, value: JSON.stringify({ data, timestamp: Date.now(), source: 'the-odds-api' }) }],
            { onConflict: 'key' }
          );
          console.log(`[pregenerate] Odds pre-warmed for ${sk}: ${data.length} games`);
        }
      } catch (e) {
        console.log(`[pregenerate] Odds pre-warm failed for ${sk}:`, e.message);
      }
    }
  }

  // If not force, skip analyses generated in the last 3.5 hours
  const staleAfter = new Date(Date.now() - 3.5 * 60 * 60 * 1000).toISOString();

  const generated = [];
  const skipped   = [];
  const errors    = [];

  // Filter to a single sport if specified (allows fast per-sport admin calls)
  const sportsToProcess = sportFilter
    ? Object.entries(SPORT_PATHS).filter(([key]) => key === sportFilter)
    : Object.entries(SPORT_PATHS);

  // Write live progress so the UI can poll status even if the user switches tabs
  const totalSports = sportsToProcess.length;
  let sportIndex = 0;
  async function writeProgress(currentSport, status) {
    try {
      await supabase.from('settings').upsert(
        [{ key: 'pregenerate_progress', value: JSON.stringify({
          status,           // 'running' | 'done'
          current_sport: currentSport,
          sport_index: sportIndex,
          total_sports: totalSports,
          generated: generated.length,
          skipped: skipped.length,
          errors: errors.length,
          started_at: new Date(started).toISOString(),
          updated_at: new Date().toISOString(),
        })}],
        { onConflict: 'key' }
      );
    } catch { /* non-critical */ }
  }

  // Cache performance context per sport (one DB query per sport, not per game)
  const perfContextCache = {};

  for (const [sport, _] of sportsToProcess) {
    sportIndex++;
    await writeProgress(sport, 'running');

    // Build the self-improvement context for this sport (cached)
    if (!perfContextCache[sport]) {
      try {
        perfContextCache[sport] = await buildPerformanceContext(sport);
      } catch (e) {
        console.warn(`[pregenerate] Performance context failed for ${sport}:`, e.message);
        perfContextCache[sport] = '';
      }
    }

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

      // Build odds context — prefer rich cached odds from The Odds API,
      // fall back to ESPN's basic spread/total if no cache available
      let oddsContext = await fetchCachedOdds(sport, homeTeam, awayTeam);
      if (!oddsContext) {
        const espnOdds = event.competitions?.[0]?.odds?.[0];
        oddsContext = espnOdds
          ? `Spread: ${espnOdds.details || 'N/A'} | O/U: ${espnOdds.overUnder || 'N/A'}`
          : '';
      }

      const gameTime = event.competitions?.[0]?.date
        ? new Date(event.competitions[0].date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        : '';

      console.log(`[pregenerate] Generating: ${awayTeam} @ ${homeTeam} (${sport.toUpperCase()}) ${gameTime}`);

      // Determine trigger source for audit logging
      const triggerSource = sportFilter
        ? 'admin_per_sport'
        : params.get('force') === 'true'
          ? 'admin_manual'
          : new Date().getUTCHours() < 14 ? 'cron_8am' : 'cron_4pm';

      try {
        const result = await generateAnalysis(sport, homeTeam, awayTeam, todayStr, oddsContext, perfContextCache[sport]);
        if (!result) { errors.push(`${awayTeam}@${homeTeam}: no AI response`); continue; }

        // Parse pick/conf/edge from the response for immediate storage
        const pickM = result.text.match(/THE PICK[:\s]+([^\n]{5,120})/i);
        const confM = result.text.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
        const edgeM = result.text.match(/EDGE SCORE[:\s]+(\d+\/\d+)/i);

        // Upsert into game_analyses table (now with audit columns)
        const { data: upserted } = await supabase.from('game_analyses').upsert(
          [{
            sport,
            game_date:      todayStr,
            home_team:      homeTeam,
            away_team:      awayTeam,
            analysis:       result.text,
            model:          result.model,
            provider:       result.provider,
            was_fallback:   result.was_fallback,
            latency_ms:     result.latency_ms,
            tokens_in:      result.tokens_in,
            tokens_out:     result.tokens_out,
            prompt_version: result.prompt_version,
            trigger_source: triggerSource,
            run_id:         runId,
            prediction_pick: pickM?.[1]?.trim() || null,
            prediction_conf: confM?.[1]?.trim() || null,
            generated_at:   new Date().toISOString(),
            updated_at:     new Date().toISOString(),
          }],
          { onConflict: 'sport,game_date,home_team,away_team', ignoreDuplicates: false }
        ).select('id').maybeSingle();

        // Write to the detailed audit log
        await supabase.from('analysis_audit_logs').insert([{
          analysis_id:     upserted?.id || null,
          sport,
          game_date:       todayStr,
          home_team:       homeTeam,
          away_team:       awayTeam,
          model_requested: 'grok-4',
          model_used:      result.model_used,
          provider:        result.provider,
          was_fallback:    result.was_fallback,
          prompt_version:  result.prompt_version,
          system_prompt:   result.system_prompt,
          user_prompt:     result.user_prompt,
          odds_context:    oddsContext || null,
          espn_game_state: 'pre',
          game_time:       gameTime || null,
          raw_response:    result.text,
          tokens_in:       result.tokens_in,
          tokens_out:      result.tokens_out,
          latency_ms:      result.latency_ms,
          parsed_pick:     pickM?.[1]?.trim() || null,
          parsed_conf:     confM?.[1]?.trim() || null,
          parsed_edge:     edgeM?.[1]?.trim() || null,
          trigger_source:  triggerSource,
          run_id:          runId,
        }]).catch(e => console.warn('[pregenerate] Audit log insert failed:', e.message));

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
  try {
    await supabase.from('settings').upsert(
      [{ key: 'cron_pregenerate_last_run', value: JSON.stringify(summary) }],
      { onConflict: 'key' }
    );
  } catch { /* non-critical */ }

  // Mark progress as done so polling clients know it finished
  await writeProgress('', 'done');

  return NextResponse.json(summary);
}

/**
 * POST /api/cron/pregenerate-analysis
 * Admin-only manual trigger — same logic as GET but authenticated via admin email.
 * Called from the Admin Panel "Pre-Generate Analyses" button.
 */
export async function POST(req) {
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  try {
    const body = await req.json();
    const { userEmail, force = true, sport = null, date = null } = body;
    if (!ADMIN_EMAILS.includes(userEmail?.toLowerCase())) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    // Reuse the same GET logic by constructing a fake request with the cron secret
    const fakeUrl = new URL('http://localhost/api/cron/pregenerate-analysis');
    if (force) fakeUrl.searchParams.set('force', 'true');
    if (sport) fakeUrl.searchParams.set('sport', sport);
    if (date)  fakeUrl.searchParams.set('date', date);
    const fakeReq = new Request(fakeUrl.toString(), {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
    });
    return await GET(fakeReq);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
