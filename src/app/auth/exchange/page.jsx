'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function Spinner({ status }) {
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

/**
 * Inner component — useSearchParams() MUST be inside a Suspense boundary
 * (Next.js 14 requirement) to pass the build.
 */
function ExchangeInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('Signing you in…');

  useEffect(() => {
    async function handleAuth() {
      try {
        const code = searchParams.get('code');

        if (code) {
          // PKCE flow
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (!error) {
            router.replace('/dashboard');
            return;
          }
          console.error('[auth/exchange] PKCE error:', error.message);
        }

        // Implicit flow — Supabase SDK auto-detects tokens from window.location.hash
        await new Promise((r) => setTimeout(r, 300));
        const { data: { session } } = await supabase.auth.getSession();

        if (session) {
          router.replace('/dashboard');
          return;
        }

        console.error('[auth/exchange] No session. hash:', window.location.hash.slice(0, 80));
        setStatus('Sign-in failed. Redirecting…');
        router.replace('/?error=auth');
      } catch (err) {
        console.error('[auth/exchange] unexpected:', err);
        router.replace('/?error=auth');
      }
    }

    handleAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <Spinner status={status} />;
}

export default function AuthExchange() {
  return (
    <Suspense fallback={<Spinner status="Signing you in…" />}>
      <ExchangeInner />
    </Suspense>
  );
}
