'use client';
import React, { useState, useRef, useEffect } from 'react';
import { addPick, updatePick, deletePick, setPickPublic } from '@/lib/supabase';
import { saveDemoPicks, saveDemoContest, demoId } from '@/lib/demoData';

const SPORTS  = ['MLB', 'NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB', 'Soccer', 'UFC', 'Other'];
const BET_TYPES = ['Moneyline', 'Spread', 'Total (Over)', 'Total (Under)', 'Prop', 'Parlay', 'Teaser', 'Futures'];
const BOOKS   = ['FanDuel', 'DraftKings', 'BetMGM', 'Caesars', 'PointsBet', 'Bet365', 'Pinnacle', 'Other'];
const RESULTS = ['WIN', 'LOSS', 'PUSH', 'PENDING'];

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

function SlipImport({ onFilled }) {
  const [mode, setMode]       = useState('image'); // 'image' | 'url' | 'text'
  const [file, setFile]       = useState(null);
  const [url, setUrl]         = useState('');
  const [text, setText]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [parsed, setParsed]   = useState(null);
  const [open, setOpen]       = useState(false);
  const fileRef               = useRef();

  async function handleParse() {
    setLoading(true);
    setError('');
    setParsed(null);
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
      setParsed(data.parsed);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleUse() {
    if (!parsed) return;
    onFilled({
      date: parsed.date || new Date().toISOString().split('T')[0],
      sport: parsed.sport || 'MLB',
      team: parsed.team || '',
      bet_type: parsed.bet_type || 'Moneyline',
      matchup: parsed.matchup || '',
      odds: parsed.odds?.toString() || '',
      book: parsed.book || 'FanDuel',
      result: 'PENDING',
      profit: '',
      notes: parsed.notes || '',
    });
    setParsed(null);
    setFile(null);
    setUrl('');
    setText('');
    setOpen(false);
  }

  const MODES = [
    { id: 'image', label: '📸 Screenshot' },
    { id: 'url',   label: '🔗 Share Link' },
    { id: 'text',  label: '📋 Paste Text' },
  ];

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
                onClick={() => { setMode(m.id); setParsed(null); setError(''); }}
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
                onChange={e => { setFile(e.target.files[0]); setParsed(null); }} />
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
          {parsed && (
            <div style={{ marginTop: '1rem', background: 'var(--bg-elevated)', border: '1px solid var(--gold)', borderRadius: '8px', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: '0.85rem' }}>✓ Parsed Successfully</span>
                <button className="btn btn-primary" onClick={handleUse} style={{ fontSize: '0.78rem', padding: '4px 12px' }}>
                  Fill Form →
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px', fontSize: '0.8rem' }}>
                {[
                  ['Team / Pick', parsed.team],
                  ['Sport', parsed.sport],
                  ['Bet Type', parsed.bet_type],
                  ['Odds', parsed.odds ? `${parsed.odds > 0 ? '+' : ''}${parsed.odds}` : null],
                  ['Book', parsed.book],
                  ['Date', parsed.date],
                ].filter(([, v]) => v).map(([label, value]) => (
                  <div key={label}>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>
              {parsed.matchup && (
                <div style={{ marginTop: '8px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {parsed.matchup}
                </div>
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

        {/* Contest entry toggle — full width */}
        <div style={{ gridColumn: '1 / -1' }}>
          <button
            type="button"
            onClick={() => handleChange('contest_entry', !form.contest_entry)}
            style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              background: form.contest_entry ? 'rgba(255,184,0,0.08)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${form.contest_entry ? 'rgba(255,184,0,0.4)' : 'var(--border)'}`,
              borderRadius: '8px', padding: '0.75rem 1rem', cursor: 'pointer',
              width: '100%', transition: 'all 0.15s',
            }}
          >
            {/* Toggle switch */}
            <div style={{
              width: '40px', height: '22px', borderRadius: '11px', border: 'none', cursor: 'pointer',
              background: form.contest_entry ? 'var(--gold)' : 'var(--border)',
              position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}>
              <div style={{
                position: 'absolute', top: '3px',
                left: form.contest_entry ? '21px' : '3px',
                width: '16px', height: '16px', borderRadius: '50%',
                background: 'white', transition: 'left 0.2s',
              }} />
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ color: form.contest_entry ? 'var(--gold)' : 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '6px' }}>
                🏆 Enter to Contest
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginTop: '2px' }}>
                {form.contest_entry ? 'This pick will count toward your contest ranking' : 'Toggle to submit this pick to the leaderboard contest'}
              </div>
            </div>
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.7rem', marginTop: '1.2rem' }}>
        <button className="btn-gold" onClick={onSave} disabled={saving}>
          {saving ? 'Saving...' : form.id ? 'Update Pick' : 'Add Pick'}
        </button>
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export default function HistoryTab({ picks, setPicks, user, contest, setContest, isDemo }) {
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
      if (form.id) {
        const { data, error } = await updatePick(form.id, payload);
        if (!error) setPicks(prev => prev.map(p => p.id === form.id ? data : p));
      } else {
        const { data, error } = await addPick(payload);
        if (!error) {
          setPicks(prev => [...prev, data]);
          // Fire-and-forget: auto-analyze in background
          fetch('/api/auto-analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pickId: data.id, sport: payload.sport, team: payload.team,
              bet_type: payload.bet_type, odds: payload.odds, units: payload.units,
              date: payload.date, notes: payload.notes,
            }),
          }).catch(() => {});
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

  async function handleTogglePublic(pick) {
    if (isDemo) return; // no-op in demo
    const newVal = !pick.is_public;
    // Optimistically update
    setPicks(prev => prev.map(p => p.id === pick.id ? { ...p, is_public: newVal } : p));
    const { error } = await setPickPublic(pick.id, newVal);
    if (error) {
      // revert on error
      setPicks(prev => prev.map(p => p.id === pick.id ? { ...p, is_public: pick.is_public } : p));
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

  // ── Filtering & Sorting ──────────────────────────────────────────────────

  const sports = ['ALL', ...Array.from(new Set(picks.map(p => p.sport)))];

  const filtered = picks
    .filter(p => filterResult === 'ALL' || p.result === filterResult)
    .filter(p => filterSport === 'ALL' || p.sport === filterSport)
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
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-ghost" onClick={() => setContestForm(!contestForm)} style={{ fontSize: '0.8rem' }}>
            ⚙️ Contest Settings
          </button>
          <button className="btn-gold" onClick={addMode ? cancelAdd : openAddPick}>
            {addMode ? '✕ Cancel' : '+ Add Pick'}
          </button>
        </div>
      </div>

      {/* ── Add Pick — Import or Manual choice ── */}
      {addMode === 'choose' && (
        <div style={{ marginBottom: '1.25rem', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem', marginBottom: '1rem' }}>How do you want to add this pick?</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
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
                Screenshot, share link, or paste text — we'll auto-fill everything for you.
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
                Fill in the details yourself. Defaults to 1 unit risk unless you specify otherwise.
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Import flow */}
      {addMode === 'import' && (
        <div style={{ marginBottom: '1.25rem' }}>
          <SlipImport onFilled={(filled) => { handleSlipFilled(filled); setAddMode('manual'); setShowForm(true); }} />
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

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          No picks yet. Hit <strong style={{ color: '#FFB800' }}>+ Add Pick</strong> to log your first bet.
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                  {[
                    { label: 'Day', field: 'day_number' },
                    { label: 'Date', field: 'date' },
                    { label: 'Sport', field: 'sport' },
                    { label: 'Pick', field: 'team' },
                    { label: 'Matchup', field: 'matchup' },
                    { label: 'Type', field: 'bet_type' },
                    { label: 'Odds', field: 'odds' },
                    { label: 'Book', field: 'book' },
                    { label: 'Result', field: 'result' },
                    { label: 'P/L', field: 'profit' },
                    { label: 'Notes', field: 'notes' },
                    { label: '🏆 Contest', field: null },
                    { label: 'Public', field: null },
                    { label: '', field: null },
                  ].map(({ label, field }) => (
                    <th
                      key={label}
                      onClick={() => field && toggleSort(field)}
                      style={{
                        padding: '0.7rem 1rem',
                        textAlign: 'left',
                        color: '#888',
                        fontWeight: 600,
                        fontSize: '0.72rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        whiteSpace: 'nowrap',
                        cursor: field ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                    >
                      {label}{field && <SortArrow field={field} />}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((pick, idx) => (
                  <React.Fragment key={pick.id}>
                  <tr
                    style={{
                      borderBottom: '1px solid #1a1a1a',
                      background: idx % 2 === 0 ? 'transparent' : '#0d0d0d',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#161616'}
                    onMouseLeave={(e) => e.currentTarget.style.background = idx % 2 === 0 ? 'transparent' : '#0d0d0d'}
                  >
                    <td style={{ padding: '0.7rem 1rem', color: '#888' }}>{pick.day_number || '—'}</td>
                    <td style={{ padding: '0.7rem 1rem', color: '#888', whiteSpace: 'nowrap' }}>{pick.date}</td>
                    <td style={{ padding: '0.7rem 1rem' }}>
                      <span style={{ color: '#60a5fa', background: '#0d1a2b', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>
                        {pick.sport}
                      </span>
                    </td>
                    <td style={{ padding: '0.7rem 1rem', fontWeight: 700, color: '#f0f0f0', whiteSpace: 'nowrap' }}>{pick.team}</td>
                    <td style={{ padding: '0.7rem 1rem', color: '#888', fontSize: '0.8rem' }}>{pick.matchup || '—'}</td>
                    <td style={{ padding: '0.7rem 1rem', color: '#888', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{pick.bet_type}</td>
                    <td style={{ padding: '0.7rem 1rem', fontFamily: 'monospace', fontWeight: 700, color: pick.odds > 0 ? '#4ade80' : '#f0f0f0', whiteSpace: 'nowrap' }}>
                      {pick.odds > 0 ? '+' : ''}{pick.odds}
                    </td>
                    <td style={{ padding: '0.7rem 1rem', color: '#888', fontSize: '0.8rem' }}>{pick.book || '—'}</td>
                    <td style={{ padding: '0.7rem 1rem' }}><ResultBadge result={pick.result} /></td>
                    <td style={{ padding: '0.7rem 1rem', fontFamily: 'monospace', fontWeight: 700, color: parseFloat(pick.profit) >= 0 ? '#4ade80' : '#f87171', whiteSpace: 'nowrap' }}>
                      {pick.profit != null ? `${parseFloat(pick.profit) >= 0 ? '+' : ''}${parseFloat(pick.profit).toFixed(2)}u` : '—'}
                    </td>
                    <td style={{ padding: '0.7rem 1rem', color: 'var(--text-secondary)', fontSize: '0.78rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {pick.notes || '—'}
                    </td>
                    {/* Contest entry toggle */}
                    <td style={{ padding: '0.7rem 1rem' }}>
                      <button
                        onClick={() => handleToggleContest(pick)}
                        title={pick.contest_entry ? 'Remove from contest' : 'Enter in contest'}
                        style={{
                          width: '38px', height: '20px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                          background: pick.contest_entry ? 'var(--gold)' : 'var(--border)',
                          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: '2px',
                          left: pick.contest_entry ? '20px' : '2px',
                          width: '16px', height: '16px', borderRadius: '50%',
                          background: 'white', transition: 'left 0.2s',
                        }} />
                      </button>
                    </td>
                    {/* Public toggle */}
                    <td style={{ padding: '0.7rem 1rem' }}>
                      {!isDemo ? (
                        <button
                          onClick={() => handleTogglePublic(pick)}
                          title={pick.is_public ? 'Remove from leaderboard' : 'Show on leaderboard'}
                          style={{
                            width: '38px', height: '20px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                            background: pick.is_public ? 'var(--gold)' : 'var(--border)',
                            position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                          }}
                        >
                          <div style={{
                            position: 'absolute', top: '2px',
                            left: pick.is_public ? '20px' : '2px',
                            width: '16px', height: '16px', borderRadius: '50%',
                            background: 'white', transition: 'left 0.2s',
                          }} />
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '0.7rem 1rem', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: '4px' }}>
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
                          style={{ padding: '3px 8px', borderRadius: '5px', border: `1px solid ${analyses[pick.id] ? 'rgba(255,184,0,0.3)' : '#333'}`, background: expandedAnalysis === pick.id ? 'rgba(255,184,0,0.08)' : 'transparent', color: analyses[pick.id] ? '#FFB800' : '#666', cursor: 'pointer', fontSize: '0.75rem' }}
                          title={analyses[pick.id] ? 'View AI analysis' : 'Get AI analysis'}
                        >🎯</button>
                        {/* Rejected contest pick — show resubmit notice */}
                        {!pick.contest_entry && pick.contest_rejected_date && (
                          <span
                            title={`Contest pick rejected${pick.audit_reason ? ': ' + pick.audit_reason : ''} — you may submit a new contest pick`}
                            style={{ fontSize: '0.62rem', color: '#f87171', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: '4px', padding: '2px 6px', fontWeight: 700, whiteSpace: 'nowrap', cursor: 'help' }}
                          >
                            ✕ REJECTED · Resubmit available
                          </span>
                        )}
                        {pick.contest_entry ? (
                          <span style={{ fontSize: '0.62rem', color: '#FFB800', background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)', borderRadius: '4px', padding: '2px 6px', fontWeight: 700, whiteSpace: 'nowrap' }} title="Contest picks are locked — no editing or deleting">🔒 LOCKED</span>
                        ) : (
                          <>
                            <button
                              onClick={() => handleEdit(pick)}
                              style={{ padding: '3px 8px', borderRadius: '5px', border: '1px solid #333', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: '0.75rem' }}
                              title="Edit pick"
                            >✏️</button>
                            <button
                              onClick={() => handleDelete(pick.id)}
                              disabled={deleting === pick.id}
                              style={{ padding: '3px 8px', borderRadius: '5px', border: '1px solid #991b1b', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: '0.75rem', opacity: deleting === pick.id ? 0.5 : 1 }}
                              title="Delete pick"
                            >{deleting === pick.id ? '...' : '🗑️'}</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {/* Expandable AI Analysis Row */}
                  {expandedAnalysis === pick.id && (
                    <tr key={`${pick.id}-analysis`}>
                      <td colSpan={15} style={{ padding: '0.6rem 1rem 0.8rem', background: '#0a0800', borderBottom: '1px solid rgba(255,184,0,0.15)' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                          <span style={{ fontSize: '0.85rem', flexShrink: 0 }}>🎯</span>
                          <div style={{ fontSize: '0.78rem', lineHeight: 1.5 }}>
                            {analysisLoading && !analyses[pick.id]
                              ? <span style={{ color: '#888' }}>Analyzing pick…</span>
                              : analyses[pick.id]
                                ? <span style={{ color: '#ccc' }}>{analyses[pick.id]}</span>
                                : <span style={{ color: '#555' }}>No analysis available</span>
                            }
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
