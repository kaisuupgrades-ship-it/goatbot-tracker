import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// Always redirect to the canonical domain after OAuth — never back to vercel.app
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://betos.win';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const type = searchParams.get('type');

  // Password recovery — redirect to a reset page
  if (type === 'recovery') {
    return NextResponse.redirect(`${SITE_URL}/auth/reset-password`);
  }

  // OAuth code exchange
  if (code) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${SITE_URL}/dashboard`);
    }
  }

  // Fallback
  return NextResponse.redirect(`${SITE_URL}/?error=auth`);
}
