import { NextResponse } from 'next/server';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://betos.win';

/**
 * Supabase can use either:
 *   - PKCE flow  -> ?code=XXX  (query param, visible server-side)
 *   - Implicit   -> #access_token=XXX  (hash fragment, INVISIBLE server-side)
 *
 * We handle both by returning a tiny HTML page that reads the full URL
 * (including hash) and passes everything to the client-side /auth/exchange page.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const error = searchParams.get('error');
  const type  = searchParams.get('type');

  if (type === 'recovery') {
    return NextResponse.redirect(`${SITE_URL}/auth/reset-password`);
  }

  if (error) {
    return NextResponse.redirect(`${SITE_URL}/?error=auth`);
  }

  // Return a thin HTML trampoline that preserves the hash fragment
  // and forwards everything (code OR access_token) to the exchange page.
  const html = `<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"><title>Signing in...</title></head>
  <body style="background:#0a0a0a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
    <p>Signing you in...</p>
    <script>
      (function () {
        var hash   = window.location.hash;   // #access_token=... (implicit)
        var search = window.location.search; // ?code=...         (PKCE)
        var base   = ${JSON.stringify(SITE_URL)} + '/auth/exchange';

        if (hash) {
          // Implicit flow - pass hash to client page
          window.location.replace(base + search + hash);
        } else {
          // PKCE flow (or no params at all)
          window.location.replace(base + search);
        }
      })();
    </script>
  </body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
