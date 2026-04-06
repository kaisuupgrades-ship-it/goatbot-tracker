import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300;

// Simple in-memory rate limiter — 5 requests per user per minute
const rateLimitMap = new Map();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(userId) {
  const now = Date.now();
  const key = userId || 'anonymous';
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return true;
  }

  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Clean up old entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_WINDOW * 2) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_BASE    = 'https://api.x.ai/v1';

const SYSTEM_PROMPT = `You are BetOS — a sharp AI sports analyst. You combine verified odds data with live web search to produce honest, grounded analysis with transparent probability estimates.

---
## HONESTY RULES — non-negotiable

- You do NOT have a proprietary pricing model. Never invent "fair odds", "model prices", or claim a statistical model you don't have.
- When the user provides a VERIFIED ODDS block, those numbers are ground truth from a live data feed. Use them exactly as given. Do not search for or invent different odds.
- Every factual claim beyond the verified odds must come from your web search. If you searched and could not find something (betting splits, confirmed starter, line movement), say "not found" — never fill gaps with invented numbers.
- The market-implied probability is pure math from the odds — you may calculate it exactly and state it. Do not present it as a model output.

## ODDS INTEGRITY — CRITICAL
- NEVER fabricate or guess an odds number. If no VERIFIED ODDS block is provided AND your web search does not return a specific, current line from a named sportsbook, write "odds not confirmed" in the pick line — do NOT invent a number.
- Odds sourced from web search expire within minutes and MUST be labeled "per web search" in the pick line. Example: "Scottie Scheffler Top 10 Finish -245 (per DraftKings, verify before betting)"
- Sanity-check every odds figure before using it. If a top-ranked player shows a line that looks too good (e.g., a world #1 golfer at -110 for a top-10 finish when -200 to -300 is typical), that number is almost certainly wrong — do NOT use it. State instead: "Current line not confirmed - market implied probability unavailable. Verify on your sportsbook."
- The end of EVERY response must include this exact line on its own: "[!] ODDS DISCLAIMER: Lines sourced via AI web search. Always verify current odds on your sportsbook before placing any bets."

---
## DATE VERIFICATION — do this first

Before any analysis, determine: what date is this pick for?
- If the game is tomorrow, EVERY search query must include the EXACT date (e.g., "MLB April 6 2026 starting pitchers") - never use "today" or "tomorrow" in search queries.
- Confirm starting pitchers, goalies, and key lineup decisions are for the TARGET DATE specifically — rotations change daily. If unconfirmed, flag it explicitly.
- If odds or starters are not yet posted for the target date, state that clearly rather than using proxies from a different date.

---
## HOW TO BUILD THE PROBABILITY ESTIMATE

This is the analytical core — do it transparently:

1. Calculate market-implied probability exactly from the verified ML odds:
   - If ML > 0: implied = 100 / (ML + 100)
   - If ML < 0: implied = |ML| / (|ML| + 100)
   This is your baseline — the market's consensus.

2. Search for factors that legitimately shift probability from consensus:
   - Line movement: where did this line open vs. where is it now? Which direction? Sharp or public-driven?
   - Injury/lineup news from beat reporters — does the market appear to have priced it in already?
   - Public betting % vs. line movement direction — 70%+ public on one side but line moved the other = sharp signal
   - Situational edges: confirmed starter matchup, rest/travel disparity, weather for outdoor games, B2B fatigue

3. For each real factor found, estimate the probability adjustment (1-5 percentage points per meaningful factor is realistic — do not make wild swings). Show the reasoning.

4. State your final estimate as a RANGE (e.g. "39-43%"), not false single-digit precision.
   If search finds nothing meaningful, stay near market implied and say so honestly.

---
## SPORT-SPECIFIC FACTORS TO SEARCH

MLB: Confirmed SP and recent form (xFIP, BB%, K%), bullpen arms used in last 2 days, lineup vs. pitcher handedness, weather (wind direction/speed especially at Coors/Wrigley), temperature (85F+ = ball carries, sub-50F = suppressed offense).

NBA: Injuries with on/off net rating impact, B2B or 3-in-4 schedule fatigue, pace matchup, playoff positioning / rest risk, travel distance and timezone.

NHL: Confirmed goalie and recent save%, 5v5 xGF%, special teams PP% vs PK% matchup, B2B or rest disparity, playoff race urgency vs. already eliminated teams.

Soccer: Expected XI and rotation risk from fixture congestion, xG/xGA profiles, set-piece edge, suspensions to key creators or CBs.

---
## RED FLAGS — automatically lower confidence if present

- Major injury listed as GTD with no line movement reflecting it
- Line has moved more than 1 point AGAINST the pick since open (value likely gone)
- Edge is driven entirely by narrative or public hype, not a real data signal
- Edge depends on a small-sample trend with no underlying causal mechanism

---
## OUTPUT FORMAT — follow this exactly

THE PICK: [Team Name + Bet Type + Odds + Book] — one line only, e.g. "Pittsburgh Pirates ML +102 at DraftKings"

EDGE BREAKDOWN: [2-3 sentences. Start with what the market implies, then explain what your search found that shifts it. Quote specific numbers: line movement from X to Y, confirmed injury source, actual betting split %. If evidence is weak, say so.]

KEY FACTORS:
1. [Best verified finding — line movement with numbers, confirmed injury from beat reporter, or actual split %]
2. [Second finding — matchup angle, starter quality, situational spot with real context]
3. [Third factor — weather, rest, travel, or motivation — grounded in search results]

CONFIDENCE: HIGH
(exactly one of: LOW / MEDIUM / HIGH / ELITE — based on quality of evidence found, not intuition)

EDGE SCORE: 7/10
(X/10 — honest score of how strong the actual evidence is)

BetOS PROBABILITY ESTIMATE: 39-43%
(Format exactly: "Market implied: X%. Adjusted to Y-Z% based on: [1-2 sentences showing what factors moved it and why, with specific numbers]." Maximum ~5 point adjustment per factor. If no strong evidence found, stay near market implied and say so.)

RECORD IMPACT: [One sentence on unit sizing relative to confidence]

Formatting:
- THE PICK line contains ONLY the bet — no dates, no extra text
- CONFIDENCE on its own line as "CONFIDENCE: HIGH"
- No markdown asterisks, no bold, numbered lists only
- Be decisive — pick a side and defend it with what you actually found`;

