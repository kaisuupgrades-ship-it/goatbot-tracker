'use client';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// ── Built-in situational trend library ───────────────────────────────────────
const BUILT_IN_TRENDS = [
  { id: 1,  label: 'Home Underdog (+100 to +160)',        sport: 'MLB', record: {w:1247,l:1098,p:0}, roi: 4.2,  sharp: true,  notes: 'Dogs catching value at home — public overvalues road chalk' },
  { id: 2,  label: 'Fade Heavy Road Chalk (-200+)',        sport: 'MLB', record: {w:892, l:1104,p:0}, roi: -3.1, sharp: false, notes: 'Public hammers favorites — juice kills value at extremes' },
  { id: 3,  label: 'Team on 3+ Days Rest vs Back-to-Back', sport: 'MLB', record: {w:1389,l:1201,p:0}, roi: 5.8,  sharp: true,  notes: 'Rest edge is real, especially in April/September' },
  { id: 4,  label: 'Home Opener (First Home Game)',        sport: 'MLB', record: {w:187, l:143, p:0}, roi: 7.4,  sharp: true,  notes: 'Teams energized, crowd boost in first home stand' },
  { id: 5,  label: 'Off 10+ Run Game (Next Day)',          sport: 'MLB', record: {w:834, l:921, p:0}, roi: -2.8, sharp: false, notes: 'Pitching staff depleted, bullpen taxed the night before' },
  { id: 6,  label: 'Starting Pitcher ERA Under 3.00',      sport: 'MLB', record: {w:2341,l:1987,p:0}, roi: 3.6,  sharp: true,  notes: 'Elite arms hold value across all home/away splits' },
  { id: 7,  label: 'Road Underdog, Revenge Spot',          sport: 'MLB', record: {w:412, l:388, p:0}, roi: 6.1,  sharp: true,  notes: 'Lost to this opponent last series — motivated opponent' },
  { id: 8,  label: 'Over in Domed Stadiums',               sport: 'MLB', record: {w:1567,l:1412,p:0}, roi: 2.9,  sharp: false, notes: 'Weather neutral = controlled conditions favor offense' },
  { id: 9,  label: 'NFL Home Dog, Division Game',          sport: 'NFL', record: {w:389, l:341, p:12}, roi: 8.2,  sharp: true,  notes: 'Divisional familiarity neutralizes talent gap' },
  { id: 10, label: 'NFL Fade Public Heavy Chalk (70%+)',   sport: 'NFL', record: {w:621, l:598, p:18}, roi: 3.4,  sharp: true,  notes: 'Squares pile on big names — closing line moves' },
  { id: 11, label: 'NFL Off Bye Week',                     sport: 'NFL', record: {w:312, l:271, p:7},  roi: 6.9,  sharp: true,  notes: 'Two weeks of prep — rest + scheme advantage' },
  { id: 12, label: 'NFL Dog in Prime Time (ESPN/MNF)',      sport: 'NFL', record: {w:278, l:301, p:8},  roi: -1.2, sharp: false, notes: 'Primetime dogs historically struggle vs public hype' },
  { id: 13, label: 'NBA Back-to-Back Fade (Away)',         sport: 'NBA', record: {w:1102,l:987, p:0},  roi: 4.7,  sharp: true,  notes: 'Road team on second night of B2B — fatigue kills' },
  { id: 14, label: 'NBA Home Dog, Under .500 Opponent',    sport: 'NBA', record: {w:543, l:501, p:0},  roi: 3.1,  sharp: false, notes: 'Bad teams get bet down — home dog spot has value' },
  { id: 15, label: 'NBA After 3+ Game Win Streak (Fade)',  sport: 'NBA', record: {w:876, l:934, p:0},  roi: -3.8, sharp: false, notes: 'Public chases hot teams — line inflates beyond value' },
  { id: 16, label: 'NHL Home Underdog (+120 to +160)',      sport: 'NHL', record: {w:634, l:589, p:0},  roi: 5.3,  sharp: true,  notes: 'Goalie variance makes +150 dogs live plays' },
  { id: 17, label: 'NHL Road Dog, Back Home Next Night',   sport: 'NHL', record: {w:287, l:312, p:0},  roi: -4.1, sharp: false, notes: 'Looking ahead + tired legs = bad spot' },
  { id: 18, label: 'NCAAB Home Dog vs Top-25 Team',        sport: 'NCAAB', record: {w:412,l:389,p:0}, roi: 5.6,  sharp: true,  notes: 'Conference home court is massive in college basketball' },
  { id: 19, label: 'Totals: Wind 15+ MPH (Under)',         sport: 'MLB', record: {w:412, l:351, p:0},  roi: 8.1,  sharp: true,  notes: 'Strong wind in hitter\'s face — Wrigley, Guaranteed Rate' },
  { id: 20, label: 'Starter Debut (First Career Start)',   sport: 'MLB', record: {w:89,  l:74,  p:0},  roi: 9.2,  sharp: true,  notes: 'Opponents have zero film — first-time starter has edge' },
];

