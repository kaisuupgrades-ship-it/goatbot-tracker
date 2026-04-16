import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai';
import { requireAuth } from '@/lib/auth';

export const maxDuration = 60;

export async function POST(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  if (!process.env.XAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'No AI API key configured' }, { status: 500 });
  }

  try {
    const { picks } = await req.json();
    const settled = (picks || []).filter(p =>
      p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH'
    );

    if (settled.length < 3) {
      return NextResponse.json({
        error: 'Need at least 3 settled picks to generate insights. Keep logging and check back soon.'
      }, { status: 400 });
    }

    // Build a compact summary for the AI — enough data without wasting tokens
    const pickSummary = settled.map(p => ({
      date: p.date,
      sport: p.sport,
      team: p.team,
      bet_type: p.bet_type,
      odds: p.odds,
      book: p.book,
      result: p.result,
      profit: p.profit,
      notes: p.notes || '',
    }));

    const totalPicks  = settled.length;
    const wins        = settled.filter(p => p.result === 'WIN').length;
    const losses      = settled.filter(p => p.result === 'LOSS').length;
    const totalUnits  = settled.reduce((s, p) => s + (parseFloat(p.profit) || 0), 0);
    const roi         = ((totalUnits / totalPicks) * 100).toFixed(1);

    const prompt = `You are an elite sports betting analyst. Analyze this bettor's pick history and provide sharp, honest, actionable coaching. Be specific — reference actual picks, sports, odds ranges, and patterns you see. Don't be generic.

OVERALL STATS:
- Record: ${wins}-${losses} (${((wins/totalPicks)*100).toFixed(1)}% win rate)
- Units P/L: ${totalUnits >= 0 ? '+' : ''}${totalUnits.toFixed(2)}u
- ROI: ${roi}%
- Total picks: ${totalPicks}

PICK HISTORY (oldest to newest):
${JSON.stringify(pickSummary, null, 2)}

Return ONLY valid JSON (no markdown, no code fences) in exactly this structure:
{
  "summary": "2-3 sentence honest overall assessment of this bettor's performance and habits",
  "score": <number 0-100 representing overall sharpness>,
  "leaks": [
    {"title": "short leak title", "detail": "specific explanation with data from their picks", "severity": "high|medium|low"}
  ],
  "edges": [
    {"title": "short edge title", "detail": "specific strength with data from their picks", "strength": "strong|moderate|developing"}
  ],
  "patterns": [
    {"title": "pattern title", "detail": "observation about timing, sport mix, bet type tendencies, etc."}
  ],
  "recommendations": [
    "specific, actionable recommendation #1",
    "specific, actionable recommendation #2",
    "specific, actionable recommendation #3"
  ]
}

Include 1-3 leaks, 1-3 edges, 1-2 patterns, and 3 recommendations. Be brutally honest. If they have no real edge, say so. If they're doing something well, be specific about what.`;

    const aiResult = await callAI({
      system: 'You are a sharp sports betting analyst. Return only valid JSON.',
      user: prompt,
      maxTokens: 1500,
      temperature: 0.4,
    });
    const raw = aiResult.text;

    // Strip markdown code fences if model added them
    const cleaned = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();

    try {
      const insights = JSON.parse(cleaned);
      return NextResponse.json({ insights, picksAnalyzed: totalPicks });
    } catch {
      // If JSON parse fails, return the raw text so we can debug
      return NextResponse.json({ error: 'AI returned malformed JSON', raw }, { status: 500 });
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
