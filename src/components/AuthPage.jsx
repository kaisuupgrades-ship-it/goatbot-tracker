'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signUp, getUser } from '@/lib/supabase';

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

// ── Feature card with hover glow ─────────────────────────────────────────────
const FEATURES = [
  { icon: '📡', label: 'Live Scores', desc: 'MLB, NBA, NFL, NHL — real-time scoreboard with smart context', color: '#FF6B35' },
  { icon: '🐐', label: 'GOAT BOT AI', desc: 'Grok-4 powered pick analysis with live web search', color: '#FFB800' },
  { icon: '📊', label: 'Edge Finder', desc: '20+ built-in sharp betting trends and angles', color: '#4E9BF5' },
  { icon: '🏥', label: 'Injury Intel', desc: 'Real-time injury scanning from Twitter + beat reporters', color: '#00D48B' },
  { icon: '📈', label: 'Pick Tracker', desc: 'Full P/L tracking, equity curves, and heat metrics', color: '#9B6DFF' },
  { icon: '🎤', label: 'Voice Input', desc: 'Talk to GOAT BOT — hands-free pick analysis', color: '#FF4560' },
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

  useEffect(() => {
    setMounted(true);
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('goatbot_demo') === 'true') {
      router.push('/dashboard?demo=true');
      return;
    }
    if (SUPABASE_CONFIGURED) {
      getUser().then(u => { if (u) router.push('/dashboard'); });
    }
  }, [router]);

  function handleDemoMode() {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('goatbot_demo', 'true');
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
          padding: '1.25rem 0',
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(-10px)',
          transition: 'all 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{
              fontSize: '1.6rem',
              animation: 'goat-float 4s ease-in-out infinite',
            }}>🐐</span>
            <span style={{
              fontWeight: 900, fontSize: '1.2rem', color: '#FFB800',
              letterSpacing: '-0.04em',
            }}>GOAT BOT</span>
            <span style={{
              fontSize: '0.55rem', color: '#FFB800', border: '1px solid rgba(255,184,0,0.3)',
              borderRadius: '4px', padding: '1px 6px', fontWeight: 700, letterSpacing: '0.1em',
              marginLeft: '4px',
            }}>BETA</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' })}
              style={{
                padding: '7px 18px', borderRadius: '8px',
                border: '1px solid rgba(255,184,0,0.3)', background: 'rgba(255,184,0,0.06)',
                color: '#FFB800', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.06)'; }}
            >
              Log In
            </button>
            <button
              onClick={() => { setMode('signup'); document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' }); }}
              style={{
                padding: '7px 18px', borderRadius: '8px',
                border: 'none', background: 'linear-gradient(135deg, #FFB800, #FF9500)',
                color: '#000', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                fontFamily: 'inherit', transition: 'all 0.2s',
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
          paddingTop: '5rem',
          paddingBottom: '4rem',
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.8s 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {/* GOAT icon */}
          <div style={{
            fontSize: '4.5rem', lineHeight: 1,
            marginBottom: '1.5rem',
            animation: 'goat-float 5s ease-in-out infinite',
            filter: 'drop-shadow(0 0 40px rgba(255,184,0,0.3))',
          }}>
            🐐
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
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => { setMode('signup'); document.getElementById('auth-section')?.scrollIntoView({ behavior: 'smooth' }); }}
              style={{
                padding: '14px 36px', borderRadius: '12px',
                border: 'none',
                background: 'linear-gradient(135deg, #FFB800 0%, #FF9500 100%)',
                color: '#000', fontSize: '1rem', fontWeight: 800, cursor: 'pointer',
                fontFamily: 'inherit', letterSpacing: '-0.01em',
                boxShadow: '0 4px 30px rgba(255,184,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 40px rgba(255,184,0,0.5), inset 0 1px 0 rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 4px 30px rgba(255,184,0,0.35), inset 0 1px 0 rgba(255,255,255,0.2)'; }}
            >
              Get Started Free
            </button>
            <button
              onClick={handleDemoMode}
              style={{
                padding: '14px 36px', borderRadius: '12px',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.03)',
                color: '#EDEDF5', fontSize: '1rem', fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 0.2s',
                backdropFilter: 'blur(10px)',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
            >
              Try Demo Mode
            </button>
          </div>

          {/* Social proof numbers */}
          <div style={{
            display: 'flex', justifyContent: 'center', gap: '2.5rem',
            marginTop: '4rem',
            flexWrap: 'wrap',
          }}>
            {[
              { value: 8, suffix: '+', label: 'Sports covered' },
              { value: 40, suffix: '+', label: 'Sportsbooks tracked' },
              { value: 20, suffix: '+', label: 'Sharp trends built-in' },
            ].map((stat, i) => (
              <div key={i} style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '2rem', fontWeight: 900, color: '#FFB800',
                  fontFamily: 'IBM Plex Mono, monospace',
                  lineHeight: 1,
                }}>
                  <AnimCounter end={stat.value} suffix={stat.suffix} duration={1500 + i * 300} />
                </div>
                <div style={{ fontSize: '0.72rem', color: '#6A6A88', marginTop: '6px', letterSpacing: '0.04em' }}>
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
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
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
              <label style={labelStyle}>Password</label>
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

          {/* Divider */}
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
            <span style={{ fontSize: '1.1rem' }}>🐐</span>
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
