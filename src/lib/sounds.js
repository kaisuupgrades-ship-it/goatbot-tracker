/**
 * BetOS Sound Effects — synthesized via Web Audio API (no external files needed).
 * All sounds are generated programmatically so there are zero dependencies.
 *
 * Usage:
 *   import { playWin, playLoss, playGrade, playTick } from '@/lib/sounds';
 *   playWin();  // cash register cha-ching on WIN
 */

function getCtx() {
  try {
    return new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return null;
  }
}

/**
 * playWin() — Cash register "cha-ching" for a WIN grade.
 * Two rising metallic tones + coin-jingle tail.
 */
export function playWin() {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Helper: schedule a metallic ping
  function ping(freq, startTime, duration, volume = 0.35) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    // Add slight distortion for a metallic feel
    const wave = ctx.createWaveShaper();
    wave.curve = makeDistortionCurve(30);

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.04, startTime + duration * 0.1);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.98, startTime + duration);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(volume, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(wave);
    wave.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  // Helper: coin shimmer (short noise burst)
  function coinShimmer(startTime, volume = 0.12) {
    const bufferSize = ctx.sampleRate * 0.08;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data   = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 4000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.08);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(startTime);
    source.stop(startTime + 0.1);
  }

  // "Cha" — first strike
  ping(880,  now,        0.5, 0.3);
  ping(1320, now + 0.02, 0.4, 0.2);

  // "-ching" — second strike, higher pitch
  ping(1100, now + 0.13, 0.6, 0.4);
  ping(1650, now + 0.15, 0.5, 0.25);

  // Coin shimmer tail
  coinShimmer(now + 0.08, 0.15);
  coinShimmer(now + 0.18, 0.12);
  coinShimmer(now + 0.28, 0.08);

  // Warm low "drawer open" thud
  const thud = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(120, now + 0.12);
  thud.frequency.exponentialRampToValueAtTime(40, now + 0.22);
  thudGain.gain.setValueAtTime(0.25, now + 0.12);
  thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
  thud.connect(thudGain);
  thudGain.connect(ctx.destination);
  thud.start(now + 0.12);
  thud.stop(now + 0.3);
}

/**
 * playLoss() — Soft descending tone for a LOSS. Not harsh, just a subtle downer.
 */
export function playLoss() {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;

  function descTone(freq, startTime, duration, volume = 0.18) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, startTime + duration);
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
  }

  // Three-note descending "wah wah wah"
  descTone(440, now,        0.22, 0.2);
  descTone(370, now + 0.22, 0.22, 0.18);
  descTone(300, now + 0.44, 0.35, 0.15);
}

/**
 * playGrade() — Neutral soft ping for a PUSH or grade completion.
 */
export function playGrade() {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(660, now);
  osc.frequency.exponentialRampToValueAtTime(680, now + 0.05);
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.45);
}

/**
 * playTick() — Subtle scan progress tick (used in Trends loading bar).
 */
export function playTick() {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1800, now);
  gain.gain.setValueAtTime(0.04, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.05);
}

/**
 * playAnalysisReady() — Quick upward chime when an analysis report comes back.
 */
export function playAnalysisReady() {
  const ctx = getCtx();
  if (!ctx) return;

  const now = ctx.currentTime;
  [523, 659, 784].forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.1;
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.35);
  });
}

// Internal: create distortion curve for metallic effect
function makeDistortionCurve(amount) {
  const samples = 256;
  const curve   = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
