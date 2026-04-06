'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import PublicProfileModal from '../PublicProfileModal';
import { supabase } from '@/lib/supabase';

const POLL_INTERVAL = 6000;

// ── Rank system (mirrors src/app/api/chat/route.js) ──────────────────────────
export const RANKS = [
  { title: 'Degenerate',   minXp: 0,     emoji: '[bet]', color: '#888' },
  { title: 'Square',       minXp: 100,   emoji: '[target]', color: '#a78bfa' },
  { title: 'Handicapper',  minXp: 300,   emoji: '[stats]', color: '#60a5fa' },
  { title: 'Sharp',        minXp: 700,   emoji: '[sharp]', color: '#34d399' },
  { title: 'Steam Chaser', minXp: 1500,  emoji: '[fire]', color: '#fb923c' },
  { title: 'Wiseguy',      minXp: 3000,  emoji: '[vibe]', color: '#f472b6' },
  { title: 'Line Mover',   minXp: 6000,  emoji: '[up]', color: '#facc15' },
  { title: 'Syndicate',    minXp: 10000, emoji: '[gem]', color: '#38bdf8' },
  { title: 'Whale',        minXp: 20000, emoji: '[whale]', color: '#c084fc' },
  { title: 'Legend',       minXp: 40000, emoji: '[crown]', color: '#FFB800' },
];

export function getRankForXp(xp) {
  let rank = RANKS[0];
  for (const r of RANKS) { if ((xp || 0) >= r.minXp) rank = r; }
  return rank;
}

export function getRankByTitle(title) {
  return RANKS.find(r => r.title === title) || RANKS[0];
}

// ── RankBadge ─────────────────────────────────────────────────────────────────
export function RankBadge({ rankTitle, xp, size = 'sm', showTitle = true }) {
  const rank = rankTitle ? getRankByTitle(rankTitle) : getRankForXp(xp || 0);
  const fontSize = size === 'xs' ? '0.56rem' : size === 'sm' ? '0.62rem' : '0.72rem';
  const padding  = size === 'xs' ? '1px 4px'  : size === 'sm' ? '1px 5px'  : '2px 7px';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      fontSize, fontWeight: 700, padding, borderRadius: '4px',
      background: rank.color + '18',
      border: `1px solid ${rank.color}40`,
      color: rank.color,
      whiteSpace: 'nowrap', lineHeight: 1.4, flexShrink: 0,
    }}>
      {rank.emoji}{showTitle ? ` ${rank.title}` : ''}
    </span>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeLabel(dateStr) {
  const d = new Date(dateStr);
  const diff = Date.now() - d.getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Avatar({ emoji, size = 34 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, overflow: 'hidden',
    }}>
      <span>{emoji || '[user]'}</span>
    </div>
  );
}

