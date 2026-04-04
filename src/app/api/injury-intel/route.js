import { NextResponse } from 'next/server';

// Extend Vercel function timeout so grok-4 web-search has time to respond
export const maxDuration = 60;

const XAI_API_KEY = process.env.XAI_API_KEY;
const XAI_BASE    = 'https://api.x.ai/v1';

const SPORT_LABELS = {
  mlb: 'MLB Baseball', nfl: 'NFL Football', nba: 'NBA Basketball',
  nhl: 'NHL Hockey', ncaaf: 'College Football', ncaab: 'College Basketball',
  mls: 'MLS Soccer', wnba: 'WNBA Basketball', ufc: 'UFC/MMA',
};

function buildAutoPrompt(sport, dateStr) {
  const label = SPORT_LABELS[sport] || sport.toUpperCase();
  return `Search Twitter/X (especially beat reporters and injury accounts), ESPN.com, Rotoworld, and injury aggregators for the LATEST ${label} injury reports, game-time decisions, and lineup news as of ${dateStr}.

Return a concise injury intel report ONLY in this format — no extra text:

🏥 ${label.toUpperCase()} INJURY INTEL — ${dateStr}

List 8-10 most betting-relevant players:
• [FULL NAME] ([TEAM ABBREV]) — [OUT | DOUBTFUL | QUESTIONABLE | PROBABLE | DAY-TO-DAY | STARTING | SCRATCHED]
  [1 sentence: injury/situation + impact on today's game or betting line]
  📡 [source Twitter @handle or website]

⚡ SHARP NOTES: [2-3 sentences — any surprise scratches, last-minute lineup changes, or injury news moving the line]

Keep it tight, no fluff. Prioritize game-time decisions for today.`;
}

function buildQueryPrompt(sport, query, dateStr) {
  const label = SPORT_LABELS[sport] || sport.toUpperCase();
  return `Search Twitter/X, ESPN, and sports news for the latest information on: "${query}" in ${label} as of ${dateStr}.

Include:
• Current availability / injury status
• Recent beat reporter tweets and sources
• How this affects betting lines or fantasy
• Any related trade, lineup, or roster news
• Direct quotes or tweet references if available

Be specific and current. Format as bullet points. Today is ${dateStr}.`;
}

function parseGrokOutput(resp) {
  if (resp.output) {
    const texts = resp.output
      .filter(item => item.type === 'message')
      .flatMap(msg => (msg.content || []).filter(c => c.type === 'output_text').map(c => c.text));
    if (texts.length) return texts.join('\n\n');
    const anyText = resp.output.flatMap(item => {
      if (item.content) return item.content.filter(c => c.text).map(c => c.text);
      if (item.text)    return [item.text];
      return [];
    });
    if (anyText.length) return anyText.join('\n\n');
  }
  if (resp.choices?.[0]?.message?.content) return resp.choices[0].message.content;
  return '';
}

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;

async function callClaude(prompt) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not configured');
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      system: 'You are an elite sports injury scout. Be concise and structured. NOTE: You do not have live web search — provide analysis based on your training data and clearly state that live status should be verified before wagering.',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1200,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Claude error ${res.status}: ${err.error?.message || 'Unknown'}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

export async function POST(req) {
  if (!XAI_API_KEY && !ANTHROPIC_KEY) {
    return NextResponse.json({ error: 'No AI API key configured' }, { status: 500 });
  }

  const { sport = 'mlb', query = '', date } = await req.json();
  const dateStr = date || new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const prompt  = query.trim()
    ? buildQueryPrompt(sport, query.trim(), dateStr)
    : buildAutoPrompt(sport, dateStr);

  // Try xAI first (has live web search — preferred for injury intel)
  if (XAI_API_KEY) {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 55_000);

    try {
      const response = await fetch(`${XAI_BASE}/chat/completions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${XAI_API_KEY}` },
        signal:  controller.signal,
        body:    JSON.stringify({
          model:    'grok-3',
          messages: [
            { role: 'system', content: 'You are an elite sports injury scout. Be concise, structured, and source everything. Only use verified, recent information.' },
            { role: 'user',   content: prompt },
          ],
          temperature:  0.3,
          max_tokens:   1200,
          search_parameters: { mode: 'auto' },
        }),
      });

      clearTimeout(abortTimer);

      if (response.ok) {
        const data  = await response.json();
        const intel = data.choices?.[0]?.message?.content || parseGrokOutput(data);
        return NextResponse.json({ intel, model: 'grok-3', timestamp: new Date().toISOString() });
      }

      // If search_parameters isn't supported (400), retry without it
      if (response.status === 400) {
        const retry = await fetch(`${XAI_BASE}/chat/completions`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${XAI_API_KEY}` },
          body:    JSON.stringify({
            model:    'grok-3',
            messages: [
              { role: 'system', content: 'You are an elite sports injury scout. Be concise and structured.' },
              { role: 'user',   content: prompt },
            ],
            temperature: 0.3,
            max_tokens:  1200,
          }),
        });
        if (retry.ok) {
          const retryData = await retry.json();
          return NextResponse.json({ intel: retryData.choices?.[0]?.message?.content || '', model: 'grok-3', timestamp: new Date().toISOString() });
        }
      }

      console.warn(`[injury-intel] xAI returned ${response.status}, falling back to Claude`);
    } catch (err) {
      clearTimeout(abortTimer);
      if (err.name === 'AbortError') {
        console.warn('[injury-intel] xAI timed out, falling back to Claude');
      } else {
        console.warn('[injury-intel] xAI error:', err.message, '— falling back to Claude');
      }
    }
  }

  // Fall back to Claude (no live search, but still useful for general injury knowledge)
  try {
    const intel = await callClaude(prompt);
    return NextResponse.json({
      intel,
      model: 'claude-sonnet-4-5 (no live search)',
      timestamp: new Date().toISOString(),
      warning: 'Live web search unavailable — verify injury status before wagering',
    });
  } catch (err) {
    console.error('[injury-intel] Both AI providers failed:', err.message);
    return NextResponse.json({ error: 'Injury intel temporarily unavailable. Please try again in a moment.' }, { status: 503 });
  }
}
