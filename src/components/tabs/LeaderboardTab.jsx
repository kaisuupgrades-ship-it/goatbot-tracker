'use client';
import { useState, useEffect, useCallback } from 'react';
import { fetchProfile, upsertProfile } from '@/lib/supabase';
import PublicProfileModal from '../PublicProfileModal';

// ── Mobile breakpoint hook ────────────────────────────────────────────────────
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    function check() { setIsMobile(window.innerWidth <= breakpoint); }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return isMobile;
}


// ── UserAvatar: shows real photo if available, falls back to emoji then initials
// avatarUrl — cache-busted URL from profiles table (preferred when available)
// userId    — fallback to construct the storage URL
function UserAvatar({ userId, avatarUrl, avatarEmoji, displayName, username, size = 32 }) {
  const [imgErr, setImgErr] = useState(false);
  // Only show image if an explicit avatar_url is set (no speculative URL construction)
  const src = avatarUrl || null;
  const showImg = src && !imgErr;

  // Generate initials from display name or username
  function getInitials() {
    const name = displayName || username || '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  // Generate a consistent muted color from the username
  function getBgColor() {
    const name = username || displayName || '';
    const colors = [
      'rgba(99,102,241,0.25)', 'rgba(20,184,166,0.25)', 'rgba(245,158,11,0.22)',
      'rgba(239,68,68,0.22)',  'rgba(59,130,246,0.25)', 'rgba(168,85,247,0.22)',
      'rgba(16,185,129,0.22)', 'rgba(251,146,60,0.22)',
    ];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffff;
    return colors[Math.abs(h) % colors.length];
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: showImg ? 'var(--bg-elevated)' : getBgColor(),
      border: '1px solid var(--border)',
    }}>
      {showImg ? (
        <img
          src={src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setImgErr(true)}
        />
      ) : avatarEmoji ? (
        <span style={{ fontSize: size * 0.55, lineHeight: 1, userSelect: 'none' }}>{avatarEmoji}</span>
      ) : (
        <span style={{
          fontSize: size * 0.38, fontWeight: 700, letterSpacing: '0.02em',
          color: 'var(--text-primary)', userSelect: 'none', fontFamily: 'inherit',
        }}>{getInitials()}</span>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n, decimals = 2) {
  const v = parseFloat(n) || 0;
  return (v >= 0 ? '+' : '') + v.toFixed(decimals);
}

function winPct(wins, total) {
  if (!total) return '—';
  return ((wins / total) * 100).toFixed(1) + '%';
}

// ── Rank Badge ────────────────────────────────────────────────────────────────

function RankBadge({ rank }) {
  if (rank === 1) return <span style={{ fontSize: '1.3rem' }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize: '1.3rem' }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize: '1.3rem' }}>🥉</span>;
  return (
    <span style={{
      fontFamily: 'IBM Plex Mono', fontSize: '0.85rem',
      color: 'var(--text-muted)', minWidth: '28px', textAlign: 'right',
    }}>
      #{rank}
    </span>
  );
}

// ── Verified Badge ─────────────────────────────────────────────────────────────

function VerifiedBadge({ count }) {
  if (!count || count < 1) return null;
  return (
    <span title={`${count} verified picks (submitted before game start)`} style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      background: 'rgba(74, 222, 128, 0.12)', color: '#4ade80',
      border: '1px solid rgba(74, 222, 128, 0.3)',
      borderRadius: '4px', padding: '1px 6px', fontSize: '0.68rem', fontWeight: 700,
      cursor: 'help',
    }}>
      ✓ {count}
    </span>
  );
}

// ── Sharp Score Bar ────────────────────────────────────────────────────────────

function SharpBar({ score, maxScore }) {
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  const color = score >= 20 ? '#FFB800' : score >= 10 ? '#4ade80' : '#888';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.78rem', color, minWidth: '34px', textAlign: 'right' }}>
        {parseFloat(score || 0).toFixed(1)}
      </span>
    </div>
  );
}

// ── Leaderboard Row ────────────────────────────────────────────────────────────

