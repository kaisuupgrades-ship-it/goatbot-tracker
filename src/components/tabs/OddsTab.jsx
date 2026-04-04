'use client';
import { useState, useEffect, useCallback } from 'react';

const SPORTS = [
  { key: 'mlb',   label: 'MLB',   emoji: '⚾' },
  { key: 'nfl',   label: 'NFL',   emoji: '🏈' },
  { key: 'nba',   label: 'NBA',   emoji: '🏀' },
  { key: 'nhl',   label: 'NHL',   emoji: '🏒' },
  { key: 'ncaaf', label: 'NCAAF', emoji: '🏈' },
  { key: 'ncaab', label: 'NCAAB', emoji: '🏀' },
  { key: 'mls',   label: 'MLS',   emoji: '⚽' },
];

const MARKETS = [
  { key: 'h2h',     label: 'Moneyline' },
  { key: 'spreads', label: 'Spread'    },
  { key: 'totals',  label: 'Total'     },
];

const BOOK_LABELS = {
  fanduel:     'FanDuel',
  draftkings:  'DraftKings',
  betmgm:      'BetMGM',
  caesars:     'Caesars',
  pointsbetus: 'PointsBet',
  bet365:      'Bet365',
  pinnacle:    'Pinnacle',
  bovada:      'Bovada',
};

function formatOdds(price) {
  if (price == null) return '—';
  return price > 0 ? `+${price}` : `${price}`;
}

function oddsColor(price) {
  if (price == null) return '#555';
  return price > 0 ? '#4ade80' : '#f0f0f0';
}

function impliedProb(price) {
  if (!price) return null;
  const p = price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
  return (p * 100).toFixed(1) + '%';
}

// Find the best (highest) odds for a given outcome across all books
function bestOdds(bookmakers, outcomeName, market) {
  let best = null;
  bookmakers.forEach(bk => {
    const mkt = bk.markets?.find(m => m.key === market);
    const outcome = mkt?.outcomes?.find(o => o.name === outcomeName);
    if (outcome?.price != null) {
      if (best === null || outcome.price > best) best = outcome.price;
    }
  });
  return best;
}

// Auto-detect game date context for GOAT BOT prompt
function buildOddsPrompt(game, market) {
  const commence   = new Date(game.commence_time);
  const today      = new Date();
  const isToday    = commence.toDateString() === today.toDateString();
  const isTomorrow = commence.toDateString() === new Date(Date.now() + 86400000).toDateString();
  const dateLabel  = isToday    ? `today (${commence.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})`
                   : isTomorrow ? `tomorrow (${commence.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})`
                   : commence.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const marketLabel = { h2h: 'moneyline', spreads: 'spread', totals: 'total' }[market] || market;

  // Best odds summary
  const books = game.bookmakers || [];
  const teams = [game.away_team, game.home_team];
  function best(teamName) {
    let b = null;
    books.forEach(bk => {
      const mkt = bk.markets?.find(m => m.key === market);
      const o = mkt?.outcomes?.find(oc => oc.name === teamName);
      if (o?.price != null && (b === null || o.price > b)) b = o.price;
    });
    return b;
  }
  const awayBest = best(game.away_team);
  const homeBest = best(game.home_team);
  const oddsStr = awayBest != null && homeBest != null
    ? `Current ${marketLabel}: ${game.away_team.split(' ').pop()} ${awayBest > 0 ? '+' : ''}${awayBest} / ${game.home_team.split(' ').pop()} ${homeBest > 0 ? '+' : ''}${homeBest}`
    : '';

  const dateCtx = `[Game date: ${dateLabel}. Today is ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.]\n`;
  return `${dateCtx}Run a full GOAT BOT analysis on ${game.away_team} @ ${game.home_team} — ${dateLabel}. ${oddsStr ? oddsStr + '.' : ''} Give me the sharpest ${marketLabel} edge — line movement signals, sharp money angles, injury impact, and your best pick with confidence level.`;
}

