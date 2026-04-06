'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

const WELCOME = "Hey! I'm the BetOS support bot 🤖 I can help you troubleshoot issues, explain features, or give betting advice. What's up?";

const QUICK_ACTIONS = [
  'How do I enter the contest?',
  'Why was my pick flagged?',
  'AI analysis not working',
  'Chat requires email verification?',
];

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', padding: '4px 0' }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: '6px', height: '6px', borderRadius: '50%',
          background: 'var(--text-muted)',
          animation: 'pulse 1.2s ease-in-out infinite',
          animationDelay: `${i * 0.2}s`,
        }} />
      ))}
    </div>
  );
}

export default function SupportChatWidget({ user }) {
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: WELCOME },
  ]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [unread,   setUnread]   = useState(0);
  const [concernLogged, setConcernLogged] = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) { setUnread(0); inputRef.current?.focus(); }
  }, [open]);

  const send = useCallback(async (text) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput('');
    setLoading(true);
    setConcernLogged(false);

    const userMsg = { role: 'user', content };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);

    try {
      const res = await fetch('/api/support-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newHistory.map(m => ({ role: m.role, content: m.content })),
          userId: user?.id || null,
          username: user?.user_metadata?.username || null,
        }),
      });
      const data = await res.json();
      const reply = data.reply || "I couldn't generate a response. Please try again.";
      setMessages(h => [...h, { role: 'assistant', content: reply }]);
      if (data.concernLogged) setConcernLogged(true);
      // If widget is closed, show unread badge
      if (!open) setUnread(u => u + 1);
    } catch {
      setMessages(h => [...h, { role: 'assistant', content: "Connection error — please try again in a moment." }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, open, user]);

  const handleKey = e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const clearChat = () => {
    setMessages([{ role: 'assistant', content: WELCOME }]);
    setConcernLogged(false);
  };

  return (
    <>
      {/* ── Widget container ── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: '72px', right: '16px', zIndex: 900,
          width: 'min(360px, calc(100vw - 32px))',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: '14px',
          boxShadow: '0 24px 60px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column',
          maxHeight: 'min(520px, calc(100vh - 100px))',
          overflow: 'hidden',
          animation: 'fadeInUp 0.2s ease',
        }}>
          {/* Header */}
          <div style={{
            padding: '10px 14px', background: 'var(--bg-elevated)',
            borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(255,184,0,0.15)', border: '1px solid rgba(255,184,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem' }}>🤖</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>BetOS Support</div>
              <div style={{ fontSize: '0.62rem', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
                Online
              </div>
            </div>
            <button onClick={clearChat} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.7rem', padding: '2px 6px' }} title="Clear chat">↺</button>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1rem', padding: '2px 4px' }}>✕</button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '12px',
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            {messages.map((m, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '85%', padding: '8px 12px', borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                  background: m.role === 'user' ? 'rgba(255,184,0,0.15)' : 'var(--bg-elevated)',
                  border: `1px solid ${m.role === 'user' ? 'rgba(255,184,0,0.25)' : 'var(--border)'}`,
                  fontSize: '0.82rem', lineHeight: 1.5,
                  color: m.role === 'user' ? 'var(--gold)' : 'var(--text-secondary)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '8px 12px', borderRadius: '12px 12px 12px 2px', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <TypingDots />
                </div>
              </div>
            )}

            {concernLogged && (
              <div style={{ fontSize: '0.68rem', color: '#fbbf24', textAlign: 'center', padding: '4px', background: 'rgba(251,191,36,0.05)', borderRadius: '6px', border: '1px solid rgba(251,191,36,0.15)' }}>
                ⚠ Your concern has been flagged for admin review.
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Quick actions — only on first message */}
          {messages.length === 1 && !loading && (
            <div style={{ padding: '0 12px 8px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {QUICK_ACTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => send(q)}
                  style={{
                    padding: '4px 10px', borderRadius: '20px', fontSize: '0.7rem',
                    border: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)',
                    color: 'var(--text-muted)', cursor: 'pointer', transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,184,0,0.3)'; e.currentTarget.style.color = 'var(--gold)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{
            padding: '8px 10px', borderTop: '1px solid var(--border)',
            display: 'flex', gap: '6px', alignItems: 'flex-end',
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything…"
              rows={1}
              maxLength={500}
              style={{
                flex: 1, resize: 'none', padding: '6px 10px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: '8px', color: 'var(--text-primary)', fontSize: '0.82rem',
                outline: 'none', fontFamily: 'inherit', lineHeight: 1.4,
                maxHeight: '80px', overflowY: 'auto',
              }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || loading}
              style={{
                padding: '6px 12px', borderRadius: '8px', fontWeight: 700, fontSize: '0.78rem',
                border: 'none',
                background: input.trim() && !loading ? 'rgba(255,184,0,0.85)' : 'rgba(255,255,255,0.06)',
                color: input.trim() && !loading ? '#000' : 'var(--text-muted)',
                cursor: input.trim() && !loading ? 'pointer' : 'default',
                transition: 'all 0.12s', flexShrink: 0,
              }}
            >
              {loading ? '…' : '↑'}
            </button>
          </div>
        </div>
      )}

      {/* ── Launcher button ── */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'fixed', bottom: '16px', right: '16px', zIndex: 900,
          width: '48px', height: '48px', borderRadius: '50%',
          background: open ? 'rgba(255,184,0,0.9)' : 'rgba(255,184,0,0.15)',
          border: `2px solid ${open ? 'rgba(255,184,0,0.6)' : 'rgba(255,184,0,0.3)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.2rem', cursor: 'pointer', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          transition: 'all 0.2s',
        }}
        title="BetOS Support Chat"
      >
        {open ? '✕' : '💬'}
        {!open && unread > 0 && (
          <div style={{
            position: 'absolute', top: '-4px', right: '-4px',
            width: '18px', height: '18px', borderRadius: '50%',
            background: '#f87171', border: '2px solid var(--bg-base)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.6rem', fontWeight: 800, color: '#fff',
          }}>
            {unread}
          </div>
        )}
      </button>
    </>
  );
}
