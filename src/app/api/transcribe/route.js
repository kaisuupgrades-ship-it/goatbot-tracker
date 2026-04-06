import { NextResponse } from 'next/server';

export const maxDuration = 30;

// Supported audio MIME types that Groq Whisper accepts
const SUPPORTED_TYPES = [
  'audio/webm', 'audio/webm;codecs=opus',
  'audio/ogg', 'audio/ogg;codecs=opus',
  'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/flac',
];

export async function POST(req) {
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GROQ_API_KEY) {
    return NextResponse.json(
      { error: 'GROQ_API_KEY not configured', hint: 'Add GROQ_API_KEY to .env.local (free at console.groq.com)' },
      { status: 503 }
    );
  }

  try {
    const formData = await req.formData();
    const audioBlob = formData.get('audio');

    if (!audioBlob || typeof audioBlob.size === 'undefined') {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    if (audioBlob.size < 100) {
      return NextResponse.json({ error: 'Audio file too small - nothing recorded' }, { status: 400 });
    }

    // Build a multipart form for Groq
    const groqForm = new FormData();

    // Groq requires the file to have a supported extension in its filename
    const mimeType = audioBlob.type || 'audio/webm';
    const ext = mimeType.includes('ogg') ? 'ogg'
               : mimeType.includes('mp4') ? 'mp4'
               : mimeType.includes('mpeg') ? 'mp3'
               : mimeType.includes('wav')  ? 'wav'
               : mimeType.includes('flac') ? 'flac'
               : 'webm';

    groqForm.append('file', audioBlob, `audio.${ext}`);
    groqForm.append('model', 'whisper-large-v3-turbo');  // fastest Groq Whisper model
    groqForm.append('response_format', 'json');
    groqForm.append('language', 'en');

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        // Note: do NOT set Content-Type — let fetch set it with the boundary
      },
      body: groqForm,
    });

    if (!groqRes.ok) {
      const err = await groqRes.json().catch(() => ({}));
      console.error('[transcribe] Groq error:', groqRes.status, err);
      return NextResponse.json(
        { error: err?.error?.message || `Groq returned ${groqRes.status}` },
        { status: groqRes.status }
      );
    }

    const result = await groqRes.json();
    const text = (result.text || '').trim();

    if (!text) {
      return NextResponse.json({ text: '', warning: 'No speech detected' });
    }

    return NextResponse.json({ text });

  } catch (err) {
    console.error('[transcribe] Error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
