'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { RankBadge } from './tabs/ChatRoomTab';

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
               : { 'Content-Type': 'application/json' };
}


function UserAvatar({ userId, avatarUrl, avatarEmoji, displayName, username, size = 62 }) {
  const [imgErr, setImgErr] = useState(false);
  // Only show image if an explicit avatar_url is set (no speculative URL construction)
  const src = avatarUrl || null;

  function getInitials() {
    const name = displayName || username || '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

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
      background: src && !imgErr ? 'var(--bg-elevated)' : getBgColor(),
      border: '2px solid rgba(255,184,0,0.3)',
    }}>
      {src && !imgErr ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setImgErr(true)} />
      ) : avatarEmoji ? (
        <span style={{ fontSize: size * 0.45, lineHeight: 1, userSelect: 'none' }}>{avatarEmoji}</span>
      ) : (
        <span style={{
          fontSize: size * 0.34, fontWeight: 700, letterSpacing: '0.02em',
          color: 'var(--text-primary)', userSelect: 'none',
        }}>{getInitials()}</span>
      )}
    </div>
  );
}

/**
 * Shared public profile modal — used everywhere a username is clicked.
 *
 * Props:
 *   entry        — any shape with at least { user_id | id, username, display_name, avatar_emoji }
 *                  + optionally { rank, wins, losses, units, roi, sharp_score, verified_picks }
 *   onClose      — fn()
 *   onOpenInbox  — fn(recipient) — opens DM panel; if omitted, Message button is hidden
 *   currentUser  — logged-in user object ({ id, ... }) for Follow / Message logic
 *   contestOnly  — if true, shows only contest picks (Contest mode)
 */
