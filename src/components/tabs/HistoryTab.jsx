'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { addPick, updatePick, deletePick, fetchParlayLegs, submitParlay } from '@/lib/supabase';
import { saveDemoPicks, saveDemoContest, demoId } from '@/lib/demoData';
import { playWin, playLoss, playGrade } from '@/lib/sounds';
import { validateContestEntry, DEFAULT_CONTEST_RULES } from '@/lib/contestValidation';

// ── Live Score Engine ─────────────────────────────────────────────────────────
// Polls ESPN every 30s for PENDING picks whose game is today.
// Returns a map of { pickId → liveData } and fires onGameFinal when STATUS_FINAL detected.

const LIVE_SPORT_PATHS = {
  mlb: 'baseball/mlb', nfl: 'football/nfl', nba: 'basketball/nba',
  nhl: 'hockey/nhl', ncaaf: 'football/college-football',
  ncaab: 'basketball/mens-college-basketball', mls: 'soccer/usa.1',
  wnba: 'basketball/wnba',
};

function liveNorm(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}
function liveTeamMatches(a, b) {
  if (!a || !b) return false;
  const n1 = liveNorm(a), n2 = liveNorm(b);
  if (!n1 || !n2) return false;
  return n1 === n2 || n1.includes(n2) || n2.includes(n1);
}
function liveParseSide(matchup, pickTeam) {
  // "BOS @ TB" → away=bos, home=tb; match against pickTeam
  if (!matchup || !pickTeam) return null;
  const lower = matchup.toLowerCase();
  const atIdx = lower.indexOf(' @ ');
  const vsIdx = lower.indexOf(' vs ');
  let awayHint, homeHint;
  if (atIdx > -1) { awayHint = liveNorm(matchup.slice(0, atIdx)); homeHint = liveNorm(matchup.slice(atIdx + 3)); }
  else if (vsIdx > -1) { awayHint = liveNorm(matchup.slice(0, vsIdx)); homeHint = liveNorm(matchup.slice(vsIdx + 4)); }
  else return null;
  const teamN = liveNorm(pickTeam);
  if (awayHint?.length >= 2 && (teamN.includes(awayHint) || awayHint.includes(teamN.slice(0, 4)))) return 'away';
  if (homeHint?.length >= 2 && (teamN.includes(homeHint) || homeHint.includes(teamN.slice(0, 4)))) return 'home';
  return null;
}

function useLiveScores(pendingPicks, user, isDemo, onGameFinal) {
  const [liveScores, setLiveScores]   = useState({});
  const gradedGamesRef = useRef(new Set()); // game IDs we've already triggered grading for
  const initializedRef = useRef(false);

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const todayPicks = pendingPicks.filter(p =>
    (p.result === 'PENDING' || !p.result) && (p.date === todayStr || p.date === yesterdayStr)
  );

  const pollKey = todayPicks.map(p => p.id).sort().join(',');

  useEffect(() => {
    if (!todayPicks.length || isDemo) return;

    const uniqueSports = [...new Set(todayPicks.map(p => (p.sport || '').toLowerCase()).filter(s => LIVE_SPORT_PATHS[s]))];
    if (!uniqueSports.length) return;

    async function fetchLiveData() {
      const newScores = {};

      for (const sport of uniqueSports) {
        try {
          const res = await fetch(`/api/sports?sport=${sport}&endpoint=scoreboard`);
          if (!res.ok) continue;
          const data = await res.json();
          const events = data.events || [];

          for (const event of events) {
            const comp        = event.competitions?.[0];
            const competitors = comp?.competitors || [];
            const homeComp    = competitors.find(c => c.homeAway === 'home');
            const awayComp    = competitors.find(c => c.homeAway === 'away');
            if (!homeComp || !awayComp) continue;

            const homeTeam   = homeComp.team?.displayName || homeComp.team?.name || '';
            const awayTeam   = awayComp.team?.displayName || awayComp.team?.name || '';
            const homeAbbr   = homeComp.team?.abbreviation || homeComp.team?.shortDisplayName || homeTeam.split(' ').pop();
            const awayAbbr   = awayComp.team?.abbreviation || awayComp.team?.shortDisplayName || awayTeam.split(' ').pop();
            const homeScore  = parseFloat(homeComp.score || 0);
            const awayScore  = parseFloat(awayComp.score || 0);
            const statusName = comp?.status?.type?.name || '';
            const statusState= comp?.status?.type?.state || '';
            const displayClock = comp?.status?.displayClock || '';
            const period     = comp?.status?.period || 0;

            const isFinal = ['STATUS_FINAL', 'STATUS_FULL_TIME'].includes(statusName);
            const isLive  = statusState === 'in';
            const gameDateStr = event.date ? event.date.split('T')[0] : todayStr;

            // Format period/clock display
            let periodLabel = '';
            if (isLive) {
              if (sport === 'nhl' || sport === 'nba') periodLabel = period ? `P${period} ${displayClock}` : displayClock;
              else if (sport === 'mlb') periodLabel = `Inn ${period} ${displayClock}`;
              else if (sport === 'nfl') periodLabel = period ? `Q${period} ${displayClock}` : displayClock;
              else periodLabel = displayClock || `${period}`;
            }

            // Match against today's PENDING picks
            for (const pick of todayPicks.filter(p => (p.sport || '').toLowerCase() === sport)) {
              const matchesGame = liveTeamMatches(homeTeam, pick.team) || liveTeamMatches(awayTeam, pick.team)
                || (pick.home_team && liveTeamMatches(homeTeam, pick.home_team))
                || (pick.away_team && liveTeamMatches(awayTeam, pick.away_team));

              if (!matchesGame) continue;

              // Determine if this pick is currently winning
              const pickedSide = (pick.side || '').toLowerCase()
                || (liveTeamMatches(homeTeam, pick.team) ? 'home' : null)
                || (liveTeamMatches(awayTeam, pick.team) ? 'away' : null)
                || liveParseSide(pick.matchup, pick.team);

              let liveStatus = null;
              if (pickedSide === 'home') {
                liveStatus = homeScore > awayScore ? 'WINNING' : homeScore < awayScore ? 'LOSING' : 'TIED';
              } else if (pickedSide === 'away') {
                liveStatus = awayScore > homeScore ? 'WINNING' : awayScore < homeScore ? 'LOSING' : 'TIED';
              }

              newScores[pick.id] = {
                homeTeam, awayTeam, homeAbbr, awayAbbr,
                homeScore, awayScore,
                isLive, isFinal, periodLabel,
                liveStatus,
                gameDate: gameDateStr,
                eventId: event.id,
              };

              // Trigger instant grading when game just went FINAL (only once per game)
              if (isFinal && !gradedGamesRef.current.has(event.id) && initializedRef.current) {
                gradedGamesRef.current.add(event.id);
                onGameFinal?.({ sport, homeTeam, awayTeam, homeScore, awayScore, gameDate: gameDateStr });
              }
              // On first load, mark already-final games so we don't re-grade them
              if (isFinal && !initializedRef.current) {
                gradedGamesRef.current.add(event.id);
              }
            }
          }
        } catch (e) {
          // fail silently — live scores are bonus
        }
      }

      setLiveScores(newScores);
      initializedRef.current = true;
    }

    fetchLiveData();
    const interval = setInterval(fetchLiveData, 30_000);
    return () => clearInterval(interval);
  }, [pollKey, isDemo]); // eslint-disable-line

  return liveScores;
}

const SPORTS  = ['MLB', 'NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB', 'Soccer', 'UFC', 'Other'];
const BET_TYPES = ['Moneyline', 'Spread', 'Total (Over)', 'Total (Under)', 'Prop', 'Parlay', 'Teaser', 'Futures'];
const BOOKS   = ['FanDuel', 'DraftKings', 'BetMGM', 'Caesars', 'PointsBet', 'Bet365', 'Pinnacle', 'Other'];
const RESULTS = ['WIN', 'LOSS', 'PUSH', 'PENDING'];

const SPORT_EMOJI = {
  MLB: '⚾', NBA: '🏀', NFL: '🏈', NHL: '🏒', NCAAF: '🏈',
  NCAAB: '🏀', MLS: '⚽', WNBA: '🏀', UFC: '🥊', Tennis: '🎾',
};
function sportEmoji(sport) {
  return SPORT_EMOJI[(sport || '').toUpperCase()] || '🎯';
}

const EMPTY_FORM = {
  date: new Date().toISOString().split('T')[0],
  sport: 'MLB',
  team: '',
  bet_type: 'Moneyline',
  matchup: '',
  odds: '',
  book: 'FanDuel',
  result: 'PENDING',
  profit: '',
  notes: '',
  contest_entry: false,
  commence_time: null,  // populated by /api/verify-game on submit
};

function calcProfit(odds, result) {
  if (result === 'PUSH') return 0;
  if (result !== 'WIN' && result !== 'LOSS') return '';
  const o = parseInt(odds);
  if (!o) return '';
  const payout = o > 0 ? o / 100 : 100 / Math.abs(o);
  return result === 'WIN' ? parseFloat(payout.toFixed(3)) : -1;
}