const FRESHNESS_SYSTEM = `You are a sports news checker. You will be given a pre-generated BetOS analysis and must quickly check if anything significant has changed since it was written that would materially affect the pick.

Search ONLY for:
1. New injuries or lineup changes announced after the analysis was written
2. Significant line movement (more than 1 point on spread, more than 10 cents on ML)
3. Weather changes for outdoor games
4. Starting pitcher/goalie changes

If you find material changes, output:
[!] UPDATE: [2-3 sentences describing what changed and how it affects the pick]

If nothing material has changed, output exactly:
[ok] No material changes found since this analysis was generated.

Keep it short. Do not rewrite the full analysis.`;

function parseResponsesOutput(resp) {
  if (resp.output) {
    const texts = resp.output
      .filter(item => item.type === 'message')
      .flatMap(msg => (msg.content || []).filter(c => c.type === 'output_text').map(c => c.text));
    if (texts.length) return texts.join('\n\n');
    const anyText = resp.output.flatMap(item => {
      if (item.content) return item.content.filter(c => c.text).map(c => c.text);
      if (item.text) return [item.text];
      return [];
    });
    if (anyText.length) return anyText.join('\n\n');
  }
  if (resp.choices?.[0]?.message?.content) return resp.choices[0].message.content;
  return JSON.stringify(resp).substring(0, 500);
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return { response: res, timedOut: false };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { response: null, timedOut: true };
    throw err;
  }
}

/**
 * Try to find a pre-generated analysis in game_analyses table.
 * Matches by looking for team names from the cache appearing in the user's prompt.
 * Returns the matching row or null.
 */
