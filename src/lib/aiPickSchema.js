/**
 * AI pick JSON schema — extracts and validates structured picks from LLM output.
 *
 * Replaces the regex-scraping approach (parseOdds, parseEdge from narrative)
 * with a single JSON block at the bottom of every analysis. The LLM is
 * instructed to emit:
 *
 *   ```json
 *   {
 *     "is_pass": false,
 *     "pick": "Cleveland Cavaliers ML -192 (DraftKings)",
 *     "team": "Cleveland Cavaliers",
 *     "side": "home",
 *     "bet_type": "ML",
 *     "odds": -192,
 *     "spread_point": null,
 *     "total_point": null,
 *     "confidence": "MEDIUM",
 *     "edge_pct": 5.5,
 *     "model_prob": 0.65,
 *     "market_prob": 0.62,
 *     "book": "DraftKings",
 *     "reasoning": "Cavs at home favored against rebuilding Raptors..."
 *   }
 *   ```
 *
 * Pass picks (AI declines to bet):
 *
 *   ```json
 *   {
 *     "is_pass": true,
 *     "pass_reason": "No edge ≥3% identified",
 *     "confidence": "LOW",
 *     "edge_pct": 0
 *   }
 *   ```
 *
 * Why JSON-in-fenced-block instead of structured outputs:
 * - Works across providers (OpenAI, Anthropic, etc.) without provider-specific
 *   API features
 * - Survives in the analysis text for debugging
 * - Robust to LLMs adding narrative before/after — we just match the fenced block
 */

const VALID_CONFIDENCES = new Set(['ELITE', 'HIGH', 'MEDIUM', 'LOW']);
const VALID_SIDES       = new Set(['home', 'away', 'over', 'under', 'draw']);
const VALID_BET_TYPES   = new Set(['ML', 'spread', 'total', 'draw']);

/**
 * Find a ```json ... ``` block in LLM output and parse it. Returns null on
 * any failure — caller falls back to legacy regex parsing.
 *
 * Tolerates:
 *   - Multiple JSON blocks (takes the LAST one — usually the final summary)
 *   - Missing language tag (just ```...```)
 *   - Trailing whitespace, newlines
 *   - Smart quotes (replaces with ASCII)
 */
export function extractPickJSON(text) {
  if (!text || typeof text !== 'string') return null;

  // Match all ```json...``` or ```...``` blocks. The (?:json)? is optional so
  // a model that omits the language tag still parses.
  const blockRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  const blocks = [];
  let m;
  while ((m = blockRe.exec(text)) !== null) {
    blocks.push(m[1]);
  }
  if (!blocks.length) return null;

  // Try the LAST block first (most likely the final structured summary), then
  // fall back to earlier ones if it doesn't parse — handles cases where the
  // LLM included an example block earlier in the response.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const candidate = blocks[i]
      .replace(/[‘’]/g, "'")  // smart single quotes → '
      .replace(/[“”]/g, '"')  // smart double quotes → "
      .trim();
    if (!candidate.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/**
 * Validate + normalize a parsed pick JSON. Returns { ok, normalized, errors }.
 * Defensive: missing fields default to safe values rather than rejecting the
 * whole object — the LLM might omit fields and we'd rather salvage what we can.
 *
 * The shape we WANT to enforce strictly is the contract documented at the top
 * of this file. We log non-fatal warnings for fields that are present but
 * malformed; we reject only when required-for-pick fields are missing on a
 * non-pass pick.
 */
export function validatePickJSON(raw) {
  const errors = [];
  const warnings = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, normalized: null, errors: ['not an object'], warnings: [] };
  }

  const isPass = !!raw.is_pass;

  // Confidence is always required
  let confidence = String(raw.confidence || '').toUpperCase();
  if (!VALID_CONFIDENCES.has(confidence)) {
    warnings.push(`unknown confidence: ${raw.confidence ?? 'null'} → defaulting to LOW`);
    confidence = 'LOW';
  }

  // Edge % — number between 0 and 50 (anything higher is suspicious)
  let edgePct = null;
  if (raw.edge_pct != null) {
    const n = Number(raw.edge_pct);
    if (!Number.isFinite(n) || n < 0 || n > 50) {
      warnings.push(`edge_pct out of range: ${raw.edge_pct}`);
    } else {
      edgePct = Math.round(n * 10) / 10; // round to 1 decimal
    }
  }

  if (isPass) {
    return {
      ok: true,
      normalized: {
        is_pass:     true,
        pass_reason: raw.pass_reason ? String(raw.pass_reason).slice(0, 500) : null,
        pick_text:   raw.pick_text || raw.pick || (raw.pass_reason ? `Pass — ${raw.pass_reason}` : 'Pass'),
        confidence,
        edge_pct:    edgePct ?? 0,
        model_prob:  null,
        market_prob: null,
        side:        null,
        team:        null,
        bet_type:    null,
        odds:        null,
        reasoning:   raw.reasoning ? String(raw.reasoning).slice(0, 1000) : null,
      },
      errors,
      warnings,
    };
  }

  // Real pick path — these fields are required
  const pickText = raw.pick || raw.pick_text;
  if (!pickText || typeof pickText !== 'string') errors.push('pick text required for non-pass pick');

  let side = String(raw.side || '').toLowerCase();
  if (!VALID_SIDES.has(side)) {
    warnings.push(`unknown side: ${raw.side ?? 'null'}`);
    side = null;
  }

  let betType = String(raw.bet_type || '').toUpperCase();
  // Accept common aliases
  if (betType === 'MONEYLINE') betType = 'ML';
  if (betType === 'SPREADS')   betType = 'spread';
  if (betType === 'OVER' || betType === 'UNDER' || betType === 'TOTALS') betType = 'total';
  if (!VALID_BET_TYPES.has(betType) && !['SPREAD', 'TOTAL', 'DRAW'].includes(betType)) {
    warnings.push(`unknown bet_type: ${raw.bet_type ?? 'null'}`);
    betType = null;
  } else {
    // Normalize SPREAD → spread, TOTAL → total
    if (betType === 'SPREAD') betType = 'spread';
    if (betType === 'TOTAL')  betType = 'total';
    if (betType === 'DRAW')   betType = 'draw';
  }

  // Odds — American format, |n| between 100 and 1500
  let odds = null;
  if (raw.odds != null) {
    const n = Number(raw.odds);
    if (Number.isFinite(n) && Math.abs(n) >= 100 && Math.abs(n) <= 1500) {
      odds = Math.round(n);
    } else {
      warnings.push(`odds out of range: ${raw.odds}`);
    }
  }

  // Probabilities — between 0 and 1
  const clampProb = (v, label) => {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) {
      warnings.push(`${label} not a number: ${v}`);
      return null;
    }
    // Some LLMs emit percentages instead of decimals — auto-correct
    if (n > 1 && n <= 100) return n / 100;
    if (n < 0 || n > 1) {
      warnings.push(`${label} out of range: ${v}`);
      return null;
    }
    return n;
  };
  const modelProb  = clampProb(raw.model_prob,  'model_prob');
  const marketProb = clampProb(raw.market_prob, 'market_prob');

  return {
    ok: errors.length === 0,
    normalized: {
      is_pass:     false,
      pass_reason: null,
      pick_text:   pickText,
      confidence,
      edge_pct:    edgePct,
      model_prob:  modelProb,
      market_prob: marketProb,
      side,
      team:        raw.team ? String(raw.team).slice(0, 80) : null,
      bet_type:    betType,
      odds,
      spread_point: raw.spread_point != null && Number.isFinite(Number(raw.spread_point))
        ? Number(raw.spread_point) : null,
      total_point:  raw.total_point != null && Number.isFinite(Number(raw.total_point))
        ? Number(raw.total_point) : null,
      book:        raw.book ? String(raw.book).slice(0, 40) : null,
      reasoning:   raw.reasoning ? String(raw.reasoning).slice(0, 1000) : null,
    },
    errors,
    warnings,
  };
}