function ResultBadge({ result }) {
  const cls = `badge-${result?.toLowerCase() || 'pending'}`;
  return (
    <span className={cls} style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 700 }}>
      {result || 'PENDING'}
    </span>
  );
}

// ── Slip Import ───────────────────────────────────────────────────────────────

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function SlipImport({ onFilled, onSubmitParlay, onSaveMultiple }) {
  const [mode, setMode]               = useState('image'); // 'image' | 'url' | 'text'
  const [file, setFile]               = useState(null);
  const [url, setUrl]                 = useState('');
  const [text, setText]               = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [parsedPicks, setParsedPicks] = useState(null); // array of picks or null
  const [open, setOpen]               = useState(false);
  const [parlaySubmitting, setParlaySubmitting] = useState(false);
  const [saveAllLoading, setSaveAllLoading]     = useState(false);
  const fileRef                       = useRef();

  function resetParsed() { setParsedPicks(null); }

  async function handleParse() {
    setLoading(true);
    setError('');
    setParsedPicks(null);
    try {
      let body;
      if (mode === 'image') {
        if (!file) throw new Error('Select a screenshot first');
        const base64 = await fileToBase64(file);
        body = { type: 'image', data: base64, mimeType: file.type };
      } else if (mode === 'url') {
        if (!url.trim()) throw new Error('Enter a share link');
        body = { type: 'url', url: url.trim() };
      } else {
        if (!text.trim()) throw new Error('Paste your bet slip text');
        body = { type: 'text', text: text.trim() };
      }

      const res = await fetch('/api/parse-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Parse failed');

      // API returns { picks: [...] } — always an array
      const picks = Array.isArray(data.picks) ? data.picks
        : data.parsed ? [data.parsed]  // backward compat
        : [];
      if (!picks.length) throw new Error('No picks detected in the slip');
      setParsedPicks(picks);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function removePick(index) {
    setParsedPicks(prev => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : null;
    });
  }

  function handleUse() {
    if (!parsedPicks?.length) return;
    const p = parsedPicks[0];
    onFilled({
      date:     p.date     || new Date().toISOString().split('T')[0],
      sport:    p.sport    || 'MLB',
      team:     p.team     || '',
      bet_type: p.bet_type || 'Moneyline',
      matchup:  p.matchup  || '',
      odds:     p.odds?.toString() || '',
      book:     p.book     || 'FanDuel',
      result:   'PENDING',
      profit:   '',
      notes:    p.notes    || '',
    });
    setParsedPicks(null);
    setFile(null); setUrl(''); setText('');
    setOpen(false);
  }

  async function handleSubmitParlay() {
    if (!parsedPicks?.length || !onSubmitParlay) return;
    const parsed = parsedPicks[0];
    if (!parsed?.parlay_legs?.length) return;
    setParlaySubmitting(true);
    setError('');
    try {
      const legs = parsed.parlay_legs.map(l => ({
        team:      l.team     || '',
        sport:     l.sport    || parsed.sport || 'Other',
        bet_type:  l.bet_type || 'Moneyline',
        line:      l.line     ?? null,
        odds:      l.odds     ?? null,
        game_date: parsed.date || null,
      }));
      await onSubmitParlay({
        units: parsed.units ?? 1,
        book:  parsed.book  ?? null,
        date:  parsed.date  ?? null,
        notes: parsed.notes ?? null,
      }, legs);
      setParsedPicks(null);
      setFile(null); setUrl(''); setText('');
      setOpen(false);
    } catch (e) {
      setError(e.message || 'Parlay submit failed');
    } finally {
      setParlaySubmitting(false);
    }
  }

  async function handleSaveAll() {
    if (!parsedPicks?.length || !onSaveMultiple) return;
    setSaveAllLoading(true);
    setError('');
    try {
      await onSaveMultiple(parsedPicks);
      setParsedPicks(null);
      setFile(null); setUrl(''); setText('');
      setOpen(false);
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaveAllLoading(false);
    }
  }

  const MODES = [
    { id: 'image', label: '📸 Screenshot' },
    { id: 'url',   label: '🔗 Share Link' },
    { id: 'text',  label: '📋 Paste Text' },
  ];

  const firstPick = parsedPicks?.[0];
  const isMulti   = parsedPicks && parsedPicks.length > 1;
  const isParlay  = !isMulti && firstPick?.bet_type === 'Parlay' && firstPick?.parlay_legs?.length >= 2;

  return (
    <div className="surface" style={{ marginBottom: '1.25rem', overflow: 'hidden' }}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'none', border: 'none', cursor: 'pointer',
          padding: '0.9rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1rem' }}>📸</span>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Quick Import from Bet Slip</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Screenshot, share link, or paste</span>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 1.25rem 1.25rem' }}>
          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '1rem' }}>
            {MODES.map(m => (
              <button
                key={m.id}
                onClick={() => { setMode(m.id); resetParsed(); setError(''); }}
                style={{
                  padding: '5px 12px', borderRadius: '6px', fontSize: '0.8rem', cursor: 'pointer',
                  border: `1px solid ${mode === m.id ? 'var(--gold)' : 'var(--border)'}`,
                  background: mode === m.id ? 'var(--gold-subtle)' : 'var(--bg-elevated)',
                  color: mode === m.id ? 'var(--gold)' : 'var(--text-muted)',
                  fontWeight: mode === m.id ? 600 : 400,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Input area */}
          {mode === 'image' && (
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                border: `2px dashed ${file ? 'var(--gold)' : 'var(--border)'}`,
                borderRadius: '8px', padding: '1.5rem', textAlign: 'center', cursor: 'pointer',
                background: file ? 'var(--gold-subtle)' : 'var(--bg-elevated)',
                marginBottom: '0.75rem',
              }}
            >
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { setFile(e.target.files[0]); resetParsed(); }} />
              {file
                ? <p style={{ color: 'var(--gold)', fontSize: '0.85rem', fontWeight: 600 }}>✓ {file.name}</p>
                : <>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Click to upload a bet slip screenshot</p>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '4px' }}>Works with FanDuel, DraftKings, BetMGM, Caesars, and more</p>
                  </>
              }
            </div>
          )}

          {mode === 'url' && (
            <input
              className="input"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="Paste sportsbook share link... e.g. https://fanduel.com/..."
              style={{ marginBottom: '0.75rem' }}
            />
          )}

          {mode === 'text' && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{
                background: 'var(--bg-overlay)',
                border: '1px solid rgba(255,184,0,0.15)',
                borderRadius: '8px',
                padding: '0.6rem 0.85rem',
                marginBottom: '0.6rem',
                display: 'flex', gap: '8px', alignItems: 'flex-start',
              }}>
                <span style={{ fontSize: '0.85rem', flexShrink: 0, marginTop: '1px' }}>💡</span>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <strong style={{ color: 'var(--gold)' }}>No slip? No problem.</strong> Just type your bet in plain language and we'll extract it automatically.
                  <br />
                  <span style={{ color: 'var(--text-muted)' }}>
                    e.g. <em>"Yankees ML -145 FanDuel"</em> or <em>"Dodgers -1.5 at -110, tonight vs Giants, DraftKings"</em>
                  </span>
                </div>
              </div>
              <textarea
                className="input"
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder={'Type or paste your bet — team, odds, matchup, book...\n\nExamples:\n  "Yankees moneyline -145 tonight"\n  "Over 8.5 runs, Cubs vs Cardinals, -110 FanDuel"\n  "Chiefs -3 spread, DraftKings"'}
                rows={5}
                style={{ resize: 'vertical' }}
              />
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleParse}
            disabled={loading}
            style={{ fontSize: '0.85rem' }}
          >
            {loading ? '🔍 Parsing...' : '🔍 Parse Slip'}
          </button>

          {error && (
            <div style={{ marginTop: '0.75rem', color: 'var(--red)', fontSize: '0.82rem', background: 'var(--red-subtle)', border: '1px solid rgba(255,69,96,0.2)', borderRadius: '6px', padding: '0.6rem 0.9rem' }}>
              {error}
            </div>
          )}

          {/* Preview */}
          {parsedPicks && parsedPicks.length > 0 && (
            <div style={{ marginTop: '1rem', background: 'var(--bg-elevated)', border: '1px solid var(--gold)', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '0.85rem' }}>
                  {isMulti ? `✓ ${parsedPicks.length} Picks Found — Review & Confirm` : '✓ Parsed Successfully'}
                </span>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {/* Parlay: submit all legs as one parlay pick */}
                  {isParlay && onSubmitParlay && (
                    <button
                      className="btn"
                      onClick={handleSubmitParlay}
                      disabled={parlaySubmitting}
                      style={{
                        fontSize: '0.78rem', padding: '4px 12px',
                        background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.4)',
                        color: '#c084fc', borderRadius: '6px', cursor: 'pointer', fontWeight: 700,
                      }}
                    >
                      {parlaySubmitting ? 'Submitting…' : `🎰 Submit ${firstPick.parlay_legs.length}-Leg Parlay`}
                    </button>
                  )}
                  {/* Single non-parlay: fill the form */}
                  {!isMulti && !isParlay && (
                    <button className="btn btn-primary" onClick={handleUse} style={{ fontSize: '0.78rem', padding: '4px 12px' }}>
                      Fill Form →
                    </button>
                  )}
                  {/* Multiple picks: save all at once */}
                  {isMulti && onSaveMultiple && (
                    <button
                      className="btn btn-primary"
                      onClick={handleSaveAll}
                      disabled={saveAllLoading}
                      style={{ fontSize: '0.78rem', padding: '4px 12px' }}
                    >
                      {saveAllLoading ? 'Saving…' : `Save ${parsedPicks.length} Picks`}
                    </button>
                  )}
                </div>
              </div>

              {/* Multi-pick review list */}
              {isMulti ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {parsedPicks.map((p, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '7px 10px', borderRadius: '6px',
                      background: 'var(--bg-overlay)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.team || '—'}
                          {p.line != null ? ` ${p.line > 0 ? '+' : ''}${p.line}` : ''}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {p.sport} · {p.bet_type}
                          {p.odds ? ` · ${p.odds > 0 ? '+' : ''}${p.odds}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => removePick(i)}
                        title="Remove this pick"
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-muted)', fontSize: '1.1rem', padding: '2px 5px',
                          lineHeight: 1, flexShrink: 0,
                        }}
                      >×</button>
                    </div>
                  ))}
                </div>
              ) : (
                /* Single pick detail grid */
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', fontSize: '0.8rem' }}>
                    {[
                      ['Team / Pick', firstPick.team],
                      ['Sport',       firstPick.sport],
                      ['Bet Type',    firstPick.bet_type],
                      ['Line',        firstPick.line != null ? `${firstPick.line > 0 ? '+' : ''}${firstPick.line}` : null],
                      ['Odds',        firstPick.odds ? `${firstPick.odds > 0 ? '+' : ''}${firstPick.odds}` : null],
                      ['Book',        firstPick.book],
                      ['Date',        firstPick.date],
                    ].filter(([, v]) => v != null && v !== '').map(([label, value]) => (
                      <div key={label}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{value}</div>
                      </div>
                    ))}
                  </div>
                  {firstPick.matchup && (
                    <div style={{ marginTop: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {firstPick.matchup}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Pick Form ─────────────────────────────────────────────────────────────────

function PickForm({ form, setForm, onSave, onCancel, saving }) {
  const [notesParsing, setNotesParsing] = useState(false);
  const [notesParsed, setNotesParsed] = useState(false);

  // ── Game verification ───────────────────────────────────────────────────
  const [gameVerify, setGameVerify] = useState(null); // null | { status, game, warning, error }
  const [verifying, setVerifying] = useState(false);
  const verifyTimerRef = useRef(null);

  // Re-verify whenever sport / team / date change (debounced 800ms)
  useEffect(() => {
    // Only run on new picks (no form.id = edit mode)
    if (form.id) return;
    const { sport, team, date } = form;
    if (!sport || !team?.trim() || !date) { setGameVerify(null); return; }

    clearTimeout(verifyTimerRef.current);
    verifyTimerRef.current = setTimeout(async () => {
      setVerifying(true);
      try {
        const res = await fetch(
          `/api/verify-game?sport=${encodeURIComponent(sport)}&team=${encodeURIComponent(team.trim())}&date=${date}`
        );
        const data = await res.json();
        setGameVerify(data);
        // Auto-store commence_time in form so it gets saved with the pick
        if (data.found && data.game?.commence_time) {
          setForm(prev => ({ ...prev, commence_time: data.game.commence_time }));
        } else {
          setForm(prev => ({ ...prev, commence_time: null }));
        }
      } catch {
        setGameVerify({ found: false, error: 'Could not reach verification service.' });
        setForm(prev => ({ ...prev, commence_time: null }));
      }
      setVerifying(false);
    }, 800);

    return () => clearTimeout(verifyTimerRef.current);
  }, [form.sport, form.team, form.date, form.id]); // eslint-disable-line

  function handleChange(field, val) {
    setForm(prev => {
      const updated = { ...prev, [field]: val };
      // Auto-calc profit when result or odds change
      if (field === 'result' || field === 'odds') {
        const p = calcProfit(
          field === 'odds' ? val : prev.odds,
          field === 'result' ? val : prev.result
        );
        if (p !== '') updated.profit = p;
      }
      return updated;
    });
    if (field === 'notes') setNotesParsed(false);
  }

  async function handleNotesParse() {
    if (!form.notes?.trim()) return;
    setNotesParsing(true);
    setNotesParsed(false);
    try {
      const res = await fetch('/api/parse-slip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text', text: form.notes }),
      });
      const data = await res.json();
      if (data.parsed) {
        setForm(prev => ({
          ...prev,
          ...(data.parsed.sport    && { sport:    data.parsed.sport }),
          ...(data.parsed.team     && { team:     data.parsed.team }),
          ...(data.parsed.matchup  && { matchup:  data.parsed.matchup }),
          ...(data.parsed.bet_type && { bet_type: data.parsed.bet_type }),
          ...(data.parsed.odds     && { odds:     String(data.parsed.odds) }),
          ...(data.parsed.book     && { book:     data.parsed.book }),
          ...(data.parsed.date     && { date:     data.parsed.date }),
          notes: prev.notes,
        }));
        setNotesParsed(true);
      }
    } catch {}
    setNotesParsing(false);
  }

  return (
    <div className="card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
      <h3 style={{ fontWeight: 700, color: '#FFB800', marginBottom: '1.2rem', fontSize: '0.95rem' }}>
        {form.id ? '✏️ Edit Pick' : '➕ Add New Pick'}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.9rem' }}>
        {[
          { label: 'Date', field: 'date', type: 'date' },
          { label: 'Sport', field: 'sport', type: 'select', options: SPORTS },
          { label: 'Team / Pick', field: 'team', type: 'text', placeholder: 'Pittsburgh Pirates' },
          { label: 'Bet Type', field: 'bet_type', type: 'select', options: BET_TYPES },
          { label: 'Matchup', field: 'matchup', type: 'text', placeholder: 'BAL at PIT' },
          { label: 'Odds', field: 'odds', type: 'number', placeholder: '+105 or -118' },
          { label: 'Book', field: 'book', type: 'select', options: BOOKS },
          { label: 'Result', field: 'result', type: 'select', options: RESULTS },
          { label: 'Profit (units)', field: 'profit', type: 'number', placeholder: 'Auto-calc or manual' },
        ].map(({ label, field, type, options, placeholder }) => (
          <div key={field}>
            <label style={{ display: 'block', color: '#aaa', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>
              {label}
            </label>
            {type === 'select' ? (
              <select
                className="input"
                value={form[field]}
                onChange={(e) => handleChange(field, e.target.value)}
                style={{ background: '#1a1a1a' }}
              >
                {options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                className="input"
                type={type}
                placeholder={placeholder}
                value={form[field]}
                onChange={(e) => handleChange(field, e.target.value)}
              />
            )}
          </div>
        ))}
        {/* Notes — full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
            <label style={{ color: '#aaa', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Notes
            </label>
            <button
              type="button"
              onClick={handleNotesParse}
              disabled={notesParsing || !form.notes?.trim()}
              title="Let AI auto-fill the form from your typed bet"
              style={{
                background: notesParsed ? 'rgba(0,212,139,0.12)' : 'rgba(255,184,0,0.1)',
                border: `1px solid ${notesParsed ? 'rgba(0,212,139,0.3)' : 'rgba(255,184,0,0.3)'}`,
                color: notesParsed ? 'var(--green)' : 'var(--gold)',
                borderRadius: '6px', padding: '2px 10px', fontSize: '0.72rem',
                fontWeight: 700, cursor: notesParsing || !form.notes?.trim() ? 'not-allowed' : 'pointer',
                opacity: !form.notes?.trim() ? 0.4 : 1, transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: '4px',
              }}
            >
              {notesParsing ? '⏳ Parsing...' : notesParsed ? '✓ Fields Filled' : '🤖 Auto-Fill'}
            </button>
          </div>
          <textarea
            className="input"
            placeholder='Type your bet naturally — e.g. "LAD ML -135 FanDuel tonight vs SD" — then hit Auto-Fill'
            value={form.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            rows={2}
            style={{ resize: 'vertical' }}
          />
          {notesParsed && (
            <div style={{ fontSize: '0.7rem', color: 'var(--green)', marginTop: '4px' }}>
              ✓ Fields auto-filled from your notes — review and adjust as needed
            </div>
          )}
        </div>

        {/* Contest entry toggle — full width with inline validation */}
        <div style={{ gridColumn: '1 / -1' }}>
          {(() => {
            const cv = validateContestEntry(form, DEFAULT_CONTEST_RULES);
            const blocked = !cv.valid && !form.contest_entry; // only block when trying to enable
            return (
              <>
                <button
                  type="button"
                  onClick={() => {
                    if (!form.contest_entry && !cv.valid) return; // blocked by validation
                    handleChange('contest_entry', !form.contest_entry);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    background: form.contest_entry ? 'rgba(255,184,0,0.08)' : blocked ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${form.contest_entry ? 'rgba(255,184,0,0.4)' : blocked ? 'rgba(248,113,113,0.3)' : 'var(--border)'}`,
                    borderRadius: '8px', padding: '0.75rem 1rem',
                    cursor: blocked ? 'not-allowed' : 'pointer',
                    width: '100%', transition: 'all 0.15s',
                    opacity: blocked ? 0.75 : 1,
                  }}
                >
                  {/* Toggle switch */}
                  <div style={{
                    width: '40px', height: '22px', borderRadius: '11px', border: 'none',
                    background: form.contest_entry ? 'var(--gold)' : blocked ? 'rgba(248,113,113,0.4)' : 'var(--border)',
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}>
                    <div style={{
                      position: 'absolute', top: '3px',
                      left: form.contest_entry ? '21px' : '3px',
                      width: '16px', height: '16px', borderRadius: '50%',
                      background: 'white', transition: 'left 0.2s',
                    }} />
                  </div>
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <div style={{ color: form.contest_entry ? 'var(--gold)' : blocked ? '#f87171' : 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 700 }}>
                      🏆 Enter to Contest
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>
                      {form.contest_entry
                        ? 'This pick will count toward your contest ranking'
                        : blocked
                          ? 'Fix the issues below to enter this pick in the contest'
                          : 'Toggle to submit this pick to the leaderboard contest'}
                    </div>
                  </div>
                  {form.contest_entry && (
                    <span style={{ fontSize: '0.65rem', color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: '4px', padding: '2px 7px', fontWeight: 700, flexShrink: 0 }}>
                      ✓ ENTERED
                    </span>
                  )}
                </button>

                {/* Validation errors — only show when user is attempting contest entry */}
                {cv.errors.length > 0 && (
                  <div style={{ marginTop: '6px', padding: '8px 12px', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px' }}>
                    {cv.errors.map((e, i) => (
                      <div key={i} style={{ fontSize: '0.7rem', color: '#f87171', display: 'flex', alignItems: 'flex-start', gap: '5px', marginBottom: i < cv.errors.length - 1 ? '3px' : 0 }}>
                        <span style={{ flexShrink: 0, marginTop: '1px' }}>✕</span> {e}
                      </div>
                    ))}
                  </div>
                )}
                {/* Warnings — shown even when valid */}
                {cv.warnings.length > 0 && cv.errors.length === 0 && (
                  <div style={{ marginTop: '6px', padding: '6px 12px', background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.2)', borderRadius: '6px' }}>
                    {cv.warnings.map((w, i) => (
                      <div key={i} style={{ fontSize: '0.7rem', color: 'var(--gold)', display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
                        <span style={{ flexShrink: 0 }}>⚠</span> {w}
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
      {/* ── Game Verification Banner ─────────────────────────────────────── */}
      {!form.id && (form.team?.trim() || verifying) && (
        <div style={{ marginTop: '0.9rem' }}>
          {verifying && (
            <div style={{
              padding: '8px 12px', borderRadius: '6px',
              background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.15)',
              display: 'flex', alignItems: 'center', gap: '8px',
              fontSize: '0.72rem', color: 'var(--text-muted)',
            }}>
              <span style={{ opacity: 0.6 }}>⏳</span> Verifying game time with ESPN…
            </div>
          )}
          {!verifying && gameVerify?.found && (
            <div style={{
              padding: '8px 12px', borderRadius: '6px',
              background: 'rgba(0,212,139,0.06)', border: '1px solid rgba(0,212,139,0.25)',
              display: 'flex', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap',
            }}>
              <span style={{ color: 'var(--green)', fontSize: '0.75rem', flexShrink: 0, marginTop: '1px' }}>✓</span>
              <div style={{ flex: 1 }}>
                <span style={{ color: 'var(--green)', fontWeight: 700, fontSize: '0.75rem' }}>
                  Game found: {gameVerify.game.shortName || gameVerify.game.name}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginLeft: '8px' }}>
                  {new Date(gameVerify.game.commence_time).toLocaleString('en-US', {
                    month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
                  })}
                </span>
                {gameVerify.game.venue && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginLeft: '8px', opacity: 0.7 }}>
                    @ {gameVerify.game.venue}
                  </span>
                )}
                {gameVerify.warning && (
                  <div style={{ color: 'var(--gold)', fontSize: '0.68rem', marginTop: '3px', opacity: 0.85 }}>
                    ⚠ {gameVerify.warning}
                  </div>
                )}
                <div style={{ color: 'rgba(0,212,139,0.6)', fontSize: '0.65rem', marginTop: '2px' }}>
                  Tip-off time locked — this pick will be verified if submitted now
                </div>
              </div>
            </div>
          )}
          {!verifying && gameVerify && !gameVerify.found && !gameVerify.unsupported && form.team?.trim() && (
            <div style={{
              padding: '8px 12px', borderRadius: '6px',
              background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.2)',
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              fontSize: '0.72rem',
            }}>
              <span style={{ color: '#f87171', flexShrink: 0, marginTop: '1px' }}>✕</span>
              <div>
                <span style={{ color: '#f87171', fontWeight: 600 }}>Game not found</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{gameVerify.error}</span>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '2px', opacity: 0.7 }}>
                  Pick will be saved but won't count as verified on the Sharp Board.
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.7rem', marginTop: '1.2rem' }}>
        <button className="btn-gold" onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : form.id ? 'Update Pick' : 'Add Pick'}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function HistoryTab({ picks, setPicks, user, contest, setContest, isDemo, onViewGame, onLeaderboardRefresh, isActive }) {
  const [addMode, setAddMode]   = useState(null); // null | 'choose' | 'import' | 'manual'
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [filterResult, setFilterResult] = useState('ALL');
  const [filterSport, setFilterSport] = useState('ALL');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc'); // newest picks first
  const [contestForm, setContestForm] = useState(false);
  const [contestEdit, setContestEdit] = useState(contest || {});
  const [filterContest, setFilterContest] = useState(false);

  // ── AI Pick Analyses ────────────────────────────────────────────────────
  const [analyses, setAnalyses] = useState({}); // { pickId: analysisText }
  const [expandedAnalysis, setExpandedAnalysis] = useState(null); // pickId
  const [analysisLoading, setAnalysisLoading] = useState(false);

  // ── Parlay leg expansion ─────────────────────────────────────────────────
  // expandedParlayLegs: { [pickId]: null | 'loading' | leg[] }
  const [expandedParlayLegs, setExpandedParlayLegs] = useState({});

  async function toggleParlayLegs(pickId) {
    if (expandedParlayLegs[pickId] && expandedParlayLegs[pickId] !== 'loading') {
      // Collapse
      setExpandedParlayLegs(prev => { const n = { ...prev }; delete n[pickId]; return n; });
      return;
    }
    setExpandedParlayLegs(prev => ({ ...prev, [pickId]: 'loading' }));
    const { data, error } = await fetchParlayLegs(pickId);
    setExpandedParlayLegs(prev => ({ ...prev, [pickId]: error ? [] : data }));
  }

  // ── Live Scores + Instant Grading ───────────────────────────────────────
  const pendingPicks = picks.filter(p => !p.result || p.result === 'PENDING');

  async function handleGameFinal({ sport, homeTeam, awayTeam, homeScore, awayScore, gameDate }) {
    try {
      const res = await fetch('/api/grade-game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sport, homeTeam, awayTeam, homeScore, awayScore, gameDate }),
      });
      const { graded } = await res.json();
      if (!graded?.length) return;

      // Update only this user's picks in state
      const myGraded = graded.filter(g => g.user_id === user?.id);
      if (myGraded.length) {
        setPicks(prev => prev.map(p => {
          const g = myGraded.find(gr => gr.id === p.id);
          return g ? { ...p, result: g.result, profit: g.profit, graded_home_score: g.home_score, graded_away_score: g.away_score } : p;
        }));
        // Sound effects
        const wins   = myGraded.filter(g => g.result === 'WIN').length;
        const losses = myGraded.filter(g => g.result === 'LOSS').length;
        const pushes = myGraded.filter(g => g.result === 'PUSH').length;
        if (wins > 0)        { playWin();   if (wins   > 1) setTimeout(playWin,  350); }
        else if (losses > 0) { playLoss();  if (losses > 1) setTimeout(playLoss, 400); }
        else if (pushes > 0) { playGrade(); }
        setGradeMsg(`✓ ${homeTeam} vs ${awayTeam} graded — ${wins}W ${losses}L${pushes ? ' '+pushes+'P' : ''}`);
        setTimeout(() => setGradeMsg(''), 5000);
        // Cascade to leaderboard if any contest pick was graded
        const hasContestPick = myGraded.some(g => g.contest_entry);
        if (hasContestPick) onLeaderboardRefresh?.();
      }
    } catch { /* fail silently */ }
  }

  const liveScores = useLiveScores(pendingPicks, user, isDemo, handleGameFinal);

  // ── Auto-grade concluded pending picks on mount ─────────────────────────
  const [grading, setGrading] = useState(false);
  const [gradeMsg, setGradeMsg] = useState('');

  async function runGrade(force = false) {
    if (!user?.id || isDemo || grading) return;
    setGrading(true);
    setGradeMsg('');
    try {
      const res = await fetch('/api/grade-picks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, force }),
      });
      const { graded, count } = await res.json();
      if (count > 0) {
        setPicks(prev => prev.map(p => {
          const g = graded.find(gr => gr.id === p.id);
          return g ? { ...p, result: g.result, graded_home_score: g.home_score, graded_away_score: g.away_score } : p;
        }));
        // 🔊 Play sounds for graded results
        const wins   = graded.filter(g => g.result === 'WIN').length;
        const losses = graded.filter(g => g.result === 'LOSS').length;
        const pushes = graded.filter(g => g.result === 'PUSH').length;
        if (wins > 0)        { playWin();   if (wins > 1)   setTimeout(playWin,  350); }
        else if (losses > 0) { playLoss();  if (losses > 1) setTimeout(playLoss, 400); }
        else if (pushes > 0) { playGrade(); }
        setGradeMsg(`✓ Graded ${count} pick${count !== 1 ? 's' : ''}`);
      } else {
        setGradeMsg(force ? 'No new results found' : '');
      }
    } catch { setGradeMsg('Grade check failed'); }
    finally { setGrading(false); setTimeout(() => setGradeMsg(''), 4000); }
  }

  useEffect(() => {
    if (!user?.id || isDemo) return;
    runGrade(false); // auto-grade on mount (silent, no force)
  }, [user?.id, isDemo]); // eslint-disable-line

  // Batch-load analyses for visible picks on mount
  useEffect(() => {
    if (!picks?.length || isDemo) return;
    const ids = picks.map(p => p.id).filter(Boolean).join(',');
    if (!ids) return;
    fetch(`/api/auto-analyze?pickId=${ids}`)
      .then(r => r.json())
      .then(d => { if (d.analyses) setAnalyses(d.analyses); })
      .catch(() => {});
  }, [picks?.length, isDemo]);

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.team || !form.odds) return;
    setSaving(true);

    const payload = {
      ...form,
      user_id: user.id,
      odds: parseInt(form.odds),
      day_number: form.day_number ? parseInt(form.day_number) : null,
      profit: form.profit !== '' ? parseFloat(form.profit) : null,
    };

    if (isDemo) {
      // Demo mode — use localStorage
      let updated;
      if (form.id) {
        updated = picks.map(p => p.id === form.id ? { ...payload, id: form.id } : p);
      } else {
        updated = [...picks, { ...payload, id: demoId() }];
      }
      setPicks(updated);
      saveDemoPicks(updated);
    } else {
      // Get the auth token so the server can verify user identity
      const { supabase: sb } = await import('@/lib/supabase').then(m => ({ supabase: m.supabase })).catch(() => ({}));
      const session = sb ? (await sb.auth.getSession())?.data?.session : null;
      const authToken = session?.access_token || null;

      if (form.id) {
        // Edits: use server-side PATCH (enforces game-start lock + re-verifies game time)
        const res = await fetch('/api/picks', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ pickId: form.id, updates: payload, authToken }),
        });
        const result = await res.json();
        if (res.ok && result.pick) {
          setPicks(prev => prev.map(p => p.id === form.id ? result.pick : p));
        } else if (result.error) {
          alert(result.error);
          setSaving(false);
          return;
        }
      } else {
        // New pick: use server-side POST — commence_time is set by server from ESPN
        // Client-supplied commence_time is stripped server-side (no backdating exploit)
        const res = await fetch('/api/picks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ pick: payload }),
        });
        const result = await res.json();

        if (res.ok && result.pick) {
          setPicks(prev => [...prev, result.pick]);
          // Fire-and-forget: auto-analyze in background
          fetch('/api/auto-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pickId: result.pick.id, sport: payload.sport, team: payload.team,
              bet_type: payload.bet_type, odds: payload.odds, units: payload.units,
              date: payload.date, notes: payload.notes,
            }),
          }).catch(() => {});
        } else if (result.errors) {
          // Contest validation failed — surface the errors
          alert('Contest error:\n' + result.errors.join('\n'));
          setSaving(false);
          return;
        } else {
          // Server route unavailable — fall back to direct insert
          const { data, error } = await addPick(payload);
          if (!error) setPicks(prev => [...prev, data]);
        }
      }
    }

    setSaving(false);
    setShowForm(false);
    setForm({ ...EMPTY_FORM });
  }

  async function handleToggleContest(pick) {
    const newVal = !pick.contest_entry;

    // If enabling contest entry, check daily limit + eligibility first
    if (newVal && !isDemo) {
      try {
        const checkRes = await fetch(`/api/verify-pick?action=daily-check&userId=${user.id}`);
        const checkData = await checkRes.json();
        if (checkData.hasContestPickToday) {
          alert('You already have a contest pick today. One play per day — no exceptions.');
          return;
        }
        // Verify pick eligibility (odds range, bet type, etc.)
        const verifyRes = await fetch('/api/verify-pick', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pick, userId: user.id, contestEntry: true }),
        });
        const verifyData = await verifyRes.json();
        if (!verifyData.eligible) {
          alert('Pick not eligible for contest:\n' + verifyData.issues.join('\n'));
          return;
        }
      } catch {}
    }

    // If toggling OFF a contest pick — it's LOCKED, block it
    if (!newVal && pick.contest_entry) {
      alert('Contest picks are locked. Once posted, it cannot be removed — no changing, no editing, no deleting.');
      return;
    }

    setPicks(prev => prev.map(p => p.id === pick.id ? { ...p, contest_entry: newVal } : p));
    if (!isDemo) {
      const { error } = await updatePick(pick.id, { contest_entry: newVal });
      if (error) {
        setPicks(prev => prev.map(p => p.id === pick.id ? { ...p, contest_entry: pick.contest_entry } : p));
        return;
      }
      // Fire-and-forget: trigger AI audit for new contest entries
      if (newVal) {
        fetch('/api/contest-audit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'audit', pickId: pick.id }),
        }).catch(() => {});
      }
    } else {
      const updated = picks.map(p => p.id === pick.id ? { ...p, contest_entry: newVal } : p);
      saveDemoPicks(updated);
    }
  }

  async function handleDelete(id) {
    setDeleting(id);
    if (isDemo) {
      const updated = picks.filter(p => p.id !== id);
      setPicks(updated);
      saveDemoPicks(updated);
    } else {
      const { error } = await deletePick(id);
      if (!error) setPicks(prev => prev.filter(p => p.id !== id));
    }
    setDeleting(null);
  }

  function handleEdit(pick) {
    setForm({ ...EMPTY_FORM, ...pick });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleCancel() {
    setForm({ ...EMPTY_FORM });
    setShowForm(false);
  }

  function handleSlipFilled(data) {
    setForm({ ...EMPTY_FORM, ...data });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSaveMultiple(picksArray) {
    if (!picksArray?.length || !user?.id) return;
    const { supabase: sb } = await import('@/lib/supabase').then(m => ({ supabase: m.supabase })).catch(() => ({}));
    const session = sb ? (await sb.auth.getSession())?.data?.session : null;
    const authToken = session?.access_token || null;
    const today = new Date().toISOString().split('T')[0];
    const errors = [];

    for (const p of picksArray) {
      const payload = {
        ...EMPTY_FORM,
        date:     p.date     || today,
        sport:    p.sport    || 'MLB',
        team:     p.team     || '',
        bet_type: p.bet_type || 'Moneyline',
        line:     p.line     ?? null,
        matchup:  p.matchup  || '',
        odds:     parseInt(p.odds) || 0,
        book:     p.book     || 'FanDuel',
        notes:    p.notes    || '',
        result:   'PENDING',
        profit:   null,
        user_id:  user.id,
      };
      try {
        const res = await fetch('/api/picks', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ pick: payload }),
        });
        const result = await res.json();
        if (res.ok && result.pick) {
          setPicks(prev => [...prev, result.pick]);
        } else {
          errors.push(`${p.team || 'Pick'}: ${result.error || 'Failed to save'}`);
        }
      } catch (err) {
        errors.push(`${p.team || 'Pick'}: ${err.message}`);
      }
    }

    if (errors.length) {
      throw new Error(errors.join('\n'));
    }
  }

  // ── Filtering & Sorting ──────────────────────────────────────────────────

  const sports = ['ALL', ...Array.from(new Set(picks.map(p => (p.sport || 'Other').toUpperCase()))).filter(Boolean)];

  const filtered = picks
    .filter(p => filterResult === 'ALL' || p.result === filterResult)
    .filter(p => filterSport === 'ALL' || (p.sport || 'Other').toUpperCase() === filterSport)
    .filter(p => !filterContest || p.contest_entry)
    .sort((a, b) => {
      let av = a[sortField], bv = b[sortField];
      if (sortField === 'date') { av = new Date(av); bv = new Date(bv); }
      if (sortField === 'odds' || sortField === 'profit' || sortField === 'day_number') { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  function toggleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  }

  const SortArrow = ({ field }) => sortField === field
    ? <span style={{ color: '#FFB800', marginLeft: '3px' }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
    : <span style={{ color: 'var(--text-muted)', marginLeft: '3px' }}>↕</span>;

  // ── Render ───────────────────────────────────────────────────────────────

  function openAddPick() {
    setForm({ ...EMPTY_FORM });
    setShowForm(false);
    setAddMode('choose');
  }
  function cancelAdd() {
    setAddMode(null);
    setShowForm(false);
  }

  return (
    <div className="fade-in">

      {/* Header bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f0f0f0' }}>
            {contest?.name || 'My Picks'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
            {picks.length} picks logged • {picks.filter(p => p.result === 'WIN').length}W / {picks.filter(p => p.result === 'LOSS').length}L
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {gradeMsg && (
            <span style={{ fontSize: '0.75rem', color: gradeMsg.startsWith('✓') ? 'var(--green)' : 'var(--text-muted)', padding: '0 4px' }}>
              {gradeMsg}
            </span>
          )}
          <button
            className="btn-ghost"
            onClick={() => runGrade(true)}
            disabled={grading || isDemo}
            title="Re-check ESPN for final scores on recent picks"
            style={{ fontSize: '0.78rem', opacity: grading ? 0.6 : 1 }}
          >
            {grading ? '⟳ Checking...' : '⟳ Refresh & Grade'}
          </button>
          <button className="btn-ghost" onClick={() => setContestForm(!contestForm)} style={{ fontSize: '0.8rem' }}>
            ⚙️ Contest Settings
          </button>
          <button
            className={addMode ? 'btn-ghost' : 'btn-gold'}
            onClick={addMode ? cancelAdd : openAddPick}
            style={addMode ? { fontSize: '0.85rem' } : {
              fontSize: '0.92rem', padding: '0.6rem 1.4rem',
              background: 'linear-gradient(135deg, #00D48B 0%, #00b876 100%)',
              color: '#000', boxShadow: '0 2px 10px rgba(0,212,139,0.3)',
            }}
          >
            {addMode ? '✕ Cancel' : '+ Add Pick'}
          </button>
        </div>
      </div>

      {/* ── Add Pick — Import or Manual choice ── */}
      {addMode === 'choose' && (
        <div style={{ marginBottom: '1.25rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem', marginBottom: '1rem' }}>How do you want to add this pick?</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
            {/* Pick from Scoreboard option */}
            <button
              onClick={() => { cancelAdd(); if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('betos-navigate', { detail: 'scoreboard' })); }}
              style={{
                background: 'var(--bg-elevated)', border: '1.5px solid rgba(0,212,139,0.35)', borderRadius: '10px',
                padding: '1.1rem', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--green)'; e.currentTarget.style.background = 'rgba(0,212,139,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,212,139,0.35)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
            >
              <div style={{ fontSize: '1.6rem', marginBottom: '6px' }}>🏟️</div>
              <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: '0.88rem', marginBottom: '3px' }}>Pick from Games</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}>
                Browse today's scoreboard and tap any game to add a pick with live odds.
              </div>
            </button>

            {/* Import option */}
            <button
              onClick={() => setAddMode('import')}
              style={{
                background: 'var(--bg-elevated)', border: '1px solid rgba(255,184,0,0.3)', borderRadius: '10px',
                padding: '1.1rem', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--gold)'; e.currentTarget.style.background = 'rgba(255,184,0,0.06)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,184,0,0.3)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
            >
              <div style={{ fontSize: '1.6rem', marginBottom: '6px' }}>📸</div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.88rem', marginBottom: '3px' }}>Import Bet Slip</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}>
                Screenshot, share link, or paste — we'll auto-fill everything.
              </div>
            </button>

            {/* Manual option */}
            <button
              onClick={() => { setAddMode('manual'); setShowForm(true); }}
              style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px',
                padding: '1.1rem', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(96,165,250,0.5)'; e.currentTarget.style.background = 'rgba(96,165,250,0.04)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
            >
              <div style={{ fontSize: '1.6rem', marginBottom: '6px' }}>✏️</div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.88rem', marginBottom: '3px' }}>Manual Entry</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', lineHeight: 1.4 }}>
                Fill in the details yourself. Defaults to 1u risk.
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Import flow */}
      {addMode === 'import' && (
        <div style={{ marginBottom: '1.25rem' }}>
          <SlipImport
            onFilled={(filled) => { handleSlipFilled(filled); setAddMode('manual'); setShowForm(true); }}
            onSubmitParlay={async (pick, legs) => {
              const { data, error } = await submitParlay(pick, legs);
              if (error) throw new Error(error.message);
              if (data) setPicks(prev => [data, ...prev]);
            }}
            onSaveMultiple={async (picks) => {
              await handleSaveMultiple(picks);
              setAddMode(null);
            }}
          />
        </div>
      )}

      {/* Contest Settings Form */}
      {contestForm && (
        <div className="card" style={{ padding: '1.2rem', marginBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.8rem' }}>
            <div>
              <label style={{ display: 'block', color: '#aaa', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>Contest Name</label>
              <input className="input" value={contestEdit.name || ''} onChange={e => setContestEdit(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', color: '#aaa', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>Start Date</label>
              <input className="input" type="date" value={contestEdit.start_date || ''} onChange={e => setContestEdit(p => ({ ...p, start_date: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', color: '#aaa', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>Bankroll ($)</label>
              <input className="input" type="number" value={contestEdit.bankroll || ''} onChange={e => setContestEdit(p => ({ ...p, bankroll: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.9rem' }}>
            <button className="btn-gold" onClick={() => { setContest(contestEdit); if (isDemo) saveDemoContest(contestEdit); setContestForm(false); }} style={{ fontSize: '0.85rem' }}>Save</button>
            <button className="btn-ghost" onClick={() => setContestForm(false)} style={{ fontSize: '0.85rem' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Add/Edit Form */}
      {(addMode === 'manual' || showForm) && showForm && (
        <PickForm form={form} setForm={setForm} onSave={handleSave} onCancel={handleCancel} saving={saving} />
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: '#888', fontSize: '0.8rem' }}>Filter:</span>
        {['ALL', 'WIN', 'LOSS', 'PUSH', 'PENDING'].map(r => (
          <button
            key={r}
            onClick={() => setFilterResult(r)}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: `1px solid ${filterResult === r ? '#FFB800' : '#333'}`,
              background: filterResult === r ? '#1a1200' : 'transparent',
              color: filterResult === r ? '#FFB800' : '#888',
              fontSize: '0.78rem',
              cursor: 'pointer',
              fontWeight: filterResult === r ? 700 : 400,
            }}
          >{r}</button>
        ))}
        <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
        {sports.map(s => (
          <button
            key={s}
            onClick={() => setFilterSport(s)}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              border: `1px solid ${filterSport === s ? '#60a5fa' : '#333'}`,
              background: filterSport === s ? '#0d1a2b' : 'transparent',
              color: filterSport === s ? '#60a5fa' : '#888',
              fontSize: '0.78rem',
              cursor: 'pointer',
              fontWeight: filterSport === s ? 700 : 400,
            }}
          >{s}</button>
        ))}
        <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>|</span>
        <button
          onClick={() => setFilterContest(v => !v)}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            border: `1px solid ${filterContest ? 'rgba(255,184,0,0.6)' : '#333'}`,
            background: filterContest ? 'rgba(255,184,0,0.1)' : 'transparent',
            color: filterContest ? 'var(--gold)' : '#888',
            fontSize: '0.78rem',
            cursor: 'pointer',
            fontWeight: filterContest ? 700 : 400,
            display: 'flex', alignItems: 'center', gap: '4px',
          }}
        >🏆 Contest Only</button>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginLeft: 'auto' }}>{filtered.length} picks shown</span>
      </div>

      {/* Bet Slip Cards */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🎯</div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>No picks yet</div>
          <div style={{ marginBottom: '1.25rem' }}>Log your first bet to start tracking your record.</div>
          <button
            className="btn-gold"
            onClick={openAddPick}
            style={{
              fontSize: '1rem', padding: '0.75rem 2rem',
              background: 'linear-gradient(135deg, #00D48B 0%, #00b876 100%)',
              color: '#000', boxShadow: '0 2px 12px rgba(0,212,139,0.3)',
            }}
          >
            + Add Your First Pick
          </button>
        </div>
      ) : (
        <>
          {/* Sort Controls */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '0.9rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginRight: '2px' }}>Sort:</span>
            {[
              { label: 'Date', field: 'date' },
              { label: 'Odds', field: 'odds' },
              { label: 'P/L', field: 'profit' },
              { label: 'Sport', field: 'sport' },
            ].map(({ label, field }) => (
              <button key={field} onClick={() => toggleSort(field)} style={{
                padding: '3px 10px', borderRadius: '6px', fontSize: '0.72rem', cursor: 'pointer',
                border: `1px solid ${sortField === field ? 'var(--gold)' : 'var(--border)'}`,
                background: sortField === field ? 'rgba(255,184,0,0.08)' : 'transparent',
                color: sortField === field ? 'var(--gold)' : 'var(--text-muted)',
                fontWeight: sortField === field ? 700 : 400,
              }}>
                {label}{sortField === field ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)' }}>{filtered.length} slips</span>
          </div>

          {/* Card Grid — DraftKings-style bet slips */}
          <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
            {filtered.map((pick) => {
              const live = liveScores[pick.id] || null;
              const isPending  = !pick.result || pick.result === 'PENDING';
              const isTracking = isPending && live?.isLive;
              const isFinalNow = isPending && live?.isFinal;

              const resultColor =
                pick.result === 'WIN'  ? '#4ade80' :
                pick.result === 'LOSS' ? '#f87171' :
                pick.result === 'PUSH' ? '#94a3b8' :
                isTracking && live?.liveStatus === 'WINNING' ? '#4ade80' :
                isTracking && live?.liveStatus === 'LOSING'  ? '#f87171' : '#FFB800';

              const profitVal = pick.profit != null ? parseFloat(pick.profit) : null;
              const oddsDisplay = pick.odds ? `${pick.odds > 0 ? '+' : ''}${pick.odds}` : '—';
              const profitDisplay = profitVal != null
                ? `${profitVal >= 0 ? '+' : ''}${profitVal.toFixed(2)}u`
                : '—';
              const resultLabel =
                pick.result === 'WIN'  ? 'Won' :
                pick.result === 'LOSS' ? 'Lost' :
                pick.result === 'PUSH' ? 'Push' :
                isTracking && live?.liveStatus === 'WINNING' ? 'Winning' :
                isTracking && live?.liveStatus === 'LOSING'  ? 'Losing' :
                isFinalNow ? 'Grading…' : 'Pending';
              const resultPillBg =
                pick.result === 'WIN'  ? 'rgba(74,222,128,0.18)' :
                pick.result === 'LOSS' ? 'rgba(248,113,113,0.18)' :
                pick.result === 'PUSH' ? 'rgba(148,163,184,0.15)' :
                (isTracking && live?.liveStatus === 'WINNING') ? 'rgba(74,222,128,0.15)' :
                (isTracking && live?.liveStatus === 'LOSING')  ? 'rgba(248,113,113,0.15)' :
                'rgba(255,184,0,0.08)';
              const resultPillBorder =
                (!pick.result || pick.result === 'PENDING') && !isTracking
                  ? '1px solid rgba(255,184,0,0.35)' : 'none';

              return (
                <div key={pick.id} style={{
                  background: 'var(--bg-surface)',
                  border: `1px solid ${isTracking ? 'rgba(74,222,128,0.3)' : 'var(--border)'}`,
                  borderRadius: '12px',
                  overflow: 'hidden',
                  boxShadow: isTracking ? '0 2px 16px rgba(74,222,128,0.1)' : '0 2px 8px rgba(0,0,0,0.3)',
                  display: 'flex', flexDirection: 'column',
                }}>

                  {/* ── Live Tracking Banner ── */}
                  {isTracking && (
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '4px 12px',
                      background: 'rgba(74,222,128,0.06)',
                      borderBottom: '1px solid rgba(74,222,128,0.12)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{
                          width: '6px', height: '6px', borderRadius: '50%',
                          background: '#4ade80', flexShrink: 0,
                          boxShadow: '0 0 5px #4ade80',
                          animation: 'pulse 1.5s ease-in-out infinite',
                        }} />
                        <span style={{ fontSize: '0.62rem', color: '#4ade80', fontWeight: 700, letterSpacing: '0.06em' }}>
                          tracking live
                        </span>
                      </div>
                      {live.periodLabel && (
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace' }}>
                          {live.periodLabel}
                        </span>
                      )}
                    </div>
                  )}

                  {/* ── Header: Sport + Date + Book ── */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px 7px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    background: 'rgba(255,255,255,0.02)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '0.88rem', lineHeight: 1 }}>{sportEmoji(pick.sport)}</span>
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.07em', color: '#60a5fa',
                        background: 'rgba(96,165,250,0.1)', padding: '2px 6px', borderRadius: '4px',
                      }}>{pick.sport || 'Other'}</span>
                      {pick.contest_entry && (
                        <span style={{
                          fontSize: '0.62rem', color: '#FFB800',
                          background: 'rgba(255,184,0,0.1)', border: '1px solid rgba(255,184,0,0.25)',
                          borderRadius: '4px', padding: '1px 5px', fontWeight: 700,
                        }}>🏆</span>
                      )}
                      {pick.day_number && (
                        <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '1px 5px', borderRadius: '4px', border: '1px solid var(--border)' }}>
                          Day {pick.day_number}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {pick.date && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          {new Date(pick.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {pick.book && (
                        <span style={{
                          fontSize: '0.62rem', color: 'var(--text-muted)',
                          background: 'var(--bg-elevated)', padding: '2px 6px',
                          borderRadius: '4px', border: '1px solid var(--border)',
                        }}>{pick.book}</span>
                      )}
                    </div>
                  </div>

                  {/* ── Hero: Team + Odds + Result Pill ── */}
                  <div style={{ padding: '12px 13px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Team name — hero */}
                        <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)', lineHeight: 1.2, display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                          {pick.is_parlay ? (
                            <>
                              <span style={{
                                fontSize: '0.62rem', fontWeight: 800, padding: '2px 7px',
                                borderRadius: '5px', letterSpacing: '0.07em',
                                background: 'rgba(168,85,247,0.15)', color: '#c084fc',
                                border: '1px solid rgba(168,85,247,0.3)', textTransform: 'uppercase', flexShrink: 0,
                              }}>🎰 Parlay</span>
                              <span>{pick.parlay_leg_count || '?'}-Leg</span>
                            </>
                          ) : pick.team}
                          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.95rem', color: pick.odds > 0 ? '#4ade80' : 'var(--text-secondary)', flexShrink: 0 }}>
                            {oddsDisplay}
                          </span>
                        </div>
                        {/* Bet type subtitle */}
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                          {pick.is_parlay
                            ? `${pick.parlay_leg_count || '?'} legs · Combined ${pick.parlay_combined_odds > 0 ? '+' : ''}${pick.parlay_combined_odds ?? (pick.odds > 0 ? '+' : '') + pick.odds}`
                            : pick.bet_type}
                        </div>
                        {/* Matchup context */}
                        {pick.matchup && !pick.is_parlay && (
                          <div style={{ fontSize: '0.70rem', color: 'var(--text-muted)', marginTop: '2px', lineHeight: 1.3 }}>
                            {pick.matchup}
                          </div>
                        )}
                      </div>
                      {/* Result pill */}
                      <div style={{
                        padding: '4px 11px', borderRadius: '20px', fontSize: '0.72rem', fontWeight: 800,
                        background: resultPillBg, border: resultPillBorder,
                        color: resultColor, flexShrink: 0, marginTop: '2px',
                        letterSpacing: '0.02em',
                      }}>
                        {resultLabel}
                      </div>
                    </div>

                    {/* Wager line */}
                    <div style={{ marginTop: '8px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                      Wager: <span style={{ color: 'var(--text-secondary)', fontWeight: 600, fontFamily: 'IBM Plex Mono, monospace' }}>{parseFloat(pick.units) || 1}u</span>
                    </div>
                  </div>

                  {/* Parlay expand/collapse legs */}
                  {pick.is_parlay && (
                    <div style={{ padding: '0 13px', marginTop: '8px' }}>
                      <button
                        onClick={e => { e.stopPropagation(); toggleParlayLegs(pick.id); }}
                        style={{
                          background: 'none', border: '1px solid rgba(168,85,247,0.25)',
                          borderRadius: '5px', padding: '3px 9px',
                          fontSize: '0.68rem', color: '#a855f7', cursor: 'pointer',
                          fontFamily: 'inherit', fontWeight: 600, transition: 'all 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(168,85,247,0.1)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                      >
                        {expandedParlayLegs[pick.id] && expandedParlayLegs[pick.id] !== 'loading'
                          ? '▲ Hide Legs'
                          : expandedParlayLegs[pick.id] === 'loading' ? 'Loading…' : '▼ Show Legs'}
                      </button>
                      {expandedParlayLegs[pick.id] && expandedParlayLegs[pick.id] !== 'loading' && (
                        <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {(expandedParlayLegs[pick.id] || []).map((leg, li) => {
                            const legResultColor =
                              leg.result === 'WIN'  ? '#4ade80' :
                              leg.result === 'LOSS' ? '#f87171' :
                              leg.result === 'PUSH' ? '#94a3b8' :
                              leg.result === 'VOID' ? '#94a3b8' : '#FFB800';
                            return (
                              <div key={leg.id || li} style={{
                                display: 'flex', alignItems: 'center', gap: '7px',
                                padding: '4px 8px', borderRadius: '6px',
                                background: 'rgba(168,85,247,0.05)',
                                border: '1px solid rgba(168,85,247,0.12)',
                                borderLeft: `3px solid ${legResultColor}`,
                              }}>
                                <span style={{ fontSize: '0.65rem', color: '#718096', flexShrink: 0 }}>{li + 1}.</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e2e8f0', lineHeight: 1.25 }}>
                                    {leg.team}{leg.line != null ? ` ${leg.line > 0 ? '+' : ''}${leg.line}` : ''}
                                  </div>
                                  <div style={{ fontSize: '0.65rem', color: '#718096' }}>
                                    {leg.bet_type} · {leg.sport}
                                    {leg.away_team && leg.home_team ? ` · ${leg.away_team} @ ${leg.home_team}` : ''}
                                  </div>
                                </div>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: leg.odds > 0 ? '#4ade80' : '#94a3b8', fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0 }}>
                                  {leg.odds > 0 ? '+' : ''}{leg.odds}
                                </span>
                                {leg.result && (
                                  <span style={{ fontSize: '0.62rem', fontWeight: 800, color: legResultColor, flexShrink: 0 }}>{leg.result}</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Live score while game is in progress */}
                  {isTracking && (
                    <div style={{ padding: '0 13px', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '1.05rem',
                        color: live?.liveStatus === 'WINNING' ? '#4ade80' : live?.liveStatus === 'LOSING' ? '#f87171' : '#94a3b8',
                        letterSpacing: '-0.02em',
                      }}>
                        {live.awayAbbr} {live.awayScore} – {live.homeScore} {live.homeAbbr}
                      </span>
                    </div>
                  )}

                  {/* Final score — grading in progress */}
                  {isFinalNow && !isTracking && (
                    <div style={{ padding: '0 13px', marginTop: '8px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '0.72rem', color: '#94a3b8' }}>
                      {live.awayScore}–{live.homeScore} <span style={{ fontWeight: 400, color: '#555' }}>FINAL · grading…</span>
                    </div>
                  )}

                  {/* ── Mini Scoreboard — graded picks ── */}
                  {pick.graded_home_score != null && pick.graded_away_score != null && pick.home_team && pick.away_team && (
                    <div style={{ margin: '10px 13px 0', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(0,0,0,0.2)' }}>
                      <div style={{ padding: '3px 10px', background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', textAlign: 'center' }}>
                        Final Score
                      </div>
                      {(() => {
                        const aScore = parseInt(pick.graded_away_score);
                        const hScore = parseInt(pick.graded_home_score);
                        const awayWon = aScore > hScore;
                        const homeWon = hScore > aScore;
                        return (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.04)', background: awayWon ? 'rgba(255,184,0,0.05)' : 'transparent' }}>
                              <span style={{ fontSize: '0.78rem', fontWeight: awayWon ? 700 : 400, color: awayWon ? '#FFB800' : 'var(--text-secondary)' }}>{pick.away_team}</span>
                              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.92rem', color: awayWon ? '#FFB800' : 'var(--text-muted)' }}>{pick.graded_away_score}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: homeWon ? 'rgba(255,184,0,0.05)' : 'transparent' }}>
                              <span style={{ fontSize: '0.78rem', fontWeight: homeWon ? 700 : 400, color: homeWon ? '#FFB800' : 'var(--text-secondary)' }}>{pick.home_team}</span>
                              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.92rem', color: homeWon ? '#FFB800' : 'var(--text-muted)' }}>{pick.graded_home_score}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* ── P/L Footer ── */}
                  <div style={{
                    margin: '10px 0 0',
                    padding: '8px 13px',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    background: 'rgba(0,0,0,0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginRight: '4px' }}>P/L</span>
                      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 800, fontSize: '0.92rem', color: profitVal != null ? (profitVal >= 0 ? '#4ade80' : '#f87171') : 'var(--text-muted)' }}>
                        {profitDisplay}
                      </span>
                    </div>
                    {pick.date && (
                      <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                        Placed {new Date(pick.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </div>

                  {/* ── Notes ── */}
                  {pick.notes && (
                    <div style={{
                      padding: '5px 13px',
                      fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic',
                      borderBottom: '1px solid rgba(255,255,255,0.04)',
                      lineHeight: 1.4,
                    }}>
                      {pick.notes}
                    </div>
                  )}

                  {/* ── AI Analysis expansion ── */}
                  {expandedAnalysis === pick.id && (
                    <div style={{
                      padding: '9px 13px',
                      background: 'rgba(255,184,0,0.03)',
                      borderBottom: '1px solid rgba(255,184,0,0.1)',
                    }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                        <span style={{ fontSize: '0.8rem', flexShrink: 0 }}>🎯</span>
                        <div style={{ fontSize: '0.74rem', color: '#ccc', lineHeight: 1.55 }}>
                          {analysisLoading && !analyses[pick.id]
                            ? <span style={{ color: '#888' }}>Analyzing pick…</span>
                            : analyses[pick.id]
                              ? analyses[pick.id]
                              : <span style={{ color: '#555' }}>No analysis available</span>
                          }
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Action Bar ── */}
                  <div style={{
                    padding: '7px 10px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    {/* Left: Contest + Public toggles */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {/* Contest toggle */}
                      <button
                        onClick={() => handleToggleContest(pick)}
                        title={pick.contest_entry ? 'Contest pick (locked)' : 'Enter in contest'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}
                      >
                        <div style={{
                          width: '28px', height: '15px', borderRadius: '8px',
                          background: pick.contest_entry ? 'var(--gold)' : 'var(--border)',
                          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                        }}>
                          <div style={{
                            position: 'absolute', top: '2px',
                            left: pick.contest_entry ? '15px' : '2px',
                            width: '11px', height: '11px', borderRadius: '50%',
                            background: 'white', transition: 'left 0.2s',
                          }} />
                        </div>
                        <span style={{ fontSize: '0.65rem', color: pick.contest_entry ? 'var(--gold)' : 'var(--text-muted)' }}>🏆</span>
                      </button>
                      {/* All picks are public — shown on leaderboard indicator */}
                      <span title="Public — visible on leaderboard" style={{ fontSize: '0.62rem', color: 'rgba(255,184,0,0.45)', padding: '2px 4px', letterSpacing: '0.04em' }}>PUB</span>
                    </div>

                    {/* Right: Action buttons */}
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                      {onViewGame && (
                        <button
                          onClick={() => onViewGame(pick)}
                          title="View game on Scoreboard"
                          style={{ padding: '3px 7px', borderRadius: '5px', border: '1px solid rgba(96,165,250,0.3)', background: 'transparent', color: '#60a5fa', cursor: 'pointer', fontSize: '0.72rem' }}
                        >📺</button>
                      )}
                      <button
                        onClick={async () => {
                          if (expandedAnalysis === pick.id) { setExpandedAnalysis(null); return; }
                          setExpandedAnalysis(pick.id);
                          if (!analyses[pick.id]) {
                            setAnalysisLoading(true);
                            try {
                              const res = await fetch('/api/auto-analyze', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ pickId: pick.id, sport: pick.sport, team: pick.team, bet_type: pick.bet_type, odds: pick.odds, units: pick.units, date: pick.date, notes: pick.notes }),
                              });
                              const d = await res.json();
                              if (d.analysis) setAnalyses(prev => ({ ...prev, [pick.id]: d.analysis }));
                            } catch {} finally { setAnalysisLoading(false); }
                          }
                        }}
                        title={analyses[pick.id] ? 'View AI analysis' : 'Get AI analysis'}
                        style={{ padding: '3px 7px', borderRadius: '5px', border: `1px solid ${analyses[pick.id] ? 'rgba(255,184,0,0.3)' : '#333'}`, background: expandedAnalysis === pick.id ? 'rgba(255,184,0,0.08)' : 'transparent', color: analyses[pick.id] ? '#FFB800' : '#666', cursor: 'pointer', fontSize: '0.72rem' }}
                      >🎯</button>
                      {/* Rejected notice */}
                      {!pick.contest_entry && pick.contest_rejected_date && (
                        <span
                          title={`Contest pick rejected${pick.audit_reason ? ': ' + pick.audit_reason : ''} — resubmit available`}
                          style={{ fontSize: '0.6rem', color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '4px', padding: '2px 5px', fontWeight: 700, cursor: 'help' }}
                        >✕</span>
                      )}
                      {/* Contest badge */}
                      {pick.contest_entry && (
                        <span title="Contest entry" style={{ fontSize: '0.65rem', color: '#FFB800', background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)', borderRadius: '4px', padding: '2px 6px', fontWeight: 700 }}>🏆</span>
                      )}
                      {/* Edit / Delete — available on all PENDING picks before game starts */}
                      {(() => {
                        const isSettled = pick.result && pick.result !== 'PENDING';
                        const gameStarted = pick.commence_time && Date.now() > new Date(pick.commence_time).getTime() + 120000;
                        if (isSettled) return null; // graded — no edits
                        if (gameStarted) return (
                          <span title="Game started — locked" style={{ fontSize: '0.65rem', color: '#94a3b8', background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: '4px', padding: '2px 6px', fontWeight: 700 }}>🔒</span>
                        );
                        return (
                          <>
                            <button
                              onClick={() => handleEdit(pick)}
                              title={pick.contest_entry ? 'Edit pick (team name & notes only for contest picks)' : 'Edit pick'}
                              style={{ padding: '3px 7px', borderRadius: '5px', border: '1px solid #333', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '0.72rem' }}
                            >✏️</button>
                            {!pick.contest_entry && (
                              <button
                                onClick={() => handleDelete(pick.id)}
                                disabled={deleting === pick.id}
                                title="Delete pick"
                                style={{ padding: '3px 7px', borderRadius: '5px', border: '1px solid #991b1b', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: '0.72rem', opacity: deleting === pick.id ? 0.5 : 1 }}
                              >{deleting === pick.id ? '…' : '🗑️'}</button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
