'use client';
import { useState, useEffect } from 'react';

// ── SVG icon components — thin stroke, consistent 14×14 grid ─────────────────
const Icons = {
  Dashboard: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="1" width="5" height="5" rx="1"/>
      <rect x="8" y="1" width="5" height="5" rx="1"/>
      <rect x="1" y="8" width="5" height="5" rx="1"/>
      <rect x="8" y="8" width="5" height="5" rx="1"/>
    </svg>
  ),
  Featured: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="7,1.5 8.6,5.1 12.5,5.6 9.8,8.2 10.5,12.2 7,10.3 3.5,12.2 4.2,8.2 1.5,5.6 5.4,5.1"/>
    </svg>
  ),
  Picks: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <line x1="1.5" y1="3.5" x2="12.5" y2="3.5"/>
      <line x1="1.5" y1="7" x2="12.5" y2="7"/>
      <line x1="1.5" y1="10.5" x2="8" y2="10.5"/>
    </svg>
  ),
  Scoreboard: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="5.5"/>
      <circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none"/>
    </svg>
  ),
  Odds: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="1" y="1" width="12" height="12" rx="1.5"/>
      <line x1="7" y1="1" x2="7" y2="13"/>
      <line x1="1" y1="7" x2="13" y2="7"/>
    </svg>
  ),
  Analyzer: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5.5" cy="5.5" r="4"/>
      <line x1="8.5" y1="8.5" x2="12.5" y2="12.5"/>
      <line x1="3.5" y1="5.5" x2="7.5" y2="5.5"/>
      <line x1="5.5" y1="3.5" x2="5.5" y2="7.5"/>
    </svg>
  ),
  SharpBoard: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <rect x="1" y="7" width="3" height="6" rx="0.5"/>
      <rect x="5.5" y="4" width="3" height="9" rx="0.5"/>
      <rect x="10" y="1.5" width="3" height="11.5" rx="0.5"/>
    </svg>
  ),
  Search: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="6" cy="6" r="4.5"/>
      <line x1="9.2" y1="9.2" x2="12.5" y2="12.5"/>
    </svg>
  ),
  Following: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="4.5" r="2.5"/>
      <path d="M1 12.5c0-2.2 1.8-4 4-4s4 1.8 4 4"/>
      <line x1="10.5" y1="5" x2="10.5" y2="9"/>
      <line x1="8.5" y1="7" x2="12.5" y2="7"/>
    </svg>
  ),
  Chat: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 2.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H5l-3 2V3.5a1 1 0 0 1 1-1z"/>
    </svg>
  ),
  Messages: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2.5" width="12" height="9" rx="1"/>
      <polyline points="1,2.5 7,8 13,2.5"/>
    </svg>
  ),
  Profile: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="4.5" r="2.5"/>
      <path d="M2 12.5c0-2.8 2.2-5 5-5s5 2.2 5 5"/>
    </svg>
  ),
};

// Grouped nav sections — no indent, uniform alignment throughout
const NAV_SECTIONS = [
  {
    section: 'My Picks',
    items: [
      { id: 'tracker',  label: 'Dashboard',  Icon: Icons.Dashboard,  desc: 'Stats, trends & equity curve' },
      { id: 'featured', label: 'Featured',   Icon: Icons.Featured,   desc: 'Starred games', starred: true },
      { id: 'history',  label: 'My Picks',   Icon: Icons.Picks,      desc: 'Log & manage your bets' },
    ],
  },
  {
    section: 'Live Data',
    items: [
      { id: 'scoreboard', label: 'Scoreboard', Icon: Icons.Scoreboard, desc: 'Live scores, all sports', live: true },
      { id: 'odds',       label: 'Odds Board', Icon: Icons.Odds,       desc: 'Lines across all books' },
    ],
  },
  {
    section: 'Tools',
    items: [
      { id: 'analyzer',   label: 'Analyzer',    Icon: Icons.Analyzer,   desc: 'BetOS + AI tools' },
      { id: 'sharpboard', label: 'Sharp Board', Icon: Icons.SharpBoard, desc: 'Public handicapper rankings' },
      { id: 'usersearch', label: 'User Search', Icon: Icons.Search,     desc: 'Find & follow sharp bettors' },
      { id: 'following',  label: 'Following',   Icon: Icons.Following,  desc: 'Cappers you follow' },
    ],
  },
  {
    section: 'Community',
    items: [
      { id: 'chatroom', label: 'Chat Room', Icon: Icons.Chat, desc: 'Community chat' },
    ],
  },
];

