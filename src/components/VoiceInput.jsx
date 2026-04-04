'use client';
import { useState, useRef, useCallback, useEffect } from 'react';

// ── useVoiceInput hook ────────────────────────────────────────────────────────
// Records audio via MediaRecorder, transcribes via Groq Whisper server-side.
// Much more reliable than the browser's Web Speech API (works on all browsers,
// no HTTPS-only restriction issues, consistent quality).
//
// Returns: { listening, transcribing, supported, start, stop }
export function useVoiceInput({ onResult, onPartial } = {}) {
  const [listening,    setListening]    = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [supported,    setSupported]    = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const streamRef        = useRef(null);

  // Check MediaRecorder support on mount
  useEffect(() => {
    setSupported(
      typeof window !== 'undefined' &&
      typeof navigator?.mediaDevices?.getUserMedia === 'function' &&
      typeof window.MediaRecorder !== 'undefined'
    );
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    mediaRecorderRef.current?.state === 'recording' && mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setListening(false);
  }, []);

  const start = useCallback(async () => {
    if (listening || transcribing) { stop(); return; }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      // Pick the best supported MIME type
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']
        .find(t => MediaRecorder.isTypeSupported(t)) || '';

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = mr;

      mr.ondataavailable = e => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };

      mr.onstop = async () => {
        // Stop all mic tracks immediately
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;

        const chunks = chunksRef.current;
        chunksRef.current = [];

        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 100) return; // too small — silence / accidental tap

        setTranscribing(true);
        try {
          const fd = new FormData();
          fd.append('audio', blob, 'audio.webm');

          const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
          const data = await res.json();

          if (data.text?.trim()) {
            onResult?.(data.text.trim());
          } else if (data.error) {
            console.warn('[VoiceInput] Transcription error:', data.error);
          }
        } catch (err) {
          console.warn('[VoiceInput] Fetch error:', err.message);
        }
        setTranscribing(false);
      };

      // Collect in 500ms chunks so we don't miss the last bit
      mr.start(500);
      setListening(true);

    } catch (err) {
      console.warn('[VoiceInput] getUserMedia error:', err.message);
      setListening(false);
      // Fallback hint — mic permission was denied or device unavailable
    }
  }, [listening, transcribing, stop, onResult]);

  return { listening, transcribing, supported, start, stop };
}

// ── VoiceButton component ─────────────────────────────────────────────────────
// Drop-in microphone button. Appends transcription to an input/textarea.
//
// Usage:
//   <VoiceButton value={text} onChange={setText} />
//   <VoiceButton value={text} onChange={setText} size="sm" />
export default function VoiceButton({ value = '', onChange, size = 'md', style = {} }) {
  const { listening, transcribing, supported, start, stop } = useVoiceInput({
    onResult: (transcript) => {
      const next = value ? `${value.trimEnd()} ${transcript}` : transcript;
      onChange?.(next);
    },
  });

  if (!supported) return null;

  const sizes = {
    sm: { width: '26px', height: '26px', fontSize: '0.78rem' },
    md: { width: '32px', height: '32px', fontSize: '0.9rem' },
    lg: { width: '38px', height: '38px', fontSize: '1.05rem' },
  };
  const sz = sizes[size] || sizes.md;

  const isActive = listening || transcribing;

  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); isActive ? stop() : start(); }}
      title={
        transcribing ? 'Transcribing…'
        : listening   ? 'Recording — click to stop'
        : 'Click to speak'
      }
      style={{
        ...sz,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
        transition: 'all 0.15s',
        background: listening
          ? 'rgba(255,69,96,0.15)'
          : transcribing
            ? 'rgba(255,184,0,0.12)'
            : 'rgba(255,184,0,0.10)',
        color: listening ? 'var(--red, #FF4560)' : transcribing ? '#FFB800' : 'var(--text-muted)',
        boxShadow: listening
          ? '0 0 0 4px rgba(255,69,96,0.20), 0 0 12px rgba(255,69,96,0.15)'
          : transcribing
            ? '0 0 0 3px rgba(255,184,0,0.20)'
            : 'none',
        animation: listening ? 'live-pulse 1.5s infinite' : 'none',
        ...style,
      }}
      onMouseEnter={e => {
        if (!isActive) {
          e.currentTarget.style.background = 'rgba(255,184,0,0.2)';
          e.currentTarget.style.color = 'var(--gold, #FFB800)';
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          e.currentTarget.style.background = 'rgba(255,184,0,0.10)';
          e.currentTarget.style.color = 'var(--text-muted)';
        }
      }}
    >
      {transcribing ? '⏳' : listening ? '⏹' : '🎤'}
    </button>
  );
}
