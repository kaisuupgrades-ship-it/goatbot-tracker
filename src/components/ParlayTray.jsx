'use client';
import { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';

// ── Odds math ────────────────────────────────────────────────────────────────
function americanToDecimal(american) {
  const n = parseInt(american);
  if (isNaN(n) || n === 0) return 1;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}

function decimalToAmerican(decimal) {
  if (decimal <= 1) return -10000;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function calcParlayOdds(legs) {
  if (!legs || !legs.length) return 0;
  const decimal = legs.reduce((acc, leg) => acc * americanToDecimal(leg.odds), 1);
  return decimalToAmerican(decimal);
}

function fmtOdds(n) {
  if (n == null || isNaN(n)) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

function sportEmoji(sport) {
  const map = {
    mlb: '⚾', nfl: '🏈', nba: '🏀', nhl: '🏒',
    ncaaf: '🏈', ncaab: '🏀', mls: '⚽', wnba: '🏀',
    soccer: '⚽',
  };
  return map[(sport || '').toLowerCase()] || '🎯';
}

// ── ParlayTray ────────────────────────────────────────────────────────────────
// Renders into document.body via ReactDOM.createPortal.
// Fixed to the bottom of the screen, mobile-friendly bottom-sheet style.
// Props:
//   legs          — array of leg objects
//   onRemoveLeg   — (index) => void
//   onClear       — () => void
//   onSubmit      — (units) => void — receives units wager
//   submitting    — bool
//   submitError   — string | null
//   user          — user object (null if not logged in)
export default function ParlayTray({
  legs,
  onRemoveLeg,
  onClear,
  onSubmit,
  submitting,
  submitError,
  user,
}) {
  const [mounted, setMounted]     = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [units, setUnits]         = useState('1');
  const listRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  // Auto-expand tray when a new leg is added
  const prevLenRef = useRef(0);
  useEffect(() => {
    if (legs.length > prevLenRef.current) setCollapsed(false);
    prevLenRef.current = legs.length;
  }, [legs.length]);

  if (!mounted || legs.length === 0) return null;

  const combinedOdds = calcParlayOdds(legs);
  const isValid      = legs.length >= 2 && !!user;

  // Estimated payout: (decimal - 1) * units
  const unitsNum = parseFloat(units) || 1;
  const decOdds  = legs.reduce((acc, l) => acc * americanToDecimal(l.odds), 1);
  const estimatedWin = ((decOdds - 1) * unitsNum).toFixed(2);

  const tray = (
    <div
      role="region"
      aria-label="Parlay Builder"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9000,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: collapsed ? '52px' : 'min(70vh, 520px)',
        transition: 'max-height 0.25s cubic-bezier(0.4,0,0.2,1)',
        background: '#111118',
        borderTop: '2px solid rgba(168,85,247,0.55)',
        boxShadow: '0 -8px 32px rgba(0,0,0,0.55)',
        overflow: 'hidden',
        /* Avoid layout shift from html/body overflow-x:hidden */
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Header / collapse handle ───────────────────────────── */}
      <div
        onClick={() => setCollapsed(p => !p)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '0 1rem',
          height: '52px',
          flexShrink: 0,
          cursor: 'pointer',
          userSelect: 'none',
          background: 'rgba(168,85,247,0.07)',
          borderBottom: collapsed ? 'none' : '1px solid rgba(168,85,247,0.14)',
        }}
      >
        <span style={{ fontSize: '1rem', flexShrink: 0 }}>🎰</span>
        <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#c084fc', flexShrink: 0 }}>
          Parlay Builder
        </span>
        <span style={{
          background: 'rgba(168,85,247,0.18)',
          color: '#c084fc',
          borderRadius: '12px',
          padding: '1px 8px',
          fontSize: '0.72rem',
          fontWeight: 700,
          border: '1px solid rgba(168,85,247,0.3)',
          flexShrink: 0,
        }}>
          {legs.length} leg{legs.length !== 1 ? 's' : ''}
        </span>

        {/* Combined odds — always visible in header */}
        <span style={{
          marginLeft: 'auto',
          fontWeight: 800,
          fontSize: '0.9rem',
          color: '#c084fc',
          fontFamily: 'IBM Plex Mono, monospace',
          flexShrink: 0,
        }}>
          {fmtOdds(combinedOdds)}
        </span>

        <span style={{
          color: 'var(--text-muted, #666)',
          fontSize: '0.72rem',
          flexShrink: 0,
          marginLeft: '6px',
        }}>
          {collapsed ? '▲' : '▼'}
        </span>
      </div>

      {/* ── Legs list — scrollable ─────────────────────────────── */}
      {!collapsed && (
        <div
          ref={listRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0.5rem 1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {legs.map((leg, i) => (
            <div
              key={`${leg.game_id || i}-${leg.bet_type}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(168,85,247,0.14)',
                borderRadius: '8px',
                padding: '7px 10px',
              }}
            >
              <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>
                {sportEmoji(leg.sport)}
              </span>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  color: '#e2e8f0',
                  lineHeight: 1.2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {leg.team}
                  {leg.line != null
                    ? ` ${leg.line > 0 ? '+' : ''}${leg.line}`
                    : ''}
                </div>
                <div style={{
                  fontSize: '0.67rem',
                  color: '#718096',
                  marginTop: '1px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {leg.bet_type}
                  {leg.away_team && leg.home_team
                    ? ` · ${leg.away_team} @ ${leg.home_team}`
                    : ''}
                </div>
              </div>

              <span style={{
                fontWeight: 700,
                fontSize: '0.82rem',
                color: leg.odds > 0 ? '#4ade80' : '#94a3b8',
                flexShrink: 0,
                fontFamily: 'IBM Plex Mono, monospace',
                minWidth: '42px',
                textAlign: 'right',
              }}>
                {fmtOdds(leg.odds)}
              </span>

              <button
                onClick={e => { e.stopPropagation(); onRemoveLeg(i); }}
                title="Remove leg"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#718096',
                  fontSize: '1rem',
                  flexShrink: 0,
                  padding: '0 4px',
                  lineHeight: 1,
                  transition: 'color 0.12s',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; }}
                onMouseLeave={e => { e.currentTarget.style.color = '#718096'; }}
              >
                ×
              </button>
            </div>
          ))}

          {legs.length < 2 && (
            <div style={{
              textAlign: 'center',
              padding: '8px 0',
              fontSize: '0.72rem',
              color: '#718096',
            }}>
              Add {2 - legs.length} more leg{2 - legs.length !== 1 ? 's' : ''} to build a parlay
            </div>
          )}
        </div>
      )}

      {/* ── Footer: wager + payout + submit ──────────────────────── */}
      {!collapsed && (
        <div style={{
          padding: '0.65rem 1rem',
          borderTop: '1px solid rgba(168,85,247,0.14)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexShrink: 0,
          background: 'rgba(168,85,247,0.04)',
          flexWrap: 'wrap',
        }}>
          {/* Combined odds + estimated win */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0, flex: '0 0 auto' }}>
            <div style={{ fontSize: '0.62rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
              Combined Odds
            </div>
            <div style={{
              fontWeight: 800,
              fontSize: '1.05rem',
              color: '#c084fc',
              fontFamily: 'IBM Plex Mono, monospace',
              lineHeight: 1,
            }}>
              {fmtOdds(combinedOdds)}
            </div>
          </div>

          {/* Units input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flex: '0 0 auto' }}>
            <label style={{ fontSize: '0.68rem', color: '#718096', whiteSpace: 'nowrap' }}>Units:</label>
            <input
              type="number"
              min="0.1"
              step="0.5"
              value={units}
              onChange={e => setUnits(e.target.value)}
              style={{
                width: '54px',
                padding: '4px 7px',
                borderRadius: '6px',
                border: '1px solid rgba(168,85,247,0.3)',
                background: 'rgba(168,85,247,0.08)',
                color: '#c084fc',
                fontSize: '0.82rem',
                fontFamily: 'IBM Plex Mono, monospace',
                fontWeight: 700,
                outline: 'none',
              }}
            />
          </div>

          {/* Estimated win */}
          {isValid && (
            <div style={{ flex: '0 0 auto' }}>
              <div style={{ fontSize: '0.62rem', color: '#718096', textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>
                To Win
              </div>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#4ade80', fontFamily: 'IBM Plex Mono, monospace' }}>
                +{estimatedWin}u
              </div>
            </div>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Error */}
          {submitError && (
            <div style={{
              width: '100%',
              fontSize: '0.72rem',
              color: '#f87171',
              background: 'rgba(248,113,113,0.08)',
              border: '1px solid rgba(248,113,113,0.2)',
              borderRadius: '6px',
              padding: '4px 8px',
              marginBottom: '2px',
            }}>
              {submitError}
            </div>
          )}

          {/* Clear */}
          <button
            onClick={onClear}
            style={{
              padding: '7px 13px',
              borderRadius: '7px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent',
              color: '#718096',
              cursor: 'pointer',
              fontSize: '0.78rem',
              fontWeight: 600,
              fontFamily: 'inherit',
              transition: 'all 0.12s',
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = '#718096'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
          >
            Clear
          </button>

          {/* Submit */}
          <button
            onClick={() => onSubmit(parseFloat(units) || 1)}
            disabled={!isValid || submitting}
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              background: isValid && !submitting
                ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)'
                : 'rgba(168,85,247,0.25)',
              color: isValid && !submitting ? '#fff' : 'rgba(255,255,255,0.35)',
              border: 'none',
              cursor: isValid && !submitting ? 'pointer' : 'not-allowed',
              fontWeight: 700,
              fontSize: '0.84rem',
              fontFamily: 'inherit',
              transition: 'all 0.12s',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => {
              if (isValid && !submitting) e.currentTarget.style.background = 'linear-gradient(135deg, #b866ff 0%, #8b5cf6 100%)';
            }}
            onMouseLeave={e => {
              if (isValid && !submitting) e.currentTarget.style.background = 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)';
            }}
          >
            {submitting
              ? 'Submitting…'
              : !user
                ? 'Sign in to Submit'
                : legs.length < 2
                  ? `Need ${2 - legs.length} More Leg${2 - legs.length !== 1 ? 's' : ''}`
                  : `Submit ${legs.length}-Leg Parlay`}
          </button>
        </div>
      )}
    </div>
  );

  return ReactDOM.createPortal(tray, document.body);
}
