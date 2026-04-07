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
  return price > 0 ? '#4ade80' : '#c8c8c8';
}

function impliedProb(price) {
  if (!price) return null;
  const p = price > 0 ? 100 / (price + 100) : Math.abs(price) / (Math.abs(price) + 100);
  return (p * 100).toFixed(0) + '%';
}

// How long after scheduled start before we consider a game "in progress".
const LIVE_BUFFER_MS = 20 * 60 * 1000; // 20 minutes

function isGameLive(game) {
  if (game.status === 'live') return true;
  return new Date(game.commence_time) <= new Date(Date.now() - LIVE_BUFFER_MS);
}

// Smart time label: "Today · 7:10 PM", "Tomorrow · 1:05 PM", "Mon, Apr 7 · 1:05 PM"
function smartTimeLabel(commenceTime) {
  const dt   = new Date(commenceTime);
  const now  = new Date();
  const tom  = new Date(Date.now() + 86400000);
  const time = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (dt.toDateString() === now.toDateString())  return `Today · ${time}`;
  if (dt.toDateString() === tom.toDateString())  return `Tomorrow · ${time}`;
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ` · ${time}`;
}

// Group games by calendar day for date-header rendering
function groupByDate(games) {
  const now = new Date();
  const tom = new Date(Date.now() + 86400000);
  const map = {};
  const order = [];
  for (const g of games) {
    const dt = new Date(g.commence_time);
    let key, label;
    if (dt.toDateString() === now.toDateString()) {
      key   = 'today';
      label = `Today — ${dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`;
    } else if (dt.toDateString() === tom.toDateString()) {
      key   = 'tomorrow';
      label = `Tomorrow — ${dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`;
    } else {
      key   = dt.toDateString();
      label = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    }
    if (!map[key]) { map[key] = { label, games: [] }; order.push(key); }
    map[key].games.push(g);
  }
  return order.map(k => map[k]);
}

function getDateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().split('T')[0];
}

function getDateLabel(offset) {
  if (offset === -1) return 'Yesterday';
  if (offset === 0)  return 'Today';
  if (offset === 1)  return 'Tomorrow';
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function hasExtremeOdds(awayML, homeML) {
  return (awayML != null && Math.abs(awayML) > 500) ||
         (homeML != null && Math.abs(homeML) > 500);
}

// DraftKings-first book priority — use one trusted source instead of scanning all
const ODDS_BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm'];
function sortBooksByPriority(bookmakers) {
  return [...bookmakers].sort((a, b) => {
    const aIdx = ODDS_BOOK_PRIORITY.indexOf(a.key);
    const bIdx = ODDS_BOOK_PRIORITY.indexOf(b.key);
    return (aIdx >= 0 ? aIdx : ODDS_BOOK_PRIORITY.length) - (bIdx >= 0 ? bIdx : ODDS_BOOK_PRIORITY.length);
  });
}

function bestOdds(bookmakers, outcomeName, marketKey) {
  // Use DraftKings-first priority instead of best-price scan
  for (const bk of sortBooksByPriority(bookmakers)) {
    const mkt = bk.markets?.find(m => m.key === marketKey);
    const outcome = mkt?.outcomes?.find(o => o.name === outcomeName);
    if (outcome?.price != null) return outcome.price;
  }
  return null;
}

// Get the market spread from the highest-priority book (DraftKings first).
// Uses name-based matching to get correct away/home assignment.
function marketSpread(bookmakers, awayTeam, homeTeam) {
  for (const bk of sortBooksByPriority(bookmakers)) {
    const mkt = bk.markets?.find(m => m.key === 'spreads');
    if (!mkt) continue;
    const outcomes = mkt.outcomes || [];
    if (outcomes.length < 2) continue;
    // Name-based matching — never rely on array index order
    const awayOut = outcomes.find(o => o.name === awayTeam);
    const homeOut = outcomes.find(o => o.name === homeTeam);
    if (!awayOut || !homeOut) continue;
    if (awayOut.price == null || homeOut.price == null || awayOut.point == null) continue;
    // Reject wildly invalid prices (beyond ±500)
    if (Math.abs(awayOut.price) > 500 || Math.abs(homeOut.price) > 500) continue;
    return {
      awayPoint: awayOut.point, awayPrice: awayOut.price,
      homePoint: homeOut.point, homePrice: homeOut.price,
    };
  }
  return { awayPoint: null, awayPrice: null, homePoint: null, homePrice: null };
}

// Get total line from the highest-priority book (DraftKings first).
function bestTotal(bookmakers) {
  for (const bk of sortBooksByPriority(bookmakers)) {
    const mkt = bk.markets?.find(m => m.key === 'totals');
    if (!mkt) continue;
    const over  = mkt.outcomes?.find(o => o.name === 'Over');
    const under = mkt.outcomes?.find(o => o.name === 'Under');
    if (!over || over.point == null) continue;
    // Reject wildly invalid prices
    if (over.price != null && Math.abs(over.price) > 500) continue;
    return {
      line: over.point,
      overPrice: over.price ?? null,
      underPrice: under?.price ?? null,
    };
  }
  return { line: null, overPrice: null, underPrice: null };
}

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
  const hasApiOdds = books.length > 0;

  const awayML  = bestOdds(books, away, 'h2h');
  const homeML  = bestOdds(books, home, 'h2h');
  const spr     = marketSpread(books, away, home);
  const total   = bestTotal(books);

  const mlStr  = awayML != null && homeML != null ? `ML: ${away?.split(' ')?.pop() || 'TBD'} ${formatOdds(awayML)} / ${home?.split(' ')?.pop() || 'TBD'} ${formatOdds(homeML)}` : '';
  const sprStr = spr.awayPoint != null ? `Spread: ${away?.split(' ')?.pop() || 'TBD'} ${spr.awayPoint > 0 ? '+' : ''}${spr.awayPoint} (${formatOdds(spr.awayPrice)}) / ${home?.split(' ')?.pop() || 'TBD'} ${spr.homePoint > 0 ? '+' : ''}${spr.homePoint} (${formatOdds(spr.homePrice)})` : '';
  const totStr = total.line != null ? `O/U: ${total.line} (O ${formatOdds(total.overPrice)} / U ${formatOdds(total.underPrice)})` : '';
  const oddsStr = [mlStr, sprStr, totStr].filter(Boolean).join(' · ');

  const dateCtx = `[Game date: ${dateLabel}. Today is ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.]\n`;

  if (hasApiOdds && oddsStr) {
    // Odds come from The Odds API (verified premium source) — tell the AI so it
    // skips "verify before betting" disclaimers for these specific numbers.
    const verifiedBlock = `[VERIFIED_ODDS_API]\nVERIFIED ODDS (The Odds API — confirmed live feed, do NOT add verify disclaimers for these numbers):\n${oddsStr}\n`;
    return `${dateCtx}${verifiedBlock}\nRun a full BetOS analysis on ${away} @ ${home} — ${dateLabel}. Cover all three angles — moneyline value, spread edge, and total lean. Give me sharpest line, key angles, and your best pick for each market.`;
  }

  return `${dateCtx}Run a full BetOS analysis on ${away} @ ${home} — ${dateLabel}. ${oddsStr ? oddsStr + '.' : ''} Cover all three angles — moneyline value, spread edge, and total lean. Give me sharpest line, key angles, and your best pick for each market.`;
}

