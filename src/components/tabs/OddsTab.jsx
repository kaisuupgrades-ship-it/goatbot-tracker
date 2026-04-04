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
  return (p * 100).toFixed(0) + '%';
}

// Get best odds for a team from a specific market across all books
function bestOdds(bookmakers, outcomeName, marketKey) {
  let best = null;
  bookmakers.forEach(bk => {
    const mkt = bk.markets?.find(m => m.key === marketKey);
    const outcome = mkt?.outcomes?.find(o => o.name === outcomeName);
    if (outcome?.price != null && (best === null || outcome.price > best)) best = outcome.price;
  });
  return best;
}

// Get best spread point + juice for a team
function bestSpread(bookmakers, teamName) {
  let bestPrice = null;
  let bestPoint = null;
  bookmakers.forEach(bk => {
    const mkt = bk.markets?.find(m => m.key === 'spreads');
    const outcome = mkt?.outcomes?.find(o => o.name === teamName);
    if (outcome?.price != null && (bestPrice === null || outcome.price > bestPrice)) {
      bestPrice = outcome.price;
      bestPoint = outcome.point;
    }
  });
  return { price: bestPrice, point: bestPoint };
}

// Get total line (O/U number) and best over/under odds
function bestTotal(bookmakers) {
  let line = null;
  let overPrice = null;
  let underPrice = null;
  bookmakers.forEach(bk => {
    const mkt = bk.markets?.find(m => m.key === 'totals');
    const over  = mkt?.outcomes?.find(o => o.name === 'Over');
    const under = mkt?.outcomes?.find(o => o.name === 'Under');
    if (over?.point != null && line === null) line = over.point;
    if (over?.price  != null && (overPrice  === null || over.price  > overPrice))  overPrice  = over.price;
    if (under?.price != null && (underPrice === null || under.price > underPrice)) underPrice = under.price;
  });
  return { line, overPrice, underPrice };
}

// Build GOAT BOT prompt incorporating all three markets
function buildUnifiedPrompt(game) {
  const commence   = new Date(game.commence_time);
  const today      = new Date();
  const isToday    = commence.toDateString() === today.toDateString();
  const isTomorrow = commence.toDateString() === new Date(Date.now() + 86400000).toDateString();
  const dateLabel  = isToday    ? `today (${commence.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})`
                   : isTomorrow ? `tomorrow (${commence.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})`
                   : commence.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const books = game.bookmakers || [];
  const away  = game.away_team;
  const home  = game.home_team;

  const awayML  = bestOdds(books, away, 'h2h');
  const homeML  = bestOdds(books, home, 'h2h');
  const awaySpr = bestSpread(books, away);
  const homeSpr = bestSpread(books, home);
  const total   = bestTotal(books);

  const mlStr  = awayML != null && homeML != null ? `ML: ${away.split(' ').pop()} ${formatOdds(awayML)} / ${home.split(' ').pop()} ${formatOdds(homeML)}` : '';
  const sprStr = awaySpr.point != null ? `Spread: ${away.split(' ').pop()} ${awaySpr.point > 0 ? '+' : ''}${awaySpr.point} (${formatOdds(awaySpr.price)})` : '';
  const totStr = total.line != null ? `O/U: ${total.line} (O ${formatOdds(total.overPrice)} / U ${formatOdds(total.underPrice)})` : '';
  const oddsStr = [mlStr, sprStr, totStr].filter(Boolean).join(' · ');

  const dateCtx = `[Game date: ${dateLabel}. Today is ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.]\n`;
  return `${dateCtx}Run a full GOAT BOT analysis on ${away} @ ${home} — ${dateLabel}. ${oddsStr ? oddsStr + '.' : ''} Cover all three angles — moneyline value, spread edge, and total lean. Give me sharpest line, key angles, and your best pick for each market.`;
}