// ── Context menu for mod/admin actions on a message ───────────────────────────
function MsgContextMenu({ msg, onClose, onDelete, onMute, onBan, onPromoteMod, isMod, isAdmin }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const menuStyle = {
    position: 'absolute', right: 0, top: '100%', zIndex: 100,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: '8px', padding: '4px', minWidth: '160px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  };
  const itemStyle = (color = 'var(--text-secondary)') => ({
    display: 'block', width: '100%', padding: '6px 10px', borderRadius: '5px',
    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
    fontSize: '0.78rem', color, fontFamily: 'inherit', fontWeight: 500,
  });

  return (
    <div ref={ref} style={menuStyle} onClick={e => e.stopPropagation()}>
      <button style={itemStyle('#f87171')} onClick={() => { onDelete(msg.id); onClose(); }}>[del] Delete message</button>
      {(isMod || isAdmin) && <>
        <div style={{ height: '1px', background: 'var(--border)', margin: '3px 0' }} />
        <button style={itemStyle('#fb923c')} onClick={() => { onMute(msg.user_id, msg.author?.display_name || msg.author?.username); onClose(); }}>[mute] Mute user</button>
        <button style={itemStyle('#f87171')} onClick={() => { onBan(msg.user_id, msg.author?.display_name || msg.author?.username); onClose(); }}>[X] Chat ban</button>
        {isAdmin && (
          <button style={itemStyle('#a78bfa')} onClick={() => { onPromoteMod(msg.user_id, msg.author?.display_name || msg.author?.username); onClose(); }}> Promote to Mod</button>
        )}
      </>}
    </div>
  );
}

// ── ChatBubble ────────────────────────────────────────────────────────────────
function ChatBubble({ msg, isMe, isMod, isAdmin, onDelete, onMute, onBan, onPromoteMod, onMentionClick }) {
  const [hovering, setHovering] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const author = msg.author;
  const displayName = author?.display_name || author?.username || 'Unknown';
  const rank = author?.rank_title ? getRankByTitle(author.rank_title) : getRankForXp(author?.xp || 0);
  const authorIsMod = author?.is_mod;
  const authorIsAdmin = author?.role === 'admin';

  const canModerate = (isMod || isAdmin) && !isMe;
  const canDelete   = isMe || isMod || isAdmin;

  return (
    <div
      style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '4px 0', position: 'relative' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => { setHovering(false); setShowMenu(false); }}
    >
      <button onClick={() => onMentionClick?.(msg.user_id, author)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
        <Avatar emoji={author?.avatar_emoji} size={32} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px', flexWrap: 'wrap' }}>
          <button onClick={() => onMentionClick?.(msg.user_id, author)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', color: isMe ? 'var(--gold)' : 'var(--text-primary)' }}>
            {displayName}
          </button>
          {/* Role badges */}
          {authorIsAdmin && (
            <span style={{ fontSize: '0.56rem', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(255,184,0,0.15)', border: '1px solid rgba(255,184,0,0.4)', color: '#FFB800' }}>
              [crown] ADMIN
            </span>
          )}
          {!authorIsAdmin && authorIsMod && (
            <span style={{ fontSize: '0.56rem', fontWeight: 800, padding: '1px 4px', borderRadius: '3px', background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa' }}>
               MOD
            </span>
          )}
          <RankBadge rankTitle={rank.title} size="xs" />
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', marginLeft: '2px' }}>
            {timeLabel(msg.created_at)}
          </span>
        </div>
        {/* Content */}
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
          {msg.content}
        </div>
      </div>

      {/* Hover actions */}
      {(hovering || showMenu) && (canDelete || canModerate) && (
        <div style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '2px' }}>
          {canDelete && (
            <button onClick={() => onDelete(msg.id)}
              title="Delete message"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '0.7rem', padding: '2px 5px', opacity: 0.7, borderRadius: '4px' }}>
              x
            </button>
          )}
          {canModerate && (
            <button onClick={() => setShowMenu(v => !v)}
              title="Mod actions"
              style={{ background: showMenu ? 'var(--bg-surface)' : 'none', border: showMenu ? '1px solid var(--border)' : 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem', padding: '2px 5px', borderRadius: '4px' }}>
              ...
            </button>
          )}
          {showMenu && (
            <MsgContextMenu
              msg={msg}
              onClose={() => setShowMenu(false)}
              onDelete={onDelete}
              onMute={onMute}
              onBan={onBan}
              onPromoteMod={onPromoteMod}
              isMod={isMod}
              isAdmin={isAdmin}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Mute dialog ───────────────────────────────────────────────────────────────
function MuteDialog({ target, onConfirm, onClose }) {
  const [duration, setDuration] = useState(30);
  const [reason, setReason]     = useState('');
  const options = [
    { label: '5 min',   value: 5 },
    { label: '30 min',  value: 30 },
    { label: '1 hour',  value: 60 },
    { label: '6 hours', value: 360 },
    { label: '1 day',   value: 1440 },
    { label: '1 week',  value: 10080 },
  ];
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.5rem', width: '320px', maxWidth: '92vw' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '0.3rem' }}>[mute] Mute {target}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '1rem' }}>User won't be able to send messages for the selected duration.</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {options.map(o => (
            <button key={o.value} onClick={() => setDuration(o.value)}
              style={{ padding: '4px 10px', borderRadius: '6px', border: `1px solid ${duration === o.value ? 'var(--gold)' : 'var(--border)'}`, background: duration === o.value ? 'rgba(255,184,0,0.15)' : 'var(--bg-elevated)', color: duration === o.value ? 'var(--gold)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
              {o.label}
            </button>
          ))}
        </div>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (optional)"
          style={{ width: '100%', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', color: 'var(--text-primary)', fontSize: '0.8rem', marginBottom: '0.75rem', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem' }}>Cancel</button>
          <button onClick={() => onConfirm(duration, reason)} style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', background: '#fb923c', color: '#000', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}>Mute</button>
        </div>
      </div>
    </div>
  );
}

// ── Mod Panel (sidebar, admin/mod only) ───────────────────────────────────────
function ModPanel({ userEmail, isAdmin, adminFetch, onRefresh }) {
  const [mods, setMods]     = useState([]);
  const [bans, setBans]     = useState([]);
  const [settings, setSettings] = useState({});
  const [saving, setSaving] = useState(false);
  const [tab, setTab]       = useState('settings');

  const load = useCallback(async () => {
    try {
      const [sRes, mRes, bRes] = await Promise.all([
        adminFetch('/api/admin?action=chat_settings'),
        adminFetch('/api/admin?action=chat_mods'),
        adminFetch('/api/admin?action=chat_bans'),
      ]);
      if (sRes?.settings) setSettings(sRes.settings);
      if (mRes?.mods)     setMods(mRes.mods);
      if (bRes?.bans)     setBans(bRes.bans);
    } catch { /* non-critical */ }
  }, [adminFetch]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const saveSetting = async (key, val) => {
    setSaving(true);
    await adminFetch('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'update_chat_settings', settings: { [key]: val } }) });
    setSettings(s => ({ ...s, [key]: val }));
    setSaving(false);
  };

  const unban = async (userId) => {
    await adminFetch('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'chat_unban', targetUserId: userId }) });
    setBans(b => b.filter(x => x.user_id !== userId));
  };

  const demoteMod = async (userId) => {
    await adminFetch('/api/admin', { method: 'POST', body: JSON.stringify({ action: 'chat_demote_mod', targetUserId: userId }) });
    setMods(m => m.filter(x => x.user_id !== userId));
  };

  const tabs = [
    { id: 'settings', label: '⚙ Settings' },
    ...(isAdmin ? [
      { id: 'mods',   label: ` Mods${mods.length ? ` (${mods.length})` : ''}` },
      { id: 'bans',   label: `[X] Bans${bans.length ? ` (${bans.length})` : ''}` },
    ] : []),
  ];

  const toggle = (key, val) => (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', cursor: 'pointer' }}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{val.label}</span>
      <input type="checkbox" checked={settings[key] === 'true'} onChange={e => saveSetting(key, e.target.checked ? 'true' : 'false')}
        style={{ accentColor: 'var(--gold)', width: '15px', height: '15px', cursor: 'pointer' }} />
    </label>
  );

  return (
    <div style={{ width: '220px', flexShrink: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: '7px 4px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.6rem', fontWeight: tab === t.id ? 800 : 500, color: tab === t.id ? 'var(--gold)' : 'var(--text-muted)', borderBottom: tab === t.id ? '2px solid var(--gold)' : '2px solid transparent', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.6rem' }}>
        {tab === 'settings' && (
          <div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Chat Room Settings</div>
            {toggle('chat_enabled',           { label: 'Chat enabled' })}
            {toggle('require_email_verified', { label: 'Require email verified' })}
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Min XP to chat</span>
              <input type="number" min="0" max="10000" value={settings.min_xp_to_chat || '0'}
                onChange={e => setSettings(s => ({ ...s, min_xp_to_chat: e.target.value }))}
                onBlur={e => saveSetting('min_xp_to_chat', e.target.value)}
                style={{ width: '60px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 5px', color: 'var(--text-primary)', fontSize: '0.75rem', textAlign: 'right' }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Max msg length</span>
              <input type="number" min="50" max="2000" value={settings.max_message_length || '500'}
                onChange={e => setSettings(s => ({ ...s, max_message_length: e.target.value }))}
                onBlur={e => saveSetting('max_message_length', e.target.value)}
                style={{ width: '60px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 5px', color: 'var(--text-primary)', fontSize: '0.75rem', textAlign: 'right' }} />
            </label>
            {saving && <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'center' }}>Saving...</div>}
          </div>
        )}

        {tab === 'mods' && (
          <div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Chat Moderators</div>
            {mods.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>No mods yet. Use the ... menu on any message to promote.</div>}
            {mods.map(m => (
              <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <Avatar emoji={m.profiles?.avatar_emoji} size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.profiles?.display_name || m.profiles?.username}
                  </div>
                  <RankBadge rankTitle={m.profiles?.rank_title} size="xs" />
                </div>
                <button onClick={() => demoteMod(m.user_id)}
                  title="Remove mod" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '0.7rem', flexShrink: 0 }}>x</button>
              </div>
            ))}
          </div>
        )}

        {tab === 'bans' && (
          <div>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Chat Banned Users</div>
            {bans.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>No active chat bans.</div>}
            {bans.map(b => (
              <div key={b.id} style={{ padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                  <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-primary)' }}>{b.profiles?.display_name || b.profiles?.username}</span>
                  <button onClick={() => unban(b.user_id)}
                    title="Unban" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#4ade80', fontSize: '0.65rem', marginLeft: 'auto' }}>Unban</button>
                </div>
                {b.reason && <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{b.reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ChatRoomTab ──────────────────────────────────────────────────────────
export default function ChatRoomTab({ user, isDemo, onOpenInbox }) {
  const userId   = user?.id;
  const username = user?.user_metadata?.username || user?.email?.split('@')[0] || '';

  const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const isAdmin = ADMIN_EMAILS.includes((user?.email || '').toLowerCase());

  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [text, setText]         = useState('');
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState('');
  const [popover, setPopover]   = useState(null);
  const [isMod, setIsMod]       = useState(false);
  const [myStatus, setMyStatus] = useState({ muted: false, banned: false });
  const [muteTarget, setMuteTarget]   = useState(null); // { userId, name }
  const [showModPanel, setShowModPanel] = useState(false);
  const bottomRef    = useRef(null);
  const pollRef      = useRef(null);
  const isAtBottom   = useRef(true);

  // Admin fetch helper (reuses session token)
  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  };

  const adminFetch = useCallback(async (url, opts = {}) => {
    const token = await getToken();
    if (!token) return null;
    const res = await fetch(url, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
    });
    return res.json().catch(() => null);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const markSeen = userId ? `&markSeen=${userId}` : '';
      const res  = await fetch(`/api/chat?limit=60${markSeen}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setMessages((json.messages || []).reverse());
    } catch (e) {
      console.error('[ChatRoom] load failed:', e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [userId]);

  // Load user's own chat status (muted/banned) + mod status
  const loadMyStatus = useCallback(async () => {
    if (!userId) return;
    const res = await fetch(`/api/chat?chatStatus=1&userId=${userId}`);
    const json = await res.json();
    setMyStatus({ muted: json.muted || false, banned: json.banned || false, muteExpiry: json.muteExpiry });
    setIsMod(json.isMod || false);
  }, [userId]);

  useEffect(() => {
    load();
    loadMyStatus();
    pollRef.current = setInterval(() => { load(true); loadMyStatus(); }, POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [load, loadMyStatus]);

  useEffect(() => {
    if (isAtBottom.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const content = text.trim();
    if (!content || !userId || sending) return;
    setSending(true); setError('');
    const token = await getToken();
    if (!token) { setError('Session expired - please sign in again.'); setSending(false); return; }
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ userId, content }),
    });
    const data = await res.json();
    if (data.error) { setError(data.error); setSending(false); return; }
    setText(''); setSending(false);
    await load(true);
    isAtBottom.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const deleteMsg = async (msgId) => {
    const token = await getToken();
    if (!token) return;
    await fetch('/api/chat', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ messageId: msgId, userId }),
    });
    setMessages(m => m.filter(x => x.id !== msgId));
  };

  const openMuteDialog = (targetUserId, targetName) => {
    setMuteTarget({ userId: targetUserId, name: targetName });
  };

  const confirmMute = async (durationMinutes, reason) => {
    if (!muteTarget) return;
    await fetch('/api/chat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await getToken()}` },
      body: JSON.stringify({ action: 'mute', targetUserId: muteTarget.userId, durationMinutes, reason }),
    });
    setMuteTarget(null);
    load(true);
  };

  const banUser = async (targetUserId, targetName) => {
    if (!confirm(`Chat-ban ${targetName}? They won't be able to send messages (account is not affected).`)) return;
    await fetch('/api/chat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await getToken()}` },
      body: JSON.stringify({ action: 'ban', targetUserId }),
    });
    load(true);
  };

  const promoteMod = async (targetUserId, targetName) => {
    if (!isAdmin) return;
    if (!confirm(`Promote ${targetName} to Chat Moderator?`)) return;
    await adminFetch('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'chat_promote_mod', targetUserId }),
    });
    load(true);
  };

  const handleKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleScroll = e => {
    const el = e.currentTarget;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const handleMentionClick = (uid, author) => {
    setPopover({ id: uid, username: author?.username, display_name: author?.display_name, avatar_emoji: author?.avatar_emoji });
  };

  const grouped = messages.map((msg, i) => ({
    ...msg,
    showHeader: i === 0 || messages[i - 1].user_id !== msg.user_id ||
      (new Date(msg.created_at) - new Date(messages[i - 1].created_at)) > 5 * 60 * 1000,
  }));

  const canModerate = isAdmin || isMod;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: 'calc(100vh - 80px)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f0f0f0', marginBottom: '2px' }}>[chat] Community Chat</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>Live chat for all BetOS users - discuss picks, lines, and sharp action.</p>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', color: '#4ade80' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
            Live
          </div>
          <button onClick={() => load()} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem' }}>[refresh]</button>
          {canModerate && (
            <button onClick={() => setShowModPanel(v => !v)}
              title="Mod Panel"
              style={{ background: showModPanel ? 'rgba(167,139,250,0.15)' : 'var(--bg-surface)', border: `1px solid ${showModPanel ? 'rgba(167,139,250,0.5)' : 'var(--border)'}`, borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: showModPanel ? '#a78bfa' : 'var(--text-muted)', fontSize: '0.72rem', fontWeight: 700 }}>
               Mod
            </button>
          )}
        </div>
      </div>

      {/* Main area */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>

        {/* Messages column */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <div
            onScroll={handleScroll}
            style={{ flex: 1, overflowY: 'auto', background: 'var(--bg-surface)', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', minHeight: 0 }}
          >
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[...Array(6)].map((_, i) => (
                  <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--bg-elevated)', animation: 'pulse 1.4s ease-in-out infinite', flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: '12px', width: '80px', background: 'var(--bg-elevated)', borderRadius: '4px', marginBottom: '6px', animation: 'pulse 1.4s ease-in-out infinite' }} />
                      <div style={{ height: '36px', background: 'var(--bg-elevated)', borderRadius: '6px', animation: 'pulse 1.4s ease-in-out infinite', opacity: 1 - i * 0.12 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && messages.length === 0 && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '8px' }}>
                <div style={{ fontSize: '2.5rem' }}>[chat]</div>
                <div style={{ fontWeight: 700 }}>No messages yet</div>
                <div style={{ fontSize: '0.78rem' }}>Be the first to say something!</div>
              </div>
            )}
            {!loading && grouped.map((msg, i) => {
              const isMe = msg.user_id === userId;
              return (
                <div key={msg.id}>
                  {msg.showHeader && i > 0 && <div style={{ height: '6px' }} />}
                  {!msg.showHeader ? (
                    <div style={{ paddingLeft: '42px', paddingBottom: '2px' }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <ChatBubble
                      msg={msg}
                      isMe={isMe}
                      isMod={isMod}
                      isAdmin={isAdmin}
                      onDelete={deleteMsg}
                      onMute={openMuteDialog}
                      onBan={banUser}
                      onPromoteMod={promoteMod}
                      onMentionClick={handleMentionClick}
                    />
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Compose area */}
          <div style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', padding: '0.65rem 0.85rem', display: 'flex', gap: '8px', alignItems: 'flex-end', flexShrink: 0 }}>
            {!userId || isDemo ? (
              <div style={{ flex: 1, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.5rem' }}>
                Sign in to participate in the chat.
              </div>
            ) : myStatus.banned ? (
              <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#f87171', fontWeight: 600 }}>[X] You are banned from Community Chat.</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '3px' }}>Contact an admin if you believe this is an error.</div>
              </div>
            ) : myStatus.muted ? (
              <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#fb923c', fontWeight: 600 }}>[mute] You are muted.</div>
                {myStatus.muteExpiry && (
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                    Expires {new Date(myStatus.muteExpiry).toLocaleString()}
                  </div>
                )}
              </div>
            ) : (
              <>
                <Avatar emoji={user?.user_metadata?.avatar_emoji} size={30} />
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder={`Message as ${username}... (Enter to send, Shift+Enter for newline)`}
                  maxLength={parseInt(500)}
                  rows={2}
                  style={{ flex: 1, resize: 'none', padding: '8px 12px', fontSize: '0.82rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4 }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end', flexShrink: 0 }}>
                  <button onClick={send} disabled={!text.trim() || sending}
                    style={{ padding: '8px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem', background: text.trim() && !sending ? 'rgba(255,184,0,0.18)' : 'var(--bg-surface)', border: `1px solid ${text.trim() && !sending ? 'rgba(255,184,0,0.4)' : 'var(--border)'}`, color: text.trim() && !sending ? 'var(--gold)' : 'var(--text-muted)', cursor: text.trim() && !sending ? 'pointer' : 'default', transition: 'all 0.15s' }}>
                    {sending ? '...' : '^ Send'}
                  </button>
                  {text.length > 400 && (
                    <span style={{ fontSize: '0.6rem', color: text.length > 480 ? '#f87171' : 'var(--text-muted)' }}>{text.length}/500</span>
                  )}
                </div>
              </>
            )}
          </div>

          {error && <div style={{ color: '#f87171', fontSize: '0.75rem', padding: '4px 12px', textAlign: 'center', background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>{error}</div>}
        </div>

        {/* Mod panel sidebar */}
        {showModPanel && canModerate && (
          <ModPanel
            userEmail={user?.email}
            isAdmin={isAdmin}
            adminFetch={adminFetch}
            onRefresh={load}
          />
        )}
      </div>

      {/* Mute dialog */}
      {muteTarget && (
        <MuteDialog
          target={muteTarget.name}
          onConfirm={confirmMute}
          onClose={() => setMuteTarget(null)}
        />
      )}

      {/* Profile popover */}
      {popover && (
        <PublicProfileModal
          entry={{ user_id: popover.id, ...popover }}
          onClose={() => setPopover(null)}
          onOpenInbox={onOpenInbox}
          currentUser={user}
        />
      )}
    </div>
  );
}
