'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  return token ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
               : { 'Content-Type': 'application/json' };
}

function Avatar({ userId, avatarUrl, emoji, size = 36 }) {
  const [err, setErr] = useState(false);
  // Only show a photo if an explicit avatar_url was provided — never speculatively
  // construct one from userId because the storage bucket returns a default goat logo
  // for users who haven't uploaded a photo.
  const hasPhoto = !!avatarUrl && !err;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, overflow: 'hidden',
    }}>
      {hasPhoto
        ? <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setErr(true)} />
        : <span>{emoji || '[user]'}</span>}
    </div>
  );
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'now';
  if (mins < 60)  return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7)   return `${days}d`;
  return new Date(dateStr).toLocaleDateString();
}

// ── Conversation list ─────────────────────────────────────────────────────────
function ConvList({ userId, conversations, loading, activePartnerId, onSelect, onCompose }) {
  const totalUnread = conversations.reduce((s, c) => s + (c.unread || 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '1rem 1rem 0.75rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>[chat] Messages</span>
          {totalUnread > 0 && (
            <span style={{ fontSize: '0.65rem', fontWeight: 800, background: '#f87171', color: '#fff', borderRadius: '10px', padding: '1px 7px', minWidth: '20px', textAlign: 'center' }}>
              {totalUnread}
            </span>
          )}
        </div>
        <button
          onClick={onCompose}
          title="New message"
          style={{ background: 'rgba(255,184,0,0.12)', border: '1px solid rgba(255,184,0,0.35)', borderRadius: '7px', padding: '4px 10px', cursor: 'pointer', color: 'var(--gold)', fontSize: '0.78rem', fontWeight: 700 }}
        >
          [edit] New
        </button>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', padding: '4px 0' }}>
            {[...Array(4)].map((_, i) => (
              <div key={i} style={{ height: '62px', background: 'var(--bg-elevated)', margin: '0 8px 4px', borderRadius: '8px', animation: 'pulse 1.4s ease-in-out infinite', opacity: 1 - i * 0.2 }} />
            ))}
          </div>
        )}
        {!loading && conversations.length === 0 && (
          <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>[chat]</div>
            No messages yet. Find a capper and hit Message to start a conversation.
          </div>
        )}
        {conversations.map(conv => {
          const isActive = conv.partner_id === activePartnerId;
          const preview  = conv.last_message?.content || '';
          const isMeSender = conv.last_message?.sender_id === userId;
          return (
            <button
              key={conv.partner_id}
              onClick={() => onSelect(conv)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                padding: '10px 12px', border: 'none', cursor: 'pointer',
                background: isActive ? 'rgba(255,184,0,0.07)' : 'transparent',
                borderLeft: isActive ? '3px solid var(--gold)' : '3px solid transparent',
                transition: 'all 0.1s', textAlign: 'left',
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--bg-elevated)'; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <Avatar userId={conv.partner_id} emoji={conv.partner?.avatar_emoji} size={38} />
                {conv.unread > 0 && (
                  <span style={{ position: 'absolute', top: -2, right: -2, background: '#f87171', color: '#fff', borderRadius: '50%', width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.52rem', fontWeight: 800, border: '2px solid var(--bg-surface)' }}>
                    {conv.unread}
                  </span>
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: conv.unread > 0 ? 800 : 600, fontSize: '0.82rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {conv.partner?.display_name || conv.partner?.username || 'Unknown'}
                  </span>
                  <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {timeAgo(conv.last_message?.created_at)}
                  </span>
                </div>
                <div style={{ fontSize: '0.72rem', color: conv.unread > 0 ? 'var(--text-secondary)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: conv.unread > 0 ? 600 : 400 }}>
                  {isMeSender ? 'You: ' : ''}{preview.length > 60 ? preview.slice(0, 60) + '...' : preview}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Message thread ────────────────────────────────────────────────────────────
function MessageThread({ userId, partner, messages, loading, sending, onSend, onBack }) {
  const [text, setText]       = useState('');
  const bottomRef             = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const t = text.trim();
    if (!t || sending) return;
    onSend(t);
    setText('');
  };

  const handleKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Thread header */}
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '2px 4px', flexShrink: 0 }}>{'<-'}</button>
        <Avatar userId={partner?.id} emoji={partner?.avatar_emoji} size={32} />
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{partner?.display_name || partner?.username}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>@{partner?.username}</div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem 1rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {loading && <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem', padding: '1rem' }}>Loading...</div>}
        {!loading && messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem', padding: '2rem 1rem' }}>
            Start the conversation with {partner?.display_name || partner?.username}
          </div>
        )}
        {messages.map(msg => {
          const isMe = msg.sender_id === userId;
          return (
            <div key={msg.id} style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: '6px' }}>
              {!isMe && <Avatar userId={msg.sender_id} emoji={msg.sender?.avatar_emoji} size={26} />}
              <div style={{
                maxWidth: '78%', padding: '8px 12px', borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: isMe ? 'rgba(255,184,0,0.15)' : 'var(--bg-elevated)',
                border: `1px solid ${isMe ? 'rgba(255,184,0,0.3)' : 'var(--border)'}`,
                fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.45,
                wordBreak: 'break-word',
              }}>
                {msg.content}
                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '3px', textAlign: isMe ? 'right' : 'left' }}>
                  {timeAgo(msg.created_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Compose bar */}
      <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'flex-end', flexShrink: 0 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message... (Enter to send)"
          rows={2}
          style={{
            flex: 1, resize: 'none', padding: '8px 12px', fontSize: '0.82rem',
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: '10px', color: 'var(--text-primary)', outline: 'none',
            fontFamily: 'inherit', lineHeight: 1.4,
          }}
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          style={{
            padding: '8px 14px', borderRadius: '10px', fontWeight: 700, fontSize: '0.82rem',
            background: text.trim() && !sending ? 'rgba(255,184,0,0.18)' : 'var(--bg-elevated)',
            border: `1px solid ${text.trim() && !sending ? 'rgba(255,184,0,0.4)' : 'var(--border)'}`,
            color: text.trim() && !sending ? 'var(--gold)' : 'var(--text-muted)',
            cursor: text.trim() && !sending ? 'pointer' : 'default',
            transition: 'all 0.15s', flexShrink: 0, alignSelf: 'flex-end',
          }}
        >
          Send ^
        </button>
      </div>
    </div>
  );
}

// ── Compose (new message to someone you haven't messaged) ─────────────────────
function ComposeView({ userId, onSent, onCancel }) {
  const [to,      setTo]      = useState('');
  const [content, setContent] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults]   = useState([]);
  const [picked, setPicked]     = useState(null);
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState('');
  const debounce = useRef(null);

  useEffect(() => {
    if (picked) return;
    clearTimeout(debounce.current);
    if (to.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    debounce.current = setTimeout(async () => {
      const res = await fetch(`/api/user-search?sort=volume&days=0`);
      const json = await res.json();
      const q = to.toLowerCase();
      setResults((json.entries || []).filter(e =>
        (e.username || '').toLowerCase().includes(q) || (e.display_name || '').toLowerCase().includes(q)
      ).slice(0, 5));
      setSearching(false);
    }, 350);
    return () => clearTimeout(debounce.current);
  }, [to, picked]);

  const send = async () => {
    if (!picked || !content.trim()) return;
    setSending(true); setError('');
    const res = await fetch('/api/messages', {
      method: 'POST', headers: await authHeaders(),
      body: JSON.stringify({ senderId: userId, recipientId: picked.user_id, content: content.trim() }),
    });
    const data = await res.json();
    if (data.error) { setError(data.error); setSending(false); return; }
    onSent(picked);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '2px 4px' }}>{'<-'}</button>
        <span style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>New Message</span>
      </div>

      <div style={{ flex: 1, padding: '1rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* To field */}
        <div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '5px' }}>To:</div>
          {picked ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.3)', borderRadius: '8px' }}>
              <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: 700, color: 'var(--gold)' }}>{picked.display_name || picked.username}</span>
              <button onClick={() => { setPicked(null); setTo(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.9rem' }}>x</button>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search username..."
                value={to}
                onChange={e => setTo(e.target.value)}
                style={{ width: '100%', padding: '7px 10px', fontSize: '0.82rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box' }}
              />
              {results.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 10, marginTop: '4px', overflow: 'hidden' }}>
                  {results.map(r => (
                    <button key={r.user_id} onClick={() => { setPicked(r); setResults([]); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      <span style={{ fontSize: '1rem' }}>{r.avatar_emoji || '[user]'}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)' }}>{r.display_name || r.username}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>@{r.username}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Message */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '5px' }}>Message:</div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Write your message..."
            style={{ flex: 1, resize: 'none', padding: '10px 12px', fontSize: '0.82rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-primary)', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4, minHeight: '120px' }}
          />
        </div>

        {error && <div style={{ color: '#f87171', fontSize: '0.78rem' }}>{error}</div>}

        <button
          onClick={send}
          disabled={!picked || !content.trim() || sending}
          style={{
            padding: '10px', borderRadius: '10px', fontWeight: 700, fontSize: '0.85rem',
            background: picked && content.trim() && !sending ? 'rgba(255,184,0,0.18)' : 'var(--bg-elevated)',
            border: `1px solid ${picked && content.trim() && !sending ? 'rgba(255,184,0,0.4)' : 'var(--border)'}`,
            color: picked && content.trim() && !sending ? 'var(--gold)' : 'var(--text-muted)',
            cursor: picked && content.trim() && !sending ? 'pointer' : 'default',
          }}
        >
          {sending ? 'Sending...' : 'Send Message ^'}
        </button>
      </div>
    </div>
  );
}

// ── Main InboxPanel ───────────────────────────────────────────────────────────
export default function InboxPanel({ user, isOpen, onClose, initialRecipient = null }) {
  const userId = user?.id;

  const [view, setView]             = useState('list'); // 'list' | 'thread' | 'compose'
  const [conversations, setConvs]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [activePartner, setPartner] = useState(null); // { id, username, display_name, avatar_emoji }
  const [messages, setMessages]     = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending]       = useState(false);
  const pollRef                     = useRef(null);

  // Load inbox
  const loadInbox = useCallback(async () => {
    if (!userId) return;
    const res  = await fetch(`/api/messages?userId=${userId}`);
    const json = await res.json();
    setConvs(json.conversations || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!isOpen || !userId) return;
    loadInbox();
    pollRef.current = setInterval(loadInbox, 10000); // poll every 10s
    return () => clearInterval(pollRef.current);
  }, [isOpen, userId, loadInbox]);

  // Open directly to a recipient (from Message button on profile)
  useEffect(() => {
    if (!isOpen || !initialRecipient) return;
    openThread(initialRecipient);
  }, [isOpen, initialRecipient?.id]); // eslint-disable-line

  const openThread = async (partner) => {
    setPartner(partner);
    setView('thread');
    setLoadingThread(true);
    const res  = await fetch(`/api/messages?userId=${userId}&withUser=${partner.id}`);
    const json = await res.json();
    setMessages(json.messages || []);
    setLoadingThread(false);
    // Refresh inbox to clear unread badges
    loadInbox();
  };

  const sendMessage = async (content) => {
    if (!activePartner || sending) return;
    setSending(true);
    await fetch('/api/messages', {
      method: 'POST', headers: await authHeaders(),
      body: JSON.stringify({ senderId: userId, recipientId: activePartner.id, content }),
    });
    // Reload thread
    const res  = await fetch(`/api/messages?userId=${userId}&withUser=${activePartner.id}`);
    const json = await res.json();
    setMessages(json.messages || []);
    setSending(false);
    loadInbox();
  };

  const handleConvSelect = (conv) => {
    openThread({
      id:           conv.partner_id,
      username:     conv.partner?.username,
      display_name: conv.partner?.display_name,
      avatar_emoji: conv.partner?.avatar_emoji,
    });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 400, backdropFilter: 'blur(1px)' }}
      />

      {/* Panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: '360px', maxWidth: '92vw',
        background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
        zIndex: 401, display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.5)',
        animation: 'slideInRight 0.22s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); opacity: 0; }
            to   { transform: translateX(0);    opacity: 1; }
          }
        `}</style>

        {/* Close button */}
        <button
          onClick={onClose}
          style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 10, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem', padding: '4px' }}
        >
          x
        </button>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {!userId ? (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>[chat]</div>
              Sign in to send and receive messages.
            </div>
          ) : view === 'list' ? (
            <ConvList
              userId={userId}
              conversations={conversations}
              loading={loading}
              activePartnerId={activePartner?.id}
              onSelect={handleConvSelect}
              onCompose={() => setView('compose')}
            />
          ) : view === 'thread' ? (
            <MessageThread
              userId={userId}
              partner={activePartner}
              messages={messages}
              loading={loadingThread}
              sending={sending}
              onSend={sendMessage}
              onBack={() => { setView('list'); loadInbox(); }}
            />
          ) : (
            <ComposeView
              userId={userId}
              onSent={(recipient) => openThread({ id: recipient.user_id, ...recipient })}
              onCancel={() => setView('list')}
            />
          )}
        </div>
      </div>
    </>
  );
}
