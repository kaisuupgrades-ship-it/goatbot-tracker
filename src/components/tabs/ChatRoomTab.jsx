'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import PublicProfileModal from '../PublicProfileModal';
import { supabase } from '@/lib/supabase';
const POLL_INTERVAL = 6000; // 6 seconds

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

function Avatar({ userId, avatarUrl, emoji, size = 34 }) {
  const [err, setErr] = useState(false);
  const hasPhoto = !!avatarUrl && !err;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, overflow: 'hidden',
    }}>
      {hasPhoto
        ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setErr(true)} />
        : <span>{emoji || '👤'}</span>}
    </div>
  );
}

function ChatBubble({ msg, isMe, onDelete, onMentionClick }) {
  const [hovering, setHovering] = useState(false);
  const author = msg.author;
  const displayName = author?.display_name || author?.username || 'Unknown';

  return (
    <div
      style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '6px 0' }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Avatar */}
      <button
        onClick={() => onMentionClick?.(msg.user_id, author)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}
        title={`View ${displayName}'s profile`}
      >
        <Avatar userId={msg.user_id} emoji={author?.avatar_emoji} size={32} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Name + time */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '2px', flexWrap: 'wrap' }}>
          <button
            onClick={() => onMentionClick?.(msg.user_id, author)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem', color: isMe ? 'var(--gold)' : 'var(--text-primary)' }}
          >
            {displayName}
          </button>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>
            {timeLabel(msg.created_at)}
          </span>
        </div>

        {/* Content */}
        <div style={{
          fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5,
          wordBreak: 'break-word', whiteSpace: 'pre-wrap',
        }}>
          {msg.content}
        </div>
      </div>

      {/* Delete (own messages, on hover) */}
      {isMe && hovering && onDelete && (
        <button
          onClick={() => onDelete(msg.id)}
          title="Delete message"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '0.75rem', padding: '2px 4px', opacity: 0.7, flexShrink: 0 }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

export default function ChatRoomTab({ user, isDemo, onOpenInbox }) {
  const userId      = user?.id;
  const username    = user?.user_metadata?.username || user?.email?.split('@')[0] || '';
  const [messages, setMessages]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [text, setText]           = useState('');
  const [sending, setSending]     = useState(false);
  const [error, setError]         = useState('');
  const [popover, setPopover]     = useState(null); // { id, username, display_name, avatar_emoji }
  const bottomRef                 = useRef(null);
  const pollRef                   = useRef(null);
  const isAtBottom                = useRef(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const markSeen = user?.id ? `&markSeen=${user.id}` : '';
    const res  = await fetch(`/api/chat?limit=60${markSeen}`);
    const json = await res.json();
    // API returns newest-first, reverse for display
    setMessages((json.messages || []).reverse());
    if (!silent) setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(() => load(true), POLL_INTERVAL);
    return () => clearInterval(pollRef.current);
  }, [load]);

  // Scroll to bottom on new messages if already near bottom
  useEffect(() => {
    if (isAtBottom.current) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  };

  const send = async () => {
    const content = text.trim();
    if (!content || !userId || sending) return;
    setSending(true); setError('');
    const token = await getToken();
    if (!token) { setError('Session expired — please sign in again.'); setSending(false); return; }
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ userId, content }),
    });
    const data = await res.json();
    if (data.error) { setError(data.error); setSending(false); return; }
    setText('');
    setSending(false);
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

  const handleKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleScroll = (e) => {
    const el = e.currentTarget;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const handleMentionClick = (uid, author) => {
    setPopover({ id: uid, username: author?.username, display_name: author?.display_name, avatar_emoji: author?.avatar_emoji });
  };

  // Group consecutive messages from same user
  const grouped = messages.map((msg, i) => ({
    ...msg,
    showHeader: i === 0 || messages[i - 1].user_id !== msg.user_id ||
      (new Date(msg.created_at) - new Date(messages[i - 1].created_at)) > 5 * 60 * 1000,
  }));

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: 'calc(100vh - 80px)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f0f0f0', marginBottom: '2px' }}>💬 Community Chat</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>
            Live chat for all BetOS users — discuss picks, lines, and sharp action.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.7rem', color: '#4ade80' }}>
            <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', display: 'inline-block', animation: 'pulse 2s ease-in-out infinite' }} />
            Live
          </div>
          <button onClick={() => load()} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem' }}>↺</button>
        </div>
      </div>

      {/* Message list */}
      <div
        onScroll={handleScroll}
        style={{
          flex: 1, overflowY: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '10px 10px 0 0', padding: '0.75rem 1rem',
          display: 'flex', flexDirection: 'column', minHeight: 0,
        }}
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
            <div style={{ fontSize: '2.5rem' }}>💬</div>
            <div style={{ fontWeight: 700 }}>No messages yet</div>
            <div style={{ fontSize: '0.78rem' }}>Be the first to say something!</div>
          </div>
        )}

        {!loading && grouped.map((msg, i) => {
          const isMe = msg.user_id === userId;
          return (
            <div key={msg.id}>
              {msg.showHeader && i > 0 && <div style={{ height: '8px' }} />}
              {!msg.showHeader ? (
                // Compact follow-up message (no header)
                <div
                  style={{ paddingLeft: '42px', paddingBottom: '2px' }}
                  onMouseEnter={() => {}}
                >
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5, wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                    {msg.content}
                  </div>
                </div>
              ) : (
                <ChatBubble
                  msg={msg}
                  isMe={isMe}
                  onDelete={isMe ? deleteMsg : null}
                  onMentionClick={handleMentionClick}
                />
              )}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Compose area */}
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderTop: 'none',
        borderRadius: '0 0 10px 10px', padding: '0.65rem 0.85rem',
        display: 'flex', gap: '8px', alignItems: 'flex-end', flexShrink: 0,
      }}>
        {!userId || isDemo ? (
          <div style={{ flex: 1, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.5rem' }}>
            Sign in to participate in the chat.
          </div>
        ) : !user?.email_confirmed_at ? (
          <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#fbbf24', fontWeight: 600 }}>✉️ Email verification required</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '3px' }}>
              Please verify your email address to participate in Community Chat.
            </div>
          </div>
        ) : (
          <>
            <Avatar userId={userId} emoji={user?.user_metadata?.avatar_emoji} size={30} />
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={handleKey}
              placeholder={`Message as ${username}… (Enter to send, Shift+Enter for newline)`}
              maxLength={500}
              rows={2}
              style={{
                flex: 1, resize: 'none', padding: '8px 12px', fontSize: '0.82rem',
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: '10px', color: 'var(--text-primary)', outline: 'none',
                fontFamily: 'inherit', lineHeight: 1.4,
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end', flexShrink: 0 }}>
              <button
                onClick={send}
                disabled={!text.trim() || sending}
                style={{
                  padding: '8px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem',
                  background: text.trim() && !sending ? 'rgba(255,184,0,0.18)' : 'var(--bg-surface)',
                  border: `1px solid ${text.trim() && !sending ? 'rgba(255,184,0,0.4)' : 'var(--border)'}`,
                  color: text.trim() && !sending ? 'var(--gold)' : 'var(--text-muted)',
                  cursor: text.trim() && !sending ? 'pointer' : 'default',
                  transition: 'all 0.15s',
                }}
              >
                {sending ? '…' : '↑ Send'}
              </button>
              {text.length > 400 && (
                <span style={{ fontSize: '0.6rem', color: text.length > 480 ? '#f87171' : 'var(--text-muted)' }}>
                  {text.length}/500
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {error && <div style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '4px', textAlign: 'center' }}>{error}</div>}

      {/* Full profile modal from clicking a name */}
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