// ── Game Odds Row ─────────────────────────────────────────────────────────────
function GameOddsRow({ game, market, expanded, onToggle, onAnalyze }) {
  const books = game.bookmakers || [];
  const teams = [game.away_team, game.home_team];

  // Best odds per team
  const bests = Object.fromEntries(teams.map(t => [t, bestOdds(books, t, market)]));

  const commenceTime = new Date(game.commence_time);
  const isUpcoming = commenceTime > new Date();

  return (
    <div style={{ borderBottom: '1px solid #1a1a1a' }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{
          padding: '0.8rem 1rem', cursor: 'pointer', display: 'flex',
          alignItems: 'center', gap: '1rem', transition: 'background 0.1s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = '#141414'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Game info */}
        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
          <p style={{ fontWeight: 700, color: '#f0f0f0', fontSize: '0.88rem', marginBottom: '2px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {game.away_team} <span style={{ color: 'var(--text-muted)' }}>@</span> {game.home_team}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
            {isUpcoming ? commenceTime.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'In Progress / Final'}
          </p>
        </div>

        {/* Best odds per team */}
        <div style={{ display: 'flex', gap: '1rem', flexShrink: 0 }}>
          {teams.map(team => {
            const best = bests[team];
            const shortName = team.split(' ').pop();
            return (
              <div key={team} style={{ textAlign: 'center', minWidth: '70px' }}>
                <p style={{ color: '#888', fontSize: '0.68rem', marginBottom: '2px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{shortName}</p>
                <p style={{ color: best != null && best === Math.max(...Object.values(bests).filter(v => v != null)) ? '#FFB800' : oddsColor(best), fontWeight: 700, fontSize: '0.95rem', fontFamily: 'monospace' }}>
                  {formatOdds(best)}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{impliedProb(best)}</p>
              </div>
            );
          })}
        </div>

        {/* Line spread / total summary */}
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', minWidth: '60px', textAlign: 'right', flexShrink: 0 }}>
          {books.length} books
          <span style={{ marginLeft: '6px' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded book comparison */}
      {expanded && (
        <div style={{ background: '#0d0d0d', borderTop: '1px solid #1a1a1a', padding: '0.75rem 1rem', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', minWidth: '400px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1f1f1f' }}>
                <th style={{ padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase' }}>Book</th>
                {teams.map(t => (
                  <th key={t} style={{ padding: '4px 12px', color: '#aaa', fontWeight: 600, textAlign: 'center', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                    {t.split(' ').slice(-1)[0]}
                  </th>
                ))}
                <th style={{ padding: '4px 8px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right', fontSize: '0.7rem' }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {books.map(bk => {
                const mkt = bk.markets?.find(m => m.key === market);
                return (
                  <tr key={bk.key} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '6px 8px', color: '#888', fontWeight: 500 }}>
                      {BOOK_LABELS[bk.key] || bk.title}
                    </td>
                    {teams.map(team => {
                      const outcome = mkt?.outcomes?.find(o => o.name === team);
                      const price = outcome?.price;
                      const isBest = price === bests[team] && price != null;
                      return (
                        <td key={team} style={{ padding: '6px 12px', textAlign: 'center' }}>
                          <span style={{
                            color: isBest ? '#000' : oddsColor(price),
                            background: isBest ? '#FFB800' : 'transparent',
                            padding: isBest ? '2px 6px' : '0',
                            borderRadius: isBest ? '4px' : '0',
                            fontWeight: 700, fontFamily: 'monospace', fontSize: '0.85rem',
                          }}>
                            {formatOdds(price)}
                          </span>
                        </td>
                      );
                    })}
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: '0.68rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {bk.last_update ? new Date(bk.last_update).toLocaleTimeString() : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Best line summary + GOAT BOT */}
          <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {teams.map(team => {
              const best = bests[team];
              const bookWithBest = books.find(bk => {
                const mkt = bk.markets?.find(m => m.key === market);
                return mkt?.outcomes?.find(o => o.name === team && o.price === best);
              });
              return best != null ? (
                <span key={team} style={{ padding: '3px 8px', background: '#1a1200', border: '1px solid #FFB80066', borderRadius: '4px', color: '#FFB800', fontSize: '0.72rem' }}>
                  🏆 Best {team.split(' ').pop()}: <strong>{formatOdds(best)}</strong> @ {BOOK_LABELS[bookWithBest?.key] || bookWithBest?.title || '?'}
                </span>
              ) : null;
            })}
            {/* GOAT BOT analyze button */}
            {onAnalyze && (
              <button
                onClick={e => { e.stopPropagation(); onAnalyze(buildOddsPrompt(game, market)); }}
                style={{
                  marginLeft: 'auto', padding: '4px 12px', borderRadius: '7px',
                  border: '1px solid rgba(255,184,0,0.4)', background: 'rgba(255,184,0,0.08)',
                  color: '#FFB800', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.12s',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.18)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.08)'; }}
              >
                🐐 GOAT BOT
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Setup Screen ──────────────────────────────────────────────────────────────
function SetupScreen() {
  return (
    <div style={{ maxWidth: '600px', margin: '3rem auto', textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📈</div>
      <h2 style={{ fontWeight: 800, color: '#f0f0f0', marginBottom: '0.5rem' }}>Odds Board</h2>
      <p style={{ color: '#888', marginBottom: '1.5rem', lineHeight: 1.6 }}>
        The Odds Board pulls live lines from FanDuel and DraftKings — all in one place, updated every 3 minutes.
      </p>
      <div className="card" style={{ padding: '1.5rem', textAlign: 'left', marginBottom: '1rem' }}>
        <p style={{ color: '#FFB800', fontWeight: 700, marginBottom: '0.8rem' }}>⚡ Quick Setup (2 minutes)</p>
        <ol style={{ color: '#888', fontSize: '0.85rem', lineHeight: 2, paddingLeft: '1.2rem' }}>
          <li>Go to <a href="https://odds-api.io" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>odds-api.io</a> → Sign up free</li>
          <li>Copy your API key from the dashboard</li>
          <li>Open <code style={{ background: '#1a1a1a', padding: '1px 6px', borderRadius: '3px', color: '#f0f0f0' }}>goatbot-app/.env.local</code></li>
          <li>Add: <code style={{ background: '#1a1a1a', padding: '1px 6px', borderRadius: '3px', color: '#4ade80' }}>ODDS_API_KEY=your-key-here</code></li>
          <li>Restart the server: <code style={{ background: '#1a1a1a', padding: '1px 6px', borderRadius: '3px', color: '#f0f0f0' }}>Ctrl+C</code> then <code style={{ background: '#1a1a1a', padding: '1px 6px', borderRadius: '3px', color: '#f0f0f0' }}>npm run dev</code></li>
        </ol>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
        Free tier includes FanDuel &amp; DraftKings lines — with 3-min caching, you'll have plenty of quota for daily use.
      </p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function OddsTab({ onAnalyze }) {
  const [sport, setSport]       = useState('mlb');
  const [market, setMarket]     = useState('h2h');
  const [games, setGames]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [configured, setConfigured] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [search, setSearch]     = useState('');
  const [sortBy, setSortBy]     = useState('time'); // time | spread

  const load = useCallback(async (s, m) => {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`/api/odds?sport=${s}&market=${m}`);
      const data = await res.json();
      if (data.configured === false) { setConfigured(false); setLoading(false); return; }
      if (data.error) throw new Error(data.error);
      setConfigured(true);
      setGames(data.data || []);
      setRemaining(data.remaining);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(sport, market); }, [sport, market, load]);

  if (!configured) return <SetupScreen />;

  const filtered = games
    .filter(g => !search || g.home_team.toLowerCase().includes(search.toLowerCase()) || g.away_team.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortBy === 'time' ? new Date(a.commence_time) - new Date(b.commence_time) : 0);

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Sport */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {SPORTS.map(s => (
            <button key={s.key} onClick={() => setSport(s.key)}
              style={{
                padding: '4px 10px', borderRadius: '6px', border: `1px solid ${sport === s.key ? '#FFB800' : '#222'}`,
                background: sport === s.key ? '#1a1200' : 'transparent',
                color: sport === s.key ? '#FFB800' : '#666',
                fontWeight: sport === s.key ? 700 : 400, fontSize: '0.78rem', cursor: 'pointer',
              }}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>

        <span style={{ color: '#2a2a2a' }}>|</span>

        {/* Market */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {MARKETS.map(m => (
            <button key={m.key} onClick={() => setMarket(m.key)}
              style={{
                padding: '4px 10px', borderRadius: '6px',
                border: `1px solid ${market === m.key ? '#60a5fa' : '#222'}`,
                background: market === m.key ? '#0d1a2b' : 'transparent',
                color: market === m.key ? '#60a5fa' : '#666',
                fontWeight: market === m.key ? 700 : 400, fontSize: '0.78rem', cursor: 'pointer',
              }}>
              {m.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input className="input" placeholder="Search team..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '160px', padding: '4px 10px', fontSize: '0.8rem' }} />

        {remaining != null && (
          <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: 'auto' }}>
            API: {remaining} req remaining
          </span>
        )}
        <button onClick={() => load(sport, market)}
          style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', color: 'var(--text-secondary)', padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem' }}>
          ↻
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <p>Loading odds...</p>
        </div>
      ) : error ? (
        <div style={{ padding: '1rem', background: '#2b0d0d', border: '1px solid #991b1b', borderRadius: '8px', color: '#f87171', fontSize: '0.85rem' }}>
          ⚠️ {error}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          No games found. {search ? 'Try a different search.' : 'No lines posted yet.'}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid #1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#888', fontSize: '0.75rem' }}>
              {filtered.length} games · Click a row to compare books · <span style={{ color: '#FFB800' }}>Gold = best line</span>
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
              {MARKETS.find(m => m.key === market)?.label} odds
            </span>
          </div>
          {filtered.map((game) => (
            <GameOddsRow
              key={game.id}
              game={game}
              market={market}
              expanded={expanded === game.id}
              onToggle={() => setExpanded(prev => prev === game.id ? null : game.id)}
              onAnalyze={onAnalyze}
            />
          ))}
        </div>
      )}
    </div>
  );
}
