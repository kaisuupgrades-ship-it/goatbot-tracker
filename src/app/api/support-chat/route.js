import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const XAI_API_KEY  = process.env.XAI_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase     = createClient(SUPABASE_URL, SERVICE_KEY);

const SYSTEM_PROMPT = `You are BetOS Support, a helpful AI assistant embedded in the BetOS sports betting tracker app. Your job is to help users troubleshoot issues, explain features, and provide betting advice.

About BetOS:
- BetOS is a sports betting tracker that lets users log picks, track performance (W/L/ROI), enter weekly contests, and use AI-powered pick analysis
- Sports supported: MLB, NFL, NBA, NHL, Soccer/MLS, NCAAF, NCAAB, Golf, Tennis, and more
- Users can track Moneyline, Spread, Over/Under, and Prop bets
- The Contest feature lets users submit picks for weekly leaderboard competitions (approved picks only, -200 to +600 odds range, max 3 units)
- AI Analysis uses xAI Grok to analyze picks and provide confidence ratings
- Community Chat is available for verified users only (email must be confirmed)
- The Leaderboard shows public picks sorted by ROI and profit

Common troubleshooting:
- "My pick won't save" → Check that game hasn't started yet, odds are in valid range (-200 to +600 for contests), and you're not over daily limits
- "AI analysis not working" → Analysis runs on-demand; try clicking Analyze on the pick card. Service may be temporarily unavailable
- "Contest pick flagged" → Picks are reviewed by AI + Pinnacle odds check. Common flags: line submitted after game started, odds way off market
- "Can't see my picks" → Make sure picks are set to Public if you want them visible to others
- "Chat not working" → Email verification required. Check your inbox for a verification link
- "Golf/Tennis scores missing" → Live data depends on ESPN API; may not be available for all events

When users report SERIOUS concerns (bugs causing data loss, payment issues, abuse, harassment, or anything safety-related), you MUST include the exact text "SERIOUS_CONCERN:" followed by a brief summary at the very END of your response. This will be logged for admin review.

Keep responses concise and friendly. Use emojis sparingly. If you don't know something, say so honestly.`;

async function callGrok(messages, maxTokens = 400) {
  if (!XAI_API_KEY) throw new Error('AI unavailable');
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${XAI_API_KEY}` },
    body: JSON.stringify({
      model: 'grok-3-mini',
      messages,
      max_tokens: maxTokens,
      temperature: 0.5,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Grok error ${res.status}: ${err.slice(0, 100)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function logConcern(message, userId, username) {
  try {
    await supabase.from('ai_concerns').insert([{
      message,
      user_id: userId || null,
      username: username || null,
      source: 'chatbot',
      created_at: new Date().toISOString(),
    }]);
  } catch { /* non-critical */ }
}

export async function POST(req) {
  try {
    const { messages, userId, username } = await req.json();
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 });
    }

    // Build message array with system prompt
    const grokMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.slice(-10), // keep last 10 turns for context
    ];

    const reply = await callGrok(grokMessages, 500);

    // Check if AI flagged a serious concern
    const concernMatch = reply.match(/SERIOUS_CONCERN:\s*(.+?)(?:\n|$)/);
    if (concernMatch) {
      const concernText = concernMatch[1].trim();
      await logConcern(concernText, userId, username);
    }

    // Strip the SERIOUS_CONCERN marker from the user-facing reply
    const cleanReply = reply.replace(/SERIOUS_CONCERN:.*$/m, '').trim();

    return NextResponse.json({
      reply: cleanReply,
      concernLogged: !!concernMatch,
    });
  } catch (err) {
    console.error('[support-chat] Error:', err.message);
    return NextResponse.json({
      reply: "I'm having trouble connecting right now. For urgent issues, please use the feedback button or email support. I'll be back shortly!",
      error: err.message,
    });
  }
}