function LiveCount() {
  const [count, setCount] = useState(null);
  useEffect(() => {
    fetch('/api/sports?sport=mlb&endpoint=scoreboard')
      .then(r => r.json())
      .then(d => {
        const live = (d.events || []).filter(e => e?.status?.type?.state === 'in').length;
        setCount(live);
      })
      .catch(() => {});
  }, []);
  if (!count) return null;
  return (
    <span style={{
      marginLeft: 'auto', background: 'rgba(0,212,139,0.12)',
      color: 'var(--green)', border: '1px solid rgba(0,212,139,0.2)',
      borderRadius: '10px', padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700,
    }}>
      {count}
    </span>
  );
}

function UnreadMessages({ userId }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!userId) return;
    function poll() {
      fetch(`/api/messages?userId=${userId}&unreadCount=1`)
        .then(r => r.json())
        .then(d => setCount(d.unread || 0))
        .catch(() => {});
    }
    poll();
    const t = setInterval(poll, 30000);
    return () => clearInterval(t);
  }, [userId]);
  if (!count) return null;
  return (
    <span style={{
      marginLeft: 'auto', background: 'rgba(248,113,113,0.15)',
      color: '#f87171', border: '1px solid rgba(248,113,113,0.3)',
      borderRadius: '10px', padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700,
    }}>
      {count}
    </span>
  );
}

function StarredCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    function load() {
      try { setCount(Object.keys(JSON.parse(localStorage.getItem('betos_starred_games') || '{}')).length); } catch {}
    }
    load();
    window.addEventListener('storage', load);
    const t = setInterval(load, 500);
    return () => { window.removeEventListener('storage', load); clearInterval(t); };
  }, []);
  if (!count) return null;
  return (
    <span style={{
      marginLeft: 'auto', background: 'rgba(255,184,0,0.12)',
      color: 'var(--gold)', border: '1px solid rgba(255,184,0,0.2)',
      borderRadius: '10px', padding: '1px 7px', fontSize: '0.68rem', fontWeight: 700,
    }}>
      {count}
    </span>
  );
}

const ADMIN_EMAIL = 'kaisuupgrades@gmail.com';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

