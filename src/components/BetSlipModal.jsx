'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { addPick } from '@/lib/supabase';
import { saveDemoPicks, demoId } from '@/lib/demoData';
import { useVoiceInput } from '@/components/VoiceInput';
import { validML } from '@/lib/odds';

// ── Constants ──────────────────────────────────────────────────────────────────
const BOOKS = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'ESPN Bet', 'Hard Rock', 'PointsBet', 'Bet365', 'Pinnacle', 'Other'];
const SPORT_LABELS = { mlb: 'MLB', nfl: 'NFL', nba: 'NBA', nhl: 'NHL', ncaaf: 'NCAAF', ncaab: 'NCAAB', mls: 'MLS', wnba: 'WNBA' };
const SPORT_EMOJI  = { mlb: '⚾', nfl: '🏈', nba: '🏀', nhl: '🏒', ncaaf: '🏈', ncaab: '🏀', mls: '⚽', wnba: '🏀' };

const SPORT_BET_TYPES = {
  mlb:   ['Moneyline', 'Run Line', 'Total (Over)', 'Total (Under)', 'F5 Moneyline', 'F5 Total (Over)', 'F5 Total (Under)', 'Prop', 'Parlay'],
  nfl:   ['Moneyline', 'Spread', 'Total (Over)', 'Total (Under)', '1H Spread', '1H Total (Over)', '1H Total (Under)', 'Prop', 'Parlay'],
  nba:   ['Moneyline', 'Spread', 'Total (Over)', 'Total (Under)', '1H Spread', '1H Total (Over)', '1Q Spread', 'Prop', 'Parlay'],
  nhl:   ['Moneyline', 'Puck Line', 'Total (Over)', 'Total (Under)', 'Prop', 'Parlay'],
  ncaaf: ['Moneyline', 'Spread', 'Total (Over)', 'Total (Under)', '1H Spread', '1H Total (Over)', 'Prop', 'Parlay'],
  ncaab: ['Moneyline', 'Spread', 'Total (Over)', 'Total (Under)', '1H Spread', 'Prop', 'Parlay'],
  mls:   ['Moneyline', 'Draw', 'Total (Over)', 'Total (Under)', 'Asian Handicap', 'Prop', 'Parlay'],
  wnba:  ['Moneyline', 'Spread', 'Total (Over)', 'Total (Under)', 'Prop', 'Parlay'],
};
const DEFAULT_BET_TYPES = ['Moneyline', 'Spread', 'Total (Over)', 'Total (Under)', 'Prop', 'Parlay'];

// Player prop stat categories by sport
const SPORT_PROP_STATS = {
  nfl:   ['Passing Yards', 'Passing TDs', 'Completions', 'Rushing Yards', 'Receiving Yards', 'Receptions', 'Touchdowns', 'Interceptions', 'Sacks'],
  nba:   ['Points', 'Assists', 'Rebounds', 'Steals', 'Blocks', 'Threes Made', 'Pts+Reb+Ast', 'Pts+Reb', 'Pts+Ast', 'Reb+Ast'],
  mlb:   ['Strikeouts', 'Hits Allowed', 'Earned Runs', 'Walks', 'Hits', 'RBIs', 'Home Runs', 'Total Bases', 'Stolen Bases', 'Pitching Outs'],
  nhl:   ['Goals', 'Assists', 'Points', 'Shots on Goal', 'Saves', 'Power Play Points'],
  ncaaf: ['Passing Yards', 'Rushing Yards', 'Receiving Yards', 'Touchdowns', 'Receptions'],
  ncaab: ['Points', 'Assists', 'Rebounds', 'Threes Made', 'Steals', 'Blocks'],
  mls:   ['Goals', 'Shots on Target', 'Shots', 'Assists'],
  wnba:  ['Points', 'Assists', 'Rebounds', 'Threes Made'],
};
const DEFAULT_PROP_STATS = ['Points', 'Yards', 'Strikeouts', 'Goals', 'Assists', 'Rebounds', 'Hits'];

function fmtOdds(n) {
  if (n == null || n === '') return null;
  const num = parseInt(n);
  if (isNaN(num)) return null;
  return num > 0 ? `+${num}` : `${num}`;
}
function toLocalDateStr(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

// Parse spread string like "DET -1.5" or "Guardians -1.5" → { awayLine, homeLine }
function parseSpread(spreadStr, awayAbbr, homeAbbr) {
  if (!spreadStr) return null;
  // Match team name (caps abbreviation OR mixed-case word) followed by a spread number
  const match = spreadStr.match(/([A-Za-z]+)\s*([-+]?\d+\.?\d*)/);
  if (!match) return null;
  const team = match[1];
  const line = parseFloat(match[2]);
  if (isNaN(line)) return null;
  // The team in the string is the one getting that spread; other team gets opposite
  // Check abbreviation match first, then check if it's a partial team name
  const isAway = team === awayAbbr || team.toUpperCase() === awayAbbr;
  return {
    awayLine: isAway ? line : -line,
    homeLine: isAway ? -line : line,
  };
}

// ── Pulsing dots ───────────────────────────────────────────────────────────────
function PulsingDots({ color = 'var(--gold)' }) {
  return (
    <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '5px', height: '5px', borderRadius: '50%', background: color,
          animation: `pulse-dot 1.2s ${i * 0.2}s ease-in-out infinite`, display: 'inline-block',
        }} />
      ))}
      <style>{`@keyframes pulse-dot { 0%,80%,100% { transform:scale(0.6);opacity:0.4; } 40% { transform:scale(1);opacity:1; } }`}</style>
    </span>
  );
}

