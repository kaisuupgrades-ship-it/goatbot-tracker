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

const ESPN_SPORT_PATHS = {
  mlb:  'baseball/mlb',
  nba:  'basketball/nba',
  nhl:  'hockey/nhl',
  nfl:  'football/nfl',
  mls:  'soccer/usa.1',
  wnba: 'basketball/wnba',
  mma:  'mma/ufc',
};

// Sports that use outright/futures markets instead of head-to-head matchups.
// These are discovered dynamically from odds_cache and processed separately.
const TOURNAMENT_SPORT_PREFIXES = ['golf_', 'tennis_'];
function isTournamentSport(sportKey) {
  return TOURNAMENT_SPORT_PREFIXES.some(p => (sportKey || '').startsWith(p));
}

// Maximum valid American odds price for GAME lines (h2h, spreads, totals).
// Anything outside ±1500 is almost certainly a futures/data-error line leaking into game data.
// Tournament outrights have their own (higher) threshold in buildTournamentOddsString.
const MAX_VALID_PRICE = 1500;

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
  const path = ESPN_SPORT_PATHS[sport];
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

// Build a rich multi-bookmaker odds string from a bookmakers array (shared helper).
// Filters out prices outside ±MAX_VALID_PRICE to prevent futures/garbage lines from
// contaminating game analyses (e.g. Pittsburgh -20000 from a data error in NHL odds).
function buildOddsString(bookmakers) {
  const lines = [];
  for (const book of (bookmakers || []).slice(0, 4)) {
    const bookLines = [];
    for (const market of (book.markets || [])) {
      const outcomes = (market.outcomes || [])
        .filter(o => Math.abs(o.price || 0) <= MAX_VALID_PRICE)
        .map(o =>
          `${o.name} ${o.point != null ? (o.point > 0 ? '+' : '') + o.point : ''} (${o.price > 0 ? '+' : ''}${o.price})`
        ).join(' / ');
      if (outcomes) bookLines.push(`${market.key}: ${outcomes}`);
    }
    if (bookLines.length) lines.push(`${book.title || book.key}: ${bookLines.join(' | ')}`);
  }
  return lines.length ? `LIVE ODDS (from The Odds API cache):\n${lines.join('\n')}` : '';
}

// Build outright winner odds string for tournament sports (golf, tennis).
// Collects player/contestant odds from the outrights market across all bookmakers.
// Outright prices can legitimately be very large (+10000 for longshots) — uses a higher threshold.
function buildTournamentOddsString(rows) {
  const MAX_OUTRIGHT = 50000; // sanity cap for outright odds
  const playerOdds = {}; // player → best (highest/most favorable) odds found

  for (const row of (rows || [])) {
    const bookmakers = row.odds_data?.bookmakers || [];
    for (const book of bookmakers.slice(0, 4)) {
      for (const market of (book.markets || [])) {
        if (!['outrights', 'winner', 'tournament_winner'].includes(market.key)) continue;
        for (const o of (market.outcomes || [])) {
          const price = o.price;
          if (!price || Math.abs(price) > MAX_OUTRIGHT) continue;
          // Keep the best available odds for each player across all books
          if (playerOdds[o.name] === undefined || price > playerOdds[o.name]) {
            playerOdds[o.name] = price;
          }
        }
      }
    }
  }

  const entries = Object.entries(playerOdds);
  if (!entries.length) return '';

  // Sort: favorites first (most negative), then positives ascending
  entries.sort((a, b) => {
    if (a[1] < 0 && b[1] < 0) return a[1] - b[1]; // more negative = bigger fav
    if (a[1] < 0) return -1;
    if (b[1] < 0) return 1;
    return a[1] - b[1];
  });

  const lines = entries.slice(0, 25).map(([name, price]) => `${name}: ${price > 0 ? '+' : ''}${price}`);
  return `OUTRIGHT WINNER ODDS (from The Odds API cache — best available across books):\n${lines.join('\n')}`;
}

