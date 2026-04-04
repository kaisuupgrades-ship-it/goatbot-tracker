'use client';
import { useState, useEffect } from 'react';

const STARRED_KEY = 'goatbot_starred_games';
const REPORTS_KEY = 'goatbot_reports';

// ── Report lookup — match by gameId OR by both team names appearing in the prompt ──
function findSavedReport(game) {
  try {
    const reports = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
    return reports.find(r => {
      if (r.gameId && r.gameId === game.id) return true;
      const p = (r.prompt || '').toLowerCase();
      const away = (game.awayName || game.awayAbbr || '').toLowerCase();
      const home = (game.homeName || game.homeAbbr || '').toLowerCase();
      if (!away || !home) return false;
      // Match if both team identifiers appear in the saved prompt
      const awayMatch = away.split(' ').some(w => w.length > 2 && p.includes(w));
      const homeMatch = home.split(' ').some(w => w.length > 2 && p.includes(w));
      return awayMatch && homeMatch;
    }) || null;
  } catch { return null; }
}

// Build ESPN CDN logo URL from sport + abbreviation
function espnLogo(sport, abbr) {
  if (!abbr || !sport) return null;
  return `https://a.espncdn.com/i/teamlogos/${sport}/500/${abbr.toLowerCase()}.png`;
}

function formatGameDate(dateStr) {
  if (!dateStr) return 'Upcoming';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  } catch { return dateStr; }
}

// Strip markdown from report text for preview
function cleanPreview(text, maxLen = 200) {
  if (!text) return '';
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]{1,120})\*/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// ── Empty state ────────────────────────────────────────────────────────────────
function EmptyStars() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '4rem 2rem', textAlign: 'center',
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: '12px',
    }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem', filter: 'grayscale(1)', opacity: 0.3 }}>★</div>
      <div style={{ fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>No featured games yet</div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: '280px', lineHeight: 1.6 }}>
        Head to <strong style={{ color: 'var(--gold)' }}>Scoreboard</strong> and tap ☆ on any game to pin it here for quick access.
      </div>
    </div>
  );
}