// ── Quick-select bet button ────────────────────────────────────────────────────
function QuickBetBtn({ label, sublabel, odds, selected, onClick }) {
  const oddsColor = odds > 0 ? '#4ade80' : odds < 0 ? 'var(--text-secondary)' : 'var(--text-muted)';
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '0.6rem 0.5rem',
        borderRadius: '10px',
        border: selected
          ? '2px solid var(--gold)'
          : '1px solid var(--border)',
        background: selected
          ? 'linear-gradient(135deg, rgba(255,184,0,0.15) 0%, rgba(255,149,0,0.08) 100%)'
          : 'var(--bg-elevated)',
        cursor: 'pointer',
        transition: 'all 0.15s',
        textAlign: 'center',
        position: 'relative',
        outline: 'none',
      }}
      onMouseEnter={e => { if (!selected) { e.currentTarget.style.borderColor = 'rgba(255,184,0,0.4)'; e.currentTarget.style.background = 'var(--bg-overlay)'; } }}
      onMouseLeave={e => { if (!selected) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)'; } }}
    >
      {selected && (
        <span style={{
          position: 'absolute', top: '-8px', right: '-6px',
          width: '16px', height: '16px', borderRadius: '50%',
          background: 'var(--gold)', color: '#000',
          fontSize: '0.6rem', fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>✓</span>
      )}
      <div style={{ fontSize: '0.72rem', fontWeight: 700, color: selected ? 'var(--gold)' : 'var(--text-secondary)', marginBottom: '2px', lineHeight: 1.2 }}>
        {label}
      </div>
      {sublabel && (
        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '3px' }}>{sublabel}</div>
      )}
      {odds != null ? (
        <div style={{
          fontSize: '0.82rem', fontWeight: 800,
          fontFamily: 'IBM Plex Mono, monospace',
          color: selected ? 'var(--gold)' : oddsColor,
        }}>
          {fmtOdds(odds)}
        </div>
      ) : (
        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          {selected ? 'Enter odds ↓' : 'Set odds →'}
        </div>
      )}
    </button>
  );
}

// ── Units quick-chip row ───────────────────────────────────────────────────────
function UnitsChips({ value, onChange }) {
  const presets = ['0.5', '1', '2', '3', '5'];
  const isCustom = !presets.includes(value);
  return (
    <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
      {presets.map(u => (
        <button
          key={u}
          onClick={() => onChange(u)}
          style={{
            padding: '3px 10px', borderRadius: '20px', cursor: 'pointer',
            fontSize: '0.75rem', fontWeight: 700,
            border: value === u ? '1px solid var(--gold)' : '1px solid var(--border)',
            background: value === u ? 'rgba(255,184,0,0.12)' : 'var(--bg-elevated)',
            color: value === u ? 'var(--gold)' : 'var(--text-muted)',
            fontFamily: 'IBM Plex Mono, monospace',
            transition: 'all 0.12s',
          }}
        >{u}u</button>
      ))}
      <input
        type="number"
        value={isCustom ? value : ''}
        onChange={e => onChange(e.target.value)}
        placeholder="custom"
        min="0.1" step="0.5"
        style={{
          width: '58px', padding: '3px 7px', borderRadius: '6px', fontSize: '0.73rem',
          background: 'var(--bg-elevated)', border: `1px solid ${isCustom ? 'var(--gold)' : 'var(--border)'}`,
          color: isCustom ? 'var(--gold)' : 'var(--text-muted)',
          fontFamily: 'IBM Plex Mono, monospace', outline: 'none',
          MozAppearance: 'textfield',
        }}
      />
    </div>
  );
}

// ── Contest eligibility badge ──────────────────────────────────────────────────
function ContestBadge({ result }) {
  if (!result) return null;
  const ok = result.eligible;
  return (
    <div style={{
      padding: '0.55rem 0.75rem',
      borderRadius: '8px',
      background: ok ? 'rgba(74,222,128,0.07)' : 'rgba(255,69,96,0.07)',
      border: `1px solid ${ok ? 'rgba(74,222,128,0.25)' : 'rgba(255,69,96,0.25)'}`,
      fontSize: '0.75rem',
    }}>
      <div style={{ fontWeight: 700, color: ok ? '#4ade80' : '#ff4560', marginBottom: result.issues?.length || result.warnings?.length ? '4px' : 0 }}>
        {ok ? '✅ Contest eligible' : '❌ Not contest eligible'}
      </div>
      {result.issues?.map((i, idx) => (
        <div key={idx} style={{ color: '#ff6b7a', marginTop: '2px' }}>⚠ {i}</div>
      ))}
      {result.warnings?.map((w, idx) => (
        <div key={idx} style={{ color: '#FFB800', marginTop: '2px' }}>⚡ {w}</div>
      ))}
      {ok && (
        <div style={{ color: 'rgba(74,222,128,0.7)', marginTop: '2px', fontSize: '0.68rem' }}>
          This pick will be locked once saved — no edits or deletes allowed.
        </div>
      )}
    </div>
  );
}

