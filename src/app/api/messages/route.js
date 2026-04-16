import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '@/lib/auth';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function db() { return createClient(SUPABASE_URL, SUPABASE_KEY); }

async function getAuthUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await db().auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch { return null; }
}

// ── GET /api/messages?userId=X                → list all conversations (inbox)
// ── GET /api/messages?userId=X&withUser=Y    → get thread with a specific user
// ── GET /api/messages?userId=X&unreadCount=1 → just return unread count
export async function GET(req) {
  const { user, error } = await requireAuth(req);
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const userId     = searchParams.get('userId');
  const withUser   = searchParams.get('withUser');
  const unreadOnly = searchParams.get('unreadCount') === '1';

  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const supabase = db();

  // Unread count shortcut
  if (unreadOnly) {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .is('read_at', null)
      .eq('deleted_recipient', false);
    return NextResponse.json({ unread: count || 0 });
  }

  // Thread with a specific user
  if (withUser) {
    // Mark messages from withUser to userId as read
    await supabase
      .from('messages')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', userId)
      .eq('sender_id', withUser)
      .is('read_at', null);

    const { data, error } = await supabase
      .from('messages')
      .select('id, sender_id, recipient_id, content, created_at, read_at, sender:profiles!sender_id(username,display_name,avatar_emoji), recipient:profiles!recipient_id(username,display_name,avatar_emoji)')
      .or(`and(sender_id.eq.${userId},recipient_id.eq.${withUser}),and(sender_id.eq.${withUser},recipient_id.eq.${userId})`)
      .eq('deleted_sender', false)
      .eq('deleted_recipient', false)
      .order('created_at', { ascending: true })
      .limit(100);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ messages: data || [] });
  }

  // Inbox: all conversations, grouped by partner, latest message first
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_id, recipient_id, content, created_at, read_at, sender:profiles!sender_id(username,display_name,avatar_emoji), recipient:profiles!recipient_id(username,display_name,avatar_emoji)')
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .eq('deleted_sender', false)
    .eq('deleted_recipient', false)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Group into conversations by partner
  const convMap = {};
  for (const msg of data || []) {
    const partnerId = msg.sender_id === userId ? msg.recipient_id : msg.sender_id;
    const partner   = msg.sender_id === userId ? msg.recipient   : msg.sender;
    if (!convMap[partnerId]) {
      convMap[partnerId] = {
        partner_id:     partnerId,
        partner:        partner,
        last_message:   msg,
        unread:         0,
      };
    }
    // Count unread (messages TO me that I haven't read)
    if (msg.recipient_id === userId && !msg.read_at) {
      convMap[partnerId].unread++;
    }
  }

  const conversations = Object.values(convMap).sort(
    (a, b) => new Date(b.last_message.created_at) - new Date(a.last_message.created_at)
  );

  return NextResponse.json({ conversations });
}

// ── POST /api/messages  body: { senderId, recipientId, content }
export async function POST(req) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { senderId, recipientId, content } = await req.json();
  if (!senderId || !recipientId || !content?.trim())
    return NextResponse.json({ error: 'senderId, recipientId, content required' }, { status: 400 });
  if (senderId === recipientId)
    return NextResponse.json({ error: 'Cannot message yourself' }, { status: 400 });
  if (content.length > 2000)
    return NextResponse.json({ error: 'Message too long (max 2000 chars)' }, { status: 400 });

  if (user.id !== senderId)
    return NextResponse.json({ error: 'User ID mismatch' }, { status: 403 });

  const { data, error } = await db()
    .from('messages')
    .insert({ sender_id: senderId, recipient_id: recipientId, content: content.trim() })
    .select('id, sender_id, recipient_id, content, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: data });
}

// ── PATCH /api/messages  body: { userId, partnerId }  → mark thread as read
export async function PATCH(req) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { userId, partnerId } = await req.json();
  if (!userId || !partnerId) return NextResponse.json({ error: 'Missing IDs' }, { status: 400 });

  if (user.id !== userId)
    return NextResponse.json({ error: 'User ID mismatch' }, { status: 403 });

  await db()
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .eq('sender_id', partnerId)
    .is('read_at', null);

  return NextResponse.json({ success: true });
}
