import { NextResponse } from 'next/server';

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_BASE    = 'https://api.x.ai/v1';

const EXTRACT_PROMPT = `You are parsing a sports betting slip or verbal bet input. Extract all bet details and return ONLY valid JSON (no markdown, no code fences, no extra text).

Return this exact structure:
{
  "team": "team name or player being bet on (e.g. 'New York Yankees', 'LeBron James')",
  "sport": "MLB|NBA|NFL|NHL|NCAAF|NCAAB|Soccer|UFC|Other",
  "bet_type": "Moneyline|Spread|Run Line|Puck Line|Total (Over)|Total (Under)|Prop|Parlay|Other",
  "odds": <American odds as integer, e.g. -110 or 105. REQUIRED.>,
  "units": <wager size as decimal number. Parse '2u', '2 units', '2 unit', 'two units' as 2. Parse '0.5u', 'half unit' as 0.5. If not mentioned use null.>,
  "book": "sportsbook name or null",
  "matchup": "Away Team at Home Team or null",
  "date": "YYYY-MM-DD or null",
  "notes": "brief one-line description of the bet"
}

Rules:
- bet_type: 'money line', 'ML', 'moneyline' → 'Moneyline'. 'over' → 'Total (Over)'. 'under' → 'Total (Under)'. 'RL' → 'Run Line'. 'PL' → 'Puck Line'.
- units: ALWAYS parse unit expressions — '2u', '2 units', '2unit' all mean 2. '1.5u' means 1.5.
- odds: must be an integer. '-125' stays -125. '+110' stays 110.
- If you cannot determine a value with confidence, use null. American odds only — convert decimal/fractional if needed.`;

async function callVision(imageBase64, mimeType) {
  const response = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${XAI_API_KEY}`,
    },
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
  return response;
}

async function callText(text) {
  const response = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'grok-3',
      messages: [
        { role: 'system', content: 'You parse sports bet slips into structured JSON. Return only valid JSON.' },
        { role: 'user', content: `${EXTRACT_PROMPT}\n\nBET SLIP CONTENT:\n${text}` },
      ],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });
  return response;
}

export async function POST(req) {
  if (!XAI_API_KEY) {
    return NextResponse.json({ error: 'XAI_API_KEY not configured' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { type } = body;
    let aiResponse;

    if (type === 'image') {
      // Screenshot upload — use vision model
      const { data: imageBase64, mimeType = 'image/png' } = body;
      if (!imageBase64) return NextResponse.json({ error: 'No image data provided' }, { status: 400 });
      aiResponse = await callVision(imageBase64, mimeType);

    } else if (type === 'url') {
      // Share link — fetch page text server-side then parse
      const { url } = body;
      if (!url) return NextResponse.json({ error: 'No URL provided' }, { status: 400 });

      let pageText = '';
      try {
        const pageRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(8000),
        });
        if (pageRes.ok) {
          const html = await pageRes.text();
          // Strip HTML tags, keep meaningful text
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
      aiResponse = await callText(`Share link: ${url}\n\nPage content: ${pageText}`);

    } else if (type === 'text') {
      // Raw pasted text
      const { text } = body;
      if (!text) return NextResponse.json({ error: 'No text provided' }, { status: 400 });
      aiResponse = await callText(text);

    } else {
      return NextResponse.json({ error: 'Invalid type. Use: image, url, or text' }, { status: 400 });
    }

    if (!aiResponse.ok) {
      const err = await aiResponse.json().catch(() => ({}));
      return NextResponse.json({ error: err.error?.message || `AI API error ${aiResponse.status}` }, { status: aiResponse.status });
    }

    const aiData = await aiResponse.json();
    const raw    = aiData.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

    try {
      const parsed = JSON.parse(cleaned);
      return NextResponse.json({ parsed });
    } catch {
      return NextResponse.json({ error: 'Could not parse bet slip. Try pasting the text manually.', raw }, { status: 422 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
