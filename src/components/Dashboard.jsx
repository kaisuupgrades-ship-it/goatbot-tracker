'use client';
import { useState, useEffect } from 'react';
import { signOut } from '@/lib/supabase';
import { playWin, playLoss, playGrade } from '@/lib/sounds';
import { startSessionTracking, stopSessionTracking } from '@/lib/sessionTracker';
import { useRouter } from 'next/navigation';
import Sidebar       from './Sidebar';
import TrackerTab    from './tabs/TrackerTab';
import ScoreboardTab from './tabs/ScoreboardTab';
import OddsTab       from './tabs/OddsTab';
import HistoryTab    from './tabs/HistoryTab';
import AnalyzerTab      from './tabs/AnalyzerTab';
import LeaderboardTab    from './tabs/LeaderboardTab';
import UserSearchTab     from './tabs/UserSearchTab';
import FollowingTab      from './tabs/FollowingTab';
import ChatRoomTab       from './tabs/ChatRoomTab';
import FeaturedGamesTab  from './tabs/FeaturedGamesTab';
import AdminTab          from './tabs/AdminTab';
import ProfileModal      from './ProfileModal';
import PublicProfileModal from './PublicProfileModal';
import InboxPanel           from './InboxPanel';
import SupportChatWidget    from './SupportChatWidget';

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
          const dismissKey = `betos_banner_dismissed_${data.updated_at || 'default'}`;
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
    const dismissKey = `betos_banner_dismissed_${updatedAt || 'default'}`;
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

