import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

// ── Rank system ───────────────────────────────────────────────────────────────
// Betting-themed rank tiers, ordered lowest -> highest
export const RANKS = [
  { title: 'Degenerate',       minXp: 0,     emoji: '[bet]', color: '#888' },
  { title: 'Square',           minXp: 100,   emoji: '[target]', color: '#a78bfa' },
  { title: 'Handicapper',      minXp: 300,   emoji: '[stats]', color: '#60a5fa' },
  { title: 'Sharp',            minXp: 700,   emoji: '[sharp]', color: '#34d399' },
  { title: 'Steam Chaser',     minXp: 1500,  emoji: '[fire]', color: '#fb923c' },
  { title: 'Wiseguy',          minXp: 3000,  emoji: '[vibe]', color: '#f472b6' },
  { title: 'Line Mover',       minXp: 6000,  emoji: '[up]', color: '#facc15' },
  { title: 'Syndicate',        minXp: 10000, emoji: '[gem]', color: '#38bdf8' },
  { title: 'Whale',            minXp: 20000, emoji: '[whale]', color: '#c084fc' },
  { title: 'Legend',           minXp: 40000, emoji: '[crown]', color: '#FFB800' },
];

export function getRankForXp(xp) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (xp >= r.minXp) rank = r;
  }
  return rank;
}

// Award XP to a user and update their rank title
async function awardXp(userId, amount) {
  try {
    const supabase = db();
    // Fetch current XP
    const { data: profile } = await supabase
      .from('profiles')
      .select('xp')
      .eq('id', userId)
      .single();
    const currentXp = profile?.xp || 0;
    const newXp = currentXp + amount;
    const newRank = getRankForXp(newXp);
    await supabase
      .from('profiles')
      .update({ xp: newXp, rank_title: newRank.title })
      .eq('id', userId);
  } catch { /* non-critical */ }
}

// GET /api/chat?limit=60               -> fetch messages
// GET /api/chat?unreadCount=1&userId=  -> unread count
// GET /api/chat?settings=1             -> chat settings (public)
// GET /api/chat?chatStatus=1&userId=   -> muted/banned status
export async function GET(req) {
  const { searchParams } = new URL(req.url);

  // ── Chat settings (public) ─────────────────────────────────────────────────
  if (searchParams.get('settings') === '1') {
    try {
      const { data } = await db().from('chat_settings').select('key, value');
      const settings = {};
      (data || []).forEach(r => { settings[r.key] = r.value; });
      return NextResponse.json({ settings });
    } catch {
      return NextResponse.json({ settings: {} });
    }
  }

  // ── Chat status for a user (muted/banned) ─────────────────────────────────
  if (searchParams.get('chatStatus') === '1') {
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ muted: false, banned: false });
    try {
      const [muteRes, banRes, modRes] = await Promise.all([
        db().from('chat_mutes').select('expires_at').eq('user_id', userId)
          .gt('expires_at', new Date().toISOString()).limit(1),
        db().from('chat_bans').select('id').eq('user_id', userId).eq('active', true).limit(1),
        db().from('chat_mods').select('user_id').eq('user_id', userId).limit(1),
      ]);
      const muted = (muteRes.data?.length || 0) > 0;
      const muteExpiry = muteRes.data?.[0]?.expires_at || null;
      const banned = (banRes.data?.length || 0) > 0;
      const isMod  = (modRes.data?.length || 0) > 0;
      return NextResponse.json({ muted, muteExpiry, banned, isMod });
    } catch {
      return NextResponse.json({ muted: false, banned: false, isMod: false });
    }
  }

  // ── Unread count ───────────────────────────────────────────────────────────
  if (searchParams.get('unreadCount') === '1') {
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ unread: 0 });
    try {
      const { data: setting } = await db()
        .from('settings').select('value').eq('key', `chat_last_seen_${userId}`).maybeSingle();
      const lastSeen = setting?.value || '2000-01-01T00:00:00Z';
      const { count } = await db()
        .from('chat_messages').select('id', { count: 'exact', head: true })
        .gt('created_at', lastSeen).neq('user_id', userId);
      return NextResponse.json({ unread: count || 0 });
    } catch { return NextResponse.json({ unread: 0 }); }
  }

  // ── Mark seen ──────────────────────────────────────────────────────────────
  const seenUserId = searchParams.get('markSeen');
  if (seenUserId) {
    try {
      await db().from('settings').upsert(
        [{ key: `chat_last_seen_${seenUserId}`, value: new Date().toISOString() }],
        { onConflict: 'key' }
      );
    } catch { /* non-critical */ }
  }

  // ── Normal message fetch ───────────────────────────────────────────────────
  const limit  = Math.min(parseInt(searchParams.get('limit') || '60', 10), 100);
  const before = searchParams.get('before');

  let query = db()
    .from('chat_messages')
    .select(`
      id, user_id, content, created_at,
      author:profiles!user_id(username, display_name, avatar_emoji, xp, rank_title, role)
    `)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Attach mod status for all message authors
  let modSet = new Set();
  try {
    const authorIds = [...new Set((data || []).map(m => m.user_id))];
    if (authorIds.length > 0) {
      const { data: mods } = await db().from('chat_mods').select('user_id').in('user_id', authorIds);
      modSet = new Set((mods || []).map(m => m.user_id));
    }
  } catch { /* non-critical */ }

  const messages = (data || []).map(m => ({
    ...m,
    author: { ...m.author, is_mod: modSet.has(m.user_id) },
  }));

  return NextResponse.json({ messages });
}