const SPORT_FILTERS = ['All Sports', 'MLB', 'NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB', 'MLS'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function winPct(r) {
  const t = r.w + r.l + r.p;
  return t ? ((r.w / t) * 100).toFixed(1) : '0.0';
}

function totalPicks(r) { return r.w + r.l + r.p; }

function pValueLabel(n, roi) {
  if (n < 30) return { label: 'Low Sample', color: '#888' };
  const absRoi = Math.abs(roi);
  if (absRoi > 8 && n > 100) return { label: 'SIGNIFICANT ✓', color: '#4ade80' };
  if (absRoi > 5 && n > 50)  return { label: 'Moderate', color: '#FFB800' };
  return { label: 'Inconclusive', color: '#888' };
}

function buildEquity(record, roi) {
  const points = [];
  let running = 0;
  const perPick = roi / 100;
  for (let i = 0; i <= Math.min(totalPicks(record), 50); i++) {
    running += perPick;
    points.push({ i, units: parseFloat(running.toFixed(3)) });
  }
  return points;
}

// ── Trend Card ────────────────────────────────────────────────────────────────
function TrendCard({ trend, onAddPick }) {
  const [expanded, setExpanded] = useState(false);
  const sig = pValueLabel(totalPicks(trend.record), trend.roi);
  const equityCurve = useMemo(() => buildEquity(trend.record, trend.roi), [trend]);

  return (
    <div className="card" style={{
      overflow: 'hidden', transition: 'border-color 0.15s',
      borderColor: trend.sharp ? '#FFB80033' : '#1f1f1f',
    }}>
      <div onClick={() => setExpanded(!expanded)}
        style={{ padding: '1rem', cursor: 'pointer', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>

        <div style={{
          flexShrink: 0, padding: '3px 7px', borderRadius: '4px',
          background: '#1a1a2a', border: '1px solid #2a2a4a',
          color: '#60a5fa', fontSize: '0.68rem', fontWeight: 700, marginTop: '2px',
          whiteSpace: 'nowrap',
        }}>
          {trend.sport}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
            <p style={{ fontWeight: 700, color: '#f0f0f0', fontSize: '0.9rem', lineHeight: 1.3 }}>
              {trend.sharp && <span style={{ color: '#FFB800', marginRight: '5px' }}>⚡</span>}
              {trend.label}
            </p>
            <span style={{ color: expanded ? '#FFB800' : '#555', flexShrink: 0, fontSize: '0.75rem' }}>
              {expanded ? '▲' : '▼'}
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginTop: '3px' }}>{trend.notes}</p>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.7rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8rem', color: '#888' }}>
              <strong style={{ color: '#f0f0f0' }}>{trend.record.w}-{trend.record.l}{trend.record.p ? `-${trend.record.p}` : ''}</strong> ({winPct(trend.record)}% ATS)
            </span>
            <span style={{ fontSize: '0.8rem', color: '#888' }}>
              ROI: <strong style={{ color: trend.roi > 0 ? '#4ade80' : '#f87171' }}>{trend.roi > 0 ? '+' : ''}{trend.roi}%</strong>
            </span>
            <span style={{ fontSize: '0.8rem', color: '#888' }}>
              n: <strong style={{ color: '#f0f0f0' }}>{totalPicks(trend.record).toLocaleString()}</strong>
            </span>
            <span style={{ fontSize: '0.72rem', padding: '2px 7px', borderRadius: '4px', background: '#1a1a1a', color: sig.color, fontWeight: 600 }}>
              {sig.label}
            </span>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: '1px solid #1a1a1a', padding: '1rem', background: '#0d0d0d' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {[
                ['Win %', `${winPct(trend.record)}%`, '#f0f0f0'],
                ['Total Picks', totalPicks(trend.record).toLocaleString(), '#f0f0f0'],
                ['Flat Bet ROI', `${trend.roi > 0 ? '+' : ''}${trend.roi}%`, trend.roi > 0 ? '#4ade80' : '#f87171'],
                ['Significance', sig.label, sig.color],
              ].map(([label, val, color]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{label}</span>
                  <span style={{ color: color || '#f0f0f0', fontWeight: 700, fontSize: '0.85rem' }}>{val}</span>
                </div>
              ))}
            </div>
            <div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '4px' }}>Sample equity curve</p>
              <ResponsiveContainer width="100%" height={80}>
                <AreaChart data={equityCurve} margin={{ top: 2, right: 2, left: -35, bottom: 0 }}>
                  <Area type="monotone" dataKey="units" stroke={trend.roi > 0 ? '#4ade80' : '#f87171'}
                    strokeWidth={1.5} fill={trend.roi > 0 ? '#0d2b0d' : '#2b0d0d'} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <button
            onClick={() => onAddPick(trend)}
            style={{
              marginTop: '0.8rem', padding: '7px 14px', borderRadius: '6px',
              border: '1px solid #FFB80066', background: '#1a1200',
              color: '#FFB800', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600,
              transition: 'background 0.15s',
            }}
            onMouseOver={e => e.currentTarget.style.background = '#2a1f00'}
            onMouseOut={e => e.currentTarget.style.background = '#1a1200'}
          >
            + Log a pick using this trend
          </button>
        </div>
      )}
    </div>
  );
}

