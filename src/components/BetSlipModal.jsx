'use client';
import { useState, useEffect, useCallback } from 'react';
import { addPick } from '@/lib/supabase';
import { saveDemoPicks, demoId } from '@/lib/demoData';
import VoiceButton from '@/components/VoiceInput';

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

// Build pick options based on bet type + live game odds
function buildPickOptions(betType, awayAbbr, homeName, awayName, awayOdds, homeOdds, spread, total) {
  const isML       = betType === 'Moneyline' || betType === 'F5 Moneyline';
  const isRunLine  = betType === 'Run Line' || betType === 'Puck Line' || betType === 'Spread' || betType === '1H Spread' || betType === '1Q Spread';
  const isOver     = betType.includes('Over');
  const isUnder    = betType.includes('Under');
  const isDraw     = betType === 'Draw';

  if (isDraw) {
    return [
      { label: `${awayName} ML`, team: awayName, odds: awayOdds },
      { label: 'Draw',           team: 'Draw',   odds: null },
      { label: `${homeName} ML`, team: homeName, odds: homeOdds },
    ];
  }

  if (isML) {
    return [
      { label: `${awayName} ML${awayOdds != null ? ' (' + fmtOdds(awayOdds) + ')' : ''}`, team: awayName, odds: awayOdds },
      { label: `${homeName} ML${homeOdds != null ? ' (' + fmtOdds(homeOdds) + ')' : ''}`, team: homeName, odds: homeOdds },
    ];
  }

  if (isRunLine) {
    const suffix = betType === 'Run Line' ? 'RL' : betType === 'Puck Line' ? 'PL' : 'ATS';
    return [
      { label: `${awayName} ${suffix}`, team: `${awayName} ${suffix}`, odds: null },
      { label: `${homeName} ${suffix}`, team: `${homeName} ${suffix}`, odds: null },
    ];
  }

  if (isOver) {
    const t = total != null ? total : '';
    return [{ label: `Over${t ? ' ' + t : ''}`, team: `Over${t ? ' ' + t : ''}`, odds: null }];
  }

  if (isUnder) {
    const t = total != null ? total : '';
    return [{ label: `Under${t ? ' ' + t : ''}`, team: `Under${t ? ' ' + t : ''}`, odds: null }];
  }

  // Prop / Parlay / etc — let user type freely
  return [];
}

function fmtOdds(n) {
  if (n == null) return '';
  return n > 0 ? `+${n}` : `${n}`;
}

function toLocalDateStr(d) {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
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
  const [betType,   setBetType]   = useState('Moneyline');
  const [pickOpts,  setPickOpts]  = useState([]);
  const [pickIdx,   setPickIdx]   = useState(0);
  const [manualPick, setManualPick] = useState(''); // for Prop/Parlay
  const [oddsVal,   setOddsVal]   = useState('');
  const [units,     setUnits]     = useState('1');
  const [book,      setBook]      = useState('DraftKings');
  const [notes,     setNotes]     = useState('');
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [saveError, setSaveError] = useState('');

  const isOpenPick = betType === 'Prop' || betType === 'Parlay' || betType === 'Futures';

  // Rebuild pick options when bet type changes
  useEffect(() => {
    const opts = buildPickOptions(
      betType, awayAbbr, homeName, awayName,
      odds?.awayOdds, odds?.homeOdds,
      odds?.spread, odds?.total,
    );
    setPickOpts(opts);
    setPickIdx(0);
    // Auto-fill odds from first option
    if (opts.length > 0 && opts[0].odds != null) {
      setOddsVal(String(opts[0].odds));
    } else {
      setOddsVal('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [betType]);

  // Auto-fill odds when pick changes
  useEffect(() => {
    if (pickOpts[pickIdx]?.odds != null) {
      setOddsVal(String(pickOpts[pickIdx].odds));
    }
  }, [pickIdx, pickOpts]);

  const handleSave = useCallback(async () => {
    const teamValue = isOpenPick
      ? manualPick.trim()
      : (pickOpts[pickIdx]?.team || '');

    if (!teamValue) { setSaveError('Please enter your pick.'); return; }
    const oddsNum = parseInt(oddsVal);
    if (!oddsVal || isNaN(oddsNum)) { setSaveError('Enter valid American odds (e.g. -110 or +133).'); return; }

    setSaving(true);
    setSaveError('');

    const payload = {
      user_id:  user?.id || 'demo',
      date:     gameDate,
      sport:    (SPORT_LABELS[sport] || sport?.toUpperCase() || 'Other'),
      team:     teamValue,
      bet_type: betType,
      odds:     oddsNum,
      units:    parseFloat(units) || 1,
      result:   null,
      profit:   null,
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

  // Close on Escape
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

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 8000,
          background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)',
        }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', top: '50%', left: '50%', zIndex: 8001,
        transform: 'translate(-50%, -50%)',
        background: 'var(--bg-surface)',
        border: '1px solid rgba(255,184,0,0.3)',
        borderRadius: '14px',
        width: '100%', maxWidth: '460px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.7), 0 0 40px rgba(255,184,0,0.06)',
        overflow: 'hidden',
        animation: 'fade-in 0.18s cubic-bezier(0.34,1.56,0.64,1)',
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
                <span style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--gold)', letterSpacing: '-0.01em' }}>
                  Add Bet
                </span>
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
            <button onClick={onClose} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: '1.2rem', lineHeight: 1, padding: '2px 4px',
              transition: 'color 0.12s',
            }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
            >✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '1.1rem 1.2rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>

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
                <input
                  value={manualPick}
                  onChange={e => setManualPick(e.target.value)}
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
              <input
                value={oddsVal}
                onChange={e => setOddsVal(e.target.value)}
                placeholder="-110 or +133"
                style={{
                  ...inputStyle,
                  fontFamily: 'IBM Plex Mono, monospace',
                  color: parseInt(oddsVal) > 0 ? 'var(--green)' : parseInt(oddsVal) < 0 ? 'var(--text-secondary)' : 'var(--text-primary)',
                }}
                onFocus={e => e.target.style.borderColor = 'var(--gold)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            <div>
              <label style={labelStyle}>Units</label>
              <input
                value={units}
                onChange={e => setUnits(e.target.value)}
                placeholder="1.0"
                type="number" min="0.1" step="0.5"
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
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></span>
              <VoiceButton value={notes} onChange={setNotes} size="sm" />
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
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
        <div style={{
          padding: '0.85rem 1.2rem',
          borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'var(--bg-elevated)',
        }}>
          <button onClick={onClose} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: '7px',
            padding: '0.45rem 1rem', color: 'var(--text-secondary)',
            fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Cancel
          </button>

          {saved ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--green)', fontWeight: 700, fontSize: '0.88rem' }}>
              <span style={{ fontSize: '1.1rem' }}>✅</span> Bet saved!
            </div>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                background: saving ? 'var(--bg-overlay)' : 'linear-gradient(135deg, #FFB800 0%, #FF9500 100%)',
                color: saving ? 'var(--text-muted)' : '#0a0a0a',
                border: 'none', borderRadius: '7px',
                padding: '0.5rem 1.4rem',
                fontSize: '0.88rem', fontWeight: 800,
                cursor: saving ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                boxShadow: saving ? 'none' : '0 2px 10px rgba(255,184,0,0.3)',
                transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              {saving ? '⟳ Saving…' : '💾 Save Bet'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