// POST /api/chat  body: { userId, content }
export async function POST(req) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { userId, content } = await req.json();
  if (!userId || !content?.trim())
    return NextResponse.json({ error: 'userId and content required' }, { status: 400 });

  if (user.id !== userId)
    return NextResponse.json({ error: 'User ID mismatch' }, { status: 403 });

  const supabase = db();

  // ── Load chat settings ─────────────────────────────────────────────────────
  let settings = {};
  try {
    const { data } = await supabase.from('chat_settings').select('key, value');
    (data || []).forEach(r => { settings[r.key] = r.value; });
  } catch { /* use defaults */ }

  // Check chat enabled
  if (settings.chat_enabled === 'false')
    return NextResponse.json({ error: 'Chat is currently disabled.' }, { status: 403 });

  // Max message length
  const maxLen = parseInt(settings.max_message_length || '500', 10);
  if (content.trim().length > maxLen)
    return NextResponse.json({ error: `Max ${maxLen} characters` }, { status: 400 });

  // ── Check if chat-banned ───────────────────────────────────────────────────
  try {
    const { data: ban } = await supabase
      .from('chat_bans').select('id').eq('user_id', userId).eq('active', true).limit(1);
    if (ban?.length > 0)
      return NextResponse.json({ error: 'You are banned from Community Chat.' }, { status: 403 });
  } catch { /* non-critical */ }

  // ── Check if chat-muted ────────────────────────────────────────────────────
  try {
    const { data: mute } = await supabase
      .from('chat_mutes').select('expires_at').eq('user_id', userId)
      .gt('expires_at', new Date().toISOString()).limit(1);
    if (mute?.length > 0) {
      const expiry = new Date(mute[0].expires_at);
      const minsLeft = Math.ceil((expiry - Date.now()) / 60000);
      return NextResponse.json({ error: `You are muted for ${minsLeft} more minute${minsLeft !== 1 ? 's' : ''}.` }, { status: 403 });
    }
  } catch { /* non-critical */ }

  // ── Check min XP requirement ───────────────────────────────────────────────
  const minXp = parseInt(settings.min_xp_to_chat || '0', 10);
  if (minXp > 0) {
    try {
      const { data: profile } = await supabase.from('profiles').select('xp').eq('id', userId).single();
      if ((profile?.xp || 0) < minXp)
        return NextResponse.json({ error: `You need at least ${minXp} XP to chat.` }, { status: 403 });
    } catch { /* non-critical */ }
  }

  // ── Insert message ─────────────────────────────────────────────────────────
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({ user_id: userId, content: content.trim() })
    .select(`id, user_id, content, created_at,
      author:profiles!user_id(username, display_name, avatar_emoji, xp, rank_title, role)`)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Award XP (1 XP per message, capped 20/day) ────────────────────────────
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: profile } = await supabase
      .from('profiles').select('xp_last_chat').eq('id', userId).single();
    const lastChatDate = profile?.xp_last_chat;
    if (lastChatDate !== today) {
      await awardXp(userId, 1);
      await supabase.from('profiles').update({ xp_last_chat: today }).eq('id', userId);
    }
  } catch { /* non-critical */ }

  return NextResponse.json({ message: data });
}