// ── Game Card ─────────────────────────────────────────────────────────────────
function GameOddsRow({ game, expanded, onToggle, onAnalyze }) {
  const books  = game.bookmakers || [];
  const away   = game.away_team;
  const home   = game.home_team;

  const awayML  = bestOdds(books, away, 'h2h');
  const homeML  = bestOdds(books, home, 'h2h');
  const spr     = marketSpread(books, away, home);
  const total   = bestTotal(books);

  const isLive  = isGameLive(game);
  const extreme = isLive && hasExtremeOdds(awayML, homeML);
  const timeLabel = smartTimeLabel(game.commence_time);

  const allBooks = books.filter(bk =>
    bk.markets?.some(m => ['h2h', 'spreads', 'totals'].includes(m.key))
  );

  // Split "City Nickname" → city + nickname
  const awayParts = (away || '').split(' ');
  const awayNick  = awayParts.pop() || 'TBD';
  const awayCity  = awayParts.join(' ');
  const homeParts = (home || '').split(' ');
  const homeNick  = homeParts.pop() || 'TBD';
  const homeCity  = homeParts.join(' ');

  const dimText = '#3e3e3e';
  const colW = { team: '1fr', ml: '72px', spread: '108px', total: '88px' };
  const gridCols = `${colW.team} ${colW.ml} ${colW.spread} ${colW.total}`;

  return (
    <div style={{
      background: '#111',
      border: `1px solid ${isLive ? 'rgba(255,69,96,0.22)' : '#1c1c1c'}`,
      borderRadius: '10px',
      /* overflow:clip instead of hidden — clips visual overflow while still allowing
         inner overflow-x:auto children (expanded book table) to scroll on mobile */
      overflow: 'clip',
    }}>

      {/* ── Card header: time + badges ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '0.45rem 0.9rem',
        background: isLive ? 'rgba(255,69,96,0.05)' : 'rgba(255,255,255,0.015)',
        borderBottom: `1px solid ${isLive ? 'rgba(255,69,96,0.1)' : '#191919'}`,
      }}>
        {isLive && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.1em',
            color: '#FF4560', background: 'rgba(255,69,96,0.14)',
            border: '1px solid rgba(255,69,96,0.35)',
            borderRadius: '3px', padding: '1px 6px',
          }}>
            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#FF4560', display: 'inline-block' }} />
            LIVE
          </span>
        )}
        <span style={{ fontSize: '0.7rem', color: isLive ? 'rgba(255,100,100,0.55)' : '#555' }}>
          {timeLabel}
        </span>
        {game.suspectOdds && (
          <span title="Lines diverge from Pinnacle sharp number — verify before betting" style={{
            fontSize: '0.58rem', fontWeight: 800, color: '#f59e0b',
            background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.28)',
            borderRadius: '3px', padding: '1px 5px', cursor: 'help', whiteSpace: 'nowrap',
          }}>⚠ LINE CHECK</span>
        )}
        {game.pinnacle && !game.suspectOdds && (
          <span style={{ fontSize: '0.62rem', color: '#4ade80', opacity: 0.45 }}>⚡ sharp</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: dimText }}>
          {allBooks.length} book{allBooks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Clickable odds body ── */}
      <div
        onClick={onToggle}
        style={{ cursor: 'pointer', padding: '0.6rem 0.9rem 0' }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.018)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Column labels */}
        <div className="odds-grid-cols" style={{ display: 'grid', gridTemplateColumns: gridCols, marginBottom: '0.35rem' }}>
          <div />
          <div style={{ textAlign: 'center', fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em' }}>ML</div>
          <div style={{ textAlign: 'center', fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Spread</div>
          <div style={{ textAlign: 'center', fontSize: '0.58rem', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            {total.line != null
              ? <><span style={{ color: '#444' }}>O/U </span><span style={{ color: '#FFB800', fontWeight: 700 }}>{total.line}</span></>
              : <span style={{ color: '#444' }}>O/U</span>
            }
          </div>
        </div>

        {/* Away row */}
        <div className="odds-grid-cols" style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center', padding: '0.28rem 0' }}>
          <div className="odds-team-cell" style={{ paddingRight: '8px' }}>
            {awayCity && <div className="odds-team-city" style={{ fontSize: '0.6rem', color: '#555', lineHeight: 1, marginBottom: '1px' }}>{awayCity}</div>}
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: extreme ? '#555' : '#ddd', lineHeight: 1.2 }}>{awayNick}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.92rem', fontWeight: 700, color: extreme ? '#3a3a3a' : oddsColor(awayML) }}>
              {formatOdds(awayML)}
            </span>
          </div>
          <div style={{ textAlign: 'center' }}>
            {spr.awayPoint != null
              ? <span style={{ fontFamily: 'monospace', fontSize: '0.84rem', color: '#bbb' }}>
                  {spr.awayPoint > 0 ? '+' : ''}{spr.awayPoint}
                  <span style={{ color: '#4a4a4a', fontSize: '0.72rem', marginLeft: '3px' }}>({formatOdds(spr.awayPrice)})</span>
                </span>
              : <span style={{ color: '#333', fontFamily: 'monospace' }}>—</span>
            }
          </div>
          <div style={{ textAlign: 'center' }}>
            {total.line != null
              ? <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: oddsColor(total.overPrice) }}>
                  O {formatOdds(total.overPrice)}
                </span>
              : <span style={{ color: '#333', fontFamily: 'monospace' }}>—</span>
            }
          </div>
        </div>

        {/* Row divider */}
        <div style={{ height: '1px', background: '#1a1a1a' }} />

        {/* Home row */}
        <div className="odds-grid-cols" style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center', padding: '0.28rem 0' }}>
          <div className="odds-team-cell" style={{ paddingRight: '8px' }}>
            {homeCity && <div className="odds-team-city" style={{ fontSize: '0.6rem', color: '#555', lineHeight: 1, marginBottom: '1px' }}>{homeCity}</div>}
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: extreme ? '#555' : '#ddd', lineHeight: 1.2 }}>{homeNick}</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontFamily: 'monospace', fontSize: '0.92rem', fontWeight: 700, color: extreme ? '#3a3a3a' : oddsColor(homeML) }}>
              {formatOdds(homeML)}
            </span>
          </div>
          <div style={{ textAlign: 'center' }}>
            {spr.homePoint != null
              ? <span style={{ fontFamily: 'monospace', fontSize: '0.84rem', color: '#bbb' }}>
                  {spr.homePoint > 0 ? '+' : ''}{spr.homePoint}
                  <span style={{ color: '#4a4a4a', fontSize: '0.72rem', marginLeft: '3px' }}>({formatOdds(spr.homePrice)})</span>
                </span>
              : <span style={{ color: '#333', fontFamily: 'monospace' }}>—</span>
            }
          </div>
          <div style={{ textAlign: 'center' }}>
            {total.line != null
              ? <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: oddsColor(total.underPrice) }}>
                  U {formatOdds(total.underPrice)}
                </span>
              : <span style={{ color: '#333', fontFamily: 'monospace' }}>—</span>
            }
          </div>
        </div>

        {/* Expand toggle footer */}
        <div style={{
          borderTop: '1px solid #191919',
          padding: '0.3rem 0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '0.62rem', color: dimText }}>
            {expanded ? 'Hide book comparison' : 'Compare all books'}
          </span>
          <span style={{ color: dimText, fontSize: '0.6rem' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── Expanded: book-by-book breakdown ── */}
      {expanded && (
        <div style={{ background: '#0d0d0d', borderTop: '1px solid #191919', padding: '0.75rem 0.9rem', overflowX: 'auto' }}>

          {extreme && (
            <div style={{
              marginBottom: '0.6rem', padding: '6px 10px',
              background: 'rgba(255,69,96,0.06)', border: '1px solid rgba(255,69,96,0.15)',
              borderRadius: '6px', fontSize: '0.7rem', color: 'rgba(255,100,100,0.7)',
            }}>
              ⚡ Extreme live odds — one team heavily favored. Not reliable for pre-game betting.
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem', minWidth: '500px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #222' }}>
                <th style={{ padding: '4px 8px 4px 0', color: '#444', fontWeight: 600, textAlign: 'left', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Book</th>
                <th colSpan={2} style={{ padding: '4px 8px', color: '#555', fontWeight: 600, textAlign: 'center', fontSize: '0.64rem', textTransform: 'uppercase', borderLeft: '1px solid #222' }}>Moneyline</th>
                <th colSpan={2} style={{ padding: '4px 8px', color: '#555', fontWeight: 600, textAlign: 'center', fontSize: '0.64rem', textTransform: 'uppercase', borderLeft: '1px solid #222' }}>Spread</th>
                <th colSpan={2} style={{ padding: '4px 8px', color: '#555', fontWeight: 600, textAlign: 'center', fontSize: '0.64rem', textTransform: 'uppercase', borderLeft: '1px solid #222' }}>O/U</th>
                <th style={{ padding: '4px 0 4px 8px', color: '#333', fontWeight: 500, textAlign: 'right', fontSize: '0.62rem', textTransform: 'uppercase' }}>Updated</th>
              </tr>
              <tr style={{ borderBottom: '1px solid #1e1e1e' }}>
                <th style={{ padding: '2px 0' }} />
                <th style={{ padding: '2px 8px', color: '#3a3a3a', fontSize: '0.6rem', textAlign: 'center', fontWeight: 500, borderLeft: '1px solid #222' }}>{awayNick}</th>
                <th style={{ padding: '2px 8px', color: '#3a3a3a', fontSize: '0.6rem', textAlign: 'center', fontWeight: 500 }}>{homeNick}</th>
                <th style={{ padding: '2px 8px', color: '#3a3a3a', fontSize: '0.6rem', textAlign: 'center', fontWeight: 500, borderLeft: '1px solid #222' }}>Away</th>
                <th style={{ padding: '2px 8px', color: '#3a3a3a', fontSize: '0.6rem', textAlign: 'center', fontWeight: 500 }}>Home</th>
                <th style={{ padding: '2px 8px', color: '#3a3a3a', fontSize: '0.6rem', textAlign: 'center', fontWeight: 500, borderLeft: '1px solid #222' }}>Over</th>
                <th style={{ padding: '2px 8px', color: '#3a3a3a', fontSize: '0.6rem', textAlign: 'center', fontWeight: 500 }}>Under</th>
                <th style={{ padding: '2px 0' }} />
              </tr>
            </thead>
            <tbody>
              {allBooks.map(bk => {
                const h2h     = bk.markets?.find(m => m.key === 'h2h');
                const spreads = bk.markets?.find(m => m.key === 'spreads');
                const totals  = bk.markets?.find(m => m.key === 'totals');

                const awayMLPrice  = h2h?.outcomes?.find(o => o.name === away)?.price;
                const homeMLPrice  = h2h?.outcomes?.find(o => o.name === home)?.price;

                // Filter out alternate spread lines — if EITHER side's juice is beyond
                // -200/+170, this is not the main market line (e.g. -1.5 at -909 in NBA).
                // Show nothing rather than misleading alt-line data.
                let awaySprOut = spreads?.outcomes?.find(o => o.name === away);
                let homeSprOut = spreads?.outcomes?.find(o => o.name === home);
                const sprJuiceOk = (p) => p != null && p >= -200 && p <= 170;
                if (awaySprOut && homeSprOut && (!sprJuiceOk(awaySprOut.price) || !sprJuiceOk(homeSprOut.price))) {
                  awaySprOut = null;
                  homeSprOut = null;
                }

                // Same for totals — filter out alt total lines with crazy juice
                let overOut  = totals?.outcomes?.find(o => o.name === 'Over');
                let underOut = totals?.outcomes?.find(o => o.name === 'Under');
                if (overOut && underOut && (!sprJuiceOk(overOut.price) || !sprJuiceOk(underOut.price))) {
                  overOut  = null;
                  underOut = null;
                }

                function OddsCell({ price, isBest, point }) {
                  if (price == null) return <td style={{ padding: '5px 8px', textAlign: 'center', color: '#2a2a2a' }}>—</td>;
                  return (
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      {point != null && (
                        <span style={{ color: '#4a4a4a', fontSize: '0.7rem', marginRight: '3px' }}>
                          {point > 0 ? '+' : ''}{point}
                        </span>
                      )}
                      <span style={{
                        color: isBest ? '#000' : oddsColor(price),
                        background: isBest ? '#FFB800' : 'transparent',
                        padding: isBest ? '1px 5px' : '0',
                        borderRadius: isBest ? '3px' : '0',
                        fontWeight: 700, fontFamily: 'monospace', fontSize: '0.8rem',
                      }}>
                        {formatOdds(price)}
                      </span>
                    </td>
                  );
                }

                const isPinnacle = bk.key === 'pinnacle';
                return (
                  <tr key={bk.key} style={{
                    borderBottom: '1px solid #181818',
                    background: isPinnacle ? 'rgba(74,222,128,0.03)' : 'transparent',
                    borderLeft: isPinnacle ? '2px solid rgba(74,222,128,0.35)' : '2px solid transparent',
                  }}>
                    <td style={{ padding: '5px 8px 5px 4px', color: isPinnacle ? '#4ade80' : '#777', fontWeight: isPinnacle ? 700 : 400, whiteSpace: 'nowrap', fontSize: '0.76rem' }}>
                      {BOOK_LABELS[bk.key] || bk.title}
                      {isPinnacle && <span style={{ fontSize: '0.56rem', color: '#4ade80', opacity: 0.6, marginLeft: '4px' }}>sharp ref</span>}
                    </td>
                    <OddsCell price={awayMLPrice} isBest={awayMLPrice === awayML} />
                    <OddsCell price={homeMLPrice} isBest={homeMLPrice === homeML} />
                    <td style={{ padding: '5px 8px', textAlign: 'center', borderLeft: '1px solid #1a1a1a' }}>
                      {awaySprOut?.price != null
                        ? <>
                            <span style={{ color: '#4a4a4a', fontSize: '0.7rem', marginRight: '3px' }}>{awaySprOut.point > 0 ? '+' : ''}{awaySprOut.point}</span>
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.8rem', color: awaySprOut.price === spr.awayPrice ? '#FFB800' : oddsColor(awaySprOut.price), background: awaySprOut.price === spr.awayPrice ? 'rgba(255,184,0,0.1)' : 'transparent', padding: awaySprOut.price === spr.awayPrice ? '1px 4px' : '0', borderRadius: '3px' }}>
                              {formatOdds(awaySprOut.price)}
                            </span>
                          </>
                        : <span style={{ color: '#2a2a2a' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      {homeSprOut?.price != null
                        ? <>
                            <span style={{ color: '#4a4a4a', fontSize: '0.7rem', marginRight: '3px' }}>{homeSprOut.point > 0 ? '+' : ''}{homeSprOut.point}</span>
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.8rem', color: homeSprOut.price === spr.homePrice ? '#FFB800' : oddsColor(homeSprOut.price), background: homeSprOut.price === spr.homePrice ? 'rgba(255,184,0,0.1)' : 'transparent', padding: homeSprOut.price === spr.homePrice ? '1px 4px' : '0', borderRadius: '3px' }}>
                              {formatOdds(homeSprOut.price)}
                            </span>
                          </>
                        : <span style={{ color: '#2a2a2a' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center', borderLeft: '1px solid #1a1a1a' }}>
                      {overOut?.price != null
                        ? <>
                            {overOut.point != null && <span style={{ color: '#4a4a4a', fontSize: '0.7rem', marginRight: '3px' }}>{overOut.point}</span>}
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.8rem', color: overOut.price === total.overPrice ? '#FFB800' : oddsColor(overOut.price), background: overOut.price === total.overPrice ? 'rgba(255,184,0,0.1)' : 'transparent', padding: overOut.price === total.overPrice ? '1px 4px' : '0', borderRadius: '3px' }}>
                              {formatOdds(overOut.price)}
                            </span>
                          </>
                        : <span style={{ color: '#2a2a2a' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                      {underOut?.price != null
                        ? <>
                            {underOut.point != null && <span style={{ color: '#4a4a4a', fontSize: '0.7rem', marginRight: '3px' }}>{underOut.point}</span>}
                            <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: '0.8rem', color: underOut.price === total.underPrice ? '#FFB800' : oddsColor(underOut.price), background: underOut.price === total.underPrice ? 'rgba(255,184,0,0.1)' : 'transparent', padding: underOut.price === total.underPrice ? '1px 4px' : '0', borderRadius: '3px' }}>
                              {formatOdds(underOut.price)}
                            </span>
                          </>
                        : <span style={{ color: '#2a2a2a' }}>—</span>
                      }
                    </td>
                    <td style={{ padding: '5px 0 5px 8px', color: '#333', fontSize: '0.62rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {bk.last_update ? new Date(bk.last_update).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* BetOS analyze */}
          {onAnalyze && (
            <div style={{ marginTop: '0.75rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={e => { e.stopPropagation(); onAnalyze(buildUnifiedPrompt(game)); }}
                style={{
                  padding: '6px 16px', borderRadius: '7px',
                  border: '1px solid rgba(255,184,0,0.35)', background: 'rgba(255,184,0,0.07)',
                  color: '#FFB800', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  fontFamily: 'inherit', transition: 'background 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.16)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,184,0,0.07)'; }}
              >
                🎯 Analyze with BetOS
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Setup Screen ──────────────────────────────────────────────────────────────
function SetupScreen() {
  return (
    <div style={{ maxWidth: '560px', margin: '3rem auto', textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📈</div>
      <h2 style={{ fontWeight: 800, color: '#f0f0f0', marginBottom: '0.5rem' }}>Odds Board</h2>
      <p style={{ color: '#666', marginBottom: '1.5rem', lineHeight: 1.7, fontSize: '0.9rem' }}>
        Pull live lines from FanDuel, DraftKings, and more — all in one place, updated every 3 minutes.
      </p>
      <div className="card" style={{ padding: '1.5rem', textAlign: 'left', marginBottom: '1rem' }}>
        <p style={{ color: '#FFB800', fontWeight: 700, marginBottom: '0.8rem', fontSize: '0.85rem' }}>⚡ Quick Setup (2 min)</p>
        <ol style={{ color: '#777', fontSize: '0.84rem', lineHeight: 2.1, paddingLeft: '1.2rem' }}>
          <li>Go to <a href="https://odds-api.io" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>odds-api.io</a> → Sign up free</li>
          <li>Copy your API key from the dashboard</li>
          <li>Open <code style={{ background: '#1a1a1a', padding: '1px 6px', borderRadius: '3px', color: '#ddd', fontSize: '0.8rem' }}>goatbot-app/.env.local</code></li>
          <li>Add: <code style={{ background: '#1a1a1a', padding: '1px 6px', borderRadius: '3px', color: '#4ade80', fontSize: '0.8rem' }}>ODDS_API_KEY=your-key-here</code></li>
          <li>Restart the server: <code style={{ background: '#1a1a1a', padding: '1px 6px', borderRadius: '3px', color: '#ddd', fontSize: '0.8rem' }}>npm run dev</code></li>
        </ol>
      </div>
      <p style={{ color: '#444', fontSize: '0.74rem' }}>
        Free tier includes FanDuel &amp; DraftKings — with 3-min caching, you&apos;ll have plenty of quota.
      </p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function OddsTab({ onAnalyze, activeSport, onSportChange }) {
  const [sport, setSport]           = useState('mlb');

  // Sync with Dashboard's shared activeSport — only if OddsTab supports it
  useEffect(() => {
    if (activeSport && activeSport !== sport && SPORTS.find(s => s.key === activeSport)) {
      setSport(activeSport);
    }
  }, [activeSport]); // eslint-disable-line react-hooks/exhaustive-deps

  const [games, setGames]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [configured, setConfigured] = useState(true);
  const [expanded, setExpanded]     = useState(null);
  const [remaining, setRemaining]   = useState(null);
  const [search, setSearch]         = useState('');
  const [gameFilter, setGameFilter] = useState('upcoming');
  const [dateOffset, setDateOffset] = useState(0); // -1=yesterday, 0=today, 1=tomorrow

  const load = useCallback(async (s, dateOff = dateOffset, { live = false } = {}) => {
    setLoading(true);
    setError('');
    try {
      const dateParam = dateOff !== 0 ? `&date=${getDateStr(dateOff)}` : '';
      // Pass ?live=1 when in-play games are active — bypasses cache for ~30s fresh odds
      const liveParam = live ? '&live=1' : '';
      const res  = await fetch(`/api/odds?sport=${s}&market=all${dateParam}${liveParam}`);
      const data = await res.json();
      if (data.configured === false) { setConfigured(false); setLoading(false); return; }
      if (data.error) throw new Error(data.message || (typeof data.error === 'string' ? data.error : 'Odds data temporarily unavailable'));
      setConfigured(true);
      const games = data.data || [];
      setGames(games);
      setRemaining(data.remaining ?? null);

      setGameFilter(prev => {
        const hasUpcoming = games.some(g => !isGameLive(g));
        const hasLive     = games.some(g => isGameLive(g));
        if (prev === 'upcoming' && !hasUpcoming && hasLive) return 'live';
        if (prev === 'live' && hasUpcoming) return 'upcoming';
        return prev;
      });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, []);

  // Reset filter + reload on sport change
  useEffect(() => { setGameFilter(dateOffset === 0 ? 'upcoming' : 'all'); load(sport, dateOffset); }, [sport, dateOffset, load]);

  // Auto-refresh live odds every 45s when there are in-progress games
  useEffect(() => {
    const hasLive = games.some(g => isGameLive(g));
    if (!hasLive || dateOffset !== 0) return;
    const interval = setInterval(() => load(sport, dateOffset, { live: true }), 45_000);
    return () => clearInterval(interval);
  }, [games, sport, dateOffset, load]);

  if (!configured) return <SetupScreen />;

  const searchFiltered = games.filter(g =>
    !search ||
    g.home_team.toLowerCase().includes(search.toLowerCase()) ||
    g.away_team.toLowerCase().includes(search.toLowerCase())
  );

  const upcomingGames = searchFiltered
    .filter(g => !isGameLive(g))
    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

  const liveGames = searchFiltered
    .filter(g => isGameLive(g))
    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

  const filtered = gameFilter === 'upcoming' ? upcomingGames
                 : gameFilter === 'live'     ? liveGames
                 : [...liveGames, ...upcomingGames];

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* ── Controls ── */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>

        {/* Sport tabs */}
        <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
          {SPORTS.map(s => (
            <button key={s.key}
              onClick={() => { setSport(s.key); setExpanded(null); onSportChange?.(s.key); }}
              style={{
                padding: '4px 10px', borderRadius: '6px', fontFamily: 'inherit',
                border: `1px solid ${sport === s.key ? '#FFB800' : '#1e1e1e'}`,
                background: sport === s.key ? 'rgba(255,184,0,0.08)' : 'transparent',
                color: sport === s.key ? '#FFB800' : '#555',
                fontWeight: sport === s.key ? 700 : 400, fontSize: '0.78rem', cursor: 'pointer',
                transition: 'all 0.1s',
              }}>
              {s.emoji} {s.label}
            </button>
          ))}
        </div>

        {/* Date nav */}
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center', background: '#111', borderRadius: '6px', padding: '2px' }}>
          <button onClick={() => setDateOffset(d => d - 1)}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '4px 8px', fontSize: '0.78rem', borderRadius: '4px' }}
            onMouseEnter={e => e.currentTarget.style.color = '#FFB800'}
            onMouseLeave={e => e.currentTarget.style.color = '#555'}>
            ‹
          </button>
          <button onClick={() => setDateOffset(0)}
            style={{
              background: dateOffset === 0 ? 'rgba(255,184,0,0.08)' : 'transparent',
              border: dateOffset === 0 ? '1px solid rgba(255,184,0,0.3)' : '1px solid transparent',
              color: dateOffset === 0 ? '#FFB800' : '#888',
              cursor: 'pointer', padding: '4px 12px', fontSize: '0.74rem', fontWeight: 600,
              borderRadius: '4px', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}>
            {getDateLabel(dateOffset)}
          </button>
          <button onClick={() => setDateOffset(d => d + 1)}
            style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '4px 8px', fontSize: '0.78rem', borderRadius: '4px' }}
            onMouseEnter={e => e.currentTarget.style.color = '#FFB800'}
            onMouseLeave={e => e.currentTarget.style.color = '#555'}>
            ›
          </button>
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: '3px' }}>
          {[
            { key: 'upcoming', label: `Pre-game${upcomingGames.length ? ` (${upcomingGames.length})` : ''}` },
            { key: 'live',     label: `Live${liveGames.length ? ` (${liveGames.length})` : ''}` },
            { key: 'all',      label: 'All' },
          ].map(f => (
            <button key={f.key} onClick={() => setGameFilter(f.key)}
              style={{
                padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: '0.74rem', fontWeight: gameFilter === f.key ? 700 : 400,
                border: `1px solid ${gameFilter === f.key
                  ? f.key === 'live' ? 'rgba(255,69,96,0.45)' : 'rgba(255,184,0,0.45)'
                  : '#1e1e1e'}`,
                background: gameFilter === f.key
                  ? f.key === 'live' ? 'rgba(255,69,96,0.08)' : 'rgba(255,184,0,0.06)'
                  : 'transparent',
                color: gameFilter === f.key
                  ? f.key === 'live' ? '#FF4560' : '#FFB800'
                  : '#555',
                transition: 'all 0.1s',
              }}>
              {f.key === 'live' && gameFilter === f.key && (
                <span style={{ display: 'inline-block', width: '5px', height: '5px', borderRadius: '50%', background: '#FF4560', marginRight: '5px', verticalAlign: 'middle' }} />
              )}
              {f.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <input className="input" placeholder="Search team…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '150px', padding: '4px 10px', fontSize: '0.8rem' }} />

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {remaining != null && (
            <span style={{ color: '#3a3a3a', fontSize: '0.7rem' }}>
              {remaining} API req left
            </span>
          )}
          <button onClick={() => load(sport, dateOffset)}
            style={{ background: 'none', border: '1px solid #1e1e1e', borderRadius: '6px', color: '#555', padding: '4px 10px', cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'inherit', transition: 'border-color 0.1s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = '#333'}
            onMouseLeave={e => e.currentTarget.style.borderColor = '#1e1e1e'}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#3a3a3a', fontSize: '0.85rem' }}>
          Loading odds…
        </div>
      ) : error ? (
        <div style={{ padding: '1rem', background: '#1a0a0a', border: '1px solid #3a1a1a', borderRadius: '8px', color: '#f87171', fontSize: '0.84rem' }}>
          ⚠️ {error}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#444', fontSize: '0.85rem' }}>
          {gameFilter === 'upcoming' && liveGames.length > 0
            ? <span>All today&apos;s games are in progress —{' '}
                <button onClick={() => setGameFilter('live')} style={{ color: '#FF4560', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 'inherit', padding: 0 }}>
                  view live
                </button>
              </span>
            : gameFilter === 'live' && upcomingGames.length > 0
            ? <span>No live games right now —{' '}
                <button onClick={() => setGameFilter('upcoming')} style={{ color: '#FFB800', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 'inherit', padding: 0 }}>
                  view upcoming
                </button>
              </span>
            : search
            ? 'No games match your search.'
            : dateOffset !== 0
            ? `No odds data for ${getDateLabel(dateOffset)}. Odds are only available for today's games.`
            : gameFilter === 'upcoming' && games.length > 0
            ? <span>All {sport.toUpperCase()} games today have started or ended.{' '}
                <button onClick={() => setGameFilter('all')} style={{ color: '#FFB800', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 'inherit', padding: 0 }}>
                  View all
                </button>
                {' '}or switch to Live.
              </span>
            : games.length === 0
            ? 'No odds available for this sport today. The API may not have lines posted yet, or the season is off.'
            : 'No lines posted yet for this sport. Try refreshing or check back closer to game time.'
          }
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Summary line */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.72rem', color: '#3a3a3a' }}>
              {filtered.length} game{filtered.length !== 1 ? 's' : ''}
              {gameFilter === 'upcoming' && ' · pre-game'}
              {gameFilter === 'live'     && ' · in-game'}
              {gameFilter === 'all'      && ' · upcoming + live'}
              {' · '}
              <span style={{ color: '#FFB800', opacity: 0.7 }}>gold = best line</span>
            </span>
            <span style={{ fontSize: '0.65rem', color: '#2e2e2e' }}>ML · Spread · O/U</span>
          </div>

          {/* Games grouped by date */}
          {(() => {
            const gamesToShow = gameFilter === 'live' ? liveGames
              : gameFilter === 'upcoming' ? upcomingGames
              : filtered;
            const groups = groupByDate(gamesToShow);
            if (gamesToShow.length === 0) return (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#3a3a3a', fontSize: '0.82rem' }}>
                No {gameFilter === 'live' ? 'live' : gameFilter === 'upcoming' ? 'upcoming' : ''} games matching your filter.
              </div>
            );
            return groups.map((group, gi) => (
              <div key={gi} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {/* Date section header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '0.2rem 0',
                }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#FFB800', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    {group.label}
                  </span>
                  <span style={{ height: '1px', flex: 1, background: 'rgba(255,184,0,0.08)' }} />
                  <span style={{ fontSize: '0.6rem', color: '#2e2e2e' }}>
                    {group.games.length} game{group.games.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Game cards */}
                {group.games.map(game => (
                  <GameOddsRow
                    key={game.id}
                    game={game}
                    expanded={expanded === game.id}
                    onToggle={() => setExpanded(prev => prev === game.id ? null : game.id)}
                    onAnalyze={onAnalyze}
                  />
                ))}
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}