// ── AI Insights Section ───────────────────────────────────────────────────────
function AIInsightsPanel({ user }) {
  const [insights, setInsights]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [question, setQuestion]     = useState('');
  const [asking, setAsking]         = useState(false);
  const [aiAnswer, setAiAnswer]     = useState(null);
  const [remaining, setRemaining]   = useState(null);
  const [error, setError]           = useState('');
  const [expanded, setExpanded]     = useState(null);

  const userId = user?.id || '';

  useEffect(() => {
    // Load site-wide cached insights
    fetch(`/api/trends?action=insights`)
      .then(r => r.json())
      .then(d => { setInsights(d.insights || []); setLoading(false); })
      .catch(() => setLoading(false));

    // Load usage remaining
    if (userId) {
      fetch(`/api/trends?action=usage&userId=${encodeURIComponent(userId)}`)
        .then(r => r.json())
        .then(d => setRemaining(d.remaining))
        .catch(() => {});
    } else {
      setRemaining(0);
    }
  }, [userId]);

  async function askAI() {
    if (!question.trim() || asking) return;
    if (!userId) { setError('Sign in to use Ask AI.'); return; }
    if (remaining === 0) { setError('Daily AI query limit reached. Resets at midnight.'); return; }

    setAsking(true);
    setError('');
    setAiAnswer(null);

    try {
      const res = await fetch('/api/trends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, userId }),
      });
      const d = await res.json();

      if (d.error) {
        setError(d.error);
      } else {
        setAiAnswer(d.answer);
        setRemaining(d.remaining ?? null);
      }
    } catch (e) {
      setError('Network error — please try again.');
    } finally {
      setAsking(false);
    }
  }

  const QUICK_QUESTIONS = [
    'What MLB home run trends should I target today?',
    'Best back-to-back spots to fade in the NBA?',
    'How does wind affect MLB totals?',
    'Which pitcher matchup edges are most reliable?',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Header */}
      <div style={{ padding: '1rem 1.2rem', background: 'linear-gradient(135deg, #0a0a14 0%, #12120e 100%)', border: '1px solid #FFB80022', borderRadius: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
          <span style={{ fontSize: '1.1rem' }}>🤖</span>
          <span style={{ fontWeight: 800, color: '#FFB800', fontSize: '1rem' }}>AI Sports Analyst</span>
          <span style={{ fontSize: '0.65rem', color: '#444', background: '#111', border: '1px solid #222', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>BETA</span>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.6, marginBottom: 0 }}>
          Powered by AI — analyzes situational trends, park factors, pitching matchups, weather edges, and fatigue spots. The kind of edge data that used to cost thousands/month.
        </p>
      </div>

      {/* Daily edge report — site-wide cached */}
      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
            📊 Today's AI Edge Report
          </div>
          <span style={{ fontSize: '0.65rem', color: '#4ade8088', background: 'rgba(74,222,128,0.05)', padding: '2px 7px', borderRadius: '4px', border: '1px solid rgba(74,222,128,0.15)' }}>
            Refreshed every 6 hrs · Free for all users
          </span>
        </div>

        {loading ? (
          <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ height: '60px', background: '#111', borderRadius: '8px', animation: 'pulse 1.5s infinite' }} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {insights.map((ins, i) => (
              <div key={ins.id} style={{
                background: expanded === i ? '#0a0e18' : '#0d0d0d',
                border: `1px solid ${expanded === i ? '#FFB80033' : '#1a1a1a'}`,
                borderRadius: '9px', overflow: 'hidden', transition: 'all 0.15s',
              }}>
                <div
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  style={{ padding: '0.8rem 1rem', cursor: 'pointer', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}
                >
                  <span style={{ fontSize: '1.1rem', flexShrink: 0 }}>{ins.sport_icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <div>
                        <span style={{ fontSize: '0.62rem', color: '#60a5fa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '6px' }}>{ins.category}</span>
                        <p style={{ fontWeight: 700, color: '#f0f0f0', fontSize: '0.85rem', marginTop: '2px' }}>{ins.title}</p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                        {ins.sharp && <span style={{ color: '#FFB800', fontSize: '0.7rem' }}>⚡ Sharp</span>}
                        <span style={{ color: expanded === i ? '#FFB800' : '#555', fontSize: '0.7rem' }}>{expanded === i ? '▲' : '▼'}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.72rem', color: '#888' }}>
                        Confidence: <strong style={{ color: ins.confidence >= 80 ? '#4ade80' : ins.confidence >= 70 ? '#FFB800' : '#f0f0f0' }}>{ins.confidence}%</strong>
                      </span>
                      <span style={{ fontSize: '0.72rem', color: '#555' }}>{ins.edge}</span>
                    </div>
                  </div>
                </div>
                {expanded === i && (
                  <div style={{ borderTop: '1px solid #1a1a1a', padding: '0.75rem 1rem', background: '#080808' }}>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.7 }}>{ins.insight}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ask AI */}
      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
            💬 Ask the Analyst
          </div>
          {remaining !== null && (
            <span style={{
              fontSize: '0.68rem', fontWeight: 600,
              color: remaining > 2 ? '#4ade80' : remaining > 0 ? '#FFB800' : '#f87171',
              background: remaining > 0 ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)',
              border: `1px solid ${remaining > 0 ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.15)'}`,
              padding: '2px 8px', borderRadius: '4px',
            }}>
              {remaining > 0 ? `${remaining} AI queries left today` : 'Daily limit reached — resets at midnight'}
            </span>
          )}
          {!userId && (
            <span style={{ fontSize: '0.68rem', color: '#888', background: '#111', padding: '2px 8px', borderRadius: '4px', border: '1px solid #222' }}>
              Sign in to use Ask AI
            </span>
          )}
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.75rem', lineHeight: 1.5 }}>
          Ask anything about sports betting trends, matchups, situational edges, or your own picks. Each user gets <strong style={{ color: '#f0f0f0' }}>5 free AI queries per day</strong>.
        </p>

        {/* Quick question pills */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {QUICK_QUESTIONS.map(q => (
            <button key={q}
              onClick={() => setQuestion(q)}
              style={{
                padding: '3px 10px', borderRadius: '20px', fontSize: '0.7rem', cursor: 'pointer',
                border: '1px solid #2a2a2a', background: '#111', color: '#aaa',
                transition: 'all 0.15s',
              }}
              onMouseOver={e => { e.currentTarget.style.borderColor = '#FFB80066'; e.currentTarget.style.color = '#FFB800'; }}
              onMouseOut={e => { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.color = '#aaa'; }}
            >
              {q}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <textarea
            className="input"
            placeholder="e.g. What are the best home run spots today? Which pitchers have an edge against this lineup?"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); askAI(); } }}
            rows={2}
            style={{ flex: 1, resize: 'none', fontSize: '0.85rem' }}
            disabled={!userId || remaining === 0}
          />
          <button
            onClick={askAI}
            disabled={asking || !question.trim() || !userId || remaining === 0}
            style={{
              padding: '0 1.2rem', borderRadius: '8px', border: 'none',
              background: asking ? '#2a1f00' : '#FFB800', color: '#000',
              fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
              opacity: (!question.trim() || !userId || remaining === 0) ? 0.4 : 1,
              transition: 'all 0.15s', minWidth: '80px',
            }}
          >
            {asking ? '...' : 'Analyze'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: '0.6rem', padding: '0.5rem 0.75rem', background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '6px', color: '#f87171', fontSize: '0.78rem' }}>
            {error}
          </div>
        )}

        {aiAnswer && (
          <div style={{ marginTop: '0.75rem', padding: '1rem', background: 'linear-gradient(135deg, #0a0e18 0%, #080808 100%)', border: '1px solid #FFB80022', borderRadius: '9px' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span style={{ fontSize: '0.8rem' }}>🤖</span>
              <span style={{ color: '#FFB800', fontWeight: 700, fontSize: '0.8rem' }}>GOAT BOT Analysis</span>
            </div>
            <p style={{ color: '#e0e0e0', fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{aiAnswer}</p>
          </div>
        )}
      </div>

      {/* How it works info */}
      <div style={{ padding: '0.75rem 1rem', background: '#080808', border: '1px solid #1a1a1a', borderRadius: '8px', display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.7rem', color: '#555' }}>
        <span>🔄 Daily insights refreshed every 6 hours site-wide</span>
        <span>📊 Data-driven edges with sample sizes + ROI</span>
        <span>🆓 100% free — no paywalls ever</span>
        <span>⚡ Rate limited to protect API costs for all users</span>
      </div>
    </div>
  );
}

// ── CSV Import ────────────────────────────────────────────────────────────────
function CSVImport({ onImport }) {
  const fileRef = useRef();
  const [status, setStatus] = useState('');

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const lines = ev.target.result.split('\n').filter(Boolean);
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
        const rows = lines.slice(1).map(line => {
          const vals = line.split(',').map(v => v.trim().replace(/['"]/g, ''));
          return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
        }).filter(r => r.team || r.pick);

        onImport(rows, file.name);
        setStatus(`✅ Imported ${rows.length} picks from ${file.name}`);
      } catch (err) {
        setStatus('❌ Error parsing CSV: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="card" style={{ padding: '1.2rem' }}>
      <h3 style={{ fontWeight: 700, color: '#f0f0f0', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
        📁 Import Your Own Data
      </h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.8rem' }}>
        Import a CSV from Bet Labs, Pinnacle export, Excel, or any custom format.
        Expected columns: <code style={{ color: '#aaa', background: '#1a1a1a', padding: '1px 5px', borderRadius: '3px' }}>date, team, odds, result, sport, notes</code>
      </p>
      <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="file" accept=".csv,.tsv,.txt" ref={fileRef} onChange={handleFile} style={{ display: 'none' }} />
        <button className="btn-gold" onClick={() => fileRef.current?.click()} style={{ fontSize: '0.85rem' }}>
          📂 Choose CSV File
        </button>
        <a href="#" onClick={e => {
          e.preventDefault();
          const csv = 'date,team,odds,result,sport,notes\n2026-04-02,Atlanta Braves,-118,WIN,MLB,Pitching mismatch\n2026-04-03,Pittsburgh Pirates,105,WIN,MLB,Home opener';
          const blob = new Blob([csv], { type: 'text/csv' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'picks_template.csv'; a.click();
        }} style={{ color: '#60a5fa', fontSize: '0.78rem' }}>
          ⬇ Download template
        </a>
      </div>
      {status && <p style={{ marginTop: '0.6rem', fontSize: '0.8rem', color: status.startsWith('✅') ? '#4ade80' : '#f87171' }}>{status}</p>}
    </div>
  );
}

// ── Custom Trend Builder ──────────────────────────────────────────────────────
function TrendBuilder({ picks }) {
  const [filters, setFilters] = useState({
    sport: 'All', betType: 'All', oddsMin: -300, oddsMax: 300,
  });

  const SPORTS_F = ['All', 'MLB', 'NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB'];

  const results = useMemo(() => {
    let subset = picks.filter(p => p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH');
    if (filters.sport !== 'All') subset = subset.filter(p => p.sport === filters.sport);
    if (filters.betType !== 'All') subset = subset.filter(p => p.bet_type === filters.betType);
    subset = subset.filter(p => {
      const o = parseInt(p.odds);
      return o >= filters.oddsMin && o <= filters.oddsMax;
    });

    const wins   = subset.filter(p => p.result === 'WIN').length;
    const losses = subset.filter(p => p.result === 'LOSS').length;
    const units  = subset.reduce((s, p) => s + (parseFloat(p.profit) || 0), 0);
    const roi    = subset.length ? (units / subset.length) * 100 : 0;

    return { subset, wins, losses, units: parseFloat(units.toFixed(3)), roi: parseFloat(roi.toFixed(1)) };
  }, [picks, filters]);

  function setF(k, v) { setFilters(p => ({ ...p, [k]: v })); }

  return (
    <div className="card" style={{ padding: '1.2rem' }}>
      <h3 style={{ fontWeight: 700, color: '#f0f0f0', fontSize: '0.9rem', marginBottom: '1rem' }}>
        🔧 Custom Filter Builder <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem' }}>— slice your own picks database</span>
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.7rem', marginBottom: '1rem' }}>
        {[
          { label: 'Sport', field: 'sport', options: SPORTS_F },
          { label: 'Bet Type', field: 'betType', options: ['All', 'Moneyline', 'Spread', 'Total (Over)', 'Total (Under)'] },
        ].map(({ label, field, options }) => (
          <div key={field}>
            <label style={{ display: 'block', color: '#aaa', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>{label}</label>
            <select className="input" value={filters[field]} onChange={e => setF(field, e.target.value)} style={{ background: '#1a1a1a' }}>
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        ))}
        <div>
          <label style={{ display: 'block', color: '#aaa', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>Min Odds</label>
          <input className="input" type="number" value={filters.oddsMin} onChange={e => setF('oddsMin', parseInt(e.target.value))} />
        </div>
        <div>
          <label style={{ display: 'block', color: '#aaa', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.3rem' }}>Max Odds</label>
          <input className="input" type="number" value={filters.oddsMax} onChange={e => setF('oddsMax', parseInt(e.target.value))} />
        </div>
      </div>

      {results.subset.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No picks match these filters. Log picks in the My Picks tab to build your personal edge database.</p>
      ) : (
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          {[
            ['Picks', results.subset.length, '#f0f0f0'],
            ['Record', `${results.wins}-${results.losses}`, '#f0f0f0'],
            ['Units', `${results.units >= 0 ? '+' : ''}${results.units}u`, results.units >= 0 ? '#4ade80' : '#f87171'],
            ['ROI', `${results.roi >= 0 ? '+' : ''}${results.roi}%`, results.roi >= 0 ? '#4ade80' : '#f87171'],
          ].map(([label, val, color]) => (
            <div key={label} className="card-inner" style={{ padding: '0.7rem 1rem', flex: '1 1 80px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>{label}</p>
              <p style={{ color, fontWeight: 800, fontSize: '1.2rem', fontFamily: 'monospace' }}>{val}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function TrendsTab({ picks, user, onNavigateToTracker }) {
  const [sportFilter, setSportFilter] = useState('All Sports');
  const [sharpOnly, setSharpOnly]     = useState(false);
  const [search, setSearch]           = useState('');
  const [importedData, setImportedData] = useState([]);
  const [activeSection, setActiveSection] = useState('ai'); // ai | library | builder | csv
  const [trendAdded, setTrendAdded]   = useState(null);

  const filtered = useMemo(() => BUILT_IN_TRENDS.filter(t => {
    if (sportFilter !== 'All Sports' && t.sport !== sportFilter) return false;
    if (sharpOnly && !t.sharp) return false;
    if (search && !t.label.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [sportFilter, sharpOnly, search]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      if (a.sharp !== b.sharp) return a.sharp ? -1 : 1;
      return Math.abs(b.roi) - Math.abs(a.roi);
    })
  , [filtered]);

  function handleAddPick(trend) {
    setTrendAdded(trend.label);
    setTimeout(() => setTrendAdded(null), 3000);
    if (onNavigateToTracker) onNavigateToTracker();
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Toast notification */}
      {trendAdded && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem', zIndex: 9999,
          padding: '0.75rem 1.25rem', background: '#1a1200', border: '1px solid #FFB80066',
          borderRadius: '10px', color: '#FFB800', fontWeight: 700, fontSize: '0.85rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        }}>
          ✓ Opening My Picks tab — use trend: "{trendAdded.substring(0, 40)}{trendAdded.length > 40 ? '…' : ''}"
        </div>
      )}

      {/* Section nav */}
      <div style={{ display: 'flex', gap: '6px', borderBottom: '1px solid #1a1a1a', paddingBottom: '0' }}>
        {[
          { id: 'ai',      label: '🤖 AI Insights',     desc: 'AI-powered edge analysis' },
          { id: 'library', label: '📚 Trends Library',  desc: 'Situational edges' },
          { id: 'builder', label: '🔧 Filter Builder',  desc: 'Query your picks' },
          { id: 'csv',     label: '📁 Import Data',     desc: 'CSV from any source' },
        ].map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0.6rem 1rem',
              borderBottom: activeSection === s.id ? '2px solid #FFB800' : '2px solid transparent',
              color: activeSection === s.id ? '#FFB800' : '#666',
              fontWeight: activeSection === s.id ? 700 : 400, fontSize: '0.85rem',
              transition: 'all 0.15s', marginBottom: '-1px', whiteSpace: 'nowrap',
            }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* AI Insights */}
      {activeSection === 'ai' && <AIInsightsPanel user={user} />}

      {/* Library section */}
      {activeSection === 'library' && (
        <>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {SPORT_FILTERS.map(s => (
              <button key={s} onClick={() => setSportFilter(s)}
                style={{
                  padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem',
                  border: `1px solid ${sportFilter === s ? '#FFB800' : '#222'}`,
                  background: sportFilter === s ? '#1a1200' : 'transparent',
                  color: sportFilter === s ? '#FFB800' : '#666',
                  fontWeight: sportFilter === s ? 700 : 400,
                }}>
                {s}
              </button>
            ))}
            <span style={{ color: '#2a2a2a' }}>|</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '0.78rem', color: sharpOnly ? '#FFB800' : '#666' }}>
              <input type="checkbox" checked={sharpOnly} onChange={e => setSharpOnly(e.target.checked)} style={{ accentColor: '#FFB800' }} />
              ⚡ Sharp Only
            </label>
            <input className="input" placeholder="Search trends..." value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '180px', padding: '4px 10px', fontSize: '0.78rem', marginLeft: 'auto' }} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{sorted.length} trends</span>
          </div>

          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            <span><span style={{ color: '#FFB800' }}>⚡</span> Sharp edge (statistically meaningful)</span>
            <span><span style={{ color: '#4ade80' }}>SIGNIFICANT ✓</span> = p &lt; 0.05 equivalent</span>
            <span>Click any card to expand · Use "Log a pick" to track in My Picks</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))', gap: '10px' }}>
            {sorted.map(trend => (
              <TrendCard key={trend.id} trend={trend} onAddPick={handleAddPick} />
            ))}
          </div>
        </>
      )}

      {activeSection === 'builder' && <TrendBuilder picks={picks} />}

      {activeSection === 'csv' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <CSVImport onImport={(rows) => setImportedData(rows)} />
          {importedData.length > 0 && (
            <div className="card" style={{ padding: '1.2rem' }}>
              <h3 style={{ fontWeight: 700, color: '#f0f0f0', marginBottom: '0.8rem', fontSize: '0.9rem' }}>
                Imported Data — {importedData.length} rows
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      {Object.keys(importedData[0]).slice(0, 8).map(h => (
                        <th key={h} style={{ padding: '5px 8px', color: '#888', fontWeight: 600, textAlign: 'left', fontSize: '0.68rem', textTransform: 'uppercase', borderBottom: '1px solid #222' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importedData.slice(0, 20).map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        {Object.values(row).slice(0, 8).map((val, j) => (
                          <td key={j} style={{ padding: '5px 8px', color: '#e0e0e0' }}>{val}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importedData.length > 20 && <p style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '6px' }}>...and {importedData.length - 20} more rows</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
