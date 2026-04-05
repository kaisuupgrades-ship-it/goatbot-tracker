'use client';
import { useState, useEffect, useCallback } from 'react';

// ── Mobile breakpoint hook ────────────────────────────────────────────────────
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    function check() { setIsMobile(window.innerWidth <= breakpoint); }
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [breakpoint]);
  return isMobile;
}

// ── League options ────────────────────────────────────────────────────────────
const LEAGUES = [
  { id: 'all',            label: 'All Soccer',    short: 'ALL', flag: '🌍' },
  { id: 'usa.1',          label: 'MLS',           short: 'MLS', flag: '🇺🇸' },
  { id: 'eng.1',          label: 'Premier League',short: 'EPL', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 'esp.1',          label: 'La Liga',       short: 'ESP', flag: '🇪🇸' },
  { id: 'ger.1',          label: 'Bundesliga',    short: 'GER', flag: '🇩🇪' },
  { id: 'ita.1',          label: 'Serie A',       short: 'ITA', flag: '🇮🇹' },
  { id: 'fra.1',          label: 'Ligue 1',       short: 'FRA', flag: '🇫🇷' },
  { id: 'uefa.champions', label: 'Champions Lg',  short: 'UCL', flag: '⭐' },
];

const LEAGUE_BY_ID = Object.fromEntries(LEAGUES.map(l => [l.id, l]));

// ── Odds helpers ──────────────────────────────────────────────────────────────
function fmtML(v) {
  const n = parseInt(v);
  if (isNaN(n)) return null;
  return n > 0 ? `+${n}` : `${n}`;
}

function getMatchOdds(comp) {
  const oddsArr = comp?.odds || [];
  if (!oddsArr.length) return null;
  const o = oddsArr[0];
  if (!o) return null; // ESPN occasionally returns [null] as the odds array
  const homeML = fmtML(o.homeTeamOdds?.moneyLine ?? o.homeTeamOdds?.current?.moneyLine);
  const awayML = fmtML(o.awayTeamOdds?.moneyLine ?? o.awayTeamOdds?.current?.moneyLine);
  const drawML = fmtML(o.drawOdds?.moneyLine ?? o.drawOdds?.current?.moneyLine);
  const ou     = o.overUnder != null ? parseFloat(o.overUnder).toFixed(1) : null;
  const overML  = fmtML(o.overOdds);
  const underML = fmtML(o.underOdds);
  return { homeML, awayML, drawML, ou, overML, underML, details: o.details };
}

