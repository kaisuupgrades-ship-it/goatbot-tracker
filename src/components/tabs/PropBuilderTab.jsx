'use client';
import { useState, useEffect, useCallback } from 'react';
import BetSlipModal from '@/components/BetSlipModal';

// ── Constants ──────────────────────────────────────────────────────────────────
const SPORT_TABS = [
  { key: 'nba',   label: 'NBA', emoji: '🏀' },
  { key: 'mlb',   label: 'MLB', emoji: '⚾' },
  { key: 'nhl',   label: 'NHL', emoji: '🏒' },
  { key: 'nfl',   label: 'NFL', emoji: '🏈' },
  { key: 'ncaab', label: 'NCAAB', emoji: '🏀' },
  { key: 'ncaaf', label: 'NCAAF', emoji: '🏈' },
];

function fmtOdds(n) {
  if (n == null) return null;
  return n > 0 ? `+${n}` : `${n}`;
}

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spinner({ text = 'Loading…' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.82rem', gap: '8px' }}>
      <span style={{ animation: 'prop-spin 0.8s linear infinite', display: 'inline-block', fontSize: '1.1rem' }}>⟳</span>
      {text}
      <style>{`@keyframes prop-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Over / Under tile ──────────────────────────────────────────────────────────
function PropTile({ direction, line, odds, onClick }) {
  const isOver    = direction === 'over';
  const fmt       = fmtOdds(odds);
  const color     = isOver ? '#4ade80' : '#f87171';
  const border    = isOver ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)';
  const bgBase    = isOver ? 'rgba(74,222,128,0.07)' : 'rgba(248,113,113,0.06)';
  const bgHover   = isOver ? 'rgba(74,222,128,0.16)' : 'rgba(248,113,113,0.14)';
  const bHover    = isOver ? 'rgba(74,222,128,0.6)'  : 'rgba(248,113,113,0.5)';
  return (
    <button
      onClick={onClick}
      title={`${isOver ? 'Over' : 'Under'} ${line}${fmt ? ` ${fmt}` : ''}`}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '5px 10px', borderRadius: '7px', cursor: 'pointer',
        border: `1px solid ${border}`, background: bgBase, minWidth: '56px',
        transition: 'all 0.1s', fontFamily: 'IBM Plex Mono, monospace',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = bgHover; e.currentTarget.style.borderColor = bHover; }}
      onMouseLeave={e => { e.currentTarget.style.background = bgBase; e.currentTarget.style.borderColor = border; }}
    >
      <div style={{ fontSize: '0.52rem', fontWeight: 800, letterSpacing: '0.07em', color: `${color}b3`, marginBottom: '1px' }}>
        {isOver ? 'OVER' : 'UNDR'}
      </div>
      <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-primary)' }}>{line}</div>
      {fmt && (
        <div style={{ fontSize: '0.62rem', fontWeight: 700, color }}>{fmt}</div>
      )}
    </button>
  );
}

// ── Player row ─────────────────────────────────────────────────────────────────
function PlayerRow({ player, marketLabel, onPropClick }) {
  const hasOver  = player.overOdds  != null;
  const hasUnder = player.underOdds != null;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `1fr${hasOver ? ' auto' : ''}${hasUnder ? ' auto' : ''}`,
      alignItems: 'center', gap: '8px',
      padding: '7px 10px', borderRadius: '8px',
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      marginBottom: '4px',
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {player.player}
        </div>
        <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace' }}>
          {marketLabel} · {player.line}
        </div>
      </div>
      {hasOver  && <PropTile direction="over"  line={player.line} odds={player.overOdds}  onClick={() => onPropClick(player, marketLabel, 'over')} />}
      {hasUnder && <PropTile direction="under" line={player.line} odds={player.underOdds} onClick={() => onPropClick(player, marketLabel, 'under')} />}
    </div>
  );
}

// ── Category section ───────────────────────────────────────────────────────────
function CategorySection({ category, catIdx, onPropClick, shownPlayers, onShowMore }) {
  const [open, setOpen] = useState(true);
  if (!category.markets?.length) return null;
  return (
    <div style={{ marginBottom: '1.1rem' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
          padding: '2px 0', marginBottom: '6px',
        }}
      >
        <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'rgba(255,184,0,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {category.label}
        </span>
        <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', display: 'inline-block', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
      </button>

      {open && category.markets.map((market, mktIdx) => {
        const shownKey = `${catIdx}_${mktIdx}`;
        const shown    = shownPlayers[shownKey] || 5;
        const visible  = market.players.slice(0, shown);
        const remaining = market.players.length - shown;
        return (
          <div key={market.key} style={{ marginBottom: '10px' }}>
            {category.markets.length > 1 && (
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '5px', paddingLeft: '2px' }}>
                {market.label}
              </div>
            )}
            {visible.map(p => (
              <PlayerRow key={p.player} player={p} marketLabel={market.label} onPropClick={onPropClick} />
            ))}
            {remaining > 0 && (
              <button
                onClick={() => onShowMore(catIdx, mktIdx, market.players.length)}
                style={{
                  width: '100%', padding: '5px 0', marginTop: '2px', borderRadius: '6px',
                  border: '1px solid var(--border)', background: 'none',
                  color: 'var(--text-muted)', fontSize: '0.72rem', cursor: 'pointer',
                  fontFamily: 'inherit', transition: 'all 0.1s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,184,0,0.3)'; e.currentTarget.style.color = 'var(--gold)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                View {remaining} more {market.label} {remaining === 1 ? 'prop' : 'props'} ▼
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Game row (expandable) ──────────────────────────────────────────────────────
function GameRow({ event, sport, isExpanded, onToggle, onPropClick }) {
  const [propsData,    setPropsData]    = useState(null); // null = not fetched yet
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [shownPlayers, setShownPlayers] = useState({});   // `${catIdx}_${mktIdx}` → count

  const eventId    = event.odds_api_event_id || null;
  const comps      = event.competitions?.[0]?.competitors || [];
  const homeComp   = comps.find(c => c.homeAway === 'home') || comps[1] || {};
  const awayComp   = comps.find(c => c.homeAway === 'away') || comps[0] || {};
  const homeName   = homeComp.team?.displayName || homeComp.team?.name || 'Home';
  const awayName   = awayComp.team?.displayName || awayComp.team?.name || 'Away';
  const homeAbbr   = homeComp.team?.abbreviation || 'HME';
  const awayAbbr   = awayComp.team?.abbreviation || 'AWY';
  const homeLogo   = homeComp.team?.logo || null;
  const awayLogo   = awayComp.team?.logo || null;
  const gameState  = event.status?.type?.state; // 'pre' | 'in' | 'post'
  const gameTime   = event.date
    ? new Date(event.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : '';

  // Lazy-load props when first expanded
  useEffect(() => {
    if (!isExpanded || !eventId || propsData !== null) return;
    if (gameState === 'in' || gameState === 'post') {
      setError(gameState === 'in' ? 'Player props are only available before game time.' : 'Props are not available for completed games.');
      setPropsData({ categories: [] });
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`/api/props?sport=${sport}&eventId=${encodeURIComponent(eventId)}`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.categories?.length) {
          setPropsData(data);
        } else {
          setError(data.note || 'No props available for this game yet.');
          setPropsData({ categories: [] });
        }
      })
      .catch(e => {
        if (!cancelled) { setError(e.message || 'Failed to load props.'); setPropsData({ categories: [] }); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isExpanded, eventId, sport, propsData]);

  function handleShowMore(catIdx, mktIdx, total) {
    const key = `${catIdx}_${mktIdx}`;
    setShownPlayers(prev => ({ ...prev, [key]: Math.min((prev[key] || 5) + 10, total) }));
  }

  // Extract any available odds from the ESPN event so BetSlipModal can show ML buttons
  const rawOdds = event?.competitions?.[0]?.odds?.[0];
  let gameOdds = null;
  if (rawOdds) {
    let homeOdds = rawOdds.homeTeamOdds?.moneyLine ?? rawOdds.homeTeamOdds?.current?.moneyLine ?? null;
    let awayOdds = rawOdds.awayTeamOdds?.moneyLine ?? rawOdds.awayTeamOdds?.current?.moneyLine ?? null;
    if (homeOdds === 0) homeOdds = null;
    if (awayOdds === 0) awayOdds = null;
    gameOdds = {
      homeOdds, awayOdds,
      spread:          rawOdds.details || null,
      total:           rawOdds.overUnder ?? null,
      overOdds:        rawOdds.overOdds  ?? null,
      underOdds:       rawOdds.underOdds ?? null,
      homeSpreadOdds:  rawOdds.homeTeamOdds?.spreadLine ?? null,
      awaySpreadOdds:  rawOdds.awayTeamOdds?.spreadLine ?? null,
    };
  }
  // Build minimal game object BetSlipModal expects
  const game = {
    away: { team: { displayName: awayName, name: awayName, abbreviation: awayAbbr, logo: awayLogo } },
    home: { team: { displayName: homeName, name: homeName, abbreviation: homeAbbr, logo: homeLogo } },
    odds: gameOdds,
    date: event.date,
  };

  const isLive    = gameState === 'in';
  const isFinal   = gameState === 'post';
  const canExpand = !!eventId && !isLive && !isFinal;

  return (
    <div style={{
      border: `1px solid ${isExpanded ? 'rgba(255,184,0,0.22)' : 'var(--border)'}`,
      borderRadius: '10px', marginBottom: '8px', overflow: 'hidden',
      background: 'var(--bg-surface)', transition: 'border-color 0.15s',
    }}>
      {/* ── Header row ── */}
      <button
        onClick={canExpand ? onToggle : undefined}
        disabled={!canExpand}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
          padding: '0.75rem 1rem', cursor: canExpand ? 'pointer' : 'default',
          background: isExpanded ? 'rgba(255,184,0,0.04)' : 'transparent',
          border: 'none', fontFamily: 'inherit', textAlign: 'left',
          transition: 'background 0.15s',
        }}
      >
        {/* Teams */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {awayLogo && <img src={awayLogo} alt="" width={18} height={18} style={{ objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />}
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)' }}>{awayAbbr}</span>
          </div>
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>@</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
            {homeLogo && <img src={homeLogo} alt="" width={18} height={18} style={{ objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />}
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-secondary)' }}>{homeAbbr}</span>
          </div>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginLeft: '2px' }}>
            {awayName} @ {homeName}
          </span>
        </div>

        {/* Right: time / state badge / chevron */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {isLive && (
            <span style={{ fontSize: '0.58rem', fontWeight: 800, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', padding: '1px 6px', borderRadius: '4px' }}>LIVE</span>
          )}
          {isFinal && (
            <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>FINAL</span>
          )}
          {!isLive && !isFinal && gameTime && (
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{gameTime}</span>
          )}
          {!canExpand
            ? <span style={{ fontSize: '0.58rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>{isLive ? 'in progress' : isFinal ? 'final' : 'no props'}</span>
            : <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
          }
        </div>
      </button>

      {/* ── Props panel ── */}
      {isExpanded && canExpand && (
        <div style={{ padding: '0.75rem 1rem 1rem', borderTop: '1px solid var(--border)' }}>
          {loading && <Spinner text="Loading props…" />}

          {!loading && error && !propsData?.categories?.length && (
            <div style={{ padding: '1.25rem 0', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              🎲 {error}
            </div>
          )}

          {!loading && propsData?.categories?.map((cat, catIdx) => (
            <CategorySection
              key={cat.label}
              category={cat}
              catIdx={catIdx}
              onPropClick={(player, marketLabel, direction) =>
                onPropClick({ game, sport, player, marketLabel, direction })
              }
              shownPlayers={shownPlayers}
              onShowMore={handleShowMore}
            />
          ))}

          {!loading && propsData?.categories?.length === 0 && !error && (
            <div style={{ padding: '1.25rem 0', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              🎲 No props available for this game.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main PropBuilderTab ────────────────────────────────────────────────────────
export default function PropBuilderTab({ user, picks, setPicks, isDemo }) {
  const [activeSport,    setActiveSport]    = useState('nba');
  const [games,          setGames]          = useState([]);
  const [gamesLoading,   setGamesLoading]   = useState(false);
  const [gamesError,     setGamesError]     = useState('');
  const [expandedGameId, setExpandedGameId] = useState(null);
  const [betSlip,        setBetSlip]        = useState(null); // { game, sport, propPrefill }

  const loadGames = useCallback(async (sport) => {
    setGamesLoading(true);
    setGames([]);
    setGamesError('');
    setExpandedGameId(null);
    try {
      // Always pass today's date — without it, ESPN defaults to the most-recently-completed day
      // (e.g. yesterday's final games) when today's games haven't started yet, causing empty results.
      const today = new Date();
      const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
      const res  = await fetch(`/api/sports?sport=${sport}&endpoint=scoreboard&date=${dateStr}`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data = await res.json();
      // Show all of today's games — pre, live, and final
      const events = data.events || [];
      setGames(events);
    } catch (err) {
      console.error('[PropBuilder] loadGames error:', err);
      setGamesError(err.message || 'Failed to load games.');
    }
    setGamesLoading(false);
  }, []);

  useEffect(() => { loadGames(activeSport); }, [activeSport, loadGames]);

  function handlePropClick({ game, sport, player, marketLabel, direction }) {
    const odds = direction === 'over' ? player.overOdds : player.underOdds;
    setBetSlip({
      game,
      sport,
      propPrefill: {
        player:    player.player,
        stat:      marketLabel,
        line:      String(player.line),
        direction,
        odds:      odds != null ? String(odds) : '',
      },
    });
  }

  const currentTab = SPORT_TABS.find(t => t.key === activeSport);

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto' }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0, marginBottom: '4px' }}>
          🎯 Prop Builder
        </h2>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>
          Browse player props across today&apos;s games. Click any Over or Under tile to log a pick.
        </p>
      </div>

      {/* ── Sport tabs ── */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {SPORT_TABS.map(tab => {
          const active = activeSport === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveSport(tab.key)}
              style={{
                padding: '6px 14px', borderRadius: '8px', cursor: 'pointer',
                fontFamily: 'inherit', fontWeight: 700, fontSize: '0.82rem',
                border:      active ? '1px solid rgba(255,184,0,0.5)' : '1px solid var(--border)',
                background:  active ? 'rgba(255,184,0,0.1)' : 'var(--bg-elevated)',
                color:       active ? 'var(--gold)' : 'var(--text-secondary)',
                transition:  'all 0.12s',
              }}
            >
              {tab.emoji} {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Games list ── */}
      {gamesLoading && <Spinner text="Loading games…" />}

      {!gamesLoading && gamesError && (
        <div style={{
          padding: '1.5rem 2rem', textAlign: 'center',
          background: 'rgba(248,113,113,0.06)', borderRadius: '12px', border: '1px solid rgba(248,113,113,0.2)',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f87171' }}>Failed to load games</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>{gamesError}</div>
        </div>
      )}

      {!gamesLoading && !gamesError && games.length === 0 && (
        <div style={{
          padding: '3rem 2rem', textAlign: 'center',
          background: 'var(--bg-surface)', borderRadius: '12px', border: '1px solid var(--border)',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📅</div>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
            No games today for {currentTab?.emoji} {currentTab?.label}
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>
            Check back later or try a different sport.
          </div>
        </div>
      )}

      {!gamesLoading && games.map(event => (
        <GameRow
          key={event.id}
          event={event}
          sport={activeSport}
          isExpanded={expandedGameId === event.id}
          onToggle={() => setExpandedGameId(prev => prev === event.id ? null : event.id)}
          onPropClick={handlePropClick}
        />
      ))}

      {/* ── Bet Slip Modal (pre-filled with selected prop) ── */}
      {betSlip && (
        <BetSlipModal
          game={betSlip.game}
          sport={betSlip.sport}
          user={user}
          picks={picks}
          setPicks={setPicks}
          isDemo={isDemo}
          onClose={() => setBetSlip(null)}
          propPrefill={betSlip.propPrefill}
        />
      )}
    </div>
  );
}
