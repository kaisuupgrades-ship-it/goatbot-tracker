'use client';
import { useState, useEffect } from 'react';

// Grouped nav: sections with optional sub-items
const NAV_SECTIONS = [
  {
    section: 'My Picks',
    items: [
      { id: 'tracker',  label: 'Dashboard',  icon: '◈',  desc: 'Stats, trends & equity curve' },
      { id: 'featured', label: 'Featured',   icon: '★',  desc: 'Starred games', starred: true, indent: true },
      { id: 'history',  label: 'My Picks',   icon: '≡',  desc: 'Log & manage your bets', indent: true },
    ],
  },
  {
    section: 'Live Data',
    items: [
      { id: 'scoreboard', label: 'Scoreboard', icon: '◉',  desc: 'Live scores, all sports', live: true },
      { id: 'odds',       label: 'Odds Board', icon: '◧',  desc: 'Lines across all books' },
    ],
  },
  {
    section: 'Tools',
    items: [
      { id: 'analyzer',    label: 'Analyzer',    icon: '🧠',  desc: 'GOAT BOT + AI tools' },
      { id: 'trends',      label: 'Trends',      icon: '📈',  desc: 'Situational edge finder' },
      { id: 'leaderboard', label: 'Leaderboard', icon: '🏆', desc: 'Sharp rankings' },
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

function StarredCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    function load() {
      try { setCount(Object.keys(JSON.parse(localStorage.getItem('goatbot_starred_games') || '{}')).length); } catch {}
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

export default function Sidebar({ activeTab, setActiveTab, user, isDemo, picks, onSignOut, mobileOpen, onMobileClose }) {
  const [collapsed, setCollapsed] = useState(false);
  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;

  const settled  = picks.filter(p => p.result === 'WIN' || p.result === 'LOSS');
  const wins     = picks.filter(p => p.result === 'WIN').length;
  const losses   = picks.filter(p => p.result === 'LOSS').length;
  const units    = settled.reduce((s, p) => s + (parseFloat(p.profit) || 0), 0);
  const pending  = picks.filter(p => !p.result || p.result === 'PENDING').length;

  const username = isDemo
    ? 'Demo Mode'
    : (user?.user_metadata?.username || user?.email?.split('@')[0] || 'Bettor');

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
        <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>🐐</span>
        {!collapsed && (
          <div>
            <div style={{ fontWeight: 900, color: 'var(--gold)', fontSize: '1rem', letterSpacing: '-0.03em', lineHeight: 1 }}>
              GOAT BOT
            </div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '1px' }}>
              Sports Intelligence
            </div>
          </div>
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

      {/* Nav Items — grouped sections */}
      <nav style={{ flex: 1, padding: '0.5rem 0.4rem', display: 'flex', flexDirection: 'column', gap: '0', overflowY: 'auto', overflowX: 'hidden' }}>
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
                    padding: collapsed ? '0.5rem' : item.indent ? '0.42rem 0.75rem 0.42rem 1.4rem' : '0.45rem 0.75rem',
                  }}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="nav-icon" style={{ fontSize: item.indent ? '0.85rem' : '1rem', fontStyle: 'normal', opacity: item.indent ? 0.85 : 1 }}>{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span style={{ flex: 1, fontSize: item.indent ? '0.82rem' : '0.875rem' }}>{item.label}</span>
                      {item.live && <LiveCount />}
                      {item.starred && <StarredCount />}
                    </>
                  )}
                </button>
              ))}
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
            <span className="nav-icon" style={{ fontSize: '1rem' }}>🛡</span>
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

          {/* User + sign out */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <div style={{
              width: '26px', height: '26px', borderRadius: '50%',
              background: isDemo ? 'var(--gold-subtle)' : 'var(--bg-overlay)',
              border: `1px solid ${isDemo ? 'rgba(255,184,0,0.3)' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.75rem', color: isDemo ? 'var(--gold)' : 'var(--text-secondary)',
              flexShrink: 0,
            }}>
              {username[0]?.toUpperCase() || '?'}
            </div>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {username}
            </span>
            <button
              onClick={onSignOut}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.75rem', flexShrink: 0, padding: '3px' }}
              title="Sign out"
            >
              ⇥
            </button>
          </div>
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
