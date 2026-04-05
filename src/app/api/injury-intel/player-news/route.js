import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai';

export const maxDuration = 30;

/**
 * GET /api/injury-intel/player-news?player=LeBron+James&team=LAL&sport=nba
 *
 * Uses Grok with web search to find the latest tweets, beat reporter updates,
 * and news about a specific player's injury/availability status.
 */
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const player = searchParams.get('player')?.trim();
  const team   = searchParams.get('team')?.trim() || '';
  const sport  = searchParams.get('sport')?.trim() || 'nba';

  if (!player) {
    return NextResponse.json({ error: 'Missing player parameter' }, { status: 400 });
  }

  const system = `You are a sports injury news analyst. Your job is to find and summarize the most recent injury/availability updates for a specific player. Focus on:
- Recent tweets from beat reporters, team accounts, and verified journalists
- Official team injury reports
- Practice participation status
- Expected return timelines
- Any conflicting reports

Always cite the source (reporter name, team account, etc.) and approximate time of the report.
Return your response in this exact JSON format:
{
  "status": "Out" | "Doubtful" | "Questionable" | "Probable" | "Day-to-Day" | "Active" | "Unknown",
  "summary": "2-3 sentence plain English summary of the latest on this player",
  "updates": [
    {
      "source": "Reporter or account name",
      "text": "What they reported (paraphrased, max 100 chars)",
      "time": "relative time like '2h ago' or 'Apr 5'",
      "platform": "X" | "ESPN" | "Team" | "News"
    }
  ],
  "returnTimeline": "Expected return date/timeline if known, or null",
  "lastUpdated": "When the most recent update was posted"
}
Return ONLY valid JSON, no markdown fences, no extra text.`;

  const userPrompt = `Find the most recent injury and availability updates for ${player}${team ? ` (${team})` : ''} in ${sport.toUpperCase()}. Search X/Twitter, sports news, and beat reporter accounts for the latest reports from the last 48 hours. If the player is healthy/active with no injury concerns, say so clearly.`;

  try {
    const result = await callAI({
      system,
      user: userPrompt,
      maxTokens: 800,
      temperature: 0.3,
      webSearch: true,
      requireSearch: true,
    });

    // Try to parse JSON from the response
    let parsed;
    try {
      // Strip markdown fences if present
      const cleaned = result.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If JSON parsing fails, return the raw text as a summary
      parsed = {
        status: 'Unknown',
        summary: result.text.slice(0, 500),
        updates: [],
        returnTimeline: null,
        lastUpdated: null,
      };
    }

    return NextResponse.json({
      player,
      team,
      sport,
      ...parsed,
      provider: result.provider,
      fallback: result.fallback,
    });
  } catch (err) {
    console.error('[player-news] AI error:', err.message);
    return NextResponse.json(
      { error: 'Failed to fetch player news', detail: err.message },
      { status: 500 }
    );
  }
}