// ── Featured Card — mirrors Scoreboard GameCard style ─────────────────────────
function FeaturedCard({ game, onRemove, onAnalyze, savedReport }) {
  const [expanded, setExpanded]         = useState(false);
  const isLive  = game.state === 'live';
  const isFinal = game.state === 'final';

  const awayLogo = espnLogo(game.sport, game.awayAbbr);
  const homeLogo = espnLogo(game.sport, game.homeAbbr);

  const timeLabel = game.label ||
    (game.date ? formatGameDate(game.date) : 'Upcoming');

  const statusColor = isLive ? 'var(--green)' : isFinal ? '#888' : '#60a5fa';

  function handleAnalyze(e) {
    e?.stopPropagation();
    const prompt = `Run a full GOAT BOT analysis on ${game.awayName || game.awayAbbr} @ ${game.homeName || game.homeAbbr} (${timeLabel}). Give me the sharpest edge, line movement signals, and your best pick with confidence level.`;
    onAnalyze?.(prompt, savedReport || null);
  }

  // Mini parsed pick from saved report
  const reportPick = savedReport?.result
    ? (savedReport.result.match(/(?:^|\n)THE PICK\s*:\s*([^\n]{5,100})/im)?.[1]?.trim() ||
       savedReport.result.match(/(?:^|\n)(?:MY PICK|BEST PICK)\s*:\s*([^\n]{5,100})/im)?.[1]?.trim())
    : null;

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${expanded ? 'rgba(255,184,0,0.35)' : savedReport ? 'rgba(255,184,0,0.2)' : 'var(--border)'}`,
      borderRadius: '10px', overflow: 'hidden',
      transition: 'border-color 0.15s',
      boxShadow: savedReport ? '0 0 16px rgba(255,184,0,0.05)' : 'none',
    }}>

      {/* ── Main click area ── */}
      <div
        onClick={() => setExpanded(p => !p)}
        style={{ padding: '0.8rem 1rem', cursor: 'pointer', userSelect: 'none' }}
        onMouseEnter={e => { if (!expanded) e.currentTarget.parentElement.style.borderColor = 'rgba(255,184,0,0.25)'; }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.parentElement.style.borderColor = expanded ? 'rgba(255,184,0,0.35)' : savedReport ? 'rgba(255,184,0,0.2)' : 'var(--border)'; }}
      >
        {/* Status bar */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '0.65rem', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            {isLive && (
              <span style={{
                width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                background: '#4ade80', display: 'inline-block',
                boxShadow: '0 0 6px #4ade80', animation: 'live-pulse 2s infinite',
              }} />
            )}
            <span style={{ color: statusColor, fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
              {timeLabel}
            </span>
            <span style={{ color: 'var(--gold)', fontSize: '0.85rem' }}>★</span>
            {savedReport && (
              <span style={{
                fontSize: '0.6rem', fontWeight: 700, color: '#4ade80',
                background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)',
                borderRadius: '3px', padding: '1px 5px', letterSpacing: '0.04em',
              }}>
                🐐 REPORT
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* GOAT BOT button */}
            {onAnalyze && (
              <button
                onClick={handleAnalyze}
                style={{
                  background: savedReport ? 'rgba(74,222,128,0.08)' : 'rgba(255,184,0,0.08)',
                  border: `1px solid ${savedReport ? 'rgba(74,222,128,0.3)' : 'rgba(255,184,0,0.3)'}`,
                  borderRadius: '5px', cursor: 'pointer', padding: '2px 8px',
                  fontSize: '0.64rem', fontWeight: 800, lineHeight: 1.4, flexShrink: 0,
                  color: savedReport ? '#4ade80' : 'var(--gold)', fontFamily: 'inherit',
                  transition: 'all 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                title={savedReport ? 'View saved GOAT analysis' : 'Run GOAT BOT analysis'}
              >
                🐐 {savedReport ? 'View Report' : 'GOAT BOT'}
              </button>
            )}
            {/* Remove button */}
            <button
              onClick={e => { e.stopPropagation(); onRemove(game.id); }}
              title="Remove from Featured"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', fontSize: '0.75rem', padding: '2px 5px',
                borderRadius: '4px', transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--red-subtle)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Team rows — mirrors Scoreboard GameCard ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {[
            { abbr: game.awayAbbr, name: game.awayName, logo: awayLogo },
            { abbr: game.homeAbbr, name: game.homeName, logo: homeLogo },
          ].map(({ abbr, name, logo }) => (
            <div key={abbr || name} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {logo && (
                <img src={logo} alt="" width={20} height={20}
                  style={{ objectFit: 'contain', flexShrink: 0 }}
                  onError={e => { e.target.style.display = 'none'; }} />
              )}
              <span style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.88rem', flexShrink: 0 }}>
                {abbr || '—'}
              </span>
              {name && (
                <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {/* Show city portion of full team name */}
                  {name.split(' ').length > 1 ? name.split(' ').slice(0, -1).join(' ') : name}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Sport + date footer */}
        <div style={{ marginTop: '7px', color: 'var(--text-muted)', fontSize: '0.66rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {game.sport?.toUpperCase()}
          </span>
          {game.date && (
            <span>· {new Date(game.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          )}
          <span style={{ marginLeft: 'auto', color: expanded ? 'var(--gold)' : '#444', fontSize: '0.65rem' }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* ── Expandable GOAT report section ── */}
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border)',
          background: '#080808',
          padding: '0.85rem 1rem',
        }}>
          {savedReport ? (
            <>
              {/* Mini pick preview */}
              {reportPick && (
                <div style={{
                  background: 'rgba(255,184,0,0.07)', border: '1px solid rgba(255,184,0,0.2)',
                  borderRadius: '8px', padding: '0.7rem 0.85rem', marginBottom: '0.65rem',
                }}>
                  <div style={{ fontSize: '0.58rem', color: '#FFB800', fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '5px' }}>
                    🐐 The Pick
                  </div>
                  <div style={{ color: '#f0f0f0', fontWeight: 700, fontSize: '0.88rem', lineHeight: 1.4 }}>
                    {reportPick}
                  </div>
                </div>
              )}

              {/* Report preview text */}
              <div style={{ color: '#888', fontSize: '0.78rem', lineHeight: 1.6, marginBottom: '0.65rem' }}>
                {cleanPreview(savedReport.result, 180)}
                {(savedReport.result?.length || 0) > 180 && <span style={{ color: '#555' }}>…</span>}
              </div>

              {/* Timestamp + open full report */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.65rem', color: '#555' }}>
                  Ran {savedReport.timestamp ? new Date(savedReport.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'recently'}
                  {savedReport.runTime ? ` · ${savedReport.runTime}s` : ''}
                </span>
                <button
                  onClick={handleAnalyze}
                  style={{
                    marginLeft: 'auto',
                    padding: '5px 14px', borderRadius: '7px',
                    border: '1px solid rgba(255,184,0,0.4)', background: 'rgba(255,184,0,0.08)',
                    color: '#FFB800', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'inherit',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.18)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.08)'; }}
                >
                  🐐 View Full Report →
                </button>
              </div>
            </>
          ) : (
            /* No report yet — encourage running one */
            <div style={{ textAlign: 'center', padding: '1rem 0.5rem' }}>
              <div style={{ color: '#555', fontSize: '0.78rem', marginBottom: '0.75rem', lineHeight: 1.6 }}>
                No GOAT BOT report yet for this game.
              </div>
              <button
                onClick={handleAnalyze}
                style={{
                  padding: '8px 20px', borderRadius: '8px',
                  border: '1px solid rgba(255,184,0,0.4)', background: 'rgba(255,184,0,0.08)',
                  color: '#FFB800', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: '6px', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.18)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.08)'; }}
              >
                🐐 Run GOAT BOT Analysis
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FeaturedGamesTab({ onAnalyze }) {
  const [games,   setGames]   = useState({});
  const [reports, setReports] = useState([]);

  // Load starred games + saved reports; poll every 2s to catch cross-tab changes
  useEffect(() => {
    function load() {
      try { setGames(JSON.parse(localStorage.getItem(STARRED_KEY) || '{}')); } catch {}
      try { setReports(JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]')); } catch {}
    }
    load();
    const interval = setInterval(load, 2000);
    return () => clearInterval(interval);
  }, []);

  function removeGame(id) {
    setGames(prev => {
      const next = { ...prev };
      delete next[id];
      try { localStorage.setItem(STARRED_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const list = Object.values(games);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: '1.4rem', color: 'var(--gold)', letterSpacing: '-0.02em', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            ★ Featured Games
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '4px 0 0' }}>
            Games you've starred — quick GOAT BOT access
          </p>
        </div>
        {list.length > 0 && (
          <button
            onClick={() => { setGames({}); try { localStorage.removeItem(STARRED_KEY); } catch {} }}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
              color: 'var(--text-muted)', padding: '5px 10px', cursor: 'pointer', fontSize: '0.75rem',
            }}
          >
            Clear all
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <EmptyStars />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
          {list.map(game => (
            <FeaturedCard
              key={game.id}
              game={game}
              onRemove={removeGame}
              onAnalyze={onAnalyze}
              savedReport={findSavedReport(game)}
            />
          ))}
        </div>
      )}

      {/* Tip */}
      <div style={{
        padding: '0.85rem 1rem', background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: '8px',
        fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Tip:</strong> Star games on the Scoreboard to pin them here. Run a GOAT BOT report once and it stays linked — the report will appear whenever you come back to this game.
      </div>
    </div>
  );
}
