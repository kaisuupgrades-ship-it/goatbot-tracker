import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const _svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseAdmin = (process.env.NEXT_PUBLIC_SUPABASE_URL && _svcKey)
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, _svcKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

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

    // Use the standard supabase-js client to send the reset email
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ''}/auth/reset`,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
