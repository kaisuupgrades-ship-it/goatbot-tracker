'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

// ── Tiny CSV parser (no deps) ─────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    // Handle quoted fields with commas
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtOdds(n) {
  if (n == null) return '-';
  return n > 0 ? `+${n}` : `${n}`;
}

function roiColor(roi) {
  if (roi > 5)  return '#4ade80';
  if (roi > 0)  return '#86efac';
  if (roi > -5) return '#fbbf24';
  return '#f87171';
}

function Section({ title, children }) {
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.2rem', marginBottom: '1rem' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
        {title}
        <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
      </div>
      {children}
    </div>
  );
}

function Label({ children }) {
  return (
    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600, marginBottom: '4px' }}>
      {children}
    </div>
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="input"
      style={{ fontSize: '0.82rem', padding: '6px 10px', minWidth: '120px' }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

// ── Import CSV ────────────────────────────────────────────────────────────────
function ImportPanel({ userEmail, onImported }) {
  const [sport, setSport]       = useState('MLB');
  const [season, setSeason]     = useState(new Date().getFullYear().toString());
  const [file, setFile]         = useState(null);
  const [rows, setRows]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [result, setResult]     = useState(null);
  const [error, setError]       = useState('');
  const fileRef = useRef();

  const SPORTS = ['MLB', 'NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB', 'MLS', 'UFC'];

  function handleFile(f) {
    if (!f) return;
    setFile(f); setResult(null); setError('');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = parseCSV(e.target.result);
        setRows(parsed);
      } catch {
        setError('Could not parse CSV - make sure it has a header row.');
      }
    };
    reader.readAsText(f);
  }

  async function doImport() {
    if (!rows?.length) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import-csv', userEmail, rows, sport, season }),
      });
      const d = await res.json();
      if (d.error) { setError(d.error); }
      else {
        setResult(d);
        setFile(null); setRows(null);
        if (fileRef.current) fileRef.current.value = '';
        onImported?.();
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0, lineHeight: 1.6 }}>
        Import historical game data (CSV format). Supported column names: <code style={{ color: '#FFB800', fontSize: '0.72rem' }}>date, home, away, home_score, away_score, home_ml, away_ml, spread, total</code> and many variations. The system normalizes column names automatically.
      </p>

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <Label>Sport</Label>
          <Select value={sport} onChange={setSport} options={SPORTS.map(s => ({ value: s, label: s }))} />
        </div>
        <div>
          <Label>Season Year</Label>
          <input
            className="input"
            type="number"
            value={season}
            onChange={e => setSeason(e.target.value)}
            min="2000" max={new Date().getFullYear()}
            style={{ width: '90px', fontSize: '0.82rem', padding: '6px 10px' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <Label>CSV File</Label>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            onChange={e => handleFile(e.target.files?.[0])}
            style={{ fontSize: '0.78rem', color: 'var(--text-muted)', width: '100%' }}
          />
        </div>
      </div>

      {rows && (
        <div style={{ fontSize: '0.78rem', color: '#86efac', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '6px', padding: '8px 12px' }}>
          [ok] Parsed <strong>{rows.length}</strong> rows from <strong>{file?.name}</strong>. Columns: {Object.keys(rows[0]).slice(0, 8).join(', ')}{Object.keys(rows[0]).length > 8 ? '...' : ''}
        </div>
      )}

      {error && (
        <div style={{ fontSize: '0.78rem', color: '#f87171', background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px', padding: '8px 12px' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ fontSize: '0.82rem', color: '#4ade80', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '6px', padding: '10px 14px' }}>
          [ok] Imported <strong>{result.inserted}</strong> of <strong>{result.total_parsed}</strong> rows into the database.
        </div>
      )}

      <button
        className="btn-gold"
        onClick={doImport}
        disabled={!rows?.length || loading}
        style={{ alignSelf: 'flex-start', opacity: (!rows?.length || loading) ? 0.5 : 1 }}
      >
        {loading ? 'Importing...' : `Import ${rows ? rows.length.toLocaleString() + ' Rows' : 'CSV'}`}
      </button>
    </div>
  );
}

// ── Filter Builder ────────────────────────────────────────────────────────────
const SITUATIONS = [
  { value: 'all',          label: 'All Games' },
  { value: 'home_dog',     label: 'Home Underdog' },
  { value: 'home_big_dog', label: 'Home Big Dog (+150 or more)' },
  { value: 'away_dog',     label: 'Away Underdog' },
  { value: 'away_big_dog', label: 'Away Big Dog (+150 or more)' },
  { value: 'home_fav',     label: 'Home Favorite' },
  { value: 'away_fav',     label: 'Away Favorite' },
  { value: 'pick_em',      label: 'Pick \'em (within +/-115)' },
];

const BET_TYPES = [
  { value: 'ML',     label: 'Moneyline' },
  { value: 'Spread', label: 'Spread (ATS)' },
  { value: 'Over',   label: 'Over (total)' },
  { value: 'Under',  label: 'Under (total)' },
];

const SPORT_OPTS = [
  { value: 'ALL', label: 'All Sports' },
  { value: 'MLB', label: '[MLB] MLB' },
  { value: 'NFL', label: '[NFL] NFL' },
  { value: 'NBA', label: '[NBA] NBA' },
  { value: 'NHL', label: '[NHL] NHL' },
  { value: 'NCAAF', label: '[NFL] NCAAF' },
  { value: 'NCAAB', label: '[NBA] NCAAB' },
];

const currentYear = new Date().getFullYear();

// ── Backtest Runner ───────────────────────────────────────────────────────────
function RunBacktest({ userEmail }) {
  const [filters, setFilters] = useState({
    sport: 'ALL', situation: 'all', seasonStart: '2020', seasonEnd: String(currentYear),
    minDogOdds: '', maxDogOdds: '', totalMin: '', totalMax: '',
  });
  const [betType, setBetType]   = useState('ML');
  const [side, setSide]         = useState('home');
  const [loading, setLoading]   = useState(false);
  const [results, setResults]   = useState(null);
  const [error, setError]       = useState('');
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [gameCount, setGameCount] = useState(null);

  useEffect(() => {
    fetch(`/api/backtest?action=game-count&sport=${filters.sport}`)
      .then(r => r.json())
      .then(d => setGameCount(d.count ?? 0))
      .catch(() => {});
  }, [filters.sport]);

  function setFilter(k, v) { setFilters(f => ({ ...f, [k]: v })); }

  async function run() {
    setLoading(true); setError(''); setResults(null); setSaved(false);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-backtest', userEmail, filters, betType, side }),
      });
      const d = await res.json();
      if (!res.ok || d.error) { setError(d.error || `Server error ${res.status}`); }
      else { setResults(d.results); }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  async function saveEdge() {
    if (!saveName.trim() || !results) return;
    setSaving(true);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-edge', userEmail, name: saveName, description: saveDesc, results, filters, betType, side }),
      });
      const d = await res.json();
      if (d.error) { setError(d.error); }
      else { setSaved(true); setSaveName(''); setSaveDesc(''); }
    } catch (e) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Game count indicator */}
      {gameCount !== null && (
        <div style={{ fontSize: '0.75rem', color: gameCount > 0 ? '#86efac' : '#fbbf24', background: gameCount > 0 ? 'rgba(74,222,128,0.06)' : 'rgba(251,191,36,0.06)', border: `1px solid ${gameCount > 0 ? 'rgba(74,222,128,0.2)' : 'rgba(251,191,36,0.2)'}`, borderRadius: '6px', padding: '8px 12px' }}>
          {gameCount > 0
            ? `[?] ${gameCount.toLocaleString()} historical games available for ${filters.sport === 'ALL' ? 'all sports' : filters.sport}`
            : `[!] No historical data found for ${filters.sport === 'ALL' ? 'any sport' : filters.sport}. Import CSV data first.`}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <Label>Sport</Label>
          <Select value={filters.sport} onChange={v => setFilter('sport', v)} options={SPORT_OPTS} />
        </div>
        <div>
          <Label>Season From</Label>
          <input className="input" type="number" value={filters.seasonStart} onChange={e => setFilter('seasonStart', e.target.value)} min="2000" max={currentYear} style={{ width: '80px', fontSize: '0.82rem', padding: '6px 10px' }} />
        </div>
        <div>
          <Label>Season To</Label>
          <input className="input" type="number" value={filters.seasonEnd} onChange={e => setFilter('seasonEnd', e.target.value)} min="2000" max={currentYear} style={{ width: '80px', fontSize: '0.82rem', padding: '6px 10px' }} />
        </div>
        <div style={{ flex: 1, minWidth: '180px' }}>
          <Label>Situation</Label>
          <Select value={filters.situation} onChange={v => setFilter('situation', v)} options={SITUATIONS} />
        </div>
        <div>
          <Label>Bet Type</Label>
          <Select value={betType} onChange={setBetType} options={BET_TYPES} />
        </div>
        <div>
          <Label>Side</Label>
          <Select value={side} onChange={setSide} options={[{ value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]} />
        </div>
      </div>

      {/* Advanced odds filters */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <Label>Min ML Odds</Label>
          <input className="input" type="number" placeholder="e.g. 110" value={filters.minDogOdds} onChange={e => setFilter('minDogOdds', e.target.value)} style={{ width: '90px', fontSize: '0.82rem', padding: '6px 10px' }} />
        </div>
        <div>
          <Label>Max ML Odds</Label>
          <input className="input" type="number" placeholder="e.g. 250" value={filters.maxDogOdds} onChange={e => setFilter('maxDogOdds', e.target.value)} style={{ width: '90px', fontSize: '0.82rem', padding: '6px 10px' }} />
        </div>
        <div>
          <Label>Total Min</Label>
          <input className="input" type="number" placeholder="e.g. 7.5" value={filters.totalMin} onChange={e => setFilter('totalMin', e.target.value)} style={{ width: '80px', fontSize: '0.82rem', padding: '6px 10px' }} />
        </div>
        <div>
          <Label>Total Max</Label>
          <input className="input" type="number" placeholder="e.g. 10.5" value={filters.totalMax} onChange={e => setFilter('totalMax', e.target.value)} style={{ width: '80px', fontSize: '0.82rem', padding: '6px 10px' }} />
        </div>
      </div>

      <button className="btn-gold" onClick={run} disabled={loading} style={{ alignSelf: 'flex-start', opacity: loading ? 0.6 : 1 }}>
        {loading ? '[wait] Running Backtest...' : '> Run Backtest'}
      </button>

      {error && (
        <div style={{ fontSize: '0.78rem', color: '#f87171', background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px', padding: '10px 14px' }}>
          {error}
        </div>
      )}

      {/* Results */}
      {results && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '0.75rem' }}>
            {[
              { label: 'Record', value: `${results.wins}-${results.losses}${results.pushes > 0 ? `-${results.pushes}` : ''}` },
              { label: 'Win %', value: `${results.win_pct}%`, color: results.win_pct >= 53 ? '#4ade80' : results.win_pct >= 50 ? '#fbbf24' : '#f87171' },
              { label: 'ROI', value: `${results.roi > 0 ? '+' : ''}${results.roi}%`, color: roiColor(results.roi) },
              { label: 'Avg Odds', value: fmtOdds(results.avg_odds) },
              { label: 'Sample', value: results.total.toLocaleString(), sub: 'games matched' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '0.85rem 1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>{s.label}</div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace', color: s.color || 'var(--text-primary)' }}>{s.value}</div>
                {s.sub && <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Sample games table */}
          {results.sample_games?.length > 0 && (
            <div>
              <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                Sample Games (showing {results.sample_games.length} of {results.total})
              </div>
              <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                      {['Date', 'Matchup', 'Score', 'ML', 'Spread', 'Total', 'Result'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', fontWeight: 600, letterSpacing: '0.05em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.sample_games.map((g, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                        <td style={{ padding: '7px 10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{g.date}</td>
                        <td style={{ padding: '7px 10px', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{g.matchup}</td>
                        <td style={{ padding: '7px 10px', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-secondary)' }}>{g.score}</td>
                        <td style={{ padding: '7px 10px', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem' }}>
                          <span style={{ color: '#86efac' }}>{fmtOdds(g.home_ml)}</span>
                          {' / '}
                          <span style={{ color: '#f87171' }}>{fmtOdds(g.away_ml)}</span>
                        </td>
                        <td style={{ padding: '7px 10px', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{g.spread ?? '-'}</td>
                        <td style={{ padding: '7px 10px', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{g.total ?? '-'}</td>
                        <td style={{ padding: '7px 10px' }}>
                          <span style={{
                            fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: '4px',
                            color: g.result === 'WIN' ? '#4ade80' : g.result === 'LOSS' ? '#f87171' : '#fbbf24',
                            background: g.result === 'WIN' ? 'rgba(74,222,128,0.08)' : g.result === 'LOSS' ? 'rgba(248,113,113,0.08)' : 'rgba(251,191,36,0.08)',
                            border: `1px solid ${g.result === 'WIN' ? 'rgba(74,222,128,0.2)' : g.result === 'LOSS' ? 'rgba(248,113,113,0.2)' : 'rgba(251,191,36,0.2)'}`,
                          }}>
                            {g.result}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Save as sharp edge */}
          {results.total >= 20 && results.roi > 2 && !saved && (
            <div style={{ background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.2)', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ fontWeight: 700, color: '#FFB800', fontSize: '0.85rem', marginBottom: '8px' }}>
                [sharp] Save as Sharp Edge
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.75rem' }}>
                This system shows a +{results.roi}% ROI over {results.total} games - save it as a named edge to track and surface in AI prompts.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <Label>Edge Name *</Label>
                  <input
                    className="input"
                    placeholder="e.g. MLB Home Dog (+150 to +250)"
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  />
                </div>
                <div style={{ flex: 2, minWidth: '240px' }}>
                  <Label>Description</Label>
                  <input
                    className="input"
                    placeholder="Optional - context for the AI"
                    value={saveDesc}
                    onChange={e => setSaveDesc(e.target.value)}
                    style={{ width: '100%', fontSize: '0.82rem' }}
                  />
                </div>
                <button className="btn-gold" onClick={saveEdge} disabled={saving || !saveName.trim()} style={{ opacity: (!saveName.trim() || saving) ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                  {saving ? 'Saving...' : '[save] Save Edge'}
                </button>
              </div>
            </div>
          )}

          {saved && (
            <div style={{ fontSize: '0.82rem', color: '#4ade80', background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '6px', padding: '10px 14px' }}>
              [ok] Edge saved! It will now appear in the Active Edges list and be surfaced in AI trend analysis.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Active Edges List ─────────────────────────────────────────────────────────
function ActiveEdges({ userEmail }) {
  const [edges, setEdges]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/backtest?action=edges');
      const d = await res.json();
      setEdges(d.edges || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(id, isActive) {
    await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle-edge', userEmail, edgeId: id, isActive }),
    });
    load();
  }

  async function del(id) {
    if (!confirm('Delete this edge? This cannot be undone.')) return;
    await fetch('/api/backtest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete-edge', userEmail, edgeId: id }),
    });
    load();
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '1rem' }}>Loading edges...</div>;
  if (error)   return <div style={{ color: '#f87171', fontSize: '0.78rem' }}>{error}</div>;
  if (!edges.length) return (
    <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
      No edges saved yet. Run a backtest with positive ROI and a sample size >= 20 games to save your first edge.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {edges.map(edge => (
        <div key={edge.id} style={{
          background: 'var(--bg-elevated)', border: `1px solid ${edge.is_active ? 'rgba(255,184,0,0.2)' : 'var(--border)'}`,
          borderRadius: '10px', padding: '0.9rem 1rem',
          opacity: edge.is_active ? 1 : 0.55, transition: 'all 0.15s',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.88rem' }}>{edge.name}</span>
                <span style={{
                  fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: '3px',
                  color: edge.is_active ? '#4ade80' : '#888',
                  background: edge.is_active ? 'rgba(74,222,128,0.08)' : 'rgba(100,100,100,0.1)',
                  border: `1px solid ${edge.is_active ? 'rgba(74,222,128,0.2)' : 'rgba(100,100,100,0.2)'}`,
                }}>
                  {edge.is_active ? 'ACTIVE' : 'PAUSED'}
                </span>
                <span style={{ fontSize: '0.6rem', color: '#555', background: '#111', border: '1px solid #222', padding: '1px 6px', borderRadius: '3px' }}>
                  {edge.sport} . {edge.bet_type}
                </span>
              </div>
              {edge.description && (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '0 0 6px', lineHeight: 1.5 }}>{edge.description}</p>
              )}
              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                {[
                  { label: 'Record', value: `${edge.wins}-${edge.losses}` },
                  { label: 'Win%', value: `${edge.win_pct}%`, color: edge.win_pct >= 53 ? '#4ade80' : '#fbbf24' },
                  { label: 'ROI', value: `${edge.roi > 0 ? '+' : ''}${edge.roi}%`, color: roiColor(edge.roi) },
                  { label: 'Avg Odds', value: fmtOdds(edge.avg_odds) },
                  { label: 'Seasons', value: edge.season_range || '-' },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ fontSize: '0.58rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{s.label}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.82rem', fontWeight: 700, color: s.color || 'var(--text-secondary)' }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
              <button
                onClick={() => toggle(edge.id, !edge.is_active)}
                style={{
                  padding: '5px 12px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 600,
                  cursor: 'pointer', border: '1px solid var(--border)',
                  background: edge.is_active ? 'rgba(248,113,113,0.08)' : 'rgba(74,222,128,0.08)',
                  color: edge.is_active ? '#f87171' : '#4ade80',
                  transition: 'all 0.12s',
                }}
              >
                {edge.is_active ? 'Pause' : 'Activate'}
              </button>
              <button
                onClick={() => del(edge.id)}
                style={{
                  padding: '5px 10px', borderRadius: '6px', fontSize: '0.72rem',
                  cursor: 'pointer', border: '1px solid rgba(248,113,113,0.2)',
                  background: 'rgba(248,113,113,0.05)', color: '#f87171',
                  transition: 'all 0.12s',
                }}
              >
                x
              </button>
            </div>
          </div>
        </div>
      ))}

      <button onClick={load} style={{ alignSelf: 'flex-end', background: 'none', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-muted)', fontSize: '0.72rem', padding: '4px 10px', cursor: 'pointer' }}>
        [refresh] Refresh
      </button>
    </div>
  );
}

// ── Main BacktestPanel ────────────────────────────────────────────────────────
const PANEL_TABS = [
  { id: 'run',    label: '> Run Backtest' },
  { id: 'edges',  label: '[sharp] Saved Edges' },
  { id: 'import', label: '[?] Import CSV' },
];

export default function BacktestPanel({ userEmail }) {
  const [tab, setTab]         = useState('run');
  const [importCount, setImportCount] = useState(0); // force game-count refresh

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Intro */}
      <div style={{ padding: '1rem 1.2rem', background: 'linear-gradient(135deg, #0a0a14, #100e08)', border: '1px solid rgba(255,184,0,0.15)', borderRadius: '12px' }}>
        <div style={{ fontWeight: 800, color: '#FFB800', fontSize: '0.95rem', marginBottom: '4px' }}>[up] Historical Backtester</div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.77rem', lineHeight: 1.6, margin: 0 }}>
          Import historical game data, build situational filters, and discover edges with provable ROI. Saved edges feed into the AI trend engine automatically.
        </p>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {PANEL_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '6px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.8rem',
            border: `1px solid ${tab === t.id ? 'rgba(255,184,0,0.5)' : 'var(--border)'}`,
            background: tab === t.id ? 'rgba(255,184,0,0.08)' : 'transparent',
            color: tab === t.id ? '#FFB800' : 'var(--text-muted)',
            fontWeight: tab === t.id ? 700 : 400, transition: 'all 0.12s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Panel body - all three stay mounted so switching tabs mid-backtest
          doesn't cancel an in-flight run. display:none keeps them alive. */}
      <div style={{ display: tab === 'run' ? 'block' : 'none' }}>
        <Section title="Filter Builder & Results">
          <RunBacktest userEmail={userEmail} key={importCount} />
        </Section>
      </div>
      <div style={{ display: tab === 'edges' ? 'block' : 'none' }}>
        <Section title="Your Sharp Edges">
          <ActiveEdges userEmail={userEmail} />
        </Section>
      </div>
      <div style={{ display: tab === 'import' ? 'block' : 'none' }}>
        <Section title="CSV Import">
          <ImportPanel userEmail={userEmail} onImported={() => { setImportCount(c => c + 1); setTab('run'); }} />
        </Section>
      </div>
    </div>
  );
}
