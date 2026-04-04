'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { addPick } from '@/lib/supabase';
import { saveDemoPicks, demoId } from '@/lib/demoData';
import { useVoiceInput } from '@/components/VoiceInput';

// ── Sport-aware bet type lists ─────────────────────────────────────────────────
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

const BOOKS = ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'ESPN Bet', 'Hard Rock', 'PointsBet', 'Bet365', 'Pinnacle', 'Other'];

const SPORT_LABELS = { mlb: 'MLB', nfl: 'NFL', nba: 'NBA', nhl: 'NHL', ncaaf: 'NCAAF', ncaab: 'NCAAB', mls: 'MLS', wnba: 'WNBA' };
const SPORT_EMOJI  = { mlb: '⚾', nfl: '🏈', nba: '🏀', nhl: '🏒', ncaaf: '🏈', ncaab: '🏀', mls: '⚽', wnba: '🏀' };

function buildPickOptions(betType, awayAbbr, homeName, awayName, awayOdds, homeOdds, spread, total) {
  const isML       = betType === 'Moneyline' || betType === 'F5 Moneyline';
  const isRunLine  = betType === 'Run Line' || betType === 'Puck Line' || betType === 'Spread' || betType === '1H Spread' || betType === '1Q Spread';
  const isOver     = betType.includes('Over');
  const isUnder    = betType.includes('Under');
  const isDraw     = betType === 'Draw';

  if (isDraw) return [
    { label: `${awayName} ML`, team: awayName, odds: awayOdds },
    { label: 'Draw',           team: 'Draw',   odds: null },
    { label: `${homeName} ML`, team: homeName, odds: homeOdds },
  ];

  if (isML) return [
    { label: `${awayName} ML${awayOdds != null ? ' (' + fmtOdds(awayOdds) + ')' : ''}`, team: awayName, odds: awayOdds },
    { label: `${homeName} ML${homeOdds != null ? ' (' + fmtOdds(homeOdds) + ')' : ''}`, team: homeName, odds: homeOdds },
  ];

  if (isRunLine) {
    const suffix = betType === 'Run Line' ? 'RL' : betType === 'Puck Line' ? 'PL' : 'ATS';
    return [
      { label: `${awayName} ${suffix}`, team: `${awayName} ${suffix}`, odds: null },
      { label: `${homeName} ${suffix}`, team: `${homeName} ${suffix}`, odds: null },
    ];
  }

  if (isOver) { const t = total != null ? total : ''; return [{ label: `Over${t ? ' ' + t : ''}`, team: `Over${t ? ' ' + t : ''}`, odds: null }]; }
  if (isUnder) { const t = total != null ? total : ''; return [{ label: `Under${t ? ' ' + t : ''}`, team: `Under${t ? ' ' + t : ''}`, odds: null }]; }

  return [];
}

