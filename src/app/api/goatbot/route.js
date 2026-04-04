import { NextResponse } from 'next/server';

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_BASE    = 'https://api.x.ai/v1';

const SYSTEM_PROMPT = `You are GOAT BOT — the sharpest AI sports handicapper on the planet. You think like a professional sharp bettor who hunts CLV, reads line movement, and finds true edges.

CRITICAL: Every response MUST follow this EXACT structure with these EXACT headers on their own lines. Do not deviate.

THE PICK: [Team Name + Bet Type + Odds + Book] — one line only, e.g. "Pittsburgh Pirates ML +102 at DraftKings"

EDGE BREAKDOWN: [2-3 sentences on fair odds vs market odds, implied prob vs true prob, CLV angle]

KEY FACTORS:
1. [First key reason — line movement, sharp action, model signal]
2. [Second key reason — matchup, situational angle, injury impact]
3. [Third key reason — public fade, pace, rest, travel, motivation]

CONFIDENCE: HIGH
(must be exactly one of: LOW / MEDIUM / HIGH / ELITE — on its own line after "CONFIDENCE:")

EDGE SCORE: 7/10
(must be exactly X/10 format on its own line after "EDGE SCORE:")

WIN PROBABILITY: 58%
(must be exactly XX% format on its own line after "WIN PROBABILITY:")

RECORD IMPACT: [How this fits the overall portfolio strategy — CLV accumulation, unit sizing, contest angle]

Rules:
- THE PICK line must contain ONLY the bet — no dates, no "for [date]", no context
- CONFIDENCE must be on its own line as: "CONFIDENCE: HIGH" (or LOW/MEDIUM/ELITE)
- Never use markdown asterisks or bold formatting
- No hedging, no "it depends" — pick a side and defend it
- Keep it sharp, data-driven, decisive`;

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
      // Fallback to grok-3 without search if grok-4 fails
      if (response.status === 400 || response.status === 404) {
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
          return NextResponse.json({ result: fbData.choices[0].message.content, model: 'grok-3 (fallback)' });
        }
      }
      return NextResponse.json({ error: errData.error?.message || `HTTP ${response.status}` }, { status: response.status });
    }

    const data = await response.json();
    const result = parseResponsesOutput(data);
    return NextResponse.json({ result, model: 'grok-4' });
  } catch (err) {
    console.error('GOAT BOT API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
