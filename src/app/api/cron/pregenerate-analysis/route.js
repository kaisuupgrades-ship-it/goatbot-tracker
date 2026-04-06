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
const PROMPT_VERSION = 'v1.1';

const ANALYSIS_SYSTEM = `You are BetOS — a sharp AI sports analyst. Produce a concise but complete pre-game analysis report for the given matchup. Use live web search to gather:
- Starting pitcher/goalie/lineup news confirmed for this specific date
- Current moneyline, spread, and total odds from major books
- Line movement since open (direction and key movers)
- Injury/availability reports from beat reporters
- Situational angles: rest, travel, weather (outdoor), motivation

---
ODDS INTEGRITY — non-negotiable:
- A "Known odds context" block may be provided below. If it is, those numbers come from a verified live feed — use them exactly. Do NOT override them with web-searched numbers.
- If no odds context is provided, search for current odds. ONLY use a specific number you actually found from a named source (DraftKings, FanDuel, BetMGM, etc.). If your search returns no clear current line, write "line not confirmed" in the pick — never guess or interpolate.
- Sanity-check every odds figure before writing it. Examples of numbers that should raise red flags: a heavy favorite priced at +EV odds (e.g. world #1 golfer at -110 for a top-10 when the market is closer to -250), a spread that seems too large or small relative to the matchup. If something looks off, say "verify before betting" in the pick.
- Label all web-searched odds as "(per web search — verify before betting)".
- THE PICK line MUST use only verified numbers. If odds are unconfirmed, write: "[Team/Player] — [Bet Type] — odds not confirmed, verify on your sportsbook"

Output format — follow exactly:

THE PICK: [Team + Bet Type + Odds (source) + Book] — your sharpest recommended play

EDGE BREAKDOWN: [2–3 sentences. What the market implies, what you found that shifts it. Specific numbers only.]

KEY FACTORS:
1. [Best verified finding with specific numbers]
2. [Matchup or starter angle with real context]
3. [Situational factor — weather/rest/travel/motivation]

CONFIDENCE: [LOW / MEDIUM / HIGH / ELITE]

EDGE SCORE: [X/10]

BetOS PROBABILITY ESTIMATE: [Market implied: X%. Adjusted to Y–Z% based on: brief reasoning.]

RECORD IMPACT: [One sentence on unit sizing.]

⚠️ ODDS DISCLAIMER: Lines sourced via AI web search. Always verify current odds on your sportsbook before placing any bets.

Rules: No markdown asterisks. No invented numbers. If you cannot verify a stat or odds figure, say so explicitly. Be decisive.`;