function fmtOdds(n) { if (n == null) return ''; return n > 0 ? `+${n}` : `${n}`; }
function toLocalDateStr(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

// ── Pulsing dots indicator ─────────────────────────────────────────────────────
function PulsingDots({ color = 'var(--gold)' }) {
  return (
    <span style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: '5px', height: '5px', borderRadius: '50%', background: color,
          animation: `pulse-dot 1.2s ${i * 0.2}s ease-in-out infinite`,
          display: 'inline-block',
        }} />
      ))}
      <style>{`
        @keyframes pulse-dot {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40%            { transform: scale(1);   opacity: 1; }
        }
      `}</style>
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function BetSlipModal({ game, sport, user, picks, setPicks, isDemo, onClose }) {
  const { away, home, odds, date } = game;
  const awayName  = away.team?.displayName || away.team?.name || 'Away';
  const homeName  = home.team?.displayName || home.team?.name || 'Home';
  const awayAbbr  = away.team?.abbreviation || 'AWY';
  const homeAbbr  = home.team?.abbreviation || 'HME';
  const gameDate  = date ? toLocalDateStr(date) : toLocalDateStr(new Date());
  const betTypes  = SPORT_BET_TYPES[sport] || DEFAULT_BET_TYPES;

  // Form state
  const [betType,    setBetType]    = useState('Moneyline');
  const [pickOpts,   setPickOpts]   = useState([]);
  const [pickIdx,    setPickIdx]    = useState(0);
  const [manualPick, setManualPick] = useState('');
  const [oddsVal,    setOddsVal]    = useState('');
  const [units,      setUnits]      = useState('1');
  const [book,       setBook]       = useState('DraftKings');
  const [notes,      setNotes]      = useState('');
  const [saving,     setSaving]     = useState(false);
  const [saved,      setSaved]      = useState(false);
  const [saveError,  setSaveError]  = useState('');

  // Voice / AI parse state
  const [voiceState,      setVoiceState]      = useState('idle'); // idle | listening | parsing | done | error
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceError,      setVoiceError]      = useState('');
  const [voiceFlash,      setVoiceFlash]      = useState(false);
  const [textInput,       setTextInput]       = useState('');   // natural language text input
  const partialRef = useRef('');

  const isOpenPick = betType === 'Prop' || betType === 'Parlay' || betType === 'Futures';

  // Rebuild pick options when bet type changes
  useEffect(() => {
    const opts = buildPickOptions(betType, awayAbbr, homeName, awayName, odds?.awayOdds, odds?.homeOdds, odds?.spread, odds?.total);
    setPickOpts(opts);
    setPickIdx(0);
    if (opts.length > 0 && opts[0].odds != null) setOddsVal(String(opts[0].odds));
    else setOddsVal('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betType]);

  // Auto-fill odds when pick changes
  useEffect(() => {
    if (pickOpts[pickIdx]?.odds != null) setOddsVal(String(pickOpts[pickIdx].odds));
  }, [pickIdx, pickOpts]);

  // ── Apply parsed AI result to form fields ──────────────────────────────────
  const applyParsed = useCallback((parsed) => {
    // Bet type
    const allTypes = SPORT_BET_TYPES[sport] || DEFAULT_BET_TYPES;
    const matchedType = allTypes.find(t =>
      t.toLowerCase() === (parsed.bet_type || '').toLowerCase()
    ) || (parsed.bet_type?.toLowerCase().includes('over') ? allTypes.find(t => t.includes('Over'))
       : parsed.bet_type?.toLowerCase().includes('under') ? allTypes.find(t => t.includes('Under'))
       : null) || betType;
    setBetType(matchedType);

    // Odds
    if (parsed.odds != null && !isNaN(parseInt(parsed.odds))) {
      setOddsVal(String(parseInt(parsed.odds)));
    }

    // Units (if mentioned)
    if (parsed.units != null && !isNaN(parseFloat(parsed.units))) {
      setUnits(String(parseFloat(parsed.units)));
    }

    // Book
    if (parsed.book) {
      const matchedBook = BOOKS.find(b => b.toLowerCase().includes((parsed.book || '').toLowerCase().split(' ')[0]));
      if (matchedBook) setBook(matchedBook);
    }

    // Notes
    if (parsed.notes) setNotes(parsed.notes);

    // Pick — try to match against pickOpts after betType is set
    // We do this in a short timeout so pickOpts re-renders first
    if (parsed.team) {
      setTimeout(() => {
        setPickOpts(currentOpts => {
          if (currentOpts.length > 0) {
            const teamLower = (parsed.team || '').toLowerCase();
            const matchIdx = currentOpts.findIndex(o =>
              o.team.toLowerCase().includes(teamLower) ||
              teamLower.includes(o.team.toLowerCase().split(' ').slice(-1)[0])
            );
            if (matchIdx >= 0) {
              setPickIdx(matchIdx);
            } else if (parsed.team) {
              setManualPick(parsed.team);
            }
          } else if (parsed.team) {
            setManualPick(parsed.team);
          }
          return currentOpts;
        });
      }, 80);
    }
  }, [betType, sport]);

  // ── Shared AI parse function ───────────────────────────────────────────────
  const parseWithAI = useCallback(async (text, source = 'voice') => {
    if (!text.trim()) return;
    setVoiceTranscript(text.trim());
    setVoiceState('parsing');
    setVoiceError('');

    try {
      const gameContext = `Game: ${awayName} @ ${homeName} (${SPORT_LABELS[sport] || sport?.toUpperCase()}) on ${gameDate}.`;
      const res = await fetch('/api/parse-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'text',
          text: `${gameContext}\n\n${source === 'voice' ? 'Voice' : 'Text'} bet input: "${text.trim()}"`,
        }),
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (!data.parsed) throw new Error('No bet data returned');

      applyParsed(data.parsed);
      setVoiceState('done');
      setVoiceFlash(true);
      if (source === 'text') setTextInput('');
      setTimeout(() => setVoiceFlash(false), 1200);
      setTimeout(() => setVoiceState('idle'), 4000);
    } catch (err) {
      setVoiceError(err.message || 'Could not parse. Try again or fill manually.');
      setVoiceState('error');
      setTimeout(() => setVoiceState('idle'), 5000);
    }
  }, [awayName, homeName, sport, gameDate, applyParsed]);

  // ── Voice recognition → AI parsing ────────────────────────────────────────
  const { listening, supported, start, stop } = useVoiceInput({
    onPartial: (text) => { partialRef.current = text; setVoiceTranscript(text); },
    onResult: (finalText) => parseWithAI(finalText, 'voice'),
  });

  // Start/stop voice
  function handleVoiceClick() {
    if (voiceState === 'listening') {
      stop();
      setVoiceState('idle');
      return;
    }
    if (voiceState === 'parsing') return; // wait
    setVoiceTranscript('');
    setVoiceError('');
    partialRef.current = '';
    setVoiceState('listening');
    start();
  }

  // Sync listening state
  useEffect(() => {
    if (!listening && voiceState === 'listening') {
      // Recognition ended naturally (not stopped manually) → result fires above
    }
  }, [listening, voiceState]);

  const handleSave = useCallback(async () => {
    const teamValue = isOpenPick ? manualPick.trim() : (pickOpts[pickIdx]?.team || '');
    if (!teamValue) { setSaveError('Please enter your pick.'); return; }
    const oddsNum = parseInt(oddsVal);
    if (!oddsVal || isNaN(oddsNum)) { setSaveError('Enter valid American odds (e.g. -110 or +133).'); return; }

    setSaving(true); setSaveError('');
    const payload = {
      user_id:  user?.id || 'demo',
      date:     gameDate,
      sport:    (SPORT_LABELS[sport] || sport?.toUpperCase() || 'Other'),
      team:     teamValue,
      bet_type: betType,
      odds:     oddsNum,
      units:    parseFloat(units) || 1,
      result:   null, profit: null,
      notes:    notes.trim() || null,
      book:     book,
    };

    try {
      if (isDemo) {
        const updated = [...(picks || []), { ...payload, id: demoId() }];
        setPicks(updated);
        saveDemoPicks(updated);
      } else {
        const { data, error } = await addPick(payload);
        if (error) throw new Error(error.message || 'Save failed');
        if (data) setPicks(prev => [...prev, data]);
      }
      setSaved(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      setSaveError(e.message || 'Save failed. Try again.');
    }
    setSaving(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpenPick, manualPick, pickOpts, pickIdx, oddsVal, units, betType, book, notes, user?.id, gameDate, sport, isDemo, picks, setPicks, onClose]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const inputStyle = {
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: '7px', padding: '0.5rem 0.7rem',
    color: 'var(--text-primary)', fontSize: '0.84rem',
    fontFamily: 'inherit', outline: 'none', width: '100%',
    transition: 'border-color 0.12s',
  };
  const labelStyle = {
    fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '5px', display: 'block',
  };

  // Voice button appearance by state
  const voiceColors = {
    idle:     { bg: 'rgba(255,184,0,0.08)', border: 'rgba(255,184,0,0.2)', color: '#FFB800', label: 'Add Bet by Voice', icon: '🎤' },
    listening:{ bg: 'rgba(255,69,96,0.12)', border: 'rgba(255,69,96,0.4)', color: '#FF4560', label: 'Listening… tap to stop', icon: '⏹' },
    parsing:  { bg: 'rgba(78,155,245,0.10)', border: 'rgba(78,155,245,0.35)', color: '#4E9BF5', label: 'AI is parsing your bet', icon: null },
    done:     { bg: 'rgba(0,212,139,0.10)', border: 'rgba(0,212,139,0.35)', color: '#00D48B', label: 'Bet loaded! Review below ↓', icon: '✓' },
    error:    { bg: 'rgba(255,69,96,0.08)', border: 'rgba(255,69,96,0.25)', color: '#FF4560', label: voiceError || 'Could not parse. Try again.', icon: '⚠' },
  };
  const vc = voiceColors[voiceState];

  return (
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
        background: voiceFlash ? 'rgba(0,212,139,0.04)' : 'var(--bg-surface)',
        border: voiceFlash ? '1px solid rgba(0,212,139,0.4)' : '1px solid rgba(255,184,0,0.3)',
        borderRadius: '14px', width: '100%', maxWidth: '460px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7), 0 0 40px rgba(255,184,0,0.06)',
        overflow: 'hidden',
        animation: 'fade-in 0.18s cubic-bezier(0.34,1.56,0.64,1)',
        transition: 'border-color 0.3s, background 0.3s',
      }}>

        {/* Header */}
        <div style={{
          padding: '1rem 1.2rem 0.85rem',
          borderBottom: '1px solid var(--border)',
          background: 'linear-gradient(135deg, rgba(255,184,0,0.08) 0%, transparent 60%)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '4px' }}>
                <span style={{ fontSize: '1.1rem' }}>{SPORT_EMOJI[sport] || '🎯'}</span>
                <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--gold)', letterSpacing: '-0.01em' }}>Add Bet</span>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 7px', borderRadius: '20px', background: 'rgba(255,184,0,0.12)', color: 'var(--gold)', border: '1px solid rgba(255,184,0,0.25)' }}>
                  {SPORT_LABELS[sport] || sport?.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                {awayAbbr} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>@</span> {homeAbbr}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: '8px', fontSize: '0.72rem' }}>
                  {new Date(gameDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1, padding: '2px 4px', transition: 'color 0.12s' }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >✕</button>
          </div>
        </div>

        {/* ── AI Bet Entry Strip (Voice + Text) ────────────────────────────── */}
        <div style={{
          margin: '0.85rem 1.2rem 0',
          border: `1px solid ${vc.border}`,
          borderRadius: '10px',
          background: vc.bg,
          overflow: 'hidden',
          transition: 'all 0.25s',
        }}>
          {/* Status banner — shown when parsing/done/error */}
          {voiceState !== 'idle' && (
            <div style={{
              padding: '0.55rem 1rem',
              borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              <div style={{
                width: '26px', height: '26px', borderRadius: '50%',
                background: vc.bg, border: `1.5px solid ${vc.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, fontSize: '0.82rem',
                animation: voiceState === 'listening' ? 'live-pulse 1.2s infinite' : 'none',
              }}>
                {voiceState === 'parsing' ? <PulsingDots color={vc.color} /> : <span>{vc.icon}</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: vc.color }}>
                  {vc.label}
                  {voiceState === 'parsing' && <span style={{ marginLeft: '6px' }}><PulsingDots color={vc.color} /></span>}
                </div>
                {voiceTranscript && (voiceState === 'parsing' || voiceState === 'done') && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '1px', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '260px' }}>
                    "{voiceTranscript}"
                  </div>
                )}
              </div>
              {voiceState === 'listening' && (
                <div style={{ fontSize: '0.6rem', fontWeight: 800, padding: '2px 6px', borderRadius: '20px', background: 'rgba(255,69,96,0.15)', color: '#FF4560', border: '1px solid rgba(255,69,96,0.3)', letterSpacing: '0.06em', flexShrink: 0 }}>
                  LIVE
                </div>
              )}
            </div>
          )}

          {/* Input row: text field + mic button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0', padding: '0.5rem 0.6rem' }}>
            {/* Natural language text input */}
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && textInput.trim() && voiceState === 'idle') parseWithAI(textInput, 'text'); }}
              placeholder='Type bet: "Yankees ML -150 2u DK" or tap mic'
              disabled={voiceState === 'parsing' || voiceState === 'listening'}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-primary)', fontSize: '0.82rem', fontFamily: 'inherit',
                padding: '0.25rem 0.4rem',
                opacity: (voiceState === 'parsing' || voiceState === 'listening') ? 0.4 : 1,
              }}
            />

            {/* Parse button (text) */}
            {textInput.trim() && voiceState === 'idle' && (
              <button
                type="button"
                onClick={() => parseWithAI(textInput, 'text')}
                style={{
                  padding: '4px 10px', borderRadius: '6px', border: 'none',
                  background: 'rgba(255,184,0,0.15)', color: '#FFB800',
                  fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
                  flexShrink: 0, marginRight: '4px',
                }}
              >
                Parse ↵
              </button>
            )}

            {/* Mic button */}
            {supported && (
              <button
                type="button"
                onClick={handleVoiceClick}
                disabled={voiceState === 'parsing'}
                title={voiceState === 'listening' ? 'Stop' : 'Speak your bet'}
                style={{
                  width: '34px', height: '34px', borderRadius: '50%', flexShrink: 0,
                  border: `1.5px solid ${voiceState === 'listening' ? 'rgba(255,69,96,0.5)' : 'rgba(255,184,0,0.25)'}`,
                  background: voiceState === 'listening' ? 'rgba(255,69,96,0.12)' : 'rgba(255,184,0,0.08)',
                  color: voiceState === 'listening' ? '#FF4560' : '#FFB800',
                  cursor: voiceState === 'parsing' ? 'wait' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.88rem', transition: 'all 0.15s',
                  animation: voiceState === 'listening' ? 'live-pulse 1.2s infinite' : 'none',
                }}
              >
                {voiceState === 'listening' ? '⏹' : '🎤'}
              </button>
            )}
          </div>

          {/* Error */}
          {voiceState === 'error' && voiceError && (
            <div style={{ padding: '0 0.8rem 0.5rem', fontSize: '0.7rem', color: '#FF4560' }}>
              {voiceError}
            </div>
          )}
        </div>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '0.7rem 1.2rem 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>or fill manually</span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
        </div>

        {/* Body */}
        <div style={{ padding: '0.85rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

          {/* Row 1: Bet Type + Pick */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={labelStyle}>Bet Type</label>
              <select value={betType} onChange={e => setBetType(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}
                onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              >
                {betTypes.map(bt => <option key={bt} value={bt}>{bt}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Pick</label>
              {isOpenPick ? (
                <input value={manualPick} onChange={e => setManualPick(e.target.value)}
                  placeholder={betType === 'Parlay' ? 'e.g. LAD ML + Over 8' : 'Describe your prop…'}
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                />
              ) : (
                <select value={pickIdx} onChange={e => setPickIdx(Number(e.target.value))} style={{ ...inputStyle, cursor: 'pointer' }}
                  onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                >
                  {pickOpts.length === 0
                    ? <option value={0}>Select bet type first</option>
                    : pickOpts.map((o, i) => <option key={i} value={i}>{o.label}</option>)
                  }
                </select>
              )}
            </div>
          </div>

          {/* Row 2: Odds + Units */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <label style={labelStyle}>Odds (American)</label>
              <input value={oddsVal} onChange={e => setOddsVal(e.target.value)}
                placeholder="-110 or +133"
                style={{ ...inputStyle, fontFamily: 'IBM Plex Mono, monospace', color: parseInt(oddsVal) > 0 ? 'var(--green)' : parseInt(oddsVal) < 0 ? 'var(--text-secondary)' : 'var(--text-primary)' }}
                onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            <div>
              <label style={labelStyle}>Units</label>
              <input value={units} onChange={e => setUnits(e.target.value)}
                placeholder="1.0" type="number" min="0.1" step="0.5"
                style={{ ...inputStyle, fontFamily: 'IBM Plex Mono, monospace' }}
                onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
          </div>

          {/* Row 3: Sportsbook */}
          <div>
            <label style={labelStyle}>Sportsbook</label>
            <select value={book} onChange={e => setBook(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}
              onFocus={e => e.target.style.borderColor = 'var(--gold)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            >
              {BOOKS.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {/* Row 4: Notes */}
          <div>
            <label style={labelStyle}>Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Sharp money on this side… public fading… weather angle…"
              rows={2}
              style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }}
              onFocus={e => e.target.style.borderColor = 'var(--gold)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {/* Error */}
          {saveError && (
            <div style={{ padding: '0.5rem 0.75rem', background: 'var(--red-subtle)', border: '1px solid rgba(255,69,96,0.2)', borderRadius: '7px', color: 'var(--red)', fontSize: '0.78rem' }}>
              ⚠️ {saveError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '0.85rem 1.2rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-elevated)' }}>
          <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '7px', padding: '0.45rem 1rem', color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Cancel
          </button>

          {saved ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--green)', fontWeight: 700, fontSize: '0.88rem' }}>
              <span style={{ fontSize: '1.1rem' }}>✅</span> Bet saved!
            </div>
          ) : (
            <button onClick={handleSave} disabled={saving} style={{
              background: saving ? 'var(--bg-overlay)' : 'linear-gradient(135deg, #FFB800 0%, #FF9500 100%)',
              color: saving ? 'var(--text-muted)' : '#0a0a0a',
              border: 'none', borderRadius: '7px', padding: '0.5rem 1.4rem',
              fontSize: '0.88rem', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', boxShadow: saving ? 'none' : '0 2px 10px rgba(255,184,0,0.3)',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              {saving ? '⟳ Saving…' : '💾 Save Bet'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