/**
 * One-shot helper: extract + validate. Returns the normalized object directly
 * (or null on any failure), plus warnings for logging.
 */
export function parsePickFromAnalysis(text) {
  const raw = extractPickJSON(text);
  if (!raw) return { normalized: null, warnings: ['no JSON block found'] };
  const { ok, normalized, errors, warnings } = validatePickJSON(raw);
  if (!ok) return { normalized: null, warnings: [...warnings, ...errors] };
  return { normalized, warnings };
}

/**
 * The instruction block we append to LLM prompts so they emit a parseable
 * JSON block at the end of their analysis. Used by pregenerate-analysis to
 * standardize structured output across all sports.
 */
export const PICK_JSON_INSTRUCTION = `
=== STRUCTURED OUTPUT (REQUIRED) ===
After your narrative analysis, append a JSON block in fenced markdown that
captures your pick in machine-readable form. The block MUST appear at the
end of your response and use this exact format:

\`\`\`json
{
  "is_pass": false,
  "pick": "<full pick text e.g. 'Cleveland Cavaliers ML -192 (DraftKings)'>",
  "team": "<team name being bet on, e.g. 'Cleveland Cavaliers'>",
  "side": "home|away|over|under|draw",
  "bet_type": "ML|spread|total|draw",
  "odds": -192,
  "spread_point": null,
  "total_point": null,
  "confidence": "ELITE|HIGH|MEDIUM|LOW",
  "edge_pct": 5.5,
  "model_prob": 0.65,
  "market_prob": 0.62,
  "book": "DraftKings",
  "reasoning": "<1-2 sentence explanation>"
}
\`\`\`

If you decline to bet (no qualifying edge ≥3%, insufficient data, etc.), use:

\`\`\`json
{
  "is_pass": true,
  "pass_reason": "<short reason e.g. 'No edge ≥3% identified'>",
  "confidence": "LOW",
  "edge_pct": 0,
  "model_prob": null,
  "market_prob": null
}
\`\`\`

Rules:
- "edge_pct" must be a NUMBER (e.g. 5.5), not a string and not "X/10".
- "model_prob" and "market_prob" must be DECIMALS between 0 and 1 (0.65 = 65%), not percentages.
- "odds" must be American format (e.g. -150 or +120), not decimal.
- The JSON block is REQUIRED. Plain prose without it is invalid output.
`.trim();
