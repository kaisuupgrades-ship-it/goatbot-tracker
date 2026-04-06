/**
 * BetOS AI Utility — dual-provider with automatic fallback
 *
 * Strategy:
 *   1. Try xAI (Grok) first — preferred because it has live web search
 *   2. Fall back to Claude (Anthropic) if xAI fails for any reason
 *
 * Web search notes:
 *   - xAI grok-3 supports web search via search_parameters: { mode: 'auto' }
 *   - Claude models do NOT have native web search — only use Claude fallback
 *     for tasks where live search is not critical (analysis, parsing, etc.)
 *   - For injury intel and live game analysis, xAI is required; Claude gets
 *     a degraded prompt noting that live data may be stale.
 */

const XAI_BASE       = 'https://api.x.ai/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

// Model choices
const XAI_MODEL        = 'grok-3';           // default — reliable, supports web search
const XAI_MODEL_HEAVY  = 'grok-4';           // for deep daily analysis (cron + admin scan)
const CLAUDE_MODEL     = 'claude-opus-4-6';  // best reasoning — used as fallback when xAI is unavailable

/**
 * Call xAI grok-3 chat completions (with optional web search)
 */
async function callXai({ system, user, maxTokens = 1500, temperature = 0.7, webSearch = false, signal, model }) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not configured');

  const body = {
    model: model || XAI_MODEL,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  };

  if (webSearch) {
    body.search_parameters = { mode: 'auto' };
  }

  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`xAI error ${res.status}: ${errData.error?.message || 'Unknown'}`);
  }

  const data = await res.json();
  const usedModel = model || XAI_MODEL;
  return {
    text: data.choices?.[0]?.message?.content?.trim() || '',
    model: usedModel,
    provider: 'xai',
  };
}

/**
 * Call Claude (Anthropic) — used as fallback when xAI is unavailable
 * Note: Claude does NOT have live web search capability
 */
async function callClaude({ system, user, maxTokens = 1500, temperature = 0.7, signal }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const messages = [{ role: 'user', content: user }];

  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      system: system || undefined,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(`Claude error ${res.status}: ${errData.error?.message || 'Unknown'}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() || '';
  return {
    text,
    model: CLAUDE_MODEL,
    provider: 'claude',
  };
}

/**
 * Main entry point - tries xAI first, falls back to Claude
 *
 * @param {object} opts
 * @param {string}  opts.system        - system prompt
 * @param {string}  opts.user          — user message / prompt
 * @param {number}  [opts.maxTokens]   — max response tokens
 * @param {number}  [opts.temperature] — 0-1 creativity
 * @param {boolean} [opts.webSearch]   — enable xAI web search (no effect on Claude)
 * @param {boolean} [opts.requireSearch] — if true and xAI fails, Claude gets a
 *                                         "[no live search]" note prepended
 * @param {boolean} [opts.useGrok4]   — use grok-4 instead of grok-3 (for deep daily analysis)
 * @param {AbortSignal} [opts.signal]  — optional AbortSignal for timeout
 * @returns {Promise<{ text: string, model: string, provider: string, fallback: boolean }>}
 */
export async function callAI({ system, user, maxTokens = 1500, temperature = 0.7, webSearch = false, requireSearch = false, useGrok4 = false, signal } = {}) {
  const xaiModel = useGrok4 ? XAI_MODEL_HEAVY : XAI_MODEL;
  // Try xAI first
  try {
    const result = await callXai({ system, user, maxTokens, temperature, webSearch, signal, model: xaiModel });
    return { ...result, fallback: false };
  } catch (xaiErr) {
    console.warn('[BetOS AI] xAI failed, falling back to Claude:', xaiErr.message);
  }

  // Fall back to Claude
  try {
    // If this was a web-search request, prepend a note so Claude knows it doesn't have live data
    const claudeUser = requireSearch
      ? `[NOTE: Live web search unavailable - use your knowledge up to your training cutoff and flag any information that may be outdated]\n\n${user}`
      : user;

    const result = await callClaude({ system, user: claudeUser, maxTokens, temperature, signal });
    return { ...result, fallback: true };
  } catch (claudeErr) {
    console.error('[BetOS AI] Both xAI and Claude failed:', claudeErr.message);
    throw new Error(`AI unavailable: xAI and Claude both failed`);
  }
}

/**
 * Convenience: call AI and just return the text string
 * Returns null on failure instead of throwing (for non-critical paths)
 */
e