// ── Main BetSlipModal ──────────────────────────────────────────────────────────
export default function BetSlipModal({ game, sport, user, picks, setPicks, isDemo, onClose, onAnalyze, propPrefill }) {
  const { away, home, odds, date } = game;
  const awayName  = away.team?.displayName || away.team?.name || 'Away';
  const homeName  = home.team?.displayName || home.team?.name || 'Home';
  const awayAbbr  = away.team?.abbreviation || 'AWY';
  const homeAbbr  = home.team?.abbreviation || 'HME';
  const awayLogo  = away.team?.logo || null;
  const homeLogo  = home.team?.logo || null;
  const gameDate  = date ? toLocalDateStr(date) : toLocalDateStr(new Date());
  const betTypes  = SPORT_BET_TYPES[sport] || DEFAULT_BET_TYPES;
  // Detect if the game has already started — odds shown are closing line (last pre-game snapshot)
  const gameStarted = date && new Date(date).getTime() <= Date.now();

  // ── Parse available lines from odds ────────────────────────────────────────
  const spreadData = odds?.spread ? parseSpread(odds.spread, awayAbbr, homeAbbr) : null;

  // Build the quick-bet options from real odds data
  // For spread/total, default to -110 (standard juice) when ESPN doesn't supply a price —
  // this is correct ~95% of the time and far better than showing "odds TBD".
  const spreadSection = sport === 'mlb' ? 'Run Line' : sport === 'nhl' ? 'Puck Line' : 'Spread';
  const spreadBetType = sport === 'mlb' ? 'Run Line' : sport === 'nhl' ? 'Puck Line' : 'Spread';

  // For MLB/NHL the spread string encodes the ML, not a ±1.5 number.
  // In those sports the run/puck line is always ±1.5 — show that if spread looks like an ML (≥100).
  const spreadIsML = spreadData && Math.abs(spreadData.awayLine) >= 100;

  // When spread string was actually an ML price, use it for the ML buttons if they're missing
  const mlFromSpread = spreadIsML ? spreadData : null;
  // Resolved ML odds — must be declared before effectiveSpreadData (used in homeFavored)
  const resolvedAwayOdds = odds?.awayOdds ?? (mlFromSpread?.awayLine ? mlFromSpread.awayLine : null);
  const resolvedHomeOdds = odds?.homeOdds ?? (mlFromSpread?.homeLine ? mlFromSpread.homeLine : null);

  // For NHL and MLB the line is ALWAYS ±1.5 — show puck/run line even when odds data is missing
  const alwaysHasFixedLine = ['nhl', 'mlb'].includes(sport);
  // Infer which team is favored from ML odds to assign -1.5 correctly
  const homeFavored = resolvedHomeOdds != null && resolvedAwayOdds != null
    ? resolvedHomeOdds < resolvedAwayOdds
    : true; // default: home is favored

  // When spread string was actually an ML, OR no spread data at all, use homeFavored to assign ±1.5
  const needsInferredLine = spreadIsML || (!spreadData && alwaysHasFixedLine);
  const effectiveSpreadData = needsInferredLine
    ? (homeFavored
        ? { awayLine: 1.5,  homeLine: -1.5 }   // home favored → away +1.5 / home -1.5
        : { awayLine: -1.5, homeLine: 1.5  })   // away favored → away -1.5 / home +1.5
    : spreadData
      ? spreadData
      : null;

  const quickBets = [
    // ── Moneyline ──────────────────────────────────────────────────────────
    {
      section: 'Moneyline',
      bets: [
        {
          id: 'away-ml', label: awayAbbr, sublabel: 'Moneyline',
          bet_type: 'Moneyline', team: awayName,
          odds: resolvedAwayOdds,
          defaultOdds: resolvedAwayOdds,
        },
        {
          id: 'home-ml', label: homeAbbr, sublabel: 'Moneyline',
          bet_type: 'Moneyline', team: homeName,
          odds: resolvedHomeOdds,
          defaultOdds: resolvedHomeOdds,
        },
      ],
    },
    // ── Spread / Run Line / Puck Line (only if data available) ─────────────
    ...(effectiveSpreadData ? [{
      section: spreadSection,
      bets: [
        {
          id: 'away-spread',
          label: awayAbbr,
          sublabel: `${effectiveSpreadData.awayLine > 0 ? '+' : ''}${effectiveSpreadData.awayLine}`,
          bet_type: spreadBetType,
          team: `${awayName} ${effectiveSpreadData.awayLine > 0 ? '+' : ''}${effectiveSpreadData.awayLine}`,
          // Use real spread price from ESPN if available; otherwise -110 is standard juice
          odds: odds?.awaySpreadOdds ?? -110,
          defaultOdds: odds?.awaySpreadOdds ?? -110,
        },
        {
          id: 'home-spread',
          label: homeAbbr,
          sublabel: `${effectiveSpreadData.homeLine > 0 ? '+' : ''}${effectiveSpreadData.homeLine}`,
          bet_type: spreadBetType,
          team: `${homeName} ${effectiveSpreadData.homeLine > 0 ? '+' : ''}${effectiveSpreadData.homeLine}`,
          odds: odds?.homeSpreadOdds ?? -110,
          defaultOdds: odds?.homeSpreadOdds ?? -110,
        },
      ],
    }] : []),
    // ── Total (only if data available) ─────────────────────────────────────
    ...(odds?.total != null ? [{
      section: `Total (${odds.total})`,
      bets: [
        {
          id: 'over',  label: 'Over',  sublabel: `${odds.total}`,
          bet_type: 'Total (Over)',  team: `Over ${odds.total}`,
          odds: odds?.overOdds  ?? -110,
          defaultOdds: odds?.overOdds  ?? -110,
        },
        {
          id: 'under', label: 'Under', sublabel: `${odds.total}`,
          bet_type: 'Total (Under)', team: `Under ${odds.total}`,
          odds: odds?.underOdds ?? -110,
          defaultOdds: odds?.underOdds ?? -110,
        },
      ],
    }] : []),
  ];

  // ── Selected quick bet ──────────────────────────────────────────────────────
  const [selectedId,  setSelectedId]  = useState(null);
  const [oddsVal,     setOddsVal]     = useState('');
  const [units,       setUnits]       = useState('1');
  const [book,        setBook]        = useState('DraftKings');
  const [notes,       setNotes]       = useState('');
  // Contest entry toggle (checkbox replaces old 3-tier Personal/Verified/Contest selector)
  const [isContest,   setIsContest]   = useState(false);
  const [contestResult, setContestResult] = useState(null); // result from verify-pick API
  const [verifying,   setVerifying]   = useState(false);

  // Custom bet section — open straight to Prop mode when launched from Prop Builder
  const [showCustom,  setShowCustom]  = useState(!!propPrefill);
  const [customBetType, setCustomBetType] = useState(propPrefill ? 'Prop' : 'Moneyline');
  const [customTeam,  setCustomTeam]  = useState('');
  const [customOdds,  setCustomOdds]  = useState(propPrefill?.odds || '');
  // Player prop fields — shown when customBetType === 'Prop'
  const [propPlayer,    setPropPlayer]    = useState(propPrefill?.player || '');
  const [propStat,      setPropStat]      = useState(propPrefill?.stat || '');
  const [propLine,      setPropLine]      = useState(propPrefill?.line || '');
  const [propDirection, setPropDirection] = useState(propPrefill?.direction || 'over');

  const [voiceState,  setVoiceState]  = useState('idle');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceError,  setVoiceError]  = useState('');
  const [textInput,   setTextInput]   = useState('');
  const partialRef = useRef('');

  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [saveError,   setSaveError]   = useState('');
  const [mounted,     setMounted]     = useState(false);
  const [showConfirm, setShowConfirm] = useState(false); // Contest confirmation dialog
  const [aiChecking,  setAiChecking]  = useState(false); // AI pre-save audit in progress
  const [aiCheckResult, setAiCheckResult] = useState(null); // { ok, reason } from AI

  // Mount flag for portal rendering (avoids SSR mismatch)
  useEffect(() => { setMounted(true); }, []);

  // Lock body scroll while modal is open (prevents page scrolling behind modal)
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Pre-fill prop fields when opened from Prop Builder
  // State is initialized directly from propPrefill above (avoids conflicting effects)
  useEffect(() => {
    if (propPrefill) setSelectedId(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-compose customTeam from prop fields when bet type is Prop
  useEffect(() => {
    if (customBetType !== 'Prop') return;
    if (propPlayer.trim() && propLine.trim()) {
      const dir  = propDirection === 'over' ? 'Over' : 'Under';
      const stat = propStat ? ` ${propStat}` : '';
      setCustomTeam(`${propPlayer.trim()} ${dir} ${propLine.trim()}${stat}`);
    }
  }, [propPlayer, propStat, propLine, propDirection, customBetType]);

  // Clear prop fields only when user manually switches AWAY from Prop type
  // (not on initial mount — use prevBetTypeRef to track transitions)
  const prevBetTypeRef = useRef(customBetType);
  useEffect(() => {
    const prev = prevBetTypeRef.current;
    prevBetTypeRef.current = customBetType;
    if (prev === 'Prop' && customBetType !== 'Prop') {
      setPropPlayer(''); setPropStat(''); setPropLine(''); setPropDirection('over');
    }
  }, [customBetType]);

  // Derived selected bet object
  const selectedBet = quickBets.flatMap(s => s.bets).find(b => b.id === selectedId) || null;
  const isCustomActive = showCustom && !selectedId;

  // ── When a quick bet is selected → pre-fill odds ───────────────────────────
  function selectQuickBet(bet) {
    if (selectedId === bet.id) {
      // Deselect
      setSelectedId(null);
      setOddsVal('');
      setContestResult(null);
      return;
    }
    setSelectedId(bet.id);
    setShowCustom(false);
    // Pre-fill odds if available, else default
    setOddsVal(bet.odds != null ? String(bet.odds) : bet.defaultOdds != null ? String(bet.defaultOdds) : '');
    setContestResult(null);
    setSaveError('');
  }

  // ── When contest checkbox changes → run eligibility check ───────────────────
  async function handleContestToggle(checked) {
    setIsContest(checked);
    setContestResult(null);
    if (!checked) return;

    const teamValue = selectedBet ? selectedBet.team : customTeam.trim();
    const betTypeValue = selectedBet ? selectedBet.bet_type : customBetType;
    const oddsValue = selectedBet ? oddsVal : customOdds;
    if (!teamValue || !oddsValue) return;

    setVerifying(true);
    try {
      const res = await fetch('/api/verify-pick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pick: { team: teamValue, bet_type: betTypeValue, odds: oddsValue, units: parseFloat(units) || 1, date: gameDate },
          userId: user?.id,
          contestEntry: true,
        }),
      });
      const data = await res.json();
      setContestResult(data);
    } catch {
      setContestResult({ eligible: false, issues: ['Could not verify — check connection.'] });
    }
    setVerifying(false);
  }

  // ── Re-run contest check when key values change (if contest is on) ──────────
  useEffect(() => {
    if (!isContest) return;
    const teamValue = selectedBet ? selectedBet.team : customTeam.trim();
    const oddsValue = selectedBet ? oddsVal : customOdds;
    if (!teamValue || !oddsValue) return;

    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/verify-pick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pick: { team: teamValue, bet_type: selectedBet ? selectedBet.bet_type : customBetType, odds: oddsValue, units: parseFloat(units) || 1, date: gameDate },
            userId: user?.id,
            contestEntry: true,
          }),
        });
        const data = await res.json();
        setContestResult(data);
      } catch {}
    }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oddsVal, customOdds, selectedId, customTeam, units, isContest]);

  // ── Voice / AI parse for custom section ────────────────────────────────────
  const applyParsed = useCallback((parsed) => {
    const allTypes = SPORT_BET_TYPES[sport] || DEFAULT_BET_TYPES;
    if (parsed.bet_type) {
      const match = allTypes.find(t => t.toLowerCase() === parsed.bet_type.toLowerCase()) || allTypes[0];
      setCustomBetType(match);
    }
    if (parsed.team) setCustomTeam(parsed.team);
    if (parsed.odds != null) setCustomOdds(String(parseInt(parsed.odds)));
    if (parsed.units != null) setUnits(String(parseFloat(parsed.units)));
    if (parsed.book) {
      const m = BOOKS.find(b => b.toLowerCase().includes((parsed.book || '').toLowerCase().split(' ')[0]));
      if (m) setBook(m);
    }
    if (parsed.notes) setNotes(parsed.notes);
  }, [sport]);

  const parseWithAI = useCallback(async (text, source = 'text') => {
    if (!text.trim()) return;
    setVoiceTranscript(text.trim());
    setVoiceState('parsing');
    setVoiceError('');
    try {
      const res = await fetch('/api/parse-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'text',
          text: `Game: ${awayName} @ ${homeName} (${SPORT_LABELS[sport] || sport?.toUpperCase()}) on ${gameDate}.\n\n${source === 'voice' ? 'Voice' : 'Text'} bet input: "${text.trim()}"`,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      applyParsed(data.parsed);
      setVoiceState('done');
      if (source === 'text') setTextInput('');
      setTimeout(() => setVoiceState('idle'), 3000);
    } catch (err) {
      setVoiceError(err.message || 'Could not parse.');
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 4000);
    }
  }, [awayName, homeName, sport, gameDate, applyParsed]);

  const { listening, supported, start, stop } = useVoiceInput({
    onPartial: (t) => { partialRef.current = t; setVoiceTranscript(t); },
    onResult: (t) => parseWithAI(t, 'voice'),
  });
  function handleVoiceClick() {
    if (voiceState === 'listening') { stop(); setVoiceState('idle'); return; }
    if (voiceState === 'parsing') return;
    setVoiceTranscript(''); setVoiceError(''); partialRef.current = '';
    setVoiceState('listening'); start();
  }

  // ── Escape key ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // ── Reset transient states when modal closes ────────────────────────────────
  useEffect(() => {
    return () => {
      setShowConfirm(false);
      setAiCheckResult(null);
      setSaveError('');
    };
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────
  // ── Contest save flow: validate → confirm → AI check → save ────────────────
  const handleSave = useCallback(async () => {
    // Determine values from either quick-select or custom
    let teamValue, betTypeValue, oddsValue;
    if (selectedBet) {
      teamValue    = selectedBet.team;
      betTypeValue = selectedBet.bet_type;
      oddsValue    = oddsVal;
    } else {
      teamValue    = customTeam.trim();
      betTypeValue = customBetType;
      oddsValue    = customOdds;
    }

    if (!teamValue) { setSaveError('Select or enter a pick.'); return; }
    const oddsNum = parseInt(oddsValue);
    if (!oddsValue || isNaN(oddsNum)) { setSaveError('Enter valid American odds (e.g. -110 or +133).'); return; }
    if (!validML(oddsNum)) { setSaveError(`Odds ${oddsNum > 0 ? '+' : ''}${oddsNum} look off — valid range is -1500 to +1500. Double-check before submitting.`); return; }

    // Contest picks: show confirmation dialog first (if not already confirmed)
    if (isContest && contestResult?.eligible && !showConfirm) {
      setShowConfirm(true);
      return;
    }

    // Not contest, or ineligible → save directly as personal pick
    await executeSave(teamValue, betTypeValue, oddsNum);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBet, oddsVal, customTeam, customBetType, customOdds, isContest, contestResult, showConfirm, units, notes, book, user?.id, gameDate, sport, isDemo, picks, setPicks, onClose, awayAbbr, homeAbbr]);

  // Called after user confirms the contest dialog (or for personal picks directly)
  const executeSave = useCallback(async (teamValue, betTypeValue, oddsNum) => {
    setSaving(true); setSaveError(''); setShowConfirm(false); setAiCheckResult(null);

    // For contest picks: run AI pre-save audit to catch invalid picks instantly
    let finalContestEntry = isContest && (contestResult?.eligible !== false);
    if (finalContestEntry && !isDemo) {
      setAiChecking(true);
      try {
        const auditRes = await fetch('/api/contest-audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'pre-check',
            pick: { team: teamValue, bet_type: betTypeValue, odds: oddsNum, units: parseFloat(units) || 1, sport, date: gameDate },
          }),
        });
        const auditData = await auditRes.json();
        if (auditData.status === 'REJECTED') {
          // AI flagged it as invalid — save as personal only, user can resubmit
          finalContestEntry = false;
          setAiCheckResult({ ok: false, reason: auditData.reason || 'AI flagged this pick as invalid.' });
        }
      } catch { /* AI check failed — allow save as contest, admin will audit */ }
      setAiChecking(false);
    }

    const payload = {
      user_id:       user?.id || 'demo',
      date:          gameDate,
      sport:         (SPORT_LABELS[sport] || sport?.toUpperCase() || 'Other'),
      team:          teamValue,
      bet_type:      betTypeValue,
      odds:          oddsNum,
      units:         parseFloat(units) || 1,
      result:        null,
      profit:        null,
      notes:         notes.trim() || null,
      book:          book,
      matchup:       `${awayAbbr} @ ${homeAbbr}`,
      contest_entry: finalContestEntry,
    };

    try {
      if (isDemo) {
        const updated = [...(picks || []), { ...payload, id: demoId() }];
        setPicks(updated);
        saveDemoPicks(updated);
      } else {
        const { data, error } = await addPick(payload);
        if (error) throw new Error(error.message || 'Save failed');
        // Always update local state — use returned record if available, else optimistically
        // use the payload so the pick appears immediately even if Supabase SELECT returns null
        const newPick = data || { ...payload, id: `pending_${Date.now()}` };
        setPicks(prev => [...prev, newPick]);
        // Background auto-analysis (fire-and-forget, non-blocking)
        if (newPick.id && !newPick.id.startsWith('pending_')) {
          fetch('/api/auto-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pickId: newPick.id, sport: payload.sport, team: payload.team,
              bet_type: payload.bet_type, odds: payload.odds, units: payload.units,
              date: payload.date, notes: payload.notes,
            }),
          }).catch(() => {});
        }
      }

      if (aiCheckResult && !aiCheckResult.ok) {
        // Show rejection message briefly before closing
        setSaveError(`Contest pick rejected by AI: "${aiCheckResult.reason}" — saved as personal pick. You may resubmit a new contest pick.`);
        setSaving(false);
        setTimeout(onClose, 4000);
      } else {
        setSaved(true);
        setTimeout(onClose, 1100);
      }
    } catch (e) {
      setSaveError(e.message || 'Save failed. Try again.');
      setSaving(false);
    }
    // Note: setSaving(false) is intentional here as a safety net for any
    // code paths that don't explicitly clear it above
    setSaving(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContest, contestResult, isDemo, units, notes, book, user?.id, gameDate, sport, picks, setPicks, onClose, awayAbbr, homeAbbr, aiCheckResult]);

  // ── Input styles ──────────────────────────────────────────────────────────
  const inputStyle = {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: '7px', padding: '0.45rem 0.7rem',
    color: 'var(--text-primary)', fontSize: '0.82rem',
    fontFamily: 'inherit', outline: 'none', width: '100%',
    transition: 'border-color 0.12s',
  };
  const labelStyle = {
    fontSize: '0.6rem', fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', display: 'block',
  };

  const hasSelection = !!selectedId || (showCustom && customTeam.trim() && customOdds);

  const modalContent = (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 8000, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)' }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', zIndex: 8001,
        transform: 'translate(-50%, -50%)',
        background: 'var(--bg-surface)',
        border: saved ? '1px solid rgba(74,222,128,0.4)' : '1px solid rgba(255,184,0,0.25)',
        borderRadius: '16px',
        width: 'calc(100% - 24px)', maxWidth: '480px',
        maxHeight: 'min(calc(100dvh - 40px), calc(100vh - 40px))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7), 0 0 40px rgba(255,184,0,0.05)',
        animation: 'fade-in 0.18s cubic-bezier(0.34,1.56,0.64,1)',
        transition: 'border-color 0.3s',
      }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: '0.9rem 1.1rem 0.75rem',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, rgba(255,184,0,0.06) 0%, transparent 60%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
            {/* Away logo/abbr */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              {awayLogo
                ? <img src={awayLogo} alt="" width={20} height={20} style={{ objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
                : null}
              <span style={{ fontWeight: 800, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{awayAbbr}</span>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>@</span>
            {/* Home logo/abbr */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              {homeLogo
                ? <img src={homeLogo} alt="" width={20} height={20} style={{ objectFit: 'contain' }} onError={e => { e.target.style.display = 'none'; }} />
                : null}
              <span style={{ fontWeight: 800, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{homeAbbr}</span>
            </div>
            <span style={{ fontSize: '0.65rem', padding: '1px 7px', borderRadius: '20px', background: 'rgba(255,184,0,0.1)', color: 'var(--gold)', border: '1px solid rgba(255,184,0,0.2)', fontWeight: 700, flexShrink: 0 }}>
              {SPORT_EMOJI[sport]} {SPORT_LABELS[sport] || sport?.toUpperCase()}
            </span>
            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', flexShrink: 0 }}>
              {new Date(gameDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1, padding: '4px', flexShrink: 0, transition: 'color 0.12s' }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >✕</button>
        </div>

        {/* ── Scrollable content area — header and footer stay pinned ─────── */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>

        {/* ── Quick-Select Grid ───────────────────────────────────────────── */}
        {!propPrefill && <div style={{ padding: '0.85rem 1.1rem 0' }}>
          <div style={{ fontSize: '0.58rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: gameStarted ? '4px' : '0.6rem' }}>
            Select your bet
          </div>
          {gameStarted && (
            <div style={{ fontSize: '0.6rem', color: 'rgba(251,191,36,0.8)', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.18)', borderRadius: '6px', padding: '4px 8px', marginBottom: '0.6rem' }}>
              Closing odds — game in progress. Picks allowed but not contest-eligible.
            </div>
          )}

          {quickBets.map(section => (
            <div key={section.section} style={{ marginBottom: '0.65rem' }}>
              <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'rgba(255,184,0,0.5)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '5px' }}>
                {section.section}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {section.bets.map(bet => (
                  <QuickBetBtn
                    key={bet.id}
                    label={bet.label}
                    sublabel={bet.sublabel}
                    odds={bet.odds}
                    selected={selectedId === bet.id}
                    onClick={() => selectQuickBet(bet)}
                  />
                ))}
              </div>
            </div>
          ))}

          {/* No odds available message */}
          {quickBets.length === 0 && (
            <div style={{ padding: '0.75rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '0.65rem' }}>
              No lines available — use Custom Bet below
            </div>
          )}
        </div>}

        {/* ── Inline Details Panel (shown when a quick bet is selected) ───── */}
        {selectedBet && (
          <div style={{
            margin: '0.7rem 1.1rem 0',
            padding: '0.85rem',
            background: 'linear-gradient(135deg, rgba(255,184,0,0.06) 0%, rgba(255,149,0,0.02) 100%)',
            border: '1px solid rgba(255,184,0,0.2)',
            borderRadius: '12px',
            display: 'flex', flexDirection: 'column', gap: '0.7rem',
          }}>
            {/* Selected summary */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--gold)' }}>
                {selectedBet.bet_type}: {selectedBet.team}
              </span>
            </div>

            {/* Odds (editable) */}
            <div>
              <label style={labelStyle}>Odds (American) — edit if different</label>
              <input
                value={oddsVal}
                onChange={e => setOddsVal(e.target.value)}
                placeholder="-110 or +133"
                style={{
                  ...inputStyle,
                  fontFamily: 'IBM Plex Mono, monospace',
                  color: parseInt(oddsVal) > 0 ? 'var(--green)' : parseInt(oddsVal) < 0 ? 'var(--text-secondary)' : 'var(--text-primary)',
                  maxWidth: '140px',
                }}
                onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            {/* Units */}
            <div>
              <label style={labelStyle}>Units</label>
              <UnitsChips value={units} onChange={setUnits} />
            </div>

            {/* Book */}
            <div>
              <label style={labelStyle}>Sportsbook</label>
              <select
                value={book}
                onChange={e => setBook(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer', maxWidth: '200px' }}
                onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              >
                {BOOKS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label style={labelStyle}>Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Sharp money, weather, injury angle…"
                rows={2}
                style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
                onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            {/* ── Contest checkbox ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={isContest}
                  onChange={e => handleContestToggle(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--gold)' }}
                />
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: isContest ? 'var(--gold)' : 'var(--text-secondary)' }}>
                  🏆 Submit to contest?
                </span>
              </label>
              {verifying && <PulsingDots />}
            </div>

            {/* Contest eligibility result */}
            {isContest && contestResult && <ContestBadge result={contestResult} />}

            {/* 1u cap notice — shown when contest is on and user picked > 1 unit */}
            {isContest && parseFloat(units) > 1 && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                padding: '0.5rem 0.75rem', borderRadius: '7px',
                background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)',
              }}>
                <span style={{ fontSize: '0.78rem', flexShrink: 0 }}>ℹ️</span>
                <span style={{ fontSize: '0.72rem', color: '#93c5fd', lineHeight: 1.5 }}>
                  Contest picks are always scored as <strong style={{ color: '#60a5fa' }}>1 unit</strong> regardless of your bet size.
                  Your pick log will show <strong style={{ color: '#60a5fa' }}>{units}u</strong>, but the contest leaderboard will count it as 1u.
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── View Props link — opens Prop Builder tab ──────────────────── */}
        <div style={{ padding: '0.25rem 1.1rem 0', textAlign: 'center' }}>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('betos-navigate', { detail: 'props' }));
              onClose();
            }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              color: '#60a5fa', fontSize: '0.72rem', fontWeight: 600, padding: '4px 8px',
              borderRadius: '4px', opacity: 0.8, transition: 'opacity 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '0.8'; }}
          >
            🎯 Browse all player props →
          </button>
        </div>

        {/* ── Divider + Custom Bet accordion ─────────────────────────────── */}
        <div style={{ padding: '0.75rem 1.1rem 0' }}>
          <button
            onClick={() => { setShowCustom(v => !v); if (!showCustom) setSelectedId(null); }}
            style={{
              width: '100%', padding: '0.55rem 0.9rem',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: showCustom ? 'rgba(255,184,0,0.06)' : 'var(--bg-elevated)',
              border: `1px solid ${showCustom ? 'rgba(255,184,0,0.25)' : 'var(--border)'}`,
              borderRadius: '9px', cursor: 'pointer', fontFamily: 'inherit',
              color: showCustom ? 'var(--gold)' : 'var(--text-muted)',
              fontSize: '0.78rem', fontWeight: 600, transition: 'all 0.15s',
            }}
          >
            <span>✏️ Custom Bet — props, parlays, F5s & more</span>
            <span style={{ fontSize: '0.7rem', transition: 'transform 0.2s', display: 'inline-block', transform: showCustom ? 'rotate(180deg)' : 'none' }}>▼</span>
          </button>
        </div>

        {/* ── Custom Bet form (expandable) ─────────────────────────────────── */}
        {showCustom && (
          <div id="betslip-custom-section" style={{ padding: '0.75rem 1.1rem 0', display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>

            {/* AI/Voice input strip */}
            <div style={{
              border: '1px solid var(--border)', borderRadius: '9px',
              background: 'var(--bg-elevated)', overflow: 'hidden',
            }}>
              {/* Status banner */}
              {voiceState !== 'idle' && (
                <div style={{
                  padding: '0.45rem 0.85rem', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem',
                  color: voiceState === 'parsing' ? '#4E9BF5' : voiceState === 'done' ? '#00D48B' : voiceState === 'error' ? '#FF4560' : '#FF4560',
                  fontWeight: 700,
                }}>
                  {voiceState === 'parsing' && <><PulsingDots color="#4E9BF5" /> Parsing…</>}
                  {voiceState === 'done' && '✓ Bet loaded — review below'}
                  {voiceState === 'error' && `⚠ ${voiceError || 'Parse failed'}`}
                  {voiceState === 'listening' && '🔴 Listening…'}
                  {voiceTranscript && (voiceState === 'parsing' || voiceState === 'done') && (
                    <span style={{ fontSize: '0.65rem', fontStyle: 'italic', color: 'var(--text-muted)', marginLeft: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                      "{voiceTranscript}"
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0.4rem 0.6rem' }}>
                <input
                  type="text"
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && textInput.trim() && voiceState === 'idle') parseWithAI(textInput); }}
                  placeholder='"Yankees ML -150 2u DK" or tap mic…'
                  disabled={voiceState === 'parsing' || voiceState === 'listening'}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: '0.8rem', fontFamily: 'inherit', padding: '0.2rem 0.3rem', opacity: voiceState !== 'idle' ? 0.5 : 1 }}
                />
                {textInput.trim() && voiceState === 'idle' && (
                  <button onClick={() => parseWithAI(textInput)} style={{ padding: '3px 9px', borderRadius: '5px', border: 'none', background: 'rgba(255,184,0,0.15)', color: '#FFB800', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
                    Parse ↵
                  </button>
                )}
                {supported && (
                  <button
                    onClick={handleVoiceClick}
                    disabled={voiceState === 'parsing'}
                    style={{
                      width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                      border: `1.5px solid ${voiceState === 'listening' ? 'rgba(255,69,96,0.5)' : 'rgba(255,184,0,0.25)'}`,
                      background: voiceState === 'listening' ? 'rgba(255,69,96,0.12)' : 'rgba(255,184,0,0.08)',
                      color: voiceState === 'listening' ? '#FF4560' : '#FFB800',
                      cursor: voiceState === 'parsing' ? 'wait' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.82rem',
                      animation: voiceState === 'listening' ? 'live-pulse 1.2s infinite' : 'none',
                    }}
                  >
                    {voiceState === 'listening' ? '⏹' : '🎤'}
                  </button>
                )}
              </div>
            </div>

            {/* Manual form */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div>
                <label style={labelStyle}>Bet Type</label>
                <select value={customBetType} onChange={e => setCustomBetType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}
                  onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                >
                  {betTypes.map(bt => <option key={bt} value={bt}>{bt}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>Odds (American)</label>
                <input
                  value={customOdds} onChange={e => setCustomOdds(e.target.value)}
                  placeholder="-110 or +133"
                  style={{ ...inputStyle, fontFamily: 'IBM Plex Mono, monospace', color: parseInt(customOdds) > 0 ? 'var(--green)' : 'var(--text-primary)' }}
                  onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                />
              </div>
            </div>
            {customBetType === 'Prop' ? (
              /* ── Structured player prop entry ── */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '8px', padding: '10px 12px' }}>
                  <div style={{ fontSize: '0.62rem', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '8px' }}>
                    🎯 Player Prop
                  </div>
                  {/* Player name */}
                  <div style={{ marginBottom: '8px' }}>
                    <label style={labelStyle}>Player Name</label>
                    <input
                      value={propPlayer}
                      onChange={e => setPropPlayer(e.target.value)}
                      placeholder="e.g. Josh Allen, LeBron James"
                      style={{ ...inputStyle, fontWeight: 600 }}
                      onFocus={e => e.target.style.borderColor = '#60a5fa'}
                      onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                  </div>
                  {/* Stat + Line row */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px', marginBottom: '8px' }}>
                    <div>
                      <label style={labelStyle}>Stat</label>
                      <select
                        value={propStat}
                        onChange={e => setPropStat(e.target.value)}
                        style={{ ...inputStyle, cursor: 'pointer' }}
                        onFocus={e => e.target.style.borderColor = '#60a5fa'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                      >
                        <option value="">— Choose stat —</option>
                        {(SPORT_PROP_STATS[sport] || DEFAULT_PROP_STATS).map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Line</label>
                      <input
                        value={propLine}
                        onChange={e => setPropLine(e.target.value)}
                        placeholder="24.5"
                        type="number"
                        step="0.5"
                        min="0"
                        style={{ ...inputStyle, width: '72px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}
                        onFocus={e => e.target.style.borderColor = '#60a5fa'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                      />
                    </div>
                  </div>
                  {/* Over / Under toggle */}
                  <div>
                    <label style={labelStyle}>Direction</label>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {['over', 'under'].map(dir => (
                        <button
                          key={dir}
                          type="button"
                          onClick={() => setPropDirection(dir)}
                          style={{
                            flex: 1, padding: '6px 0', borderRadius: '6px', fontWeight: 700,
                            fontSize: '0.78rem', cursor: 'pointer', fontFamily: 'inherit',
                            border: `1.5px solid ${propDirection === dir
                              ? (dir === 'over' ? 'rgba(74,222,128,0.5)' : 'rgba(248,113,113,0.5)')
                              : 'var(--border)'}`,
                            background: propDirection === dir
                              ? (dir === 'over' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.1)')
                              : 'var(--bg-elevated)',
                            color: propDirection === dir
                              ? (dir === 'over' ? 'var(--green)' : '#f87171')
                              : 'var(--text-muted)',
                            transition: 'all 0.12s',
                          }}
                        >
                          {dir === 'over' ? '⬆ Over' : '⬇ Under'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Live preview of composed pick */}
                  {propPlayer && propLine && (
                    <div style={{ marginTop: '8px', padding: '6px 10px', background: 'rgba(96,165,250,0.06)', borderRadius: '6px', border: '1px solid rgba(96,165,250,0.15)' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginRight: '6px' }}>Pick:</span>
                      <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-primary)' }}>
                        {propPlayer.trim()} {propDirection === 'over' ? 'Over' : 'Under'} {propLine}{propStat ? ` ${propStat}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <label style={labelStyle}>Pick / Team / Bet Description</label>
                <input
                  value={customTeam} onChange={e => setCustomTeam(e.target.value)}
                  placeholder="e.g. Gerrit Cole over 7.5 K's, LAD ML, Parlay: NYY + Over 8.5"
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                />
              </div>
            )}
            <div>
              <label style={labelStyle}>Units</label>
              <UnitsChips value={units} onChange={setUnits} />
            </div>
            <div>
              <label style={labelStyle}>Sportsbook</label>
              <select value={book} onChange={e => setBook(e.target.value)} style={{ ...inputStyle, cursor: 'pointer', maxWidth: '200px' }}
                onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              >
                {BOOKS.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Edge, reasoning, context…" rows={2}
                style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
                onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            {/* ── Contest checkbox (custom section) ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={isContest}
                  onChange={e => handleContestToggle(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--gold)' }}
                />
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: isContest ? 'var(--gold)' : 'var(--text-secondary)' }}>
                  🏆 Submit to contest?
                </span>
              </label>
              {verifying && <PulsingDots />}
            </div>

            {/* Contest eligibility result (custom section) */}
            {isContest && contestResult && <ContestBadge result={contestResult} />}

            {/* 1u cap notice (custom section) */}
            {isContest && parseFloat(units) > 1 && (
              <div style={{
                display: 'flex', alignItems: 'flex-start', gap: '8px',
                padding: '0.5rem 0.75rem', borderRadius: '7px',
                background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)',
              }}>
                <span style={{ fontSize: '0.78rem', flexShrink: 0 }}>ℹ️</span>
                <span style={{ fontSize: '0.72rem', color: '#93c5fd', lineHeight: 1.5 }}>
                  Contest picks are always scored as <strong style={{ color: '#60a5fa' }}>1 unit</strong> regardless of your bet size.
                  Your pick log will show <strong style={{ color: '#60a5fa' }}>{units}u</strong>, but the contest leaderboard will count it as 1u.
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Contest Confirmation Dialog ──────────────────────────────────── */}
        {showConfirm && (
          <div style={{
            margin: '0.5rem 1.1rem',
            padding: '1rem 1.1rem',
            background: 'rgba(255,184,0,0.06)',
            border: '1px solid rgba(255,184,0,0.35)',
            borderRadius: '10px',
          }}>
            <div style={{ fontWeight: 800, color: '#FFB800', fontSize: '0.88rem', marginBottom: '6px' }}>
              🏆 Lock in your contest pick?
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '12px' }}>
              Once submitted, this pick is <strong style={{ color: '#FFB800' }}>permanent — no edits or deletes</strong>.
              It will be audited by AI and reviewed by the admin. If it gets flagged or rejected,
              you'll be free to resubmit a new pick for today.
            </div>
            {parseFloat(units) > 1 && (
              <div style={{ fontSize: '0.72rem', color: '#93c5fd', marginBottom: '12px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.18)' }}>
                ℹ️ You're entering <strong>{units}u</strong> — this will be logged in your pick history as {units}u, but the <strong>contest leaderboard scores it as 1u</strong>.
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{
                  flex: 1, padding: '0.5rem', borderRadius: '7px', border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--text-secondary)', fontSize: '0.82rem',
                  fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Go Back
              </button>
              <button
                onClick={() => {
                  // Re-derive values and call executeSave
                  const t = selectedBet ? selectedBet.team    : customTeam.trim();
                  const bt = selectedBet ? selectedBet.bet_type : customBetType;
                  const o = parseInt(selectedBet ? oddsVal : customOdds);
                  executeSave(t, bt, o);
                }}
                style={{
                  flex: 1, padding: '0.5rem', borderRadius: '7px', border: 'none',
                  background: 'linear-gradient(135deg, #FFB800, #FF9500)',
                  color: '#000', fontSize: '0.82rem', fontWeight: 800,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                ✅ Yes, Lock It In
              </button>
            </div>
          </div>
        )}

        {/* ── AI checking overlay ──────────────────────────────────────────── */}
        {aiChecking && (
          <div style={{
            margin: '0 1.1rem 0.5rem',
            padding: '0.6rem 0.85rem',
            background: 'rgba(96,165,250,0.06)',
            border: '1px solid rgba(96,165,250,0.2)',
            borderRadius: '8px',
            fontSize: '0.75rem', color: '#60a5fa',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <PulsingDots /> AI is verifying your pick before locking it in…
          </div>
        )}

        </div>{/* end scrollable content area */}

        {/* ── Footer — always visible, pinned to bottom ───────────────────── */}
        <div style={{
          padding: '0.85rem 1.1rem',
          borderTop: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px',
          background: 'var(--bg-elevated)',
          borderRadius: '0 0 16px 16px',
        }}>
          <button
            onClick={onClose}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '7px', padding: '0.45rem 1rem', color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
          >
            Cancel
          </button>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flex: 1 }}>
            {saveError && (
              <div style={{ fontSize: '0.68rem', color: '#FF4560', textAlign: 'right' }}>⚠ {saveError}</div>
            )}
            {saved ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--green)', fontWeight: 700, fontSize: '0.88rem' }}>
                <span>✅</span> Saved!
              </div>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving || aiChecking || !hasSelection || showConfirm}
                style={{
                  background: saving || aiChecking || !hasSelection
                    ? 'var(--bg-overlay)'
                    : 'linear-gradient(135deg, #FFB800 0%, #FF9500 100%)',
                  color: saving || aiChecking || !hasSelection ? 'var(--text-muted)' : '#0a0a0a',
                  border: 'none', borderRadius: '8px', padding: '0.5rem 1.4rem',
                  fontSize: '0.88rem', fontWeight: 800,
                  cursor: saving || aiChecking || !hasSelection || showConfirm ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit',
                  boxShadow: saving || aiChecking || !hasSelection ? 'none' : '0 2px 12px rgba(255,184,0,0.35)',
                  transition: 'all 0.15s',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  opacity: !hasSelection || showConfirm ? 0.5 : 1,
                }}
              >
                {saving || aiChecking ? '⟳ Saving…' : '💾 Save Pick'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );

  return mounted ? createPortal(modalContent, document.body) : null;
}