async function findCachedAnalysis(prompt, gameDate) {
  try {
    const dateStr = gameDate || new Date().toISOString().split('T')[0];

    // Fetch all of today's cached analyses
    const { data: rows } = await supabase
      .from('game_analyses')
      .select('*')
      .eq('game_date', dateStr)
      .order('updated_at', { ascending: false });

    if (!rows?.length) return null;

    const promptLower = prompt.toLowerCase().replace(/[^a-z0-9 ]/g, ' ');

    for (const row of rows) {
      // Extract the last word of each team name (e.g. "Bruins" from "Boston Bruins")
      const homeWords = row.home_team.toLowerCase().split(' ');
      const awayWords = row.away_team.toLowerCase().split(' ');
      const homeLast  = homeWords[homeWords.length - 1];
      const awayLast  = awayWords[awayWords.length - 1];

      // Also try the full team name (normalized)
      const homeNorm = row.home_team.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();
      const awayNorm = row.away_team.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim();

      const homeMatch = promptLower.includes(homeLast) || promptLower.includes(homeNorm);
      const awayMatch = promptLower.includes(awayLast) || promptLower.includes(awayNorm);

      if (homeMatch && awayMatch) return row;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Run a quick freshness check on a cached analysis.
 * Uses Grok-3 (fast) to search for any material changes since generated_at.
 * Returns a short delta string, or null on failure.
 */
async function runFreshnessCheck(cached) {
  const ageMin = Math.round((Date.now() - new Date(cached.updated_at).getTime()) / 60000);
  const prompt = `This BetOS analysis was generated ${ageMin} minutes ago for ${cached.away_team} @ ${cached.home_team} (${cached.sport.toUpperCase()}) on ${cached.game_date}.

Pre-generated analysis:
${cached.analysis.substring(0, 800)}...

Check quickly: has anything material changed in the last ${ageMin} minutes? (injuries, line movement, lineup news, weather)`;

  const xaiKey = process.env.XAI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;

  // Try Grok-3 first (fast + web search)
  if (xaiKey) {
    try {
      const { response, timedOut } = await fetchWithTimeout(
        `${XAI_BASE}/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${xaiKey}` },
          body: JSON.stringify({
            model: 'grok-3',
            messages: [
              { role: 'system', content: FRESHNESS_SYSTEM },
              { role: 'user', content: prompt },
            ],
            search_parameters: { mode: 'on' },
            temperature: 0.3,
            max_tokens: 300,
          }),
        },
        20_000,
      );
      if (!timedOut && response?.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch { /* fall through */ }
  }

  // Fallback: Claude web search
  if (claudeKey) {
    try {
      const { response, timedOut } = await fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-opus-4-6',
            system: FRESHNESS_SYSTEM,
            tools: [{ type: 'web_search_20260209' }],
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 400,
            temperature: 1,
          }),
        },
        20_000,
      );
      if (!timedOut && response?.ok) {
        const data = await response.json();
        const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
        return text || null;
      }
    } catch { /* fall through */ }
  }

  return null;
}

// ── Prompt-level cache (survives browser tab switches / client disconnects) ────
// Saves the full AI result for ~15 min so retries after a tab switch are instant.

function promptCacheKey(prompt) {
  // Use the first 300 chars as a cache key (unique enough for dedup, stable across retries)
  return prompt.trim().slice(0, 300);
}

async function findPromptCache(key) {
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString(); // 15 min TTL
    const { data } = await supabase
      .from('prompt_cache')
      .select('result, model, created_at')
      .eq('prompt_key', key)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    return data || null;
  } catch { return null; }
}

