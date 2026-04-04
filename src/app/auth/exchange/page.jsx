'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Client-side auth exchange — handles both Supabase OAuth flows:
 *
 *  1. PKCE (code query param)    → exchangeCodeForSession(code)
 *  2. Implicit (hash fragment)   → Supabase SDK auto-detects from window.location
 *
 * The /auth/callback route.js forwards here so we can read the full URL
 * including the hash fragment (which servers can never see).
 */
export default function AuthExchange() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('Signing you in…');

  useEffect(() => {
    async function handleAuth() {
      try {
        const code = searchParams.get('code');

        if (code) {
          // ── PKCE flow ────────────────────────────────────────────────────
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) {
            router.replace('/dashboard');
            return;
          }
          console.error('[auth/exchange] PKCE exchange error:', error.message);
        }

        // ── Implicit flow ────────────────────────────────────────────────
        // Supabase's client SDK automatically detects tokens in window.location.hash.
        // Give it one tick to process, then check the session.
        await new Promise((r) => setTimeout(r, 200));
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          router.replace('/dashboard');
          return;
        }

        // Nothing worked
        console.error('[auth/exchange] No session established. hash:', window.location.hash.substring(0, 60));
        setStatus('Sign-in failed. Redirecting…');
        router.replace('/?error=auth');
      } catch (err) {
        console.error('[auth/exchange] unexpected error:', err);
        router.replace('/?error=auth');
      }
    }

    handleAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0a0a0a',
        color: '#fff',
        fontFamily: 'sans-serif',
        gap: 16,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          border: '3px solid #333',
          borderTop: '3px solid #f59e0b',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: '#aaa', fontSize: 14, margin: 0 }}>{status}</p>
    </div>
  );
}