// System prompt for tournament (golf, tennis) analyses.
function buildTournamentAnalysisSystem() {
  return `You are BetOS — an elite sharp sports betting intelligence system specialized in tournament outright markets (golf, tennis, etc.).

IMPORTANT: Outright winner odds are ALREADY PROVIDED below — do NOT waste web searches looking for odds or futures prices.

Use web search ONLY for (1-2 searches, stay efficient):
1. Current tournament leaderboard / round scores if the tournament is in progress
2. Recent form for the top 5-8 favorites (last 2-3 events, course/surface stats)
3. Any critical news: withdrawals, injuries, weather forecast for remaining rounds

━━━ TOURNAMENT ANALYSIS FRAMEWORK ━━━

For GOLF tournaments, evaluate:
- Strokes Gained: Total/Off-the-tee/Approach stats vs. the specific course setup
- Course fit: driving distances vs. fairway width, approach distances to greens, rough length
- Recent form: last 3 tournament finishes and current leaderboard position if in-progress
- Motivational factors: major streak, hot form run, course history / past wins
- Weather: wind impact on scoring, temperature effects on ball flight

For TENNIS tournaments, evaluate:
- Surface win rate (hard/clay/grass) this season
- Recent match win rate and retirement/injury risk
- Draw analysis: potential tough quarterfinal/semifinal matchups
- H2H records against likely opponents in draw
- Fatigue from previous rounds or tight tournament schedule

━━━ FAIR VALUE FRAMEWORK FOR OUTRIGHTS ━━━
1. Calculate market-implied probability for each contender
   - If price > 0: implied = 100 / (price + 100)
   - If price < 0: implied = |price| / (|price| + 100)
2. Estimate true probability using form + course fit + situational factors
3. Calculate EDGE = (true_prob − market_implied) × 100
4. Only recommend bets where edge ≥ 3% AND implied probability ≥ 5% (long shots with no edge are lottery tickets, not bets)

━━━ OUTPUT FORMAT — FOLLOW EXACTLY ━━━

=== TOURNAMENT OVERVIEW ===
[Tournament name, current round/status if known, course/venue, key conditions]

=== TOP CONTENDERS ANALYSIS ===
[Top 5-8 players: current odds, implied probability, key strengths/weaknesses for THIS event, 2-3 specific stats or recent results]

=== VALUE PLAYS ===
[2-3 outright/placement bets with genuine edge. For each:
Player name | Bet type (outright/top 5/top 10/top 20/make cut) | Best available odds | Edge% | 2-sentence reasoning]

=== AVOID ===
[1-2 players the market is overrating — specific reason their market-implied probability exceeds your true estimate]

=== BEST PLAY ===
THE PICK: [Player + Bet Type + Odds + Book]
Edge: [X%] | Confidence: [LOW/MEDIUM/HIGH/ELITE] | Edge Score: [X/10]
BetOS Win Probability: Market implied [X%] → BetOS adjusted [Y-Z%]
Unit Sizing: [0.5u–2u — never exceed 2u on a single outright bet due to higher variance]

=== KEY INTELLIGENCE ===
• [Critical course-fit or surface-specific insight]
• [Recent form note or withdrawal/injury risk]
• [Market signal — steam move, sharp action, or notable odds movement]

=== RED FLAGS ===
[Overpriced favorites, GTD injury concerns, unconfirmed participation, field depth warning]

⚠️ ODDS DISCLAIMER: Tournament outright odds shift frequently. Verify current odds on your sportsbook before placing any bets. Futures/outrights carry higher variance than game lines — size accordingly.

Be decisive. Cite specific numbers. Never fabricate stats.`;
}

// User prompt for tournament analyses.
function buildTournamentUserPrompt(sportKey, tournamentName, oddsContext, gameDate) {
  const sportLabel = sportKey.startsWith('golf_') ? 'GOLF' : sportKey.startsWith('tennis_') ? 'TENNIS' : 'TOURNAMENT';
  return `Analyze this ${sportLabel} tournament for ${gameDate}:

TOURNAMENT: ${tournamentName}
SPORT KEY: ${sportKey}
DATE: ${gameDate}

${oddsContext
  ? `KNOWN OUTRIGHT ODDS (pre-fetched from The Odds API cache — use these exact numbers, do NOT search for different prices):\n${oddsContext}`
  : 'No odds pre-fetched — search for current outright prices and leaderboard.'}

Search for: current round/leaderboard if in-progress, recent form and course-specific stats for top 5-8 favorites, any withdrawals or weather conditions impacting scoring.`;
}

// Discover active tournament sport keys in odds_cache for the given ET date.
// Scans for distinct sport values with prefix 'golf_' or 'tennis_'.
async function discoverActiveSports(todayStr) {
  try {
    const { data: rows } = await supabase
      .from('odds_cache')
      .select('sport')
      .in('game_status', ['pre', 'live'])
      .order('sport');
    if (!rows?.length) return [];
    const distinct = [...new Set(rows.map(r => r.sport))];
    return distinct.filter(isTournamentSport);
  } catch (e) {
    console.log('[pregenerate] discoverActiveSports failed:', e.message);
    return [];
  }
}

