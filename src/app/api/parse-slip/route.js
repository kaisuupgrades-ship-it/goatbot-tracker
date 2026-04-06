import { NextResponse } from 'next/server';
import { normalizeParsedPick } from '@/lib/teamNormalizer';

export const maxDuration = 60;

const XAI_BASE       = 'https://api.x.ai/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';

const EXTRACT_PROMPT = `You are parsing a sports betting slip or verbal bet input. Extract all bet details and return ONLY valid JSON (no markdown, no code fences, no extra text).

Return this exact structure:
{
  "team": "FULL official team name or full player name (see rules below)",
  "sport": "MLB|NBA|NFL|NHL|NCAAF|NCAAB|Soccer|UFC|Other",
  "bet_type": "Moneyline|Spread|Run Line|Puck Line|Total (Over)|Total (Under)|Prop|Parlay|Other",
  "odds": <American odds as integer, e.g. -110 or 105. REQUIRED.>,
  "units": <wager size as decimal number. Parse '2u', '2 units', '2 unit', 'two units' as 2. Parse '0.5u', 'half unit' as 0.5. If not mentioned use null.>,
  "book": "sportsbook name or null",
  "matchup": "Away Team vs Home Team or null",
  "date": "YYYY-MM-DD or null",
  "notes": "brief one-line description of the bet including key details like spread/total line"
}

TEAM NAME RULES (most important):
- ALWAYS use the full official team name. Never use city-only or nickname-only.
  - "Detroit" (MLB) -> "Detroit Tigers"
  - "Chicago" (NBA) -> "Chicago Bulls"
  - "New England" (NFL) -> "New England Patriots"
  - "Pats" -> "New England Patriots"
  - "Cubs" -> "Chicago Cubs"
  - "GS" or "Golden State" (NBA) -> "Golden State Warriors"
  - "Cards" (NFL) -> "Arizona Cardinals"  OR  "Cards" (MLB) -> "St. Louis Cardinals" (use sport context)
  - "LA" (NBA context) -> "Los Angeles Lakers" or "Los Angeles Clippers" (use matchup context)
- For individual sport bets (golf, tennis, boxing, MMA non-UFC): use the full player name (e.g. "Ludvig Aberg", "Scottie Scheffler")
- For UFC: use the full fighter name (e.g. "Jon Jones", "Conor McGregor")
- For parlays: put the full parlay description in "team" field (e.g. "5 Pick Parlay (Detroit Tigers ML, Cubs ML, ...)")

BET TYPE RULES:
- 'money line', 'ML', 'moneyline' -> 'Moneyline'
- 'over' / 'o' -> 'Total (Over)', 'under' / 'u' (when referring to total) -> 'Total (Under)'
- 'RL' or 'run line' -> 'Run Line' (MLB only)
- 'PL' or 'puck line' -> 'Puck Line' (NHL only)
- 'spread' or 'ATS' -> 'Spread'

SPORT RULES:
- Golf, tennis, boxing (non-UFC), horse racing -> 'Other'
- UFC/MMA -> 'UFC'

UNITS RULES:
- ALWAYS parse unit expressions: '2u', '2 units', '2unit' all mean 2. '1.5u' means 1.5.
- Dollar amounts like '$50' or '50 dollars' -> use null for units (we track in units not dollars)

ODDS RULES:
- Must be an integer. '-125' stays -125. '+110' stays 110. American odds only.
- Convert decimal: 2.10 -> +110. Convert fractional: 5/2 -> +250.

- If you cannot determine a value with confidence, use null.`;

