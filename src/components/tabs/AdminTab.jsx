'use client';
import { useState, useEffect, useCallback } from 'react';

const ADMIN_EMAIL = 'kaisuupgrades@gmail.com';

// ── Tiny reusable components ──────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'var(--text-primary)', icon }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px',
      padding: '1rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '4px',
    }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {icon && <span style={{ marginRight: '5px' }}>{icon}</span>}{label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace', color }}>{value ?? '—'}</div>
      {sub && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function Badge({ label, color = '#60a5fa', bg = 'rgba(96,165,250,0.1)', border = 'rgba(96,165,250,0.2)' }) {
  return (
    <span style={{ fontSize: '0.62rem', fontWeight: 700, color, background: bg, border: `1px solid ${border}`, borderRadius: '4px', padding: '1px 6px' }}>
      {label}
    </span>
  );
}

function AdminSection({ title, children }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
        {title}
        <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
      </div>
      {children}
    </div>
  );
}

// ── OVERVIEW TAB ─────────────────────────────────────────────────────────────
function OverviewPanel({ userEmail }) {
  const [data, setData]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/admin?action=stats&userEmail=${encodeURIComponent(userEmail)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [userEmail]);

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading analytics…</div>;
  if (error)   return <div style={{ color: '#f87171', padding: '1rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)' }}>⚠ {error}</div>;

  const topSport = data?.sportCounts ? Object.entries(data.sportCounts).sort((a, b) => b[1] - a[1])[0] : null;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '1.5rem' }}>
        <StatCard label="Total Users"    value={data?.totalUsers}  icon="👥" />
        <StatCard label="Total Picks"    value={data?.totalPicks}  icon="📋" />
        <StatCard label="Win Rate"       value={data?.winRate ? `${data.winRate}%` : '—'} icon="🎯" color={parseFloat(data?.winRate) >= 55 ? '#4ade80' : parseFloat(data?.winRate) >= 50 ? '#fbbf24' : '#f87171'} sub="last 200 picks" />
        <StatCard label="Top Sport"      value={topSport?.[0] || '—'} icon="🏆" sub={topSport ? `${topSport[1]} picks` : ''} />
      </div>

      <AdminSection title="Recent Signups">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {(data?.recentUsers || []).slice(0, 10).map(u => (
            <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0.5rem 0.75rem', background: 'var(--bg-elevated)', borderRadius: '7px', border: '1px solid var(--border)' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--bg-overlay)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
                {(u.username || '?')[0].toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600 }}>{u.username || 'Unknown'}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>{u.id?.slice(0, 16)}…</div>
              </div>
              {u.is_banned && <Badge label="BANNED" color="#f87171" bg="rgba(248,113,113,0.1)" border="rgba(248,113,113,0.2)" />}
              <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>
                {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
              </div>
            </div>
          ))}
          {(!data?.recentUsers?.length) && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>No user data — may need service role key</div>}
        </div>
      </AdminSection>

      <AdminSection title="Sport Distribution">
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {Object.entries(data?.sportCounts || {}).sort((a, b) => b[1] - a[1]).map(([sport, count]) => (
            <div key={sport} style={{ padding: '0.5rem 0.85rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', fontWeight: 700 }}>{sport}</div>
              <div style={{ color: 'var(--gold)', fontSize: '0.72rem', fontFamily: 'IBM Plex Mono, monospace' }}>{count} picks</div>
            </div>
          ))}
          {!Object.keys(data?.sportCounts || {}).length && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>No data yet</div>}
        </div>
      </AdminSection>
    </div>
  );
}

