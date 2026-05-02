/**
 * WeatherWidget — game-time forecast / actual-conditions card.
 *
 * Extracted from ScoreboardTab.jsx as part of the component split. Pulls
 * weather data from the shared module-level cache (seeded by /api/sports
 * server enrichment AND by per-card prefetch on mount). Renders different
 * states for domes, retractable roofs, loading, error, and live data.
 */
'use client';
import { useState, useEffect } from 'react';
import { fetchWeather, weatherCacheLookup } from '@/lib/scoreboardCaches';

export default function WeatherWidget({ stadium, gameDate, sport }) {
  // Seed from the module-level cache so re-mounted cards (triggered by live
  // score refresh) don't flash "Loading game-time forecast…" for data we
  // already have.
  const cachedWx = weatherCacheLookup(stadium?.lat, stadium?.lon, gameDate);
  const [wx, setWx]           = useState(cachedWx);
  const [loading, setLoading] = useState(!cachedWx);

  useEffect(() => {
    if (!stadium?.lat) { setLoading(false); return; }
    let cancelled = false;
    fetchWeather({ lat: stadium.lat, lon: stadium.lon, gameDate })
      .then(d => {
        if (cancelled) return;
        setWx(d);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [stadium?.lat, stadium?.lon, gameDate]);

  if (stadium?.dome) {
    return (
      <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '1.4rem' }}>🏟️</span>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700 }}>{stadium.name}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>Domed stadium — weather not a factor</div>
        </div>
      </div>
    );
  }

  if (stadium?.retractable && !wx) {
    return (
      <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '1.4rem' }}>🏟️</span>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700 }}>{stadium.name}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>Retractable roof — check game-day status</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: '0.65rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
        Loading game-time forecast…
      </div>
    );
  }

  if (!wx) {
    // Log weather failure to admin notifications (fire-and-forget)
    try {
      fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'log_event', event: 'weather_unavailable', stadium: stadium?.name, gameDate }),
      }).catch(() => {});
    } catch {}
    return (
      <div style={{
        padding: '0.75rem 0.85rem', background: 'rgba(255,255,255,0.025)', borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: '10px',
      }}>
        <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>🌐</span>
        <div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700 }}>{stadium?.name || 'Outdoor Stadium'}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>
            Weather data temporarily unavailable — check back closer to game time
          </div>
        </div>
      </div>
    );
  }

  const isBad    = wx.code >= 61 || wx.precip_pct >= 50;
  const windHigh = wx.windspeed >= 15;
  const isCold   = wx.temp_f < 45;
  const isHot    = wx.temp_f > 92;

  // Wind arrow angle: wind blows FROM this compass direction
  // Arrow should point the direction wind is blowing TO (opposite of "from")
  const arrowDeg = (wx.winddir + 180) % 360;

  // Field orientation: if stadium has orientation, show wind relative to field
  const fieldAngle = stadium?.orientation ?? 0;
  const relAngle = ((arrowDeg - fieldAngle) + 360) % 360;
  let windContext = '';
  if (wx.windspeed >= 8) {
    if (relAngle < 30 || relAngle > 330)         windContext = '→ Blowing out to CF';
    else if (relAngle > 150 && relAngle < 210)   windContext = '← Blowing in from CF';
    else if (relAngle >= 30 && relAngle <= 150)  windContext = '↗ Cross wind (LF side)';
    else                                          windContext = '↖ Cross wind (RF side)';
  }

  const windColor   = windHigh ? '#fbbf24' : '#93c5fd';
  const tempColor   = isCold ? '#60a5fa' : isHot ? '#f87171' : 'var(--text-primary)';
  const precipColor = wx.precip_pct >= 40 ? '#f87171' : 'var(--text-primary)';

  return (
    <div style={{ background: 'rgba(255,255,255,0.025)', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '0.55rem 0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '0.95rem', lineHeight: 1 }}>{wx.emoji}</span>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
            {stadium?.name || 'Stadium'}
          </span>
          {stadium?.retractable && (
            <span style={{ fontSize: '0.56rem', color: '#60a5fa', background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: '3px', padding: '1px 5px', fontWeight: 700, letterSpacing: '0.04em' }}>
              RETRACTABLE
            </span>
          )}
        </div>
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {wx.historical ? '✓ Actual conditions' : 'Game-time forecast'}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '0.7rem 0.85rem', display: 'flex', gap: '12px', alignItems: 'center' }}>
        {/* Field SVG */}
        <div style={{ flexShrink: 0, position: 'relative', width: '92px', height: '92px' }}>
          <svg viewBox="0 0 100 100" width="92" height="92" style={{ display: 'block' }}>
            <defs>
              <radialGradient id="grassGrad" cx="50%" cy="80%" r="70%">
                <stop offset="0%"   stopColor="rgba(34,197,94,0.18)" />
                <stop offset="100%" stopColor="rgba(22,163,74,0.06)" />
              </radialGradient>
              <radialGradient id="infieldGrad" cx="50%" cy="50%" r="60%">
                <stop offset="0%"   stopColor="rgba(217,119,6,0.22)" />
                <stop offset="100%" stopColor="rgba(180,83,9,0.08)"  />
              </radialGradient>
            </defs>

            {sport === 'mlb' ? (<>
              <path d="M 50 82 L 8 82 A 59 59 0 0 1 92 82 Z" fill="url(#grassGrad)" stroke="rgba(74,222,128,0.3)" strokeWidth="1" />
              <path d="M 50 82 L 11 82 A 56 56 0 0 1 89 82 Z" fill="none" stroke="rgba(180,120,60,0.35)" strokeWidth="4" />
              <line x1="50" y1="82" x2="10" y2="22" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" />
              <line x1="50" y1="82" x2="90" y2="22" stroke="rgba(255,255,255,0.2)" strokeWidth="1.2" />
              <circle cx="50" cy="62" r="18" fill="rgba(34,197,94,0.1)" />
              <polygon points="50,44 68,62 50,80 32,62" fill="url(#infieldGrad)" stroke="rgba(200,160,80,0.4)" strokeWidth="1" />
              <polygon points="50,44 68,62 50,80 32,62" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
              <circle cx="50" cy="62" r="3.5" fill="rgba(200,150,80,0.5)" stroke="rgba(220,180,100,0.5)" strokeWidth="1" />
              {[[50,41],[66,62],[50,80],[34,62]].map(([x,y], i) =>
                i === 3
                  ? <polygon key={i} points={`${x},${y-3.5} ${x+3},${y-1} ${x+3},${y+2.5} ${x-3},${y+2.5} ${x-3},${y-1}`}
                      fill="rgba(255,248,220,0.9)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" />
                  : <rect key={i} x={x-2.5} y={y-2.5} width="5" height="5" rx="0.8"
                      fill="rgba(255,248,220,0.85)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.5" />
              )}
            </>) : (<>
              <rect x="10" y="22" width="80" height="56" rx="4" fill="rgba(34,197,94,0.1)" stroke="rgba(74,222,128,0.3)" strokeWidth="1.2" />
              {[20,30,40,50,60,70,80].map(pct => {
                const xPos = 10 + (pct/100)*80;
                return <line key={pct} x1={xPos} y1="22" x2={xPos} y2="78"
                  stroke={pct === 50 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'} strokeWidth={pct===50?1.2:0.7} />;
              })}
              <rect x="10" y="22" width="10" height="56" rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
              <rect x="80" y="22" width="10" height="56" rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.15)" strokeWidth="0.8" />
            </>)}
          </svg>

          {wx.windspeed > 2 ? (() => {
            const arrowLen = Math.min(18 + wx.windspeed * 0.8, 32);
            const opacity  = Math.min(0.6 + wx.windspeed / 40, 1);
            return (
              <svg viewBox="-14 -22 28 44" width="28" height="44"
                style={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: `translate(-50%, -50%) rotate(${arrowDeg}deg)`,
                  transition: 'transform 1.2s ease', pointerEvents: 'none', overflow: 'visible',
                  filter: windHigh ? 'drop-shadow(0 0 6px rgba(251,191,36,0.8))' : 'drop-shadow(0 0 3px rgba(147,197,253,0.5))',
                }}
              >
                <line x1="0" y1="20" x2="0" y2={-arrowLen + 14}
                  stroke={windHigh ? `rgba(251,191,36,${opacity})` : `rgba(147,197,253,${opacity})`}
                  strokeWidth="2.8" strokeLinecap="round" />
                <polygon
                  points={`0,${-arrowLen+4} -5.5,${-arrowLen+15} 5.5,${-arrowLen+15}`}
                  fill={windHigh ? `rgba(251,191,36,${opacity})` : `rgba(147,197,253,${opacity})`} />
              </svg>
            );
          })() : (
            <div style={{ position: 'absolute', bottom: '4px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.52rem', color: 'rgba(255,255,255,0.3)', fontWeight: 800, letterSpacing: '0.08em' }}>CALM</div>
          )}
        </div>

        {/* Stats */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {[
              { label: 'TEMP',   val: `${wx.temp_f}°F`, color: tempColor,   alert: isCold || isHot },
              { label: 'PRECIP', val: `${wx.precip_pct}%`, color: precipColor, alert: wx.precip_pct >= 40 },
            ].map(({ label, val, color, alert }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '5px 8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: '0.54rem', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '2px' }}>{label}</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace', color, lineHeight: 1 }}>
                  {alert && <span style={{ fontSize: '0.6rem', marginRight: '2px' }}>⚠</span>}{val}
                </div>
              </div>
            ))}
          </div>

          <div style={{
            background: windHigh ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${windHigh ? 'rgba(251,191,36,0.2)' : 'rgba(255,255,255,0.05)'}`,
            borderRadius: '6px', padding: '5px 8px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div>
              <div style={{ fontSize: '0.54rem', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '2px' }}>WIND</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '5px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace', color: windColor, lineHeight: 1 }}>
                  {windHigh && <span style={{ fontSize: '0.6rem', marginRight: '2px' }}>⚠</span>}
                  {wx.windspeed > 0 ? `${wx.windspeed} mph` : 'Calm'}
                </span>
                {wx.windspeed > 0 && (
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: windColor, opacity: 0.8 }}>{wx.compass}</span>
                )}
              </div>
            </div>
            {windContext && (
              <div style={{ fontSize: '0.62rem', color: windHigh ? '#fbbf24' : '#93c5fd', textAlign: 'right', lineHeight: 1.4, maxWidth: '90px' }}>
                {windContext.replace(/^[↗←→↖]\s*/, '')}
                {windHigh && sport === 'mlb' && <div style={{ color: 'var(--text-muted)', fontSize: '0.58rem' }}>affects fly balls</div>}
              </div>
            )}
          </div>

          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.54rem', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>HUMIDITY</span>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-secondary)' }}>{wx.humidity}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
