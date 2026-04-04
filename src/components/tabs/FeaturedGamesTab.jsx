'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { GameCard, sortAllSportsEvents, useStarredGames } from './ScoreboardTab';

// ── helpers ───────────────────────────────────────────────────────────────────
function toLocalDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

const SPORT_LABELS = {
  mlb:   { label: 'MLB',   emoji: '⚾' },
  nfl:   { label: 'NFL',   emoji: '🏈' },
  nba:   { label: 'NBA',   emoji: '🏀' },
  nhl:   { label: 'NHL',   emoji: '🏒' },
  ncaaf: { label: 'NCAAF', emoji: '🏈' },
  ncaab: { label: 'NCAAB', emoji: '🏀' },
  mls:   { label: 'MLS',   emoji: '⚽' },
  wnba:  { label: 'WNBA',  emoji: '🏀' },
};

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
      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', maxWidth: '300px', lineHeight: 1.6 }}>
        Head to the <strong style={{ color: 'var(--gold)' }}>Scoreboard</strong> and tap ☆ on any game to pin it here. You'll get a live view of just those games.
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function FeaturedGamesTab({ onAnalyze, user, picks, setPicks, isDemo }) {
  const { starred, toggleStar } = useStarredGames();

  // Live ESPN data: { [sport]: event[] }
  const [liveData,    setLiveData]    = useState({});
  const [loading,     setLoading]     = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [countdown,   setCountdown]   = useState(null);

  // Injuries (same as Scoreboard — fetched on demand)
  const [injuries,        setInjuries]        = useState({});
  const [injuriesChecked, setInjuriesChecked] = useState(null);

  const refreshTimerRef = useRef(null);
  const countdownRef    = useRef(null);

  const starredList = Object.values(starred);

  // Which sports do our starred games span?
  const starredSports = [...new Set(starredList.map(g => g.sport).filter(Boolean))];

  // ── Fetch live ESPN data for all relevant sports ───────────────────────────
  const fetchAll = useCallback(async () => {
    if (starredSports.length === 0) return;
    setLoading(true);
    const espnDate = toLocalDateStr(new Date());

    const results = await Promise.allSettled(
      starredSports.map(async (s) => {
        const res = await fetch(`/api/sports?sport=${s}&endpoint=scoreboard&date=${espnDate}`);
        const data = await res.json();
        return { sport: s, events: data.events || [] };
      })
    );

    const merged = {};
    results.forEach(r => {
      if (r.status === 'fulfilled') {
        merged[r.value.sport] = r.value.events;
      }
    });

    setLiveData(merged);
    setLastUpdated(new Date());
    setLoading(false);
  }, [starredSports.join(',')]); // eslint-disable-line

  // ── Auto-refresh: 20s if any live game, otherwise 45s ─────────────────────
  const allEvents = Object.values(liveData).flat();
  const hasLive   = allEvents.some(e => e?.status?.type?.state === 'in');
  const interval  = hasLive ? 20 : 45;

  useEffect(() => {
    fetchAll();
  }, [starredSports.join(',')]); // re-fetch when star list changes

  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    if (countdownRef.current)    clearInterval(countdownRef.current);

    refreshTimerRef.current = setInterval(fetchAll, interval * 1000);

    // Countdown display
    let secs = interval;
    setCountdown(secs);
    countdownRef.current = setInterval(() => {
      secs -= 1;
      if (secs <= 0) secs = interval;
      setCountdown(secs);
    }, 1000);

    return () => {
      clearInterval(refreshTimerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [fetchAll, interval]);

  // ── Build the filtered+sorted game list ───────────────────────────────────
  const starredIds = new Set(starredList.map(g => g.id));

  const featuredEvents = sortAllSportsEvents(
    Object.entries(liveData).flatMap(([sport, events]) =>
      events
        .filter(e => starredIds.has(e.id))
        .map(e => ({ ...e, _sport: sport }))
    )
  );

  // ── BetSlip modal state (mirrors Scoreboard) ───────────────────────────────
  const [betSlipGame, setBetSlipGame] = useState(null);

  // Dynamically import BetSlipModal so it's not a hard dependency
  const [BetSlipModal, setBetSlipModal] = useState(null);
  useEffect(() => {
    import('@/components/BetSlipModal').then(m => setBetSlipModal(() => m.default)).catch(() => {});
  }, []);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: '1.4rem', color: 'var(--gold)', letterSpacing: '-0.02em', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            ★ Featured Games
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '3px 0 0' }}>
            {starredList.length > 0
              ? `${starredList.length} starred game${starredList.length !== 1 ? 's' : ''} · live scores`
              : 'Star games from the Scoreboard to track them here'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Refresh indicator */}
          {starredList.length > 0 && (
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {hasLive
                ? <span style={{ color: '#4ade80' }}>● LIVE · refreshes in {countdown}s</span>
                : `↻ ${countdown}s`
              }
            </span>
          )}

          {/* Manual refresh */}
          {starredList.length > 0 && (
            <button
              onClick={fetchAll}
              disabled={loading}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
                color: 'var(--text-muted)', padding: '4px 9px', cursor: 'pointer',
                fontSize: '0.75rem', fontFamily: 'inherit', opacity: loading ? 0.5 : 1,
              }}
            >
              {loading ? '…' : '↻'}
            </button>
          )}

          {/* Clear all */}
          {starredList.length > 0 && (
            <button
              onClick={() => {
                starredList.forEach(g => toggleStar({ stopPropagation: () => {} }, g));
              }}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: '6px',
                color: 'var(--text-muted)', padding: '4px 9px', cursor: 'pointer', fontSize: '0.75rem',
              }}
            >
              Unstar all
            </button>
          )}
        </div>
      </div>

      {/* ── Content ── */}
      {starredList.length === 0 ? (
        <EmptyStars />
      ) : loading && featuredEvents.length === 0 ? (
        /* First-load skeleton */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {starredList.slice(0, 3).map((g, i) => (
            <div key={i} style={{
              height: '88px', borderRadius: '10px',
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          ))}
        </div>
      ) : featuredEvents.length === 0 ? (
        /* Starred but no ESPN data returned for today */
        <div style={{
          padding: '2rem', textAlign: 'center',
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📅</div>
          <div style={{ color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '4px' }}>
            No live data for your starred games today
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', lineHeight: 1.6 }}>
            Your {starredList.length} starred game{starredList.length !== 1 ? 's' : ''} may not be scheduled today, or ESPN hasn't posted lines yet. Head to the Scoreboard to re-star today's games.
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
            {starredList.map(g => (
              <span key={g.id} style={{
                fontSize: '0.72rem', padding: '3px 8px', borderRadius: '5px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                color: 'var(--text-muted)',
              }}>
                {SPORT_LABELS[g.sport]?.emoji} {g.awayAbbr} @ {g.homeAbbr}
              </span>
            ))}
          </div>
        </div>
      ) : (
        /* Live GameCards — identical to Scoreboard */
        <div className="game-cards-grid" style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '10px',
        }}>
          {featuredEvents.map(event => (
            <GameCard
              key={event.id}
              event={event}
              sport={event._sport}
              onAnalyze={(prompt) => onAnalyze?.(prompt)}
              onAddBet={(ev, sp) => setBetSlipGame({ event: ev, sport: sp })}
              starred={starred}
              onStar={toggleStar}
              injuries={injuries}
              injuriesChecked={injuriesChecked}
              isAllMode={starredSports.length > 1}
            />
          ))}
        </div>
      )}

      {/* Last updated */}
      {lastUpdated && featuredEvents.length > 0 && (
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'right' }}>
          Last updated {lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
        </div>
      )}

      {/* Tip */}
      <div style={{
        padding: '0.75rem 1rem', background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: '8px',
        fontSize: '0.74rem', color: 'var(--text-muted)', lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Tip:</strong> Tap ☆ on any Scoreboard game to pin it here. Your watchlist updates live — {hasLive ? 'every 20s (live game detected)' : 'every 45s'}.
      </div>

      {/* BetSlip modal */}
      {betSlipGame && BetSlipModal && (
        <BetSlipModal
          event={betSlipGame.event}
          sport={betSlipGame.sport}
          user={user}
          isDemo={isDemo}
          onClose={() => setBetSlipGame(null)}
          onSave={(pick) => {
            setPicks?.(prev => [pick, ...prev]);
            setBetSlipGame(null);
          }}
        />
      )}
    </div>
  );
}
