'use client';
import { useState, useEffect, useCallback } from 'react';
import BacktestPanel from './admin/BacktestPanel';

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

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
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>joined {u.created_at ? new Date(u.created_at).toLocaleDateString() : '?'}</div>
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

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail]     = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [creating, setCreating]     = useState(false);
  const [createMsg, setCreateMsg]   = useState('');

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

  async function handleCreateUser(e) {
    e.preventDefault();
    setCreating(true); setCreateMsg('');
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_user', userEmail, newEmail, newPassword, newUsername }),
    });
    const d = await res.json();
    setCreating(false);
    if (d.error) { setCreateMsg(`Error: ${d.error}`); return; }
    setCreateMsg(`✓ Account created for ${newEmail}`);
    setNewEmail(''); setNewPassword(''); setNewUsername('');
    setShowCreate(false);
    load();
    setTimeout(() => setCreateMsg(''), 5000);
  }

  const [statusFilter, setStatusFilter] = useState('all'); // all | active | banned
  const [sortBy, setSortBy]             = useState('joined'); // joined | picks | roi | active

  const users = (data?.users || [])
    .filter(u => {
      const q = search.toLowerCase();
      const matchesSearch = !search ||
        (u.username || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.display_name || '').toLowerCase().includes(q);
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'banned' ? u.is_banned : !u.is_banned);
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      if (sortBy === 'picks')  return (b.pick_count || 0) - (a.pick_count || 0);
      if (sortBy === 'roi')    return (b.roi ?? -999) - (a.roi ?? -999);
      if (sortBy === 'active') return (b.last_pick || '0').localeCompare(a.last_pick || '0');
      return new Date(b.created_at) - new Date(a.created_at); // joined
    });

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading users…</div>;

  return (
    <div>
      {error && <div style={{ color: '#f87171', padding: '0.75rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '1rem' }}>⚠ {error}</div>}
      {actionMsg && <div style={{ color: '#4ade80', padding: '0.5rem 0.75rem', background: 'rgba(74,222,128,0.05)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>{actionMsg}</div>}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '200px' }}
        />
        {/* Status filter */}
        <div style={{ display: 'flex', gap: '3px' }}>
          {[['all','All'],['active','Active'],['banned','Banned']].map(([v,l]) => (
            <button key={v} onClick={() => setStatusFilter(v)} style={{
              padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
              border: `1px solid ${statusFilter === v ? '#FFB800' : '#222'}`,
              background: statusFilter === v ? '#1a1200' : 'transparent',
              color: statusFilter === v ? '#FFB800' : '#666', fontWeight: statusFilter === v ? 700 : 400,
            }}>{l}</button>
          ))}
        </div>
        {/* Sort */}
        <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ width: '140px', fontSize: '0.75rem', padding: '4px 8px' }}>
          <option value="joined">Sort: Newest</option>
          <option value="picks">Sort: Most Picks</option>
          <option value="roi">Sort: Best ROI</option>
          <option value="active">Sort: Last Active</option>
        </select>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', flex: 1 }}>{users.length} users</span>
        <button
          onClick={() => { setShowCreate(v => !v); setCreateMsg(''); }}
          style={{
            padding: '6px 14px', borderRadius: '7px', cursor: 'pointer',
            background: showCreate ? 'rgba(255,184,0,0.1)' : 'linear-gradient(135deg, #FFB800, #FF9500)',
            color: showCreate ? '#FFB800' : '#000',
            fontSize: '0.78rem', fontWeight: 700, fontFamily: 'inherit',
            border: showCreate ? '1px solid rgba(255,184,0,0.3)' : 'none',
          }}
        >
          {showCreate ? '✕ Cancel' : '+ Create User'}
        </button>
      </div>

      {/* Create User Form */}
      {showCreate && (
        <form onSubmit={handleCreateUser} style={{
          background: 'var(--bg-elevated)', border: '1px solid rgba(255,184,0,0.2)',
          borderRadius: '10px', padding: '1rem', marginBottom: '1rem',
          display: 'flex', flexDirection: 'column', gap: '0.75rem',
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#FFB800', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>
            Manually add a user account
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px' }}>
              <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>Email *</label>
              <input
                className="input" type="email" placeholder="friend@example.com" required
                value={newEmail} onChange={e => setNewEmail(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>Username</label>
              <input
                className="input" type="text" placeholder="SharpBettor"
                value={newUsername} onChange={e => setNewUsername(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label style={{ display: 'block', fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>Password *</label>
              <input
                className="input" type="password" placeholder="min 6 chars" required minLength={6}
                value={newPassword} onChange={e => setNewPassword(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </div>
          </div>
          {createMsg && (
            <div style={{
              padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.78rem',
              background: createMsg.startsWith('Error') ? 'rgba(248,113,113,0.07)' : 'rgba(74,222,128,0.07)',
              color: createMsg.startsWith('Error') ? '#f87171' : '#4ade80',
              border: `1px solid ${createMsg.startsWith('Error') ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}`,
            }}>
              {createMsg}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="submit" disabled={creating}
              style={{
                padding: '6px 18px', borderRadius: '7px', border: 'none', cursor: creating ? 'wait' : 'pointer',
                background: creating ? '#333' : 'linear-gradient(135deg, #FFB800, #FF9500)',
                color: creating ? '#666' : '#000', fontSize: '0.8rem', fontWeight: 800, fontFamily: 'inherit',
              }}
            >{creating ? 'Creating…' : 'Create Account'}</button>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
              They can log in immediately with these credentials.
            </div>
          </div>
        </form>
      )}

      {createMsg && !showCreate && (
        <div style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', fontSize: '0.78rem', background: 'rgba(74,222,128,0.07)', color: '#4ade80', border: '1px solid rgba(74,222,128,0.2)', marginBottom: '0.75rem' }}>
          {createMsg}
        </div>
      )}

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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 700 }}>{u.username || 'Unknown'}</span>
                {u.role === 'admin' && <Badge label="ADMIN" color="#fbbf24" bg="rgba(251,191,36,0.1)" border="rgba(251,191,36,0.2)" />}
                {u.is_banned && <Badge label="BANNED" color="#f87171" bg="rgba(248,113,113,0.1)" border="rgba(248,113,113,0.2)" />}
              </div>
              {u.email && <div style={{ color: 'var(--text-muted)', fontSize: '0.67rem', marginBottom: '3px' }}>{u.email}</div>}
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                {u.pick_count > 0 ? (
                  <>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.68rem', fontFamily: 'IBM Plex Mono, monospace' }}>
                      <span style={{ color: '#4ade80' }}>{u.wins}W</span>-<span style={{ color: '#f87171' }}>{u.losses}L</span>{u.pushes > 0 ? <span style={{ color: '#94a3b8' }}>-{u.pushes}P</span> : ''}
                    </span>
                    {u.roi !== null && (
                      <span style={{ color: u.roi >= 0 ? '#4ade80' : '#f87171', fontSize: '0.68rem', fontFamily: 'IBM Plex Mono, monospace' }}>
                        {u.roi >= 0 ? '+' : ''}{u.roi}% ROI
                      </span>
                    )}
                    {u.units !== null && (
                      <span style={{ color: u.units >= 0 ? '#4ade80' : '#f87171', fontSize: '0.68rem', fontFamily: 'IBM Plex Mono, monospace' }}>
                        {u.units >= 0 ? '+' : ''}{u.units}u
                      </span>
                    )}
                    {u.top_sport && <span style={{ color: '#94a3b8', fontSize: '0.65rem' }}>📌 {u.top_sport}</span>}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>No picks yet</span>
                )}
                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                  {u.last_pick ? `active ${new Date(u.last_pick).toLocaleDateString()}` : `joined ${u.created_at ? new Date(u.created_at).toLocaleDateString() : '?'}`}
                </span>
              </div>
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
  const [picks, setPicks]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [filter, setFilter]   = useState('all'); // all | approved | flagged | pending

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/contest-audit?action=log&userEmail=${encodeURIComponent(userEmail)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setPicks(d.picks || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [userEmail]);

  useEffect(() => { load(); }, [load]);

  async function handleOverride(pickId, status) {
    const reason = status === 'REJECTED' ? prompt('Rejection reason:') : 'Admin approved';
    if (status === 'REJECTED' && !reason) return;
    setActionMsg('Processing…');
    const res = await fetch('/api/contest-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'override', pickId, userEmail, overrideStatus: status, overrideReason: reason }),
    });
    const d = await res.json();
    if (d.error) { setActionMsg(`Error: ${d.error}`); } else { setActionMsg(`✓ Pick ${status.toLowerCase()}`); load(); }
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleBatchAudit() {
    setActionMsg('Running batch audit…');
    const res = await fetch('/api/contest-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch-audit' }),
    });
    const d = await res.json();
    setActionMsg(`✓ Audited ${d.audited || 0} picks`);
    load();
    setTimeout(() => setActionMsg(''), 4000);
  }

  const filtered = picks.filter(p =>
    filter === 'all' || (filter === 'pending' ? !p.audit_status || p.audit_status === 'PENDING' : p.audit_status === filter.toUpperCase())
  );

  const statusColor = (s) => s === 'APPROVED' ? '#4ade80' : s === 'FLAGGED' ? '#fbbf24' : s === 'REJECTED' ? '#f87171' : '#888';
  const statusBg = (s) => s === 'APPROVED' ? 'rgba(74,222,128,0.08)' : s === 'FLAGGED' ? 'rgba(251,191,36,0.08)' : s === 'REJECTED' ? 'rgba(248,113,113,0.08)' : 'rgba(136,136,136,0.08)';

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading contest audit…</div>;

  return (
    <div>
      {error && <div style={{ color: '#f87171', padding: '0.75rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '1rem' }}>⚠ {error}</div>}
      {actionMsg && <div style={{ color: '#4ade80', padding: '0.5rem 0.75rem', background: 'rgba(74,222,128,0.05)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>{actionMsg}</div>}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {[['all','All'],['approved','Approved'],['flagged','Flagged'],['pending','Pending']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
            border: `1px solid ${filter === v ? '#FFB800' : '#222'}`,
            background: filter === v ? '#1a1200' : 'transparent',
            color: filter === v ? '#FFB800' : '#666', fontWeight: filter === v ? 700 : 400,
          }}>{l}</button>
        ))}
        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', flex: 1 }}>{filtered.length} contest picks</span>
        <button onClick={handleBatchAudit} style={{
          padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
          border: '1px solid rgba(255,184,0,0.3)', background: 'rgba(255,184,0,0.08)', color: '#FFB800',
        }}>🎯 Run AI Audit on Pending</button>
        <button onClick={load} style={{ padding: '4px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', border: '1px solid #222', background: 'transparent', color: '#666' }}>↻</button>
      </div>

      {/* Contest Rules Summary */}
      <div style={{ padding: '0.6rem 0.85rem', background: '#0a0800', border: '1px solid rgba(255,184,0,0.15)', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.72rem', color: '#888', lineHeight: 1.7 }}>
        <span style={{ color: '#FFB800', fontWeight: 700 }}>OFFICIAL RULES:</span> 1 play/day · Min odds -145 · Straight bets only · Locked once posted (no edit/delete) · Reschedules ≠ void · AI audited · Admin can override
      </div>

      {/* Pick rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {filtered.map(p => (
          <div key={p.id} style={{
            padding: '0.65rem 0.85rem', background: 'var(--bg-elevated)',
            border: `1px solid ${p.audit_status === 'FLAGGED' ? 'rgba(251,191,36,0.25)' : p.audit_status === 'REJECTED' ? 'rgba(248,113,113,0.25)' : 'var(--border)'}`,
            borderRadius: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: '180px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 700 }}>{p.team}</span>
                  <span style={{ color: '#60a5fa', background: '#0d1a2b', padding: '1px 5px', borderRadius: '3px', fontSize: '0.65rem', fontWeight: 600 }}>{p.sport}</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', fontWeight: 700, color: p.odds > 0 ? '#4ade80' : '#f0f0f0' }}>{p.odds > 0 ? '+' : ''}{p.odds}</span>
                  <Badge label={p.audit_status || 'PENDING'} color={statusColor(p.audit_status)} bg={statusBg(p.audit_status)} border={`${statusColor(p.audit_status)}33`} />
                  {p.audit_override && <Badge label="OVERRIDE" color="#ff6b9d" bg="rgba(255,107,157,0.08)" border="rgba(255,107,157,0.2)" />}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '3px' }}>
                  {p.username} · {p.date} · {p.bet_type} · {p.units || 1}u
                  {p.audit_reason ? <span style={{ marginLeft: '6px', color: '#888' }}>— {p.audit_reason}</span> : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                {p.result && (
                  <span style={{ padding: '3px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: 700, background: p.result === 'WIN' ? 'rgba(74,222,128,0.12)' : p.result === 'LOSS' ? 'rgba(248,113,113,0.12)' : 'rgba(148,163,184,0.12)', color: p.result === 'WIN' ? '#4ade80' : p.result === 'LOSS' ? '#f87171' : '#94a3b8' }}>{p.result}</span>
                )}
                <button onClick={() => handleOverride(p.id, 'APPROVED')} style={{ padding: '3px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', border: 'none', background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>✓</button>
                <button onClick={() => handleOverride(p.id, 'REJECTED')} style={{ padding: '3px 8px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', border: 'none', background: 'rgba(248,113,113,0.12)', color: '#f87171' }}>✕</button>
              </div>
            </div>
          </div>
        ))}
        {!filtered.length && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            No contest picks {filter !== 'all' ? `with status "${filter}"` : 'yet'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ACTIVITY TAB ─────────────────────────────────────────────────────────────
function ActivityPanel({ userEmail }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [search,  setSearch]  = useState('');
  const [sortBy,  setSortBy]  = useState('signin'); // signin | activity | created

  useEffect(() => {
    fetch(`/api/admin?action=activity&userEmail=${encodeURIComponent(userEmail)}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [userEmail]);

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins < 1)    return 'Just now';
    if (mins < 60)   return `${mins}m ago`;
    if (hours < 24)  return `${hours}h ago`;
    if (days < 7)    return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  }

  function fmtFull(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading activity…</div>;
  if (error)   return <div style={{ color: '#f87171', padding: '1rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)' }}>⚠ {error}</div>;

  const rows = (data?.activity || [])
    .filter(u => {
      const q = search.toLowerCase();
      return !search || (u.email || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sortBy === 'activity') {
        const aLast = a.last_pick || a.last_sign_in_at || '';
        const bLast = b.last_pick || b.last_sign_in_at || '';
        return bLast.localeCompare(aLast);
      }
      if (sortBy === 'created') return new Date(b.created_at) - new Date(a.created_at);
      // default: last sign-in
      if (!a.last_sign_in_at && !b.last_sign_in_at) return 0;
      if (!a.last_sign_in_at) return 1;
      if (!b.last_sign_in_at) return -1;
      return new Date(b.last_sign_in_at) - new Date(a.last_sign_in_at);
    });

  const hasIPs = rows.some(r => r.ip_address);

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="Search user or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '200px' }}
        />
        <select className="input" value={sortBy} onChange={e => setSortBy(e.target.value)}
          style={{ width: '160px', fontSize: '0.75rem', padding: '4px 8px' }}>
          <option value="signin">Sort: Last Sign-In</option>
          <option value="activity">Sort: Last Activity</option>
          <option value="created">Sort: Newest Account</option>
        </select>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', flex: 1 }}>{rows.length} users</span>
      </div>

      {!hasIPs && (
        <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.12)', borderRadius: '7px', marginBottom: '1rem', fontSize: '0.72rem', color: '#888' }}>
          <span style={{ color: '#FFB800', fontWeight: 700 }}>ℹ IP addresses</span> — requires Supabase service role key with audit log access. IPs will appear here once configured.
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['User', 'Email', 'Last Sign-In', 'Last Activity', 'Joined', hasIPs ? 'IP Address' : null, 'Status']
                .filter(Boolean)
                .map(h => (
                  <th key={h} style={{ padding: '0.65rem 0.85rem', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))
              }
            </tr>
          </thead>
          <tbody>
            {rows.map((u, i) => {
              const lastActivity = u.last_pick || u.last_sign_in_at;
              const isOnline = u.last_sign_in_at && (Date.now() - new Date(u.last_sign_in_at)) < 15 * 60 * 1000; // within 15 min
              return (
                <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  {/* User */}
                  <td style={{ padding: '0.6rem 0.85rem', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                      <div style={{ position: 'relative' }}>
                        <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--bg-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                          {(u.username || u.email || '?')[0].toUpperCase()}
                        </div>
                        {isOnline && (
                          <div style={{ position: 'absolute', bottom: 0, right: 0, width: '7px', height: '7px', borderRadius: '50%', background: '#4ade80', border: '1.5px solid var(--bg-elevated)' }} />
                        )}
                      </div>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{u.username || '—'}</span>
                    </div>
                  </td>
                  {/* Email */}
                  <td style={{ padding: '0.6rem 0.85rem', color: 'var(--text-muted)', fontSize: '0.72rem' }}>{u.email || '—'}</td>
                  {/* Last Sign-In */}
                  <td style={{ padding: '0.6rem 0.85rem', whiteSpace: 'nowrap' }}>
                    <span
                      title={fmtFull(u.last_sign_in_at)}
                      style={{ color: u.last_sign_in_at ? 'var(--text-secondary)' : 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem' }}
                    >
                      {fmtDate(u.last_sign_in_at)}
                    </span>
                  </td>
                  {/* Last Activity (most recent pick or sign-in) */}
                  <td style={{ padding: '0.6rem 0.85rem', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      <span
                        title={fmtFull(lastActivity)}
                        style={{ color: lastActivity ? 'var(--text-secondary)' : 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem' }}
                      >
                        {fmtDate(lastActivity)}
                      </span>
                      {u.last_pick && (
                        <span style={{ color: '#60a5fa', fontSize: '0.6rem' }}>📋 pick</span>
                      )}
                    </div>
                  </td>
                  {/* Joined */}
                  <td style={{ padding: '0.6rem 0.85rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                  </td>
                  {/* IP (conditional column) */}
                  {hasIPs && (
                    <td style={{ padding: '0.6rem 0.85rem', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.68rem', color: u.ip_address ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                      {u.ip_address || '—'}
                    </td>
                  )}
                  {/* Status */}
                  <td style={{ padding: '0.6rem 0.85rem' }}>
                    {u.is_banned
                      ? <Badge label="BANNED"  color="#f87171" bg="rgba(248,113,113,0.1)" border="rgba(248,113,113,0.2)" />
                      : isOnline
                        ? <Badge label="ONLINE"  color="#4ade80" bg="rgba(74,222,128,0.1)"  border="rgba(74,222,128,0.2)"  />
                        : <Badge label="OFFLINE" color="#555"    bg="rgba(85,85,85,0.1)"    border="rgba(85,85,85,0.2)"    />
                    }
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={hasIPs ? 7 : 6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No user data — ensure Supabase service role key is configured</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CRON JOBS TAB ─────────────────────────────────────────────────────────────
const CRON_DEFS = [
  {
    key:      'grade_picks',
    label:    '🏆 Grade Picks',
    desc:     'Grades pending picks for all users by checking final ESPN scores.',
    schedule: 'Every 5 min, 12 PM–4 AM ET',
    path:     '/api/cron/grade-picks',
    lastRunKey: 'cron_grade_last_run',
  },
  {
    key:      'pregenerate',
    label:    '🤖 Pre-Generate Analyses',
    desc:     'Runs Grok-4 analysis on today\'s games and caches results so the Analyzer loads instantly.',
    schedule: '8 AM & 4 PM ET daily',
    path:     '/api/cron/pregenerate-analysis',
    lastRunKey: 'cron_pregenerate_last_run',
  },
  {
    key:      'trends',
    label:    '📈 Daily Trends',
    desc:     'Generates today\'s sharp betting edges using Grok-4 with live web search.',
    schedule: '5 AM & 1 PM ET daily',
    path:     '/api/cron/trends',
    lastRunKey: 'cron_trends_last_run',
  },
];

function ToggleSwitch({ checked, onChange, disabled }) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: '42px', height: '22px', borderRadius: '11px', position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer',
        background: checked ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.15)',
        border: `1px solid ${checked ? 'rgba(74,222,128,0.5)' : 'rgba(248,113,113,0.3)'}`,
        transition: 'all 0.18s', flexShrink: 0, opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        width: '16px', height: '16px', borderRadius: '50%',
        background: checked ? '#4ade80' : '#f87171',
        position: 'absolute', top: '2px',
        left: checked ? '22px' : '2px',
        transition: 'left 0.18s, background 0.18s',
        boxShadow: `0 0 6px ${checked ? 'rgba(74,222,128,0.5)' : 'rgba(248,113,113,0.4)'}`,
      }} />
    </div>
  );
}

function timeAgo(isoStr) {
  if (!isoStr) return 'Never';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'Just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function CronPanel({ userEmail }) {
  const [settings, setSettings] = useState({});
  const [loading, setLoading]   = useState(true);
  const [running, setRunning]   = useState({});
  const [runResults, setRunResults] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/admin?action=cron_settings&userEmail=${encodeURIComponent(userEmail)}`);
    const d = await res.json();
    if (!d.error && d.settings) {
      // Flatten { key: { value, updated_at } } → { key: value }
      const flat = {};
      Object.entries(d.settings).forEach(([k, v]) => { flat[k] = v?.value ?? v; });
      setSettings(flat);
    }
    setLoading(false);
  }, [userEmail]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(key, newVal) {
    await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cron_toggle', userEmail, jobKey: key, enabled: newVal }),
    });
    setSettings(s => ({ ...s, [`cron_${key}_enabled`]: String(newVal) }));
  }

  async function handleRun(key, path) {
    setRunning(r => ({ ...r, [key]: true }));
    setRunResults(r => ({ ...r, [key]: null }));
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cron_run', userEmail, jobPath: path }),
    });
    const d = await res.json();
    setRunning(r => ({ ...r, [key]: false }));
    // Unwrap: d = { ok, status, result } or { ok: false, error }
    setRunResults(r => ({ ...r, [key]: d.ok === false ? d : (d.result || d) }));
    load(); // refresh last-run stats
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading cron status…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.5rem 0.75rem', background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.12)', borderRadius: '8px' }}>
        ℹ Toggling pauses the job without redeploying. "Run Now" triggers it immediately regardless of schedule.
      </div>

      {CRON_DEFS.map(job => {
        const enabledVal = settings[`cron_${job.key}_enabled`];
        const enabled    = enabledVal !== 'false'; // default on if never set
        const lastRunRaw = settings[job.lastRunKey];
        const lastRun    = lastRunRaw ? (() => { try { return JSON.parse(lastRunRaw); } catch { return null; } })() : null;
        const isRunning  = !!running[job.key];
        const result     = runResults[job.key];

        return (
          <div key={job.key} style={{
            background: 'var(--bg-elevated)', border: `1px solid ${enabled ? 'var(--border)' : 'rgba(248,113,113,0.2)'}`,
            borderRadius: '10px', padding: '1rem 1.1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '0.6rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.88rem' }}>{job.label}</span>
                  <span style={{
                    fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: '4px',
                    background: enabled ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
                    color: enabled ? '#4ade80' : '#f87171',
                    border: `1px solid ${enabled ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'}`,
                  }}>{enabled ? 'ENABLED' : 'PAUSED'}</span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '2px' }}>{job.desc}</div>
              </div>
              <ToggleSwitch checked={enabled} onChange={val => handleToggle(job.key, val)} disabled={isRunning} />
            </div>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginBottom: '0.7rem' }}>
              <div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1px' }}>Schedule</div>
                <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace' }}>🕐 {job.schedule}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1px' }}>Last Run</div>
                <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace' }}>
                  {lastRun ? timeAgo(lastRun.last_run_at || lastRun.run_at || lastRun.generated_at) : '—'}
                </div>
              </div>
              {lastRun && (
                <div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1px' }}>Result</div>
                  <div style={{ fontSize: '0.73rem', fontFamily: 'IBM Plex Mono, monospace' }}>
                    {lastRun.graded   != null && <span style={{ color: '#4ade80' }}>✓ {lastRun.graded} graded</span>}
                    {lastRun.edges    != null && <span style={{ color: '#4ade80' }}>✓ {lastRun.edges} edges</span>}
                    {lastRun.generated != null && <span style={{ color: '#4ade80' }}>✓ {lastRun.generated} games</span>}
                    {lastRun.errors   != null && lastRun.errors > 0 && <span style={{ color: '#f87171', marginLeft: '8px' }}>⚠ {lastRun.errors} errors</span>}
                    {lastRun.error    && <span style={{ color: '#f87171' }}>✗ {String(lastRun.error).slice(0, 60)}</span>}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => handleRun(job.key, job.path)}
                disabled={isRunning}
                style={{
                  padding: '5px 14px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, cursor: isRunning ? 'wait' : 'pointer',
                  border: 'none', fontFamily: 'inherit',
                  background: isRunning ? '#222' : 'linear-gradient(135deg, #FFB800, #FF9500)',
                  color: isRunning ? '#555' : '#000',
                }}
              >
                {isRunning ? '⏳ Running…' : '▶ Run Now'}
              </button>
              {result && (
                <span style={{
                  fontSize: '0.7rem', fontFamily: 'IBM Plex Mono, monospace',
                  color: result.error ? '#f87171' : '#4ade80',
                  background: result.error ? 'rgba(248,113,113,0.07)' : 'rgba(74,222,128,0.07)',
                  padding: '3px 8px', borderRadius: '5px',
                  border: `1px solid ${result.error ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}`,
                }}>
                  {result.error
                    ? `✗ ${String(result.error).slice(0, 80)}`
                    : result.graded   != null ? `✓ ${result.graded} picks graded in ${result.duration_ms}ms`
                    : result.edges    != null ? `✓ ${result.edges} edges generated in ${result.duration_ms}ms`
                    : result.generated != null ? `✓ ${result.generated} analyses in ${result.duration_ms}ms`
                    : '✓ Done'}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── SYSTEM TAB ────────────────────────────────────────────────────────────────
function SystemPanel({ userEmail }) {
  const [announcement, setAnnouncement] = useState('');
  const [sending, setSending]           = useState(false);
  const [clearing, setClearing]         = useState(false);
  const [msg, setMsg]                   = useState('');
  const [sysInfo, setSysInfo]           = useState(null);
  const [batchRunning,   setBatchRunning]   = useState(false);
  const [batchResult,    setBatchResult]    = useState(null);
  const [pregenRunning,    setPregenRunning]    = useState(false);
  const [pregenResult,     setPregenResult]     = useState(null);
  const [pregenLog,        setPregenLog]        = useState(null);
  const [pregenLiveLog,    setPregenLiveLog]    = useState([]); // [{sport, status, count}]
  const [generatedAnalyses,setGeneratedAnalyses]= useState(null); // fetched from game_analyses
  const [analysesDate,     setAnalysesDate]     = useState(new Date().toISOString().split('T')[0]);
  const [expandedAnalysis, setExpandedAnalysis] = useState(null); // id of expanded row

  async function runBatchAnalysis() {
    setBatchRunning(true);
    setBatchResult(null);
    try {
      const res  = await fetch('/api/auto-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'batch-all' }),
      });
      const data = await res.json();
      setBatchResult(data);
    } catch (e) {
      setBatchResult({ error: e.message });
    }
    setBatchRunning(false);
  }

  function loadPregenLog() {
    fetch('/api/settings?key=cron_pregenerate_last_run')
      .then(r => r.json())
      .then(d => {
        if (d.value) {
          try { setPregenLog(typeof d.value === 'string' ? JSON.parse(d.value) : d.value); }
          catch { /* ignore */ }
        }
      })
      .catch(() => {});
  }

  function loadGeneratedAnalyses(date) {
    const d = date || analysesDate;
    fetch(`/api/admin?action=game_analyses&userEmail=${encodeURIComponent(userEmail)}&date=${d}`)
      .then(r => r.json())
      .then(data => setGeneratedAnalyses(data.analyses || []))
      .catch(() => setGeneratedAnalyses([]));
  }

  // Fire-and-forget: sends ONE request for all sports. The server processes
  // them sequentially and writes progress to the settings table. We poll that
  // table so the UI stays alive even if the user switches tabs or refreshes.
  async function runPregenAnalysis() {
    setPregenRunning(true);
    setPregenResult(null);
    setPregenLiveLog([]);

    // Fire the request — don't await it (it can take 2-5 min on Vercel)
    fetch('/api/cron/pregenerate-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userEmail, force: true }),
    }).then(async res => {
      // When the full request completes, show the final result
      try {
        const data = await res.json();
        setPregenResult(data);
      } catch { /* polling will catch completion */ }
      setPregenRunning(false);
      loadPregenLog();
      loadGeneratedAnalyses();
    }).catch(() => {
      // Request may fail if user navigated away — that's fine,
      // the server-side function continues and polling will catch it
    });

    // Start polling progress from Supabase settings table
    startPregenPolling();
  }

  function startPregenPolling() {
    const pollId = setInterval(async () => {
      try {
        const res = await fetch('/api/settings?key=pregenerate_progress');
        const d = await res.json();
        if (!d.value) return;
        const progress = typeof d.value === 'string' ? JSON.parse(d.value) : d.value;

        // Update live log from server progress
        if (progress.current_sport && progress.status === 'running') {
          setPregenLiveLog(prev => {
            const existing = prev.find(e => e.sport === progress.current_sport);
            if (!existing) {
              return [...prev, { sport: progress.current_sport, status: 'running', count: null, ts: Date.now() }];
            }
            return prev;
          });
        }

        // If done, stop polling and refresh data
        if (progress.status === 'done') {
          clearInterval(pollId);
          setPregenRunning(false);
          loadPregenLog();
          loadGeneratedAnalyses();
        }
      } catch { /* ignore poll errors */ }
    }, 4000); // poll every 4 seconds

    // Safety: stop polling after 6 minutes no matter what
    setTimeout(() => {
      clearInterval(pollId);
      setPregenRunning(false);
    }, 360000);

    // Store the interval ID so we can clean up on unmount
    return pollId;
  }

  // On mount: check if a pregenerate job is already running (e.g. started
  // before a tab switch). If so, resume the polling UI.
  useEffect(() => {
    let pollId;
    async function checkRunning() {
      try {
        const res = await fetch('/api/settings?key=pregenerate_progress');
        const d = await res.json();
        if (!d.value) return;
        const progress = typeof d.value === 'string' ? JSON.parse(d.value) : d.value;
        // If it was started less than 5 min ago and not done, resume polling
        const age = Date.now() - new Date(progress.started_at).getTime();
        if (progress.status === 'running' && age < 300000) {
          setPregenRunning(true);
          pollId = startPregenPolling();
        }
      } catch { /* ignore */ }
    }
    checkRunning();
    return () => { if (pollId) clearInterval(pollId); };
  }, []); // eslint-disable-line

  function loadSysInfo() {
    fetch(`/api/admin?action=system&userEmail=${encodeURIComponent(userEmail)}`)
      .then(r => r.json())
      .then(d => setSysInfo(d))
      .catch(() => {});
  }

  useEffect(() => { loadSysInfo(); loadPregenLog(); loadGeneratedAnalyses(); }, [userEmail]); // eslint-disable-line

  async function sendAnnouncement() {
    if (!announcement.trim()) return;
    setSending(true);
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'broadcast', userEmail, value: announcement.trim() }),
    });
    const d = await res.json();
    if (!d.error) {
      setAnnouncement('');
      loadSysInfo(); // refresh to show new active announcement
    }
    setMsg(d.error ? `Error: ${d.error}` : '✓ Announcement broadcast');
    setSending(false);
    setTimeout(() => setMsg(''), 5000);
  }

  async function clearAnnouncement() {
    if (!window.confirm('Clear the active announcement? It will be removed for all users.')) return;
    setClearing(true);
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'broadcast', userEmail, value: '' }),
    });
    const d = await res.json();
    if (!d.error) loadSysInfo();
    setMsg(d.error ? `Error: ${d.error}` : '✓ Announcement cleared');
    setClearing(false);
    setTimeout(() => setMsg(''), 5000);
  }

  const activeMsg = sysInfo?.currentAnnouncement || '';
  const updatedAt = sysInfo?.announcementUpdatedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {msg && <div style={{ color: msg.startsWith('✓') ? '#4ade80' : '#f87171', padding: '0.5rem 0.75rem', background: msg.startsWith('✓') ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)', borderRadius: '6px', fontSize: '0.8rem' }}>{msg}</div>}

      {/* ── Analyzer Pre-Generation ── */}
      <div className="card" style={{ padding: '1.2rem', borderColor: pregenRunning ? 'rgba(96,165,250,0.3)' : 'var(--border)' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          ⚡ Pre-Generate Analyses
          <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80', letterSpacing: '0.07em' }}>AUTO 8AM + 4PM ET</span>
          {pregenRunning && <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', color: '#60a5fa', letterSpacing: '0.07em', animation: 'pulse 1.5s infinite' }}>● RUNNING</span>}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.85rem', lineHeight: 1.5 }}>
          Generates a full BetOS AI analysis for every pre-game matchup and caches it in Supabase. Users get instant results instead of waiting 60–90s.
        </p>

        {/* Last run summary */}
        {pregenLog && !pregenRunning && (
          <div style={{ marginBottom: '0.75rem', padding: '0.55rem 0.85rem', background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.12)', borderRadius: '7px', fontSize: '0.72rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#60a5fa' }}>⏱ Last: <strong>{new Date(pregenLog.run_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong></span>
            <span style={{ color: '#4ade80' }}>✅ {pregenLog.generated} generated</span>
            <span style={{ color: 'var(--text-muted)' }}>⏭ {pregenLog.skipped} skipped</span>
            {pregenLog.errors > 0 && <span style={{ color: '#f87171' }}>⚠ {pregenLog.errors} errors</span>}
            <span style={{ color: 'var(--text-muted)' }}>⏳ {Math.round((pregenLog.duration_ms || 0) / 1000)}s</span>
          </div>
        )}

        {/* Live sport-by-sport progress during run */}
        {pregenLiveLog.length > 0 && (
          <div style={{ marginBottom: '0.85rem', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '0.7rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '5px' }}>
            {pregenLiveLog.map(({ sport, status, count, skipped: sk, games, error }) => (
              <div key={sport} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem' }}>
                <span style={{ width: '44px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: '#888', fontSize: '0.65rem' }}>{sport.toUpperCase()}</span>
                {status === 'running' && <span style={{ color: '#60a5fa' }}>⟳ Processing…</span>}
                {status === 'done' && count > 0 && (
                  <span style={{ color: '#4ade80' }}>✓ {count} generated{sk > 0 ? `, ${sk} skipped` : ''}{games?.length ? ` · ${games.slice(0,3).map(g => g.split('@')[0].trim().split(' ').pop()).join(', ')}${games.length > 3 ? ` +${games.length-3}` : ''}` : ''}</span>
                )}
                {status === 'skipped' && <span style={{ color: '#555' }}>— No pre-game games</span>}
                {status === 'error' && <span style={{ color: '#f87171' }}>✗ {error?.slice(0, 80)}</span>}
              </div>
            ))}
            {pregenRunning && (
              <div style={{ marginTop: '4px', fontSize: '0.65rem', color: '#444' }}>
                Sport {pregenLiveLog.length}/6 · Next sports queued…
              </div>
            )}
          </div>
        )}

        {/* Final result after run */}
        {pregenResult && !pregenRunning && (
          <div style={{
            padding: '0.65rem 0.85rem', borderRadius: '7px', marginBottom: '0.85rem', fontSize: '0.78rem',
            background: pregenResult.generated > 0 ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${pregenResult.generated > 0 ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.07)'}`,
          }}>
            <span style={{ color: '#4ade80', fontWeight: 700 }}>
              ✓ Done — {pregenResult.generated} generated · {pregenResult.skipped} skipped · {Math.round((pregenResult.duration_ms || 0) / 1000)}s
            </span>
            {pregenResult.error_list?.length > 0 && (
              <div style={{ color: '#f87171', marginTop: '5px', fontSize: '0.68rem' }}>
                ⚠ {pregenResult.error_list.slice(0, 3).join(' · ')}
              </div>
            )}
          </div>
        )}

        <button
          className="btn-gold"
          onClick={runPregenAnalysis}
          disabled={pregenRunning}
          style={{ opacity: pregenRunning ? 0.6 : 1 }}
        >
          {pregenRunning ? '⟳ Running on server… (safe to switch tabs)' : '⚡ Pre-Generate Now'}
        </button>
      </div>

      {/* ── Generated Analyses Log ── */}
      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            📋 Generated Analyses
            {generatedAnalyses && (
              <span style={{ fontSize: '0.62rem', fontWeight: 600, color: generatedAnalyses.length > 0 ? '#4ade80' : '#555', background: generatedAnalyses.length > 0 ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${generatedAnalyses.length > 0 ? 'rgba(74,222,128,0.25)' : 'var(--border)'}`, borderRadius: '4px', padding: '2px 7px' }}>
                {generatedAnalyses.length} cached
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="date"
              value={analysesDate}
              onChange={e => { setAnalysesDate(e.target.value); loadGeneratedAnalyses(e.target.value); }}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-primary)', padding: '2px 6px', fontSize: '0.68rem', cursor: 'pointer' }}
            />
            <button
              onClick={() => loadGeneratedAnalyses()}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 8px', fontSize: '0.68rem' }}
            >↻</button>
          </div>
        </div>

        {generatedAnalyses === null && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Loading…</div>
        )}
        {generatedAnalyses?.length === 0 && (
          <div style={{ color: '#444', fontSize: '0.75rem', padding: '1rem 0', textAlign: 'center' }}>
            No analyses cached for {analysesDate}. Hit Pre-Generate Now to populate.
          </div>
        )}
        {generatedAnalyses && generatedAnalyses.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {generatedAnalyses.map(a => {
              const isOpen = expandedAnalysis === a.id;
              const ageMin = Math.round((Date.now() - new Date(a.updated_at).getTime()) / 60000);
              const ageLabel = ageMin < 60 ? `${ageMin}m ago` : `${Math.round(ageMin/60)}h ago`;
              // Extract THE PICK line
              const pickMatch = a.analysis?.match(/THE PICK[:\s]+([^\n]{5,100})/i);
              const pickLine = pickMatch ? pickMatch[1].trim() : null;
              const confMatch = a.analysis?.match(/CONFIDENCE[:\s]+(ELITE|HIGH|MEDIUM|LOW)/i);
              const conf = confMatch?.[1];
              const confColor = { ELITE: '#00D48B', HIGH: '#4ade80', MEDIUM: '#FFB800', LOW: '#888' }[conf] || '#555';

              return (
                <div key={a.id} style={{ border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', overflow: 'hidden' }}>
                  <button
                    onClick={() => setExpandedAnalysis(isOpen ? null : a.id)}
                    style={{
                      width: '100%', background: isOpen ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                      border: 'none', cursor: 'pointer', padding: '8px 12px',
                      display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: '0.6rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: '#60a5fa', minWidth: '30px' }}>{a.sport.toUpperCase()}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-primary)', fontWeight: 600, flex: 1 }}>
                      {a.away_team} @ {a.home_team}
                    </span>
                    {conf && (
                      <span style={{ fontSize: '0.58rem', fontWeight: 700, color: confColor, background: `${confColor}18`, border: `1px solid ${confColor}40`, borderRadius: '4px', padding: '1px 6px', flexShrink: 0 }}>{conf}</span>
                    )}
                    <span style={{ fontSize: '0.62rem', color: '#444', flexShrink: 0 }}>{ageLabel}</span>
                    <span style={{ color: '#444', fontSize: '0.65rem', flexShrink: 0 }}>{isOpen ? '▲' : '▼'}</span>
                  </button>

                  {isOpen && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', background: 'rgba(0,0,0,0.25)' }}>
                      {pickLine && (
                        <div style={{ marginBottom: '8px', padding: '6px 10px', background: 'rgba(255,184,0,0.07)', border: '1px solid rgba(255,184,0,0.2)', borderRadius: '6px', fontSize: '0.75rem', color: '#FFB800', fontWeight: 700 }}>
                          🎯 {pickLine}
                        </div>
                      )}
                      <pre style={{ fontSize: '0.68rem', color: '#999', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: '300px', overflowY: 'auto' }}>
                        {a.analysis}
                      </pre>
                      <div style={{ marginTop: '8px', fontSize: '0.6rem', color: '#333', display: 'flex', gap: '12px' }}>
                        <span>Generated: {new Date(a.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        <span>Model: {a.model}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
          📢 Site Announcement
          {activeMsg
            ? <span style={{ fontSize: '0.65rem', fontWeight: 600, color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.25)', borderRadius: '4px', padding: '2px 7px', letterSpacing: '0.06em' }}>ACTIVE</span>
            : <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 7px', letterSpacing: '0.06em' }}>NONE</span>
          }
        </div>

        {/* Current active announcement */}
        {activeMsg ? (
          <div style={{ marginBottom: '1rem', padding: '0.85rem', background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.2)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'var(--text-primary)', fontSize: '0.82rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{activeMsg}</div>
                {updatedAt && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px', fontFamily: 'IBM Plex Mono, monospace' }}>
                    Last updated: {new Date(updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
              <button
                onClick={clearAnnouncement}
                disabled={clearing}
                title="Clear / delete this announcement"
                style={{ flexShrink: 0, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', color: '#f87171', borderRadius: '6px', padding: '0.3rem 0.7rem', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', opacity: clearing ? 0.6 : 1 }}
              >
                {clearing ? 'Clearing…' : '🗑 Clear'}
              </button>
            </div>
            <button
              onClick={() => setAnnouncement(activeMsg)}
              style={{ marginTop: '0.6rem', background: 'none', border: 'none', color: 'var(--gold)', fontSize: '0.7rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              ✏️ Edit this message
            </button>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
            No active announcement. Compose one below — it will appear as a banner for all users.
          </p>
        )}

        {/* Compose new / replacement announcement */}
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ color: 'var(--text-muted)', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', display: 'block', marginBottom: '6px' }}>
            {activeMsg ? 'Replace with new message' : 'New announcement'}
          </label>
          <textarea
            className="input"
            placeholder="e.g. New feature live: Import bet slips from DraftKings screenshots..."
            value={announcement}
            onChange={e => setAnnouncement(e.target.value)}
            rows={3}
            style={{ resize: 'vertical', marginBottom: '0.75rem' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn-gold" onClick={sendAnnouncement} disabled={sending || !announcement.trim()}>
              {sending ? 'Sending…' : activeMsg ? '📢 Replace Announcement' : '📢 Broadcast Announcement'}
            </button>
            {announcement && (
              <button
                onClick={() => setAnnouncement('')}
                style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: '6px', padding: '0.45rem 0.85rem', fontSize: '0.78rem', cursor: 'pointer' }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>🔧 System Info</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
          {[
            { label: 'Admin Email', value: ADMIN_EMAILS.join(', ') || user?.email || '—' },
            { label: 'Environment', value: sysInfo ? sysInfo.environment : '…' },
            {
              label: 'Service Role',
              value: sysInfo === null ? '…' : (sysInfo.serviceRole ? '✓ Configured' : '✗ Missing (limited access)'),
              color: sysInfo === null ? undefined : (sysInfo.serviceRole ? '#4ade80' : '#f87171'),
            },
            { label: 'Supabase URL', value: sysInfo ? sysInfo.supabaseUrl : '…' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ padding: '0.65rem 0.85rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>{label}</div>
              <div style={{ color: color || 'var(--text-secondary)', fontSize: '0.78rem', fontFamily: 'IBM Plex Mono, monospace' }}>{value}</div>
            </div>
          ))}
        </div>
        {sysInfo && !sysInfo.serviceRole && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.15)', borderRadius: '7px', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--gold)' }}>ℹ To unlock full admin access</strong> — add <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: '3px' }}>SUPABASE_SERVICE_ROLE_KEY</code> to your Vercel environment variables (for production) or <code>.env.local</code> (for local dev). This grants the admin panel access to all rows regardless of RLS policies.
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN ADMIN TAB ────────────────────────────────────────────────────────────
const ADMIN_TABS = [
  { id: 'overview',  label: '📊 Overview',     desc: 'Site-wide stats and recent activity' },
  { id: 'users',     label: '👥 Users',         desc: 'Manage user accounts, roles & bans' },
  { id: 'activity',  label: '📡 Activity',      desc: 'Last sign-on, recent activity & IP addresses' },
  { id: 'picks',     label: '📋 Picks Audit',   desc: 'View and moderate all picks' },
  { id: 'contests',  label: '🏆 Contests',      desc: 'Active contests and participants' },
  { id: 'backtest',  label: '📈 Backtester',    desc: 'Import historical data, run backtests, save sharp edges' },
  { id: 'cron',      label: '⏱ Cron Jobs',       desc: 'View scheduled jobs, toggle on/off, and trigger manually' },
  { id: 'system',    label: '⚙️ System',         desc: 'Announcements and system settings' },
];

export default function AdminTab({ user }) {
  const [active, setActive] = useState('overview');

  // If ADMIN_EMAILS env var is set, use it; otherwise fall back to true since
  // Dashboard.jsx already gates this component to the hardcoded admin email.
  const isAdmin = ADMIN_EMAILS.length > 0
    ? ADMIN_EMAILS.includes(user?.email?.toLowerCase())
    : true;

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
      {active === 'overview'  && <OverviewPanel   userEmail={user.email} />}
      {active === 'users'     && <UsersPanel      userEmail={user.email} />}
      {active === 'activity'  && <ActivityPanel   userEmail={user.email} />}
      {active === 'picks'     && <PicksAuditPanel userEmail={user.email} />}
      {active === 'contests'  && <ContestsPanel   userEmail={user.email} />}
      {active === 'backtest'  && <BacktestPanel   userEmail={user.email} />}
      {active === 'cron'      && <CronPanel       userEmail={user.email} />}
      {active === 'system'    && <SystemPanel     userEmail={user.email} />}
    </div>
  );
}