// ── Server Job Banner — shows when background server jobs are running ───────────
// Polls the pregenerate_progress key in settings so the banner persists across
// tab switches, page refreshes, etc. The server writes progress as it goes.
function ServerJobBanner() {
  const [job, setJob]     = useState(null);
  const [done, setDone]   = useState(false);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res  = await fetch('/api/settings?key=pregenerate_progress');
        const data = await res.json();
        if (!data.value || !active) return;
        const progress = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
        const age = Date.now() - new Date(progress.started_at).getTime();

        if (progress.status === 'running' && age < 360000) {
          setJob(progress);
          setDone(false);
        } else if (progress.status === 'done' && age < 30000) {
          // Show "done" briefly then fade out
          setJob(progress);
          setDone(true);
          setTimeout(() => { if (active) setJob(null); }, 8000);
        } else {
          setJob(null);
        }
      } catch {}
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (!job) return null;

  const sportLabel = job.current_sport ? job.current_sport.toUpperCase() : '';
  const pct = job.total_sports > 0 ? Math.round((job.sport_index / job.total_sports) * 100) : 0;

  return (
    <div style={{
      background: done
        ? 'linear-gradient(90deg, rgba(74,222,128,0.1) 0%, rgba(74,222,128,0.05) 100%)'
        : 'linear-gradient(90deg, rgba(96,165,250,0.1) 0%, rgba(96,165,250,0.05) 100%)',
      borderBottom: `1px solid ${done ? 'rgba(74,222,128,0.2)' : 'rgba(96,165,250,0.2)'}`,
      padding: '0 1.5rem',
      display: 'flex', alignItems: 'center', gap: '10px',
      minHeight: '34px', flexShrink: 0,
      animation: 'fadeIn 0.3s ease',
    }}>
      <span style={{ fontSize: '0.78rem', flexShrink: 0 }}>{done ? '✅' : '⟳'}</span>
      <span style={{
        fontSize: '0.78rem', fontWeight: 600,
        color: done ? 'rgba(74,222,128,0.9)' : 'rgba(147,197,253,0.9)',
      }}>
        {done
          ? `Pre-generation complete — ${job.generated || 0} analyses cached`
          : `Pre-generating analyses… ${sportLabel ? `(${sportLabel})` : ''} ${pct}%`
        }
      </span>
      {!done && (
        <div style={{ flex: 1, maxWidth: '200px', height: '3px', background: 'rgba(96,165,250,0.15)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: '#60a5fa', borderRadius: '2px', transition: 'width 0.5s ease' }} />
        </div>
      )}
    </div>
  );
}

const TAB_META = {
  tracker:    { label: 'My Picks',     sub: 'Track your picks and ROI' },
  scoreboard: { label: 'Scoreboard',   sub: 'Live scores across all sports' },
  odds:       { label: 'Odds Board',   sub: 'Compare lines across books in real time' },
  history:    { label: 'Pick History', sub: 'Log, edit, and analyze every bet' },
  analyzer:    { label: 'Analyzer',     sub: 'BetOS live analysis + sharp tools' },
  leaderboard: { label: 'Contest',      sub: 'Monthly contest standings & verified picks' },
  sharpboard:  { label: 'Sharp Board',  sub: 'All-time public handicapper rankings' },
  usersearch:  { label: 'User Search',  sub: 'Find and follow the sharpest bettors in the community' },
  following:   { label: 'Following',    sub: 'Cappers you follow — all-time stats' },
  chatroom:    { label: 'Chat Room',    sub: 'Community chat — discuss picks & sharp action' },
  featured:     { label: 'Featured Games',  sub: 'Your starred games & quick BetOS access' },
  admin:        { label: '🛡 Admin Panel',  sub: 'User management, analytics & system settings' },
};

export default function Dashboard({ user, initialPicks, initialContest, isDemo }) {
  const router = useRouter();
  const [activeTab, setActiveTab]   = useState('tracker');
  // Shared sport selection — kept in sync between Scoreboard and Odds Board
  const [activeSport, setActiveSport] = useState('mlb');
  const [picks, setPicks]           = useState(initialPicks || []);
  const [contest, setContest]       = useState(initialContest || {
    name: 'My Picks',
    start_date: new Date().toISOString().split('T')[0],
    bankroll: 100,
  });
  const [mobileNavOpen,   setMobileNavOpen]   = useState(false);
  const [profileOpen,     setProfileOpen]     = useState(false);
  const [currentUser,     setCurrentUser]     = useState(user);
  const [inboxOpen,       setInboxOpen]       = useState(false);
  const [inboxRecipient,  setInboxRecipient]  = useState(null);
  const [myProfileOpen,   setMyProfileOpen]   = useState(false);

  function openInbox(recipient = null) {
    setInboxRecipient(recipient);
    setInboxOpen(true);
  }
  // Preserved state for cross-tab navigation
  const [goatPrompt, setGoatPrompt] = useState('');
  const [goatReport, setGoatReport] = useState(null);
  // Pick → Scoreboard navigation
  const [scoreboardGame, setScoreboardGame] = useState(null);
  function onViewGame(pick) {
    setScoreboardGame(pick);
    setActiveTab('scoreboard');
  }

  // Start session tracking when a real user loads the dashboard
  useEffect(() => {
    if (!isDemo && user?.id) {
      startSessionTracking(user.id);
      return () => stopSessionTracking();
    }
  }, [user?.id, isDemo]);

  // Leaderboard refresh key — increment to trigger LeaderboardTab re-load
  const [leaderboardRefreshKey, setLeaderboardRefreshKey] = useState(0);

  // Global refresh: re-fetch picks from Supabase + run grading
  const [globalRefreshing, setGlobalRefreshing] = useState(false);
  async function refreshAll() {
    if (isDemo || !user?.id || globalRefreshing) return;
    setGlobalRefreshing(true);
    try {
      // Re-fetch picks
      const { data } = await import('@/lib/supabase').then(m => m.supabase
        .from('picks').select('*').eq('user_id', user.id).order('date', { ascending: false }));
      if (data) setPicks(data);
      // Run grading on updated picks
      await fetch('/api/grade-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      }).then(r => r.json()).then(({ graded }) => {
        if (graded?.length) {
          setPicks(prev => prev.map(p => {
            const g = graded.find(gr => gr.id === p.id);
            return g ? { ...p, result: g.result } : p;
          }));
          // 🔊 Sound notifications for graded picks
          const wins   = graded.filter(g => g.result === 'WIN').length;
          const losses = graded.filter(g => g.result === 'LOSS').length;
          const pushes = graded.filter(g => g.result === 'PUSH').length;
          if (wins > 0)        { playWin();   if (wins > 1)   setTimeout(playWin,  350); }
          else if (losses > 0) { playLoss();  if (losses > 1) setTimeout(playLoss, 400); }
          else if (pushes > 0) { playGrade(); }
        }
      });
    } catch { /* silent */ }
    finally { setGlobalRefreshing(false); }
  }

  async function handleSignOut() {
    if (isDemo) {
      if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem('betos_demo');
      router.push('/');
      return;
    }
    stopSessionTracking();
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
        user={currentUser}
        isDemo={isDemo}
        contest={contest}
        picks={picks}
        onSignOut={handleSignOut}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
        onOpenProfile={() => setProfileOpen(true)}
        onRefresh={refreshAll}
        refreshing={globalRefreshing}
        onOpenInbox={openInbox}
        userId={user?.id}
        onOpenPublicProfile={() => !isDemo && setMyProfileOpen(true)}
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

        {/* Server Job Banner — shows progress for background server tasks */}
        <ServerJobBanner />

        {/* Tab content — all tabs stay mounted, hidden when inactive to preserve state */}
        <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem' }} className="fade-up main-content">
          <div style={{ display: activeTab === 'tracker'    ? 'block' : 'none' }}><TrackerTab    picks={picks} user={user} /></div>
          <div style={{ display: activeTab === 'scoreboard' ? 'block' : 'none' }}>
            <ScoreboardTab
              onAnalyze={(prompt) => { setGoatPrompt(prompt); setActiveTab('analyzer'); }}
              user={user}
              picks={picks}
              setPicks={setPicks}
              isDemo={isDemo}
              highlightGame={scoreboardGame}
              onHighlightConsumed={() => setScoreboardGame(null)}
              activeSport={activeSport}
              onSportChange={setActiveSport}
              isActive={activeTab === 'scoreboard'}
            />
          </div>
          <div style={{ display: activeTab === 'odds'       ? 'block' : 'none' }}>
            <OddsTab
              onAnalyze={(prompt) => { setGoatPrompt(prompt); setActiveTab('analyzer'); }}
              activeSport={activeSport}
              onSportChange={setActiveSport}
            />
          </div>
          <div style={{ display: activeTab === 'history'    ? 'block' : 'none' }}>
            <HistoryTab picks={picks} setPicks={setPicks} user={user} contest={contest} setContest={setContest} isDemo={isDemo} onViewGame={onViewGame} onLeaderboardRefresh={() => setLeaderboardRefreshKey(k => k + 1)} isActive={activeTab === 'history'} />
          </div>
          <div style={{ display: activeTab === 'analyzer'   ? 'block' : 'none' }}>
            <AnalyzerTab
              picks={picks} user={user} isDemo={isDemo}
              goatPrompt={goatPrompt} onGoatPromptConsumed={() => setGoatPrompt('')}
              goatReport={goatReport} onGoatReportConsumed={() => setGoatReport(null)}
            />
          </div>
          {/* Contest — standalone, always mounts Contest sub-tab */}
          <div style={{ display: activeTab === 'leaderboard' ? 'block' : 'none' }}>
            <LeaderboardTab user={user} isDemo={isDemo} refreshKey={leaderboardRefreshKey} defaultSubTab="contest" onOpenInbox={openInbox} isActive={activeTab === 'leaderboard'} />
          </div>
          {/* Sharp Board — standalone sharp rankings */}
          <div style={{ display: activeTab === 'sharpboard' ? 'block' : 'none' }}>
            <LeaderboardTab user={user} isDemo={isDemo} refreshKey={leaderboardRefreshKey} defaultSubTab="sharp" onOpenInbox={openInbox} isActive={activeTab === 'sharpboard'} />
          </div>
          <div style={{ display: activeTab === 'usersearch' ? 'block' : 'none' }}>
            <UserSearchTab user={user} isDemo={isDemo} onOpenInbox={openInbox} />
          </div>
          <div style={{ display: activeTab === 'following' ? 'block' : 'none' }}>
            <FollowingTab user={user} isDemo={isDemo} onOpenInbox={openInbox} isActive={activeTab === 'following'} />
          </div>
          <div style={{ display: activeTab === 'chatroom' ? 'block' : 'none' }}>
            <ChatRoomTab user={user} isDemo={isDemo} onOpenInbox={openInbox} />
          </div>
          <div style={{ display: activeTab === 'featured' ? 'block' : 'none' }}>
            <FeaturedGamesTab
              user={user}
              picks={picks}
              setPicks={setPicks}
              isDemo={isDemo}
              onAnalyze={(prompt) => {
                setGoatPrompt(prompt);
                setGoatReport(null);
                setActiveTab('analyzer');
              }}
            />
          </div>
          {user?.email?.toLowerCase() === ADMIN_EMAIL && (
            <div style={{ display: activeTab === 'admin' ? 'block' : 'none' }}>
              <AdminTab user={user} />
            </div>
          )}
        </main>
      </div>

      {/* Profile modal */}
      {profileOpen && !isDemo && (
        <ProfileModal
          user={currentUser}
          onClose={() => setProfileOpen(false)}
          onUpdated={(updatedUser) => {
            setCurrentUser(updatedUser);
            setProfileOpen(false);
          }}
        />
      )}

      {/* My Public Profile — full forum-style profile view */}
      {myProfileOpen && !isDemo && currentUser && (
        <PublicProfileModal
          entry={{
            user_id:      currentUser.id,
            username:     currentUser.user_metadata?.username || currentUser.email?.split('@')[0],
            display_name: currentUser.user_metadata?.display_name || null,
            avatar_emoji: currentUser.user_metadata?.avatar_emoji || null,
          }}
          onClose={() => setMyProfileOpen(false)}
          onOpenInbox={openInbox}
          currentUser={currentUser}
        />
      )}

      {/* Inbox Panel — slide-in DM overlay */}
      <InboxPanel
        user={currentUser}
        isOpen={inboxOpen}
        onClose={() => setInboxOpen(false)}
        initialRecipient={inboxRecipient}
        isDemo={isDemo}
      />

      {/* Support Chat Widget — bottom left, always visible */}
      {!isDemo && <SupportChatWidget user={currentUser} />}
    </div>
  );
}
