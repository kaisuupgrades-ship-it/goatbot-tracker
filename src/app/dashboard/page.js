'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getUser, fetchPicks, fetchContest } from '@/lib/supabase';
import { loadDemoPicks, loadDemoContest } from '@/lib/demoData';
import Dashboard from '@/components/Dashboard';
import { Suspense } from 'react';

// ── Loading messages — cycle through as bar fills ──────────────────────────────
const LOAD_MSGS = [
  { pct:  0, text: 'Booting BetOS intelligence systems...'       },
  { pct: 14, text: 'Connecting to live sportsbook feeds...'     },
  { pct: 28, text: 'Scanning sharp money signals...'            },
  { pct: 45, text: 'Calculating closing line value...'          },
  { pct: 62, text: 'Loading your picks and contest data...'     },
  { pct: 78, text: 'Calibrating the edge prediction model...'   },
  { pct: 93, text: 'BetOS locked and loaded. Let\'s eat.'       },
];

// ── BetOS Splash Screen ───────────────────────────────────────────────────────
function BetOSSplash({ dataReady, onComplete }) {
  const [progress, setProgress]   = useState(0);
  const [barDone,  setBarDone]    = useState(false);
  const [fading,   setFading]     = useState(false);
  const [msgIdx,   setMsgIdx]     = useState(0);

  // Smooth progress bar over 3 seconds
  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      const pct = Math.min((Date.now() - start) / 3000 * 100, 100);
      setProgress(pct);
      // Pick the highest matching message
      let idx = 0;
      for (let i = 0; i < LOAD_MSGS.length; i++) {
        if (pct >= LOAD_MSGS[i].pct) idx = i;
      }
      setMsgIdx(idx);
      if (pct >= 100) { clearInterval(tick); setBarDone(true); }
    }, 40);
    return () => clearInterval(tick);
  }, []);

  // Once bar is done AND real data is ready -> fade out -> call onComplete
  useEffect(() => {
    if (!barDone || !dataReady) return;
    setFading(true);
    const t = setTimeout(onComplete, 650);
    return () => clearTimeout(t);
  }, [barDone, dataReady, onComplete]);

  const currentMsg = LOAD_MSGS[msgIdx].text;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'radial-gradient(ellipse 80% 60% at 50% 30%, #0f0e00 0%, #09090F 55%, #09090F 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      userSelect: 'none', pointerEvents: fading ? 'none' : 'all',
      opacity: fading ? 0 : 1, transition: 'opacity 0.65s cubic-bezier(0.4,0,0.2,1)',
    }}>

      {/* Ambient glow behind goat */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -60%)',
        width: '320px', height: '220px',
        background: 'radial-gradient(ellipse, rgba(255,184,0,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Floating logo icon */}
      <div style={{
        marginBottom: '1.4rem',
        animation: 'goat-float 2.8s ease-in-out infinite',
        filter: 'drop-shadow(0 0 28px rgba(255,184,0,0.35))',
      }}>
        <img
          src="/icon.svg"
          alt="BetOS"
          style={{ width: 'clamp(90px, 18vw, 130px)', height: 'auto' }}
        />
      </div>

      {/* BetOS wordmark - text only, icon is already shown above */}
      <div style={{ marginBottom: '0.35rem' }}>
        <img
          src="/wordmark.svg"
          alt="BetOS"
          style={{ height: 'clamp(36px, 8vw, 54px)', width: 'auto' }}
        />
      </div>

      {/* Subtitle */}
      <div style={{
        color: '#35354a',
        fontSize: '0.58rem',
        fontWeight: 700,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        marginBottom: '2.8rem',
        animation: 'splash-fadein 0.8s ease 0.2s both',
      }}>
        AI-Powered Sports Betting OS
      </div>

      {/* Progress bar + message */}
      <div style={{ width: 'min(380px, 88vw)', animation: 'splash-fadein 0.8s ease 0.4s both' }}>
        {/* Track */}
        <div style={{
          height: '2px', background: '#1a1a26', borderRadius: '99px',
          overflow: 'hidden', marginBottom: '0.85rem',
          boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.5)',
        }}>
          {/* Fill */}
          <div style={{
            height: '100%', borderRadius: '99px',
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #CC9200, #FFB800 50%, #FFD700)',
            backgroundSize: '200% auto',
            animation: 'bar-shimmer 1.2s linear infinite',
            boxShadow: '0 0 8px rgba(255,184,0,0.5)',
            transition: 'width 0.06s linear',
          }} />
        </div>

        {/* Message - keyed so it re-animates when it changes */}
        <div style={{ height: '1.4em', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            key={currentMsg}
            style={{
              color: '#48486a',
              fontSize: '0.7rem',
              fontFamily: "'IBM Plex Mono', monospace",
              letterSpacing: '0.025em',
              animation: 'msg-appear 0.3s ease both',
              textAlign: 'center',
            }}
          >
            {currentMsg}
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{
        display: 'flex', gap: '24px', marginTop: '2.8rem',
        flexWrap: 'wrap', justifyContent: 'center',
        animation: 'splash-fadein 1s ease 0.7s both',
      }}>
        {[
          { icon: '[MLB]', label: '8 SPORTS' },
          { icon: '[live]', label: 'LIVE ODDS' },
          { icon: '[AI]', label: 'AI PICKS'  },
          { icon: '[sharp]', label: 'CLV ENGINE' },
        ].map(({ icon, label }) => (
          <div key={label} style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            color: '#2e2e45', fontSize: '0.58rem', fontWeight: 800,
            letterSpacing: '0.14em',
          }}>
            <span style={{ fontSize: '0.72rem', opacity: 0.45 }}>{icon}</span>
            {label}
          </div>
        ))}
      </div>

      {/* Progress percentage (subtle) */}
      <div style={{
        position: 'absolute', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}>
        <div style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '0.58rem', color: '#252535', letterSpacing: '0.1em',
        }}>
          {Math.round(progress).toString().padStart(3, ' ')}%
        </div>
        <div style={{ color: '#1e1e2e', fontSize: '0.55rem', letterSpacing: '0.1em' }}>
          v2.0 . ALPHA
        </div>
      </div>
    </div>
  );
}

