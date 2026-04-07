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
const PROMPT_VERSION = 'v2.1';

// Build the analysis system prompt. When hasVerifiedOdds=true (odds came from
// The Odds API premium feed), we skip blanket "verify before betting" disclaimers
// since those lines are already confirmed from the live feed.
function buildAnalysisSystem(hasVerifiedOdds = false) {
  const oddsIntegrity = hasVerifiedOdds
    ? `ODDS INTEGRITY — non-negotiable:
- A "Known odds context" block is provided below. Those numbers come from The Odds API — a VERIFIED premium live feed. Use them as the authoritative line. Do NOT override them.
- If searching for additional context, ONLY cite specific numbers from named sources. Never guess or interpolate.
- Sanity-check every number: a heavy favorite at +EV odds is a red flag (e.g. -300 team priced at -110). Flag anything suspicious with a factual note.
- The Known odds context numbers are already verified — no "verify before betting" label needed for those. Label any supplemental web-searched odds as "(web search)".`
    : `ODDS INTEGRITY — non-negotiable:
- If a "Known odds context" block is provided below, those numbers come from a VERIFIED live feed — use them as the authoritative line. Do NOT override them.
- If searching for odds, ONLY cite specific numbers from named sources. Never guess or interpolate.
- Sanity-check every number: a heavy favorite at +EV odds is a red flag (e.g. -300 team priced at -110). Flag anything suspicious with "verify before betting."
- Label all web-searched odds as "(web search — verify on your book)".
- If odds are unconfirmed, write: "[Team] — [Bet Type] — odds not confirmed, verify before betting."`;

  const disclaimer = hasVerifiedOdds
    ? `✅ ODDS SOURCE: Lines provided by The Odds API (verified premium feed). Always confirm final odds on your sportsbook before placing any bet.`
    : `⚠️ ODDS DISCLAIMER: Lines sourced via AI web search. Always verify current odds on your sportsbook before placing any bets.`;

  return `You are BetOS — an elite sharp sports betting analyst. This analysis will be cached and served to thousands of users, so it must be comprehensive, data-rich, and genuinely sharp. Treat every matchup as if a professional bettor with a $50K bankroll is relying on your output.

Use live web search aggressively to gather ALL of the following before writing a single word:

REQUIRED RESEARCH (use web search for each item):
1. Confirmed starters/lineups for this specific date (starting pitcher, goalie, confirmed batting order changes, key INEs)
2. Current moneyline, spread, total from at least 3 major books (DraftKings, FanDuel, BetMGM, Caesars, DraftKings)
3. Opening line vs current line — direction and magnitude of movement
4. Injury/availability reports confirmed by beat reporters or official team sources
5. Recent form — last 5–10 games for each team (record, run/goal differential, any slumps)
6. Head-to-head record this season AND historically (last 3 years at minimum)
7. Home/away splits for each team (road record, home record, relevant stat differences)
8. Situational edges: rest advantage, travel fatigue, back-to-back, schedule spot
9. Weather (outdoor sports): wind speed/direction, temperature, precipitation impact on O/U
10. Public betting percentage and sharp money signals if available (any steam moves, CLV signals)
11. ATS record (against the spread) for both teams — season-long and recent
12. Over/Under record for both teams — season-long and in this specific matchup type
13. Pitcher ERA/WHIP/K-rate at home vs away; bullpen ERA last 7 days (MLB specific)
14. Goalie save %, goals against average, last 3 starts (NHL specific)
15. Pace of play, offensive/defensive efficiency ratings (NBA specific)

---
${oddsIntegrity}

---
Output format — follow EXACTLY (no markdown asterisks, no bullet points replaced by dashes inside sections):

THE PICK: [Team + Bet Type + Odds (source) + Book] — one sharp decisive recommendation

ALTERNATE ANGLES: [1–2 secondary bets worth considering with odds — e.g. a same-game parlay leg, a total, or a first-half play]

EDGE BREAKDOWN: [3–4 sentences. What the market is pricing in, what you found that the market may be under/over-weighting. Cite specific stats and numbers found in your research.]

KEY FACTORS:
1. [Starter/lineup confirmed finding with specific stats]
2. [Recent form or H2H angle with concrete numbers]
3. [Situational or contextual edge — rest, travel, weather, motivation]
4. [Betting market signal — line movement, public %, steam, CLV opportunity]

LINE MOVEMENT: [Opening line → current line. Direction: sharp-driven or public-driven? Any steam?]

ATS/OU TRENDS: [ATS record for each team this season and recently. O/U trend relevant to this game.]

INJURY REPORT: [Any confirmed absences or questionable statuses affecting the pick, or "None reported as of search time."]

CONFIDENCE: [LOW / MEDIUM / HIGH / ELITE]

EDGE SCORE: [X/10]

BetOS WIN PROBABILITY: [Market implied: X%. BetOS adjusted: Y–Z%. Based on: specific reasoning from your research.]

UNIT SIZING: [Recommended unit size 0.5u–3u and brief justification tied to confidence level.]

${disclaimer}

Rules: Be decisive. Cite specific numbers from your web searches. If you cannot verify something, say so — never fabricate. This analysis will be displayed to users as BetOS's official pre-game breakdown.`;
}

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