export default function PublicProfileModal({ entry = {}, onClose, onOpenInbox, currentUser, contestOnly = false }) {
  const userId        = entry.user_id || entry.id;
  const currentUserId = currentUser?.id;
  const isMe          = userId === currentUserId;

  const [activeSection,  setActiveSection]  = useState('picks');
  const [profileData,    setProfileData]    = useState(null);
  const [loadingPicks,   setLoadingPicks]   = useState(true);
  const [following,      setFollowing]      = useState(false);
  const [followLoading,  setFollowLoading]  = useState(false);
  // People tab
  const [peopleSubTab,   setPeopleSubTab]   = useState('followers'); // 'followers' | 'following'
  const [peopleList,     setPeopleList]     = useState([]);
  const [loadingPeople,  setLoadingPeople]  = useState(false);
  // Nested profile drill-in (click a follower/following to view their profile)
  const [viewingEntry,   setViewingEntry]   = useState(null);
  // Mobile detection
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' && window.innerWidth < 600);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 600);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Fetch real profile data — pass auth token so API knows if we're the owner
  useEffect(() => {
    if (!userId) { setLoadingPicks(false); return; }
    // When viewing a contest profile, pass contestOnly so the API applies timing filters
    // to match the leaderboard scoring (prevents profile/leaderboard count mismatch)
    const qs = contestOnly ? `userId=${userId}&contestOnly=true` : `userId=${userId}`;
    (async () => {
      try {
        const headers = {};
        try {
          const { supabase } = await import('@/lib/supabase');
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
        } catch { /* no auth — fine, non-owner view */ }
        const r = await fetch(`/api/public-profile?${qs}`, { headers });
        const d = await r.json();
        setProfileData(d);
      } catch { /* ignore */ }
      setLoadingPicks(false);
    })();
  }, [userId, contestOnly]);

  // Check follow status — fetch from DB every time modal opens
  const [followCheckDone, setFollowCheckDone] = useState(false);
  useEffect(() => {
    if (!currentUserId || !userId || isMe) { setFollowCheckDone(true); return; }
    setFollowCheckDone(false);
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/follow?followerId=${currentUserId}&followingId=${userId}`);
        if (!r.ok) throw new Error(`Status ${r.status}`);
        const d = await r.json();
        if (!cancelled) setFollowing(!!d.following);
      } catch (err) {
        console.warn('[follow-check] Failed to fetch follow status:', err);
        // Retry once after a short delay
        try {
          await new Promise(res => setTimeout(res, 800));
          if (cancelled) return;
          const r2 = await fetch(`/api/follow?followerId=${currentUserId}&followingId=${userId}`);
          if (r2.ok) {
            const d2 = await r2.json();
            if (!cancelled) setFollowing(!!d2.following);
          }
        } catch { /* second attempt failed — leave state as-is, button will show loading */ }
      } finally {
        if (!cancelled) setFollowCheckDone(true);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUserId, userId, isMe]);

  const toggleFollow = async () => {
    if (!currentUserId || followLoading) return;
    setFollowLoading(true);
    try {
      const res = await fetch('/api/follow', {
        method: following ? 'DELETE' : 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({ followerId: currentUserId, followingId: userId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setFollowing(f => !f);
      } else {
        console.error('[follow] Server rejected:', data.error || res.status);
      }
    } catch (err) {
      console.error('[follow] Network error:', err);
    } finally { setFollowLoading(false); }
  };

  // Derived data — prefer fetched stats, fall back to entry props
  const stats          = profileData?.stats;
  const settledPicks   = profileData?.settled_picks || [];
  const pendingPicks   = profileData?.pending_picks  || [];
  const sportBreakdown = profileData?.sport_breakdown || [];
  const pendingCount   = pendingPicks.length || stats?.pending_count || 0;

  const { rank, avatar_emoji, avatar_url, display_name, username, sharp_score, rank_title, xp } = entry;
  const displayName   = display_name || username || 'Anonymous';
  const displayWins   = stats?.wins   ?? entry.wins   ?? 0;
  const displayLosses = stats?.losses ?? entry.losses ?? 0;
  const displayTotal  = stats?.total  ?? entry.total  ?? 0;
  const displayUnits  = stats?.units  ?? parseFloat(entry.units)  ?? 0;
  const displayRoi    = stats?.roi    ?? parseFloat(entry.roi)    ?? 0;
  const displayVerified = stats?.verified_picks ?? entry.verified_picks ?? 0;
  const displaySharp  = parseFloat(sharp_score || 0);
  const followerCount  = stats?.follower_count  ?? 0;
  const followingCount = stats?.following_count ?? 0;

  // Load people list when People tab is active
  useEffect(() => {
    if (activeSection !== 'people' || !userId) return;
    setLoadingPeople(true);
    const param = peopleSubTab === 'followers' ? `followingId=${userId}` : `followerId=${userId}`;
    fetch(`/api/follow?${param}`)
      .then(r => r.json())
      .then(d => { setPeopleList(d.users || []); setLoadingPeople(false); })
      .catch(() => setLoadingPeople(false));
  }, [activeSection, peopleSubTab, userId]);

  const winRate  = displayTotal > 0 ? ((displayWins / displayTotal) * 100).toFixed(1) : '—';
  const streak   = stats?.current_streak ?? 0;
  const streakAbs  = Math.abs(streak);
  const streakType = streak > 0 ? 'WIN' : streak < 0 ? 'LOSS' : null;

  // Contest stats — derived from settled picks with pick_type === 'contest'
  const contestPicks   = settledPicks.filter(p => p.pick_type === 'contest');
  const hasContestData = contestPicks.length > 0;
  const cWins   = contestPicks.filter(p => p.result === 'WIN').length;
  const cLosses = contestPicks.filter(p => p.result === 'LOSS').length;
  const cTotal  = cWins + cLosses;
  const cUnits  = contestPicks.reduce((s, p) => s + (p.profit || 0), 0);
  const cRoi    = cTotal > 0 ? (cUnits / cTotal) * 100 : 0;
  const cWinPct = cTotal > 0 ? ((cWins / cTotal) * 100).toFixed(1) : '—';

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 500, display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', padding: isMobile ? '0' : '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: isMobile ? '16px 16px 0 0' : '16px',
          width: '100%', maxWidth: isMobile ? '100%' : '680px',
          maxHeight: isMobile ? '92vh' : '90vh',
          overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Mobile drag handle — visual cue to tap backdrop or use Close button */}
        {isMobile && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px', flexShrink: 0 }} onClick={onClose}>
            <div style={{ width: '36px', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.2)' }} />
          </div>
        )}

        {/* Top accent bar — contest gets animated gold, standard gets a static subtle border */}
        {contestOnly && (
          <div style={{
            height: '3px', flexShrink: 0,
            background: 'linear-gradient(90deg, transparent 0%, #FFB800 25%, #FFD700 50%, #FF9500 75%, transparent 100%)',
            backgroundSize: '200% auto', animation: 'prize-shimmer 2.5s linear infinite',
          }} />
        )}

        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem 1rem', flexShrink: 0,
          background: 'linear-gradient(180deg, rgba(255,184,0,0.04) 0%, transparent 100%)',
          borderBottom: '1px solid var(--border)',
        }}>
          {/* Contest badge */}
          {contestOnly && (
            <div style={{ marginBottom: '10px' }}>
              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#FFB800', background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.3)', borderRadius: '6px', padding: '2px 10px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                🏆 Contest Profile
              </span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
            {/* Left: avatar + name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '1 1 0', minWidth: 0 }}>
              <div style={{ borderRadius: '50%', boxShadow: '0 0 18px rgba(255,184,0,0.22)', display: 'inline-flex', flexShrink: 0 }}>
                <UserAvatar userId={userId} avatarUrl={avatar_url || profileData?.profile?.avatar_url} avatarEmoji={avatar_emoji} displayName={display_name} username={username} size={isMobile ? 50 : 62} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 900, fontSize: isMobile ? '1rem' : '1.15rem', color: 'var(--text-primary)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {displayName}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>@{username}</span>
                  {(rank_title || xp != null) && <RankBadge rankTitle={rank_title} xp={xp} size="sm" />}
                </div>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '6px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => { setActiveSection('people'); setPeopleSubTab('followers'); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      color: 'var(--text-muted)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '3px',
                    }}
                    title="View followers"
                  >
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{followerCount}</span>
                    <span>follower{followerCount !== 1 ? 's' : ''}</span>
                  </button>
                  <span style={{ color: 'var(--border)', fontSize: '0.72rem' }}>·</span>
                  <button
                    onClick={() => { setActiveSection('people'); setPeopleSubTab('following'); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                      color: 'var(--text-muted)', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '3px',
                    }}
                    title="View following"
                  >
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{followingCount}</span>
                    <span>following</span>
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  {rank && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--gold)', background: 'rgba(255,184,0,0.12)', border: '1px solid rgba(255,184,0,0.35)', borderRadius: '5px', padding: '2px 8px', fontWeight: 800 }}>
                      #{rank} Ranked
                    </span>
                  )}
                  {displayVerified > 0 && (
                    <span style={{ fontSize: '0.68rem', color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: '5px', padding: '2px 8px', fontWeight: 800 }}>
                      ✓ {displayVerified} Verified
                    </span>
                  )}
                  {streakAbs >= 3 && streakType && (
                    <span style={{
                      fontSize: '0.68rem',
                      color: streakType === 'WIN' ? '#4ade80' : '#f87171',
                      background: streakType === 'WIN' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                      border: `1px solid ${streakType === 'WIN' ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                      borderRadius: '5px', padding: '2px 8px', fontWeight: 800,
                    }}>
                      {streakType === 'WIN' ? '🔥' : '🧊'} {streakAbs}-{streakType === 'WIN' ? 'W' : 'L'} streak
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Right: on desktop show all buttons; on mobile show only close (actions move below) */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
              {!isMobile && !isMe && currentUserId && (
                <button onClick={toggleFollow} disabled={followLoading || !followCheckDone} style={{
                  padding: '5px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700,
                  cursor: (followLoading || !followCheckDone) ? 'default' : 'pointer',
                  background: !followCheckDone ? 'rgba(255,255,255,0.05)' : following ? 'rgba(74,222,128,0.12)' : 'rgba(255,184,0,0.12)',
                  border: `1px solid ${!followCheckDone ? 'rgba(255,255,255,0.1)' : following ? 'rgba(74,222,128,0.4)' : 'rgba(255,184,0,0.4)'}`,
                  color: !followCheckDone ? '#666' : following ? '#4ade80' : 'var(--gold)', transition: 'all 0.15s',
                  opacity: followLoading ? 0.6 : 1,
                }}>
                  {!followCheckDone ? '…' : followLoading ? '…' : following ? '✓ Following' : '+ Follow'}
                </button>
              )}
              {!isMobile && !isMe && currentUserId && onOpenInbox && (
                <button
                  onClick={() => { onClose(); onOpenInbox({ id: userId, username, display_name, avatar_emoji }); }}
                  style={{
                    padding: '5px 12px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 700,
                    background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.35)',
                    color: '#60a5fa', cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  💬 Message
                </button>
              )}
              {/* Close — always visible, large touch target on mobile */}
              <button
                onClick={onClose}
                style={{
                  background: isMobile ? 'rgba(255,255,255,0.08)' : 'none',
                  border: isMobile ? '1px solid rgba(255,255,255,0.15)' : 'none',
                  color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '1.2rem', lineHeight: 1, borderRadius: '8px',
                  minWidth: '44px', minHeight: '44px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >✕</button>
            </div>
          </div>

          {/* Mobile action buttons row — shown below name on small screens */}
          {isMobile && !isMe && currentUserId && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <button onClick={toggleFollow} disabled={followLoading || !followCheckDone} style={{
                flex: 1, padding: '8px 12px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 700,
                cursor: (followLoading || !followCheckDone) ? 'default' : 'pointer',
                background: !followCheckDone ? 'rgba(255,255,255,0.05)' : following ? 'rgba(74,222,128,0.12)' : 'rgba(255,184,0,0.12)',
                border: `1px solid ${!followCheckDone ? 'rgba(255,255,255,0.1)' : following ? 'rgba(74,222,128,0.4)' : 'rgba(255,184,0,0.4)'}`,
                color: !followCheckDone ? '#666' : following ? '#4ade80' : 'var(--gold)', transition: 'all 0.15s',
                opacity: followLoading ? 0.6 : 1,
              }}>
                {!followCheckDone ? '…' : followLoading ? '…' : following ? '✓ Following' : '+ Follow'}
              </button>
              {onOpenInbox && (
                <button
                  onClick={() => { onClose(); onOpenInbox({ id: userId, username, display_name, avatar_emoji }); }}
                  style={{
                    flex: 1, padding: '8px 12px', borderRadius: '8px', fontSize: '0.82rem', fontWeight: 700,
                    background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.35)',
                    color: '#60a5fa', cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  💬 Message
                </button>
              )}
            </div>
          )}

          {/* Quick stats row — Overall */}
          <div style={{ marginTop: '0.75rem' }}>
            {hasContestData && (
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px', fontWeight: 700 }}>
                Overall
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)', gap: '6px' }}>
              {[
                { label: 'Record',     value: `${displayWins}-${displayLosses}`,
                  color: displayWins > displayLosses ? 'var(--green)' : displayWins < displayLosses ? 'var(--red)' : 'var(--text-primary)',
                  sub: `${displayTotal} picks` },
                { label: 'Win %',      value: winRate === '—' ? '—' : `${winRate}%`,
                  color: parseFloat(winRate) >= 55 ? 'var(--green)' : 'var(--text-primary)' },
                { label: 'Units',      value: `${displayUnits >= 0 ? '+' : ''}${displayUnits.toFixed(1)}u`,
                  color: displayUnits >= 0 ? 'var(--green)' : 'var(--red)' },
                { label: 'ROI',        value: `${displayRoi >= 0 ? '+' : ''}${displayRoi.toFixed(1)}%`,
                  color: displayRoi >= 0 ? 'var(--green)' : 'var(--red)' },
                { label: 'Sharp',      value: displaySharp.toFixed(1),
                  color: displaySharp >= 20 ? '#FFB800' : '#4ade80' },
              ].map(s => (
                <div key={s.label} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.55rem 0.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' }}>{s.label}</div>
                  <div style={{ fontFamily: 'IBM Plex Mono', fontSize: isMobile ? '0.82rem' : '0.93rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                  {s.sub && <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '1px' }}>{s.sub}</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Contest stats row — only shown when user has contest picks */}
          {hasContestData && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '0.6rem', color: '#FFB800', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>🏆 Contest</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(4, 1fr)', gap: '6px' }}>
                {[
                  { label: 'Record', value: `${cWins}-${cLosses}`,
                    color: cWins > cLosses ? 'var(--green)' : cWins < cLosses ? 'var(--red)' : 'var(--text-primary)',
                    sub: `${cTotal} picks` },
                  { label: 'Win %',  value: cWinPct === '—' ? '—' : `${cWinPct}%`,
                    color: parseFloat(cWinPct) >= 55 ? 'var(--green)' : 'var(--text-primary)' },
                  { label: 'Units',  value: `${cUnits >= 0 ? '+' : ''}${cUnits.toFixed(1)}u`,
                    color: cUnits >= 0 ? 'var(--green)' : 'var(--red)' },
                  { label: 'ROI',    value: `${cRoi >= 0 ? '+' : ''}${cRoi.toFixed(1)}%`,
                    color: cRoi >= 0 ? 'var(--green)' : 'var(--red)' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.2)', borderRadius: '8px', padding: '0.55rem 0.5rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.55rem', color: 'rgba(255,184,0,0.6)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '3px' }}>{s.label}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono', fontSize: isMobile ? '0.82rem' : '0.93rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                    {s.sub && <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', marginTop: '1px' }}>{s.sub}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Section tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {[
            { id: 'picks',  label: contestOnly ? '🏆 Contest Picks' : '📋 Pick History' },
            { id: 'stats',  label: '📊 Breakdown' },
            { id: 'people', label: `👥 People${followerCount + followingCount > 0 ? ` (${followerCount + followingCount})` : ''}` },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveSection(tab.id)} style={{
              flex: 1, padding: '0.65rem', border: 'none', cursor: 'pointer',
              background: activeSection === tab.id ? 'var(--bg-elevated)' : 'transparent',
              color: activeSection === tab.id ? 'var(--gold)' : 'var(--text-muted)',
              fontSize: '0.78rem', fontWeight: activeSection === tab.id ? 700 : 400,
              borderBottom: activeSection === tab.id ? '2px solid var(--gold)' : '2px solid transparent',
              transition: 'all 0.15s',
            }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem' }}>

          {/* ── Pick History ── */}
          {activeSection === 'picks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {loadingPicks && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[...Array(4)].map((_, i) => (
                    <div key={i} style={{ height: '52px', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)', animation: 'pulse 1.4s ease-in-out infinite', opacity: 1 - i * 0.2 }} />
                  ))}
                </div>
              )}

              {/* Pending picks — visible to owner, blurred to others */}
              {!loadingPicks && pendingCount > 0 && (
                <div style={{ marginBottom: '4px' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⏳ Active ({pendingCount})</span>
                    {!isMe && (
                      <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '1px 6px' }}>
                        🔒 Hidden until settled
                      </span>
                    )}
                  </div>
                  {pendingPicks.map((p, i) => {
                    const oddsNum = parseInt(p.odds);
                    return (
                      <div
                        key={p.id || i}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '10px',
                          padding: '0.6rem 0.85rem',
                          background: 'var(--bg-elevated)',
                          border: '1px solid rgba(96,165,250,0.18)',
                          borderRadius: '8px', borderLeft: '3px solid rgba(96,165,250,0.45)',
                          marginBottom: '4px',
                          filter: isMe ? 'none' : 'blur(5px)',
                          userSelect: isMe ? 'auto' : 'none',
                          pointerEvents: isMe ? 'auto' : 'none',
                          transition: 'filter 0.2s',
                        }}
                      >
                        <span style={{
                          fontSize: '0.62rem', fontWeight: 800, padding: '2px 5px', borderRadius: '4px', flexShrink: 0,
                          background: 'rgba(96,165,250,0.12)', color: '#60a5fa',
                          border: '1px solid rgba(96,165,250,0.3)',
                          minWidth: '28px', textAlign: 'center',
                        }}>
                          LIVE
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0 4px', fontWeight: 700 }}>{p.sport}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.team} — {p.bet_type || 'Moneyline'}
                            </span>
                          </div>
                          {p.notes && isMe && (
                            <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                              {p.notes}
                            </div>
                          )}
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                            {new Date(p.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.73rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                          {!isNaN(oddsNum) ? (oddsNum > 0 ? `+${oddsNum}` : oddsNum) : '—'}
                        </span>
                        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, color: '#94a3b8', minWidth: '46px', textAlign: 'right' }}>
                          {(p.units || 1).toFixed(1)}u
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Settled picks */}
              {!loadingPicks && (
                <>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                    {contestOnly ? 'Contest Picks' : 'Settled Picks'} ({settledPicks.length})
                  </div>
                  {settledPicks.map(p => {
                    const rc = p.result === 'WIN' ? 'var(--green)' : p.result === 'PUSH' ? '#94a3b8' : 'var(--red)';
                    const oddsNum = parseInt(p.odds);
                    return (
                      <div key={p.id} style={{
                        display: 'flex', alignItems: 'center', gap: '10px', padding: '0.6rem 0.85rem',
                        background: 'var(--bg-elevated)',
                        border: `1px solid ${p.result === 'WIN' ? 'rgba(74,222,128,0.15)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.15)' : 'rgba(255,69,96,0.12)'}`,
                        borderRadius: '8px', borderLeft: `3px solid ${rc}`,
                      }}>
                        <span style={{
                          fontSize: '0.62rem', fontWeight: 800, padding: '2px 5px', borderRadius: '4px', flexShrink: 0,
                          background: p.result === 'WIN' ? 'rgba(74,222,128,0.15)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.1)' : 'rgba(255,69,96,0.12)',
                          color: rc,
                          border: `1px solid ${p.result === 'WIN' ? 'rgba(74,222,128,0.3)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.3)' : 'rgba(255,69,96,0.25)'}`,
                          minWidth: '28px', textAlign: 'center',
                        }}>
                          {p.result === 'WIN' ? 'W' : p.result === 'PUSH' ? 'P' : 'L'}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.63rem', color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0 4px', fontWeight: 700 }}>{p.sport}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.team} — {p.bet_type || 'Moneyline'}
                            </span>
                            {p.verified && <span style={{ fontSize: '0.58rem', color: '#4ade80', fontWeight: 700 }}>✓</span>}
                          </div>
                          {p.notes && (
                            <div style={{ fontSize: '0.63rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '1px' }}>
                              {p.notes}
                            </div>
                          )}
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>
                            {new Date(p.created_at).toLocaleDateString()}
                          </div>
                        </div>
                        <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.73rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                          {!isNaN(oddsNum) ? (oddsNum > 0 ? `+${oddsNum}` : oddsNum) : '—'}
                        </span>
                        {p.profit !== null && (
                          <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, color: p.profit >= 0 ? 'var(--green)' : 'var(--red)', minWidth: '46px', textAlign: 'right' }}>
                            {p.profit >= 0 ? '+' : ''}{p.profit.toFixed(2)}u
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {settledPicks.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      {contestOnly ? 'No settled contest picks yet.' : pendingCount > 0 ? 'No settled picks yet — picks in progress above.' : 'No picks posted yet.'}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Breakdown / Stats tab ── */}
          {activeSection === 'stats' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

              {/* Sharp Score bar */}
              {!contestOnly && displaySharp > 0 && (
                <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Sharp Score</span>
                    <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '1.1rem', color: displaySharp >= 20 ? '#FFB800' : '#4ade80' }}>
                      {displaySharp.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: '5px',
                      width: `${Math.min((displaySharp / 40) * 100, 100)}%`,
                      background: displaySharp >= 20 ? 'linear-gradient(90deg, #FFB800, #FF9500)' : 'linear-gradient(90deg, #4ade80, #22c55e)',
                      transition: 'width 0.8s ease',
                    }} />
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                    ROI × √(verified picks) ÷ 10 — rewards consistency under pressure
                  </div>
                </div>
              )}

              {/* Recent form squares */}
              {settledPicks.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', fontWeight: 700 }}>
                    Recent Form (last {Math.min(settledPicks.length, 10)})
                  </div>
                  <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                    {settledPicks.slice(0, 10).map((p, i) => (
                      <div key={i} style={{
                        width: '32px', height: '32px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: p.result === 'WIN' ? 'rgba(0,212,139,0.15)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.1)' : 'rgba(255,69,96,0.15)',
                        border: `1px solid ${p.result === 'WIN' ? 'rgba(0,212,139,0.35)' : p.result === 'PUSH' ? 'rgba(148,163,184,0.3)' : 'rgba(255,69,96,0.35)'}`,
                        fontSize: '0.68rem', fontWeight: 800,
                        color: p.result === 'WIN' ? 'var(--green)' : p.result === 'PUSH' ? '#94a3b8' : 'var(--red)',
                      }}>
                        {p.result === 'WIN' ? 'W' : p.result === 'PUSH' ? 'P' : 'L'}
                      </div>
                    ))}
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', paddingLeft: '4px' }}>← most recent</span>
                  </div>
                </div>
              )}

              {/* Sport breakdown */}
              {sportBreakdown.length > 0 && (
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', fontWeight: 700 }}>
                    By Sport
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {sportBreakdown.map(({ sport, wins: sw, losses: sl }) => {
                      const wr = sw + sl > 0 ? (sw / (sw + sl)) * 100 : 0;
                      return (
                        <div key={sport} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', minWidth: '46px' }}>{sport}</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', minWidth: '44px' }}>{sw}-{sl}</span>
                          <div style={{ flex: 1, height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: '3px', width: `${wr}%`, background: wr >= 55 ? 'var(--green)' : wr >= 45 ? '#fbbf24' : 'var(--red)', transition: 'width 0.6s ease' }} />
                          </div>
                          <span style={{ fontSize: '0.68rem', fontFamily: 'IBM Plex Mono', color: wr >= 55 ? 'var(--green)' : 'var(--text-muted)', minWidth: '38px', textAlign: 'right' }}>
                            {wr.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {loadingPicks && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem' }}>Loading stats…</div>
              )}
              {!loadingPicks && settledPicks.length === 0 && (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '1rem' }}>No public pick data yet.</div>
              )}
            </div>
          )}

          {/* ── People tab ── */}
          {activeSection === 'people' && (
            <div>
              {/* Sub-tab pills */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '1rem', padding: '3px', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border)', alignSelf: 'flex-start', width: 'fit-content' }}>
                {[
                  { id: 'followers', label: `Followers (${followerCount})` },
                  { id: 'following', label: `Following (${followingCount})` },
                ].map(t => (
                  <button key={t.id} onClick={() => setPeopleSubTab(t.id)} style={{
                    padding: '5px 14px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                    background: peopleSubTab === t.id ? 'var(--bg-surface)' : 'transparent',
                    color: peopleSubTab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                    boxShadow: peopleSubTab === t.id ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
                    transition: 'all 0.15s',
                  }}>{t.label}</button>
                ))}
              </div>

              {loadingPeople && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {[...Array(3)].map((_, i) => (
                    <div key={i} style={{ height: '52px', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)', animation: 'pulse 1.4s ease-in-out infinite', opacity: 1 - i * 0.25 }} />
                  ))}
                </div>
              )}

              {!loadingPeople && peopleList.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  {peopleSubTab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
                </div>
              )}

              {!loadingPeople && peopleList.map(person => (
                <div key={person.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '0.65rem 0.85rem', marginBottom: '6px',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px',
                  cursor: 'pointer', transition: 'border-color 0.15s',
                }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(255,184,0,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  onClick={() => setViewingEntry({ user_id: person.id, username: person.username, display_name: person.display_name, avatar_emoji: person.avatar_emoji })}
                >
                  <UserAvatar userId={person.id} avatarUrl={person.avatar_url} avatarEmoji={person.avatar_emoji} displayName={person.display_name} username={person.username} size={38} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      {person.display_name || person.username}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>@{person.username}</div>
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>→</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '0.55rem 1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: '0.7rem' }}>🔒</span>
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', flex: 1 }}>
            {isMe ? 'Your pending picks are visible only to you.' : 'Pending picks are blurred until settled.'} Only public picks are shown.
          </span>
          {/* For own profile: quick inbox link */}
          {isMe && onOpenInbox && (
            <button onClick={() => { onClose(); onOpenInbox(); }} style={{
              background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)',
              borderRadius: '6px', color: '#60a5fa', fontSize: '0.7rem', fontWeight: 600,
              padding: '3px 10px', cursor: 'pointer', flexShrink: 0,
            }}>
              💬 Open Inbox
            </button>
          )}
          {/* Mobile close button in footer — easy to tap */}
          {isMobile && (
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px', color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 600,
              padding: '6px 14px', cursor: 'pointer', flexShrink: 0,
            }}>
              Close
            </button>
          )}
        </div>
      </div>

      {/* Nested profile drill-in — when clicking a follower/following */}
      {viewingEntry && (
        <PublicProfileModal
          entry={viewingEntry}
          onClose={() => setViewingEntry(null)}
          onOpenInbox={onOpenInbox}
          currentUser={currentUser}
        />
      )}
    </div>
  );
}
