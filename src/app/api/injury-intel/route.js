import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai';

// Extend Vercel function timeout so Grok web-search has time to respond
export const maxDuration = 60;

const SPORT_LABELS = {
  mlb: 'MLB Baseball', nfl: 'NFL Football', nba: 'NBA Basketball',
  nhl: 'NHL Hockey', ncaaf: 'College Football', ncaab: 'College Basketball',
  mls: 'MLS Soccer', wnba: 'WNBA Basketball', ufc: 'UFC/MMA',
};

function buildAutoPrompt(sport, dateStr) {
  const label = SPORT_LABELS[sport] || sport.toUpperCase();
  return `Search for the LATEST ${label} injury reports, lineup news, game-time decisions, and player availability for ${dateStr}. Check Twitter/X beat reporters, ESPN, Rotoworld, DailyFaceoff (NHL), RotoBaller, and official team sources.

Return a concise injury intel report ONLY in this exact format — no extra commentary:

🏥 ${label.toUpperCase()} INJURY INTEL — ${dateStr}

List 8-10 most betting-relevant players:
• [FULL NAME] ([TEAM ABBREV]) — [OUT | DOUBTFUL | QUESTIONABLE | PROBABLE | DAY-TO-DAY | STARTING | SCRATCHED]
  [1 sentence: injury/situation + betting impact for today]
  📡 [source: Twitter handle or website]

⚡ SHARP NOTES: [2-3 sentences — surprise scratches, last-minute changes, or injury news moving the line]

Prioritize game-time decisions and players whose status affects today's betting lines.`;
}

function buildQueryPrompt(sport, query, dateStr) {
  const label = SPORT_LABELS[sport] || sport.toUpperCase();
  return `Search the latest news, injury reports, and updates for: "${query}" in ${label} as of ${dateStr}.

Include:
• Current availability / injury status
• Recent beat reporter updates and tweet sources
• How this affects betting lines or fantasy value
• Any related roster, lineup, or trade news
• Direct quotes or sourced references if available

Be specific and current. Format as clear bullet points. Today is ${dateStr}.`;
}

const SYSTEM_PROMPT = `You are GoatBot's elite sports injury scout with live web search access.
Your job: find the most current, betting-relevant injury and lineup news.
Be concise, structured, and always cite your sources (Twitter handles, websites).
Prioritize news from the last 24 hours. Never fabricate injury statuses.`;

const CLAUDE_SYSTEM = `You are GoatBot's sports injury analyst.
Use your training knowledge to provide injury analysis, known injury history, and betting context.
Be upfront that live statuses should be verified before wagering, but DO provide useful analysis — known injury histories, typical recovery timelines, how this type of injury affects performance, and historical betting patterns.
Never say you "cannot" help — always provide the best analysis you can with available knowledge.`;

export async function POST(req) {
  const { sport = 'mlb', query = '', date } = await req.json();
  const dateStr = date || new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const prompt = query.trim()
    ? buildQueryPrompt(sport, query.trim(), dateStr)
    : buildAutoPrompt(sport, dateStr);

  try {
    const result = await callAI({
      system: SYSTEM_PROMPT,
      user: prompt,
      maxTokens: 1400,
      temperature: 0.25,
      webSearch: true,      // xAI Grok uses live web search
      requireSearch: true,  // Claude fallback gets a note that it lacks live data
    });

    // If Claude fell back, add a disclaimer at the top
    const isFallback = result.fallback || result.provider === 'claude';
    const intel = isFallback
      ? `⚠️ **Live search unavailable** — showing analysis from AI training data. Verify injury status at ESPN.com, Rotoworld, or team Twitter before wagering.\n\n${result.text}`
      : result.text;

    return NextResponse.json({
      intel,
      model: result.model,
      provider: result.provider,
      liveSearch: !isFallback,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[injury-intel] Both AI providers failed:', err.message);
    return NextResponse.json(
      { error: 'Injury intel temporarily unavailable. Please try again.' },
      { status: 503 }
    );
  }
}