// ── Vision: try xAI grok-2-vision, then Claude claude-sonnet-4-5 (both support images) ──
async function parseImage(imageBase64, mimeType) {
  const xaiKey = process.env.XAI_API_KEY;

  // Try xAI vision first
  if (xaiKey) {
    try {
      const res = await fetch(`${XAI_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify({
          model: 'grok-2-vision-1212',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: EXTRACT_PROMPT },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          }],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
      }
    } catch (err) {
      console.warn('[parse-slip] xAI vision failed:', err.message);
    }
  }

  // Fall back to Claude vision (claude-sonnet-4-5 supports base64 images)
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  if (claudeKey) {
    const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: EXTRACT_PROMPT },
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageBase64 } },
          ],
        }],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.content?.[0]?.text || '';
    }
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude vision error ${res.status}: ${err.error?.message || 'Unknown'}`);
  }

  throw new Error('No vision API available - configure XAI_API_KEY or ANTHROPIC_API_KEY');
}

// ── SSRF Protection: validate URLs before fetching ────────────────────────────
function isSafeUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    // Block non-http(s) protocols
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    // Block internal/private IPs
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0') return false;
    if (hostname.startsWith('10.') || hostname.startsWith('192.168.')) return false;
    if (hostname.startsWith('172.') && parseInt(hostname.split('.')[1]) >= 16 && parseInt(hostname.split('.')[1]) <= 31) return false;
    if (hostname === '169.254.169.254') return false; // AWS metadata
    if (hostname.endsWith('.internal') || hostname.endsWith('.local')) return false;
    return true;
  } catch { return false; }
}

// ── Text: use shared AI utility (xAI -> Claude) ────────────────────────────────
async function parseText(text) {
  const xaiKey     = process.env.XAI_API_KEY;
  const claudeKey  = process.env.ANTHROPIC_API_KEY;

  const systemPrompt = 'You parse sports bet slips into structured JSON. Return only valid JSON.';
  const userPrompt   = `${EXTRACT_PROMPT}\n\nBET SLIP CONTENT:\n${text}`;

  // Try xAI
  if (xaiKey) {
    try {
      const res = await fetch(`${XAI_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${xaiKey}` },
        body: JSON.stringify({
          model: 'grok-3',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
      }
    } catch (err) {
      console.warn('[parse-slip] xAI text failed:', err.message);
    }
  }

  // Fall back to Claude
  if (claudeKey) {
    const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        max_tokens: 500,
        temperature: 0,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.content?.[0]?.text || '';
    }
  }

  throw new Error('No AI API available - configure XAI_API_KEY or ANTHROPIC_API_KEY');
}

export async function POST(req) {
  if (!process.env.XAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'No AI API key configured' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { type } = body;
    let raw = '';

    if (type === 'image') {
      const { data: imageBase64, mimeType = 'image/png' } = body;
      if (!imageBase64) return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
      raw = await parseImage(imageBase64, mimeType);

    } else if (type === 'url') {
      const { url } = body;
      if (!url) return NextResponse.json({ error: 'No URL provided' }, { status: 400 });

      // SSRF protection: validate URL before fetching
      if (!isSafeUrl(url)) {
        return NextResponse.json({ error: 'Invalid or blocked URL' }, { status: 400 });
      }

      let pageText = '';
      try {
        const pageRes = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(8000),
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          pageText = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .substring(0, 3000);
        }
      } catch {
        pageText = `URL: ${url}`;
      }
      raw = await parseText(`Share link: ${url}\n\nPage content: ${pageText}`);

    } else if (type === 'text') {
      const { text } = body;
      if (!text) return NextResponse.json({ error: 'No text provided' }, { status: 400 });
      raw = await parseText(text);

    } else {
      return NextResponse.json({ error: 'Invalid type. Use: image, url, or text' }, { status: 400 });
    }

    const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      // Deterministic post-processing: normalize team name to full official name
      // e.g. "Detroit" (MLB) -> "Detroit Tigers", "Cubs" -> "Chicago Cubs"
      normalizeParsedPick(parsed);
      return NextResponse.json({ parsed });
    } catch {
      return NextResponse.json({ error: 'Could not parse bet slip. Try pasting the text manually.', raw }, { status: 422 });
    }
  } catch (err) {
    console.error('[parse-slip] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