// DELETE /api/chat  body: { messageId, userId, isMod? }
export async function DELETE(req) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { messageId, userId, targetUserId } = await req.json();
  if (!messageId) return NextResponse.json({ error: 'Missing messageId' }, { status: 400 });

  const supabase = db();

  // Check if requester is deleting own message, is an admin, or is a chat mod
  const isOwnMessage = user.id === userId;

  // Check mod status
  let isMod = false;
  try {
    const { data: mod } = await supabase.from('chat_mods').select('user_id').eq('user_id', user.id).limit(1);
    isMod = (mod?.length || 0) > 0;
  } catch { /* non-critical */ }

  // Check admin via ADMIN_EMAILS env
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const isAdmin = ADMIN_EMAILS.includes((user.email || '').toLowerCase());

  if (!isOwnMessage && !isMod && !isAdmin)
    return NextResponse.json({ error: 'Not authorized to delete this message' }, { status: 403 });

  // Build delete query — own messages only filter by user_id; mods/admins can delete any
  let query = supabase.from('chat_messages').delete().eq('id', messageId);
  if (!isMod && !isAdmin) query = query.eq('user_id', user.id);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}

// PATCH /api/chat  body: { action, targetUserId, ... }
// Mod-only actions: mute, unmute, ban, unban
export async function PATCH(req) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const body = await req.json();
  const { action, targetUserId, reason, durationMinutes } = body;

  const supabase = db();
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const isAdmin = ADMIN_EMAILS.includes((user.email || '').toLowerCase());

  // Check mod status
  let isMod = false;
  try {
    const { data: mod } = await supabase.from('chat_mods').select('user_id').eq('user_id', user.id).limit(1);
    isMod = (mod?.length || 0) > 0;
  } catch { /* non-critical */ }

  if (!isAdmin && !isMod)
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

  if (!targetUserId)
    return NextResponse.json({ error: 'targetUserId required' }, { status: 400 });

  try {
    if (action === 'mute') {
      const mins = Math.min(Math.max(parseInt(durationMinutes || 30), 1), 10080); // 1 min - 1 week
      const expiresAt = new Date(Date.now() + mins * 60000).toISOString();
      // Remove any existing mute first
      await supabase.from('chat_mutes').delete().eq('user_id', targetUserId);
      await supabase.from('chat_mutes').insert([{
        user_id: targetUserId, muted_by: user.id, reason: reason || null, expires_at: expiresAt,
      }]);
      return NextResponse.json({ ok: true, expiresAt });
    }

    if (action === 'unmute') {
      await supabase.from('chat_mutes').delete().eq('user_id', targetUserId);
      return NextResponse.json({ ok: true });
    }

    if (action === 'ban') {
      // Deactivate existing bans, then insert new one
      await supabase.from('chat_bans').update({ active: false }).eq('user_id', targetUserId);
      await supabase.from('chat_bans').insert([{
        user_id: targetUserId, banned_by: user.id, reason: reason || null, active: true,
      }]);
      return NextResponse.json({ ok: true });
    }

    if (action === 'unban') {
      await supabase.from('chat_bans').update({ active: false }).eq('user_id', targetUserId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