// ── Main Dashboard Loader ──────────────────────────────────────────────────────
function DashboardInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();

  const [user,       setUser]       = useState(null);
  const [picks,      setPicks]      = useState([]);
  const [contest,    setContest]    = useState(null);
  const [dataReady,  setDataReady]  = useState(false);
  const [isDemo,     setIsDemo]     = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  const handleSplashComplete = useCallback(() => setShowSplash(false), []);

  useEffect(() => {
    async function init() {
      const demoParam   = searchParams.get('demo') === 'true';
      const demoSession = typeof sessionStorage !== 'undefined' && sessionStorage.getItem('betos_demo') === 'true';

      if (demoParam || demoSession) {
        sessionStorage.setItem('betos_demo', 'true');
        setIsDemo(true);
        setUser({ id: 'demo', email: 'demo@betos.local', user_metadata: { username: 'Demo User' } });
        setPicks(loadDemoPicks());
        setContest(loadDemoContest());
        setDataReady(true);
        return;
      }

      const u = await getUser();
      if (!u) { router.push('/'); return; }
      setUser(u);

      // Fetch picks with retry - on mobile, auth session can take a moment to propagate
      let picksData = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await fetchPicks(u.id);
        if (result.data && result.data.length > 0) { picksData = result.data; break; }
        if (!result.error && result.data !== null) { picksData = result.data; break; }
        // Wait a bit and retry - session may not be propagated yet on mobile
        if (attempt < 2) await new Promise(r => setTimeout(r, 600));
      }

      const { data: contestData } = await fetchContest(u.id);
      setPicks(picksData || []);
      setContest(contestData);
      setDataReady(true);
    }
    init();
  }, [router, searchParams]);

  return (
    <>
      {/* Splash overlay - always renders first; fades once bar done + data ready */}
      {showSplash && (
        <BetOSSplash dataReady={dataReady} onComplete={handleSplashComplete} />
      )}

      {/* Dashboard - render behind splash (or alone once splash is gone) */}
      {dataReady && !showSplash && (
        <Dashboard
          user={user}
          initialPicks={picks}
          initialContest={contest}
          isDemo={isDemo}
        />
      )}

      {/* Bare skeleton while splash is still running so page isn't pure black underneath */}
      {showSplash && (
        <div style={{ minHeight: '100vh', background: '#09090F' }} />
      )}
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#09090F' }} />
    }>
      <DashboardInner />
    </Suspense>
  );
}