function LeaderRow({ entry, maxScore, isMe, onViewProfile, isMobile }) {
  const { rank, avatar_emoji, avatar_url, display_name, username, wins, losses, total, units, roi, verified_picks, sharp_score, user_id: userId } = entry;

  return (
    <div
      onClick={onViewProfile}
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '36px 1fr 70px 65px' : '44px 1fr 80px 90px 80px 90px 100px',
        alignItems: 'center',
        gap: isMobile ? '6px' : '8px',
        padding: isMobile ? '0.65rem 0.75rem' : '0.75rem 1rem',
        borderRadius: '8px',
        background: isMe ? 'rgba(255,184,0,0.07)' : 'var(--bg-surface)',
        border: isMe ? '1px solid rgba(255,184,0,0.35)' : '1px solid var(--border)',
        transition: 'background 0.15s, border-color 0.15s',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { if (!isMe) { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'rgba(255,184,0,0.2)'; }}}
      onMouseLeave={e => { if (!isMe) { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}}
    >
      {/* Rank */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <RankBadge rank={rank} />
      </div>

      {/* Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <UserAvatar userId={userId} avatarUrl={avatar_url} avatarEmoji={avatar_emoji} displayName={display_name} username={username} size={isMobile ? 26 : 30} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'nowrap', overflow: 'hidden' }}>
            <span style={{ fontWeight: 700, color: isMe ? 'var(--gold)' : 'var(--text-primary)', fontSize: isMobile ? '0.84rem' : '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {display_name || username}
            </span>
            {isMe && <span style={{ fontSize: '0.6rem', color: 'var(--gold)', fontWeight: 700, flexShrink: 0 }}>YOU</span>}
            {!isMobile && <VerifiedBadge count={verified_picks} />}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isMobile ? `${wins}–${losses} · ${winPct(wins, total)}` : `@${username}`}
          </div>
        </div>
      </div>

      {/* Record — desktop only */}
      {!isMobile && (
        <span style={{
          fontFamily: 'IBM Plex Mono', fontSize: '0.85rem',
          color: wins > losses ? 'var(--green)' : losses > wins ? 'var(--red)' : 'var(--text-secondary)',
        }}>
          {wins}–{losses}
        </span>
      )}

      {/* Win % — desktop only */}
      {!isMobile && (
        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          {winPct(wins, total)}
        </span>
      )}

      {/* Units */}
      <span style={{
        fontFamily: 'IBM Plex Mono', fontSize: isMobile ? '0.82rem' : '0.85rem',
        color: parseFloat(units) >= 0 ? 'var(--green)' : 'var(--red)',
        fontWeight: 700, textAlign: 'right',
      }}>
        {fmt(units)}u
      </span>

      {/* ROI */}
      <span style={{
        fontFamily: 'IBM Plex Mono', fontSize: isMobile ? '0.78rem' : '0.82rem',
        color: parseFloat(roi) >= 0 ? 'var(--green)' : 'var(--red)',
        textAlign: 'right',
      }}>
        {fmt(roi, 1)}%
      </span>

      {/* Sharp Score — desktop only */}
      {!isMobile && <SharpBar score={sharp_score} maxScore={maxScore} />}
    </div>
  );
}


// ── Profile Editor ────────────────────────────────────────────────────────────

const AVATARS = ['🐐', '🔥', '⚡', '🦅', '🎯', '💎', '🏆', '🐺', '🦁', '🐉', '🤑', '📈'];

function ProfileEditor({ user, profile, onSave, onClose }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [avatar, setAvatar]           = useState(profile?.avatar_emoji || '🎯');
  const [isPublic, setIsPublic]       = useState(profile?.is_public || false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    const { data, error: err } = await upsertProfile({
      id: user.id,
      username: profile?.username || user.user_metadata?.username || user.email?.split('@')[0],
      display_name: displayName.trim() || null,
      avatar_emoji: avatar,
      is_public: isPublic,
    });
    if (err) { setError(err.message); setSaving(false); return; }
    onSave(data);
    setSaving(false);
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '380px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>Edit Public Profile</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>

        {/* Avatar picker */}
        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem' }}>Avatar</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '1rem' }}>
          {AVATARS.map(a => (
            <button key={a} onClick={() => setAvatar(a)} style={{
              fontSize: '1.4rem', padding: '4px', borderRadius: '6px', cursor: 'pointer',
              background: avatar === a ? 'rgba(255,184,0,0.2)' : 'transparent',
              border: avatar === a ? '2px solid var(--gold)' : '2px solid transparent',
            }}>{a}</button>
          ))}
        </div>

        {/* Display name */}
        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
          Display Name <span style={{ color: 'var(--text-secondary)' }}>(optional)</span>
        </label>
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="e.g. SharpMoney69"
          maxLength={30}
          style={{
            width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)',
            borderRadius: '6px', padding: '0.5rem 0.75rem', color: 'var(--text-primary)',
            fontSize: '0.9rem', marginBottom: '1rem', boxSizing: 'border-box',
          }}
        />

        {/* Public toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'var(--bg-base)', borderRadius: '8px', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>Show on Leaderboard</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Your public picks will count toward your rank</div>
          </div>
          <button
            onClick={() => setIsPublic(v => !v)}
            style={{
              width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer',
              background: isPublic ? 'var(--gold)' : 'var(--border)',
              position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <div style={{
              position: 'absolute', top: '3px',
              left: isPublic ? '23px' : '3px',
              width: '18px', height: '18px', borderRadius: '50%',
              background: 'white', transition: 'left 0.2s',
            }} />
          </button>
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{error}</div>}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%', padding: '0.7rem', borderRadius: '8px', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: 'linear-gradient(135deg, #FFB800, #FF8C00)', color: '#0a0a0a',
            fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.05em',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}

// ── Monthly Contest Banner ─────────────────────────────────────────────────────

function getContestDates() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt   = d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  return { start: fmt(start), end: fmt(end), daysLeft, month: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
}

function ContestBanner() {
  const [open, setOpen] = useState(false);
  const { start, end, daysLeft, month } = getContestDates();
  const urgent = daysLeft <= 5;

  return (
    /* Outer wrapper: static gradient border with gold → green money theme */
    <div style={{
      position: 'relative',
      borderRadius: '14px',
      padding: '1.5px',
      background: 'linear-gradient(135deg, rgba(255,184,0,0.6) 0%, rgba(74,222,128,0.4) 50%, rgba(255,184,0,0.6) 100%)',
      boxShadow: '0 0 30px rgba(74,222,128,0.06), 0 8px 24px rgba(0,0,0,0.4)',
    }}>

      {/* Inner card */}
      <div style={{
        position: 'relative',
        background: 'linear-gradient(135deg, rgba(12,20,8,0.98) 0%, rgba(16,14,4,0.99) 50%, rgba(8,18,12,0.98) 100%)',
        borderRadius: '12.5px',
        overflow: 'hidden',
      }}>

      {/* Corner glow — top left gold, bottom right green */}
      <div style={{
        position: 'absolute', top: '-30px', left: '-10px',
        width: '120px', height: '120px',
        background: 'radial-gradient(circle, rgba(255,184,0,0.1) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-30px', right: '-10px',
        width: '120px', height: '120px',
        background: 'radial-gradient(circle, rgba(74,222,128,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Main header row — always visible */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{ padding: '0.9rem 1.25rem', cursor: 'pointer', userSelect: 'none', position: 'relative' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Trophy */}
            <span style={{
              fontSize: '1.8rem', lineHeight: 1,
              display: 'inline-block', filter: 'drop-shadow(0 0 6px rgba(255,184,0,0.4))',
            }}>🏆</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 900, color: '#FFD700', fontSize: '1.05rem', letterSpacing: '-0.02em', textShadow: '0 0 12px rgba(255,184,0,0.4)' }}>
                  Monthly Sharp Contest
                </span>
                {/* Prize pill — green money theme */}
                <span style={{
                  background: 'linear-gradient(90deg, rgba(74,222,128,0.2), rgba(52,211,153,0.15))',
                  color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.5)',
                  borderRadius: '20px', padding: '2px 12px', fontSize: '0.7rem', fontWeight: 900,
                  letterSpacing: '0.06em', textShadow: '0 0 8px rgba(74,222,128,0.4)',
                }}>$100 PRIZE</span>
                {/* Live badge */}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: 'rgba(74,222,128,0.1)', color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.3)',
                  borderRadius: '20px', padding: '2px 8px', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em',
                }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#4ade80', animation: 'live-pulse 2s infinite' }} />
                  LIVE
                </span>
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.73rem', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{month} · {start} – {end}</span>
                {daysLeft > 0 && (
                  <span style={{
                    color: urgent ? '#f87171' : '#60a5fa',
                    fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.7rem',
                    background: urgent ? 'rgba(248,113,113,0.1)' : 'rgba(96,165,250,0.1)',
                    border: `1px solid ${urgent ? 'rgba(248,113,113,0.3)' : 'rgba(96,165,250,0.2)'}`,
                    borderRadius: '4px', padding: '0 5px',
                  }}>
                    {urgent ? '🔥' : '⏱'} {daysLeft}d left
                  </span>
                )}
              </div>
            </div>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>
            {open ? 'Hide rules ▲' : 'View rules ▼'}
          </span>
        </div>
      </div>

      {/* Expandable rules panel */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(255,184,0,0.15)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.2rem', background: 'rgba(0,0,0,0.2)' }}>

          {/* Prize stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
            {[
              { label: 'Prize',     value: '$100',       sub: 'Cash — top Sharp Score', icon: '💵' },
              { label: 'Period',    value: '1st – Last', sub: 'Resets each month',       icon: '📅' },
              { label: 'Entry',     value: 'FREE',       sub: 'No cost to compete',      icon: '🎟' },
              { label: 'Min Picks', value: '15',         sub: 'Settled required to win',  icon: '✅' },
            ].map(s => (
              <div key={s.label} style={{
                background: 'rgba(255,184,0,0.05)', borderRadius: '8px',
                padding: '0.7rem 0.8rem', border: '1px solid rgba(255,184,0,0.15)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '1rem', marginBottom: '4px' }}>{s.icon}</div>
                <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: '#FFD700', fontSize: '1rem' }}>{s.value}</div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', marginTop: '1px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)', marginTop: '3px', lineHeight: 1.4 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Rules */}
          <div>
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', fontWeight: 700 }}>
              Eligibility &amp; Rules
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {[
                { icon: '1️⃣', text: 'ONE PLAY PER DAY — each user gets exactly one contest pick per day. Choose wisely.' },
                { icon: '📐', text: 'MINIMUM ODDS: -145 — no heavy favorites. Max +400. Straight bets only (Moneyline, Spread, Totals). No parlays, props, or futures.' },
                { icon: '🔒', text: 'LOCKED ONCE POSTED — once your pick is submitted as a contest entry, it cannot be changed, edited, or deleted. Period.' },
                { icon: '📅', text: 'RESCHEDULES ≠ VOID — if your game gets rescheduled, the pick stands for the new date. You may post a new pick for that day, but do NOT delete the original.' },
                { icon: '✅', text: 'All contest picks are AI-audited for legitimacy — odds range, timing, and bet type are verified automatically. Flagged picks are reviewed by admin.' },
                { icon: '📊', text: 'Ranked by units profit. Both win rate AND volume matter — you need at least 15 settled picks to be eligible to win.' },
                { icon: '🛡', text: 'One account per person — duplicate accounts detected via IP and device fingerprint are permanently disqualified.' },
                { icon: '🚫', text: 'Manipulation, backdating, or fake accounts = permanent ban from all future contests.' },
                { icon: '💸', text: 'Winner paid via PayPal, Venmo, or Cash App within 3 business days of month end.' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '0.45rem 0.65rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '0.8rem', flexShrink: 0, marginTop: '1px' }}>{r.icon}</span>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>{r.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* How to enter */}
          <div>
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', fontWeight: 700 }}>
              How to Enter — 3 Steps
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {[
                'Log picks in Pick History BEFORE games start — timestamped as verified.',
                'Mark picks as Public using the 👁 toggle in Pick History.',
                'Open ✎ My Profile → enable "Show on Leaderboard." Done.',
              ].map((text, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{
                    width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(255,184,0,0.18)', border: '1px solid rgba(255,184,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.68rem', fontWeight: 900, color: '#FFB800',
                  }}>{i + 1}</span>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textAlign: 'center', paddingTop: '4px' }}>
            🎯 <strong style={{ color: 'rgba(255,184,0,0.8)' }}>BetOS</strong> users have the edge — use the Analyzer, log sharp plays, climb the board.
          </div>
        </div>
      )}
      </div>{/* /inner card */}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const CONTEST_MIN_PICKS = 15;

// ── Contest Row ───────────────────────────────────────────────────────────────
function ContestRow({ entry, isMe, onViewProfile, isMobile }) {
  const streakColor = entry.streak_type === 'W' ? '#4ade80' : entry.streak_type === 'L' ? '#f87171' : '#94a3b8';
  const unitColor   = entry.units > 0 ? '#4ade80' : entry.units < 0 ? '#f87171' : '#94a3b8';
  const eligible    = entry.total_settled >= CONTEST_MIN_PICKS;
  const picksNeeded = Math.max(0, CONTEST_MIN_PICKS - entry.total_settled);

  return (
    <div
      onClick={onViewProfile}
      style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '28px 28px 1fr 62px 50px' : '36px 36px 1fr 70px 65px 55px 60px',
        alignItems: 'center',
        gap: isMobile ? '5px' : '6px',
        padding: isMobile ? '8px 10px' : '8px 12px',
        background: isMe ? 'rgba(255,184,0,0.06)' : eligible && entry.rank <= 3 ? 'rgba(74,222,128,0.03)' : 'transparent',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
        borderLeft: isMe ? '2px solid rgba(255,184,0,0.5)' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'background 0.15s',
        opacity: eligible ? 1 : 0.8,
      }}
      onMouseEnter={e => { if (!isMe) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={e => { if (!isMe) e.currentTarget.style.background = eligible && entry.rank <= 3 ? 'rgba(74,222,128,0.03)' : 'transparent'; }}
    >
      {/* Rank */}
      <div style={{ textAlign: 'center' }}>
        {eligible
          ? (entry.rank === 1 ? <span style={{ fontSize: isMobile ? '1rem' : '1.1rem' }}>🥇</span>
            : entry.rank === 2 ? <span style={{ fontSize: isMobile ? '1rem' : '1.1rem' }}>🥈</span>
            : entry.rank === 3 ? <span style={{ fontSize: isMobile ? '1rem' : '1.1rem' }}>🥉</span>
            : <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', color: 'var(--text-muted)' }}>#{entry.rank}</span>)
          : <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>—</span>}
      </div>
      {/* Avatar */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <UserAvatar userId={entry.user_id} avatarUrl={entry.avatar_url} avatarEmoji={entry.avatar_emoji} displayName={entry.display_name} username={entry.username} size={isMobile ? 24 : 30} />
      </div>
      {/* Name */}
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: isMobile ? '0.82rem' : '0.85rem', fontWeight: isMe ? 800 : 600, color: isMe ? 'var(--gold)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.display_name || entry.username}
          {isMe && <span style={{ marginLeft: '4px', fontSize: '0.6rem', color: 'var(--gold)', fontWeight: 700 }}>YOU</span>}
          {eligible && entry.rank <= 3 && <span style={{ marginLeft: '5px', fontSize: '0.58rem', color: '#4ade80', fontWeight: 700 }}>✓ ELIGIBLE</span>}
        </div>
        <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
          {entry.wins}W–{entry.losses}L{entry.pushes > 0 ? `–${entry.pushes}P` : ''}
          {!isMobile && entry.pending > 0 && <span style={{ color: '#60a5fa', marginLeft: '4px' }}>+{entry.pending} live</span>}
          {!eligible && <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: '4px' }}>· needs {picksNeeded} more</span>}
        </div>
      </div>
      {/* Units */}
      <div style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: isMobile ? '0.82rem' : '0.88rem', color: unitColor }}>
        {entry.units > 0 ? '+' : ''}{entry.units}u
      </div>
      {/* ROI */}
      <div style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono', fontSize: isMobile ? '0.75rem' : '0.78rem', color: unitColor }}>
        {entry.roi > 0 ? '+' : ''}{entry.roi}%
      </div>
      {/* Win% — desktop only */}
      {!isMobile && (
        <div style={{ textAlign: 'right', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {entry.total_settled > 0 ? ((entry.wins / entry.total_settled) * 100).toFixed(0) + '%' : '—'}
        </div>
      )}
      {/* Streak — desktop only */}
      {!isMobile && (
        <div style={{ textAlign: 'right' }}>
          {entry.streak > 0 && entry.streak_type
            ? <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.72rem', color: streakColor, fontWeight: 700 }}>
                {entry.streak_type}{entry.streak}
              </span>
            : <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>—</span>}
        </div>
      )}
    </div>
  );
}

// ── Announcement Banner ───────────────────────────────────────────────────────
function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState([]);
  useEffect(() => {
    fetch('/api/announcements')
      .then(r => r.json())
      .then(d => setAnnouncements(d.announcements || []))
      .catch(() => {});
  }, []);

  if (!announcements.length) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
      {announcements.map(a => (
        <div key={a.id} style={{
          background: a.type === 'contest_winner'
            ? 'linear-gradient(135deg, rgba(255,184,0,0.12) 0%, rgba(255,150,0,0.08) 100%)'
            : 'rgba(96,165,250,0.08)',
          border: `1px solid ${a.type === 'contest_winner' ? 'rgba(255,184,0,0.35)' : 'rgba(96,165,250,0.25)'}`,
          borderRadius: '10px', padding: '1rem 1.25rem',
          display: 'flex', alignItems: 'flex-start', gap: '12px',
        }}>
          <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>
            {a.type === 'contest_winner' ? '🏆' : '📢'}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: a.type === 'contest_winner' ? '#FFB800' : '#60a5fa', marginBottom: '3px' }}>
              {a.title}
            </div>
            {a.type === 'contest_winner' && a.winner_display_name && (
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                🎉 <strong style={{ color: 'var(--gold)' }}>{a.winner_display_name}</strong>
                {a.winner_record && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{a.winner_record}</span>}
                {a.winner_units != null && (
                  <span style={{ color: '#4ade80', fontFamily: 'IBM Plex Mono', fontWeight: 700, marginLeft: '8px' }}>
                    +{a.winner_units}u
                  </span>
                )}
              </div>
            )}
            {a.body && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{a.body}</div>}
            <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.25)', marginTop: '5px' }}>
              {a.month ? `${a.month} · ` : ''}{new Date(a.created_at).toLocaleDateString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Contest Standings Block ────────────────────────────────────────────────────
function ContestStandings({ userId, isDemo, refreshKey, onViewProfile, isMobile }) {
  const [cData, setCData]   = useState(null);
  const [cLoad, setCLoad]   = useState(true);

  const load = useCallback(async () => {
    setCLoad(true);
    try {
      const params = new URLSearchParams();
      if (isDemo) params.set('demo', '1');
      else if (userId) params.set('userId', userId);
      const res  = await fetch(`/api/contest-leaderboard?${params.toString()}`);
      const json = await res.json();
      setCData(json);
    } catch { /* silent */ }
    finally { setCLoad(false); }
  }, [userId, isDemo]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line

  const entries = cData?.leaderboard || [];

  return (
    <div style={{
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: '10px', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px', background: 'rgba(255,184,0,0.06)', borderBottom: '1px solid rgba(255,184,0,0.15)',
      }}>
        <div style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--gold)' }}>
          🏆 Contest Standings
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {cData && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>
              {entries.length} entered · {new Date(cData.cachedAt).toLocaleTimeString()}
            </span>
          )}
          <button onClick={load} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 7px', fontSize: '0.7rem' }}>↺</button>
        </div>
      </div>

      {/* Column labels */}
      {entries.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '28px 28px 1fr 62px 50px' : '36px 36px 1fr 70px 65px 55px 60px', gap: isMobile ? '5px' : '6px', padding: isMobile ? '5px 10px 4px' : '5px 12px 4px', background: 'rgba(255,255,255,0.02)' }}>
          {(isMobile ? ['', '', 'Player', 'Units', 'ROI'] : ['', '', 'Player', 'Units', 'ROI', 'Win%', 'Streak']).map((h, i) => (
            <div key={i} style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: i >= 3 ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>
      )}

      {/* Rows */}
      {cLoad ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          Loading contest standings…
        </div>
      ) : entries.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '6px' }}>🎯</div>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>No contest entries yet</div>
          <div style={{ fontSize: '0.75rem' }}>Log a pick and toggle <strong>Contest Entry</strong> to compete for the $100 prize.</div>
        </div>
      ) : (
        entries.map(entry => (
          <ContestRow key={entry.user_id} entry={entry} isMe={entry.user_id === userId} onViewProfile={() => onViewProfile?.(entry)} isMobile={isMobile} />
        ))
      )}
    </div>
  );
}

