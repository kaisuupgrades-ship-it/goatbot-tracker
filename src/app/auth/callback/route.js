import { NextResponse } from 'next/server';

// Always redirect to the canonical domain — never back to vercel.app
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://betos.win';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const type = searchParams.get('type');
  const error = searchParams.get('error');

  // Password recovery
  if (type === 'recovery') {
    return NextResponse.redirect(`${SITE_URL}/auth/reset-password`);
  }

  // OAuth error from provider
  if (error) {
    console.error('[auth/callback] OAuth provider error:', error, searchParams.get('error_description'));
    return NextResponse.redirect(`${SITE_URL}/?error=auth`);
  }

  // Hand the code to the client-side exchange page.
  // We CANNOT call exchangeCodeForSession() here (server-side) because the PKCE
  // code_verifier is stored in the browser's localStorage — not available server-side.
  // The /auth/exchange page runs in the browser where localStorage is accessible.
  if (code) {
    return NextResponse.redirect(`${SITE_URL}/auth/exchange?code=${encodeURIComponent(code)}`);
  }

  return NextResponse.redirect(`${SITE_URL}/?error=auth`);
}