// ── Single match card ─────────────────────────────────────────────────────────
function MatchCard({ match, leagueId }) {
  const [open, setOpen] = useState(false);
  const comp = match.competitions?.[0];
  if (!comp) return null;

  const competitors = comp.competitors || [];
  const away = competitors.find(c => c.homeAway === 'away') || competitors[0] || {};
  const home = competitors.find(c => c.homeAway === 'home') || competitors[1] || {};

  const status     = comp.status?.type;
  const isLive     = status?.state === 'in';
  const isFinal    = status?.state === 'post';
  const isPre      = status?.state === 'pre';
  const clockLabel = status?.shortDetail || (isLive ? 'LIVE' : isFinal ? 'FT' : '');

  const matchDate = comp.date ? new Date(comp.date) : null;
  const kickTime  = matchDate ? matchDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const kickDay   = matchDate ? matchDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  const awayScore = away.score != null ? String(away.score) : null;
  const homeScore = home.score != null ? String(home.score) : null;
  const awayWin   = isFinal && parseInt(awayScore) > parseInt(homeScore);
  const homeWin   = isFinal && parseInt(homeScore) > parseInt(awayScore);
  const isDraw    = isFinal && parseInt(awayScore) === parseInt(homeScore);

  const awayName = away.team?.displayName || away.team?.name || 'Away';
  const homeName = home.team?.displayName || home.team?.name || 'Home';
  const awayLogo = away.team?.logo;
  const homeLogo = home.team?.logo;
  const venue    = comp.venue?.fullName || '';
  const city     = comp.venue?.address?.city || '';

  // Live possession / shot stats from situation
  const situation = comp.situation || {};
  const possession = situation.possession; // 'away' | 'home'
  const awayShots  = away.statistics?.find(s => s.name === 'shotsOnTarget')?.displayValue;
  const homeShots  = home.statistics?.find(s => s.name === 'shotsOnTarget')?.displayValue;

  // Competition/matchday note
  const compNote = comp.notes?.[0]?.headline || match.season?.displayName || '';

  const odds       = getMatchOdds(comp);
  const leagueInfo = LEAGUE_BY_ID[leagueId];

  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: `1px solid ${isLive ? 'rgba(74,222,128,0.3)' : open ? 'rgba(96,165,250,0.2)' : 'var(--border)'}`,
      borderRadius: '8px',
      overflow: 'hidden',
      boxShadow: isLive ? '0 2px 10px rgba(74,222,128,0.07)' : 'none',
      transition: 'border-color 0.15s',
    }}>

      {/* ── Status bar ── */}
      <div style={{
        padding: '4px 10px',
        background: isLive ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.015)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          {isLive && (
            <span style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: '#4ade80', boxShadow: '0 0 4px #4ade80',
              display: 'inline-block', animation: 'live-pulse 1.5s ease-in-out infinite',
            }} />
          )}
          <span style={{
            fontSize: '0.65rem', fontWeight: 700,
            fontFamily: 'IBM Plex Mono, monospace',
            color: isLive ? '#4ade80' : isFinal ? '#94a3b8' : '#60a5fa',
          }}>
            {isLive ? clockLabel : isFinal ? 'FT' : isPre ? (kickDay || 'Upcoming') : clockLabel}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* League badge — only shown in All Soccer mode */}
          {leagueInfo && leagueInfo.id !== 'all' && leagueId !== match._leagueSingle && (
            <span style={{
              fontSize: '0.58rem', color: '#06d6a0', fontWeight: 700,
              background: 'rgba(6,214,160,0.08)', border: '1px solid rgba(6,214,160,0.2)',
              borderRadius: '4px', padding: '1px 5px',
            }}>
              {leagueInfo.flag} {leagueInfo.short}
            </span>
          )}
          {isPre && kickTime && (
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#60a5fa', fontFamily: 'IBM Plex Mono' }}>
              {kickTime}
            </span>
          )}
          {!isPre && city ? (
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              📍 {city}
            </span>
          ) : null}
        </div>
      </div>

      {/* ── Match rows — click to expand ── */}
      <div
        style={{ padding: '8px 10px', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(v => !v)}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.015)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        {[
          { name: awayName, logo: awayLogo, score: awayScore, won: awayWin },
          { name: homeName, logo: homeLogo, score: homeScore, won: homeWin },
        ].map((side, idx) => (
          <div key={idx} style={{
            display: 'grid',
            gridTemplateColumns: '22px 1fr auto',
            alignItems: 'center',
            gap: '8px',
            paddingTop: idx === 1 ? '6px' : 0,
            paddingBottom: idx === 0 ? '6px' : 0,
            borderTop: idx === 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
            opacity: isFinal && !side.won && !isDraw ? 0.5 : 1,
          }}>
            <div style={{ width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {side.logo ? (
                <img src={side.logo} alt="" style={{ width: '22px', height: '22px', objectFit: 'contain' }}
                  onError={e => { e.target.style.display = 'none'; }} />
              ) : (
                <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>⚽</span>
              )}
            </div>
            <div style={{
              fontSize: '0.85rem',
              fontWeight: side.won ? 700 : 500,
              color: side.won ? 'var(--text-primary)' : 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {side.name}
            </div>
            <div style={{
              fontFamily: 'IBM Plex Mono, monospace',
              fontWeight: 800, fontSize: '1rem', minWidth: '20px', textAlign: 'right',
              color: isLive ? '#4ade80' : side.won ? '#4ade80' : isDraw ? '#FFB800' : (isFinal ? 'var(--text-secondary)' : 'var(--text-muted)'),
            }}>
              {(isLive || isFinal) && side.score != null ? side.score : '—'}
            </div>
          </div>
        ))}

        {/* Upcoming kickoff pill */}
        {isPre && (kickDay || kickTime) && (
          <div style={{ marginTop: '6px', textAlign: 'center' }}>
            <span style={{
              fontSize: '0.72rem', color: '#60a5fa', fontWeight: 600,
              background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.18)',
              borderRadius: '20px', padding: '2px 10px', display: 'inline-block',
            }}>
              {kickDay}{kickTime ? ` · ${kickTime}` : ''}
            </span>
          </div>
        )}

        {/* Expand chevron */}
        <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {odds && !open ? (
            /* Odds teaser when collapsed */
            <div style={{ display: 'flex', gap: '8px', fontSize: '0.68rem', fontFamily: 'IBM Plex Mono', color: 'var(--text-muted)' }}>
              {odds.awayML && <span>{away.team?.abbreviation} {odds.awayML}</span>}
              {odds.drawML && <span>D {odds.drawML}</span>}
              {odds.homeML && <span>{home.team?.abbreviation} {odds.homeML}</span>}
            </div>
          ) : <span />}
          <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', display: 'inline-block', transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>▼</span>
        </div>
      </div>

      {/* ── Expanded detail panel ── */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', background: 'rgba(255,255,255,0.012)' }}>

          {/* Venue */}
          {venue && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              📍 {venue}{city ? `, ${city}` : ''}
            </div>
          )}

          {/* Competition name / matchday */}
          {compNote && (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
              🏆 {compNote}
            </div>
          )}

          {/* Odds block */}
          {odds && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: '5px' }}>Match Odds</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {odds.awayML && (
                  <OddsChip label={away.team?.abbreviation || 'Away'} value={odds.awayML} />
                )}
                {odds.drawML && (
                  <OddsChip label="Draw" value={odds.drawML} />
                )}
                {odds.homeML && (
                  <OddsChip label={home.team?.abbreviation || 'Home'} value={odds.homeML} />
                )}
                {odds.ou && (
                  <OddsChip label={`O/U ${odds.ou}`} value={odds.overML && odds.underML ? `o${odds.overML} / u${odds.underML}` : null} neutral />
                )}
                {!odds.awayML && !odds.homeML && !odds.drawML && odds.details && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>{odds.details}</span>
                )}
              </div>
            </div>
          )}

          {/* Live: shots on target */}
          {isLive && (awayShots != null || homeShots != null) && (
            <div style={{ marginTop: '6px' }}>
              <div style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: '4px' }}>Shots on Target</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', fontFamily: 'IBM Plex Mono', fontWeight: 700 }}>
                <span style={{ color: 'var(--text-primary)', minWidth: '24px', textAlign: 'right' }}>{awayShots ?? '—'}</span>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>SOT</span>
                <span style={{ color: 'var(--text-primary)', minWidth: '24px' }}>{homeShots ?? '—'}</span>
              </div>
            </div>
          )}

          {/* Possession indicator */}
          {isLive && possession && (
            <div style={{ marginTop: '5px', fontSize: '0.65rem', color: '#4ade80' }}>
              ⚽ {possession === 'away' ? awayName : homeName} in possession
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Reusable odds chip ────────────────────────────────────────────────────────
function OddsChip({ label, value, neutral }) {
  const isPos = !neutral && value && parseInt(value) > 0;
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      background: 'rgba(255,255,255,0.04)', borderRadius: '6px',
      padding: '4px 10px', minWidth: '52px',
    }}>
      <span style={{ fontSize: '0.57rem', color: 'var(--text-muted)', marginBottom: '2px', whiteSpace: 'nowrap' }}>{label}</span>
      {value && (
        <span style={{
          fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.82rem',
          color: neutral ? 'var(--text-primary)' : isPos ? '#4ade80' : 'var(--text-primary)',
          whiteSpace: 'nowrap',
        }}>{value}</span>
      )}
    </div>
  );
}

