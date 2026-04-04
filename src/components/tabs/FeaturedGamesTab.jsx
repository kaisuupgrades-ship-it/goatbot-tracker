'use client';
import { useState, useEffect } from 'react';
import { useStarredGames } from './ScoreboardTab';

const STARRED_KEY  = 'goatbot_starred_games';
const REPORTS_KEY  = 'goatbot_reports';

function findSavedReport(gameId) {
  try {
    const reports = JSON.parse(localStorage.getItem(REPORTS_KEY) || '[]');
    return reports.find(r => r.gameId === gameId) || null;
  } catch { return null; }
}

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

function FeaturedCard({ game, onRemove, onAnalyze }) {
  const isLive   = game.state === 'live';
  const isFinal  = game.state === 'final';
  const [hasSaved, setHasSaved] = useState(false);

  useEffect(() => {
    setHasSaved(!!findSavedReport(game.id));
  }, [game.id]);

  function handleAnalyze() {
    const prompt = `Run a full GOAT BOT analysis on ${game.awayName || game.awayAbbr} @ ${game.homeName || game.homeAbbr} (${game.label || 'upcoming'}). Give me the sharpest edge, line movement signals, and your best pick with confidence level.`;
    // Check for a cached report for this game
    const saved = findSavedReport(game.id);
    if (saved) {
      onAnalyze?.(prompt, saved);  // pass both prompt + saved report
    } else {
      onAnalyze?.(prompt, null);
    }
  }

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid rgba(255,184,0,0.2)',
      borderRadius: '12px', overflow: 'hidden',
      boxShadow: '0 0 20px rgba(255,184,0,0.04)',
    }}>
      {/* Gold top accent */}
      <div style={{ height: '2px', background: 'linear-gradient(90deg, #FFB800, #FF9500 60%, transparent)' }} />

      <div style={{ padding: '0.9rem 1rem' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isLive && <span className="live-dot" style={{ width: '7px', height: '7px' }} />}
            <span style={{
              fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: isLive ? 'var(--green)' : isFinal ? 'var(--text-muted)' : 'var(--blue)',
            }}>
              {game.label || (game.state === 'pre' ? formatGameDate(game.date) : game.state)}
            </span>
            <span style={{ color: 'var(--gold)', fontSize: '0.85rem' }}>★</span>
          </div>
          <button
            onClick={() => onRemove(game.id)}
            title="Remove from Featured"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: '0.75rem', padding: '2px 6px',
              borderRadius: '4px', transition: 'all 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--red-subtle)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'none'; }}
          >
            ✕
          </button>
        </div>

        {/* Matchup */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', padding: '0.75rem 0', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)', marginBottom: '0.75rem' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1.1rem', fontFamily: 'IBM Plex Mono, monospace' }}>
              {game.awayAbbr || 'Away'}
            </div>
            {game.awayName && <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '1px' }}>{game.awayName}</div>}
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600 }}>@</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1.1rem', fontFamily: 'IBM Plex Mono, monospace' }}>
              {game.homeAbbr || 'Home'}
            </div>
            {game.homeName && <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '1px' }}>{game.homeName}</div>}
          </div>
        </div>

        {/* Date */}
        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '0.75rem', textAlign: 'center' }}>
          {game.sport?.toUpperCase()} · {game.date ? new Date(game.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—'}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '8px' }}>
          {onAnalyze && (
            <button
              onClick={handleAnalyze}
              style={{
                flex: 1, padding: '7px', borderRadius: '8px',
                border: hasSaved ? '1px solid rgba(74,222,128,0.4)' : '1px solid rgba(255,184,0,0.4)',
                background: hasSaved ? 'rgba(74,222,128,0.08)' : 'rgba(255,184,0,0.08)',
                color: hasSaved ? '#4ade80' : 'var(--gold)',
                fontSize: '0.77rem', fontWeight: 700,
                cursor: 'pointer', transition: 'all 0.12s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.8'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = ''; }}
              title={hasSaved ? 'Load saved GOAT analysis' : 'Run new GOAT BOT analysis'}
            >
              🐐 {hasSaved ? 'View Report' : 'GOAT BOT'}
              {hasSaved && <span style={{ fontSize: '0.62rem', opacity: 0.8 }}>✓ saved</span>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function formatGameDate(dateStr) {
  if (!dateStr) return 'Upcoming';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return dateStr; }
}

export default function FeaturedGamesTab({ onAnalyze }) {
  const [games, setGames] = useState({});

  // Load on mount + listen for changes from ScoreboardTab (via localStorage)
  useEffect(() => {
    function load() {
      try { setGames(JSON.parse(localStorage.getItem(STARRED_KEY) || '{}')); } catch {}
    }
    load();
    // Poll every 2s for changes made in Scoreboard tab
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
            onClick={() => {
              setGames({});
              try { localStorage.removeItem(STARRED_KEY); } catch {}
            }}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          {list.map(game => (
            <FeaturedCard
              key={game.id}
              game={game}
              onRemove={removeGame}
              onAnalyze={onAnalyze}
            />
          ))}
        </div>
      )}

      {/* Tip */}
      <div style={{ padding: '0.85rem 1rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Tip:</strong> Star games on the Scoreboard tab to pin them here. Click 🐐 GOAT BOT on any featured game to instantly launch a full analysis in the Analyzer tab.
      </div>
    </div>
  );
}
