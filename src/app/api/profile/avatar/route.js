import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 15;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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

    if (buffer.length > 3 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 3 MB)' }, { status: 400 });
    }

    // Always store as {userId}.jpg (client sends JPEG from canvas crop)
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('avatars')
      .upload(`${user.id}.jpg`, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
        cacheControl: '3600',
      });

    if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

    // Cache-bust so browser fetches the new image immediately
    const ts = Date.now();
    const avatar_url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}.jpg?v=${ts}`;

    // Persist into user_metadata and profiles table in parallel
    const existing = user.user_metadata || {};
    await Promise.all([
      supabaseAdmin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...existing, avatar_url, avatar_updated_at: new Date().toISOString() },
      }),
      supabaseAdmin.from('profiles').update({ avatar_url }).eq('id', user.id),
    ]);

    return NextResponse.json({ avatar_url });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
