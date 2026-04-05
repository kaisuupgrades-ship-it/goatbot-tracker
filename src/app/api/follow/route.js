import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function supabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function getAuthUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabase().auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch { return null; }
}

// GET /api/follow?followerId=X&followingId=Y  → check relationship
// GET /api/follow?followerId=X                → list all users this user follows
// GET /api/follow?followingId=X               → list all users who follow this user
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const followerId  = searchParams.get('followerId');
  const followingId = searchParams.get('followingId');

  const db = supabase();

  // Check single relationship
  if (followerId && followingId) {
    const { data } = await db.from('follows').select('id').eq('follower_id', followerId).eq('following_id', followingId).maybeSingle();
    return NextResponse.json({ following: !!data });
  }

  // List all people this user follows
  if (followerId) {
    const { data, error } = await db
      .from('follows')
      .select('following_id, following:profiles!following_id(username,display_name,avatar_emoji)')
      .eq('follower_id', followerId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const users = (data || []).map(r => ({ id: r.following_id, ...r.following }));
    return NextResponse.json({ users, following: users }); // 'following' kept for backward compat
  }

  // List all people who follow this user
  if (followingId) {
    const { data, error } = await db
      .from('follows')
      .select('follower_id, follower:profiles!follower_id(username,display_name,avatar_emoji)')
      .eq('following_id', followingId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ users: (data || []).map(r => ({ id: r.follower_id, ...r.follower })) });
  }

  return NextResponse.json({ error: 'followerId or followingId required' }, { status: 400 });
}

// POST /api/follow  body: { followerId, followingId }  → follow
export async function POST(req) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { followerId, followingId } = await req.json();
  if (!followerId || !followingId) return NextResponse.json({ error: 'Missing IDs' }, { status: 400 });
  if (followerId === followingId) return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 });

  if (user.id !== followerId)
    return NextResponse.json({ error: 'User ID mismatch' }, { status: 403 });

  const { error } = await supabase().from('follows').insert({ follower_id: followerId, following_id: followingId });
  if (error && error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/follow  body: { followerId, followingId }  → unfollow
export async function DELETE(req) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { followerId, followingId } = await req.json();
  if (!followerId || !followingId) return NextResponse.json({ error: 'Missing IDs' }, { status: 400 });

  if (user.id !== followerId)
    return NextResponse.json({ error: 'User ID mismatch' }, { status: 403 });

  const { error } = await supabase().from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
