/**
 * /api/admin/chat — Admin AI assistant
 *
 * Accepts a conversation history and returns the next AI response.
 * Admin-only: enforced server-side by checking the userEmail against ADMIN_EMAILS.
 *
 * POST body: { messages: [{role:'user'|'assistant', content:string}], userEmail: string }
 */
import { NextResponse } from 'next/server';
import { callAI } from '@/lib/ai';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const SYSTEM_PROMPT = `You are the BetOS admin assistant — an expert AI built into the BetOS admin panel.

BetOS is a sports betting intelligence platform with:
- A Next.js 14 App Router frontend deployed on Vercel
- Supabase as the database (picks, users, contests, settings)
- Real-time sports data from ESPN's unofficial API
- Odds from The Odds API (the-odds-api.com) + Pinnacle as a reference line
- AI analysis powered by xAI Grok (primary, with web search) + Claude Opus as fallback
- Sports supported: NFL, NBA, MLB, NHL, NCAAF, NCAAB, Soccer (MLS), Golf, Tennis (ATP/WTA), UFC

Key concepts:
- Picks: users submit picks that can be regular or contest entries (contest_entry = true)
- Contests: bracket-style or leaderboard competitions tracked in Supabase
- AI "leans": pre-generated AI analysis for each game stored in Supabase settings table
- Cron jobs: scheduled analysis generation, trend scanning, injury intel
- Admin panel sections: Overview, Users, Activity, Picks Audit, Contests, Backtester, Cron Jobs, System

You help the admin:
- Debug issues with the app (API errors, data problems, UI bugs)
- Understand user activity and pick patterns
- Think through feature ideas and architecture decisions
- Write or review code changes
- Interpret data from Supabase queries

Be concise, direct, and technical when needed. You are talking to the app owner/developer.`;

export async function POST(req) {
  try {
    const { messages, userEmail } = await req.json();

    // Server-side admin guard
    if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.includes(userEmail?.toLowerCase())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 });
    }

    // Build the user prompt from the last message + include recent history as context
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'user') {
      return NextResponse.json({ error: 'Last message must be from user' }, { status: 400 });
    }

    // Format conversation history (all messages except the last one) as context
    const history = messages.slice(0, -1);
    const historyText = history.length > 0
      ? history.map(m => `${m.role === 'user' ? 'Admin' : 'Assistant'}: ${m.content}`).join('\n\n') + '\n\n'
      : '';

    const userPrompt = historyText
      ? `Previous conversation:\n${historyText}Admin: ${lastMsg.content}`
      : lastMsg.content;

    const result = await callAI({
      system:    SYSTEM_PROMPT,
      user:      userPrompt,
      maxTokens: 2000,
      temperature: 0.7,
      webSearch: true,   // enables Grok web search for live info
    });

    return NextResponse.json({
      reply:    result.text,
      model:    result.model,
      provider: result.provider,
      fallback: result.fallback,
    });
  } catch (err) {
    console.error('[/api/admin/chat] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
