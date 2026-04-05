import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function supabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// GET /api/follow?followerId=X&followingId=Y  → check relationship
// GET /api/follow?followerId=X                → list all IDs this user follows
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const followerId  = searchParams.get('followerId');
  const followingId = searchParams.get('followingId');

  if (!followerId) return NextResponse.json({ error: 'followerId required' }, { status: 400 });

  const db = supabase();

  if (followingId) {
    // Check single relationship
    const { data } = await db.from('follows').select('id').eq('follower_id', followerId).eq('following_id', followingId).maybeSingle();
    return NextResponse.json({ following: !!data });
  }

  // List all following IDs
  const { data, error } = await db.from('follows').select('following_id, following:profiles!following_id(username,display_name,avatar_emoji)').eq('follower_id', followerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ following: (data || []).map(r => ({ id: r.following_id, ...r.following })) });
}

// POST /api/follow  body: { followerId, followingId }  → follow
export async function POST(req) {
  const { followerId, followingId } = await req.json();
  if (!followerId || !followingId) return NextResponse.json({ error: 'Missing IDs' }, { status: 400 });
  if (followerId === followingId) return NextResponse.json({ error: 'Cannot follow yourself' }, { status: 400 });

  const { error } = await supabase().from('follows').insert({ follower_id: followerId, following_id: followingId });
  if (error && error.code !== '23505') return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// DELETE /api/follow  body: { followerId, followingId }  → unfollow
export async function DELETE(req) {
  const { followerId, followingId } = await req.json();
  if (!followerId || !followingId) return NextResponse.json({ error: 'Missing IDs' }, { status: 400 });

  const { error } = await supabase().from('follows').delete().eq('follower_id', followerId).eq('following_id', followingId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