// Process a single tournament sport (golf, tennis) end-to-end:
// dedup check → odds fetch → AI analysis → DB upsert.
async function processTournamentForDay(sportKey, todayStr, { force = false, isAdmin = false, runId = '', triggerSource = 'cron' } = {}) {
  const { data: rows } = await supabase
    .from('odds_cache')
    .select('home_team, away_team, commence_time, odds_data')
    .eq('sport', sportKey)
    .in('game_status', ['pre', 'live'])
    .order('commence_time');

  if (!rows?.length) {
    console.log(`[pregenerate] Tournament ${sportKey}: no odds_cache rows, skipping`);
    return { skipped: true, reason: 'no-odds', sport: sportKey };
  }

  // Use home_team from the first row as the tournament name (Odds API convention)
  const tournamentName = rows[0].home_team || sportKey;
  const homeTeam = tournamentName;
  const awayTeam = 'Field';

  // Dedup check — skip if a valid (non-empty-odds) analysis exists within 12h
  if (!force) {
    const dedupCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('game_analyses')
      .select('id, updated_at, analysis')
      .eq('sport', sportKey).eq('game_date', todayStr)
      .ilike('home_team', tournamentName)
      .maybeSingle();
    if (existing && existing.updated_at > dedupCutoff) {
      const noOddsMarkers = ['No odds data available', 'ODDS NOT YET AVAILABLE', 'odds not confirmed'];
      if (!noOddsMarkers.some(m => existing.analysis?.includes(m))) {
        const ageMin = Math.round((Date.now() - new Date(existing.updated_at).getTime()) / 60000);
        console.log(`[pregenerate] ⏭ Tournament ${sportKey} — dedup skip (${ageMin}min old)`);
        return { skipped: true, reason: 'dedup', sport: sportKey };
      }
    }
  }

  const oddsContext = buildTournamentOddsString(rows);
  if (!oddsContext && !isAdmin) {
    console.log(`[pregenerate] Tournament ${sportKey}: no valid outright odds, skipping`);
    return { skipped: true, reason: 'no-odds', sport: sportKey };
  }

  const systemPrompt = buildTournamentAnalysisSystem();
  const userPrompt   = buildTournamentUserPrompt(sportKey, tournamentName, oddsContext, todayStr);

  console.log(`[pregenerate] ⚡ Generating tournament analysis: ${tournamentName} (${sportKey})`);
  const t0 = Date.now();
  let result = null;

  // Tier 1: Claude Opus + search
  console.log(`[pregenerate] 🔵 Tournament Tier 1 (claude-opus+search): ${tournamentName}`);
  try {
    const r = await callClaude(systemPrompt, userPrompt, { maxTokens: 2000, timeout: 120_000 });
    if (r) result = { ...r, model_used: 'claude-opus-4-6', provider: 'anthropic', was_fallback: false };
  } catch (e) { console.log(`[pregenerate] Tournament Tier 1 failed: ${e.message}`); }

  // Tier 2: grok-4-1-fast no-search — odds already in prompt, ~15x cheaper than grok-4
  if (!result) {
    console.log(`[pregenerate] 🔵 Tournament Tier 2 (grok-4-1-fast): ${tournamentName}`);
    try {
      const r = await callGrok3(systemPrompt, userPrompt, { model: GROK_FAST_MODEL, maxTokens: 2000, timeout: 60_000 });
      if (r) result = { ...r, model_used: GROK_FAST_MODEL, provider: 'xai', was_fallback: false };
    } catch (e) { console.log(`[pregenerate] Tournament Tier 2 failed: ${e.message}`); }
  }

  // Tier 3: grok-3 no-search — last resort
  if (!result) {
    console.log(`[pregenerate] 🔵 Tournament Tier 3 (grok-3 no-search): ${tournamentName}`);
    try {
      const r = await callGrok3(systemPrompt, userPrompt, { maxTokens: 2000, timeout: 45_000 });
      if (r) result = { ...r, model_used: 'grok-3', provider: 'xai', was_fallback: true };
    } catch (e) { console.log(`[pregenerate] Tournament Tier 3 failed: ${e.message}`); }
  }

  if (!result) {
    console.log(`[pregenerate] ❌ Tournament ${sportKey}: all AI tiers failed`);
    return { error: 'All AI tiers failed', sport: sportKey, homeTeam, awayTeam };
  }

  const latency_ms = Date.now() - t0;

  const { error: upsertErr } = await supabase.from('game_analyses').upsert(
    [{
      sport:         sportKey,
      game_date:     todayStr,
      home_team:     homeTeam,
      away_team:     awayTeam,
      analysis:      result.text,
      model:         'BetOS AI',
      provider:      result.provider,
      was_fallback:  result.was_fallback,
      latency_ms,
      trigger_source: triggerSource,
      run_id:        runId,
      generated_at:  new Date().toISOString(),
      updated_at:    new Date().toISOString(),
    }],
    { onConflict: 'sport,game_date,home_team,away_team', ignoreDuplicates: false }
  );

  if (upsertErr) {
    console.warn(`[pregenerate] Tournament DB save failed for ${sportKey}: ${upsertErr.message}`);
    return { error: upsertErr.message, sport: sportKey, homeTeam, awayTeam };
  }

  console.log(`[pregenerate] ✅ Tournament ${tournamentName} done — model=${result.model_used} latency=${latency_ms}ms`);
  return { success: true, sport: sportKey, homeTeam, awayTeam, model: result.model_used, latency_ms };
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

// ET date formatter — converts a UTC timestamp to YYYY-MM-DD in America/New_York.
// Games that start at e.g. 00:30 UTC (8:30 PM ET the night before) get the correct local date.
const etDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const etTimeFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });

