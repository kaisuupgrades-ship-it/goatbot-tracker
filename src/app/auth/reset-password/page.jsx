'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true); setError('');
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    setSuccess('Password updated! Redirecting...');
    setTimeout(() => router.push('/dashboard'), 1500);
  }

  const inputStyle = {
    width: '100%', padding: '0.7rem 0.9rem',
    background: '#0C0C14', border: '1px solid #1A1A24',
    borderRadius: '9px', color: '#EDEDF5', fontSize: '0.9rem',
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
    transition: 'all 0.15s',
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#050508',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif', padding: '1rem',
    }}>
      <div style={{
        background: 'rgba(17,17,24,0.9)', border: '1px solid rgba(255,184,0,0.15)',
        borderRadius: '20px', padding: '2rem', width: '100%', maxWidth: '400px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>[target]</div>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#EDEDF5' }}>Set new password</div>
          <div style={{ fontSize: '0.78rem', color: '#6A6A88', marginTop: '4px' }}>Choose a strong password for your BetOS account.</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.75rem', fontWeight: 600, color: '#9494B8', letterSpacing: '0.04em' }}>
              New Password
            </label>
            <input
              type="password" placeholder="--------" value={password}
              onChange={e => setPassword(e.target.value)} required minLength={6}
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = '#FFB800'; e.target.style.boxShadow = '0 0 0 3px rgba(255,184,0,0.08)'; }}
              onBlur={e => { e.target.style.borderColor = '#1A1A24'; e.target.style.boxShadow = 'none'; }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.75rem', fontWeight: 600, color: '#9494B8', letterSpacing: '0.04em' }}>
              Confirm Password
            </label>
            <input
              type="password" placeholder="--------" value={confirm}
              onChange={e => setConfirm(e.target.value)} required
              style={inputStyle}
              onFocus={e => { e.target.style.borderColor = '#FFB800'; e.target.style.boxShadow = '0 0 0 3px rgba(255,184,0,0.08)'; }}
              onBlur={e => { e.target.style.borderColor = '#1A1A24'; e.target.style.boxShadow = 'none'; }}
            />
          </div>

          {error && (
            <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(255,69,96,0.06)', border: '1px solid rgba(255,69,96,0.2)', borderRadius: '8px', color: '#FF4560', fontSize: '0.82rem' }}>
              {error}
            </div>
          )}
          {success && (
            <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(0,212,139,0.06)', border: '1px solid rgba(0,212,139,0.2)', borderRadius: '8px', color: '#00D48B', fontSize: '0.82rem' }}>
              {success}
            </div>
          )}

          <button
            type="submit" disabled={loading}
            style={{
              marginTop: '0.25rem', padding: '0.75rem', width: '100%',
              borderRadius: '10px', border: 'none',
              background: loading ? '#333' : 'linear-gradient(135deg, #FFB800 0%, #FF9500 100%)',
              color: loading ? '#666' : '#000',
              fontSize: '0.92rem', fontWeight: 800, fontFamily: 'inherit',
              cursor: loading ? 'wait' : 'pointer',
              boxShadow: loading ? 'none' : '0 4px 20px rgba(255,184,0,0.3)',
            }}
          >
            {loading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
