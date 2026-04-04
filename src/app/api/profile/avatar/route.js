import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function getUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export async function POST(req) {
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const contentType = req.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await req.arrayBuffer());

    if (buffer.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 2 MB)' }, { status: 400 });
    }

    // Upsert as {userId}.jpg — overwrites previous avatar
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('avatars')
      .upload(`${user.id}.jpg`, buffer, {
        contentType,
        upsert: true,
        cacheControl: '86400',
      });

    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

    // Return the public URL (with cache-bust timestamp)
    const ts = Date.now();
    const avatar_url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}.jpg?v=${ts}`;

    // Also update user_metadata so it's available immediately on next session load
    const existing = user.user_metadata || {};
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...existing, avatar_url, avatar_updated_at: new Date().toISOString() },
    });

    return NextResponse.json({ avatar_url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
