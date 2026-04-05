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

function scoreColor(score) {
  if (score === null || score === undefined || score === 'E') return '#94a3b8';
  const n = typeof score === 'string' ? parseInt(score) : score;
  if (isNaN(n)) return '#94a3b8';
  if (n < 0) return '#4ade80';
  if (n > 0) return '#f87171';
  return '#94a3b8';
}

function fmtScore(score) {
  if (score === null || score === undefined || score === 'E') return 'E';
  const n = typeof score === 'string' ? parseInt(score) : score;
  if (isNaN(n)) return score;
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

function PlayerRow({ player, rank, highlight, isMobile }) {
  const toPar      = player.statistics?.[0]?.displayValue ?? player.score?.displayValue ?? '—';
  const thru       = player.status?.thru ?? player.statistics?.[1]?.displayValue ?? '—';
  const todayScore = player.statistics?.[2]?.displayValue ?? '—';
  const totalScore = player.statistics?.[3]?.displayValue ?? player.score?.value ?? '—';

  const toParNum   = toPar === 'E' ? 0 : parseInt(toPar);
  const todayNum   = todayScore === 'E' ? 0 : parseInt(todayScore);

  const isLead = rank === 1;
  const isCut  = player.status?.type === 'cut';

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: isMobile ? '30px 1fr 44px 40px 40px' : '36px 36px 1fr 52px 46px 46px 60px',
      alignItems: 'center',
      padding: isMobile ? '6px 10px' : '7px 12px',
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      background: highlight ? 'rgba(255,184,0,0.05)' : isLead ? 'rgba(74,222,128,0.04)' : 'transparent',
      opacity: isCut ? 0.45 : 1,
    }}>
      {/* Rank */}
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.78rem', fontWeight: isLead ? 800 : 500, color: isLead ? '#FFB800' : 'var(--text-muted)' }}>
        {player.status?.position?.displayName || rank}
      </div>

      {/* Flag/Country — desktop only */}
      {!isMobile && (
        <div style={{ fontSize: '1rem', textAlign: 'center' }}>
          {player.athlete?.flag?.href
            ? <img src={player.athlete.flag.href} alt="" style={{ width: '18px', height: '12px', objectFit: 'cover', borderRadius: '1px' }} />
            : '🏌️'}
        </div>
      )}

      {/* Name */}
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {player.athlete?.displayName || player.athlete?.fullName || '—'}
        </div>
        {isCut && <div style={{ fontSize: '0.6rem', color: '#f87171', fontWeight: 700 }}>CUT</div>}
      </div>

      {/* To Par */}
      <div style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: isMobile ? '0.85rem' : '0.92rem', color: scoreColor(toParNum) }}>
        {fmtScore(toPar)}
      </div>

      {/* Today */}
      <div style={{ textAlign: 'center', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.78rem', color: scoreColor(todayNum) }}>
        {todayScore !== '—' ? fmtScore(todayScore) : '—'}
      </div>

      {/* Thru */}
      <div style={{ textAlign: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        {thru}
      </div>

      {/* Total strokes — desktop only */}
      {!isMobile && (
        <div style={{ textAlign: 'right', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          {totalScore !== '—' ? totalScore : '—'}
        </div>
      )}
    </div>
  );
}

export default function GolfLeaderboard() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [league, setLeague]   = useState('pga'); // pga | lpga | euro | korn
  const [showAll, setShowAll] = useState(false);
  const isMobile = useIsMobile();

  const leagues = [
    { id: 'pga',  label: 'PGA Tour',    emoji: '🇺🇸' },
    { id: 'lpga', label: 'LPGA Tour',   emoji: '👩' },
    { id: 'euro', label: 'DP World',    emoji: '🇪🇺' },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // All leagues use the same sports route with ?league= param.
      // The API overrides the endpoint to 'leaderboard' and appends ?league=
      const url = `/api/sports?sport=golf&endpoint=leaderboard&league=${league}`;
      const res  = await fetch(url);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message || 'Failed to load golf leaderboard');
    } finally {
      setLoading(false);
    }
  }, [league]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 3 minutes during tournaments
  useEffect(() => {
    const t = setInterval(load, 3 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  const tournament = data?.events?.[0] ?? data?.competitions?.[0] ?? null;
  const players    = (tournament?.competitors ?? tournament?.leaderboard ?? data?.competitors ?? []);

  const filtered = search.trim()
    ? players.filter(p => (p.athlete?.displayName || p.athlete?.fullName || '').toLowerCase().includes(search.toLowerCase()))
    : players;

  const displayed = showAll ? filtered : filtered.slice(0, 30);

  // Extract tournament info
  const tournName  = tournament?.name ?? data?.events?.[0]?.name ?? data?.name ?? 'PGA Tour';
  const tournVenue = tournament?.venue?.fullName ?? tournament?.course ?? '';
  const tournPurse = tournament?.purse ? `$${(tournament.purse / 1_000_000).toFixed(1)}M` : '';
  const statusDetail = tournament?.status?.type?.detail ?? tournament?.status?.shortDetail ?? '';

  return (
    <div className="fade-in">
      {/* League selector */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1rem', flexWrap: 'wrap' }}>
        {leagues.map(l => (
          <button key={l.id} onClick={() => setLeague(l.id)} style={{
            padding: '5px 12px', borderRadius: '20px', fontSize: '0.78rem', cursor: 'pointer',
            border: `1px solid ${league === l.id ? '#22c55e' : 'var(--border)'}`,
            background: league === l.id ? 'rgba(34,197,94,0.12)' : 'transparent',
            color: league === l.id ? '#22c55e' : 'var(--text-muted)',
            fontWeight: league === l.id ? 700 : 400,
          }}>
            {l.emoji} {l.label}
          </button>
        ))}
        <input
          type="text" placeholder="Search player…"
          value={search} onChange={e => setSearch(e.target.value)}
          className="input"
          style={{ marginLeft: 'auto', width: '160px', padding: '4px 10px', fontSize: '0.78rem' }}
        />
        <button onClick={load} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px 8px', fontSize: '0.75rem' }}>
          ↻
        </button>
      </div>

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⛳</div>
          <p style={{ fontSize: '0.85rem' }}>Loading leaderboard…</p>
        </div>
      ) : error ? (
        <div style={{ padding: '1.5rem', background: '#2b0d0d', border: '1px solid #991b1b', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
          ⚠️ {error}
          <button onClick={load} style={{ marginLeft: '12px', background: 'none', border: '1px solid #f87171', borderRadius: '4px', color: '#f87171', cursor: 'pointer', padding: '2px 8px', fontSize: '0.75rem' }}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* Tournament header */}
          {tournName && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '12px 16px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text-primary)', marginBottom: '3px' }}>{tournName}</div>
                  {tournVenue && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>📍 {tournVenue}</div>}
                </div>
                <div style={{ display: 'flex', gap: '12px', flexShrink: 0, alignItems: 'center' }}>
                  {tournPurse && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Purse</div>
                      <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.92rem', color: '#FFB800' }}>{tournPurse}</div>
                    </div>
                  )}
                  {statusDetail && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</div>
                      <div style={{ fontSize: '0.78rem', color: '#4ade80', fontWeight: 700 }}>{statusDetail}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Leaderboard table */}
          {players.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⛳</div>
              <p>No active tournament leaderboard available right now.</p>
              <p style={{ fontSize: '0.78rem', marginTop: '4px' }}>Check back during tournament rounds (Thu–Sun).</p>
            </div>
          ) : (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
              {/* Column headers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '30px 1fr 44px 40px 40px' : '36px 36px 1fr 52px 46px 46px 60px',
                padding: isMobile ? '6px 10px' : '6px 12px',
                background: 'rgba(255,255,255,0.03)',
                borderBottom: '1px solid var(--border)',
              }}>
                {(isMobile ? ['Pos', 'Player', 'To Par', 'Today', 'Thru'] : ['Pos', '', 'Player', 'To Par', 'Today', 'Thru', 'Total']).map((h, i) => (
                  <div key={i} style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', textAlign: i >= 3 ? 'center' : 'left', ...(i === 6 && !isMobile ? { textAlign: 'right' } : {}) }}>
                    {h}
                  </div>
                ))}
              </div>

              {displayed.map((player, i) => (
                <PlayerRow
                  key={player.id || player.athlete?.id || i}
                  player={player}
                  rank={i + 1}
                  highlight={false}
                  isMobile={isMobile}
                />
              ))}

              {!showAll && filtered.length > 30 && (
                <button
                  onClick={() => setShowAll(true)}
                  style={{ width: '100%', padding: '10px', background: 'rgba(255,255,255,0.02)', border: 'none', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.78rem' }}
                >
                  Show all {filtered.length} players ↓
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
