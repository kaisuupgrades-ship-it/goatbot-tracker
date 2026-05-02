/**
 * BetOSAILeanBadge — confidence-colored card showing the AI's pick + reasoning.
 *
 * Extracted from ScoreboardTab.jsx as part of the component split. Looks up
 * the matching analysis from gameLeans (keyed by sport_away_home), then
 * renders one of three states:
 *   1. Real pick: monospace pick text, confidence pill, edge pill
 *   2. Explicit pass (pick text starts with "pass"): muted styling
 *   3. No-pick analysis (pick null but analysis exists): "PASS — see analysis"
 *
 * The "Show full analysis" button reveals the full narrative dossier in a
 * scrollable pane. Critical for transparency — users see WHY the AI picked
 * (or declined) instead of just the bottom-line.
 */
'use client';
import { useState } from 'react';

export default function BetOSAILeanBadge({ sport, awayName, homeName, gameLeans }) {
  const [showFull, setShowFull] = useState(false);

  const leanKey = `${sport}_${awayName.toLowerCase()}_${homeName.toLowerCase()}`;
  const lean = gameLeans[leanKey]
    || Object.values(gameLeans).find(a =>
         a.sport === sport &&
         homeName.toLowerCase().includes(a.home_team.toLowerCase().split(' ').pop()) &&
         awayName.toLowerCase().includes(a.away_team.toLowerCase().split(' ').pop())
       );
  // Render the badge whenever we have ANY analysis or pick data — including
  // the "AI looked at this game and declined to pick" case (pick is null but
  // analysis text exists). That's important context for the user; hiding it
  // makes it look like the AI didn't analyze the game at all.
  if (!lean || (!lean.pick && !lean.analysis)) return null;

  const confColors = { ELITE: '#FFB800', HIGH: '#4ade80', MEDIUM: '#60a5fa', LOW: '#9ca3af' };
  const confColor = confColors[lean.conf] || '#9ca3af';
  // Three states:
  //   1. Explicit "Pass" pick (pick text starts with "pass")
  //   2. No-pick analysis (pick is null/empty, but analysis text exists — AI
  //      declined silently because data was insufficient)
  //   3. Real pick (everything else)
  const isExplicitPass   = !!lean.pick && /^pass\b/i.test(lean.pick.trim());
  const isNoPickAnalysis = !lean.pick && !!lean.analysis;
  const isPass = isExplicitPass || isNoPickAnalysis;
  const accent = isPass ? '#9ca3af' : confColor;
  const displayPick = lean.pick || 'PASS — AI declined to pick (see analysis)';

  const fullText = (lean.analysis || '').trim();

  return (
    <div style={{
      margin: '0.6rem 0 0.85rem',
      padding: '0.85rem 1rem 0.9rem 0.95rem',
      background: isPass
        ? 'rgba(156,163,175,0.04)'
        : `linear-gradient(180deg, ${accent}14 0%, ${accent}08 100%)`,
      borderLeft: `3px solid ${accent}`,
      borderTop: `1px solid ${accent}33`,
      borderRight: `1px solid ${accent}33`,
      borderBottom: `1px solid ${accent}33`,
      borderRadius: '8px',
      opacity: isPass ? 0.78 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.08em', color: accent, textTransform: 'uppercase' }}>
          🤖 BetOS AI Lean
        </span>
        {lean.conf && (
          <span style={{ fontSize: '0.6rem', fontWeight: 800, padding: '2px 7px', borderRadius: '4px', background: accent + '26', color: accent, border: `1px solid ${accent}55`, letterSpacing: '0.06em' }}>
            {lean.conf}
          </span>
        )}
        {lean.edge && (
          <span style={{ fontSize: '0.65rem', fontWeight: 700, color: accent, fontFamily: 'IBM Plex Mono, monospace', marginLeft: 'auto', padding: '2px 7px', borderRadius: '4px', background: accent + '14' }}>
            EDGE {lean.edge}
          </span>
        )}
      </div>

      <div style={{
        fontSize: '1.02rem',
        fontWeight: 700,
        letterSpacing: '-0.01em',
        color: 'var(--text-primary)',
        fontFamily: isPass ? 'inherit' : 'IBM Plex Mono, monospace',
        fontStyle: isPass ? 'italic' : 'normal',
        lineHeight: 1.3,
      }}>
        {displayPick}
      </div>

      {lean.edge_breakdown && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px', lineHeight: 1.55 }}>
          {lean.edge_breakdown}
        </div>
      )}

      {(lean.alternate_angles || lean.line_movement || lean.unit_sizing || lean.win_probability) && (
        <div style={{
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: `1px dashed ${accent}33`,
          display: 'flex', flexDirection: 'column', gap: '4px',
          fontSize: '0.68rem', color: 'var(--text-secondary)', lineHeight: 1.5,
        }}>
          {lean.alternate_angles && (
            <div><span style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.6rem', fontWeight: 700, marginRight: '6px' }}>Angles</span>{lean.alternate_angles}</div>
          )}
          {lean.line_movement && (
            <div><span style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.6rem', fontWeight: 700, marginRight: '6px' }}>Line</span>{lean.line_movement}</div>
          )}
          {lean.unit_sizing && (
            <div><span style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.6rem', fontWeight: 700, marginRight: '6px' }}>Stake</span>{lean.unit_sizing}</div>
          )}
          {lean.win_probability && (
            <div><span style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.6rem', fontWeight: 700, marginRight: '6px' }}>Win prob</span>{lean.win_probability}</div>
          )}
        </div>
      )}

      {fullText && fullText.length > 100 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); setShowFull(v => !v); }}
            style={{
              marginTop: '10px', background: 'transparent', border: 'none',
              color: accent, fontSize: '0.66rem', fontWeight: 700,
              letterSpacing: '0.05em', textTransform: 'uppercase',
              cursor: 'pointer', padding: 0,
            }}
          >
            {showFull ? '▲ Hide full analysis' : '▼ Show full analysis'}
          </button>
          {showFull && (
            <div style={{
              marginTop: '8px', padding: '10px 12px',
              background: 'rgba(0,0,0,0.18)', borderRadius: '6px',
              fontSize: '0.74rem', color: 'var(--text-secondary)',
              lineHeight: 1.65, whiteSpace: 'pre-wrap',
              maxHeight: '420px', overflowY: 'auto',
            }}>
              {fullText}
            </div>
          )}
        </>
      )}
    </div>
  );
}