async function savePromptCache(key, result, model) {
  try {
    await supabase.from('prompt_cache').insert([{ prompt_key: key, result, model }]);
    // Cleanup: delete entries older than 1 hour to keep the table lean
    await supabase.from('prompt_cache')
      .delete()
      .lt('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  } catch { /* best-effort */ }
}

/**
 * Store a freshly-generated analysis in the cache for future users.
 */
async function cacheAnalysis(sport, homeTeam, awayTeam, gameDate, analysis, model) {
  try {
    if (!sport || !homeTeam || !awayTeam) return;
    await supabase.from('game_analyses').upsert(
      [{
        sport:       sport.toLowerCase(),
        game_date:   gameDate,
        home_team:   homeTeam,
        away_team:   awayTeam,
        analysis,
        model,
        generated_at: new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      }],
      { onConflict: 'sport,game_date,home_team,away_team', ignoreDuplicates: false }
    );
  } catch { /* caching is best-effort */ }
}

export async function POST(req) {
  // Rate limiting check
  const userId = req.headers.get('x-user-id') || req.ip || 'anonymous';
  if (!checkRateLimit(userId)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Please wait a minute.' }, { status: 429 });
  }

  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const xaiHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${XAI_API_KEY}`,
  };
  const claudeHeaders = {
    'Content-Type': 'application/json',
    'x-api-key': claudeKey,
    'anthropic-version': '2023-06-01',
  };

  try {
    const body = await req.json();
    const { prompt, gameDate, sport, homeTeam, awayTeam } = body;
    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const targetDate = gameDate || new Date().toISOString().split('T')[0];

    // ── Prompt-level cache (survives browser tab switches) ────────────────────
    // If the server already completed this exact analysis (even if the browser
    // killed the client connection), return the result instantly on retry.
    const pKey = promptCacheKey(prompt);
    const promptHit = await findPromptCache(pKey);
    if (promptHit) {
      console.log(`[goatbot] Prompt cache HIT - returning saved result instantly`);
      return NextResponse.json({ result: promptHit.result, model: promptHit.model, cached: true });
    }

    // ── Game-analyses cache: pre-generated team matchup analysis ─────────────
    // Max age: 4 hours. After that, we re-run a full analysis and refresh the cache.
    const CACHE_MAX_AGE_MS    = 4 * 60 * 60 * 1000;
    // If cache is under 30 min old, trust it completely - no freshness check needed.
    // This covers the "just ran pregenerate" case: user gets instant results.
    const FRESHNESS_SKIP_MS   = 30 * 60 * 1000;
    const cached = await findCachedAnalysis(prompt, targetDate);

    if (cached) {
      const ageMs = Date.now() - new Date(cached.updated_at).getTime();

      if (ageMs < CACHE_MAX_AGE_MS) {
        console.log(`[goatbot] Cache HIT for ${cached.away_team}@${cached.home_team}, age=${Math.round(ageMs/60000)}min`);

        const ageLabel = ageMs < 60000
          ? 'just now'
          : `${Math.round(ageMs / 60000)} min ago`;

        let result = cached.analysis;

        if (ageMs < FRESHNESS_SKIP_MS) {
          // ── Very fresh cache (< 30 min) — return instantly, no AI check ────
          result += `\n\n[Analysis generated ${ageLabel} . BetOS AI]`;
        } else {
          // ── Older cache (30 min-4 hr) — run quick news delta check ──────────
          const delta = await runFreshnessCheck(cached);
          if (delta && !delta.includes('No material changes')) {
            result += `\n\n---\n${delta}`;
          }
          result += `\n\n[Analysis pre-generated ${ageLabel} . BetOS AI . Freshness checked]`;
        }

        return NextResponse.json({ result, model: 'BetOS AI (cached)', cached: true });
      }

      // Cache is stale — fall through to fresh generation, but we'll update it
      console.log(`[goatbot] Cache STALE for ${cached.away_team}@${cached.home_team} (${Math.round(ageMs/3600000)}h old)`);
    } else {
      console.log(`[goatbot] Cache MISS for prompt starting: "${prompt.substring(0, 60)}..."`);
    }

    // ── No cache (or stale) — run full AI analysis ────────────────────────────

    // ── Tier 1: Claude Opus 4.6 + live web search (90s) ──────────────────────
    if (claudeKey) {
      try {
        const { response, timedOut } = await fetchWithTimeout(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: claudeHeaders,
            body: JSON.stringify({
              model: 'claude-opus-4-6',
              system: SYSTEM_PROMPT,
              tools: [{ type: 'web_search_20260209' }],
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 4000,
              temperature: 1,
            }),
          },
          90_000,
        );
        if (!timedOut && response?.ok) {
          const data = await response.json();
          const textBlocks = (data.content || [])
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n\n')
            .trim();
          if (textBlocks) {
            cacheAnalysis(sport, homeTeam, awayTeam, targetDate, textBlocks, 'BetOS AI');
            savePromptCache(pKey, textBlocks, 'BetOS AI');
            return NextResponse.json({ result: textBlocks, model: 'BetOS AI' });
          }
        }
        if (timedOut) console.log('[goatbot] Claude Opus + search timed out after 90s');
        else console.log('[goatbot] Claude Opus returned', response?.status);
      } catch (err) {
        console.log('[goatbot] Claude Opus error:', err.message);
      }
    }

    // ── Tier 2: grok-4 + web search (90s) ────────────────────────────────────
    if (XAI_API_KEY) {
      try {
        const { response, timedOut } = await fetchWithTimeout(
          `${XAI_BASE}/responses`,
          {
            method: 'POST',
            headers: xaiHeaders,
            body: JSON.stringify({
              model: 'grok-4',
              instructions: SYSTEM_PROMPT,
              input: [{ role: 'user', content: prompt }],
              tools: [{ type: 'web_search' }],
              max_output_tokens: 3000,
            }),
          },
          90_000,
        );
        if (!timedOut && response?.ok) {
          const data = await response.json();
          const result = parseResponsesOutput(data);
          cacheAnalysis(sport, homeTeam, awayTeam, targetDate, result, 'BetOS AI');
          savePromptCache(pKey, result, 'BetOS AI');
          return NextResponse.json({ result, model: 'BetOS AI' });
        }
        if (timedOut) console.log('[goatbot] grok-4 timed out after 90s');
        else console.log('[goatbot] grok-4 returned', response?.status);
      } catch (err) {
        console.log('[goatbot] grok-4 error:', err.message);
      }

      // ── Tier 3: grok-3 (60s) ─────────────────────────────────────────────
      try {
        const { response, timedOut } = await fetchWithTimeout(
          `${XAI_BASE}/chat/completions`,
          {
            method: 'POST',
            headers: xaiHeaders,
            body: JSON.stringify({
              model: 'grok-3',
              messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: prompt },
              ],
              temperature: 0.7,
              max_tokens: 3000,
            }),
          },
          60_000,
        );
        if (!timedOut && response?.ok) {
          const data = await response.json();
          const result = data.choices[0].message.content;
          cacheAnalysis(sport, homeTeam, awayTeam, targetDate, result, 'BetOS AI');
          savePromptCache(pKey, result, 'BetOS AI');
          return NextResponse.json({ result, model: 'BetOS AI' });
        }
        if (timedOut) console.log('[goatbot] grok-3 timed out after 60s');
        else console.log('[goatbot] grok-3 returned', response?.status);
      } catch (err) {
        console.log('[goatbot] grok-3 error:', err.message);
      }
    }

    // ── Tier 4: Claude Opus 4.6 no search (last resort, 45s) ─────────────────
    if (claudeKey) {
      try {
        const { response, timedOut } = await fetchWithTimeout(
          'https://api.anthropic.com/v1/messages',
          {
            method: 'POST',
            headers: claudeHeaders,
            body: JSON.stringify({
              model: 'claude-opus-4-6',
              system: SYSTEM_PROMPT + '\n\n[NOTE: Live web search is unavailable for this request. Base analysis on the provided odds data and training knowledge. Flag any facts that should be verified live.]',
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 3000,
              temperature: 0.7,
            }),
          },
          45_000,
        );
        if (!timedOut && response?.ok) {
          const data = await response.json();
          const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
          if (text) {
            savePromptCache(pKey, text, 'BetOS AI');
            return NextResponse.json({ result: text, model: 'BetOS AI' });
          }
        }
      } catch { /* fall through */ }
    }

    return NextResponse.json({ error: 'All AI providers timed out or failed. Please try again.' }, { status: 503 });
  } catch (err) {
    console.error('BetOS API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
