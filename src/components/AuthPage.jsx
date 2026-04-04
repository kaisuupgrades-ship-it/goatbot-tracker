'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signUp, getUser, signInWithGoogle, resetPassword } from '@/lib/supabase';

const SUPABASE_CONFIGURED =
  typeof process !== 'undefined' &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://your-project.supabase.co';

// ── Animated stat counter ────────────────────────────────────────────────────
function AnimCounter({ end, duration = 2000, suffix = '', prefix = '' }) {
  const [val, setVal] = useState(0);
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        const start = Date.now();
        const tick = () => {
          const elapsed = Date.now() - start;
          const progress = Math.min(elapsed / duration, 1);
          // Ease out cubic
          const eased = 1 - Math.pow(1 - progress, 3);
          setVal(Math.round(eased * end));
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.3 });

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, duration]);

  return <span ref={ref}>{prefix}{val.toLocaleString()}{suffix}</span>;
}

// ── Floating particle background ─────────────────────────────────────────────
function ParticleField() {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      {Array.from({ length: 30 }).map((_, i) => {
        const size = 2 + Math.random() * 3;
        const left = Math.random() * 100;
        const delay = Math.random() * 8;
        const dur = 6 + Math.random() * 10;
        const opacity = 0.1 + Math.random() * 0.2;
        return (
          <div key={i} style={{
            position: 'absolute',
            width: `${size}px`, height: `${size}px`,
            borderRadius: '50%',
            background: i % 3 === 0 ? '#FFB800' : i % 3 === 1 ? '#00D48B' : '#4E9BF5',
            opacity,
            left: `${left}%`,
            bottom: '-10px',
            animation: `particle-float ${dur}s ${delay}s linear infinite`,
          }} />
        );
      })}
    </div>
  );
}

// ── Typing animation for tagline ─────────────────────────────────────────────
function TypeWriter({ texts, speed = 55, pause = 2000 }) {
  const [display, setDisplay] = useState('');
  const [textIdx, setTextIdx] = useState(0);
  const [charIdx, setCharIdx] = useState(0);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const current = texts[textIdx];
    if (!deleting && charIdx < current.length) {
      const t = setTimeout(() => { setDisplay(current.slice(0, charIdx + 1)); setCharIdx(c => c + 1); }, speed);
      return () => clearTimeout(t);
    } else if (!deleting && charIdx === current.length) {
      const t = setTimeout(() => setDeleting(true), pause);
      return () => clearTimeout(t);
    } else if (deleting && charIdx > 0) {
      const t = setTimeout(() => { setDisplay(current.slice(0, charIdx - 1)); setCharIdx(c => c - 1); }, speed / 2);
      return () => clearTimeout(t);
    } else if (deleting && charIdx === 0) {
      setDeleting(false);
      setTextIdx(i => (i + 1) % texts.length);
    }
  }, [charIdx, deleting, textIdx, texts, speed, pause]);

  return (
    <span>
      {display}
      <span style={{
        display: 'inline-block', width: '2px', height: '1em',
        background: '#FFB800', marginLeft: '2px',
        animation: 'blink-cursor 0.8s step-end infinite',
        verticalAlign: 'text-bottom',
      }} />
    </span>
  );
}

// ── Tournament Banner ─────────────────────────────────────────────────────────
const TOURNAMENT_END = new Date('2025-04-30T23:59:59-05:00');

