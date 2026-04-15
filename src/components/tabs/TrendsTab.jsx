'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { playTick, playAnalysisReady } from '@/lib/sounds';
import { supabase } from '@/lib/supabase';

// ── Scan steps for the fake-but-real animated progress bar ───────────────────
const SCAN_STEPS = [
  { pct: 8,  label: 'Connecting to live data feeds…',      emoji: '🔌' },
  { pct: 22, label: 'Fetching today\'s full game slate…',  emoji: '📅' },
  { pct: 38, label: 'Pulling injury & lineup reports…',    emoji: '🏥' },
  { pct: 52, label: 'Scanning opening vs. current lines…', emoji: '📈' },
  { pct: 65, label: 'Detecting sharp money signals…',      emoji: '⚡' },
  { pct: 78, label: 'Analyzing situational matchups…',     emoji: '🔬' },
  { pct: 90, label: 'Compiling edges & confidence ranks…', emoji: '🧠' },
  { pct: 98, label: 'Finalizing report…',                  emoji: '✅' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtOdds(n) {
  if (n == null) return null;
  return n > 0 ? `+${n}` : `${n}`;
}

function todayStr() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfBadge({ level }) {
  const map = {
    HIGH:   { color: '#4ade80', bg: 'rgba(74,222,128,0.08)',   border: 'rgba(74,222,128,0.2)'   },
    MEDIUM: { color: '#FFB800', bg: 'rgba(255,184,0,0.08)',    border: 'rgba(255,184,0,0.2)'    },
    LOW:    { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)',  border: 'rgba(148,163,184,0.2)'  },
  };
  const s = map[level] || map.MEDIUM;
  return (
    <span style={{
      fontSize: '0.6rem', fontWeight: 700, padding: '2px 7px', borderRadius: '4px',
      color: s.color, background: s.bg, border: `1px solid ${s.border}`,
      letterSpacing: '0.07em', textTransform: 'uppercase',
    }}>{level}</span>
  );
}

// ── Today's Edge Card ─────────────────────────────────────────────────────────
function EdgeCard({ edge, onLog }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card" style={{
      overflow: 'hidden',
      borderColor: edge.confidence === 'HIGH' ? 'rgba(255,184,0,0.2)' : 'var(--border)',
      transition: 'border-color 0.15s',
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ padding: '1rem 1.1rem', cursor: 'pointer', display: 'flex', gap: '0.85rem', alignItems: 'flex-start' }}
      >
        {/* Sport emoji */}
        <div style={{ fontSize: '1.5rem', flexShrink: 0, lineHeight: 1, paddingTop: '2px' }}>{edge.sport_emoji}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Matchup */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: '#f0f0f0', fontSize: '0.95rem' }}>{edge.matchup}</span>
            <ConfBadge level={edge.confidence} />
            {edge.sharp && (
              <span style={{ fontSize: '0.65rem', color: '#FFB800', fontWeight: 700 }}>⚡ SHARP SPOT</span>
            )}
          </div>

          {/* The bet */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <span style={{
              padding: '3px 10px', borderRadius: '5px', fontSize: '0.82rem', fontWeight: 700,
              background: 'rgba(255,184,0,0.12)', border: '1px solid rgba(255,184,0,0.25)', color: '#FFB800',
            }}>
              {edge.pick}
            </span>
            {edge.odds && (
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.88rem', color: '#e0e0e0', fontWeight: 700 }}>
                {fmtOdds(edge.odds)}
              </span>
            )}
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{edge.bet_type}</span>
          </div>

          {/* One-liner reason */}
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', lineHeight: 1.5, margin: 0 }}>
            {edge.reason}
          </p>
        </div>

        <span style={{ color: expanded ? '#FFB800' : '#444', fontSize: '0.75rem', flexShrink: 0, paddingTop: '3px' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '0.9rem 1.1rem', background: '#080808' }}>
          <p style={{ color: '#c0c0c0', fontSize: '0.82rem', lineHeight: 1.7, marginBottom: '1rem' }}>
            {edge.analysis}
          </p>

          {/* Trend stats */}
          {edge.trend_record && (
            <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {[
                ['Historical Record', edge.trend_record],
                ['Trend ROI', edge.trend_roi],
                ['Sample Size', edge.sample_size],
              ].filter(([, v]) => v).map(([label, val]) => (
                <div key={label}>
                  <div style={{ color: '#555', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '2px' }}>{label}</div>
                  <div style={{ color: '#f0f0f0', fontWeight: 700, fontSize: '0.82rem', fontFamily: 'IBM Plex Mono, monospace' }}>{val}</div>
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => onLog(edge)}
            className="btn-gold"
            style={{ fontSize: '0.78rem', padding: '6px 14px' }}
          >
            + Log this pick
          </button>
        </div>
      )}
    </div>
  );
}

// ── Ask the Analyst ────────────────────────────────────────────────────────────
function AskAnalyst({ user }) {
  const [question, setQuestion]   = useState('');
  const [asking, setAsking]       = useState(false);
  const [answer, setAnswer]       = useState(null);
  const [remaining, setRemaining] = useState(null);
  const [error, setError]         = useState('');

  const userId = user?.id || '';

  useEffect(() => {
    if (!userId) { setRemaining(null); return; }
    fetch(`/api/trends?action=usage&userId=${encodeURIComponent(userId)}`)
      .then(r => r.json())
      .then(d => setRemaining(d.remaining ?? null))
      .catch(() => setRemaining(null));
  }, [userId]);

  async function ask() {
    if (!question.trim() || asking || !userId || remaining === 0) return;
    setAsking(true); setError(''); setAnswer(null);
    try {
      const res = await fetch('/api/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, userId }),
      });
      const d = await res.json();
      if (d.error && res.status !== 200) { setError(d.error); }
      else { setAnswer(d.answer); setRemaining(d.remaining ?? null); }
    } catch { setError('Network error — try again.'); }
    setAsking(false);
  }

  const QUICK_Q = [
    'Best MLB home dog spots today?',
    'Which back-to-back spots to fade in NBA?',
    'How does wind affect MLB totals?',
    'Best rest-advantage spots right now?',
  ];

  return (
    <div className="card" style={{ padding: '1.2rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '7px' }}>
          💬 Ask the Analyst
          <span style={{ fontSize: '0.62rem', color: '#60a5fa', fontWeight: 600, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)', padding: '2px 7px', borderRadius: '4px' }}>
            AI-powered
          </span>
        </div>
        {remaining !== null ? (
          <span style={{
            fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: '4px',
            color: remaining > 2 ? '#4ade80' : remaining > 0 ? '#FFB800' : '#f87171',
            background: remaining > 0 ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)',
            border: `1px solid ${remaining > 0 ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)'}`,
          }}>
            {remaining > 0 ? `${remaining} queries left today` : 'Daily limit reached'}
          </span>
        ) : userId ? (
          <span style={{ fontSize: '0.68rem', color: '#888' }}>Usage unknown</span>
        ) : null}
        {!userId && <span style={{ fontSize: '0.7rem', color: '#666' }}>Sign in to use Ask AI</span>}
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.76rem', marginBottom: '0.75rem', lineHeight: 1.5 }}>
        Ask anything — situational edges, matchup angles, line movement, weather impacts, pitching matchups. 5 free queries/day.
      </p>

      {/* Quick pills */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {QUICK_Q.map(q => (
          <button key={q} onClick={() => setQuestion(q)} style={{
            padding: '3px 10px', borderRadius: '20px', fontSize: '0.68rem', cursor: 'pointer',
            border: '1px solid #252525', background: '#111', color: '#888', transition: 'all 0.15s',
          }}
          onMouseOver={e => { e.currentTarget.style.borderColor = '#FFB80066'; e.currentTarget.style.color = '#FFB800'; }}
          onMouseOut={e => { e.currentTarget.style.borderColor = '#252525'; e.currentTarget.style.color = '#888'; }}
          >{q}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <textarea
          className="input"
          placeholder="e.g. Which pitchers have an edge tonight based on recent form?"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }}
          rows={2}
          style={{ flex: 1, resize: 'none', fontSize: '0.85rem' }}
          disabled={!userId || remaining === 0}
        />
        <button
          onClick={ask}
          disabled={asking || !question.trim() || !userId || remaining === 0}
          className="btn-gold"
          style={{ padding: '0 1.2rem', opacity: (!question.trim() || !userId || remaining === 0) ? 0.4 : 1 }}
        >
          {asking ? '…' : 'Ask'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: '0.6rem', padding: '0.5rem 0.75rem', background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px', color: '#f87171', fontSize: '0.78rem' }}>
          {error}
        </div>
      )}

      {answer && (
        <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'linear-gradient(135deg, #0a0e18, #080808)', border: '1px solid rgba(255,184,0,0.15)', borderRadius: '9px' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '0.5rem' }}>
            <span>🤖</span>
            <span style={{ color: '#FFB800', fontWeight: 700, fontSize: '0.78rem' }}>BetOS Analyst</span>
          </div>
          <p style={{ color: '#e0e0e0', fontSize: '0.83rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', margin: 0, overflowWrap: 'break-word', wordBreak: 'break-word' }}>{answer}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function TrendsTab({ picks, user, onNavigateToTracker }) {
  const [edges, setEdges]         = useState([]);
  const [loading, setLoading]     = useState(false);
  const [globalLoading, setGlobalLoading] = useState(true); // true while fetching server-side data
  const [scanned, setScanned]     = useState(false);
  const [error, setError]         = useState('');
  const [sport, setSport]         = useState('all');
  const [logged, setLogged]       = useState(null);
  const [globalEdges, setGlobalEdges] = useState(null); // server pre-generated edges
  const [userScanned, setUserScanned] = useState(false); // true once user runs their own scan

  // Animated progress bar state
  const [scanPct,    setScanPct]    = useState(0);
  const [scanStepIdx, setScanStepIdx] = useState(0);
  const scanAnimRef = useRef(null); // holds setInterval id
  const scanDoneRef = useRef(false); // true when real data is back

  // ── Scan animation helpers ────────────────────────────────────────────────────
  function startScanAnimation() {
    if (scanAnimRef.current) clearInterval(scanAnimRef.current);
    scanDoneRef.current = false;
    setScanPct(SCAN_STEPS[0].pct);
    setScanStepIdx(0);
    playTick();
    let stepIdx = 0;
    scanAnimRef.current = setInterval(() => {
      if (stepIdx < SCAN_STEPS.length - 1) {
        stepIdx++;
        setScanStepIdx(stepIdx);
        setScanPct(SCAN_STEPS[stepIdx].pct);
        playTick();
      } else if (scanDoneRef.current) {
        // Real data is back — snap to 100% and play the ready chime
        clearInterval(scanAnimRef.current);
        scanAnimRef.current = null;
        setScanPct(100);
        playAnalysisReady();
      }
      // Otherwise hold at 98% until data arrives
    }, 600);
  }

  function finishScan() {
    // Signal animation to complete, then hide bar and clear loading after brief pause
    scanDoneRef.current = true;
    setTimeout(() => {
      if (scanAnimRef.current) { clearInterval(scanAnimRef.current); scanAnimRef.current = null; }
      setScanPct(0);
      setScanStepIdx(0);
      setLoading(false);
    }, 750);
  }

  // Per-sport scan cache — keyed by sport key, value = { edges, error }
  // Persists for the life of the browser session (cleared only on full page reload)
  const scanCache = useRef(new Map());

  // On mount: fetch server pre-generated edges immediately — no user action needed
  useEffect(() => {
    setGlobalLoading(true);
    fetch('/api/trends?action=global-edges')
      .then(r => r.json())
      .then(d => {
        if (d.cached && Array.isArray(d.edges) && d.edges.length > 0) {
          setGlobalEdges({ edges: d.edges, pushed_at: d.pushed_at });
          // Always show global edges unless user has already run their own scan
          if (!userScanned) {
            setEdges(d.edges);
            setScanned(true);
          }
        }
      })
      .catch(() => {})
      .finally(() => setGlobalLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const SPORTS = [
    { key: 'all', label: 'All Today' },
    { key: 'mlb', label: '⚾ MLB' },
    { key: 'nba', label: '🏀 NBA' },
    { key: 'nhl', label: '🏒 NHL' },
    { key: 'nfl', label: '🏈 NFL' },
  ];

  const scan = useCallback(async (sportKey = sport, forceRefresh = false) => {
    // Check cache first — skip the whole scan if we already have results
    if (!forceRefresh && scanCache.current.has(sportKey)) {
      const hit = scanCache.current.get(sportKey);
      setEdges(hit.edges);
      setError(hit.error || '');
      setScanned(true);
      setUserScanned(true);
      return;
    }

    startScanAnimation();
    setLoading(true); setError(''); setEdges([]);
    try {
      // Fetch today's games for the selected sport(s)
      const sportsToFetch = sportKey === 'all'
        ? ['mlb', 'nba', 'nhl', 'nfl']
        : [sportKey];

      const today = new Date().toISOString().split('T')[0].replace(/-/g, '');

      // Fetch real odds from The Odds API + ESPN schedule in parallel
      const SPORT_EMOJI = { mlb: '⚾', nba: '🏀', nhl: '🏒', nfl: '🏈' };

      // /api/odds requires a valid session — grab the token once and reuse
      // for every per-sport fan-out below. Demo/unauth users just see empty
      // odds data, which Trends degrades to "ESPN-only" scan.
      const { data: { session } } = await supabase.auth.getSession();
      const oddsHeaders = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : null;

      const [oddsResults, espnResults] = await Promise.all([
        // Real bookmaker odds via our /api/odds route (already caches 3 min)
        Promise.allSettled(
          sportsToFetch.map(async sp => {
            if (!oddsHeaders) return { sport: sp, data: [] };
            try {
              const res = await fetch(`/api/odds?sport=${sp}`, { headers: oddsHeaders });
              if (!res.ok) return { sport: sp, data: [] };
              const d = await res.json();
              return { sport: sp, data: d.data || [] };
            } catch { return { sport: sp, data: [] }; }
          })
        ),
        // ESPN for game schedule + status
        Promise.all(
          sportsToFetch.map(async (sp) => {
            try {
              const res = await fetch(`/api/sports?sport=${sp}&endpoint=scoreboard&date=${today}`);
              if (!res.ok) return { sport: sp, events: [] };
              const data = await res.json();
              return { sport: sp, events: data.events || [] };
            } catch { return { sport: sp, events: [] }; }
          })
        ),
      ]);

      // Build a real-odds lookup keyed by normalized home team name
      const oddsLookup = {};
      for (const r of oddsResults) {
        if (r.status !== 'fulfilled' || !r.value?.data) continue;
        for (const game of r.value.data) {
          const key = (game.home_team || '').toLowerCase().replace(/\s+/g, '_');
          oddsLookup[key] = game;
        }
      }

      function findRealOdds(homeTeam) {
        const key = (homeTeam || '').toLowerCase().replace(/\s+/g, '_');
        if (oddsLookup[key]) return oddsLookup[key];
        // fuzzy: last word match
        const last = homeTeam.split(' ').pop().toLowerCase();
        return Object.values(oddsLookup).find(g =>
          (g.home_team || '').toLowerCase().includes(last)
        ) || null;
      }

      // Build compact game list — use real odds where available, ESPN as fallback
      const gameList = [];
      for (const { sport: sp, events } of espnResults) {
        for (const ev of events.slice(0, 12)) {
          const comp = ev.competitions?.[0];
          if (!comp) continue;
          const teams = comp.competitors || [];
          const home = teams.find(t => t.homeAway === 'home');
          const away = teams.find(t => t.homeAway === 'away');
          if (!home || !away) continue;

          const homeName = home.team?.displayName || home.team?.name || '';
          const awayName = away.team?.displayName  || away.team?.name  || '';

          // Try real odds first
          const real = findRealOdds(homeName);
          const realML  = real?.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h');
          const realSpd = real?.bookmakers?.[0]?.markets?.find(m => m.key === 'spreads');
          const realTot = real?.bookmakers?.[0]?.markets?.find(m => m.key === 'totals');

          const mlHome = realML?.outcomes?.find(o => o.name === homeName)?.price
            ?? null;
          const mlAway = realML?.outcomes?.find(o => o.name === awayName)?.price
            ?? null;

          const sHome = realSpd?.outcomes?.find(o => o.name === homeName);
          const spreadStr = sHome
            ? `${homeName.split(' ').pop()} ${sHome.point >= 0 ? '+' : ''}${sHome.point}`
            : (comp.odds?.[0]?.details || null);

          const overOut  = realTot?.outcomes?.find(o => o.name === 'Over');
          const underOut = realTot?.outcomes?.find(o => o.name === 'Under');
          const total    = overOut?.point ?? comp.odds?.[0]?.overUnder ?? null;
          const overOdds  = overOut?.price  ?? null;
          const underOdds = underOut?.price ?? null;

          // ESPN fallback odds
          const espnOdds = comp.odds?.[0];
          const finalMLHome = mlHome ?? espnOdds?.homeTeamOdds?.moneyLine ?? null;
          const finalMLAway = mlAway ?? espnOdds?.awayTeamOdds?.moneyLine ?? null;

          gameList.push({
            sport:    sp.toUpperCase(),
            emoji:    SPORT_EMOJI[sp] || '🏆',
            matchup:  `${away.team?.abbreviation} @ ${home.team?.abbreviation}`,
            home:     homeName,
            away:     awayName,
            mlHome:   finalMLHome,
            mlAway:   finalMLAway,
            spread:   spreadStr,
            total,
            overOdds,
            underOdds,
            status:   ev.status?.type?.description || 'Scheduled',
          });
        }
      }

      if (gameList.length === 0) {
        const noGamesErr = 'No games found for today. Check back later or try a different sport.';
        scanCache.current.set(sportKey, { edges: [], error: noGamesErr });
        setEdges([]);
        setError(noGamesErr);
        setScanned(true);
        finishScan();
        return;
      }

      // Ask AI to find edges in today's slate
      const prompt = `You are BetOS — a sharp sports betting analyst. Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

Here are today's games with current odds:
${gameList.map(g =>
  `${g.emoji} ${g.sport}: ${g.matchup} (${g.away} @ ${g.home})` +
  (g.mlAway != null ? ` | ML: Away ${g.mlAway > 0 ? '+' : ''}${g.mlAway} / Home ${g.mlHome > 0 ? '+' : ''}${g.mlHome}` : '') +
  (g.spread ? ` | Spread: ${g.spread}` : '') +
  (g.total != null ? ` | Total: ${g.total}` +
    (g.overOdds  != null ? ` (O ${g.overOdds > 0 ? '+' : ''}${g.overOdds}` : '') +
    (g.underOdds != null ? ` / U ${g.underOdds > 0 ? '+' : ''}${g.underOdds})` : (g.overOdds != null ? ')' : '')) : '')
).join('\n')}

Identify the 3-6 BEST situational betting edges from this slate. For each edge, consider:
- Home/away underdog value spots
- Back-to-back fatigue situations
- Rest advantages
- Weather/dome factors for totals
- Pitcher matchup edges (MLB)
- Line value vs market expectation
- Public fade spots (heavy chalk that is overpriced)

Return ONLY a valid JSON array. Each object must have these exact fields:
{
  "matchup": "AWAY @ HOME (short form)",
  "sport": "MLB|NBA|NHL|NFL",
  "sport_emoji": "⚾|🏀|🏒|🏈",
  "pick": "Team name or Over/Under X",
  "bet_type": "Moneyline|Spread|Total (Over)|Total (Under)",
  "odds": <integer American odds or null>,
  "confidence": "HIGH|MEDIUM|LOW",
  "sharp": true|false,
  "reason": "One sentence — the specific edge",
  "analysis": "2-3 sentences of detailed analysis with the why",
  "trend_record": "e.g. 58-42 (58%) ATS last 3 seasons or null",
  "trend_roi": "e.g. +4.2% ROI or null",
  "sample_size": "e.g. n=100, 2022-2024 or null"
}

Return ONLY the JSON array, no other text.`;

      const res = await fetch('/api/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: prompt, userId: user?.id || null, isEdgeScan: true }),
      });

      // Handle non-OK HTTP responses safely
      if (!res.ok) {
        let errMsg = `Server error (${res.status})`;
        try { const e = await res.json(); errMsg = e.error || errMsg; } catch {}
        setError(errMsg);
        setScanned(true);
        finishScan();
        return;
      }

      const data = await res.json();

      if (data.error && !data.answer) {
        setError(data.error);
        setScanned(true);
        finishScan();
        return;
      }

      const raw = data.answer || '';
      const cleaned = raw.replace(/^```json\n?/, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();

      // Validate it actually looks like a JSON array before parsing
      if (!cleaned.startsWith('[')) {
        setError('AI returned an unexpected response. Please try scanning again.');
        setScanned(true);
        finishScan();
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        setError('Could not parse AI response. Please try scanning again.');
        setScanned(true);
        finishScan();
        return;
      }

      const resultEdges = Array.isArray(parsed) ? parsed : [];
      scanCache.current.set(sportKey, { edges: resultEdges, error: '' });
      setEdges(resultEdges);
      setScanned(true);
      setUserScanned(true); // mark that this is user's own scan (not admin cache)
    } catch (err) {
      setError(`Scan failed — network or server error. Try again in a moment.`);
      setScanned(true);
    }
    finishScan();
  }, [sport, user]);

  function handleLog(edge) {
    setLogged(edge.pick);
    setTimeout(() => setLogged(null), 3000);
    if (onNavigateToTracker) onNavigateToTracker();
  }

  const filtered = sport === 'all'
    ? edges
    : edges.filter(e => e.sport === sport.toUpperCase());

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Toast */}
      {logged && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999,
          padding: '0.75rem 1.25rem', background: '#1a1200', border: '1px solid #FFB80066',
          borderRadius: '10px', color: '#FFB800', fontWeight: 700, fontSize: '0.85rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          ✓ Opening My Picks — log: "{logged.substring(0, 35)}{logged.length > 35 ? '…' : ''}"
        </div>
      )}

      {/* Header */}
      <div style={{
        padding: '1.1rem 1.3rem',
        background: 'linear-gradient(135deg, #0a0a14 0%, #100e08 100%)',
        border: '1px solid rgba(255,184,0,0.15)', borderRadius: '12px',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '1.1rem' }}>⚡</span>
            <span style={{ fontWeight: 800, color: '#FFB800', fontSize: '1rem' }}>Today's Edges</span>
            <span style={{ fontSize: '0.62rem', color: '#555', background: '#111', border: '1px solid #222', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
              {todayStr()}
            </span>
            {/* Server-generated badge — shown when BetOS pre-loaded today's analysis */}
            {globalEdges && !userScanned && (
              <span style={{
                fontSize: '0.6rem', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
                color: '#4ade80', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
                letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80', animation: 'pulse 2s infinite' }} />
                LIVE · BetOS AI
              </span>
            )}
            {userScanned && (
              <span style={{
                fontSize: '0.6rem', fontWeight: 700, padding: '2px 8px', borderRadius: '4px',
                color: '#60a5fa', background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.2)',
                letterSpacing: '0.06em',
              }}>
                YOUR SCAN
              </span>
            )}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.77rem', lineHeight: 1.5, margin: 0, maxWidth: '520px' }}>
            {globalEdges && !userScanned
              ? 'BetOS AI pre-analyzed today\'s slate automatically with live web search. Updated twice daily. Use "Ask the Analyst" below for custom queries.'
              : 'BetOS scans today\'s slate and surfaces situational betting edges — home dogs, rest spots, fade opportunities, and line value — with real current odds.'}
          </p>
          {/* Show last generated timestamp */}
          {globalEdges?.pushed_at && !userScanned && (
            <div style={{ marginTop: '5px', fontSize: '0.67rem', color: '#444' }}>
              Last updated: {new Date(globalEdges.pushed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          {/* Loading indicator while fetching global edges */}
          {globalLoading && (
            <span style={{ fontSize: '0.7rem', color: '#555', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', border: '2px solid #FFB800', borderTopColor: 'transparent', animation: 'spin-border 0.8s linear infinite' }} />
              Loading analysis…
            </span>
          )}

          {/* When global data exists: show "Run Your Own Scan" as secondary option */}
          {globalEdges && !userScanned && !globalLoading && (
            <button
              onClick={() => scan(sport, true)}
              disabled={loading}
              style={{
                padding: '6px 14px', borderRadius: '7px', fontSize: '0.75rem', fontWeight: 600,
                cursor: loading ? 'wait' : 'pointer', border: '1px solid #333',
                background: 'transparent', color: '#666',
                opacity: loading ? 0.5 : 1, whiteSpace: 'nowrap', transition: 'all 0.15s',
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#555'; e.currentTarget.style.color = '#999'; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#666'; }}
            >
              {loading ? '🔍 Scanning…' : '🔍 Run My Own Scan'}
            </button>
          )}

          {/* When no global data: show primary scan button */}
          {(!globalEdges || userScanned) && !globalLoading && (
            <button
              onClick={() => scan(sport, true)}
              disabled={loading}
              className="btn-gold"
              style={{ opacity: loading ? 0.6 : 1, whiteSpace: 'nowrap' }}
            >
              {loading ? '🔍 Scanning…' : scanned ? '🔄 Refresh' : '🔍 Scan Today\'s Slate'}
            </button>
          )}

          {/* When user has run own scan, offer to switch back to BetOS global */}
          {userScanned && globalEdges && (
            <button
              onClick={() => { setEdges(globalEdges.edges); setUserScanned(false); setError(''); }}
              style={{
                padding: '4px 10px', borderRadius: '6px', fontSize: '0.68rem',
                cursor: 'pointer', border: '1px solid rgba(74,222,128,0.25)',
                background: 'rgba(74,222,128,0.05)', color: '#4ade80',
                transition: 'all 0.12s', whiteSpace: 'nowrap',
              }}
            >
              ← Back to BetOS AI
            </button>
          )}
        </div>
      </div>

      {/* Sport filter */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {SPORTS.map(s => (
          <button key={s.key} onClick={() => { setSport(s.key); if (userScanned || scanned) scan(s.key); }}
            style={{
              padding: '5px 13px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.8rem',
              border: `1px solid ${sport === s.key ? '#FFB800' : '#222'}`,
              background: sport === s.key ? '#1a1200' : 'transparent',
              color: sport === s.key ? '#FFB800' : '#666',
              fontWeight: sport === s.key ? 700 : 400, transition: 'all 0.15s',
            }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Animated progress bar ── */}
      {loading && (
        <div style={{
          padding: '1.5rem 1.75rem',
          background: 'linear-gradient(135deg, #0a0a0f 0%, #0e0b04 100%)',
          border: '1px solid rgba(255,184,0,0.18)',
          borderRadius: '14px',
          boxShadow: '0 2px 24px rgba(255,184,0,0.04)',
        }}>
          {/* Step label */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '11px', marginBottom: '18px' }}>
            <span style={{ fontSize: '1.25rem', lineHeight: 1, flexShrink: 0 }}>
              {SCAN_STEPS[scanStepIdx]?.emoji || '🔍'}
            </span>
            <span style={{
              color: '#d8d0b8', fontSize: '0.87rem', fontWeight: 500, lineHeight: 1.4,
              transition: 'all 0.35s ease',
            }}>
              {SCAN_STEPS[scanStepIdx]?.label || 'Initializing scan…'}
            </span>
          </div>

          {/* Progress track */}
          <div style={{ height: '7px', background: 'rgba(255,255,255,0.07)', borderRadius: '4px', overflow: 'hidden', marginBottom: '10px' }}>
            <div style={{
              height: '100%',
              width: `${scanPct}%`,
              background: 'linear-gradient(90deg, #ff7b00, #FFB800, #ffe566)',
              borderRadius: '4px',
              boxShadow: '0 0 14px rgba(255,184,0,0.55)',
              transition: 'width 0.45s ease',
            }} />
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.65rem', color: '#3a3a3a' }}>
            <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>BetOS Intelligence · Live Scan</span>
            <span style={{
              fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
              color: scanPct >= 98 ? '#FFB800' : '#3a3a3a',
              transition: 'color 0.3s',
            }}>
              {scanPct}%
            </span>
          </div>
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{ padding: '1rem', background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: '8px', color: '#f87171', fontSize: '0.82rem', textAlign: 'center' }}>
          {error}
        </div>
      )}

      {/* Empty state (pre-scan) */}
      {!loading && !scanned && !error && (
        <div style={{ textAlign: 'center', padding: '3rem 2rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem', opacity: 0.4 }}>⚡</div>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
            No scan yet
          </div>
          <div style={{ fontSize: '0.78rem', marginBottom: '1.25rem', lineHeight: 1.6 }}>
            Hit <strong style={{ color: '#FFB800' }}>Scan Today's Slate</strong> to pull live games and surface today's best situational edges — home dogs, rest advantages, fade spots, and more.
          </div>
          <button onClick={() => scan(sport)} className="btn-gold">
            🔍 Scan Today's Slate
          </button>
        </div>
      )}

      {/* Edge cards */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{filtered.length} edge{filtered.length !== 1 ? 's' : ''} identified</span>
            <span style={{ color: '#2a2a2a' }}>·</span>
            <span>⚡ = sharp spot with meaningful historical edge</span>
            <span style={{ color: '#2a2a2a' }}>·</span>
            <span>Click any card to expand analysis + log the pick</span>
          </div>
          {filtered.map((edge, i) => (
            <EdgeCard key={i} edge={edge} onLog={handleLog} />
          ))}
        </div>
      )}

      {/* No edges found after scan */}
      {!loading && scanned && !error && filtered.length === 0 && edges.length > 0 && (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
          No {sport !== 'all' ? sport.toUpperCase() : ''} edges found — try "All Today" or refresh for a different sport.
        </div>
      )}

      {/* Ask the Analyst — always visible */}
      <AskAnalyst user={user} />

      {/* Footer info */}
      <div style={{ padding: '0.7rem 1rem', background: '#080808', border: '1px solid #1a1a1a', borderRadius: '8px', display: 'flex', gap: '1.25rem', flexWrap: 'wrap', fontSize: '0.68rem', color: '#444' }}>
        <span>📡 Live odds from ESPN</span>
        <span>🤖 AI-powered edge detection with live data</span>
        <span>⚡ Situational edges: rest, matchups, line value, public fade spots</span>
        <span>💬 5 free analyst queries/day per user</span>
      </div>
    </div>
  );
}
