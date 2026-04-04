'use client';
import { useState, useEffect } from 'react';
import { signOut } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Sidebar       from './Sidebar';
import TrackerTab    from './tabs/TrackerTab';
import ScoreboardTab from './tabs/ScoreboardTab';
import OddsTab       from './tabs/OddsTab';
import TrendsTab     from './tabs/TrendsTab';
import HistoryTab    from './tabs/HistoryTab';
import AnalyzerTab      from './tabs/AnalyzerTab';
import LeaderboardTab    from './tabs/LeaderboardTab';
import FeaturedGamesTab  from './tabs/FeaturedGamesTab';
import AdminTab          from './tabs/AdminTab';

const ADMIN_EMAIL = 'kaisuupgrades@gmail.com';

// ── Announcement Banner — reads from admin broadcast (settings table) ──────────
function AnnouncementBanner() {
  const [text,      setText]      = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    async function fetchAnnouncement() {
      try {
        const res  = await fetch('/api/settings?key=announcement');
        const data = await res.json();
        if (data.value) {
          // Only show if not dismissed for this version (key = updatedAt timestamp)
          const dismissKey = `goatbot_banner_dismissed_${data.updated_at || 'default'}`;
          if (sessionStorage.getItem(dismissKey)) return; // already dismissed this session
          setText(data.value);
          setUpdatedAt(data.updated_at);
        }
      } catch {}
    }
    fetchAnnouncement();
    // Re-check every 5 minutes in case admin broadcasts a new message
    const interval = setInterval(fetchAnnouncement, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  function dismiss() {
    const dismissKey = `goatbot_banner_dismissed_${updatedAt || 'default'}`;
    try { sessionStorage.setItem(dismissKey, '1'); } catch {}
    setDismissed(true);
  }

  if (!text || dismissed) return null;

  return (
    <div style={{
      background: 'linear-gradient(90deg, rgba(255,184,0,0.12) 0%, rgba(255,140,0,0.08) 100%)',
      borderBottom: '1px solid rgba(255,184,0,0.2)',
      padding: '0 1.5rem',
      display: 'flex', alignItems: 'center', gap: '10px',
      minHeight: '34px', flexShrink: 0,
      animation: 'fadeIn 0.3s ease',
    }}>
      <span style={{ color: '#FFB800', fontSize: '0.78rem', flexShrink: 0 }}>📣</span>
      {/* Scrolling ticker for long messages, static for short */}
      <div style={{
        flex: 1, overflow: 'hidden',
        fontSize: '0.78rem', fontWeight: 600,
        color: 'rgba(255,220,100,0.9)',
        whiteSpace: text.length > 80 ? 'nowrap' : 'normal',
      }}>
        {text.length > 80 ? (
          <div style={{
            display: 'inline-block',
            animation: 'ticker-scroll 20s linear infinite',
            paddingLeft: '100%',
          }}>
            {text}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{text}
          </div>
        ) : text}
      </div>
      <button
        onClick={dismiss}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0,
          color: 'rgba(255,184,0,0.5)', fontSize: '0.85rem', padding: '2px 6px',
          borderRadius: '4px', lineHeight: 1, transition: 'color 0.1s',
        }}
        onMouseEnter={e => { e.currentTarget.style.color = '#FFB800'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,184,0,0.5)'; }}
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

const TAB_META = {
  tracker:    { label: 'My Picks',     sub: 'Track your picks and ROI' },
  scoreboard: { label: 'Scoreboard',   sub: 'Live scores across all sports' },
  odds:       { label: 'Odds Board',   sub: 'Compare lines across books in real time' },
  trends:     { label: 'Trends',       sub: 'Situational edges, filter engine & backtest' },
  history:    { label: 'Pick History', sub: 'Log, edit, and analyze every bet' },
  analyzer:    { label: 'Analyzer',     sub: 'GOAT BOT live analysis + sharp tools' },
  leaderboard:  { label: 'Leaderboard',     sub: 'Sharp picks, verified records, public rankings' },
  featured:     { label: 'Featured Games',  sub: 'Your starred games & quick GOAT BOT access' },
  admin:        { label: '🛡 Admin Panel',  sub: 'User management, analytics & system settings' },
};

export default function Dashboard({ user, initialPicks, initialContest, isDemo }) {
  const router = useRouter();
  const [activeTab, setActiveTab]   = useState('tracker');
  const [picks, setPicks]           = useState(initialPicks || []);
  const [contest, setContest]       = useState(initialContest || {
    name: 'My Picks',
    start_date: new Date().toISOString().split('T')[0],
    bankroll: 100,
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Preserved state for cross-tab navigation
  const [goatPrompt, setGoatPrompt] = useState('');
  const [goatReport, setGoatReport] = useState(null);

  async function handleSignOut() {
    if (isDemo) {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('goatbot_demo');
      router.push('/');
      return;
    }
    await signOut();
    router.push('/');
  }

  const meta = TAB_META[activeTab] || {};

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--bg-base)' }}>

      {/* Mobile backdrop */}
      <div
        className={`sidebar-backdrop ${mobileNavOpen ? 'open' : ''}`}
        onClick={() => setMobileNavOpen(false)}
      />

      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={(tab) => { setActiveTab(tab); setMobileNavOpen(false); }}
        user={user}
        isDemo={isDemo}
        contest={contest}
        picks={picks}
        onSignOut={handleSignOut}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top bar */}
        <header style={{
          height: '52px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 1.5rem',
          background: 'var(--bg-surface)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button className="hamburger-btn" onClick={() => setMobileNavOpen(o => !o)} title="Menu">
              ☰
            </button>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{meta.label}</span>
            <span className="header-sub" style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: '10px' }}>{meta.sub}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isDemo && (
              <span className="badge badge-gold" style={{ fontSize: '0.65rem' }}>DEMO MODE</span>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          </div>
        </header>

        {/* Announcement Banner — only shows when admin has broadcast a message */}
        <AnnouncementBanner />

        {/* Tab content — all tabs stay mounted, hidden when inactive to preserve state */}
        <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }} className="fade-up main-content">
          <div style={{ display: activeTab === 'tracker'    ? 'block' : 'none' }}><TrackerTab    picks={picks} /></div>
          <div style={{ display: activeTab === 'scoreboard' ? 'block' : 'none' }}>
            <ScoreboardTab
              onAnalyze={(prompt) => { setGoatPrompt(prompt); setActiveTab('analyzer'); }}
              user={user}
              picks={picks}
              setPicks={setPicks}
              isDemo={isDemo}
            />
          </div>
          <div style={{ display: activeTab === 'odds'       ? 'block' : 'none' }}>
            <OddsTab onAnalyze={(prompt) => { setGoatPrompt(prompt); setActiveTab('analyzer'); }} />
          </div>
          <div style={{ display: activeTab === 'trends'     ? 'block' : 'none' }}><TrendsTab picks={picks} user={user} onNavigateToTracker={() => setActiveTab('tracker')} /></div>
          <div style={{ display: activeTab === 'history'    ? 'block' : 'none' }}>
            <HistoryTab picks={picks} setPicks={setPicks} user={user} contest={contest} setContest={setContest} isDemo={isDemo} />
          </div>
          <div style={{ display: activeTab === 'analyzer'   ? 'block' : 'none' }}>
            <AnalyzerTab
              picks={picks} user={user} isDemo={isDemo}
              goatPrompt={goatPrompt} onGoatPromptConsumed={() => setGoatPrompt('')}
              goatReport={goatReport} onGoatReportConsumed={() => setGoatReport(null)}
            />
          </div>
          <div style={{ display: activeTab === 'leaderboard' ? 'block' : 'none' }}>
            <LeaderboardTab user={user} isDemo={isDemo} />
          </div>
          <div style={{ display: activeTab === 'featured' ? 'block' : 'none' }}>
            <FeaturedGamesTab onAnalyze={(prompt, savedReport) => {
              if (savedReport) {
                setGoatReport(savedReport);
                setGoatPrompt('');
              } else {
                setGoatPrompt(prompt);
                setGoatReport(null);
              }
              setActiveTab('analyzer');
            }} />
          </div>
          {user?.email?.toLowerCase() === ADMIN_EMAIL && (
            <div style={{ display: activeTab === 'admin' ? 'block' : 'none' }}>
              <AdminTab user={user} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