export default function LeaderboardTab({ user, isDemo, refreshKey = 0, defaultSubTab = 'contest', onOpenInbox }) {
  const [subTab, setSubTab]           = useState(defaultSubTab); // 'contest' | 'sharp'
  const [sharpFilter, setSharpFilter] = useState('verified');     // locked to verified only
  const [verifiedInfoOpen, setVerifiedInfoOpen] = useState(false);
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [profile, setProfile]         = useState(null);
  const [editOpen, setEditOpen]       = useState(false);
  const [viewEntry, setViewEntry]     = useState(null); // for PublicProfileModal

  const userId = user?.id;
  const isMobile = useIsMobile();

  const load = useCallback(async (filter = sharpFilter) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (isDemo) params.set('demo', '1');
      else if (userId) params.set('userId', userId);
      params.set('filter', filter);
      const res = await fetch(`/api/leaderboard?${params.toString()}`);
      const json = await res.json();
      // Only throw hard errors (not empty leaderboard)
      if (json.error && !json.leaderboard) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [userId, isDemo, sharpFilter]);

  useEffect(() => { load(); }, [load]);

  // Re-load when a contest pick is graded (cascade from HistoryTab via Dashboard)
  useEffect(() => { if (refreshKey > 0) load(); }, [refreshKey]); // eslint-disable-line

  // Load own profile
  useEffect(() => {
    if (!userId || isDemo) return;
    fetchProfile(userId).then(({ data }) => { if (data) setProfile(data); });
  }, [userId, isDemo]);

  const maxScore = data?.leaderboard?.[0]?.sharp_score || 1;
  const entries  = data?.leaderboard || [];

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* ── Sub-tab switcher ── */}
      <div style={{ display: 'flex', gap: '4px', padding: '3px', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border)', alignSelf: 'flex-start' }}>
        {[
          { id: 'contest', label: '🏆 Contest' },
          { id: 'sharp',   label: '📊 Leaderboard' },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            style={{
              background: subTab === t.id
                ? (t.id === 'contest' ? 'linear-gradient(135deg, rgba(255,184,0,0.2), rgba(255,149,0,0.15))' : 'var(--bg-surface)')
                : 'transparent',
              border: subTab === t.id
                ? (t.id === 'contest' ? '1px solid rgba(255,184,0,0.4)' : '1px solid var(--border)')
                : '1px solid transparent',
              borderRadius: '7px', padding: '6px 16px', cursor: 'pointer',
              color: subTab === t.id
                ? (t.id === 'contest' ? 'var(--gold)' : 'var(--text-primary)')
                : 'var(--text-muted)',
              fontSize: '0.8rem', fontWeight: subTab === t.id ? 700 : 400,
              transition: 'all 0.15s', whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ══ CONTEST TAB ══ */}
      {subTab === 'contest' && (
        <>
          <ContestBanner />
          <AnnouncementBanner />
          <ContestStandings userId={userId} isDemo={isDemo} refreshKey={refreshKey} onViewProfile={(entry) => setViewEntry(entry)} isMobile={isMobile} />
        </>
      )}

      {/* ══ SHARP BOARD TAB ══ */}
      {subTab === 'sharp' && (
        <>
          {/* Demo mode notice */}
          {(isDemo || data?.isDemo) && (
            <div style={{
              padding: '0.6rem 1rem', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)',
              borderRadius: '8px', fontSize: '0.78rem', color: '#93c5fd', display: 'flex', gap: '8px', alignItems: 'center',
            }}>
              <span>👁</span>
              <span><strong>Demo Preview</strong> — This is sample data. Create an account and log picks to appear on the real leaderboard.</span>
            </div>
          )}

          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h1 style={{ fontWeight: 900, fontSize: '1.4rem', color: 'var(--gold)', letterSpacing: '-0.02em', margin: 0 }}>
                📊 Leaderboard
              </h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '4px 0 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
                Ranked by Sharp Score — ROI × verified pick volume
                <button
                  onClick={() => setVerifiedInfoOpen(true)}
                  style={{
                    background: 'rgba(74,222,128,0.12)', color: '#4ade80',
                    border: '1px solid rgba(74,222,128,0.3)',
                    borderRadius: '4px', padding: '1px 7px', fontSize: '0.65rem', fontWeight: 700,
                    cursor: 'pointer', lineHeight: 1.4,
                  }}
                >
                  ✓ Verified Only
                </button>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              {data && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>
                  {entries.length} ranked · {new Date(data.cachedAt).toLocaleTimeString()}
                </span>
              )}
              <button onClick={load} style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: '6px', padding: '5px 10px', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: '0.75rem',
              }}>↺ Refresh</button>
              {!isDemo && (
                <button onClick={() => setEditOpen(true)} style={{
                  background: 'rgba(255,184,0,0.15)', border: '1px solid rgba(255,184,0,0.4)',
                  borderRadius: '6px', padding: '5px 10px', cursor: 'pointer',
                  color: 'var(--gold)', fontSize: '0.75rem', fontWeight: 700,
                }}>✎ My Profile</button>
              )}
            </div>
          </div>

      {/* User rank card */}
      {data?.userEntry && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,184,0,0.08), rgba(255,184,0,0.03))',
          border: '1px solid rgba(255,184,0,0.3)',
          borderRadius: '10px', padding: '1rem 1.25rem',
          display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
        }}>
          <UserAvatar userId={user?.id} avatarUrl={data.userEntry.avatar_url} avatarEmoji={data.userEntry.avatar_emoji} displayName={data.userEntry.display_name} username={data.userEntry.username} size={40} />
          <div>
            <div style={{ fontWeight: 800, color: 'var(--gold)', fontSize: '0.95rem' }}>
              You're ranked #{data.userRank} of {data.total}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              {data.userEntry.wins}–{data.userEntry.losses} · {fmt(data.userEntry.units)}u · Sharp Score {parseFloat(data.userEntry.sharp_score || 0).toFixed(1)}
            </div>
          </div>
        </div>
      )}

      {/* How it works info */}
      {!isDemo && !data?.userEntry && !loading && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '10px', padding: '1rem 1.25rem',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px', fontSize: '0.9rem' }}>
            📣 Get on the board
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.6 }}>
            Mark picks as <strong style={{ color: 'var(--text-secondary)' }}>Public</strong> in Pick History — that's all it takes.
            You appear here as soon as you have <strong style={{ color: 'var(--gold)' }}>1 public settled pick</strong>.
            <strong style={{ color: '#4ade80' }}> Verified picks</strong> (AI-audited before game start) boost your Sharp Score and show in the Verified filter.
          </div>
        </div>
      )}

      {/* Column headers */}
      {entries.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '36px 1fr 70px 65px' : '44px 1fr 80px 90px 80px 90px 100px',
          gap: isMobile ? '6px' : '8px',
          padding: isMobile ? '0 0.75rem' : '0 1rem',
        }}>
          {(isMobile ? ['', 'Handicapper', 'Units', 'ROI'] : ['', 'Handicapper', 'Record', 'Win %', 'Units', 'ROI', 'Sharp Score']).map((h, i) => (
            <span key={h} style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: isMobile && i >= 2 ? 'right' : 'left' }}>
              {h}
            </span>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{
              height: '58px', background: 'var(--bg-surface)', borderRadius: '8px',
              border: '1px solid var(--border)', opacity: 1 - i * 0.12,
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--red)', fontSize: '0.85rem' }}>
          Failed to load leaderboard: {error}
          <br />
          <button onClick={load} style={{ marginTop: '0.5rem', background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.8rem' }}>
            Try again
          </button>
        </div>
      )}

      {/* Fallback notice — when verified had 0 results but all-picks has data */}
      {!loading && !error && data?.filter === 'all_fallback' && entries.length > 0 && (
        <div style={{
          padding: '0.55rem 0.9rem', background: 'rgba(250,204,21,0.06)', border: '1px solid rgba(250,204,21,0.2)',
          borderRadius: '8px', fontSize: '0.75rem', color: '#facc15', display: 'flex', gap: '8px', alignItems: 'center',
        }}>
          <span>📋</span>
          <span>Showing <strong>all public picks</strong> — verified pick tracking is being set up. Once game start times sync, picks submitted before tipoff will earn ✓ Verified status and boost your Sharp Score.</span>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && entries.length === 0 && (
        <div style={{
          padding: '3rem 2rem', textAlign: 'center',
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🏆</div>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>No public handicappers yet</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Be the first to go public. Mark picks as Public in History and enable your leaderboard profile.
          </div>
        </div>
      )}

      {/* Leaderboard rows */}
      {!loading && entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {entries.map(entry => (
            <LeaderRow
              key={entry.user_id}
              entry={entry}
              maxScore={maxScore}
              isMe={entry.user_id === userId}
              onViewProfile={() => setViewEntry(entry)}
              isMobile={isMobile}
            />
          ))}
        </div>
      )}

      {/* Sharp Score explanation */}
      <div style={{
        padding: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Sharp Score</strong> = ROI × √(verified picks) ÷ 10. High ROI alone isn't enough — you need volume and consistency.{' '}
        Only <button onClick={() => setVerifiedInfoOpen(true)} style={{ background: 'none', border: 'none', padding: 0, color: '#4ade80', fontWeight: 700, cursor: 'pointer', fontSize: 'inherit', textDecoration: 'underline' }}>✓ Verified picks</button> count on this leaderboard.{' '}
        Any user with at least <strong style={{ color: 'var(--gold)' }}>1 verified pick</strong> appears here. Mark picks Public in Pick History to show up.
      </div>
        </>
      )}{/* end sharp tab */}

      {/* Verified info popup */}
      {verifiedInfoOpen && (
        <div
          onClick={() => setVerifiedInfoOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: '1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'var(--bg-elevated)', border: '1px solid rgba(74,222,128,0.3)',
              borderRadius: '12px', padding: '1.5rem', maxWidth: '420px', width: '100%',
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem' }}>
              <span style={{ fontSize: '1.4rem' }}>✓</span>
              <h3 style={{ margin: 0, fontWeight: 800, color: '#4ade80', fontSize: '1.1rem' }}>
                What is a Verified Pick?
              </h3>
              <button
                onClick={() => setVerifiedInfoOpen(false)}
                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}
              >×</button>
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.7 }}>
              <p style={{ margin: '0 0 0.75rem' }}>
                A <strong style={{ color: '#4ade80' }}>Verified Pick</strong> is one that has passed a multi-step AI audit before the game starts:
              </p>
              <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <li><strong>Submitted before game start</strong> — picks entered after tip-off or first pitch don't count.</li>
                <li><strong>Legitimate line</strong> — the odds are cross-checked against Pinnacle (the market's sharpest book) to confirm it's a real number.</li>
                <li><strong>AI-audited</strong> — our system checks for inconsistencies or retroactive edits.</li>
              </ul>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                Only verified picks count toward your Sharp Score and appear on this leaderboard. This keeps the rankings honest.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modals — outside tabs so they render regardless of active tab */}
      {editOpen && (
        <ProfileEditor
          user={user}
          profile={profile}
          onSave={(p) => setProfile(p)}
          onClose={() => setEditOpen(false)}
        />
      )}
      {viewEntry && (
        <PublicProfileModal
          entry={viewEntry}
          onClose={() => setViewEntry(null)}
          onOpenInbox={onOpenInbox}
          currentUser={user}
          contestOnly={defaultSubTab === 'contest'}
        />
      )}
    </div>
  );
}