// ── Unified Game Row ──────────────────────────────────────────────────────────
function GameOddsRow({ game, expanded, onToggle, onAnalyze }) {
  const books = game.bookmakers || [];
  const away  = game.away_team;
  const home  = game.home_team;

  const awayML  = bestOdds(books, away, 'h2h');
  const homeML  = bestOdds(books, home, 'h2h');
  const awaySpr = bestSpread(books, away);
  const homeSpr = bestSpread(books, home);
  const total   = bestTotal(books);

  const commenceTime = new Date(game.commence_time);
  const isLive = game.status === 'live';
  const timeLabel = isLive
    ? 'LIVE'
    : commenceTime.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // All books that have any market data
  const allBooks = books.filter(bk =>
    bk.markets?.some(m => ['h2h','spreads','totals'].includes(m.key))
  );

  return (
    <div style={{ borderBottom: '1px solid #1a1a1a' }}>
      {/* Collapsed summary row */}
      <div
        onClick={onToggle}
        style={{ padding: '0.75rem 1rem', cursor: 'pointer', transition: 'background 0.1s' }}
        onMouseEnter={e => e.currentTarget.style.background = '#141414'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Top line: teams + time */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
          <span style={{ fontWeight: 700, color: '#f0f0f0', fontSize: '0.88rem' }}>
            {away.split(' ').pop()} <span style={{ color: '#555', fontWeight: 400 }}>@</span> {home.split(' ').pop()}
          </span>
          <span style={{ fontSize: '0.65rem', color: '#888', flex: 1 }}>
            {away.includes(' ') ? away.split(' ').slice(0, -1).join(' ') : ''} vs {home.includes(' ') ? home.split(' ').slice(0, -1).join(' ') : ''}
          </span>
          {isLive
            ? <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '4px', padding: '1px 6px' }}>● LIVE</span>
            : <span style={{ fontSize: '0.65rem', color: '#666', whiteSpace: 'nowrap' }}>{timeLabel}</span>
          }
          <span style={{ color: '#444', fontSize: '0.72rem', marginLeft: '4px' }}>{expanded ? '▲' : '▼'}</span>
        </div>

        {/* Bottom line: ML | Spread | O/U inline */}
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* Moneyline column */}
          <div style={{ minWidth: '90px' }}>
            <div style={{ fontSize: '0.58rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>Moneyline</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.6rem', color: '#666', marginBottom: '1px' }}>Away</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 700, color: oddsColor(awayML) }}>{formatOdds(awayML)}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.6rem', color: '#666', marginBottom: '1px' }}>Home</div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.9rem', fontWeight: 700, color: oddsColor(homeML) }}>{formatOdds(homeML)}</div>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', background: '#1f1f1f', alignSelf: 'stretch' }} />

          {/* Spread column */}
          <div style={{ minWidth: '110px' }}>
            <div style={{ fontSize: '0.58rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>Spread</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.6rem', color: '#666', marginBottom: '1px' }}>Away</div>
                {awaySpr.point != null
                  ? <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: '#f0f0f0' }}>
                      {awaySpr.point > 0 ? '+' : ''}{awaySpr.point}
                      <span style={{ color: '#777', fontSize: '0.72rem', marginLeft: '2px' }}>({formatOdds(awaySpr.price)})</span>
                    </div>
                  : <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: '#444' }}>—</div>
                }
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.6rem', color: '#666', marginBottom: '1px' }}>Home</div>
                {homeSpr.point != null
                  ? <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: '#f0f0f0' }}>
                      {homeSpr.point > 0 ? '+' : ''}{homeSpr.point}
                      <span style={{ color: '#777', fontSize: '0.72rem', marginLeft: '2px' }}>({formatOdds(homeSpr.price)})</span>
                    </div>
                  : <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: '#444' }}>—</div>
                }
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: '1px', background: '#1f1f1f', alignSelf: 'stretch' }} />

          {/* O/U column */}
          <div style={{ minWidth: '100px' }}>
            <div style={{ fontSize: '0.58rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>
              O/U {total.line != null ? <span style={{ color: '#FFB800', fontWeight: 700 }}>{total.line}</span> : ''}
            </div>
            {total.line != null
              ? <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: '#666', marginBottom: '1px' }}>Over</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: oddsColor(total.overPrice) }}>{formatOdds(total.overPrice)}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '0.6rem', color: '#666', marginBottom: '1px' }}>Under</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', fontWeight: 700, color: oddsColor(total.underPrice) }}>{formatOdds(total.underPrice)}</div>
                  </div>
                </div>
              : <div style={{ color: '#444', fontSize: '0.8rem' }}>—</div>
            }
          </div>

          <div style={{ marginLeft: 'auto', color: '#444', fontSize: '0.65rem', alignSelf: 'center', whiteSpace: 'nowrap' }}>
            {allBooks.length} book{allBooks.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Expanded: book-by-book table (all 3 markets) */}
      {expanded && (
        <div style={{ background: '#0d0d0d', borderTop: '1px solid #1a1a1a', padding: '0.75rem 1rem', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', minWidth: '520px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1f1f1f' }}>
                <th style={{ padding: '4px 8px', color: '#555', fontWeight: 600, textAlign: 'left', fontSize: '0.68rem', textTransform: 'uppercase' }}>Book</th>
                <th colSpan={2} style={{ padding: '4px 8px', color: '#888', fontWeight: 600, textAlign: 'center', fontSize: '0.68rem', textTransform: 'uppercase', borderLeft: '1px solid #1f1f1f' }}>Moneyline</th>
                <th colSpan={2} style={{ padding: '4px 8px', color: '#888', fontWeight: 600, textAlign: 'center', fontSize: '0.68rem', textTransform: 'uppercase', borderLeft: '1px solid #1f1f1f' }}>Spread</th>
                <th colSpan={2} style={{ padding: '4px 8px', color: '#888', fontWeight: 600, textAlign: 'center', fontSize: '0.68rem', textTransform: 'uppercase', borderLeft: '1px solid #1f1f1f' }}>O/U</th>
                <th style={{ padding: '4px 6px', color: '#555', fontWeight: 600, textAlign: 'right', fontSize: '0.65rem', textTransform: 'uppercase' }}>Updated</th>
              </tr>
              <tr style={{ borderBottom: '1px solid #222' }}>
                <th style={{ padding: '2px 8px' }} />
                <th style={{ padding: '2px 8px', color: '#555', fontSize: '0.62rem', textAlign: 'center', borderLeft: '1px solid #1f1f1f' }}>{away.split(' ').pop()}</th>
                <th style={{ padding: '2px 8px', color: '#555', fontSize: '0.62rem', textAlign: 'center' }}>{home.split(' ').pop()}</th>
                <th style={{ padding: '2px 8px', color: '#555', fontSize: '0.62rem', textAlign: 'center', borderLeft: '1px solid #1f1f1f' }}>Away</th>
                <th style={{ padding: '2px 8px', color: '#555', fontSize: '0.62rem', textAlign: 'center' }}>Home</th>
                <th style={{ padding: '2px 8px', color: '#555', fontSize: '0.62rem', textAlign: 'center', borderLeft: '1px solid #1f1f1f' }}>Over</th>
                <th style={{ padding: '2px 8px', color: '#555', fontSize: '0.62rem', textAlign: 'center' }}>Under</th>
                <th style={{ padding: '2px 6px' }} />
              </tr>
            </thead>
            <tbody>
              {allBooks.map(bk => {
                const h2h     = bk.markets?.find(m => m.key === 'h2h');
                const spreads = bk.markets?.find(m => m.key === 'spreads');
                const totals  = bk.markets?.find(m => m.key === 'totals');

                const awayMLPrice  = h2h?.outcomes?.find(o => o.name === away)?.price;
                const homeMLPrice  = h2h?.outcomes?.find(o => o.name === home)?.price;
                const awaySprOut   = spreads?.outcomes?.find(o => o.name === away);
                const homeSprOut   = spreads?.outcomes?.find(o => o.name === home);
                const overOut      = totals?.outcomes?.find(o => o.name === 'Over');
                const underOut     = totals?.outcomes?.find(o => o.name === 'Under');

                function Cell({ price, isBest, point }) {
                  if (price == null) return <td style={{ padding: '6px 8px', textAlign: 'center', color: '#333' }}>—</td>;
                  return (
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      {point != null && (
                        <span style={{ color: '#777', fontSize: '0.72rem', marginRight: '3px' }}>
                          {point > 0 ? '+' : ''}{point}
                        </span>
                      )}
                      <span style={{
                        color: isBest ? '#000' : oddsColor(price),
                        background: isBest ? '#FFB800' : 'transparent',
                        padding: isBest ? '1px 5px' : '0',
                        borderRadius: isBest ? '3px' : '0',
                        fontWeight: 700, fontFamily: 'monospace', fontSize: '0.82rem',
                      }}>
                        {formatOdds(price)}
                      </span>
                    </td>
                  );
                }

                return (
                  <tr key={bk.key} style={{ borderBottom: '1px solid #1a1a1a' }}>
                    <td style={{ padding: '6px 8px', color: '#888', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {BOOK_LABELS[bk.key] || bk.title}
                    </td>
                    <Cell price={awayMLPrice} isBest={awayMLPrice === awayML} />
                    <Cell price={homeMLPrice} isBest={homeMLPrice === homeML} />
                    <td style={{ padding: '6px 8px', textAlign: 'center', borderLeft: '1px solid #1a1a1a' }}>
                      {awaySprOut?.price != null
                        ? <>
                            <span style={{ color: '#777', fontSize: '0.72rem', marginRight: '3px' }}>{awaySprOut.point > 0 ? '+' : ''}{awaySprOut.point}</span>
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.82rem', color: awaySprOut.price === awaySpr.price ? '#FFB800' : oddsColor(awaySprOut.price), background: awaySprOut.price === awaySpr.price ? 'rgba(255,184,0,0.1)' : 'transparent', padding: awaySprOut.price === awaySpr.price ? '1px 4px' : '0', borderRadius: '3px' }}>
                              {formatOdds(awaySprOut.price)}
                            </span>
                          </>
                        : <span style={{ color: '#333' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      {homeSprOut?.price != null
                        ? <>
                            <span style={{ color: '#777', fontSize: '0.72rem', marginRight: '3px' }}>{homeSprOut.point > 0 ? '+' : ''}{homeSprOut.point}</span>
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.82rem', color: homeSprOut.price === homeSpr.price ? '#FFB800' : oddsColor(homeSprOut.price), background: homeSprOut.price === homeSpr.price ? 'rgba(255,184,0,0.1)' : 'transparent', padding: homeSprOut.price === homeSpr.price ? '1px 4px' : '0', borderRadius: '3px' }}>
                              {formatOdds(homeSprOut.price)}
                            </span>
                          </>
                        : <span style={{ color: '#333' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', borderLeft: '1px solid #1a1a1a' }}>
                      {overOut?.price != null
                        ? <>
                            {overOut.point != null && <span style={{ color: '#777', fontSize: '0.72rem', marginRight: '3px' }}>{overOut.point}</span>}
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.82rem', color: overOut.price === total.overPrice ? '#FFB800' : oddsColor(overOut.price), background: overOut.price === total.overPrice ? 'rgba(255,184,0,0.1)' : 'transparent', padding: overOut.price === total.overPrice ? '1px 4px' : '0', borderRadius: '3px' }}>
                              {formatOdds(overOut.price)}
                            </span>
                          </>
                        : <span style={{ color: '#333' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                      {underOut?.price != null
                        ? <>
                            {underOut.point != null && <span style={{ color: '#777', fontSize: '0.72rem', marginRight: '3px' }}>{underOut.point}</span>}
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.82rem', color: underOut.price === total.underPrice ? '#FFB800' : oddsColor(underOut.price), background: underOut.price === total.underPrice ? 'rgba(255,184,0,0.1)' : 'transparent', padding: underOut.price === total.underPrice ? '1px 4px' : '0', borderRadius: '3px' }}>
                              {formatOdds(underOut.price)}
                            </span>
                          </>
                        : <span style={{ color: '#333' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '6px 6px', color: '#555', fontSize: '0.65rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {bk.last_update ? new Date(bk.last_update).toLocaleTimeString() : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Best lines summary + GOAT BOT */}
          <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Best ML */}
            {awayML != null && (
              <span style={{ padding: '3px 8px', background: '#1a1200', border: '1px solid #FFB80044', borderRadius: '4px', color: '#FFB800', fontSize: '0.7rem' }}>
                🏆 Best ML: {away.split(' ').pop()} <strong>{formatOdds(awayML)}</strong> / {home.split(' ').pop()} <strong>{formatOdds(homeML)}</strong>
              </span>
            )}
            {/* Best spread */}
            {awaySpr.point != null && (
              <span style={{ padding: '3px 8px', background: '#0d1a0d', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '4px', color: '#4ade80', fontSize: '0.7rem' }}>
                📐 Spread: {away.split(' ').pop()} {awaySpr.point > 0 ? '+' : ''}{awaySpr.point} ({formatOdds(awaySpr.price)})
              </span>
            )}
            {/* Best total */}
            {total.line != null && (
              <span style={{ padding: '3px 8px', background: '#0d0d1a', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '4px', color: '#60a5fa', fontSize: '0.7rem' }}>
                🎯 O/U {total.line}: O {formatOdds(total.overPrice)} / U {formatOdds(total.underPrice)}
              </span>
            )}
            {/* GOAT BOT button */}
            {onAnalyze && (
              <button
                onClick={e => { e.stopPropagation(); onAnalyze(buildUnifiedPrompt(game)); }}
                style={{
                  marginLeft: 'auto', padding: '5px 14px', borderRadius: '7px',
                  border: '1px solid rgba(255,184,0,0.4)', background: 'rgba(255,184,0,0.08)',
                  color: '#FFB800', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.12s',
                  whiteSpace: 'nowrap', fontFamily: 'inherit',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.18)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.08)'; }}
              >
                🐐 Analyze with GOAT BOT
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

// ── Main Component ────────────────────────────────────────────────────────────
export default function OddsTab({ onAnalyze }) {
  const [sport, setSport]           = useState('mlb');
  const [games, setGames]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [configured, setConfigured] = useState(true);
  const [expanded, setExpanded]     = useState(null);
  const [remaining, setRemaining]   = useState(null);
  const [search, setSearch]         = useState('');

  const load = useCallback(async (s) => {
    setLoading(true);
    setError('');
    try {
      // Fetch all markets in one call (market param not needed — API returns all)
      const res  = await fetch(`/api/odds?sport=${s}&market=all`);
      const data = await res.json();
      if (data.configured === false) { setConfigured(false); setLoading(false); return; }
      if (data.error) throw new Error(data.error);
      setConfigured(true);
      setGames(data.data || []);
      setRemaining(data.remaining ?? null);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(sport); }, [sport, load]);

  if (!configured) return <SetupScreen />;

  const filtered = games.filter(g =>
    !search ||
    g.home_team.toLowerCase().includes(search.toLowerCase()) ||
    g.away_team.toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Sport tabs */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {SPORTS.map(s => (
            <button key={s.key} onClick={() => { setSport(s.key); setExpanded(null); }}
              style={{
                padding: '4px 10px', borderRadius: '6px', border: `1px solid ${sport === s.key ? '#FFB800' : '#222'}`,
                background: sport === s.key ? '#1a1200' : 'transparent',
                color: sport === s.key ? '#FFB800' : '#666',
                fontWeight: sport === s.key ? 700 : 400, fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {s.emoji} {s.label}
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
        <button onClick={() => load(sport)}
          style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: '6px', color: 'var(--text-secondary)', padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit' }}>
          ↻ Refresh
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          Loading odds…
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
              {filtered.length} game{filtered.length !== 1 ? 's' : ''} · Click to compare books · <span style={{ color: '#FFB800' }}>Gold = best line</span>
            </span>
            <span style={{ color: '#555', fontSize: '0.68rem' }}>ML · Spread · O/U</span>
          </div>
          {filtered.map(game => (
            <GameOddsRow
              key={game.id}
              game={game}
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