// includeAll=true: return every game on that date regardless of state (used for
// admin manual runs where the admin picks an explicit date — games may already be
// final, but we still want to cache analyses for them).
// includeAll=false (default, cron runs): only return pre/in-progress games.
async function fetchTodaysGames(sport, dateStr, includeAll = false) {
  const path = SPORT_PATHS[sport];
  if (!path) return [];
  try {
    const res = await fetch(`${ESPN_BASE}/${path}/scoreboard?dates=${dateStr}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15_000), // raised from 8s — ESPN can be slow
    });
    if (!res.ok) {
      console.warn(`[pregenerate] ESPN ${sport} returned ${res.status} for ${dateStr}`);
      return [];
    }
    const data = await res.json();
    const all = data.events || [];

    const filtered = includeAll
      ? all // admin date-pick: include all games (pre, in, post) on that date
      : all.filter(ev => {
          const comp  = ev.competitions?.[0];
          const state = comp?.status?.type?.state;
          if (state === 'pre') return true;
          if (state === 'in' && comp?.date) {
            const started = new Date(comp.date).getTime();
            const elapsed = Date.now() - started;
            return elapsed < 90 * 60 * 1000; // in-progress < 90 min
          }
          return false;
        });

    console.log(`[pregenerate] ESPN ${sport.toUpperCase()} ${dateStr}: ${all.length} total events, ${filtered.length} included (includeAll=${includeAll})`);
    return filtered;
  } catch (e) {
    console.warn(`[pregenerate] ESPN fetch failed for ${sport}:`, e.message);
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

// ── Quick-refresh system prompt (used when a fresh analysis already exists) ───
// Lightweight: web search only, no full re-analysis, cheap on tokens.
const QUICK_REFRESH_SYSTEM = `You are BetOS — a sharp sports analyst performing a quick data refresh on a pre-existing analysis. Do NOT re-write the full analysis. Only check for recent changes that would materially affect the pick.

Search ONLY for:
1. Lineup/starter changes announced in the last 4 hours (confirmed SP, goalie, key injuries)
2. Significant line movement (more than 10 cents ML or 1 point spread since open)
3. Any major news (suspensions, weather upgrades, trade deadline moves)

If nothing significant changed: respond with exactly "NO MATERIAL CHANGE" on the first line, then 1 sentence summary.
If something changed: respond with "UPDATE NEEDED" on the first line, then a revised THE PICK line and 2-sentence explanation.

Keep response under 150 words. Do NOT repeat prior analysis. Be fast and factual.`;

// Maximum games to process per sport per run. Prevents timeout on heavy slates (MLB 15+ games).
const MAX_GAMES_PER_SPORT = 10;

// ── generateAnalysis ──────────────────────────────────────────────────────────
// mode: 'full' = complete analysis (new games)
//       'refresh' = lightweight freshness check (existing analyses, low tokens)
async function generateAnalysis(sport, homeTeam, awayTeam, gameDate, oddsContext, performanceContext, mode = 'full') {
  const isRefresh = mode === 'refresh';

  const prompt = isRefresh
    ? `Quick freshness check — ${sport.toUpperCase()} on ${gameDate}: ${awayTeam} @ ${homeTeam}${oddsContext ? `\nCurrent odds reference: ${oddsContext.split('\n')[0]}` : ''}\n\nAny lineup changes, significant line movement, or major news in the last 4 hours?`
    : `Analyze this ${sport.toUpperCase()} matchup for ${gameDate}:

${awayTeam} @ ${homeTeam}
${oddsContext ? `\nKnown odds context:\n${oddsContext}` : ''}
${performanceContext || ''}

Provide a full BetOS sharp analysis report. Search for confirmed lineups/starters, current odds and line movement, injury reports, and any situational edges. Pick the sharpest play.`;

  const systemToUse   = isRefresh ? QUICK_REFRESH_SYSTEM : ANALYSIS_SYSTEM;
  const maxTokens     = isRefresh ? 400 : 1600;   // refresh = tiny; full = capped lower than before
  const grokTimeout   = isRefresh ? 30_000 : 55_000; // fail fast — no waiting 90s
  // NO Claude fallback during bulk runs. One timeout = skip, not retry-with-Claude.
  // Claude is reserved for live user queries (goatbot route) where the UX demands a result.

  const xaiKey = process.env.XAI_API_KEY;

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
          instructions: systemToUse,
          input: [{ role: 'user', content: prompt }],
          tools: [{ type: 'web_search' }],
          max_output_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(grokTimeout),
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
          mode,
          model: 'BetOS AI',
          model_used: 'grok-4',
          provider: 'xai',
          was_fallback: false,
          latency_ms: latency,
          tokens_in: data.usage?.input_tokens || null,
          tokens_out: data.usage?.output_tokens || null,
          system_prompt: systemToUse,
          user_prompt: prompt,
          prompt_version: PROMPT_VERSION,
        };
      }
    } catch (e) {
      console.log(`[pregenerate] grok-4 ${mode} failed for ${awayTeam}@${homeTeam}:`, e.message);
    }
  }

  return null; // skip — no Claude fallback in bulk mode to protect against cascading timeouts
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

  const generated = [];
  const refreshed = []; // lightweight quick-refresh runs
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

    // When admin picks a specific date, include ALL game states (pre/in/post)
    // because the games for that date may have already finished.
    // Cron-triggered runs only include pre/in-progress games (don't waste tokens on final games).
    const events = await fetchTodaysGames(sport, espnDate, !!dateOverride);
    if (!events.length) continue;

    // Determine trigger source for audit logging
    const triggerSource = sportFilter
      ? 'admin_per_sport'
      : params.get('force') === 'true'
        ? 'admin_manual'
        : new Date().getUTCHours() < 14 ? 'cron_8am' : 'cron_4pm';

    // Build list of games that need analysis
    const gamesToProcess = [];
    for (const event of events) {
      const comps   = event.competitions?.[0]?.competitors || [];
      const homeComp = comps.find(c => c.homeAway === 'home');
      const awayComp = comps.find(c => c.homeAway === 'away');
      if (!homeComp || !awayComp) continue;

      const homeTeam = homeComp.team?.displayName || homeComp.team?.name || '';
      const awayTeam = awayComp.team?.displayName || awayComp.team?.name || '';
      if (!homeTeam || !awayTeam) continue;

      // ── Smart freshness check ─────────────────────────────────────────────
      // Three-tier logic:
      //   SKIP    — analysis updated < 3h ago (still fresh, save tokens)
      //   REFRESH — analysis updated 3–10h ago (quick lightweight update, ~400 tokens)
      //   FULL    — no analysis OR force=true (complete report, ~1600 tokens)
      let gameMode = 'full';
      if (!force) {
        const freshCutoff   = new Date(Date.now() - 3   * 60 * 60 * 1000).toISOString(); // 3 h
        const refreshCutoff = new Date(Date.now() - 10  * 60 * 60 * 1000).toISOString(); // 10 h

        const { data: existing } = await supabase
          .from('game_analyses')
          .select('id, updated_at')
          .eq('sport', sport)
          .eq('game_date', todayStr)
          .ilike('home_team', homeTeam)
          .ilike('away_team', awayTeam)
          .maybeSingle();

        if (existing) {
          if (existing.updated_at > freshCutoff) {
            // Very fresh — skip entirely
            skipped.push(`${awayTeam}@${homeTeam}`);
            continue;
          } else if (existing.updated_at > refreshCutoff) {
            // Getting stale — lightweight refresh only
            gameMode = 'refresh';
          }
          // else: old enough to warrant a full re-analysis
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

      gamesToProcess.push({ homeTeam, awayTeam, oddsContext, gameTime, mode: gameMode });
    }

    if (!gamesToProcess.length) continue;

    // Cap to MAX_GAMES_PER_SPORT so heavy slates (MLB 15+ games) don't blow the timer.
    // Games are naturally ordered by start time so we process the earliest ones first.
    if (gamesToProcess.length > MAX_GAMES_PER_SPORT) {
      console.log(`[pregenerate] ${sport.toUpperCase()}: capping ${gamesToProcess.length} → ${MAX_GAMES_PER_SPORT} games this run`);
      gamesToProcess.splice(MAX_GAMES_PER_SPORT);
    }

    console.log(`[pregenerate] ${sport.toUpperCase()}: ${gamesToProcess.length} games to process (batches of 6, 55s timeout each, no Claude fallback)`);

    // ── Process games in PARALLEL batches of 6 ──────────────────────────────
    // Key timeout fixes vs old code:
    //   • Grok timeout: 90s → 55s  (fail faster)
    //   • No Claude fallback        (saves 80s per failed game)
    //   • Batch size: 3 → 6        (more parallelism, fewer batch boundaries)
    //   • Max 10 games/sport        (hard cap on heavy slates)
    // Expected: 10 games / 6 per batch = 2 batches × 55s = ~110s ≈ 1.8 min per sport
    const BATCH_SIZE = 6;
    for (let i = 0; i < gamesToProcess.length; i += BATCH_SIZE) {
      const batch = gamesToProcess.slice(i, i + BATCH_SIZE);

      // Safety cutoff: stop 60s before Vercel's hard limit
      const elapsed = Date.now() - started;
      if (elapsed > 240_000) { // 4 min (was 4.5 min — extra safety margin)
        console.warn(`[pregenerate] Approaching timeout at ${Math.round(elapsed/1000)}s, stopping ${sport} early`);
        for (const g of gamesToProcess.slice(i)) {
          errors.push(`${g.awayTeam}@${g.homeTeam}: timeout cutoff`);
        }
        break;
      }

      const batchResults = await Promise.allSettled(
        batch.map(async ({ homeTeam, awayTeam, oddsContext, gameTime, mode: gameMode }) => {
          const label = `${awayTeam}@${homeTeam} (${sport.toUpperCase()}) [${gameMode}]`;
          console.log(`[pregenerate] ${gameMode === 'refresh' ? '↻ Refreshing' : '⚡ Generating'}: ${label} ${gameTime}`);

          const result = await generateAnalysis(sport, homeTeam, awayTeam, todayStr, oddsContext, perfContextCache[sport], gameMode);
          if (!result) throw new Error('no AI response');

          // Parse pick/conf/edge from the response
          const pickM = result.text.match(/THE PICK[:\s]+([^\n]{5,120})/i);
          const confM = result.text.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
          const edgeM = result.text.match(/EDGE SCORE[:\s]+(\d+\/\d+)/i);

          // Upsert into game_analyses table
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

          return { label: `${awayTeam}@${homeTeam} (${sport.toUpperCase()})`, mode: gameMode };
        })
      );

      // Collect results from the parallel batch
      for (let j = 0; j < batchResults.length; j++) {
        const r = batchResults[j];
        const g = batch[j];
        if (r.status === 'fulfilled') {
          if (r.value.mode === 'refresh') refreshed.push(r.value.label);
          else generated.push(r.value.label);
        } else {
          errors.push(`${g.awayTeam}@${g.homeTeam}: ${r.reason?.message || 'unknown error'}`);
        }
      }

      // Update progress after each batch
      await writeProgress(sport, 'running');
    }
  }

  const summary = {
    generated:  generated.length,
    refreshed:  refreshed.length,
    skipped:    skipped.length,
    errors:     errors.length,
    games:      [...generated, ...refreshed],
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
