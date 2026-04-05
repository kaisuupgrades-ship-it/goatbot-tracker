import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function db() { return createClient(SUPABASE_URL, SUPABASE_KEY); }

// GET /api/chat?limit=50&before=ISO_DATE  → fetch recent chat messages
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const limit  = Math.min(parseInt(searchParams.get('limit') || '60', 10), 100);
  const before = searchParams.get('before'); // for pagination

  let query = db()
    .from('chat_messages')
    .select('id, user_id, content, created_at, author:profiles!user_id(username, display_name, avatar_emoji)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Return newest-first for pagination, client reverses for display
  return NextResponse.json({ messages: data || [] });
}

// POST /api/chat  body: { userId, content }
export async function POST(req) {
  const { userId, content } = await req.json();
  if (!userId || !content?.trim())
    return NextResponse.json({ error: 'userId and content required' }, { status: 400 });
  if (content.length > 500)
    return NextResponse.json({ error: 'Max 500 characters' }, { status: 400 });

  const { data, error } = await db()
    .from('chat_messages')
    .insert({ user_id: userId, content: content.trim() })
    .select('id, user_id, content, created_at, author:profiles!user_id(username, display_name, avatar_emoji)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: data });
}

// DELETE /api/chat  body: { messageId, userId }  → delete own message
export async function DELETE(req) {
  const { messageId, userId } = await req.json();
  if (!messageId || !userId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const { error } = await db()
    .from('chat_messages')
    .delete()
    .eq('id', messageId)
    .eq('user_id', userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