function avatarSrc(user) {
  if (!user?.id || !SUPABASE_URL) return null;
  const ts = user?.user_metadata?.avatar_updated_at
    ? new Date(user.user_metadata.avatar_updated_at).getTime()
    : '';
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${user.id}.jpg${ts ? `?v=${ts}` : ''}`;
}

export default function Sidebar({ activeTab, setActiveTab, user, isDemo, picks, onSignOut, mobileOpen, onMobileClose, onOpenProfile, onRefresh, refreshing, onOpenInbox, userId, onOpenPublicProfile }) {
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;

  const settled  = picks.filter(p => p.result === 'WIN' || p.result === 'LOSS');
  const wins     = picks.filter(p => p.result === 'WIN').length;
  const losses   = picks.filter(p => p.result === 'LOSS').length;
  const units    = settled.reduce((s, p) => s + (parseFloat(p.profit) || 0), 0);
  const pending  = picks.filter(p => !p.result || p.result === 'PENDING').length;

  const username  = isDemo
    ? 'Demo Mode'
    : (user?.user_metadata?.username || user?.email?.split('@')[0] || 'Bettor');
  const [avatarErr, setAvatarErr] = useState(false);
  const hasAvatar = !isDemo && !avatarErr && !!user?.user_metadata?.avatar_url;

  return (
    <aside
      className={`sidebar-drawer${mobileOpen ? ' mobile-open' : ''}`}
      style={{
        width: collapsed ? '56px' : '220px',
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        height: '100vh', top: 0,
        transition: 'width 0.2s cubic-bezier(0.4,0,0.2,1), transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        overflow: 'hidden',
        zIndex: 50,
      }}
    >

      {/* Logo — clickable to expand when collapsed */}
      <div
        onClick={() => { if (collapsed) setCollapsed(false); }}
        style={{
          padding: collapsed ? '1.1rem 0' : '1.1rem 1rem',
          display: 'flex', alignItems: 'center', gap: '10px',
          borderBottom: '1px solid var(--border)',
          justifyContent: collapsed ? 'center' : 'flex-start',
          flexShrink: 0,
          cursor: collapsed ? 'pointer' : 'default',
        }}
      >
        {/* Collapsed: icon only. Expanded: full horizontal lockup (logo.svg already contains the icon) */}
        {collapsed ? (
          <img
            src="/icon.svg"
            alt="BetOS"
            style={{ width: '32px', height: '32px', flexShrink: 0 }}
          />
        ) : (
          <img
            src="/logo.svg"
            alt="BetOS"
            style={{ height: '36px', width: 'auto', flexShrink: 0 }}
          />
        )}
        <button
          onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
          style={{
            marginLeft: 'auto', background: 'none', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem',
            padding: '4px', borderRadius: '4px', flexShrink: 0,
            display: collapsed ? 'none' : 'block',
          }}
          title="Collapse"
        >
          ‹‹
        </button>
      </div>

      {/* ── Contest — special glowing nav item ───────────────────────────────── */}
      <style>{`
        @keyframes contestPulse {
          0%, 100% { box-shadow: 0 0 6px rgba(255,184,0,0.12), inset 0 0 8px rgba(255,184,0,0.04); border-color: rgba(255,184,0,0.22); }
          50%       { box-shadow: 0 0 18px rgba(255,184,0,0.28), inset 0 0 12px rgba(255,184,0,0.08); border-color: rgba(255,184,0,0.5); }
        }
        .contest-glow-btn { animation: contestPulse 2.8s ease-in-out infinite; }
        .contest-glow-btn:hover { animation: none !important; }
      `}</style>
      <div style={{ padding: collapsed ? '0.4rem 0.3rem 0' : '0.5rem 0.4rem 0' }}>
        <button
          onClick={() => { setActiveTab('leaderboard'); if (collapsed) setCollapsed(false); if (mobileOpen) onMobileClose?.(); }}
          className={`contest-glow-btn${activeTab === 'leaderboard' ? ' active' : ''}`}
          title={collapsed ? '🏆 Contest' : undefined}
          style={{
            width: '100%', display: 'flex', alignItems: 'center',
            gap: collapsed ? 0 : '8px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '0.55rem' : '0.5rem 0.75rem',
            background: activeTab === 'leaderboard'
              ? 'linear-gradient(135deg, rgba(255,184,0,0.18), rgba(255,100,0,0.08))'
              : 'linear-gradient(135deg, rgba(255,184,0,0.07), rgba(255,100,0,0.03))',
            border: `1px solid ${activeTab === 'leaderboard' ? 'rgba(255,184,0,0.55)' : 'rgba(255,184,0,0.22)'}`,
            borderRadius: '10px', cursor: 'pointer',
            transition: 'background 0.2s, border-color 0.2s',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '18px', height: '18px', flexShrink: 0, color: 'var(--gold)' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 2h6v6a3 3 0 0 1-6 0V2z"/>
              <path d="M5 4H2.5a1.5 1.5 0 0 0 0 3H5"/>
              <path d="M11 4h2.5a1.5 1.5 0 0 1 0 3H11"/>
              <line x1="8" y1="11" x2="8" y2="13.5"/>
              <line x1="5" y1="13.5" x2="11" y2="13.5"/>
            </svg>
          </span>
          {!collapsed && (
            <>
              <span style={{ flex: 1, fontWeight: 700, fontSize: '0.88rem', color: 'var(--gold)', letterSpacing: '-0.01em' }}>
                Contest
              </span>
              <span style={{
                fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em',
                color: '#FFB800', background: 'rgba(255,184,0,0.12)',
                border: '1px solid rgba(255,184,0,0.3)',
                borderRadius: '4px', padding: '1px 5px', flexShrink: 0,
              }}>
                LIVE
              </span>
            </>
          )}
        </button>
      </div>

      {/* Nav Items — grouped sections */}
      <nav style={{ flex: 1, padding: '0.25rem 0.4rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0', overflowY: 'auto', overflowX: 'hidden' }}>
        {NAV_SECTIONS.map((section, si) => (
          <div key={section.section}>
            {/* Section header */}
            {!collapsed && (
              <div style={{
                fontSize: '0.58rem', fontWeight: 700, color: 'var(--text-muted)',
                textTransform: 'uppercase', letterSpacing: '0.1em',
                padding: si === 0 ? '4px 8px 3px' : '10px 8px 3px',
              }}>
                {section.section}
              </div>
            )}
            {collapsed && si > 0 && (
              <div style={{ height: '1px', background: 'var(--border)', margin: '6px 8px' }} />
            )}

            {/* Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {section.items.map(item => (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id); if (collapsed) setCollapsed(false); if (mobileOpen) onMobileClose?.(); }}
                  className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                  style={{
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    padding: collapsed ? '0.5rem' : '0.45rem 0.75rem',
                  }}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', flexShrink: 0 }}>
                    {item.Icon ? <item.Icon /> : null}
                  </span>
                  {!collapsed && (
                    <>
                      <span style={{ flex: 1, fontSize: '0.875rem' }}>{item.label}</span>
                      {item.live && <LiveCount />}
                      {item.starred && <StarredCount />}
                    </>
                  )}
                </button>
              ))}
              {/* Community extras — My Profile + Messages overlays */}
              {section.section === 'Community' && !isDemo && (
                <>
                  {/* My Profile — opens public profile view */}
                  <button
                    onClick={() => { onOpenPublicProfile?.(); if (mobileOpen) onMobileClose?.(); }}
                    className="nav-item"
                    style={{
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      padding: collapsed ? '0.5rem' : '0.45rem 0.75rem',
                    }}
                    title={collapsed ? 'My Profile' : undefined}
                  >
                    <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', flexShrink: 0 }}>
                      <Icons.Profile />
                    </span>
                    {!collapsed && (
                      <span style={{ flex: 1, fontSize: '0.875rem' }}>My Profile</span>
                    )}
                  </button>
                  {/* Messages — opens Inbox overlay */}
                  <button
                    onClick={() => { onOpenInbox?.(); if (mobileOpen) onMobileClose?.(); }}
                    className="nav-item"
                    style={{
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      padding: collapsed ? '0.5rem' : '0.45rem 0.75rem',
                    }}
                    title={collapsed ? 'Messages' : undefined}
                  >
                    <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', flexShrink: 0 }}>
                      <Icons.Messages />
                    </span>
                    {!collapsed && (
                      <>
                        <span style={{ flex: 1, fontSize: '0.875rem' }}>Messages</span>
                        <UnreadMessages userId={userId} />
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </nav>

      {/* Admin nav item — only visible for admin account */}
      {isAdmin && (
        <div style={{ padding: '0 0.4rem 0.4rem' }}>
          {!collapsed && (
            <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'rgba(251,191,36,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 8px 3px' }}>
              Admin
            </div>
          )}
          {collapsed && <div style={{ height: '1px', background: 'var(--border)', margin: '6px 8px' }} />}
          <button
            onClick={() => { setActiveTab('admin'); if (collapsed) setCollapsed(false); if (mobileOpen) onMobileClose?.(); }}
            className={`nav-item ${activeTab === 'admin' ? 'active' : ''}`}
            style={{
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '0.5rem' : '0.45rem 0.75rem',
              border: activeTab === 'admin' ? '1px solid rgba(251,191,36,0.3)' : '1px solid transparent',
            }}
            title={collapsed ? 'Admin Panel' : undefined}
          >
            <span className="nav-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 1L2 3.5v4c0 3 2.5 5 5 5.5 2.5-.5 5-2.5 5-5.5v-4L7 1z"/>
              </svg>
            </span>
            {!collapsed && <span style={{ flex: 1, fontSize: '0.875rem', color: 'rgba(251,191,36,0.9)' }}>Admin Panel</span>}
          </button>
        </div>
      )}

      {/* Footer — pick summary */}
      {!collapsed && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '0.85rem', flexShrink: 0 }}>
          {/* Stats panel */}
          <div style={{
            background: 'var(--bg-elevated)', borderRadius: '8px',
            padding: '0.7rem 0.8rem', marginBottom: '0.6rem',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>All-Time</span>
              {isDemo && <span style={{ fontSize: '0.62rem', color: 'var(--gold)', background: 'var(--gold-subtle)', padding: '1px 5px', borderRadius: '3px', fontWeight: 600 }}>DEMO</span>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                {wins}–{losses}
              </span>
              <span style={{
                fontFamily: 'IBM Plex Mono', fontSize: '0.88rem', fontWeight: 600,
                color: units >= 0 ? 'var(--green)' : 'var(--red)',
              }}>
                {units >= 0 ? '+' : ''}{units.toFixed(2)}u
              </span>
            </div>
            {pending > 0 && (
              <div style={{ marginTop: '6px', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                <span style={{ color: '#60a5fa' }}>⏳</span> {pending} pending
              </div>
            )}
          </div>

          {/* User + actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            {/* Clickable avatar/name → open profile */}
            <button
              onClick={() => !isDemo && onOpenProfile?.()}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px', flex: 1,
                background: 'none', border: 'none', cursor: isDemo ? 'default' : 'pointer',
                padding: '3px 4px', borderRadius: '6px', textAlign: 'left',
                transition: 'background 0.15s', overflow: 'hidden', minWidth: 0,
              }}
              title={isDemo ? 'Demo Mode' : 'Edit profile'}
              onMouseEnter={e => { if (!isDemo) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}
            >
              <div style={{
                width: '26px', height: '26px', borderRadius: '50%',
                background: isDemo ? 'var(--gold-subtle)' : 'var(--bg-overlay)',
                border: `1px solid ${isDemo ? 'rgba(255,184,0,0.3)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.75rem', color: isDemo ? 'var(--gold)' : 'var(--text-secondary)',
                flexShrink: 0, overflow: 'hidden',
              }}>
                {hasAvatar ? (
                  <img src={avatarSrc(user)} alt="avatar"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={() => setAvatarErr(true)} />
                ) : (username[0]?.toUpperCase() || '?')}
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {username}
              </span>
            </button>
            {/* Refresh button */}
            {!isDemo && (
              <button
                onClick={onRefresh}
                disabled={refreshing}
                title="Refresh picks & grade results"
                style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
                  color: refreshing ? 'var(--text-muted)' : 'var(--text-secondary)',
                  cursor: refreshing ? 'default' : 'pointer',
                  fontSize: '0.82rem', padding: '4px 6px', flexShrink: 0,
                  transition: 'all 0.15s', lineHeight: 1,
                  animation: refreshing ? 'spin 1s linear infinite' : 'none',
                }}
                onMouseEnter={e => { if (!refreshing) { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.color = 'var(--gold)'; }}}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                ⟳
              </button>
            )}
          </div>

          {/* Prominent Sign Out button */}
          <button
            onClick={onSignOut}
            style={{
              width: '100%', padding: '7px 10px', borderRadius: '7px',
              background: 'rgba(255,69,96,0.08)', border: '1px solid rgba(255,69,96,0.25)',
              color: '#ff4560', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,69,96,0.16)'; e.currentTarget.style.borderColor = 'rgba(255,69,96,0.5)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,69,96,0.08)'; e.currentTarget.style.borderColor = 'rgba(255,69,96,0.25)'; }}
          >
            <span>⇥</span> Sign Out
          </button>
        </div>
      )}

      {/* Collapsed expand button — prominent */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          style={{
            background: 'rgba(255,184,0,0.06)', border: 'none', color: 'var(--gold)',
            cursor: 'pointer', padding: '0.85rem', textAlign: 'center',
            fontSize: '1rem', borderTop: '1px solid var(--border)',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,184,0,0.12)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,184,0,0.06)'}
          title="Expand sidebar"
        >
          ››
        </button>
      )}
    </aside>
  );
}