// Maximum games to process per sport per run. Keeps total processing within Vercel's 5-min limit.
// With grokTimeout=120s and BATCH_SIZE=4: 2 batches × 120s = 240s + ~30s overhead = ~270s per sport.
// 8 games = exactly 2 batches of 4, fitting safely within the 300s Vercel budget.
const MAX_GAMES_PER_SPORT = 8;

// ── generateAnalysis ──────────────────────────────────────────────────────────
// mode: 'full' = complete analysis (new games)
//       'refresh' = lightweight freshness check (existing analyses, low tokens)
async function generateAnalysis(sport, homeTeam, awayTeam, gameDate, oddsContext, performanceContext, mode = 'full') {
  const isRefresh = mode === 'refresh';

  const prompt = isRefresh
    ? `Quick freshness check — ${sport.toUpperCase()} on ${gameDate}: ${awayTeam} @ ${homeTeam}${oddsContext ? `\nCurrent odds reference: ${oddsContext.split('\n')[0]}` : ''}\n\nAny lineup changes, significant line movement, or major news in the last 4 hours?`
    : `Generate a comprehensive BetOS sharp analysis for this ${sport.toUpperCase()} matchup on ${gameDate}:

MATCHUP: ${awayTeam} (Away) @ ${homeTeam} (Home)
DATE: ${gameDate}
${oddsContext ? `\nKNOWN ODDS (verified live feed — use these exact numbers, do NOT override):\n${oddsContext}` : ''}
${performanceContext ? `\nBetOS HISTORICAL PERFORMANCE CONTEXT (use to calibrate confidence):\n${performanceContext}` : ''}

TASK: Perform a thorough sharp analysis. Use web search to research ALL required items in your instructions before writing your output. This analysis will be cached and shown to users as BetOS's official pre-game breakdown — make it comprehensive and data-rich.

Cover all output sections: THE PICK, ALTERNATE ANGLES, EDGE BREAKDOWN, KEY FACTORS (all 4), LINE MOVEMENT, ATS/OU TRENDS, INJURY REPORT, CONFIDENCE, EDGE SCORE, BetOS WIN PROBABILITY, UNIT SIZING, and the disclaimer.`;

  const hasVerifiedOdds = !isRefresh && !!(oddsContext && oddsContext.includes('The Odds API'));
  const systemToUse   = isRefresh ? QUICK_REFRESH_SYSTEM : buildAnalysisSystem(hasVerifiedOdds);
  // Full: rich comprehensive analysis — 3500 tokens gives ~700–900 words which covers all
  // required sections. This is "expensive AI once, serve many users from cache."
  // Refresh: lightweight freshness check only (400 tokens, 30s).
  const maxTokens     = isRefresh ? 400 : 3500;
  // Full analyses: 120s — baseball research (starting pitchers, ERA/WHIP, bullpen, splits) requires
  // more web search calls than other sports and was consistently timing out at 90s for MLB.
  // Refresh: 30s (lightweight check only).
  const grokTimeout   = isRefresh ? 30_000 : 120_000;
  // NO Claude fallback during bulk runs. One timeout = skip, not retry-with-Claude.
  // Claude is reserved for live user queries (goatbot route) where the UX demands a result.

  const xaiKey = process.env.XAI_API_KEY;

  if (xaiKey) {
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(`${XAI_BASE}/responses`, {
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
    } catch (e) {
      const isTimeout = e.name === 'TimeoutError' || e.name === 'AbortError';
      const msg = isTimeout ? `grok-4 timeout (${grokTimeout / 1000}s)` : `grok-4 fetch error: ${e.message}`;
      console.log(`[pregenerate] ${msg} for ${awayTeam}@${homeTeam}`);
      throw new Error(msg);
    }

    if (!res.ok) {
      // Log actual xAI error status so we can diagnose rate-limits vs auth vs server errors
      let errBody = '';
      try { errBody = await res.text(); } catch { /* ignore */ }
      const msg = `grok-4 HTTP ${res.status}`;
      console.warn(`[pregenerate] ${msg} for ${awayTeam}@${homeTeam}: ${errBody.slice(0, 200)}`);
      throw new Error(msg);
    }

    const data = await res.json();
    const latency = Date.now() - t0;
    // Primary parse: standard Responses API format (type=message / type=output_text)
    const texts = (data.output || [])
      .filter(item => item.type === 'message')
      .flatMap(msg => (msg.content || []).filter(c => c.type === 'output_text').map(c => c.text));
    let text = texts.join('\n\n').trim();
    // Fallback parse: handle alternative output formats (e.g. item.content[].text or item.text)
    if (!text && data.output?.length) {
      const anyTexts = data.output.flatMap(item => {
        if (item.content) return item.content.filter(c => c.text).map(c => c.text);
        if (item.text) return [item.text];
        return [];
      });
      text = anyTexts.join('\n\n').trim();
    }
    // Last resort: OpenAI chat-completions shape
    if (!text && data.choices?.[0]?.message?.content) {
      text = data.choices[0].message.content.trim();
    }
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
    const msg = `grok-4 empty response`;
    console.warn(`[pregenerate] ${msg} for ${awayTeam}@${homeTeam} — output keys: ${JSON.stringify(Object.keys(data))}, output length: ${data.output?.length}`);
    throw new Error(msg);
  }

  return null; // only reached when XAI_API_KEY is not set — no Claude fallback in bulk mode
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

    console.log(`[pregenerate] ${sport.toUpperCase()}: ${gamesToProcess.length} games to process (batches of 4, 90s timeout each, 3500 tokens, no Claude fallback)`);

    // ── Process games in PARALLEL batches of 4 ──────────────────────────────
    // Upgraded for "expensive AI once, serve many" model:
    //   • Grok timeout: 55s → 90s   (deep web search + 3500 tokens needs more time)
    //   • max_output_tokens: 1600 → 3500 (comprehensive multi-section analysis)
    //   • Batch size: 6 → 4         (fewer in parallel to avoid xAI rate limits at high tokens)
    //   • No Claude fallback         (skip on timeout, re-runs on next cron cycle)
    // Expected: 10 games / 4 per batch = 3 batches × 90s = ~270s ≈ 4.5 min per sport
    // With 4-min safety cutoff: processes ~2.6 batches = 10 games safely
    const BATCH_SIZE = 4;
    for (let i = 0; i < gamesToProcess.length; i += BATCH_SIZE) {
      const batch = gamesToProcess.slice(i, i + BATCH_SIZE);

      // Safety cutoff: stop with 60s buffer before Vercel's hard 5-min limit
      const elapsed = Date.now() - started;
      if (elapsed > 240_000) { // 4 min
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

          // Parse structured sections from the richer v2.0 analysis output
          const pickM   = result.text.match(/THE PICK[:\s]+([^\n]{5,200})/i);
          const confM   = result.text.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
          const edgeM   = result.text.match(/EDGE SCORE[:\s]+(\d+\/\d+|\d+)/i);
          const altM    = result.text.match(/ALTERNATE ANGLES[:\s]+([^\n]{5,300})/i);
          const lineM   = result.text.match(/LINE MOVEMENT[:\s]+([^\n]{5,300})/i);
          const unitM   = result.text.match(/UNIT SIZING[:\s]+([^\n]{5,200})/i);
          const probM   = result.text.match(/BetOS WIN PROBABILITY[:\s]+([^\n]{5,300})/i);

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
              prediction_edge: edgeM?.[1]?.trim() || null,
              alternate_angles: altM?.[1]?.trim() || null,
              line_movement:   lineM?.[1]?.trim() || null,
              unit_sizing:     unitM?.[1]?.trim() || null,
              win_probability: probM?.[1]?.trim() || null,
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