// ── USERS TAB ─────────────────────────────────────────────────────────────────
function UsersPanel({ userEmail }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [search, setSearch] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin?action=users&userEmail=${encodeURIComponent(userEmail)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [userEmail]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(action, targetId, value) {
    setActionMsg('');
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, userEmail, targetId, value }),
    });
    const d = await res.json();
    if (d.error) { setActionMsg(`Error: ${d.error}`); return; }
    setActionMsg(`✓ Done`);
    load();
    setTimeout(() => setActionMsg(''), 3000);
  }

  const users = (data?.users || []).filter(u =>
    !search || (u.username || '').toLowerCase().includes(search.toLowerCase()) || (u.id || '').includes(search)
  );

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading users…</div>;

  return (
    <div>
      {error && <div style={{ color: '#f87171', padding: '0.75rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '1rem' }}>⚠ {error}</div>}
      {actionMsg && <div style={{ color: '#4ade80', padding: '0.5rem 0.75rem', background: 'rgba(74,222,128,0.05)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>{actionMsg}</div>}

      <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem', alignItems: 'center' }}>
        <input
          className="input"
          placeholder="Search username or ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: '320px' }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{users.length} users</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {users.map(u => (
          <div key={u.id} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '0.65rem 0.85rem', background: 'var(--bg-elevated)',
            border: `1px solid ${u.is_banned ? 'rgba(248,113,113,0.25)' : 'var(--border)'}`,
            borderRadius: '8px', flexWrap: 'wrap',
          }}>
            <div style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--bg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>
              {(u.username || '?')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: '150px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 700 }}>{u.username || 'Unknown'}</span>
                {u.role === 'admin' && <Badge label="ADMIN" color="#fbbf24" bg="rgba(251,191,36,0.1)" border="rgba(251,191,36,0.2)" />}
                {u.is_banned && <Badge label="BANNED" color="#f87171" bg="rgba(248,113,113,0.1)" border="rgba(248,113,113,0.2)" />}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem' }}>{u.id?.slice(0, 20)}… · {u.pick_count || 0} picks · joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '?'}</div>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
              <button
                onClick={() => handleAction('ban_user', u.id, !u.is_banned)}
                style={{
                  padding: '4px 10px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', border: 'none',
                  background: u.is_banned ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                  color: u.is_banned ? '#4ade80' : '#f87171',
                }}
              >
                {u.is_banned ? 'Unban' : 'Ban'}
              </button>
              {u.role !== 'admin' ? (
                <button
                  onClick={() => handleAction('set_role', u.id, 'admin')}
                  style={{ padding: '4px 10px', borderRadius: '5px', fontSize: '0.72rem', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
                >
                  Make Admin
                </button>
              ) : (
                <button
                  onClick={() => handleAction('set_role', u.id, 'user')}
                  style={{ padding: '4px 10px', borderRadius: '5px', fontSize: '0.72rem', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
                >
                  Remove Admin
                </button>
              )}
            </div>
          </div>
        ))}
        {!users.length && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            No users found{search ? ` matching "${search}"` : ''} — ensure Supabase service role key is configured
          </div>
        )}
      </div>
    </div>
  );
}

// ── PICKS AUDIT TAB ───────────────────────────────────────────────────────────
function PicksAuditPanel({ userEmail }) {
  const [picks, setPicks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [page, setPage]     = useState(0);
  const [sport, setSport]   = useState('');
  const [actionMsg, setActionMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ action: 'picks', userEmail, page, ...(sport ? { sport } : {}) });
    fetch(`/api/admin?${params}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setPicks(d.picks || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [userEmail, page, sport]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id) {
    if (!confirm('Delete this pick? This cannot be undone.')) return;
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_pick', userEmail, targetId: id }),
    });
    const d = await res.json();
    if (d.error) { setActionMsg(`Error: ${d.error}`); return; }
    setActionMsg('✓ Pick deleted');
    setPicks(prev => prev.filter(p => p.id !== id));
    setTimeout(() => setActionMsg(''), 3000);
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading picks…</div>;

  return (
    <div>
      {error && <div style={{ color: '#f87171', padding: '0.75rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '1rem' }}>⚠ {error}</div>}
      {actionMsg && <div style={{ color: '#4ade80', padding: '0.5rem 0.75rem', background: 'rgba(74,222,128,0.05)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>{actionMsg}</div>}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {['', 'MLB', 'NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB'].map(s => (
          <button key={s} onClick={() => { setSport(s); setPage(0); }}
            style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', border: `1px solid ${sport === s ? 'var(--gold)' : 'var(--border)'}`, background: sport === s ? 'rgba(255,184,0,0.08)' : 'transparent', color: sport === s ? 'var(--gold)' : 'var(--text-muted)', fontWeight: sport === s ? 700 : 400 }}>
            {s || 'All'}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: page === 0 ? 'not-allowed' : 'pointer', fontSize: '0.75rem' }}>
            ← Prev
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', alignSelf: 'center' }}>Page {page + 1}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={picks.length < 50}
            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: picks.length < 50 ? 'not-allowed' : 'pointer', fontSize: '0.75rem' }}>
            Next →
          </button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['User', 'Date', 'Sport', 'Pick', 'Odds', 'Result', 'P/L', 'Contest', ''].map(h => (
                <th key={h} style={{ padding: '0.65rem 0.85rem', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {picks.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                <td style={{ padding: '0.55rem 0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{p.profiles?.username || p.user_id?.slice(0, 8)}</td>
                <td style={{ padding: '0.55rem 0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p.date}</td>
                <td style={{ padding: '0.55rem 0.85rem' }}>
                  <span style={{ color: '#60a5fa', background: '#0d1a2b', padding: '1px 5px', borderRadius: '3px', fontSize: '0.68rem', fontWeight: 600 }}>{p.sport}</span>
                </td>
                <td style={{ padding: '0.55rem 0.85rem', color: 'var(--text-primary)', fontWeight: 700 }}>{p.team}</td>
                <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'IBM Plex Mono, monospace', color: p.odds > 0 ? '#4ade80' : 'var(--text-primary)' }}>{p.odds > 0 ? `+${p.odds}` : p.odds}</td>
                <td style={{ padding: '0.55rem 0.85rem' }}>
                  <span style={{
                    padding: '1px 6px', borderRadius: '3px', fontSize: '0.65rem', fontWeight: 700,
                    background: p.result === 'WIN' ? 'rgba(74,222,128,0.12)' : p.result === 'LOSS' ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.06)',
                    color: p.result === 'WIN' ? '#4ade80' : p.result === 'LOSS' ? '#f87171' : 'var(--text-muted)',
                  }}>{p.result || 'PENDING'}</span>
                </td>
                <td style={{ padding: '0.55rem 0.85rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: parseFloat(p.profit) >= 0 ? '#4ade80' : '#f87171', whiteSpace: 'nowrap' }}>
                  {p.profit != null ? `${parseFloat(p.profit) >= 0 ? '+' : ''}${parseFloat(p.profit).toFixed(2)}u` : '—'}
                </td>
                <td style={{ padding: '0.55rem 0.85rem' }}>
                  {p.contest_entry ? <span style={{ color: 'var(--gold)', fontSize: '0.85rem' }}>🏆</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: '0.55rem 0.85rem' }}>
                  <button onClick={() => handleDelete(p.id)} style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(248,113,113,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: '0.68rem' }}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!picks.length && (
              <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No picks found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CONTESTS TAB ──────────────────────────────────────────────────────────────
function ContestsPanel({ userEmail }) {
  const [contests, setContests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    fetch(`/api/admin?action=contests&userEmail=${encodeURIComponent(userEmail)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setContests(d.contests || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [userEmail]);

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading contests…</div>;

  return (
    <div>
      {error && <div style={{ color: '#f87171', padding: '0.75rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '1rem' }}>⚠ {error}</div>}

      <AdminSection title="All User Contests">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {contests.map(c => (
            <div key={c.id || c.user_id} style={{ padding: '0.75rem 1rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '150px' }}>
                <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.85rem' }}>{c.name || 'Unnamed Contest'}</div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '2px' }}>
                  {c.profiles?.username || c.user_id?.slice(0, 12)} · Started {c.start_date || '—'} · Bankroll ${c.bankroll || '?'}
                </div>
              </div>
              <Badge label="ACTIVE" color="#4ade80" bg="rgba(74,222,128,0.08)" border="rgba(74,222,128,0.2)" />
            </div>
          ))}
          {!contests.length && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              No contests found — may need service role key
            </div>
          )}
        </div>
      </AdminSection>
    </div>
  );
}

// ── SYSTEM TAB ────────────────────────────────────────────────────────────────
function SystemPanel({ userEmail }) {
  const [announcement, setAnnouncement] = useState('');
  const [sending, setSending]           = useState(false);
  const [msg, setMsg]                   = useState('');

  async function sendAnnouncement() {
    if (!announcement.trim()) return;
    setSending(true);
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'broadcast', userEmail, value: announcement.trim() }),
    });
    const d = await res.json();
    setMsg(d.error ? `Error: ${d.error}` : '✓ Announcement broadcast');
    setSending(false);
    setTimeout(() => setMsg(''), 5000);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {msg && <div style={{ color: msg.startsWith('✓') ? '#4ade80' : '#f87171', padding: '0.5rem 0.75rem', background: msg.startsWith('✓') ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)', borderRadius: '6px', fontSize: '0.8rem' }}>{msg}</div>}

      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>📢 Site Announcement</div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
          Broadcast a message to all users on the platform. Stored in the settings table.
        </p>
        <textarea
          className="input"
          placeholder="e.g. New feature live: Import bet slips from DraftKings screenshots..."
          value={announcement}
          onChange={e => setAnnouncement(e.target.value)}
          rows={3}
          style={{ resize: 'vertical', marginBottom: '0.75rem' }}
        />
        <button className="btn-gold" onClick={sendAnnouncement} disabled={sending || !announcement.trim()}>
          {sending ? 'Sending…' : 'Broadcast Announcement'}
        </button>
      </div>

      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>🔧 System Info</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
          {[
            { label: 'Admin Email', value: ADMIN_EMAIL },
            { label: 'Environment', value: process.env.NODE_ENV || 'production' },
            { label: 'Service Role', value: process.env.SUPABASE_SERVICE_ROLE_KEY ? '✓ Configured' : '✗ Missing (limited access)' },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: '0.65rem 0.85rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>{label}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', fontFamily: 'IBM Plex Mono, monospace' }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.15)', borderRadius: '7px', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--gold)' }}>ℹ To unlock full admin access</strong> — add <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: '3px' }}>SUPABASE_SERVICE_ROLE_KEY</code> to your <code>.env.local</code> file. This grants the admin panel access to all rows regardless of RLS policies.
        </div>
      </div>
    </div>
  );
}

// ── MAIN ADMIN TAB ────────────────────────────────────────────────────────────
const ADMIN_TABS = [
  { id: 'overview',  label: '📊 Overview',     desc: 'Site-wide stats and recent activity' },
  { id: 'users',     label: '👥 Users',         desc: 'Manage user accounts, roles & bans' },
  { id: 'picks',     label: '📋 Picks Audit',   desc: 'View and moderate all picks' },
  { id: 'contests',  label: '🏆 Contests',      desc: 'Active contests and participants' },
  { id: 'system',    label: '⚙️ System',         desc: 'Announcements and system settings' },
];

export default function AdminTab({ user }) {
  const [active, setActive] = useState('overview');

  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🚫</div>
        <div style={{ fontWeight: 700, color: 'var(--text-secondary)', fontSize: '1.1rem', marginBottom: '8px' }}>Access Denied</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>This panel is restricted to admins only.</div>
      </div>
    );
  }

  const desc = ADMIN_TABS.find(t => t.id === active)?.desc;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: '1.4rem', color: 'var(--gold)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            🛡 Admin Panel
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '3px 0 0' }}>
            Signed in as <strong style={{ color: 'var(--text-secondary)' }}>{user?.email}</strong>
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Badge label="ADMIN" color="#fbbf24" bg="rgba(251,191,36,0.1)" border="rgba(251,191,36,0.2)" />
        </div>
      </div>

      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {ADMIN_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            style={{
              padding: '0.55rem 1rem', borderRadius: '8px', cursor: 'pointer', fontSize: '0.82rem',
              border: `1px solid ${active === t.id ? 'rgba(255,184,0,0.6)' : 'var(--border)'}`,
              background: active === t.id ? 'rgba(255,184,0,0.08)' : 'transparent',
              color: active === t.id ? 'var(--gold)' : 'var(--text-muted)',
              fontWeight: active === t.id ? 700 : 400,
              transition: 'all 0.12s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: '-0.5rem 0 0' }}>{desc}</p>

      {/* Panel content */}
      {active === 'overview' && <OverviewPanel  userEmail={user.email} />}
      {active === 'users'    && <UsersPanel     userEmail={user.email} />}
      {active === 'picks'    && <PicksAuditPanel userEmail={user.email} />}
      {active === 'contests' && <ContestsPanel  userEmail={user.email} />}
      {active === 'system'   && <SystemPanel    userEmail={user.email} />}
    </div>
  );
}
