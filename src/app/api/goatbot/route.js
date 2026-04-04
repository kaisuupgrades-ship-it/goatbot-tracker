import { NextResponse } from 'next/server';

export const maxDuration = 60;

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_BASE    = 'https://api.x.ai/v1';

const SYSTEM_PROMPT = `You are BetOS — a sharp AI sports analyst. You combine verified odds data with live web search to produce honest, grounded analysis with transparent probability estimates.

---
## HONESTY RULES — non-negotiable

- You do NOT have a proprietary pricing model. Never invent "fair odds", "model prices", or claim a statistical model you don't have.
- When the user provides a VERIFIED ODDS block, those numbers are ground truth from a live data feed. Use them exactly as given. Do not search for or invent different odds.
- Every factual claim beyond the verified odds must come from your web search. If you searched and could not find something (betting splits, confirmed starter, line movement), say "not found" — never fill gaps with invented numbers.
- The market-implied probability is pure math from the odds — you may calculate it exactly and state it. Do not present it as a model output.

---
## DATE VERIFICATION — do this first

Before any analysis, determine: what date is this pick for?
- If the game is tomorrow, EVERY search query must include the EXACT date (e.g., "MLB April 6 2026 starting pitchers") — never use "today" or "tomorrow" in search queries.
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

3. For each real factor found, estimate the probability adjustment (1–5 percentage points per meaningful factor is realistic — do not make wild swings). Show the reasoning.

4. State your final estimate as a RANGE (e.g. "39–43%"), not false single-digit precision.
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

EDGE BREAKDOWN: [2–3 sentences. Start with what the market implies, then explain what your search found that shifts it. Quote specific numbers: line movement from X to Y, confirmed injury source, actual betting split %. If evidence is weak, say so.]

KEY FACTORS:
1. [Best verified finding — line movement with numbers, confirmed injury from beat reporter, or actual split %]
2. [Second finding — matchup angle, starter quality, situational spot with real context]
3. [Third factor — weather, rest, travel, or motivation — grounded in search results]

CONFIDENCE: HIGH
(exactly one of: LOW / MEDIUM / HIGH / ELITE — based on quality of evidence found, not intuition)

EDGE SCORE: 7/10
(X/10 — honest score of how strong the actual evidence is)

BetOS PROBABILITY ESTIMATE: 39-43%
(Format exactly: "Market implied: X%. Adjusted to Y–Z% based on: [1–2 sentences showing what factors moved it and why, with specific numbers]." Maximum ~5 point adjustment per factor. If no strong evidence found, stay near market implied and say so.)

RECORD IMPACT: [One sentence on unit sizing relative to confidence]

Formatting:
- THE PICK line contains ONLY the bet — no dates, no extra text
- CONFIDENCE on its own line as "CONFIDENCE: HIGH"
- No markdown asterisks, no bold, numbered lists only
- Be decisive — pick a side and defend it with what you actually found`;

function parseResponsesOutput(resp) {
  // New /v1/responses format
  if (resp.output) {
    const texts = resp.output
      .filter(item => item.type === 'message')
      .flatMap(msg => (msg.content || []).filter(c => c.type === 'output_text').map(c => c.text));
    if (texts.length) return texts.join('\n\n');
    // Fallback: any text content
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

export async function POST(req) {
  if (!XAI_API_KEY) {
    return NextResponse.json({ error: 'XAI_API_KEY not configured on server. Add it to .env.local' }, { status: 500 });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Use /v1/responses with grok-4 for live web search
    const payload = {
      model: 'grok-4',
      instructions: SYSTEM_PROMPT,
      input: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search' }],
      max_output_tokens: 2000,
    };

    const response = await fetch(`${XAI_BASE}/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      // Fallback to grok-3 on any failure (including 410 Gone, 404, 400, 5xx)
      // grok-4 /responses may be deprecated — grok-3 /chat/completions is always reliable
      const shouldFallback = response.status >= 400; // fall back on ANY non-2xx
      if (shouldFallback) {
        const fallback = await fetch(`${XAI_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${XAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'grok-3',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: prompt },
            ],
            temperature: 0.7,
            max_tokens: 2000,
          }),
        });
        if (fallback.ok) {
          const fbData = await fallback.json();
          return NextResponse.json({ result: fbData.choices[0].message.content, model: 'grok-3' });
        }
      }

      // Last resort: Claude (no web search, but still analytical)
      const claudeKey = process.env.ANTHROPIC_API_KEY;
      if (claudeKey) {
        try {
          const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({
              model: 'claude-sonnet-4-5',
              system: SYSTEM_PROMPT + '\n\n[NOTE: Live web search is currently unavailable. Base your analysis on the provided odds data and your training knowledge. Flag anything that should be verified live.]',
              messages: [{ role: 'user', content: prompt }],
              max_tokens: 2000,
              temperature: 0.7,
            }),
          });
          if (claudeRes.ok) {
            const claudeData = await claudeRes.json();
            return NextResponse.json({ result: claudeData.content?.[0]?.text || '', model: 'claude-sonnet-4-5 (no live search)' });
          }
        } catch { /* fall through */ }
      }

      return NextResponse.json({ error: errData.error?.message || `HTTP ${response.status}` }, { status: response.status });
    }

    const data = await response.json();
    const result = parseResponsesOutput(data);
    return NextResponse.json({ result, model: 'grok-4' });
  } catch (err) {
    console.error('BetOS API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