function commenceToEtDate(commence_time) {
  if (!commence_time) return null;
  return etDateFmt.format(new Date(commence_time));
}
function commenceToEtTime(commence_time) {
  if (!commence_time) return '';
  return etTimeFmt.format(new Date(commence_time));
}

// List games from odds_cache table — used as fallback when ESPN returns nothing.
// Returns [{ homeTeam, awayTeam, gameTime, gameDate }] where gameDate is the actual
// ET date of the game (not the run date — e.g. April 11 games when run on April 9).
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
        gameTime: commenceToEtTime(r.commence_time),
        gameDate: commenceToEtDate(r.commence_time),
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
        gameTime: commenceToEtTime(g.commence_time),
        gameDate: commenceToEtDate(g.commence_time),
      }));
  } catch (e) {
    console.log(`[pregenerate] fetchGamesFromOddsCache failed for ${sport}:`, e.message);
    return [];
  }
}

// Fetch ESPN injury data for the two teams in a game.
// Returns a formatted injury report string, or '' if unavailable.
async function fetchInjuryData(sport, homeTeam, awayTeam) {
  const path = ESPN_SPORT_PATHS[sport];
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
async function fetchPlayerProps(/* sport, homeTeam, awayTeam */) {
  // Disabled — re-enable after OddsPapi migration (costs 3-5 credits/game/call).
  return '';
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

// Primary Grok model — fast tier, ~15x cheaper than grok-4 ($0.20/$0.50 vs $3/$15 per MTok)
const GROK_FAST_MODEL = 'grok-4-1-fast-non-reasoning';

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

// xAI chat/completions — used for grok-4-1-fast-non-reasoning (primary) and grok-3 (fallback)
async function callGrok3(systemPrompt, userPrompt, { model = 'grok-3', maxTokens = 2000, timeout = 45_000 } = {}) {
  const xaiKey = (process.env.XAI_API_KEY || '').trim();
  if (!xaiKey) return null;

  const t0 = Date.now();
  const res = await fetch(`${XAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${xaiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) throw new Error(`${model} HTTP ${res.status}`);

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
// Pipeline: Claude Opus+search (240s) → grok-4-1-fast no-search (45s) → grok-4 no-search (45s) → grok-3 no-search (45s)
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
    console.log(`[pregenerate] → Falling to Tier 2 (grok-4-1-fast) for ${awayTeam}@${homeTeam}`);
  }

  // ── Tier 2: grok-4-1-fast no-search (45s) — data pre-injected ────────
  // All odds, injuries, and performance data are already in noSearchPrompt;
  // no web search needed. ~15x cheaper than grok-4 ($0.20/$0.50 vs $3/$15 per MTok).
  console.log(`[pregenerate] 🔵 Tier 2 (grok-4-1-fast) attempting: ${awayTeam}@${homeTeam}`);
  try {
    const result = await callGrok3(noSearchSystem, noSearchPrompt, {
      model: GROK_FAST_MODEL,
      maxTokens: isRefresh ? 400 : 2000,
      timeout: isRefresh ? 25_000 : 45_000,
    });
    if (result) {
      console.log(`[pregenerate] ✅ Tier 2 (grok-4-1-fast) ${awayTeam}@${homeTeam}: ${result.latency}ms`);
      return {
        text: result.text, mode, model: 'BetOS AI', model_used: GROK_FAST_MODEL,
        provider: 'xai', was_fallback: false, latency_ms: result.latency,
        tokens_in: result.tokens_in, tokens_out: result.tokens_out,
        system_prompt: noSearchSystem, user_prompt: noSearchPrompt, prompt_version: PROMPT_VERSION,
      };
    }
    console.log(`[pregenerate] ⚠️ Tier 2 (grok-4-1-fast) returned null for ${awayTeam}@${homeTeam}`);
  } catch (e) {
    console.log(`[pregenerate] ⚠️ Tier 2 (grok-4-1-fast) threw for ${awayTeam}@${homeTeam}: ${e.message}`);
  }
  console.log(`[pregenerate] → Falling to Tier 3 (grok-4 no-search) for ${awayTeam}@${homeTeam}`);

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

/**
 * Process one game end-to-end: dedup check → odds fetch → AI analysis → DB upsert.
 * Called by the dispatcher in single-game mode (each invocation gets its own full budget).
 */
async function processSingleGame({ sport, homeTeam, awayTeam, gameDate, force, isAdmin, runId, triggerSource }) {
  const label = `${awayTeam}@${homeTeam} (${sport.toUpperCase()})`;

  // Guard A: skip if a valid analysis exists within 12h (unless force)
  if (!force) {
    const dedupCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    const { data: existing } = await supabase
      .from('game_analyses')
      .select('id, updated_at, analysis')
      .eq('sport', sport).eq('game_date', gameDate)
      .ilike('home_team', homeTeam).ilike('away_team', awayTeam)
      .maybeSingle();
    if (existing && existing.updated_at > dedupCutoff) {
      const noOddsMarkers = ['No odds data available', 'ODDS NOT YET AVAILABLE', '⚠️ NOTE: Generated without live web search'];
      const cachedHasNoOdds = existing.analysis && noOddsMarkers.some(m => existing.analysis.includes(m));
      if (!cachedHasNoOdds) {
        const ageMin = Math.round((Date.now() - new Date(existing.updated_at).getTime()) / 60000);
        console.log(`[pregenerate] ⏭ ${label} — dedup skip (${ageMin}min old)`);
        return { skipped: true, reason: 'dedup', homeTeam, awayTeam, sport };
      }
    }
  }

  // Odds gate: no analysis without odds lines
  const oddsContext = await fetchCachedOdds(sport, homeTeam, awayTeam);
  if (!oddsContext && !isAdmin) {
    console.log(`[pregenerate] ${label} — no odds, skipping`);
    return { skipped: true, reason: 'no-odds', homeTeam, awayTeam, sport };
  }

  // Fetch performance context, injury data, and player props in parallel
  const [perfContext, injuryData, propsData] = await Promise.all([
    buildPerformanceContext(sport).catch(() => ''),
    fetchInjuryData(sport, homeTeam, awayTeam).catch(() => ''),
    fetchPlayerProps(sport, homeTeam, awayTeam).catch(() => ''),
  ]);

  console.log(`[pregenerate] ⚡ Generating: ${label}`);
  const t0 = Date.now();
  const result = await generateAnalysis(sport, homeTeam, awayTeam, gameDate, oddsContext || '', perfContext, injuryData, propsData, 'full', isAdmin);
  if (!result) throw new Error(`All AI tiers failed for ${label}`);
  const latency_ms = Date.now() - t0;

  // Parse structured fields from output (confM targets Best Play line to avoid Spread section mismatch)
  const pickM = result.text.match(/THE PICK[:\s]+([^\n]{5,200})/i);
  const confM = result.text.match(/Edge:\s*[\d.]+%\s*\|\s*Confidence:\s*(ELITE|HIGH|MEDIUM|LOW)/i);
  const edgeM = result.text.match(/EDGE SCORE[:\s]+(\d+\/\d+|\d+)/i);
  const altM  = result.text.match(/ALTERNATE ANGLES[:\s]+([^\n]{5,300})/i);
  const lineM = result.text.match(/LINE MOVEMENT[:\s]+([^\n]{5,300})/i);
  const unitM = result.text.match(/UNIT SIZING[:\s]+([^\n]{5,200})/i);
  const probM = result.text.match(/BetOS WIN PROBABILITY[:\s]+([^\n]{5,300})/i);

  const { data: upserted, error: upsertErr } = await supabase.from('game_analyses').upsert(
    [{
      sport,
      game_date:        gameDate,
      home_team:        homeTeam,
      away_team:        awayTeam,
      analysis:         result.text,
      model:            result.model,
      provider:         result.provider,
      was_fallback:     result.was_fallback,
      latency_ms:       result.latency_ms,
      tokens_in:        result.tokens_in,
      tokens_out:       result.tokens_out,
      prompt_version:   result.prompt_version,
      trigger_source:   triggerSource,
      run_id:           runId,
      prediction_pick:  pickM?.[1]?.trim() || null,
      prediction_conf:  confM?.[1]?.trim() || null,
      prediction_edge:  edgeM?.[1]?.trim() || null,
      alternate_angles: altM?.[1]?.trim() || null,
      line_movement:    lineM?.[1]?.trim() || null,
      unit_sizing:      unitM?.[1]?.trim() || null,
      win_probability:  probM?.[1]?.trim() || null,
      generated_at:     new Date().toISOString(),
      updated_at:       new Date().toISOString(),
    }],
    { onConflict: 'sport,game_date,home_team,away_team', ignoreDuplicates: false }
  ).select('id').maybeSingle();

  if (upsertErr) throw new Error(`DB save failed: ${upsertErr.message}`);

  // Non-blocking audit log (fire-and-forget)
  supabase.from('analysis_audit_logs').insert([{
    analysis_id:     upserted?.id || null,
    sport,
    game_date:       gameDate,
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

  console.log(`[pregenerate] ✅ ${label} done — model=${result.model_used} latency=${latency_ms}ms`);
  return { success: true, sport, homeTeam, awayTeam, model: result.model_used, latency_ms };
}

export async function GET(req) {
  // Auth check — fail-closed: if CRON_SECRET is not configured, reject with 503
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }
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

  // ── Single-game mode (per-game worker invocations fired by the dispatcher) ──
  // When homeTeam + awayTeam are in the URL, this is a dispatcher child call.
  // Return immediately after processing — bypasses Guard B and the full sport loop.
  const homeTeamParam = params.get('homeTeam');
  const awayTeamParam = params.get('awayTeam');
  if (homeTeamParam && awayTeamParam) {
    const etFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    try {
      const result = await processSingleGame({
        sport:         params.get('sport') || sportFilter || 'mlb',
        homeTeam:      homeTeamParam,
        awayTeam:      awayTeamParam,
        gameDate:      params.get('gameDate') || dateOverride || etFmt.format(new Date()),
        force,
        isAdmin:       force || !!params.get('admin'),
        runId:         params.get('runId') || null,
        triggerSource: params.get('triggerSource') || 'dispatcher',
      });
      return NextResponse.json(result, { status: result.error ? 500 : 200 });
    } catch (e) {
      return NextResponse.json({ error: e.message, homeTeam: homeTeamParam, awayTeam: awayTeamParam }, { status: 500 });
    }
  }

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

    // Write early lock so any concurrent invocation sees a recent run_at and aborts via Guard B.
    // This closes the race window between Guard B passing and the final summary write at the end.
    try {
      await supabase.from('settings').upsert(
        [{ key: 'cron_pregenerate_last_run', value: JSON.stringify({ run_at: new Date().toISOString(), status: 'running' }) }],
        { onConflict: 'key' }
      );
    } catch (e) {
      console.warn('[pregenerate] Early lock write failed (non-fatal):', e.message);
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
  // Maps short sport keys (used internally) → Odds API sport keys (used in API URLs).
  // Golf/tennis tournament sports are discovered dynamically from odds_cache, not listed here.
  const ODDS_SPORT_KEYS = {
    mlb:  'baseball_mlb',
    nba:  'basketball_nba',
    nhl:  'icehockey_nhl',
    nfl:  'americanfootball_nfl',
    mls:  'soccer_usa_mls',
    wnba: 'basketball_wnba',
    mma:  'mma_mixed_martial_arts',
  };

  // Track Odds API event counts per sport — used as a gate to skip sports with 0 active
  // odds lines (prevents phantom analyses, e.g. 24 MLS games on an MLS-free day).
  // Only populated when THE_ODDS_KEY is configured. Values: undefined = unknown (don't gate),
  // 0 = confirmed no events, >0 = confirmed has events.
  const oddsEventCountBySport = {};

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
          oddsEventCountBySport[sk] = freshRows.length; // at least 1 row exists
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
          oddsEventCountBySport[sk] = events.length;
          console.log(`[pregenerate] Odds fallback-fetched for ${sk}: ${events.length} games`);
        } else {
          // API returned a non-200 error — do NOT treat as "no events".
          // Log clearly and let the gate fall back to stale odds_cache data below.
          const errBody = await res.json().catch(() => ({}));
          const statusLabel = res.status === 401 ? '401 Unauthorized (invalid API key)'
            : res.status === 403 ? '403 Forbidden (quota exhausted or key invalid)'
            : res.status === 429 ? '429 Too Many Requests (rate limited)'
            : `HTTP ${res.status}`;
          console.warn(`[pregenerate] ⚠️ Odds API error for ${sk}: ${statusLabel}${errBody?.message ? ` — ${errBody.message}` : ''} — will fall back to stale odds_cache`);
          // Leave oddsEventCountBySport[sk] unset so the gate uses cache fallback path
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
  // All games queued for dispatcher self-calls (filled during sport loop, dispatched after)
  const allGamesToDispatch = [];

  // Filter to a single sport if specified (allows fast per-sport admin calls).
  // Tournament sports (golf_, tennis_) are NOT in ESPN_SPORT_PATHS — they're handled
  // separately by discoverActiveSports() after the main h2h dispatch loop.
  const sportsToProcess = sportFilter
    ? Object.entries(ESPN_SPORT_PATHS).filter(([key]) => key === sportFilter)
    : Object.entries(ESPN_SPORT_PATHS);

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

  for (const [sport, _] of sportsToProcess) {
    sportIndex++;
    await writeProgress(sport, 'running');

    // ── Odds API gate ─────────────────────────────────────────────────────────
    // Before hitting ESPN, verify The Odds API has active events for this sport
    // today. Prevents phantom game analyses (e.g. 24 MLS analyses on a day with
    // zero real MLS games). Applies to all runs — no edge analysis without lines.
    let oddsApiGames = [];
    if (THE_ODDS_KEY && ODDS_SPORT_KEYS[sport]) {
      oddsApiGames = await fetchGamesFromOddsCache(sport);
      if (oddsApiGames.length === 0) {
        // Fresh cache returned nothing. Before skipping, check if STALE cache data
        // exists — if it does, the Odds API likely failed (quota/auth/network) and we
        // should still run analyses rather than silently dropping real games.
        const { data: staleRows } = await supabase
          .from('odds_cache')
          .select('home_team, away_team, commence_time, last_fetched_at')
          .eq('sport', sport)
          .in('game_status', ['pre', 'live'])
          .order('last_fetched_at', { ascending: false })
          .limit(20);

        if (staleRows?.length) {
          const ageMin = Math.round((Date.now() - new Date(staleRows[0].last_fetched_at).getTime()) / 60_000);
          console.warn(`[pregenerate] ⚠️ ${sport.toUpperCase()}: No fresh odds in cache (Odds API likely returned an error). Found ${staleRows.length} stale game(s) aged ${ageMin}min — proceeding with analyses to avoid missing real games`);
          oddsApiGames = staleRows.map(r => ({
            homeTeam: r.home_team,
            awayTeam: r.away_team,
            gameTime: commenceToEtTime(r.commence_time),
            gameDate: commenceToEtDate(r.commence_time),
          }));
        } else {
          // No stale data either — this is a genuine "no games today" for this sport
          console.log(`[pregenerate] ⏭ ${sport.toUpperCase()}: 0 events in odds_cache (fresh or stale) — genuinely no games today, skipping`);
          skipped.push(`${sport}: no-odds-api-events`);
          continue;
        }
      }
      console.log(`[pregenerate] ✅ Odds API gate: ${sport.toUpperCase()} has ${oddsApiGames.length} event(s) with active odds`);
    }

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

    // Helper: apply freshness check and push game onto the queue (or skip if fresh).
    // actualGameDate: the ET calendar date of the game (may differ from todayStr for
    // multi-day odds_cache results — e.g. April 11 games when the cron runs on April 9).
    const enqueueGame = async (homeTeam, awayTeam, oddsContext, gameTime, actualGameDate) => {
      const gameDate = actualGameDate || todayStr;

      // Skip games with no odds data — no value in AI analyzing without lines
      if (!oddsContext) {
        console.log(`[pregenerate] Skipping ${awayTeam} @ ${homeTeam} (${sport.toUpperCase()}) — no odds available yet`);
        skipped.push(`${awayTeam}@${homeTeam} (no-odds)`);
        return;
      }

      let gameMode = 'full';
      if (!force) {
        // Guard A (content-based dedup): skip if a valid analysis already exists within 12h.
        // Uses the actual game date, not the run date, so April 11 analyses don't re-run
        // on every subsequent cron run until April 11.
        const dedupCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
        const { data: existing } = await supabase
          .from('game_analyses')
          .select('id, updated_at, analysis')
          .eq('sport', sport).eq('game_date', gameDate)
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
      gamesToProcess.push({ homeTeam, awayTeam, oddsContext, gameTime, mode: gameMode, gameDate });
    };

    for (const event of events) {
      const comps   = event.competitions?.[0]?.competitors || [];
      const homeComp = comps.find(c => c.homeAway === 'home');
      const awayComp = comps.find(c => c.homeAway === 'away');
      if (!homeComp || !awayComp) continue;

      const homeTeam = homeComp.team?.displayName || homeComp.team?.name || '';
      const awayTeam = awayComp.team?.displayName || awayComp.team?.name || '';
      if (!homeTeam || !awayTeam) continue;

      // Odds API game filter: skip ESPN events not on The Odds API.
      // Catches future/scheduled games ESPN returns that have no active betting market.
      if (THE_ODDS_KEY && oddsApiGames.length > 0) {
        const ht = homeTeam.toLowerCase().split(' ').pop();
        const at = awayTeam.toLowerCase().split(' ').pop();
        const hasOdds = oddsApiGames.some(g =>
          (g.homeTeam || '').toLowerCase().includes(ht) &&
          (g.awayTeam || '').toLowerCase().includes(at)
        );
        if (!hasOdds) {
          console.log(`[pregenerate] ⏭ ${awayTeam} @ ${homeTeam} (${sport.toUpperCase()}) — no matching Odds API event, skipping`);
          skipped.push(`${awayTeam}@${homeTeam} (no-odds-api-match)`);
          continue;
        }
      }

      // Build odds context from The Odds API cache.
      // No ESPN fallback — games without real Odds API odds were already filtered above.
      let oddsContext = await fetchCachedOdds(sport, homeTeam, awayTeam);

      const eventTs = event.competitions?.[0]?.date;
      const gameTime = eventTs ? commenceToEtTime(eventTs) : '';
      // Use the actual ET calendar date of the game (not the run date).
      // Critical for late-night games that cross midnight UTC.
      const eventGameDate = eventTs ? commenceToEtDate(eventTs) : todayStr;

      await enqueueGame(homeTeam, awayTeam, oddsContext, gameTime, eventGameDate);
    }

    // ── Odds API fallback ─────────────────────────────────────────────────────
    // If ESPN returned nothing (timeout, off-schedule, rate-limited) but The Odds
    // API has games pre-warmed in cache, use those. Same source the Odds Board uses.
    if (!events.length && !gamesToProcess.length) {
      const oddsGames = await fetchGamesFromOddsCache(sport);
      if (oddsGames.length) {
        console.log(`[pregenerate] ${sport.toUpperCase()}: ESPN 0 events — falling back to Odds API cache (${oddsGames.length} games)`);
        for (const { homeTeam, awayTeam, gameTime, gameDate: gd } of oddsGames) {
          const oddsContext = await fetchCachedOdds(sport, homeTeam, awayTeam);
          await enqueueGame(homeTeam, awayTeam, oddsContext, gameTime, gd);
        }
      }
    }

    if (!gamesToProcess.length) continue;

    // Cap per sport (admin = 12, cron = 8) before queuing for dispatch
    const cap = isAdmin ? 12 : MAX_GAMES_PER_SPORT;
    if (gamesToProcess.length > cap) {
      console.log(`[pregenerate] ${sport.toUpperCase()}: capping ${gamesToProcess.length} → ${cap} games`);
      gamesToProcess.splice(cap);
    }

    // Queue all games for the parallel dispatcher — each gets its own invocation budget
    for (const g of gamesToProcess) {
      allGamesToDispatch.push({ sport, homeTeam: g.homeTeam, awayTeam: g.awayTeam, gameDate: g.gameDate, triggerSource });
    }
    console.log(`[pregenerate] ${sport.toUpperCase()}: queued ${gamesToProcess.length} game(s) for dispatch`);
  }

  // ── Dispatcher: fire one self-call per game, all in parallel ─────────────────
  // Each child invocation runs processSingleGame() with its own full maxDuration budget
  // instead of sharing a single function's time across all games.
  const selfBase = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://betos.win'}/api/cron/pregenerate-analysis`;
  const cronSecret = process.env.CRON_SECRET || '';
  console.log(`[pregenerate] Dispatching ${allGamesToDispatch.length} game worker(s) in parallel (runId=${runId})`);

  const dispatchResults = await Promise.allSettled(
    allGamesToDispatch.map(({ sport, homeTeam, awayTeam, gameDate: gd, triggerSource: ts }) => {
      const url = new URL(selfBase);
      url.searchParams.set('sport', sport);
      url.searchParams.set('homeTeam', homeTeam);
      url.searchParams.set('awayTeam', awayTeam);
      // Use the actual game date (e.g. 2026-04-11) not the run date (2026-04-09)
      url.searchParams.set('gameDate', gd || todayStr);
      url.searchParams.set('runId', runId);
      url.searchParams.set('triggerSource', ts || 'dispatcher');
      if (force) url.searchParams.set('force', 'true');
      return fetch(url.toString(), {
        headers: { authorization: `Bearer ${cronSecret}` },
        signal: AbortSignal.timeout(400_000), // 400s per game max
      }).then(async r => {
        const json = await r.json().catch(() => ({}));
        if (!r.ok && !json.skipped) throw new Error(json.error || `HTTP ${r.status}`);
        return { sport, homeTeam, awayTeam, ...json };
      });
    })
  );

  for (let i = 0; i < dispatchResults.length; i++) {
    const r = dispatchResults[i];
    const g = allGamesToDispatch[i];
    if (r.status === 'fulfilled') {
      const v = r.value;
      if (v.skipped) skipped.push(`${v.awayTeam || g.awayTeam}@${v.homeTeam || g.homeTeam} (${v.reason || 'skipped'})`);
      else generated.push(`${v.awayTeam || g.awayTeam}@${v.homeTeam || g.homeTeam} (${v.sport?.toUpperCase() || g.sport?.toUpperCase()})`);
    } else {
      errors.push(`${g.awayTeam}@${g.homeTeam} (${g.sport?.toUpperCase()}): ${r.reason?.message || 'dispatch error'}`);
    }
  }

  // ── Tournament sports: golf, tennis ────────────────────────────────────────
  // Discovered dynamically from odds_cache after h2h dispatches complete.
  // sportFilter can be a tournament key (e.g. 'golf_masters_tournament_winner') from
  // an admin per-sport trigger — process it here since it won't be in ESPN_SPORT_PATHS.
  const activeTournamentSports = await discoverActiveSports(todayStr);
  const tournamentsToProcess = sportFilter
    ? (isTournamentSport(sportFilter) ? [sportFilter] : [])
    : activeTournamentSports;

  if (tournamentsToProcess.length) {
    console.log(`[pregenerate] Processing ${tournamentsToProcess.length} tournament sport(s): ${tournamentsToProcess.join(', ')}`);
    const tTriggerSource = isAdmin ? 'admin' : (new Date().getUTCHours() < 14 ? 'cron_8am' : 'cron_4pm');
    for (const tSport of tournamentsToProcess) {
      const tResult = await processTournamentForDay(tSport, todayStr, {
        force, isAdmin, runId, triggerSource: tTriggerSource,
      });
      if (tResult?.success) {
        generated.push(`${tResult.homeTeam} (${tSport.toUpperCase()})`);
      } else if (tResult?.error) {
        errors.push(`${tSport}: ${tResult.error}`);
      } else {
        skipped.push(`${tSport}: tournament-${tResult?.reason || 'unknown'}`);
      }
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
