'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

// ── useVoiceInput hook ────────────────────────────────────────────────────────
// Returns { listening, supported, start, stop, transcript }
export function useVoiceInput({ onResult, onPartial, lang = 'en-US' } = {}) {
  const [listening,  setListening]  = useState(false);
  const [supported,  setSupported]  = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SR = typeof window !== 'undefined'
      && (window.SpeechRecognition || window.webkitSpeechRecognition);
    setSupported(!!SR);
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.lang              = lang;
    rec.continuous        = false;
    rec.interimResults    = true;
    rec.maxAlternatives   = 1;
    recognitionRef.current = rec;

    rec.onstart  = () => setListening(true);
    rec.onend    = () => setListening(false);
    rec.onerror  = () => setListening(false);

    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const text = last[0].transcript;
      if (last.isFinal) {
        onResult?.(text);
      } else {
        onPartial?.(text);
      }
    };

    rec.start();
  }, [lang, onResult, onPartial]);

  // Cleanup on unmount
  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { listening, supported, start, stop };
}

// ── VoiceButton component ──────────────────────────────────────────────────────
// Drop-in microphone button. Appends transcription to an input/textarea.
// Usage:
//   <VoiceButton value={text} onChange={setText} />
export default function VoiceButton({ value = '', onChange, size = 'md', style = {} }) {
  const { listening, supported, start, stop } = useVoiceInput({
    onResult: (transcript) => {
      const trimmed = transcript.trim();
      if (!trimmed) return;
      // Append with a space separator if there's existing text
      const next = value ? `${value.trimEnd()} ${trimmed}` : trimmed;
      onChange?.(next);
    },
  });

  if (!supported) return null;

  const sizes = {
    sm: { width: '26px', height: '26px', fontSize: '0.75rem' },
    md: { width: '32px', height: '32px', fontSize: '0.9rem' },
    lg: { width: '38px', height: '38px', fontSize: '1.05rem' },
  };
  const sz = sizes[size] || sizes.md;

  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); listening ? stop() : start(); }}
      title={listening ? 'Stop listening (click)' : 'Click to speak'}
      style={{
        ...sz,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
        transition: 'all 0.15s',
        background: listening
          ? 'rgba(255,69,96,0.15)'
          : 'rgba(255,184,0,0.10)',
        color: listening ? 'var(--red)' : 'var(--text-muted)',
        boxShadow: listening
          ? '0 0 0 4px rgba(255,69,96,0.20), 0 0 12px rgba(255,69,96,0.15)'
          : 'none',
        animation: listening ? 'live-pulse 1.5s infinite' : 'none',
        ...style,
      }}
      onMouseEnter={e => { if (!listening) { e.currentTarget.style.background = 'rgba(255,184,0,0.2)'; e.currentTarget.style.color = 'var(--gold)'; } }}
      onMouseLeave={e => { if (!listening) { e.currentTarget.style.background = 'rgba(255,184,0,0.10)'; e.currentTarget.style.color = 'var(--text-muted)'; } }}
    >
      {listening ? '⏹' : '🎤'}
    </button>
  );
}
