'use client';
import { useState, useEffect } from 'react';
import PublicProfileModal from '../PublicProfileModal';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

function ResultStrip({ results = [] }) {
  if (!results.length) return null;
  return (
    <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
      {results.map((r, i) => (
        <div key={i} title={r} style={{
          width: '14px', height: '14px', borderRadius: '3px', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: '0.5rem', fontWeight: 800,
          background: r === 'WIN' ? 'rgba(74,222,128,0.15)' : r === 'LOSS' ? 'rgba(248,113,113,0.15)' : 'rgba(148,163,184,0.15)',
          color: r === 'WIN' ? '#4ade80' : r === 'LOSS' ? '#f87171' : '#94a3b8',
          border: `1px solid ${r === 'WIN' ? 'rgba(74,222,128,0.25)' : r === 'LOSS' ? 'rgba(248,113,113,0.25)' : 'rgba(148,163,184,0.2)'}`,
        }}>
          {r === 'WIN' ? 'W' : r === 'LOSS' ? 'L' : 'P'}
        </div>
      ))}
    </div>
  );
}

function FollowedUserCard({ entry, onUnfollow, userId, onViewProfile }) {
  const roi = entry.roi ?? 0;
  return (
    <div
      onClick={(e) => { if (e.target.closest('button')) return; onViewProfile?.(entry); }}
      style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px',
        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px',
        cursor: 'pointer', transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(96,165,250,0.35)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.3)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      {/* Avatar */}
      <div style={{
        width: '40px', height: '40px', borderRadius: '50%', flexShrink: 0,
        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.1rem', overflow: 'hidden', position: 'relative',
      }}>
        {(entry.avatar_url || (SUPABASE_URL && entry.user_id))
          ? <img
              src={entry.avatar_url || `${SUPABASE_URL}/storage/v1/object/public/avatars/${entry.user_id}.jpg`}
              alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
              onError={e => { e.target.style.display = 'none'; }}
            />
          : null}
        <span style={{ position: 'relative', zIndex: 1 }}>{entry.avatar_emoji || entry.username?.[0]?.toUpperCase() || '?'}</span>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
          {entry.display_name || entry.username}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {entry.wins ?? 0}W–{entry.losses ?? 0}L · {entry.total ?? 0} picks
          </span>
          <ResultStrip results={entry.recent_results || []} />
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '14px', flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>ROI</div>
          <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.85rem', color: roi >= 0 ? '#4ade80' : '#f87171' }}>
            {roi >= 0 ? '+' : ''}{roi.toFixed(1)}%
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.55rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Units</div>
          <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.85rem', color: (entry.units ?? 0) >= 0 ? '#4ade80' : '#f87171' }}>
            {(entry.units ?? 0) >= 0 ? '+' : ''}{(entry.units ?? 0).toFixed(2)}u
          </div>
        </div>
      </div>

      {/* Unfollow */}
      <button
        onClick={() => onUnfollow(entry)}
        title="Unfollow"
        style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
          padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem',
          transition: 'all 0.15s', flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = '#f87171'; e.currentTarget.style.color = '#f87171'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
      >
        Unfollow
      </button>
    </div>
  );
}

export default function FollowingTab({ user, isDemo, onOpenInbox, isActive }) {
  const [following,    setFollowing]    = useState([]);
  const [stats,        setStats]        = useState({});
  const [loading,      setLoading]      = useState(true);
  const [viewProfile,  setViewProfile]  = useState(null);
  const userId = user?.id;

  useEffect(() => {
    // Re-fetch every time the tab becomes active so new follows always show
    if (!isActive) return;
    if (!userId || isDemo) { setLoading(false); return; }
    setLoading(true);
    setStats({});
    // 1. Get list of followed users
    fetch(`/api/follow?followerId=${userId}`)
      .then(r => r.json())
      .then(async data => {
        const list = data.following || [];
        setFollowing(list);
        if (list.length === 0) { setLoading(false); return; }
        // 2. Fetch authoritative stats for each user from public-profile —
        //    same endpoint the profile modal uses, so stats are always in sync.
        const profiles = await Promise.allSettled(
          list.map(u =>
            fetch(`/api/public-profile?userId=${u.id}`)
              .then(r => r.json())
              .catch(() => null)
          )
        );
        const statMap = {};
        profiles.forEach((result, i) => {
          const uid = list[i].id;
          if (result.status === 'fulfilled' && result.value?.stats) {
            const s = result.value.stats;
            const p = result.value.profile || {};
            statMap[uid] = {
              user_id:        uid,
              wins:           s.wins,
              losses:         s.losses,
              pushes:         s.pushes,
              total:          s.total,
              units:          s.units,
              roi:            s.roi,
              current_streak: s.current_streak,
              recent_results: (result.value.settled_picks || [])
                .slice(0, 10)
                .map(p => p.result),
              // Pull avatar fields from profile so they're always fresh
              avatar_emoji:   p.avatar_emoji  || null,
              avatar_url:     p.avatar_url    || null,
              display_name:   p.display_name  || null,
              username:       p.username      || null,
            };
          }
        });
        setStats(statMap);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [userId, isDemo, isActive]); // eslint-disable-line

  const handleUnfollow = async (entry) => {
    await fetch('/api/follow', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followerId: userId, followingId: entry.id }),
    });
    setFollowing(f => f.filter(u => u.id !== entry.id));
  };

  if (isDemo || !userId) {
    return (
      <div style={{ padding: '3rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '2rem', marginBottom: '8px' }}>👥</div>
        <div style={{ fontWeight: 700, marginBottom: '4px' }}>Sign in to follow cappers</div>
        <div style={{ fontSize: '0.78rem' }}>Use User Search to find and follow the sharpest bettors.</div>
      </div>
    );
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <h2 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f0f0f0', marginBottom: '2px' }}>👥 Following</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', margin: 0 }}>
          Cappers you follow — all-time stats.
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ height: '64px', background: 'var(--bg-surface)', borderRadius: '10px', border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite', opacity: 1 - i * 0.2 }} />
          ))}
        </div>
      ) : following.length === 0 ? (
        <div style={{ padding: '3rem 2rem', textAlign: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>👥</div>
          <div style={{ fontWeight: 700, marginBottom: '4px' }}>No one followed yet</div>
          <div style={{ fontSize: '0.78rem' }}>Head to User Search and click a capper's row to view their profile and follow them.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {following.map(u => (
            <FollowedUserCard
              key={u.id}
              entry={{ ...u, user_id: u.id, ...(stats[u.id] || {}) }}
              onUnfollow={handleUnfollow}
              userId={userId}
              onViewProfile={(entry) => setViewProfile(entry)}
            />
          ))}
        </div>
      )}

      {viewProfile && (
        <PublicProfileModal
          entry={viewProfile}
          onClose={() => setViewProfile(null)}
          onOpenInbox={onOpenInbox}
          currentUser={user}
        />
      )}
    </div>
  );
}
