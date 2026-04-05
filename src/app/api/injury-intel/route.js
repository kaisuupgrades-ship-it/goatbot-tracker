import { NextResponse } from 'next/server';

export const maxDuration = 60;

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

const XAI_API_KEY    = process.env.XAI_API_KEY;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const XAI_BASE       = 'https://api.x.ai/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

const SPORT_LABELS = {
  mlb: 'MLB Baseball', nfl: 'NFL Football', nba: 'NBA Basketball',
  nhl: 'NHL Hockey', ncaaf: 'College Football', ncaab: 'College Basketball',
  mls: 'MLS Soccer', wnba: 'WNBA Basketball', ufc: 'UFC/MMA',
};

const SYSTEM_PROMPT = `You are GoatBot's elite sports injury scout with live web search.
Search for the most current injury reports, lineup news, and player availability.
Always cite your sources (Twitter/X handles, ESPN, beat reporters, official team feeds).
Prioritize news from the last 24 hours. Never fabricate injury statuses — if you can't find current data, say so clearly.
Format output cleanly with bullet points and emojis as instructed.`;

function buildAutoPrompt(sport, dateStr) {
  const label = SPORT_LABELS[sport] || sport.toUpperCase();
  return `Search for the LATEST ${label} injury reports, lineup news, game-time decisions, and player availability for ${dateStr}.
Search Twitter/X beat reporters, ESPN, Rotoworld, DailyFaceoff (NHL), RotoBaller, and official team sources.

Return ONLY this exact format — no preamble, no disclaimers, just the intel:

🏥 ${label.toUpperCase()} INJURY INTEL — ${dateStr}

List the 8-10 most betting-relevant players:
• [FULL NAME] ([TEAM ABBREV]) — [OUT | DOUBTFUL | QUESTIONABLE | PROBABLE | DAY-TO-DAY | STARTING | SCRATCHED]
  [1 sentence: injury/situation + betting impact for today]
  📡 [source: @TwitterHandle or website]

⚡ SHARP NOTES: [2-3 sentences — surprise scratches, last-minute changes, or news moving the line]`;
}

function buildQueryPrompt(sport, query, dateStr) {
  const label = SPORT_LABELS[sport] || sport.toUpperCase();
  return `Search the latest news, injury reports, and updates for: "${query}" in ${label} as of ${dateStr}.

Include:
• Current availability / injury status from today's beat reporter sources
• Recent updates from Twitter/X and official team feeds
• How this affects betting lines or fantasy value
• Any related roster, lineup, or trade news

Be specific and current. Format as clean bullet points. Today is ${dateStr}.`;
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
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

export async function POST(req) {
  // Rate limiting check
  const userId = req.headers.get('x-user-id') || req.ip || 'anonymous';
  if (!checkRateLimit(userId)) {
    return NextResponse.json({ error: 'Rate limit exceeded. Please wait a minute.' }, { status: 429 });
  }

  const { sport = 'mlb', query = '', date } = await req.json();
  const dateStr = date || new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const prompt = query.trim()
    ? buildQueryPrompt(sport, query.trim(), dateStr)
    : buildAutoPrompt(sport, dateStr);

  // ── Tier 1: Claude Opus 4.6 + live web search ─────────────────────────────
  // Same web search tool used in the Cowork scheduled task — searches Twitter/X,
  // ESPN, beat reporters, etc. in real time.
  if (ANTHROPIC_KEY) {
    try {
      const { response, timedOut } = await fetchWithTimeout(
        `${ANTHROPIC_BASE}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-opus-4-6',
            system: SYSTEM_PROMPT,
            tools: [{ type: 'web_search_20260209' }],
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1800,
            temperature: 1,
          }),
        },
        50_000,
      );
      if (!timedOut && response?.ok) {
        const data = await response.json();
        const intel = (data.content || [])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join('\n\n')
          .trim();
        if (intel) {
          return NextResponse.json({
            intel,
            model: 'claude-opus-4-6',
            provider: 'claude',
            liveSearch: true,
            timestamp: new Date().toISOString(),
          });
        }
      }
      if (timedOut) console.log('[injury-intel] Claude Opus timed out, trying grok-3');
      else console.log('[injury-intel] Claude Opus returned', response?.status, '— trying grok-3');
    } catch (err) {
      console.log('[injury-intel] Claude Opus error:', err.message, '— trying grok-3');
    }
  }

  // ── Tier 2: xAI grok-3 + web search ──────────────────────────────────────
  if (XAI_API_KEY) {
    try {
      const { response, timedOut } = await fetchWithTimeout(
        `${XAI_BASE}/chat/completions`,
        {
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
            search_parameters: { mode: 'auto' },
            max_tokens: 1400,
            temperature: 0.25,
          }),
        },
        45_000,
      );
      if (!timedOut && response?.ok) {
        const data = await response.json();
        const intel = data.choices?.[0]?.message?.content?.trim();
        if (intel) {
          return NextResponse.json({
            intel,
            model: 'grok-3',
            provider: 'xai',
            liveSearch: true,
            timestamp: new Date().toISOString(),
          });
        }
      }
      if (timedOut) console.log('[injury-intel] grok-3 timed out');
      else console.log('[injury-intel] grok-3 returned', response?.status);
    } catch (err) {
      console.log('[injury-intel] grok-3 error:', err.message);
    }
  }

  // ── Tier 3: Claude Opus 4.6 — no search (last resort) ────────────────────
  // Only fires if both live-search tiers fail. Shows a small disclaimer but
  // still gives useful historical context — no more wall-of-text refusals.
  if (ANTHROPIC_KEY) {
    try {
      const { response, timedOut } = await fetchWithTimeout(
        `${ANTHROPIC_BASE}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-opus-4-6',
            system: `You are GoatBot's sports injury analyst. Live web search is temporarily unavailable.
Use your training knowledge to provide useful injury context — known injury histories, typical timelines, how injuries affect performance and lines, and which players to watch.
Give a concise, useful response. Add a single one-line note at the top that live statuses should be verified. Do NOT refuse to help or write long disclaimers.`,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 1400,
            temperature: 0.4,
          }),
        },
        40_000,
      );
      if (!timedOut && response?.ok) {
        const data = await response.json();
        const rawText = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim();
        if (rawText) {
          return NextResponse.json({
            intel: `⚠️ Live search temporarily unavailable — verify current statuses at ESPN or team Twitter.\n\n${rawText}`,
            model: 'claude-opus-4-6',
            provider: 'claude',
            liveSearch: false,
            timestamp: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      console.log('[injury-intel] Claude no-search fallback failed:', err.message);
    }
  }

  return NextResponse.json(
    { error: 'Injury intel temporarily unavailable. Please try again in a moment.' },
    { status: 503 }
  );
}
