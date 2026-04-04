import { NextResponse } from 'next/server';

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

export async function POST(req) {
  if (!XAI_API_KEY) {
    return NextResponse.json({ error: 'XAI_API_KEY not configured' }, { status: 500 });
  }

  const { sport = 'mlb', query = '', date } = await req.json();
  const dateStr = date || new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const prompt  = query.trim()
    ? buildQueryPrompt(sport, query.trim(), dateStr)
    : buildAutoPrompt(sport, dateStr);

  try {
    const payload = {
      model: 'grok-4',
      instructions: 'You are an elite sports injury scout. Be concise, structured, and source everything. Only use verified, recent information from your web search.',
      input: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search' }],
      max_output_tokens: 1500,
    };

    const response = await fetch(`${XAI_BASE}/responses`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${XAI_API_KEY}` },
      body:    JSON.stringify(payload),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      // Fallback to grok-3 without search
      if (response.status === 400 || response.status === 404) {
        const fallback = await fetch(`${XAI_BASE}/chat/completions`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${XAI_API_KEY}` },
          body:    JSON.stringify({
            model:    'grok-3',
            messages: [
              { role: 'system', content: 'You are an elite sports injury scout. Be concise and structured.' },
              { role: 'user',   content: prompt },
            ],
            temperature:  0.5,
            max_tokens:   1500,
          }),
        });
        if (fallback.ok) {
          const fbData = await fallback.json();
          return NextResponse.json({ intel: fbData.choices[0].message.content, model: 'grok-3', timestamp: new Date().toISOString() });
        }
      }
      return NextResponse.json({ error: errData.error?.message || `HTTP ${response.status}` }, { status: response.status });
    }

    const data  = await response.json();
    const intel = parseGrokOutput(data);
    return NextResponse.json({ intel, model: 'grok-4', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Injury Intel API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
