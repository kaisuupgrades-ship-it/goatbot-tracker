/**
 * /api/cron/pregenerate-analysis
 *
 * Vercel Cron: runs at 8 AM ET and 4 PM ET every day.
 * Fetches all today's games from ESPN (MLB, NHL, NBA, NFL, MLS),
 * generates a full BetOS analysis for each matchup using Grok-4 + web search,
 * and stores the results in the game_analyses table.
 *
 * When users hit the GoatBot Analyzer, it checks this cache first and
 * returns the pre-generated report (~instant) + a quick news-delta check
 * instead of waiting 60–90s for a fresh full analysis.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildPerformanceContext } from '@/lib/feedbackLoop';

export const maxDuration = 800; // 13+ min — admin runs need full time per game

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const XAI_BASE  = 'https://api.x.ai/v1';

const SPORT_PATHS = {
  mlb:  'baseball/mlb',
  nba:  'basketball/nba',
  nhl:  'hockey/nhl',
  nfl:  'football/nfl',
  mls:  'soccer/usa.1',
  wnba: 'basketball/wnba',
};

// ── Player prop fetch constants ───────────────────────────────────────────────
const PROP_SPORT_KEYS = {
  mlb: 'baseball_mlb',
  nba: 'basketball_nba',
  nhl: 'icehockey_nhl',
  nfl: 'americanfootball_nfl',
};
const PROP_MARKETS_FOR_ANALYSIS = {
  nba: 'player_points,player_rebounds,player_assists,player_threes,player_points_rebounds_assists',
  mlb: 'pitcher_strikeouts,batter_hits,batter_total_bases,pitcher_outs',
  nhl: 'player_goals,player_shots_on_goal,player_blocked_shots',
  nfl: 'player_pass_yds,player_rush_yds,player_reception_yds,player_pass_tds',
};
const PROP_MARKET_LABELS = {
  player_pass_yds: 'Passing Yds', player_pass_tds: 'Passing TDs',
  player_rush_yds: 'Rushing Yds', player_rush_tds: 'Rushing TDs',
  player_reception_yds: 'Receiving Yds', player_receptions: 'Receptions',
  player_points: 'Points', player_rebounds: 'Rebounds', player_assists: 'Assists',
  player_threes: '3-Pointers Made', player_points_rebounds_assists: 'Pts+Reb+Ast',
  player_points_rebounds: 'Pts+Reb', player_points_assists: 'Pts+Ast',
  pitcher_strikeouts: 'Strikeouts', pitcher_outs: 'Outs Recorded',
  batter_hits: 'Hits', batter_total_bases: 'Total Bases',
  player_goals: 'Goals', player_shots_on_goal: 'Shots on Goal',
  player_blocked_shots: 'Blocked Shots',
};

// ── Prompt versioning ─────────────────────────────────────────────────────────
// Bump this when you change the system prompt so we can A/B test performance
const PROMPT_VERSION = 'v5.0';

// Build the analysis system prompt. When hasVerifiedOdds=true (odds came from
// The Odds API premium feed), we skip blanket "verify before betting" disclaimers
// since those lines are already confirmed from the live feed.
// propsData=true signals that player prop lines were injected into the user message.
function buildAnalysisSystem(hasVerifiedOdds = false, injuryData = '', propsData = '') {
  const oddsNote = hasVerifiedOdds
    ? `The KNOWN ODDS block below is from The Odds API (verified premium feed). Use those exact numbers — do NOT override them. Label any supplemental web-searched odds as "(web search)".`
    : `If a KNOWN ODDS block is provided, use those numbers as authoritative. Label all web-searched odds as "(web search — verify on your book)".`;

  const disclaimer = hasVerifiedOdds
    ? `✅ ODDS SOURCE: Lines provided by The Odds API (verified premium feed). Always confirm final odds on your sportsbook before placing any bet.`
    : `⚠️ ODDS DISCLAIMER: Lines sourced via AI web search. Always verify current odds on your sportsbook before placing any bets.`;

  const injuryNote = injuryData
    ? `\nESPN INJURY DATA IS ALREADY PROVIDED in the user message — use it for the INJURY IMPACT section. Use web search to confirm GTD statuses and catch any updates from the last 24h.`
    : '';

  const propsNote = propsData
    ? `\nPLAYER PROP LINES ARE PROVIDED in the user message — analyze the top 2-3 highest-edge props in the PLAYER PROPS ANALYSIS section.`
    : `\nNo player prop lines provided — write "Not available" in the PLAYER PROPS ANALYSIS section.`;

  return `You are BetOS — an elite sharp sports betting intelligence system. This analysis is CACHED FOUNDATIONAL INTELLIGENCE that downstream user queries will reference. Build it like a dossier, not a quick take.

IMPORTANT: Odds and weather data are ALREADY PROVIDED below — do NOT waste web searches looking for odds.${injuryNote}${propsNote}

Use web search ONLY for (1-2 searches each, stay efficient):
1. Confirmed starters/lineups for TODAY (starting pitcher, goalie, key scratches)
2. Injury updates from the last 24 hours beyond what ESPN data already provides
3. Recent team form (last 5 games record, notable streaks, situational spots)

${oddsNote}

━━━ SPORT-SPECIFIC ANALYSIS CHECKLISTS ━━━
MLB: Starting pitcher pitch mix vs opponent handedness splits; bullpen usage last 3 days + save situations; park factors (run environment, HR park factor); weather (wind direction/speed, temperature effects on ball flight).
NBA: Pace differential (possessions/game both teams); back-to-back / rest days; key player on/off court splits; playoff seeding implications or load management risk.
NHL: Starting goalie confirmed + save% (season + last 10); expected goals for/against (xGF%); power play % vs penalty kill %; line matchups and physical style clashes.
Soccer/MLS: xG/xGA per 90 both teams; rotation risk (cup/European competition schedule); home/away form splits; key player availability (suspensions, fitness).

━━━ FAIR VALUE FRAMEWORK ━━━
For each bet type you analyze, follow this process:
1. Estimate TRUE win probability based on all available data (NOT derived from posted lines)
2. Convert to fair odds implied by that true probability
3. Compare to best posted market odds
4. Calculate EDGE % = (true_prob − implied_prob_from_posted_line) × 100
5. Only recommend bets where edge ≥ 3%

━━━ DISCIPLINE RULES ━━━
TREND DISCIPLINE: Never cite a trend (e.g. "team is 8-2 ATS at home") without identifying a causal mechanism. Correlation without causation is noise.
MEDIA BIAS GUARD: Heavy public/media attention = more efficient market. Discount public narratives; look for contrarian value.
EV OPTIMIZATION: A +130 underdog with 8% edge beats a -300 favorite with 2% edge every time. Prioritize edge size over outcome certainty.

━━━ OUTPUT FORMAT — FOLLOW EXACTLY, IN THIS ORDER ━━━

=== DATA FRESHNESS ===
Injury data: [source + recency]. Starter confirmation: [confirmed / unconfirmed / web-searched]. Odds source: [The Odds API / web search + timestamp if known].

=== MATCHUP ANALYSIS ===
[Deep sport-specific analysis using the checklist above. Minimum 4-6 specific data points with numbers — pace, splits, pitching matchup, goalie stats, xG, etc.]

=== SITUATIONAL FACTORS ===
[Rest advantage/disadvantage. Travel. Motivation (playoff push, elimination, revenge game). Venue factors. Schedule spots (back-to-back, post-travel, long homestand, lookahead spot).]

=== INJURY IMPACT ===
[Both teams. Schematic impact — how does losing this player change their system or scoring output? Not just names and statuses.]

=== SPREAD ANALYSIS ===
Fair spread: [X]. Posted: [X]. Edge: [X%]. Lean: [team / pass]. Confidence: [LOW/MEDIUM/HIGH/ELITE]. Reasoning: [2-3 sentences with specific stats].

=== MONEYLINE ANALYSIS ===
Fair win probability: [X%] [team]. Fair odds: [X]. Best posted odds: [X @ book]. Edge: [X%]. Lean: [team / pass]. Confidence: [LOW/MEDIUM/HIGH/ELITE].

=== TOTAL ANALYSIS ===
Fair total: [X]. Posted: [X]. Edge: [X%]. Lean: [OVER/UNDER/pass]. Confidence: [LOW/MEDIUM/HIGH/ELITE]. Reasoning: [2-3 sentences with pace, scoring environment, pitcher/goalie matchup data].

=== PLAYER PROPS ANALYSIS ===
[Top 2-3 highest-edge props from the provided lines, each with: player name, stat type, line, lean (Over/Under), edge%, 1-sentence reasoning. If no prop lines provided: "Not available."]

=== BEST PLAY ===
THE PICK: [Team/Total/Player + Bet Type + Odds (source) + Book]
Edge: [X%] | Confidence: [LOW/MEDIUM/HIGH/ELITE] | Edge Score: [X/10]
BetOS Win Probability: Market implied [X%] → BetOS adjusted [Y-Z%]
Unit Sizing: [0.5u–3u] — [brief justification based on edge and confidence]

=== ALTERNATE ANGLES ===
1. [Secondary play — bet type, odds, 1-sentence edge justification]
2. [Secondary play — bet type, odds, 1-sentence edge justification]

=== KEY INTELLIGENCE (FOR DOWNSTREAM QUERIES) ===
• [Most important matchup dynamic or team-specific fact]
• [Confirmed starter / key player status + relevant stats]
• [Injury schematic impact on offense or defense]
• [Market signal — line movement, sharp action, steam moves if found]
• [Situational edge or trap game indicator]
• [Weather or venue factor if relevant to scoring]
• [Historical H2H or system angle with causal mechanism, not just record]

=== RED FLAGS ===
[List any concerns: unconfirmed GTD players, line movement against your lean, heavy public side, edge < 3%, motivational mismatch. If none significant: "No significant red flags."]

${disclaimer}

Be decisive. Cite specific numbers. Never fabricate stats. Build the intelligence layer — not just the pick.`;
}

// No-search fallback system prompt — used when web search version times out.
// All data (odds, weather, ESPN injuries, props) is pre-injected so AI just needs to analyze.
function buildAnalysisSystemNoSearch(injuryData = '', propsData = '') {
  const injuryNote = injuryData
    ? `✅ ESPN injury data is provided in the user message. Use it for the INJURY IMPACT section.`
    : `⚠️ No live injury data available — flag unconfirmed starters as a red flag.`;

  const propsNote = propsData
    ? `Player prop lines are provided in the user message — analyze the top 2-3 highest-edge props in the PLAYER PROPS ANALYSIS section.`
    : `No player prop lines provided — write "Not available" in the PLAYER PROPS ANALYSIS section.`;

  return `You are BetOS — an elite sharp sports betting intelligence system. This analysis is CACHED FOUNDATIONAL INTELLIGENCE that downstream user queries will reference. Build it like a dossier.

ALL DATA IS PROVIDED BELOW — odds, matchup info, ESPN injury report, player prop lines, and any available context. You do NOT have web search. Analyze every piece of provided data deeply.

${injuryNote} ${propsNote}

━━━ SPORT-SPECIFIC ANALYSIS CHECKLISTS ━━━
MLB: SP pitch tendencies vs lineup handedness; bullpen depth and recent workload; park factors; weather impact on ball flight.
NBA: Pace differential (possessions/game); rest/back-to-back disadvantage; on/off splits for stars; playoff seeding implications.
NHL: Goalie save% (season + last 10 games); xGF%; PP% vs PK% matchup; line style clash.
Soccer/MLS: xG/xGA rates per 90; rotation risk from schedule; home/away form splits; key player fitness.

━━━ FAIR VALUE FRAMEWORK ━━━
For each bet type: estimate true win probability from provided data → convert to fair odds → compare to posted → calculate edge%. Only recommend bets where edge ≥ 3%.

━━━ DISCIPLINE RULES ━━━
TREND DISCIPLINE: Never cite a trend without a causal mechanism — correlation is not edge.
MEDIA BIAS GUARD: Heavy public attention = more efficient market, less value available.
EV OPTIMIZATION: High edge at longer odds beats low edge at short odds every time.

━━━ OUTPUT FORMAT — FOLLOW EXACTLY, IN THIS ORDER ━━━

=== DATA FRESHNESS ===
Injury data: [from ESPN provided / not available]. Starter confirmation: [from provided data / unconfirmed — flag below]. Odds source: [The Odds API cache / ESPN fallback].

=== MATCHUP ANALYSIS ===
[Deep sport-specific analysis using the checklist above. Minimum 4-6 specific data points with numbers from the provided data.]

=== SITUATIONAL FACTORS ===
[Rest advantage/disadvantage. Travel. Motivation (playoff push, elimination, revenge game). Venue factors. Schedule spots — derive from available data.]

=== INJURY IMPACT ===
[Both teams. Schematic impact — how does this absence change their system or scoring output? Use the provided ESPN injury data.]

=== SPREAD ANALYSIS ===
Fair spread: [X]. Posted: [X]. Edge: [X%]. Lean: [team / pass]. Confidence: [LOW/MEDIUM/HIGH/ELITE]. Reasoning: [2-3 sentences].

=== MONEYLINE ANALYSIS ===
Fair win probability: [X%]. Fair odds: [X]. Best posted odds: [X]. Edge: [X%]. Lean: [team / pass]. Confidence: [LOW/MEDIUM/HIGH/ELITE].

=== TOTAL ANALYSIS ===
Fair total: [X]. Posted: [X]. Edge: [X%]. Lean: [OVER/UNDER/pass]. Confidence: [LOW/MEDIUM/HIGH/ELITE]. Reasoning: [2-3 sentences with pace, scoring environment data].

=== PLAYER PROPS ANALYSIS ===
[Top 2-3 highest-edge props from the provided lines, each with: player name, stat type, line, lean (Over/Under), edge%, 1-sentence reasoning. If not available: "Not available."]

=== BEST PLAY ===
THE PICK: [Team/Total/Player + Bet Type + Odds (source) + Book]
Edge: [X%] | Confidence: [LOW/MEDIUM/HIGH/ELITE] | Edge Score: [X/10]
BetOS Win Probability: Market implied [X%] → BetOS adjusted [Y-Z%]
Unit Sizing: [0.5u–3u] — [brief justification]

=== ALTERNATE ANGLES ===
1. [Secondary play — bet type, odds, 1-sentence edge justification]
2. [Secondary play — bet type, odds, 1-sentence edge justification]

=== KEY INTELLIGENCE (FOR DOWNSTREAM QUERIES) ===
• [Key matchup dynamic or team-specific fact]
• [Starter / key player status + relevant stats from provided data]
• [Injury schematic impact]
• [Market or odds signal from the provided lines]
• [Situational factor — rest, travel, schedule spot]
• [Additional high-value data point for follow-up queries]

=== RED FLAGS ===
[List concerns: unconfirmed starters (no web search available), thin edges, limited data, conflicting signals. If none: "No significant red flags."]

⚠️ NOTE: Generated without live web search. ${injuryData ? 'ESPN injury data included.' : 'No injury data available.'} Confirm starters and line moves before betting.

Be decisive. Use only the provided data. Never fabricate.`;
}

// includeAll=true: return every game on that date regardless of state (used for
// admin manual runs where the admin picks an explicit date — games may already be
// final, but we still want to cache analyses for them).
// includeAll=false (default, cron runs): only return pre/in-progress games.
async function fetchTodaysGames(sport, dateStr, includeAll = false) {
  const path = SPORT_PATHS[sport];
  if (!path) return [];
  try {
    const res = await fetch(`${ESPN_BASE}/${path}/scoreboard?dates=${dateStr}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15_000), // raised from 8s — ESPN can be slow
    });
    if (!res.ok) {
      console.warn(`[pregenerate] ESPN ${sport} returned ${res.status} for ${dateStr}`);
      return [];
    }
    const data = await res.json();
    const all = data.events || [];

    const filtered = includeAll
      ? all // admin date-pick: include all games (pre, in, post) on that date
      : all.filter(ev => {
          const comp  = ev.competitions?.[0];
          const state = comp?.status?.type?.state;
          if (state === 'pre') return true;
          if (state === 'in' && comp?.date) {
            const started = new Date(comp.date).getTime();
            const elapsed = Date.now() - started;
            return elapsed < 90 * 60 * 1000; // in-progress < 90 min
          }
          return false;
        });

    console.log(`[pregenerate] ESPN ${sport.toUpperCase()} ${dateStr}: ${all.length} total events, ${filtered.length} included (includeAll=${includeAll})`);
    return filtered;
  } catch (e) {
    console.warn(`[pregenerate] ESPN fetch failed for ${sport}:`, e.message);
    return [];
  }
}

// Build a rich multi-bookmaker odds string from a bookmakers array (shared helper)
function buildOddsString(bookmakers) {
  const lines = [];
  for (const book of (bookmakers || []).slice(0, 4)) {
    const bookLines = [];
    for (const market of (book.markets || [])) {
      const outcomes = (market.outcomes || []).map(o =>
        `${o.name} ${o.point != null ? (o.point > 0 ? '+' : '') + o.point : ''} (${o.price > 0 ? '+' : ''}${o.price})`
      ).join(' / ');
      if (outcomes) bookLines.push(`${market.key}: ${outcomes}`);
    }
    if (bookLines.length) lines.push(`${book.title || book.key}: ${bookLines.join(' | ')}`);
  }
  return lines.length ? `LIVE ODDS (from The Odds API cache):\n${lines.join('\n')}` : '';
}

// Fetch cached odds for a specific game — reads from odds_cache table (primary)
// then falls back to the legacy settings table. Returns a formatted odds string.
async function fetchCachedOdds(sport, homeTeam, awayTeam) {
  try {
    const ht = homeTeam.toLowerCase();
    const at = awayTeam.toLowerCase();
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();

    // Primary: per-game odds_cache table (populated by /api/cron/refresh-odds)
    const { data: rows } = await supabase
      .from('odds_cache')
      .select('home_team, away_team, odds_data')
      .eq('sport', sport)
      .gte('last_fetched_at', cutoff);

    if (rows?.length) {
      const row = rows.find(r =>
        r.home_team?.toLowerCase().includes(ht.split(' ').pop()) &&
        r.away_team?.toLowerCase().includes(at.split(' ').pop())
      );
      if (row?.odds_data?.bookmakers?.length) {
        const result = buildOddsString(row.odds_data.bookmakers);
        if (result) return result;
      }
    }

    // Fallback: legacy settings table
    const cacheKey = `odds_cache_${sport}`;
    const { data } = await supabase
      .from('settings').select('value').eq('key', cacheKey).maybeSingle();
    if (!data?.value) return '';
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const odds = parsed.data || parsed;
    if (!Array.isArray(odds)) return '';
    const game = odds.find(g =>
      g.home_team?.toLowerCase().includes(ht.split(' ').pop()) &&
      g.away_team?.toLowerCase().includes(at.split(' ').pop())
    );
    if (!game?.bookmakers?.length) return '';
    return buildOddsString(game.bookmakers);
  } catch (e) {
    console.log(`[pregenerate] odds cache fetch failed for ${sport}:`, e.message);
    return '';
  }
}

// List games from odds_cache table — used as fallback when ESPN returns nothing.
// Returns [{ homeTeam, awayTeam, gameTime }] for each pre/live game in the cache.
async function fetchGamesFromOddsCache(sport) {
  try {
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();

    // Primary: per-game odds_cache table
    const { data: rows } = await supabase
      .from('odds_cache')
      .select('home_team, away_team, commence_time')
      .eq('sport', sport)
      .in('game_status', ['pre', 'live'])
      .gte('last_fetched_at', cutoff)
      .order('commence_time');

    if (rows?.length) {
      return rows.map(r => ({
        homeTeam: r.home_team,
        awayTeam: r.away_team,
        gameTime: r.commence_time
          ? new Date(r.commence_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
          : '',
      }));
    }

    // Fallback: legacy settings table
    const { data } = await supabase
      .from('settings').select('value').eq('key', `odds_cache_${sport}`).maybeSingle();
    if (!data?.value) return [];
    const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    const odds = parsed.data || parsed;
    if (!Array.isArray(odds) || !odds.length) return [];
    return odds
      .filter(g => g.home_team && g.away_team)
      .map(g => ({
        homeTeam: g.home_team,
        awayTeam: g.away_team,
        gameTime: g.commence_time
          ? new Date(g.commence_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
          : '',
      }));
  } catch (e) {
    console.log(`[pregenerate] fetchGamesFromOddsCache failed for ${sport}:`, e.message);
    return [];
  }
}

// Fetch ESPN injury data for the two teams in a game.
// Returns a formatted injury report string, or '' if unavailable.
async function fetchInjuryData(sport, homeTeam, awayTeam) {
  const path = SPORT_PATHS[sport];
  if (!path) return '';
  try {
    const res = await fetch(`${ESPN_BASE}/${path}/injuries`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const items = data.items || [];

    const homeNorm = homeTeam.toLowerCase();
    const awayNorm = awayTeam.toLowerCase();

    const teamInjuries = {};
    for (const item of items) {
      const teamName = item.team?.displayName || item.team?.name || '';
      const teamNorm = teamName.toLowerCase();
      const homeLast = homeNorm.split(' ').pop();
      const awayLast = awayNorm.split(' ').pop();
      const isHome = teamNorm.includes(homeLast) || homeNorm.includes(teamNorm.split(' ').pop());
      const isAway = teamNorm.includes(awayLast) || awayNorm.includes(teamNorm.split(' ').pop());
      if (!isHome && !isAway) continue;

      const displayName = isHome ? homeTeam : awayTeam;
      if (!teamInjuries[displayName]) teamInjuries[displayName] = [];

      for (const injury of (item.injuries || [])) {
        const athlete = injury.athlete?.displayName || 'Unknown';
        const position = injury.athlete?.position?.abbreviation || '';
        const status = injury.status || '';
        const desc = injury.shortComment || injury.longComment || '';
        teamInjuries[displayName].push(
          `- ${athlete}${position ? ` (${position})` : ''} — ${status}${desc ? ': ' + desc : ''}`
        );
      }
    }

    if (!Object.keys(teamInjuries).length) return '';

    const lines = ['## Current Injury Report (from ESPN)'];
    for (const [team, injuries] of Object.entries(teamInjuries)) {
      lines.push(`${team}:`);
      lines.push(...injuries);
    }
    return lines.join('\n');
  } catch (e) {
    console.log(`[pregenerate] ESPN injury fetch failed for ${sport}:`, e.message);
    return '';
  }
}

// Fetch player prop lines from The Odds API for the matching game.
// Uses the odds cache to find the The Odds API event UUID, then calls the props endpoint.
// Returns a formatted string for injection into the AI prompt, or '' on failure.
async function fetchPlayerProps(sport, homeTeam, awayTeam) {
  const THE_ODDS_KEY = (process.env.THE_ODDS_API_KEY || '').trim();
  if (!THE_ODDS_KEY) return '';

  const sportKey = PROP_SPORT_KEYS[sport];
  const markets  = PROP_MARKETS_FOR_ANALYSIS[sport];
  if (!sportKey || !markets) return '';

  try {
    // Step 1: find The Odds API event ID from the pre-warmed odds cache
    const { data: setting } = await supabase
      .from('settings').select('value').eq('key', `odds_cache_${sport}`).maybeSingle();
    if (!setting?.value) return '';

    const parsed = typeof setting.value === 'string' ? JSON.parse(setting.value) : setting.value;
    const odds = parsed.data || parsed;
    if (!Array.isArray(odds)) return '';

    const ht = homeTeam.toLowerCase();
    const at = awayTeam.toLowerCase();
    const game = odds.find(g =>
      g.home_team?.toLowerCase().includes(ht.split(' ').pop()) &&
      g.away_team?.toLowerCase().includes(at.split(' ').pop())
    );
    if (!game?.id) return '';

    // Step 2: fetch props from The Odds API events endpoint
    const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/events/${game.id}/odds`);
    url.searchParams.set('apiKey', THE_ODDS_KEY);
    url.searchParams.set('regions', 'us');
    url.searchParams.set('markets', markets);
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('bookmakers', 'draftkings,fanduel,betmgm');

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return '';

    const data = await res.json();
    const bookmakers = data?.bookmakers || [];
    if (!bookmakers.length) return '';

    // Step 3: collect best lines — DraftKings > FanDuel > BetMGM
    const propMap = new Map();
    const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm'];
    for (const bookKey of [...BOOK_PRIORITY].reverse()) {
      const bk = bookmakers.find(b => b.key === bookKey);
      if (!bk) continue;
      for (const mkt of bk.markets || []) {
        const byPlayer = new Map();
        for (const outcome of mkt.outcomes || []) {
          const player = outcome.description || outcome.name;
          const dir    = outcome.name?.toLowerCase();
          const line   = outcome.point;
          const price  = outcome.price;
          if (!player || line == null || price == null) continue;
          if (!byPlayer.has(player)) byPlayer.set(player, { player, line, overOdds: null, underOdds: null });
          const entry = byPlayer.get(player);
          entry.line = line;
          if (dir === 'over')  entry.overOdds  = price;
          if (dir === 'under') entry.underOdds = price;
        }
        for (const [, d] of byPlayer) {
          propMap.set(`${mkt.key}:${d.player}`, { marketKey: mkt.key, ...d });
        }
      }
    }
    if (!propMap.size) return '';

    // Step 4: format into readable text for AI prompt
    const byMarket = new Map();
    for (const [, p] of propMap) {
      if (!byMarket.has(p.marketKey)) byMarket.set(p.marketKey, []);
      byMarket.get(p.marketKey).push(p);
    }

    const lines = ['PLAYER PROPS (The Odds API — DraftKings/FanDuel/BetMGM):'];
    for (const [mk, players] of byMarket) {
      const label = PROP_MARKET_LABELS[mk] || mk;
      lines.push(`${label}:`);
      for (const p of players.sort((a, b) => a.player.localeCompare(b.player))) {
        const over  = p.overOdds  != null ? `O ${p.line} (${p.overOdds  > 0 ? '+' : ''}${p.overOdds})`  : '';
        const under = p.underOdds != null ? `U ${p.line} (${p.underOdds > 0 ? '+' : ''}${p.underOdds})` : '';
        lines.push(`  ${p.player}: ${[over, under].filter(Boolean).join(' / ')}`);
      }
    }
    return lines.join('\n');
  } catch (e) {
    console.log(`[pregenerate] props fetch failed for ${awayTeam}@${homeTeam}:`, e.message);
    return '';
  }
}

// ── Quick-refresh system prompt (used when a fresh analysis already exists) ───
// Lightweight: web search only, no full re-analysis, cheap on tokens.
const QUICK_REFRESH_SYSTEM = `You are BetOS — a sharp sports analyst performing a quick data refresh on a pre-existing analysis. Do NOT re-write the full analysis. Only check for recent changes that would materially affect the pick.

Search ONLY for:
1. Lineup/starter changes announced in the last 4 hours (confirmed SP, goalie, key injuries)
2. Significant line movement (more than 10 cents ML or 1 point spread since open)
3. Any major news (suspensions, weather upgrades, trade deadline moves)

If nothing significant changed: respond with exactly "NO MATERIAL CHANGE" on the first line, then 1 sentence summary.
If something changed: respond with "UPDATE NEEDED" on the first line, then a revised THE PICK line and 2-sentence explanation.

Keep response under 150 words. Do NOT repeat prior analysis. Be fast and factual.`;

// Maximum games to process per sport per run. Prevents timeout on heavy slates (MLB 15+ games).
const MAX_GAMES_PER_SPORT = 8;

// ── xAI API call helper ───────────────────────────────────────────────────────
async function callGrok(systemPrompt, userPrompt, { useSearch = true, maxTokens = 2000, timeout = 120_000 } = {}) {
  const xaiKey = (process.env.XAI_API_KEY || '').trim();
  if (!xaiKey) return null;

  const t0 = Date.now();
  const body = {
    model: 'grok-4',
    instructions: systemPrompt,
    input: [{ role: 'user', content: userPrompt }],
    max_output_tokens: maxTokens,
  };
  if (useSearch) body.tools = [{ type: 'web_search' }];

  const res = await fetch(`${XAI_BASE}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${xaiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`grok-4 HTTP ${res.status}${errBody ? ': ' + errBody.slice(0, 120) : ''}`);
  }

  const data = await res.json();
  const latency = Date.now() - t0;

  // Log unexpected stop reasons so we can diagnose tier failures
  const stopReason = data.stop_reason || data.choices?.[0]?.finish_reason || 'unknown';
  if (stopReason !== 'end_turn' && stopReason !== 'unknown') {
    console.warn(`[pregenerate] callGrok: stop_reason="${stopReason}" — content types: [${(data.output||[]).flatMap(i=>(i.content||[i])).map(c=>c.type).join(',')}]`);
  }

  // Robust parsing — handles multiple xAI output format variations
  let text = '';
  const output = data.output || [];
  const primaryTexts = output
    .filter(item => item.type === 'message')
    .flatMap(msg => (msg.content || []).filter(c => c.type === 'output_text').map(c => c.text));
  if (primaryTexts.length) {
    text = primaryTexts.join('\n\n').trim();
  } else {
    const anyTexts = output.flatMap(item => {
      if (item.content) return item.content.filter(c => c.text).map(c => c.text);
      if (item.text) return [item.text];
      return [];
    });
    text = anyTexts.join('\n\n').trim();
  }
  if (!text && data.choices?.[0]?.message?.content) text = data.choices[0].message.content.trim();
  if (!text) return null;

  return {
    text, latency,
    tokens_in: data.usage?.input_tokens || null,
    tokens_out: data.usage?.output_tokens || null,
  };
}

// grok-3 via chat/completions — fast, reliable fallback (no web search)
async function callGrok3(systemPrompt, userPrompt, { maxTokens = 2000, timeout = 45_000 } = {}) {
  const xaiKey = (process.env.XAI_API_KEY || '').trim();
  if (!xaiKey) return null;

  const t0 = Date.now();
  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${xaiKey}` },
    body: JSON.stringify({
      model: 'grok-3',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) throw new Error(`grok-3 HTTP ${res.status}`);

  const data = await res.json();
  const latency = Date.now() - t0;
  const text = data.choices?.[0]?.message?.content?.trim() || '';
  if (!text) return null;

  return {
    text, latency,
    tokens_in: data.usage?.prompt_tokens || null,
    tokens_out: data.usage?.completion_tokens || null,
  };
}

// ── Anthropic Claude API call helper ─────────────────────────────────────────
// Claude Opus 4.6 with web_search_20260209 tool — mirrors how goatbot/route.js uses it.
async function callClaude(systemPrompt, userPrompt, { maxTokens = 2000, timeout = 90_000 } = {}) {
  const claudeKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!claudeKey) return null;

  const t0 = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      system: systemPrompt,
      tools: [{ type: 'web_search_20260209' }],
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: maxTokens,
      temperature: 1,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`claude-opus HTTP ${res.status}${errBody ? ': ' + errBody.slice(0, 120) : ''}`);
  }

  const data = await res.json();
  const latency = Date.now() - t0;

  // Log unexpected stop reasons so we can diagnose tier failures
  const claudeStopReason = data.stop_reason || 'unknown';
  if (claudeStopReason !== 'end_turn') {
    console.warn(`[pregenerate] callClaude: stop_reason="${claudeStopReason}" — content types: [${(data.content||[]).map(c=>c.type).join(',')}]`);
  }

  const text = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n\n')
    .trim();
  if (!text) return null;

  return {
    text, latency,
    tokens_in: data.usage?.input_tokens || null,
    tokens_out: data.usage?.output_tokens || null,
  };
}

// ── generateAnalysis ──────────────────────────────────────────────────────────
// Pipeline: Claude Opus+search (240s) → grok-4+search (150s) → grok-4 no-search (45s) → grok-3 no-search (45s)
// adminMode parameter kept for API compatibility but timeouts are now uniform.
async function generateAnalysis(sport, homeTeam, awayTeam, gameDate, oddsContext, performanceContext, injuryData = '', propsData = '', mode = 'full', adminMode = false) {
  const isRefresh = mode === 'refresh';

  const injurySection = injuryData ? `\n${injuryData}` : '';
  const propsSection  = propsData  ? `\n\n${propsData}` : '';

  const userPrompt = isRefresh
    ? `Quick freshness check — ${sport.toUpperCase()} on ${gameDate}: ${awayTeam} @ ${homeTeam}${oddsContext ? `\nCurrent odds reference: ${oddsContext.split('\n')[0]}` : ''}\n\nAny lineup changes, significant line movement, or major news in the last 4 hours?`
    : `Analyze this ${sport.toUpperCase()} matchup on ${gameDate}:

MATCHUP: ${awayTeam} (Away) @ ${homeTeam} (Home)
DATE: ${gameDate}
${oddsContext ? `\nKNOWN ODDS (pre-fetched from The Odds API — use these, do NOT search for odds):\n${oddsContext}` : ''}
${propsSection}
${injurySection}
${performanceContext ? `\nBetOS HISTORICAL PERFORMANCE:\n${performanceContext}` : ''}

Search ONLY for: confirmed starters/lineups, any injury updates beyond the ESPN data above, recent form (last 5 games). Odds are already provided above.`;

  const hasVerifiedOdds = !isRefresh && !!(oddsContext && oddsContext.includes('The Odds API'));

  // Build the no-search prompt once (reused by Tier 3 and Tier 4)
  const noSearchSystem = isRefresh ? QUICK_REFRESH_SYSTEM : buildAnalysisSystemNoSearch(injuryData, propsData);
  const noSearchPrompt = isRefresh ? userPrompt :
    `Analyze this ${sport.toUpperCase()} matchup using ONLY the data provided below:

MATCHUP: ${awayTeam} (Away) @ ${homeTeam} (Home)
DATE: ${gameDate}
${oddsContext ? `\nODDS DATA:\n${oddsContext}` : '\nNo odds data available.'}
${propsSection}
${injurySection}
${performanceContext ? `\nHISTORICAL PERFORMANCE:\n${performanceContext}` : ''}

Produce a complete BetOS analysis using only this data. Note any limitations.`;

  // ── Tier 1: Claude Opus 4.6 + web search (240s) ──────────────────────
  // Primary — mirrors Tier 1 in goatbot/route.js. Proven reliable under batch load.
  if (!isRefresh) {
    console.log(`[pregenerate] 🔵 Tier 1 (claude-opus+search) attempting: ${awayTeam}@${homeTeam}`);
    try {
      const systemPrompt = buildAnalysisSystem(hasVerifiedOdds, injuryData, propsData);
      const result = await callClaude(systemPrompt, userPrompt, {
        maxTokens: 2000,
        timeout: 240_000,
      });
      if (result) {
        console.log(`[pregenerate] ✅ Tier 1 (claude-opus+search) ${awayTeam}@${homeTeam}: ${result.latency}ms`);
        return {
          text: result.text, mode, model: 'BetOS AI', model_used: 'claude-opus-4-6',
          provider: 'anthropic', was_fallback: false, latency_ms: result.latency,
          tokens_in: result.tokens_in, tokens_out: result.tokens_out,
          system_prompt: systemPrompt, user_prompt: userPrompt, prompt_version: PROMPT_VERSION,
        };
      }
      console.log(`[pregenerate] ⚠️ Tier 1 (claude-opus+search) returned null (no text blocks — check stop_reason above) for ${awayTeam}@${homeTeam}`);
    } catch (e) {
      console.log(`[pregenerate] ⚠️ Tier 1 (claude-opus+search) threw for ${awayTeam}@${homeTeam}: ${e.message}`);
    }
    console.log(`[pregenerate] → Falling to Tier 2 (grok-4+search) for ${awayTeam}@${homeTeam}`);
  }

  // ── Tier 2: grok-4 + web search (150s) ───────────────────────────────
  if (!isRefresh) {
    console.log(`[pregenerate] 🔵 Tier 2 (grok-4+search) attempting: ${awayTeam}@${homeTeam}`);
    try {
      const systemPrompt = buildAnalysisSystem(hasVerifiedOdds, injuryData, propsData);
      const result = await callGrok(systemPrompt, userPrompt, {
        useSearch: true,
        maxTokens: 2000,
        timeout: 150_000,
      });
      if (result) {
        console.log(`[pregenerate] ✅ Tier 2 (grok-4+search) ${awayTeam}@${homeTeam}: ${result.latency}ms`);
        return {
          text: result.text, mode, model: 'BetOS AI', model_used: 'grok-4',
          provider: 'xai', was_fallback: false, latency_ms: result.latency,
          tokens_in: result.tokens_in, tokens_out: result.tokens_out,
          system_prompt: systemPrompt, user_prompt: userPrompt, prompt_version: PROMPT_VERSION,
        };
      }
      console.log(`[pregenerate] ⚠️ Tier 2 (grok-4+search) returned null for ${awayTeam}@${homeTeam}`);
    } catch (e) {
      console.log(`[pregenerate] ⚠️ Tier 2 (grok-4+search) threw for ${awayTeam}@${homeTeam}: ${e.message}`);
    }
    console.log(`[pregenerate] → Falling to Tier 3 (grok-4 no-search) for ${awayTeam}@${homeTeam}`);
  }

  // ── Tier 3: grok-4 no-search via Responses API (45s) ─────────────────
  console.log(`[pregenerate] 🔵 Tier 3 (grok-4 no-search) attempting: ${awayTeam}@${homeTeam}`);
  try {
    const result = await callGrok(noSearchSystem, noSearchPrompt, {
      useSearch: false,
      maxTokens: isRefresh ? 400 : 2000,
      timeout: isRefresh ? 25_000 : 45_000,
    });
    if (result) {
      console.log(`[pregenerate] ✅ Tier 3 (grok-4 no-search) ${awayTeam}@${homeTeam}: ${result.latency}ms`);
      return {
        text: result.text, mode, model: 'BetOS AI', model_used: 'grok-4-nosearch',
        provider: 'xai', was_fallback: true, latency_ms: result.latency,
        tokens_in: result.tokens_in, tokens_out: result.tokens_out,
        system_prompt: noSearchSystem, user_prompt: noSearchPrompt, prompt_version: PROMPT_VERSION,
      };
    }
    console.log(`[pregenerate] ⚠️ Tier 3 (grok-4 no-search) returned null for ${awayTeam}@${homeTeam}`);
  } catch (e) {
    console.log(`[pregenerate] ⚠️ Tier 3 (grok-4 no-search) threw for ${awayTeam}@${homeTeam}: ${e.message}`);
  }
  console.log(`[pregenerate] → Falling to Tier 4 (grok-3) for ${awayTeam}@${homeTeam}`);

  // ── Tier 4: grok-3 chat/completions no-search (45s) ──────────────────
  // Fast reliable fallback — much faster than grok-4 Responses API.
  console.log(`[pregenerate] 🔵 Tier 4 (grok-3) attempting: ${awayTeam}@${homeTeam}`);
  try {
    const result = await callGrok3(noSearchSystem, noSearchPrompt, {
      maxTokens: isRefresh ? 400 : 2000,
      timeout: isRefresh ? 20_000 : 45_000,
    });
    if (result) {
      console.log(`[pregenerate] ✅ Tier 4 (grok-3) ${awayTeam}@${homeTeam}: ${result.latency}ms`);
      return {
        text: result.text, mode, model: 'BetOS AI', model_used: 'grok-3',
        provider: 'xai', was_fallback: true, latency_ms: result.latency,
        tokens_in: result.tokens_in, tokens_out: result.tokens_out,
        system_prompt: noSearchSystem, user_prompt: noSearchPrompt, prompt_version: PROMPT_VERSION,
      };
    }
    console.log(`[pregenerate] ⚠️ Tier 4 (grok-3) returned null for ${awayTeam}@${homeTeam}`);
  } catch (e) {
    console.log(`[pregenerate] ⚠️ Tier 4 (grok-3) threw for ${awayTeam}@${homeTeam}: ${e.message}`);
  }

  return null; // all tiers failed
}

export async function GET(req) {
  // Auth check
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check admin-controlled enable flag
  const { data: enabledSetting } = await supabase
    .from('settings').select('value').eq('key', 'cron_pregenerate_enabled').maybeSingle();
  if (enabledSetting?.value === 'false') {
    return NextResponse.json({ skipped: true, reason: 'Disabled by admin' });
  }

  const params   = new URL(req.url).searchParams;
  const force    = params.get('force') === 'true';
  // Optional: filter to a single sport (used by admin per-sport calls to stay within timeout)
  const sportFilter = params.get('sport') || null;
  // Optional: override date (YYYY-MM-DD). Used by admin "Generate for Tomorrow" button.
  const dateOverride = params.get('date') || null;

  // Guard B (time-based cron lock): prevent duplicate runs within 10 minutes.
  // Admin-triggered runs (force, per-sport, or date override) always bypass the lock.
  if (!force && !sportFilter && !dateOverride) {
    try {
      const { data: lockData } = await supabase
        .from('settings').select('value').eq('key', 'cron_pregenerate_last_run').maybeSingle();
      if (lockData?.value) {
        const lastRun = typeof lockData.value === 'string' ? JSON.parse(lockData.value) : lockData.value;
        const lastRunAt = lastRun?.run_at ? new Date(lastRun.run_at).getTime() : 0;
        const msSinceRun = Date.now() - lastRunAt;
        if (msSinceRun < 10 * 60 * 1000) {
          const minsSince = Math.round(msSinceRun / 60000);
          console.log(`[pregenerate] Guard B: aborting — last run was ${minsSince}min ago`);
          return NextResponse.json({ skipped: true, reason: `Cron ran ${minsSince} minute(s) ago — minimum 10 minute gap required`, last_run: lastRun.run_at });
        }
      }
    } catch (e) {
      console.warn('[pregenerate] Guard B check failed (non-fatal):', e.message);
    }
  }

  const started = Date.now();
  // Use ET (America/New_York) for "today" so late-night cron runs don't accidentally
  // process the wrong date. When dateOverride is given (admin buttons), use it directly.
  let todayStr;
  if (dateOverride) {
    todayStr = dateOverride;
  } else {
    const etFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    todayStr = etFormatter.format(new Date()); // YYYY-MM-DD in ET
  }
  const espnDate = todayStr.replace(/-/g, '');
  // Unique run ID groups all analyses from this single cron/admin invocation
  const runId = `run_${todayStr}_${Date.now()}`;

  // Detect admin-triggered runs: manual force, per-sport filter, or date override
  // Admin gets unlimited timeouts and tokens; cron gets budget-conscious limits
  const isAdmin = force || !!sportFilter || !!dateOverride;

  console.log(`[pregenerate-analysis] Starting for ${todayStr}, force=${force}, sport=${sportFilter || 'all'}, admin=${isAdmin}`);

  // Odds cache check: the refresh-odds cron (*/2 * * * *) normally keeps odds_cache fresh.
  // Only call The Odds API directly here as a fallback when the table has no recent data.
  const THE_ODDS_KEY = (process.env.THE_ODDS_API_KEY || '').trim();
  const ODDS_SPORT_KEYS = {
    mlb: 'baseball_mlb', nba: 'basketball_nba', nhl: 'icehockey_nhl',
    nfl: 'americanfootball_nfl', mls: 'soccer_usa_mls', wnba: 'basketball_wnba',
  };
  if (THE_ODDS_KEY) {
    const sportsToPrime = sportFilter ? [sportFilter] : Object.keys(ODDS_SPORT_KEYS);
    for (const sk of sportsToPrime) {
      const oddsKey = ODDS_SPORT_KEYS[sk];
      if (!oddsKey) continue;
      try {
        // Check if odds_cache table already has fresh data for this sport (< 15 min old)
        const freshCutoff = new Date(Date.now() - 15 * 60_000).toISOString();
        const { data: freshRows } = await supabase
          .from('odds_cache')
          .select('game_id')
          .eq('sport', sk)
          .gte('last_fetched_at', freshCutoff)
          .limit(1);

        if (freshRows?.length) {
          console.log(`[pregenerate] Odds already fresh in odds_cache for ${sk} — skipping direct API call`);
          continue;
        }

        // Cache is stale or empty — fetch directly and upsert into odds_cache
        const url = `https://api.the-odds-api.com/v4/sports/${oddsKey}/odds?apiKey=${THE_ODDS_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const events = await res.json();
          const now = new Date().toISOString();
          const rows = events.map(ev => ({
            sport: sk, game_id: ev.id, home_team: ev.home_team, away_team: ev.away_team,
            commence_time: ev.commence_time,
            game_status: new Date(ev.commence_time).getTime() > Date.now() + 120_000 ? 'pre' : 'live',
            odds_data: { bookmakers: ev.bookmakers || [], sport_title: ev.sport_title || '' },
            last_fetched_at: now,
          }));
          await supabase.from('odds_cache').upsert(rows, { onConflict: 'sport,game_id' });
          // Also update legacy settings key for backward compat
          await supabase.from('settings').upsert(
            [{ key: `odds_cache_${sk}`, value: JSON.stringify({ data: events, timestamp: Date.now(), source: 'the-odds-api' }) }],
            { onConflict: 'key' }
          );
          console.log(`[pregenerate] Odds fallback-fetched for ${sk}: ${events.length} games`);
        }
      } catch (e) {
        console.log(`[pregenerate] Odds pre-warm failed for ${sk}:`, e.message);
      }
    }
  }

  const generated = [];
  const refreshed = []; // lightweight quick-refresh runs
  const skipped   = [];
  const errors    = [];

  // Filter to a single sport if specified (allows fast per-sport admin calls)
  const sportsToProcess = sportFilter
    ? Object.entries(SPORT_PATHS).filter(([key]) => key === sportFilter)
    : Object.entries(SPORT_PATHS);

  // Write live progress so the UI can poll status even if the user switches tabs
  const totalSports = sportsToProcess.length;
  let sportIndex = 0;
  async function writeProgress(currentSport, status) {
    try {
      await supabase.from('settings').upsert(
        [{ key: 'pregenerate_progress', value: JSON.stringify({
          status,           // 'running' | 'done'
          current_sport: currentSport,
          sport_index: sportIndex,
          total_sports: totalSports,
          generated: generated.length,
          skipped: skipped.length,
          errors: errors.length,
          started_at: new Date(started).toISOString(),
          updated_at: new Date().toISOString(),
        })}],
        { onConflict: 'key' }
      );
    } catch { /* non-critical */ }
  }

  // Cache performance context per sport (one DB query per sport, not per game)
  const perfContextCache = {};

  for (const [sport, _] of sportsToProcess) {
    sportIndex++;
    await writeProgress(sport, 'running');

    // Build the self-improvement context for this sport (cached)
    if (!perfContextCache[sport]) {
      try {
        perfContextCache[sport] = await buildPerformanceContext(sport);
      } catch (e) {
        console.warn(`[pregenerate] Performance context failed for ${sport}:`, e.message);
        perfContextCache[sport] = '';
      }
    }

    // ── Odds API checkpoint ───────────────────────────────────────────────────
    // Before fetching ESPN data or generating any AI analysis for this sport,
    // verify The Odds API has active events with odds. Skips off-season sports
    // and prevents wasting AI tokens when no bookmaker lines exist.
    const oddsEventsList = await fetchGamesFromOddsCache(sport);
    if (!oddsEventsList.length) {
      console.log(`[pregenerate] ${sport.toUpperCase()}: Odds API checkpoint — no active events with odds, skipping sport`);
      skipped.push(`${sport} (no-active-odds)`);
      continue;
    }
    console.log(`[pregenerate] ${sport.toUpperCase()}: Odds API checkpoint passed — ${oddsEventsList.length} event(s) with odds`);

    // Admin runs (manual force, per-sport, or date override) include ALL game states
    // so the admin can generate analyses regardless of whether games are pre/in/post.
    // Cron-triggered runs only include pre/recently-in-progress games.
    const events = await fetchTodaysGames(sport, espnDate, isAdmin || !!dateOverride);

    // Determine trigger source for audit logging
    const triggerSource = sportFilter
      ? (isAdmin ? 'admin_per_sport' : 'cron_per_sport')
      : params.get('force') === 'true'
        ? 'admin_manual'
        : new Date().getUTCHours() < 14 ? 'cron_8am' : 'cron_4pm';

    // Build list of games that need analysis
    const gamesToProcess = [];

    // Helper: apply freshness check and push game onto the queue (or skip if fresh)
    const enqueueGame = async (homeTeam, awayTeam, oddsContext, gameTime) => {
      // FIX 2: Skip games with no odds data — no value in AI analyzing without lines
      if (!oddsContext) {
        console.log(`[pregenerate] Skipping ${awayTeam} @ ${homeTeam} (${sport.toUpperCase()}) — no odds available yet`);
        skipped.push(`${awayTeam}@${homeTeam} (no-odds)`);
        return;
      }

      let gameMode = 'full';
      if (!force) {
        // Guard A (content-based dedup): skip if a valid analysis already exists within 12h.
        // "Valid" means the analysis doesn't contain no-odds placeholder text.
        // If the cached analysis had no odds but odds are now available, force a full re-run.
        const dedupCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
        const { data: existing } = await supabase
          .from('game_analyses')
          .select('id, updated_at, analysis')
          .eq('sport', sport).eq('game_date', todayStr)
          .ilike('home_team', homeTeam).ilike('away_team', awayTeam)
          .maybeSingle();
        if (existing) {
          const cachedHasNoOdds = existing.analysis && (
            existing.analysis.includes('No odds data available') ||
            existing.analysis.includes('ODDS NOT YET AVAILABLE') ||
            existing.analysis.includes('⚠️ NOTE: Generated without live web search')
          );
          if (existing.updated_at > dedupCutoff) {
            if (!cachedHasNoOdds) {
              const ageMin = Math.round((Date.now() - new Date(existing.updated_at).getTime()) / 60000);
              console.log(`[pregenerate] ⏭ Skipping ${awayTeam}@${homeTeam} (${sport.toUpperCase()}) — valid analysis cached ${ageMin}min ago`);
              skipped.push(`${awayTeam}@${homeTeam}`);
              return;
            }
            if (cachedHasNoOdds && oddsContext) {
              console.log(`[pregenerate] ♻️ Re-queuing ${awayTeam}@${homeTeam} — cached analysis had no odds, odds now available`);
              // gameMode stays 'full'
            }
          }
          // Older than 12h → full re-analysis (gameMode already 'full')
        }
      }
      gamesToProcess.push({ homeTeam, awayTeam, oddsContext, gameTime, mode: gameMode });
    };

    for (const event of events) {
      const comps   = event.competitions?.[0]?.competitors || [];
      const homeComp = comps.find(c => c.homeAway === 'home');
      const awayComp = comps.find(c => c.homeAway === 'away');
      if (!homeComp || !awayComp) continue;

      const homeTeam = homeComp.team?.displayName || homeComp.team?.name || '';
      const awayTeam = awayComp.team?.displayName || awayComp.team?.name || '';
      if (!homeTeam || !awayTeam) continue;

      // Build odds context — prefer rich cached odds from The Odds API,
      // fall back to ESPN's basic spread/total if no cache available
      let oddsContext = await fetchCachedOdds(sport, homeTeam, awayTeam);
      if (!oddsContext) {
        const espnOdds = event.competitions?.[0]?.odds?.[0];
        oddsContext = espnOdds
          ? `Spread: ${espnOdds.details || 'N/A'} | O/U: ${espnOdds.overUnder || 'N/A'}`
          : '';
      }

      const gameTime = event.competitions?.[0]?.date
        ? new Date(event.competitions[0].date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
        : '';

      // Cross-reference: only analyze games present in BOTH ESPN and The Odds API.
      // Prevents wasting AI tokens on games that have no bookmaker lines yet.
      const htLast = homeTeam.toLowerCase().split(' ').pop();
      const atLast = awayTeam.toLowerCase().split(' ').pop();
      const inOddsApi = oddsEventsList.some(r => {
        const rh = (r.homeTeam || '').toLowerCase();
        const ra = (r.awayTeam || '').toLowerCase();
        return rh.includes(htLast) && ra.includes(atLast);
      });
      if (!inOddsApi) {
        console.log(`[pregenerate] Skipping ${awayTeam} @ ${homeTeam} (${sport.toUpperCase()}) — not in Odds API`);
        skipped.push(`${awayTeam}@${homeTeam} (not-in-odds-api)`);
        continue;
      }

      await enqueueGame(homeTeam, awayTeam, oddsContext, gameTime);
    }

    // ── Odds API fallback ─────────────────────────────────────────────────────
    // If ESPN returned nothing (timeout, off-schedule, rate-limited) but The Odds
    // API has games pre-warmed in cache, use those. Same source the Odds Board uses.
    if (!events.length && !gamesToProcess.length) {
      const oddsGames = await fetchGamesFromOddsCache(sport);
      if (oddsGames.length) {
        console.log(`[pregenerate] ${sport.toUpperCase()}: ESPN 0 events — falling back to Odds API cache (${oddsGames.length} games)`);
        for (const { homeTeam, awayTeam, gameTime } of oddsGames) {
          const oddsContext = await fetchCachedOdds(sport, homeTeam, awayTeam);
          await enqueueGame(homeTeam, awayTeam, oddsContext, gameTime);
        }
      }
    }

    if (!gamesToProcess.length) continue;

    // Cap games per sport to avoid timeout: admin = 12 max, cron = 8 max
    const cap = isAdmin ? 12 : MAX_GAMES_PER_SPORT;
    if (gamesToProcess.length > cap) {
      console.log(`[pregenerate] ${sport.toUpperCase()}: capping ${gamesToProcess.length} → ${cap} games this run (admin=${isAdmin})`);
      gamesToProcess.splice(cap);
    }

    // Process 3 games at a time in parallel for both admin and cron.
    // With 90s max per game, 3 parallel = ~90s per batch vs 270s sequential.
    const BATCH_SIZE = 3;
    console.log(`[pregenerate] ${sport.toUpperCase()}: ${gamesToProcess.length} games to process (batch=${BATCH_SIZE}, admin=${isAdmin})`);

    for (let i = 0; i < gamesToProcess.length; i += BATCH_SIZE) {
      const batch = gamesToProcess.slice(i, i + BATCH_SIZE);

      // Safety cutoff: cron stops at 4 min; admin has no cutoff (Vercel maxDuration handles it)
      if (!isAdmin) {
        const elapsed = Date.now() - started;
        if (elapsed > 240_000) { // 4 min
          console.warn(`[pregenerate] Approaching timeout at ${Math.round(elapsed/1000)}s, stopping ${sport} early`);
          for (const g of gamesToProcess.slice(i)) {
            errors.push(`${g.awayTeam}@${g.homeTeam}: timeout cutoff`);
          }
          break;
        }
      }

      // Pre-fetch ESPN injury data and player props for all games in this batch in parallel.
      // Both run once per batch so all fallback tiers have the same enriched data.
      const [injuryDataMap, propsDataMap] = await Promise.all([
        Promise.all(batch.map(({ homeTeam, awayTeam }) =>
          fetchInjuryData(sport, homeTeam, awayTeam).catch(() => '')
        )),
        Promise.all(batch.map(({ homeTeam, awayTeam }) =>
          fetchPlayerProps(sport, homeTeam, awayTeam).catch(() => '')
        )),
      ]);

      const batchResults = await Promise.allSettled(
        batch.map(async ({ homeTeam, awayTeam, oddsContext, gameTime, mode: gameMode }, batchIdx) => {
          const label = `${awayTeam}@${homeTeam} (${sport.toUpperCase()}) [${gameMode}]`;
          console.log(`[pregenerate] ${gameMode === 'refresh' ? '↻ Refreshing' : '⚡ Generating'}: ${label} ${gameTime}`);

          const injuryData = injuryDataMap[batchIdx] || '';
          const propsData  = propsDataMap[batchIdx]  || '';
          if (injuryData) console.log(`[pregenerate] 🏥 Injury data fetched for ${awayTeam}@${homeTeam}`);
          if (propsData)  console.log(`[pregenerate] 🎯 Props data fetched for ${awayTeam}@${homeTeam}`);

          const result = await generateAnalysis(sport, homeTeam, awayTeam, todayStr, oddsContext, perfContextCache[sport], injuryData, propsData, gameMode, isAdmin);
          if (!result) throw new Error('no AI response');

          // Parse structured sections from the richer v2.0 analysis output
          const pickM   = result.text.match(/THE PICK[:\s]+([^\n]{5,200})/i);
          const confM   = result.text.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
          const edgeM   = result.text.match(/EDGE SCORE[:\s]+(\d+\/\d+|\d+)/i);
          const altM    = result.text.match(/ALTERNATE ANGLES[:\s]+([^\n]{5,300})/i);
          const lineM   = result.text.match(/LINE MOVEMENT[:\s]+([^\n]{5,300})/i);
          const unitM   = result.text.match(/UNIT SIZING[:\s]+([^\n]{5,200})/i);
          const probM   = result.text.match(/BetOS WIN PROBABILITY[:\s]+([^\n]{5,300})/i);

          // Upsert into game_analyses table
          const { data: upserted, error: upsertErr } = await supabase.from('game_analyses').upsert(
            [{
              sport,
              game_date:      todayStr,
              home_team:      homeTeam,
              away_team:      awayTeam,
              analysis:       result.text,
              model:          result.model,
              provider:       result.provider,
              was_fallback:   result.was_fallback,
              latency_ms:     result.latency_ms,
              tokens_in:      result.tokens_in,
              tokens_out:     result.tokens_out,
              prompt_version: result.prompt_version,
              trigger_source: triggerSource,
              run_id:         runId,
              prediction_pick: pickM?.[1]?.trim() || null,
              prediction_conf: confM?.[1]?.trim() || null,
              prediction_edge: edgeM?.[1]?.trim() || null,
              alternate_angles: altM?.[1]?.trim() || null,
              line_movement:   lineM?.[1]?.trim() || null,
              unit_sizing:     unitM?.[1]?.trim() || null,
              win_probability: probM?.[1]?.trim() || null,
              generated_at:   new Date().toISOString(),
              updated_at:     new Date().toISOString(),
            }],
            { onConflict: 'sport,game_date,home_team,away_team', ignoreDuplicates: false }
          ).select('id').maybeSingle();

          if (upsertErr) throw new Error(`DB save failed: ${upsertErr.message}`);

          // Write to the detailed audit log
          await supabase.from('analysis_audit_logs').insert([{
            analysis_id:     upserted?.id || null,
            sport,
            game_date:       todayStr,
            home_team:       homeTeam,
            away_team:       awayTeam,
            model_requested: 'claude-opus-4-6',
            model_used:      result.model_used,
            provider:        result.provider,
            was_fallback:    result.was_fallback,
            prompt_version:  result.prompt_version,
            system_prompt:   result.system_prompt,
            user_prompt:     result.user_prompt,
            odds_context:    oddsContext || null,
            espn_game_state: 'pre',
            game_time:       gameTime || null,
            raw_response:    result.text,
            tokens_in:       result.tokens_in,
            tokens_out:      result.tokens_out,
            latency_ms:      result.latency_ms,
            parsed_pick:     pickM?.[1]?.trim() || null,
            parsed_conf:     confM?.[1]?.trim() || null,
            parsed_edge:     edgeM?.[1]?.trim() || null,
            trigger_source:  triggerSource,
            run_id:          runId,
          }]).then(({ error: auditErr }) => {
            if (auditErr) console.warn('[pregenerate] Audit log insert failed:', auditErr.message);
          });

          return { label: `${awayTeam}@${homeTeam} (${sport.toUpperCase()})`, mode: gameMode };
        })
      );

      // Collect results from the parallel batch
      for (let j = 0; j < batchResults.length; j++) {
        const r = batchResults[j];
        const g = batch[j];
        if (r.status === 'fulfilled') {
          if (r.value.mode === 'refresh') refreshed.push(r.value.label);
          else generated.push(r.value.label);
        } else {
          errors.push(`${g.awayTeam}@${g.homeTeam}: ${r.reason?.message || 'unknown error'}`);
        }
      }

      // Update progress after each batch
      await writeProgress(sport, 'running');
    }
  }

  const summary = {
    generated:  generated.length,
    refreshed:  refreshed.length,
    skipped:    skipped.length,
    errors:     errors.length,
    games:      [...generated, ...refreshed],
    error_list: errors,
    duration_ms: Date.now() - started,
    run_at: new Date().toISOString(),
  };

  console.log('[pregenerate-analysis]', summary);

  // Store summary for Admin Panel
  try {
    await supabase.from('settings').upsert(
      [{ key: 'cron_pregenerate_last_run', value: JSON.stringify(summary) }],
      { onConflict: 'key' }
    );
  } catch { /* non-critical */ }

  // Mark progress as done so polling clients know it finished
  await writeProgress('', 'done');

  return NextResponse.json(summary);
}

/**
 * POST /api/cron/pregenerate-analysis
 * Admin-only manual trigger — same logic as GET but authenticated via admin email.
 * Called from the Admin Panel "Pre-Generate Analyses" button.
 */
export async function POST(req) {
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  try {
    const body = await req.json();
    const { userEmail, force = true, sport = null, date = null } = body;
    if (!ADMIN_EMAILS.includes(userEmail?.toLowerCase())) {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }
    // Reuse the same GET logic by constructing a fake request with the cron secret
    const fakeUrl = new URL('http://localhost/api/cron/pregenerate-analysis');
    if (force) fakeUrl.searchParams.set('force', 'true');
    if (sport) fakeUrl.searchParams.set('sport', sport);
    if (date)  fakeUrl.searchParams.set('date', date);
    const fakeReq = new Request(fakeUrl.toString(), {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}` },
    });
    return await GET(fakeReq);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
