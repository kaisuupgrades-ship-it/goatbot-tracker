'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

/**
 * Client-side OAuth code exchange.
 *
 * Supabase uses PKCE — the code_verifier is stored in the browser's localStorage
 * when signInWithOAuth() is called. The server-side /auth/callback route cannot
 * access localStorage, so it passes the code here for the browser to exchange.
 */
export default function AuthExchange() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('Signing you in…');

  useEffect(() => {
    const code = searchParams.get('code');

    if (!code) {
      router.replace('/?error=auth');
      return;
    }

    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ data, error }) => {
        if (error) {
          console.error('[auth/exchange] exchangeCodeForSession error:', error.message);
          setStatus('Sign-in failed. Redirecting…');
          router.replace('/?error=auth');
        } else {
          setStatus('Signed in! Taking you to your dashboard…');
          router.replace('/dashboard');
        }
      })
      .catch((err) => {
        console.error('[auth/exchange] unexpected error:', err);
        router.replace('/?error=auth');
      });
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
        gap: '16px',
      }}
    >
      {/* Spinner */}
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
      <p style={{ color: '#aaa', fontSize: 14 }}>{status}</p>
    </div>
  );
}