// ── League section header (All Soccer view) ───────────────────────────────────
function LeagueHeader({ leagueInfo, count }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '8px 2px 5px',
      borderBottom: '1px solid rgba(6,214,160,0.15)',
      marginBottom: '7px', marginTop: '4px',
    }}>
      <span style={{ fontSize: '1rem' }}>{leagueInfo.flag}</span>
      <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#06d6a0' }}>{leagueInfo.label}</span>
      <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{count} match{count !== 1 ? 'es' : ''}</span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SoccerScoreboard() {
  const [league, setLeague]   = useState('all');
  const [data, setData]       = useState(null);
  const [allData, setAllData] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [filter, setFilter]   = useState('all');
  const isMobile              = useIsMobile();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (league === 'all') {
        const realLeagues = LEAGUES.filter(l => l.id !== 'all');
        const results = await Promise.allSettled(
          realLeagues.map(async (l) => {
            const res  = await fetch(`/api/sports?sport=soccer&league=${l.id}`);
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            return { id: l.id, events: json.events || [] };
          })
        );
        const combined = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') combined[realLeagues[i].id] = r.value.events;
        });
        setAllData(combined);
        setData(null);
      } else {
        const res  = await fetch(`/api/sports?sport=soccer&league=${league}`);
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        setData(json);
        setAllData({});
      }
    } catch (e) {
      setError(e.message || 'Failed to load soccer data');
    } finally {
      setLoading(false);
    }
  }, [league]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 45 * 1000);
    return () => clearInterval(t);
  }, [load]);

  // ── Single league filtering/sorting ──────────────────────────────────────
  const allMatches = data?.events || [];

  function applyFilter(events) {
    return events.filter(m => {
      const state = m.competitions?.[0]?.status?.type?.state;
      if (filter === 'live')     return state === 'in';
      if (filter === 'final')    return state === 'post';
      if (filter === 'upcoming') return state === 'pre';
      return true;
    }).sort((a, b) => {
      const order = { in: 0, pre: 1, post: 2 };
      const sa = order[a.competitions?.[0]?.status?.type?.state] ?? 1;
      const sb = order[b.competitions?.[0]?.status?.type?.state] ?? 1;
      if (sa !== sb) return sa - sb;
      return new Date(a.date || 0) - new Date(b.date || 0);
    });
  }

  const sorted = applyFilter(allMatches);

  // ── All Soccer sections ───────────────────────────────────────────────────
  const allSections = LEAGUES
    .filter(l => l.id !== 'all')
    .map(l => ({ league: l, matches: applyFilter(allData[l.id] || []) }))
    .filter(s => s.matches.length > 0);

  const totalLiveAll = Object.values(allData).flat()
    .filter(m => m.competitions?.[0]?.status?.type?.state === 'in').length;
  const liveCount = league === 'all' ? totalLiveAll
    : allMatches.filter(m => m.competitions?.[0]?.status?.type?.state === 'in').length;

  const hasData    = league === 'all' ? Object.keys(allData).length > 0 : !!data;
  const isEmpty    = hasData && (league === 'all' ? allSections.length === 0 : sorted.length === 0);
  const currentLg  = LEAGUES.find(l => l.id === league);

  return (
    <div className="fade-in">

      {/* ── League selector ── */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {LEAGUES.map(l => (
          <button
            key={l.id}
            onClick={() => { setLeague(l.id); setData(null); setAllData({}); }}
            style={{
              padding: isMobile ? '4px 8px' : '5px 11px',
              borderRadius: '20px',
              fontSize: isMobile ? '0.72rem' : '0.77rem',
              cursor: 'pointer',
              border: `1px solid ${league === l.id ? '#06d6a0' : 'var(--border)'}`,
              background: league === l.id ? 'rgba(6,214,160,0.12)' : 'transparent',
              color: league === l.id ? '#06d6a0' : 'var(--text-muted)',
              fontWeight: league === l.id ? 700 : 400,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
          >
            {l.flag} {isMobile ? l.short : l.label}
          </button>
        ))}
        <button
          onClick={load}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px', fontSize: '0.75rem' }}
        >↻</button>
      </div>

      {/* ── Status filter pills ── */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        {[['all', 'All'], ['live', '● Live'], ['final', 'Final'], ['upcoming', 'Upcoming']].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} style={{
            padding: '3px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
            border: `1px solid ${filter === id ? '#06d6a0' : 'var(--border)'}`,
            background: filter === id ? 'rgba(6,214,160,0.08)' : 'transparent',
            color: filter === id ? '#06d6a0' : 'var(--text-muted)',
            fontWeight: filter === id ? 700 : 400,
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Live badge ── */}
      {liveCount > 0 && (
        <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', boxShadow: '0 0 6px #4ade80', animation: 'live-pulse 1.5s ease-in-out infinite', display: 'inline-block' }} />
          <span style={{ fontSize: '0.75rem', color: '#4ade80', fontWeight: 700 }}>
            {liveCount} match{liveCount !== 1 ? 'es' : ''} in progress
          </span>
        </div>
      )}

      {/* ── Content ── */}
      {loading && !hasData ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚽</div>
          <p style={{ fontSize: '0.85rem' }}>
            {league === 'all' ? 'Loading all leagues…' : `Loading ${currentLg?.label || 'soccer'} scores…`}
          </p>
        </div>

      ) : error ? (
        <div style={{ padding: '1.5rem', background: '#2b0d0d', border: '1px solid #991b1b', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
          <div style={{ marginBottom: '8px' }}>⚠️ Couldn't load soccer data — ESPN may be temporarily unavailable.</div>
          <div style={{ fontSize: '0.75rem', color: 'rgba(248,113,113,0.7)', marginBottom: '10px' }}>{error}</div>
          <button onClick={load} style={{ background: 'none', border: '1px solid #f87171', borderRadius: '4px', color: '#f87171', cursor: 'pointer', padding: '3px 10px', fontSize: '0.75rem' }}>
            Retry
          </button>
        </div>

      ) : isEmpty ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚽</div>
          <p style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
            No {filter === 'all' ? '' : filter + ' '}matches today
          </p>
          <p style={{ fontSize: '0.78rem' }}>
            {filter !== 'all'
              ? `Try switching to "All" to see upcoming fixtures.`
              : `Check back later — midweek fixtures are typically Tue/Wed.`}
          </p>
        </div>

      ) : league === 'all' ? (
        /* ── All Soccer: grouped by league ── */
        <div>
          {allSections.map(({ league: lg, matches }) => (
            <div key={lg.id}>
              <LeagueHeader leagueInfo={lg} count={matches.length} />
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 'min(280px, 100%)' : '270px'}, 1fr))`,
                gap: '8px',
                marginBottom: '16px',
              }}>
                {matches.map((match, i) => (
                  <MatchCard key={match.id || i} match={match} leagueId={lg.id} />
                ))}
              </div>
            </div>
          ))}
        </div>

      ) : (
        /* ── Single league grid ── */
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 'min(280px, 100%)' : '270px'}, 1fr))`,
          gap: '8px',
        }}>
          {sorted.map((match, i) => (
            <MatchCard key={match.id || i} match={match} leagueId={league} />
          ))}
        </div>
      )}
    </div>
  );
}
