/**
 * /api/og/pick — Generate a shareable pick card image
 * Uses next/og (Satori) to render a styled PNG at the edge.
 *
 * Query params:
 *   pick     — "Cubs ML -115"
 *   conf     — ELITE | HIGH | MEDIUM | LOW
 *   edge     — numeric string e.g. "7.2"
 *   odds     — "-115" or "+130"
 *   winProb  — "54"
 *   sport    — "MLB"
 *   away     — "Chicago Cubs"
 *   home     — "Colorado Rockies"
 *   awayLogo — ESPN logo URL (optional)
 *   homeLogo — ESPN logo URL (optional)
 */
import { ImageResponse } from 'next/og';
export const runtime = 'edge';

const CONF_COLOR = { ELITE: '#00D48B', HIGH: '#4ade80', MEDIUM: '#FFB800', LOW: '#888888' };
const CONF_BG    = { ELITE: 'rgba(0,212,139,0.15)', HIGH: 'rgba(74,222,128,0.12)', MEDIUM: 'rgba(255,184,0,0.12)', LOW: 'rgba(136,136,136,0.1)' };

export async function GET(request) {
  const { searchParams } = new URL(request.url);

  const pick    = searchParams.get('pick')    || '';
  const conf    = searchParams.get('conf')    || '';
  const edge    = searchParams.get('edge')    || '';
  const odds    = searchParams.get('odds')    || '';
  const winProb = searchParams.get('winProb') || '';
  const sport   = searchParams.get('sport')   || '';
  const away    = searchParams.get('away')    || '';
  const home    = searchParams.get('home')    || '';
  const awayLogo = searchParams.get('awayLogo') || '';
  const homeLogo = searchParams.get('homeLogo') || '';

  const confColor = CONF_COLOR[conf] || '#FFB800';
  const confBg    = CONF_BG[conf]    || 'rgba(255,184,0,0.12)';
  const hasMatchup = !!(away && home);
  const oddsNum  = odds ? parseInt(odds) : 0;
  const oddsColor = oddsNum > 0 ? '#4ade80' : '#e8d8b0';
  const oddsStr  = odds ? (/^[+-]/.test(odds) ? odds : (oddsNum > 0 ? `+${odds}` : odds)) : '';

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex', flexDirection: 'column',
          width: '1200px', height: '628px',
          background: 'linear-gradient(135deg, #0e0b00 0%, #0a0a0a 60%, #080808 100%)',
          padding: '44px 52px',
          position: 'relative', overflow: 'hidden',
        }}
      >
        {/* Gold glow orb top-left */}
        <div style={{
          position: 'absolute', top: '-80px', left: '-60px',
          width: '400px', height: '400px',
          background: 'radial-gradient(circle, rgba(255,184,0,0.08) 0%, transparent 65%)',
          display: 'flex',
        }} />
        {/* Subtle grid lines */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(255,184,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,184,0,0.03) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
          display: 'flex',
        }} />

        {/* ── HEADER ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '28px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '14px',
              background: 'linear-gradient(135deg, rgba(255,184,0,0.25), rgba(255,120,0,0.1))',
              border: '1.5px solid rgba(255,184,0,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '26px',
            }}>[target]</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={{ color: '#FFB800', fontSize: '26px', fontWeight: 900, letterSpacing: '0.1em' }}>BetOS(tm)</span>
              <span style={{ color: '#444', fontSize: '11px', letterSpacing: '0.2em', fontWeight: 600 }}>AI PICK REPORT . BETOS.WIN</span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {sport && (
              <div style={{
                background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)',
                borderRadius: '8px', padding: '6px 16px',
                color: '#60a5fa', fontSize: '13px', fontWeight: 800, letterSpacing: '0.12em',
              }}>{sport.toUpperCase()}</div>
            )}
            {conf && (
              <div style={{
                background: confBg, border: `1.5px solid ${confColor}50`,
                borderRadius: '24px', padding: '8px 22px',
                color: confColor, fontSize: '14px', fontWeight: 900, letterSpacing: '0.14em',
              }}>{conf} CONFIDENCE</div>
            )}
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ display: 'flex', gap: '28px', flex: 1, position: 'relative' }}>

          {/* LEFT: Pick + Matchup */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '16px' }}>

            {/* Matchup logos */}
            {hasMatchup && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '20px',
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '14px', padding: '16px 24px',
              }}>
                {/* Away */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  {awayLogo ? (
                    <img src={awayLogo} width={52} height={52} style={{ objectFit: 'contain' }} />
                  ) : (
                    <div style={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px' }}>[arena]</div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    <span style={{ color: '#e0e0e0', fontSize: '17px', fontWeight: 800 }}>{away.split(' ').pop()}</span>
                    <span style={{ color: '#444', fontSize: '11px', letterSpacing: '0.1em' }}>AWAY</span>
                  </div>
                </div>

                <div style={{ color: '#252525', fontSize: '28px', fontWeight: 900, padding: '0 8px' }}>@</div>

                {/* Home */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, justifyContent: 'flex-end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
                    <span style={{ color: '#e0e0e0', fontSize: '17px', fontWeight: 800 }}>{home.split(' ').pop()}</span>
                    <span style={{ color: '#444', fontSize: '11px', letterSpacing: '0.1em' }}>HOME</span>
                  </div>
                  {homeLogo ? (
                    <img src={homeLogo} width={52} height={52} style={{ objectFit: 'contain' }} />
                  ) : (
                    <div style={{ width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px' }}>[arena]</div>
                  )}
                </div>
              </div>
            )}

            {/* THE PICK box */}
            {pick && (
              <div style={{
                display: 'flex', flexDirection: 'column',
                background: 'linear-gradient(135deg, rgba(255,184,0,0.1) 0%, rgba(255,149,0,0.04) 100%)',
                border: '1.5px solid rgba(255,184,0,0.35)',
                borderRadius: '14px', padding: '22px 26px',
                flex: 1,
              }}>
                <div style={{
                  color: '#FFB800', fontSize: '11px', fontWeight: 900,
                  letterSpacing: '0.22em', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <div style={{ width: '20px', height: '1.5px', background: '#FFB800', display: 'flex' }} />
                  THE PICK
                  <div style={{ width: '20px', height: '1.5px', background: '#FFB800', display: 'flex' }} />
                </div>
                <div style={{
                  color: '#ffffff', fontSize: pick.length > 40 ? '26px' : '32px',
                  fontWeight: 900, lineHeight: 1.25, flex: 1,
                  display: 'flex', alignItems: 'center',
                }}>{pick}</div>
                {oddsStr && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px' }}>
                    <span style={{ color: '#555', fontSize: '12px', letterSpacing: '0.1em' }}>LINE</span>
                    <span style={{
                      color: oddsColor, fontSize: '22px', fontWeight: 900,
                      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px', padding: '3px 16px',
                    }}>{oddsStr}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: Stats column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '200px' }}>

            {edge && (
              <div style={{
                display: 'flex', flexDirection: 'column',
                background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '14px', padding: '18px 20px', flex: 1,
              }}>
                <span style={{ color: '#444', fontSize: '10px', letterSpacing: '0.15em', fontWeight: 700, marginBottom: '8px' }}>EDGE SCORE</span>
                <span style={{ color: '#FFB800', fontSize: '42px', fontWeight: 900, lineHeight: 1 }}>{edge}</span>
                <span style={{ color: '#333', fontSize: '14px', fontWeight: 700, marginTop: '2px' }}>/10</span>
                {/* Bar */}
                <div style={{ display: 'flex', marginTop: '14px', height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px' }}>
                  <div style={{ width: `${Math.min(parseFloat(edge) * 10, 100)}%`, background: 'linear-gradient(90deg, #FFB80080, #FFB800)', borderRadius: '3px', display: 'flex' }} />
                </div>
              </div>
            )}

            {winProb && (
              <div style={{
                display: 'flex', flexDirection: 'column',
                background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '14px', padding: '18px 20px', flex: 1,
              }}>
                <span style={{ color: '#444', fontSize: '10px', letterSpacing: '0.15em', fontWeight: 700, marginBottom: '8px' }}>MKT IMPLIED</span>
                <span style={{ color: '#4ade80', fontSize: '42px', fontWeight: 900, lineHeight: 1 }}>{winProb}</span>
                <span style={{ color: '#333', fontSize: '14px', fontWeight: 700, marginTop: '2px' }}>%</span>
                {/* Bar */}
                <div style={{ display: 'flex', marginTop: '14px', height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px' }}>
                  <div style={{ width: `${Math.min(parseInt(winProb), 100)}%`, background: 'linear-gradient(90deg, #4ade8060, #4ade80)', borderRadius: '3px', display: 'flex' }} />
                </div>
              </div>
            )}

            {/* BetOS logo mark */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,184,0,0.06)', border: '1px solid rgba(255,184,0,0.15)',
              borderRadius: '12px', padding: '14px',
            }}>
              <span style={{ color: '#FFB800', fontSize: '13px', fontWeight: 900, letterSpacing: '0.15em' }}>BETOS.WIN</span>
            </div>
          </div>
        </div>

        {/* ── FOOTER strip ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginTop: '18px', paddingTop: '14px',
          borderTop: '1px solid rgba(255,184,0,0.08)',
          position: 'relative',
        }}>
          <span style={{ color: '#2a2a2a', fontSize: '12px', letterSpacing: '0.08em' }}>
            AI-Powered Sports Intelligence . For entertainment purposes only
          </span>
          <span style={{ color: '#333', fontSize: '12px', fontWeight: 700, letterSpacing: '0.1em' }}>
            Generated by BetOS(tm)
          </span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 628,
    }
  );
}