function useTournamentCountdown() {
  const [time, setTime] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0, ended: false });
  useEffect(() => {
    function tick() {
      const diff = TOURNAMENT_END.getTime() - Date.now();
      if (diff <= 0) { setTime(t => ({ ...t, ended: true })); return; }
      setTime({
        days:    Math.floor(diff / (1000 * 60 * 60 * 24)),
        hours:   Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((diff % (1000 * 60)) / 1000),
        ended:   false,
      });
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function CountdownUnit({ value, label }) {
  return (
    <div style={{ textAlign: 'center', minWidth: '52px' }}>
      <div style={{
        fontFamily: 'IBM Plex Mono', fontSize: 'clamp(1.5rem, 3vw, 2.1rem)',
        fontWeight: 900, color: '#FFB800', lineHeight: 1,
        background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.25)',
        borderRadius: '8px', padding: '8px 10px', minWidth: '52px',
        textAlign: 'center', display: 'block',
        boxShadow: '0 0 20px rgba(255,184,0,0.08)',
      }}>
        {String(value).padStart(2, '0')}
      </div>
      <div style={{ fontSize: '0.6rem', color: '#6A6A88', textTransform: 'uppercase', letterSpacing: '0.12em', marginTop: '5px' }}>
        {label}
      </div>
    </div>
  );
}

// Mock leaderboard preview data for landing page
const PREVIEW_LEADERS = [
  { rank: 1, name: 'SharpDave',   record: '18-7',  units: '+14.2', emoji: '🏆' },
  { rank: 2, name: 'BetKingJon',  record: '21-11', units: '+11.8', emoji: '🔥' },
  { rank: 3, name: 'EdgeFinder',  record: '15-6',  units: '+9.4',  emoji: '💎' },
  { rank: 4, name: 'ZeroJuice',   record: '12-5',  units: '+7.1',  emoji: '⚡' },
  { rank: 5, name: '???',         record: '—',     units: '—',     emoji: '🎯', you: true },
];

function TournamentBanner({ onCTAClick }) {
  const countdown = useTournamentCountdown();

  return (
    <div style={{
      position: 'relative',
      borderRadius: '20px',
      padding: '1.5px',
      overflow: 'hidden',
      boxShadow: '0 0 60px rgba(255,184,0,0.08), 0 20px 40px rgba(0,0,0,0.4)',
    }}>
      {/* Spinning conic gradient — the glow that travels around the border */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: '210%',
        height: '210%',
        transform: 'translate(-50%, -50%)',
        background: 'conic-gradient(from 0deg, transparent 0deg, rgba(255,184,0,0.15) 20deg, rgba(255,184,0,0.9) 50deg, rgba(255,220,80,1) 65deg, rgba(255,149,0,0.9) 80deg, rgba(255,184,0,0.15) 110deg, transparent 140deg)',
        animation: 'spin-border 3.5s linear infinite',
      }} />

      {/* Inner card sits on top, its solid bg hides the center of the gradient */}
      <div style={{
        position: 'relative',
        zIndex: 1,
        background: 'linear-gradient(135deg, #0D0D18 0%, #111120 50%, #0A0A14 100%)',
        borderRadius: '18.5px',
        overflow: 'hidden',
      }}>

      <div style={{ padding: 'clamp(1.5rem, 4vw, 2.5rem)' }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ flex: '1 1 280px' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              background: 'rgba(255,184,0,0.12)', border: '1px solid rgba(255,184,0,0.35)',
              borderRadius: '20px', padding: '3px 12px', marginBottom: '12px',
              fontSize: '0.68rem', fontWeight: 800, color: '#FFB800',
              textTransform: 'uppercase', letterSpacing: '0.12em',
              animation: 'pulse-glow 2.5s ease-in-out infinite',
            }}>
              🏆 LIVE TOURNAMENT
            </div>
            <h2 style={{
              fontSize: 'clamp(1.5rem, 4vw, 2.3rem)', fontWeight: 900, lineHeight: 1.15,
              color: '#EDEDF5', letterSpacing: '-0.03em', margin: '0 0 10px',
            }}>
              BetOS Pick Challenge
            </h2>
            <p style={{ color: '#8888AA', fontSize: '0.9rem', lineHeight: 1.6, margin: 0, maxWidth: '460px' }}>
              Compete against the sharpest bettors on the platform. Log your picks, build your record, and climb the leaderboard.
              Top performers earn prizes — and bragging rights money can't buy.
            </p>
          </div>

          {/* Prize pool */}
          <div style={{
            background: 'linear-gradient(135deg, rgba(255,184,0,0.12), rgba(255,149,0,0.06))',
            border: '1px solid rgba(255,184,0,0.25)',
            borderRadius: '14px', padding: '1.25rem 1.5rem', textAlign: 'center', flexShrink: 0,
            minWidth: '160px',
            boxShadow: '0 0 30px rgba(255,184,0,0.06)',
          }}>
            <div style={{ fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '6px' }}>
              Prize Pool
            </div>
            <div style={{
              fontFamily: 'IBM Plex Mono', fontSize: '2.2rem', fontWeight: 900,
              color: '#FFB800', lineHeight: 1, marginBottom: '4px',
            }}>
              $100
            </div>
            <div style={{ fontSize: '0.7rem', color: '#6A6A88' }}>+ Exclusive Perks</div>
          </div>
        </div>

        {/* Countdown + leaderboard preview */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>

          {/* Countdown */}
          <div>
            <div style={{ fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px' }}>
              {countdown.ended ? 'Tournament Ended' : 'Time Remaining'}
            </div>
            {!countdown.ended ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <CountdownUnit value={countdown.days}    label="Days"  />
                <span style={{ color: '#FFB800', fontSize: '1.8rem', fontWeight: 900, alignSelf: 'center', lineHeight: 1, marginBottom: '18px' }}>:</span>
                <CountdownUnit value={countdown.hours}   label="Hours" />
                <span style={{ color: '#FFB800', fontSize: '1.8rem', fontWeight: 900, alignSelf: 'center', lineHeight: 1, marginBottom: '18px' }}>:</span>
                <CountdownUnit value={countdown.minutes} label="Mins"  />
                <span style={{ color: '#FFB800', fontSize: '1.8rem', fontWeight: 900, alignSelf: 'center', lineHeight: 1, marginBottom: '18px' }}>:</span>
                <CountdownUnit value={countdown.seconds} label="Secs"  />
              </div>
            ) : (
              <div style={{ color: '#FFB800', fontWeight: 700 }}>Results being tabulated…</div>
            )}

            <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#666', lineHeight: 1.7 }}>
              <div>📅 Season-long competition</div>
              <div>✓ Free to enter — just sign up</div>
              <div>⚡ Verified picks earn bonus Sharp Score</div>
            </div>
          </div>

          {/* Leaderboard preview */}
          <div>
            <div style={{ fontSize: '0.65rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px' }}>
              Current Standings (Preview)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {PREVIEW_LEADERS.map(p => (
                <div key={p.rank} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '7px 10px', borderRadius: '7px',
                  background: p.you ? 'rgba(255,184,0,0.08)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${p.you ? 'rgba(255,184,0,0.25)' : 'rgba(255,255,255,0.05)'}`,
                  opacity: p.you ? 1 : 1,
                }}>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.72rem', color: '#555', minWidth: '20px' }}>
                    #{p.rank}
                  </span>
                  <span style={{ fontSize: '0.9rem' }}>{p.emoji}</span>
                  <span style={{
                    flex: 1, fontSize: '0.82rem', fontWeight: 600,
                    color: p.you ? '#FFB800' : '#EDEDF5',
                    fontStyle: p.you ? 'italic' : 'normal',
                  }}>
                    {p.you ? 'You? 👈' : p.name}
                  </span>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.72rem', color: '#888' }}>{p.record}</span>
                  <span style={{
                    fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', fontWeight: 700,
                    color: p.you ? '#666' : '#4ade80',
                  }}>
                    {p.units}u
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={onCTAClick}
            style={{
              background: 'linear-gradient(135deg, #FFB800, #FF9500)',
              border: 'none', borderRadius: '10px', padding: '12px 28px',
              color: '#000', fontWeight: 800, fontSize: '0.9rem',
              cursor: 'pointer', fontFamily: 'inherit',
              boxShadow: '0 4px 20px rgba(255,184,0,0.3)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(255,184,0,0.45)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(255,184,0,0.3)'; }}
          >
            🏆 Enter the Tournament — Free
          </button>
          <span style={{ fontSize: '0.75rem', color: '#6A6A88' }}>
            No credit card. No entry fee. Just sharp picks.
          </span>
        </div>
      </div>

      </div>{/* /inner card */}

      <style>{`
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(255,184,0,0.2); }
          50%       { box-shadow: 0 0 18px rgba(255,184,0,0.5); }
        }
      `}</style>
    </div>
  );
}

// ── Feature card with hover glow ─────────────────────────────────────────────
const FEATURES = [
  { icon: '📡', label: 'Live Scores', desc: 'MLB, NBA, NFL, NHL — real-time scoreboard with smart context', color: '#FF6B35' },
  { icon: '🎯', label: 'BetOS AI', desc: 'AI-powered pick analysis with live web search', color: '#FFB800' },
  { icon: '📊', label: 'Edge Finder', desc: '20+ built-in sharp betting trends and angles', color: '#4E9BF5' },
  { icon: '🏥', label: 'Injury Intel', desc: 'Real-time injury scanning from Twitter + beat reporters', color: '#00D48B' },
  { icon: '📈', label: 'Pick Tracker', desc: 'Full P/L tracking, equity curves, and heat metrics', color: '#9B6DFF' },
  { icon: '🎤', label: 'Voice Input', desc: 'Talk to BetOS — hands-free pick analysis', color: '#FF4560' },
];

const TAGLINES = [
  'Finding edges the books don\'t want you to see.',
  'Scanning every slate for the sharpest play.',
  'Your AI-powered sports intelligence terminal.',
  'No paywalls. No limits. Just pure edge.',
];

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode]         = useState('login');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername]  = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [mounted, setMounted]   = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('betos_demo') === 'true') {
      router.push('/dashboard?demo=true');
      return;
    }
    if (SUPABASE_CONFIGURED) {
      getUser().then(u => { if (u) router.push('/dashboard'); });
    }
  }, [router]);

  function handleDemoMode() {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('betos_demo', 'true');
    router.push('/dashboard?demo=true');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);

    if (!SUPABASE_CONFIGURED) {
      setError('Supabase not configured — use Demo Mode to explore the app.');
      setLoading(false); return;
    }

    if (mode === 'login') {
      const { error } = await signIn(email, password);
      if (error) { setError(error.message); setLoading(false); return; }
      router.push('/dashboard');
    } else {
      if (username.length < 2) { setError('Username must be at least 2 characters.'); setLoading(false); return; }
      const { error } = await signUp(email, password, username);
      if (error) { setError(error.message); setLoading(false); return; }
      setSuccess('Account created! Check your email to verify, then log in.');
      setMode('login');
    }
    setLoading(false);
  }

  async function handleGoogle() {
    setError(''); setLoading(true);
    const { error } = await signInWithGoogle();
    if (error) { setError(error.message); setLoading(false); }
    // on success, browser redirects — no need to setLoading(false)
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    setForgotLoading(true); setError(''); setSuccess('');
    const { error } = await resetPassword(forgotEmail);
    setForgotLoading(false);
    if (error) { setError(error.message); return; }
    setSuccess('Password reset email sent! Check your inbox.');
    setShowForgot(false);
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#050508',
      fontFamily: 'Inter, system-ui, sans-serif',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Background particles */}
      <ParticleField />

      {/* Radial glow behind hero */}
      <div style={{
        position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)',
        width: '900px', height: '900px',
        background: 'radial-gradient(circle, rgba(255,184,0,0.08) 0%, rgba(255,184,0,0.02) 40%, transparent 70%)',
        pointerEvents: 'none', zIndex: 0,
      }} />

      {/* ═══════════════════════════════════════════════════════════
          HERO SECTION
      ═══════════════════════════════════════════════════════════ */}
      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: '1100px', margin: '0 auto',
        padding: '0 1.5rem',
      }}>
        {/* Nav bar */}
        <nav style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1rem 0',
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(-10px)',
          transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
          gap: '8px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {/* logo.svg is the full horizontal lockup (icon + wordmark) */}
            <img src="/logo.svg" alt="BetOS" style={{ height: 'clamp(26px, 5vw, 36px)', width: 'auto' }} />
            <span style={{
              fontSize: '0.5rem', color: '#FFB800', border: '1px solid rgba(255,184,0,0.3)',
              borderRadius: '4px', padding: '1px 5px', fontWeight: 700, letterSpacing: '0.08em',
            }}>BETA</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <button
              onClick={() => document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' })}
              style={{
                padding: '6px 12px', borderRadius: '8px',
                border: '1px solid rgba(255,184,0,0.3)', background: 'rgba(255,184,0,0.06)',
                color: '#FFB800', fontSize: 'clamp(0.7rem, 2.5vw, 0.82rem)', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.2s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.06)'; }}
            >
              Log In
            </button>
            <button
              onClick={() => { setMode('signup'); document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' }); }}
              style={{
                padding: '6px 12px', borderRadius: '8px',
                border: 'none', background: 'linear-gradient(135deg, #FFB800, #FF9500)',
                color: '#000', fontSize: 'clamp(0.7rem, 2.5vw, 0.82rem)', fontWeight: 700, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.2s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(255,184,0,0.4)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
            >
              Sign Up Free
            </button>
          </div>
        </nav>

        {/* Hero content */}
        <div style={{
          textAlign: 'center',
          paddingTop: 'clamp(2rem, 8vw, 5rem)',
          paddingBottom: 'clamp(2rem, 6vw, 4rem)',
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.8s 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {/* Brand icon */}
          <div style={{
            marginBottom: 'clamp(0.75rem, 3vw, 1.5rem)',
            display: 'flex', justifyContent: 'center',
            animation: 'goat-float 5s ease-in-out infinite',
            filter: 'drop-shadow(0 0 40px rgba(255,184,0,0.35))',
          }}>
            <img
              src="/icon.svg"
              alt="BetOS"
              style={{ width: 'clamp(80px, 18vw, 130px)', height: 'auto' }}
            />
          </div>

          {/* Main headline */}
          <h1 style={{
            fontSize: 'clamp(2.2rem, 5vw, 3.8rem)',
            fontWeight: 900,
            letterSpacing: '-0.04em',
            lineHeight: 1.1,
            marginBottom: '1.5rem',
            color: '#EDEDF5',
          }}>
            The Sharpest AI in{' '}
            <span style={{
              background: 'linear-gradient(135deg, #FFB800 0%, #FF6B35 50%, #FFB800 100%)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              animation: 'gold-shimmer 3s linear infinite',
            }}>
              Sports Betting
            </span>
          </h1>

          {/* Animated tagline */}
          <div style={{
            fontSize: 'clamp(0.95rem, 2vw, 1.2rem)',
            color: '#6A6A88',
            minHeight: '2rem',
            marginBottom: '2.5rem',
          }}>
            <TypeWriter texts={TAGLINES} />
          </div>

          {/* CTA buttons */}
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap', padding: '0 0.5rem' }}>
            <button
              onClick={() => { setMode('signup'); document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' }); }}
              style={{
                padding: 'clamp(10px, 2.5vw, 14px) clamp(20px, 5vw, 36px)', borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #FFB800 0%, #FF9500 100%)',
                color: '#000', fontSize: 'clamp(0.85rem, 2.5vw, 1rem)', fontWeight: 800, cursor: 'pointer',
                fontFamily: 'inherit', letterSpacing: '-0.01em',
                boxShadow: '0 4px 30px rgba(255,184,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
                transition: 'all 0.2s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(255,184,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 30px rgba(255,184,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2)'; }}
            >
              Get Started Free
            </button>
            <button
              onClick={handleDemoMode}
              style={{
                padding: 'clamp(10px, 2.5vw, 14px) clamp(20px, 5vw, 36px)', borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.03)',
                color: '#EDEDF5', fontSize: 'clamp(0.85rem, 2.5vw, 1rem)', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.2s',
                backdropFilter: 'blur(10px)', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
            >
              Try Demo Mode
            </button>
          </div>

          {/* Social proof numbers */}
          <div style={{
            display: 'flex', justifyContent: 'center', gap: 'clamp(1.2rem, 4vw, 2.5rem)',
            marginTop: 'clamp(2rem, 5vw, 4rem)',
            flexWrap: 'wrap',
          }}>
            {[
              { value: 8, suffix: '+', label: 'Sports covered' },
              { value: 40, suffix: '+', label: 'Sportsbooks tracked' },
              { value: 20, suffix: '+', label: 'Sharp trends built-in' },
            ].map((stat, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: 'clamp(1.4rem, 4vw, 2rem)', fontWeight: 900, color: '#FFB800',
                  fontFamily: 'IBM Plex Mono, monospace',
                  lineHeight: 1,
                }}>
                  <AnimCounter end={stat.value} suffix={stat.suffix} duration={1500 + i * 300} />
                </div>
                <div style={{ fontSize: 'clamp(0.6rem, 2vw, 0.72rem)', color: '#6A6A88', marginTop: '4px', letterSpacing: '0.04em' }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          FEATURES GRID
      ═══════════════════════════════════════════════════════════ */}
      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: '1100px', margin: '0 auto',
        padding: '2rem 1.5rem 5rem',
      }}>
        <div style={{
          textAlign: 'center', marginBottom: '2.5rem',
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(15px)',
          transition: 'all 0.8s 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          <div style={{ fontSize: '0.65rem', color: '#FFB800', letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '8px' }}>
            EVERYTHING YOU NEED
          </div>
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 800, color: '#EDEDF5', letterSpacing: '-0.03em' }}>
            Built for serious bettors
          </h2>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))',
          gap: '1rem',
        }}>
          {FEATURES.map((f, i) => (
            <div
              key={i}
              style={{
                background: '#0C0C14',
                border: '1px solid #1A1A24',
                borderRadius: '14px',
                padding: '1.5rem',
                position: 'relative',
                overflow: 'hidden',
                transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                cursor: 'default',
                opacity: mounted ? 1 : 0,
                transform: mounted ? 'translateY(0)' : 'translateY(20px)',
                transitionDelay: `${0.5 + i * 0.08}s`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = f.color + '40';
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = `0 8px 30px ${f.color}15`;
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#1A1A24';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              {/* Gradient accent line at top */}
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
                background: `linear-gradient(90deg, ${f.color}, transparent)`,
                opacity: 0.6,
              }} />
              <div style={{ fontSize: '1.6rem', marginBottom: '0.75rem' }}>{f.icon}</div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#EDEDF5', marginBottom: '6px' }}>
                {f.label}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#6A6A88', lineHeight: 1.6 }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          TOURNAMENT SECTION
      ═══════════════════════════════════════════════════════════ */}
      <div style={{
        position: 'relative', zIndex: 1,
        maxWidth: '900px', margin: '0 auto',
        padding: '0 1.5rem 4rem',
      }}>
        <TournamentBanner onCTAClick={() => {
          document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' });
        }} />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          AUTH SECTION
      ═══════════════════════════════════════════════════════════ */}
      <div
        id="auth-section"
        style={{
          position: 'relative', zIndex: 1,
          maxWidth: '460px', margin: '0 auto',
          padding: '0 1.5rem 5rem',
        }}
      >
        {/* Glass card */}
        <div style={{
          background: 'rgba(17,17,24,0.8)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,184,0,0.15)',
          borderRadius: '20px',
          padding: '2rem',
          boxShadow: '0 0 80px rgba(255,184,0,0.06), 0 20px 60px rgba(0,0,0,0.5)',
        }}>
          {/* Mode toggle */}
          <div style={{
            display: 'flex',
            background: '#0C0C14',
            borderRadius: '10px',
            padding: '3px',
            marginBottom: '1.5rem',
            border: '1px solid #1A1A24',
          }}>
            {['login', 'signup'].map(m => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(''); setSuccess(''); }}
                style={{
                  flex: 1, padding: '0.6rem', border: 'none', borderRadius: '8px',
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: mode === m
                    ? 'linear-gradient(135deg, rgba(255,184,0,0.15), rgba(255,184,0,0.05))'
                    : 'transparent',
                  color: mode === m ? '#FFB800' : '#6A6A88',
                  fontWeight: mode === m ? 700 : 500,
                  fontSize: '0.88rem',
                  transition: 'all 0.2s',
                  letterSpacing: '-0.01em',
                }}
              >
                {m === 'login' ? 'Log In' : 'Sign Up'}
              </button>
            ))}
          </div>

          {/* Google Sign In */}
          <button
            type="button"
            onClick={handleGoogle}
            disabled={loading}
            style={{
              width: '100%', padding: '0.72rem 1rem',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '10px', cursor: loading ? 'wait' : 'pointer',
              fontFamily: 'inherit', fontSize: '0.88rem', fontWeight: 600,
              color: '#EDEDF5',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              marginBottom: '1rem',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.22)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'; }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            Continue with Google
          </button>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <div style={{ flex: 1, height: '1px', background: '#1A1A24' }} />
            <span style={{ color: '#6A6A88', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: '#1A1A24' }} />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {mode === 'signup' && (
              <div>
                <label style={labelStyle}>Username</label>
                <input
                  type="text" placeholder="YourHandle"
                  value={username} onChange={e => setUsername(e.target.value)} required
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = '#FFB800'; e.target.style.boxShadow = '0 0 0 3px rgba(255,184,0,0.08)'; }}
                  onBlur={e => { e.target.style.borderColor = '#1A1A24'; e.target.style.boxShadow = 'none'; }}
                />
              </div>
            )}
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email" placeholder="you@example.com"
                value={email} onChange={e => setEmail(e.target.value)} required
                style={inputStyle}
                onFocus={e => { e.target.style.borderColor = '#FFB800'; e.target.style.boxShadow = '0 0 0 3px rgba(255,184,0,0.08)'; }}
                onBlur={e => { e.target.style.borderColor = '#1A1A24'; e.target.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Password</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    onClick={() => { setShowForgot(true); setError(''); setSuccess(''); setForgotEmail(email); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#6A6A88', fontSize: '0.7rem', fontFamily: 'inherit',
                      padding: 0, transition: 'color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#FFB800'}
                    onMouseLeave={e => e.currentTarget.style.color = '#6A6A88'}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                type="password" placeholder="••••••••"
                value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
                style={inputStyle}
                onFocus={e => { e.target.style.borderColor = '#FFB800'; e.target.style.boxShadow = '0 0 0 3px rgba(255,184,0,0.08)'; }}
                onBlur={e => { e.target.style.borderColor = '#1A1A24'; e.target.style.boxShadow = 'none'; }}
              />
            </div>

            {error && (
              <div style={{
                padding: '0.65rem 0.9rem',
                background: 'rgba(255,69,96,0.06)',
                border: '1px solid rgba(255,69,96,0.2)',
                borderRadius: '8px', color: '#FF4560', fontSize: '0.82rem',
              }}>
                {error}
              </div>
            )}
            {success && (
              <div style={{
                padding: '0.65rem 0.9rem',
                background: 'rgba(0,212,139,0.06)',
                border: '1px solid rgba(0,212,139,0.2)',
                borderRadius: '8px', color: '#00D48B', fontSize: '0.82rem',
              }}>
                {success}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                marginTop: '0.3rem', padding: '0.75rem', width: '100%',
                borderRadius: '10px', border: 'none', cursor: loading ? 'wait' : 'pointer',
                background: loading
                  ? '#333'
                  : 'linear-gradient(135deg, #FFB800 0%, #FF9500 100%)',
                color: loading ? '#666' : '#000',
                fontSize: '0.92rem', fontWeight: 800, fontFamily: 'inherit',
                letterSpacing: '-0.01em',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(255,184,0,0.3)',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { if (!loading) { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 25px rgba(255,184,0,0.45)'; } }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = loading ? 'none' : '0 4px 20px rgba(255,184,0,0.3)'; }}
            >
              {loading ? 'Loading...' : mode === 'login' ? 'Log In' : 'Create Account'}
            </button>
          </form>

          {/* Divider before demo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.5rem 0' }}>
            <div style={{ flex: 1, height: '1px', background: '#1A1A24' }} />
            <span style={{ color: '#6A6A88', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>or</span>
            <div style={{ flex: 1, height: '1px', background: '#1A1A24' }} />
          </div>

          {/* Demo Mode button */}
          <button
            onClick={handleDemoMode}
            style={{
              width: '100%', padding: '0.7rem 1rem',
              background: 'rgba(255,184,0,0.04)',
              border: '1px solid rgba(255,184,0,0.15)',
              borderRadius: '10px', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.1)'; e.currentTarget.style.borderColor = 'rgba(255,184,0,0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,184,0,0.15)'; }}
          >
            <span style={{ fontSize: '1.1rem' }}>🎯</span>
            <div style={{ textAlign: 'left' }}>
              <div style={{ color: '#FFB800', fontWeight: 700, fontSize: '0.85rem', lineHeight: 1 }}>Try Demo Mode</div>
              <div style={{ color: '#6A6A88', fontSize: '0.7rem', marginTop: '3px' }}>No account needed — picks save to browser</div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', color: '#4A4A60', fontSize: '0.68rem', marginTop: '1.5rem', lineHeight: 1.7 }}>
          Self-hosted. No subscriptions. Your data stays yours.
        </p>
      </div>

      {/* ── Forgot Password Modal ─────────────────────────────────────────── */}
      {showForgot && (
        <div
          onClick={() => setShowForgot(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#111118', border: '1px solid rgba(255,184,0,0.2)',
              borderRadius: '16px', padding: '2rem',
              width: '100%', maxWidth: '380px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#EDEDF5', marginBottom: '4px' }}>Reset password</div>
              <div style={{ fontSize: '0.78rem', color: '#6A6A88' }}>We'll email you a link to set a new password.</div>
            </div>
            <form onSubmit={handleForgotPassword} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={labelStyle}>Email</label>
                <input
                  type="email" placeholder="you@example.com"
                  value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required
                  style={inputStyle}
                  onFocus={e => { e.target.style.borderColor = '#FFB800'; e.target.style.boxShadow = '0 0 0 3px rgba(255,184,0,0.08)'; }}
                  onBlur={e => { e.target.style.borderColor = '#1A1A24'; e.target.style.boxShadow = 'none'; }}
                  autoFocus
                />
              </div>
              {error && (
                <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(255,69,96,0.06)', border: '1px solid rgba(255,69,96,0.2)', borderRadius: '8px', color: '#FF4560', fontSize: '0.8rem' }}>
                  {error}
                </div>
              )}
              {success && (
                <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(0,212,139,0.06)', border: '1px solid rgba(0,212,139,0.2)', borderRadius: '8px', color: '#00D48B', fontSize: '0.8rem' }}>
                  {success}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '0.25rem' }}>
                <button
                  type="button" onClick={() => setShowForgot(false)}
                  style={{
                    flex: 1, padding: '0.65rem', borderRadius: '9px',
                    border: '1px solid #1A1A24', background: 'transparent',
                    color: '#6A6A88', fontSize: '0.85rem', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >Cancel</button>
                <button
                  type="submit" disabled={forgotLoading}
                  style={{
                    flex: 1, padding: '0.65rem', borderRadius: '9px', border: 'none',
                    background: forgotLoading ? '#333' : 'linear-gradient(135deg, #FFB800, #FF9500)',
                    color: forgotLoading ? '#666' : '#000',
                    fontSize: '0.85rem', fontWeight: 800,
                    cursor: forgotLoading ? 'wait' : 'pointer', fontFamily: 'inherit',
                  }}
                >{forgotLoading ? 'Sending...' : 'Send Reset Link'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          INLINE KEYFRAMES STYLE TAG
      ═══════════════════════════════════════════════════════════ */}
      <style>{`
        @keyframes particle-float {
          0%   { transform: translateY(0) translateX(0); opacity: 0; }
          10%  { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(-100vh) translateX(${Math.random() > 0.5 ? '' : '-'}30px); opacity: 0; }
        }
        @keyframes blink-cursor {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        /* Mobile overrides for landing page */
        @media (max-width: 640px) {
          #auth-section { padding-left: 1rem !important; padding-right: 1rem !important; }
        }
      `}</style>
    </div>
  );
}

// ── Shared styles ────────────────────────────────────────────────────────────
const labelStyle = {
  display: 'block', marginBottom: '6px',
  fontSize: '0.75rem', fontWeight: 600,
  color: '#9494B8', letterSpacing: '0.04em',
};

const inputStyle = {
  width: '100%', padding: '0.7rem 0.9rem',
  background: '#0C0C14',
  border: '1px solid #1A1A24',
  borderRadius: '9px',
  color: '#EDEDF5', fontSize: '0.9rem',
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'all 0.15s',
  boxSizing: 'border-box',
};
