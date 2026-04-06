'use client';
import React, { useState, useEffect, useCallback } from 'react';
import BacktestPanel from './admin/BacktestPanel';
import AILabPanel from './admin/AILabPanel';

const ADMIN_EMAILS = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

// ── Auth helper - attaches JWT to all admin API calls ────────────────────────
async function getAuthToken() {
  try {
    const { supabase } = await import('@/lib/supabase');
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch { return null; }
}
async function adminFetch(url, opts = {}) {
  const token = await getAuthToken();
  const headers = { ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return fetch(url, { ...opts, headers });
}

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
      <div style={{ fontSize: '1.5rem', fontWeight: 800, fontFamily: 'IBM Plex Mono, monospace', color }}>{value ?? '-'}</div>
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

  const load = useCallback(() => {
    setLoading(true);
    adminFetch(`/api/admin?action=stats`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading analytics...</div>;
  if (error)   return <div style={{ color: '#f87171', padding: '1rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)' }}>[!] {error}</div>;

  const topSport = data?.sportCounts ? Object.entries(data.sportCounts).sort((a, b) => b[1] - a[1])[0] : null;

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', justifyContent: 'flex-end' }}>
        <button onClick={load} style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: '4px',
          color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 8px', fontSize: '0.72rem',
          fontFamily: 'inherit',
        }}>[refresh] Refresh</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '1.5rem' }}>
        <StatCard label="Total Users"    value={data?.totalUsers}  icon="[users]" />
        <StatCard label="Total Picks"    value={data?.totalPicks}  icon="[list]" />
        <StatCard label="Win Rate"       value={data?.winRate ? `${data.winRate}%` : '-'} icon="[target]" color={parseFloat(data?.winRate) >= 55 ? '#4ade80' : parseFloat(data?.winRate) >= 50 ? '#fbbf24' : '#f87171'} sub="last 200 picks" />
        <StatCard label="Top Sport"      value={topSport?.[0] || '-'} icon="[trophy]" sub={topSport ? `${topSport[1]} picks` : ''} />
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
                {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
              </div>
            </div>
          ))}
          {(!data?.recentUsers?.length) && <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem' }}>No user data - may need service role key</div>}
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
// ── Edit User Profile Modal ───────────────────────────────────────────────────
function EditUserModal({ user: u, onClose, onSaved }) {
  const [form, setForm] = useState({
    username:       u.username       || '',
    display_name:   u.display_name   || '',
    bio:            u.bio            || '',
    avatar_emoji:   u.avatar_emoji   || '',
    twitter_handle: u.twitter_handle || '',
    location:       u.location       || '',
    role:           u.role           || 'user',
    is_banned:      u.is_banned      ?? false,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const field = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true); setError('');
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'edit_profile', targetId: u.id, ...form }),
    });
    const d = await res.json();
    if (d.error) { setError(d.error); setSaving(false); return; }
    onSaved({ ...u, ...form });
    onClose();
  }

  const row = (label, children) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</label>
      {children}
    </div>
  );
  const inp = (k, opts = {}) => (
    <input className="input" value={form[k]} onChange={e => field(k, e.target.value)}
      style={{ fontSize: '0.82rem', padding: '5px 8px' }} {...opts} />
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '14px', width: '100%', maxWidth: '560px', padding: '1.5rem', boxShadow: '0 24px 64px rgba(0,0,0,0.7)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--gold)' }}>[edit] Edit Profile</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>{u.email || u.id}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
        </div>

        {error && <div style={{ color: '#f87171', fontSize: '0.78rem', marginBottom: '1rem', padding: '0.5rem 0.75rem', background: 'rgba(248,113,113,0.07)', borderRadius: '6px' }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          {row('Username', inp('username', { placeholder: 'SharpBettor99' }))}
          {row('Display Name', inp('display_name', { placeholder: 'Jon S.' }))}
          {row('Avatar Emoji', inp('avatar_emoji', { placeholder: '[GOAT]', maxLength: 4 }))}
          {row('Twitter / X Handle', inp('twitter_handle', { placeholder: '@bettor' }))}
          {row('Location', inp('location', { placeholder: 'Las Vegas, NV' }))}
          {row('Role', (
            <select className="input" value={form.role} onChange={e => field('role', e.target.value)} style={{ fontSize: '0.82rem', padding: '5px 8px' }}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="moderator">Moderator</option>
            </select>
          ))}
        </div>

        {row('Bio', (
          <textarea className="input" value={form.bio} onChange={e => field('bio', e.target.value)}
            rows={3} style={{ fontSize: '0.82rem', padding: '5px 8px', resize: 'vertical' }} placeholder="Sharp bettor, 5+ years, specializing in MLB props..." />
        ))}

        <div style={{ display: 'flex', gap: '16px', marginTop: '12px', marginBottom: '1.25rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: form.is_banned ? '#f87171' : 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_banned} onChange={e => field('is_banned', e.target.checked)} />
            [X] Banned
          </label>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '6px 18px', borderRadius: '7px', border: 'none', background: saving ? 'rgba(255,184,0,0.3)' : 'rgba(255,184,0,0.85)', color: '#000', fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontSize: '0.82rem' }}>
            {saving ? 'Saving...' : '[save] Save Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersPanel({ userEmail, onNavigate }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [search, setSearch]   = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [editingUser, setEditingUser] = useState(null);

  // Create user form
  const [showCreate, setShowCreate] = useState(false);
  const [newEmail, setNewEmail]     = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [creating, setCreating]     = useState(false);
  const [createMsg, setCreateMsg]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    adminFetch(`/api/admin?action=users`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [userEmail]);

  useEffect(() => { load(); }, [load]);

  async function handleAction(action, targetId, value) {
    setActionMsg('');
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, targetId, value }),
    });
    const d = await res.json();
    if (d.error) { setActionMsg(`Error: ${d.error}`); return; }
    setActionMsg(`[ok] Done`);
    load();
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setCreating(true); setCreateMsg('');
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_user', newEmail, newPassword, newUsername }),
    });
    const d = await res.json();
    setCreating(false);
    if (d.error) { setCreateMsg(`Error: ${d.error}`); return; }
    setCreateMsg(`[ok] Account created for ${newEmail}`);
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

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading users...</div>;

  return (
    <div>
      {error && <div style={{ color: '#f87171', padding: '0.75rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '1rem' }}>[!] {error}</div>}
      {actionMsg && <div style={{ color: '#4ade80', padding: '0.5rem 0.75rem', background: 'rgba(74,222,128,0.05)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>{actionMsg}</div>}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          placeholder="Search name or email..."
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
        <button onClick={load} style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: '4px',
          color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 8px', fontSize: '0.72rem',
          fontFamily: 'inherit',
        }}>[refresh] Refresh</button>
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
          {showCreate ? 'x Cancel' : '+ Create User'}
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
            >{creating ? 'Creating...' : 'Create Account'}</button>
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
                    {u.top_sport && <span style={{ color: '#94a3b8', fontSize: '0.65rem' }}>[pin] {u.top_sport}</span>}
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>No picks yet</span>
                )}
                <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                  {u.last_pick ? `active ${new Date(u.last_pick).toLocaleDateString()}` : `joined ${u.created_at ? new Date(u.created_at).toLocaleDateString() : '?'}`}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap' }}>
              <button
                onClick={() => setEditingUser(u)}
                style={{
                  padding: '4px 10px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                  border: '1px solid rgba(255,184,0,0.3)', background: 'rgba(255,184,0,0.06)', color: 'var(--gold)',
                }}
              >
                [edit] Edit
              </button>
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
            No users found{search ? ` matching "${search}"` : ''} - ensure Supabase service role key is configured
          </div>
        )}
      </div>

      {/* Edit User Profile Modal */}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={(updated) => {
            setData(d => ({
              ...d,
              users: (d?.users || []).map(u => u.id === updated.id ? { ...u, ...updated } : u),
            }));
            setEditingUser(null);
          }}
        />
      )}
    </div>
  );
}

// ── Edit Pick Modal ───────────────────────────────────────────────────────────
function EditPickModal({ pick, userEmail, onClose, onSaved }) {
  const [form, setForm] = useState({
    team:          pick.team          || '',
    sport:         pick.sport         || '',
    bet_type:      pick.bet_type      || 'Moneyline',
    odds:          pick.odds          != null ? String(pick.odds) : '',
    units:         pick.units         != null ? String(pick.units) : '1',
    result:        pick.result        || '',
    notes:         pick.notes         || '',
    contest_entry: pick.contest_entry ?? false,
    is_public:     pick.is_public     ?? true,
  });
  const [saving, setSaving]   = useState(false);
  const [error,  setError]    = useState('');

  const field = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true); setError('');
    const updates = {
      team:          form.team,
      sport:         form.sport,
      bet_type:      form.bet_type,
      odds:          form.odds !== '' ? parseInt(form.odds) : null,
      units:         form.units !== '' ? parseFloat(form.units) : 1,
      result:        form.result || null,
      notes:         form.notes || null,
      contest_entry: form.contest_entry,
      is_public:     form.is_public,
    };
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit_pick', targetId: pick.id, ...updates }),
    });
    const d = await res.json();
    if (d.error) { setError(d.error); setSaving(false); return; }
    onSaved({ ...pick, ...updates });
    onClose();
  }

  const row = (label, children) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</label>
      {children}
    </div>
  );
  const inp = (k, opts = {}) => (
    <input className="input" value={form[k]} onChange={e => field(k, e.target.value)}
      style={{ fontSize: '0.82rem', padding: '5px 8px' }} {...opts} />
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '14px', width: '100%', maxWidth: '520px', padding: '1.5rem', boxShadow: '0 24px 64px rgba(0,0,0,0.7)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--gold)' }}>[edit] Edit Pick</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            {pick.profiles?.username || pick.username || pick.user_id?.slice(0,8)} . {pick.date}
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
        </div>

        {error && <div style={{ color: '#f87171', fontSize: '0.78rem', marginBottom: '1rem', padding: '0.5rem 0.75rem', background: 'rgba(248,113,113,0.07)', borderRadius: '6px' }}>{error}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          {row('Team / Pick', inp('team', { placeholder: 'e.g. Chicago Cubs' }))}
          {row('Sport', (
            <select className="input" value={form.sport} onChange={e => field('sport', e.target.value)} style={{ fontSize: '0.82rem', padding: '5px 8px' }}>
              {['MLB','NFL','NBA','NHL','NCAAF','NCAAB','Soccer','MLS','Other'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ))}
          {row('Bet Type', (
            <select className="input" value={form.bet_type} onChange={e => field('bet_type', e.target.value)} style={{ fontSize: '0.82rem', padding: '5px 8px' }}>
              {['Moneyline','Spread','Over','Under','Total (Over)','Total (Under)','Run Line','Puck Line','Other'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ))}
          {row('Odds (American)', inp('odds', { placeholder: 'e.g. -110 or +250', type: 'number' }))}
          {row('Units', inp('units', { placeholder: '1', type: 'number', step: '0.5' }))}
          {row('Result', (
            <select className="input" value={form.result} onChange={e => field('result', e.target.value)} style={{ fontSize: '0.82rem', padding: '5px 8px' }}>
              <option value="">PENDING</option>
              <option value="WIN">WIN</option>
              <option value="LOSS">LOSS</option>
              <option value="PUSH">PUSH</option>
            </select>
          ))}
        </div>

        {row('Notes / Line Info', (
          <textarea className="input" value={form.notes} onChange={e => field('notes', e.target.value)}
            rows={2} style={{ fontSize: '0.82rem', padding: '5px 8px', resize: 'vertical' }} placeholder="e.g. -1.5 run line, over 8.5" />
        ))}

        <div style={{ display: 'flex', gap: '16px', marginTop: '12px', marginBottom: '1.25rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.contest_entry} onChange={e => field('contest_entry', e.target.checked)} />
            [trophy] Contest Entry
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_public} onChange={e => field('is_public', e.target.checked)} />
            [web] Public
          </label>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: '7px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding: '6px 18px', borderRadius: '7px', border: 'none', background: saving ? 'rgba(255,184,0,0.3)' : 'rgba(255,184,0,0.85)', color: '#000', fontWeight: 800, cursor: saving ? 'default' : 'pointer', fontSize: '0.82rem' }}>
            {saving ? 'Saving...' : '[save] Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PICKS AUDIT TAB ───────────────────────────────────────────────────────────
function PicksAuditPanel({ userEmail }) {
  const [picks, setPicks]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [page, setPage]         = useState(0);
  const [sport, setSport]       = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [editPick, setEditPick] = useState(null);
  const [showAddPick, setShowAddPick] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ action: 'picks', page, ...(sport ? { sport } : {}) });
    adminFetch(`/api/admin?${params}`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setPicks(d.picks || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [userEmail, page, sport]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id) {
    if (!confirm('Delete this pick? This cannot be undone.')) return;
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_pick', targetId: id }),
    });
    const d = await res.json();
    if (d.error) { setActionMsg(`Error: ${d.error}`); return; }
    setActionMsg('[ok] Pick deleted');
    setPicks(prev => prev.filter(p => p.id !== id));
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleReset(id) {
    if (!confirm('Reset this pick back to PENDING? This clears the result so it will be re-graded.')) return;
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_pick', targetId: id }),
    });
    const d = await res.json();
    if (d.error) { setActionMsg(`Error: ${d.error}`); return; }
    setActionMsg('[refresh] Pick reset to PENDING');
    setPicks(prev => prev.map(p => p.id === id ? { ...p, result: null, profit: null, graded_at: null } : p));
    setTimeout(() => setActionMsg(''), 3000);
  }

  function handleSaved(updated) {
    setPicks(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
    setActionMsg('[ok] Pick updated');
    setTimeout(() => setActionMsg(''), 3000);
  }

  function handleAdded(newPick) {
    if (newPick) setPicks(prev => [newPick, ...prev]);
    setActionMsg('[ok] Pick added successfully');
    setTimeout(() => setActionMsg(''), 3000);
  }

  const resultColor = r => r === 'WIN' ? '#4ade80' : r === 'LOSS' ? '#f87171' : r === 'PUSH' ? '#94a3b8' : 'var(--text-muted)';

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading picks...</div>;

  return (
    <div>
      {editPick && <EditPickModal pick={editPick} userEmail={userEmail} onClose={() => setEditPick(null)} onSaved={handleSaved} />}
      {showAddPick && <AddPickModal userEmail={userEmail} onClose={() => setShowAddPick(false)} onAdded={handleAdded} />}
      {error && <div style={{ color: '#f87171', padding: '0.75rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '1rem' }}>[!] {error}</div>}
      {actionMsg && <div style={{ color: '#4ade80', padding: '0.5rem 0.75rem', background: 'rgba(74,222,128,0.05)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>{actionMsg}</div>}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {['', 'MLB', 'NFL', 'NBA', 'NHL', 'NCAAF', 'NCAAB', 'Soccer', 'Other'].map(s => (
          <button key={s} onClick={() => { setSport(s); setPage(0); }}
            style={{ padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer', border: `1px solid ${sport === s ? 'var(--gold)' : 'var(--border)'}`, background: sport === s ? 'rgba(255,184,0,0.08)' : 'transparent', color: sport === s ? 'var(--gold)' : 'var(--text-muted)', fontWeight: sport === s ? 700 : 400 }}>
            {s || 'All'}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <button onClick={() => setShowAddPick(true)}
            style={{ padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(74,222,128,0.4)', background: 'rgba(74,222,128,0.08)', color: '#4ade80', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>
            + Add Pick
          </button>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: page === 0 ? 'not-allowed' : 'pointer', fontSize: '0.75rem' }}>{'<- Prev'}</button>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', alignSelf: 'center' }}>Page {page + 1}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={picks.length < 50}
            style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: picks.length < 50 ? 'not-allowed' : 'pointer', fontSize: '0.75rem' }}>{'Next ->'}</button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['User', 'Date', 'Sport', 'Pick', 'Type', 'Units', 'Odds', 'Result', 'P/L', 'Contest', 'Notes', ''].map(h => (
                <th key={h} style={{ padding: '0.65rem 0.75rem', textAlign: 'left', color: 'var(--text-muted)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {picks.map((p, i) => {
              const username = p.profiles?.username || p.user_id?.slice(0, 8);
              const adminEdited = p.admin_edited_at;
              return (
                <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: adminEdited ? 'rgba(255,184,0,0.03)' : i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {username}
                    {adminEdited && <span style={{ marginLeft: '4px', fontSize: '0.58rem', color: '#FFB800' }} title={`Edited by ${p.admin_edited_by || 'admin'}`}>[edit]</span>}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.72rem' }}>{p.date}</td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ color: '#60a5fa', background: '#0d1a2b', padding: '1px 5px', borderRadius: '3px', fontSize: '0.65rem', fontWeight: 600 }}>{p.sport}</span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-primary)', fontWeight: 700, maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.team}</td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{p.bet_type || '-'}</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>{p.units || 1}u</td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'IBM Plex Mono, monospace', color: p.odds > 0 ? '#4ade80' : 'var(--text-primary)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                    {p.odds > 0 ? `+${p.odds}` : p.odds}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <span style={{ padding: '1px 6px', borderRadius: '3px', fontSize: '0.65rem', fontWeight: 700, background: p.result === 'WIN' ? 'rgba(74,222,128,0.12)' : p.result === 'LOSS' ? 'rgba(248,113,113,0.12)' : 'rgba(255,255,255,0.06)', color: resultColor(p.result) }}>
                      {p.result || 'PENDING'}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: parseFloat(p.profit) >= 0 ? '#4ade80' : '#f87171', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                    {(p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH') && p.profit != null
                      ? `${parseFloat(p.profit) >= 0 ? '+' : ''}${parseFloat(p.profit).toFixed(2)}u` : '-'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center' }}>
                    {p.contest_entry ? <span style={{ color: 'var(--gold)', fontSize: '0.85rem' }}>[trophy]</span> : <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>-</span>}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.68rem', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={p.notes || ''}>
                    {p.notes || '-'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button onClick={() => setEditPick(p)} style={{ padding: '2px 7px', borderRadius: '4px', border: '1px solid rgba(255,184,0,0.3)', background: 'transparent', color: '#FFB800', cursor: 'pointer', fontSize: '0.68rem' }} title="Edit pick details">
                        Edit
                      </button>
                      {p.result && (
                        <button onClick={() => handleReset(p.id)} style={{ padding: '2px 7px', borderRadius: '4px', border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '0.68rem' }} title="Reset to PENDING - re-grades next cron">
                          [refresh]
                        </button>
                      )}
                      <button onClick={() => handleDelete(p.id)} style={{ padding: '2px 7px', borderRadius: '4px', border: '1px solid rgba(248,113,113,0.3)', background: 'transparent', color: '#f87171', cursor: 'pointer', fontSize: '0.68rem' }}>
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!picks.length && (
              <tr><td colSpan={12} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No picks found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Add Pick Modal ────────────────────────────────────────────────────────────
function AddPickModal({ userEmail, onClose, onAdded }) {
  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local tz
  const [form, setForm] = React.useState({
    userId:        '',
    userSearch:    '',
    date:          today,
    sport:         'MLB',
    team:          '',
    bet_type:      'Moneyline',
    odds:          '',
    units:         '1',
    matchup:       '',
    result:        '',
    notes:         '',
    contest_entry: false,
    is_public:     true,
    book:          '',
  });
  const [userResults, setUserResults] = React.useState([]);
  const [selectedUser, setSelectedUser] = React.useState(null);
  const [searching, setSearching] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const searchTimer = React.useRef(null);

  const field = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Debounced user search
  React.useEffect(() => {
    if (!form.userSearch || form.userSearch.length < 2) { setUserResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await adminFetch(`/api/admin?action=users`);
        const d = await res.json();
        const q = form.userSearch.toLowerCase();
        const filtered = (d.users || []).filter(u =>
          (u.username || '').toLowerCase().includes(q) ||
          (u.email    || '').toLowerCase().includes(q)
        ).slice(0, 8);
        setUserResults(filtered);
      } catch { /* ignore */ }
      setSearching(false);
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [form.userSearch]);

  function pickUser(u) {
    setSelectedUser(u);
    setUserResults([]);
    field('userId', u.id);
    field('userSearch', u.username || u.email || u.id);
  }

  async function save() {
    if (!form.userId) { setError('Select a user first'); return; }
    if (!form.team.trim()) { setError('Team / pick name is required'); return; }
    if (!form.odds) { setError('Odds are required'); return; }
    setSaving(true); setError('');
    const payload = {
      action:        'add_pick',
      userId:        form.userId,
      date:          form.date,
      sport:         form.sport,
      team:          form.team.trim(),
      bet_type:      form.bet_type,
      odds:          parseInt(form.odds),
      units:         parseFloat(form.units) || 1,
      matchup:       form.matchup.trim() || null,
      result:        form.result || null,
      notes:         form.notes.trim() || null,
      contest_entry: form.contest_entry,
      is_public:     form.is_public,
      book:          form.book.trim() || null,
    };
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (d.error) { setError(d.error); setSaving(false); return; }
    onAdded(d.pick);
    onClose();
  }

  const row = (label, children) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700 }}>{label}</label>
      {children}
    </div>
  );
  const inp = (k, opts = {}) => (
    <input className="input" value={form[k]} onChange={e => field(k, e.target.value)}
      style={{ fontSize: '0.82rem', padding: '5px 8px' }} {...opts} />
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '14px', width: '100%', maxWidth: '560px', padding: '1.5rem', boxShadow: '0 24px 64px rgba(0,0,0,0.7)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: '#4ade80' }}>+ Add Pick for User</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
        </div>

        {error && <div style={{ color: '#f87171', fontSize: '0.78rem', marginBottom: '1rem', padding: '0.5rem 0.75rem', background: 'rgba(248,113,113,0.07)', borderRadius: '6px' }}>{error}</div>}

        {/* User search */}
        <div style={{ position: 'relative', marginBottom: '1rem' }}>
          {row('User (search by username or email)', (
            <input className="input" value={form.userSearch} onChange={e => { field('userSearch', e.target.value); if (selectedUser) setSelectedUser(null); field('userId', ''); }}
              placeholder="Type username or email..." style={{ fontSize: '0.82rem', padding: '5px 8px' }} />
          ))}
          {selectedUser && (
            <div style={{ fontSize: '0.68rem', color: '#4ade80', marginTop: '3px' }}>
              [ok] {selectedUser.username || selectedUser.email} <span style={{ color: 'var(--text-muted)' }}>({selectedUser.id?.slice(0, 8)}...)</span>
            </div>
          )}
          {(userResults.length > 0 || searching) && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', zIndex: 50, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', marginTop: '2px', overflow: 'hidden' }}>
              {searching && <div style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>Searching...</div>}
              {userResults.map(u => (
                <div key={u.id} onClick={() => pickUser(u)}
                  style={{ padding: '0.5rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', gap: '8px', alignItems: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.82rem' }}>{u.username || '-'}</span>
                  {u.email && <span style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>{u.email}</span>}
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.62rem' }}>{u.pick_count || 0} picks</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
          {row('Date', inp('date', { type: 'date' }))}
          {row('Sport', (
            <select className="input" value={form.sport} onChange={e => field('sport', e.target.value)} style={{ fontSize: '0.82rem', padding: '5px 8px' }}>
              {['MLB','NFL','NBA','NHL','NCAAF','NCAAB','MLS','Soccer','Other'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          ))}
          {row('Team / Pick', inp('team', { placeholder: 'e.g. Chicago Cubs' }))}
          {row('Matchup', inp('matchup', { placeholder: 'e.g. Cubs vs Cardinals' }))}
          {row('Bet Type', (
            <select className="input" value={form.bet_type} onChange={e => field('bet_type', e.target.value)} style={{ fontSize: '0.82rem', padding: '5px 8px' }}>
              {['Moneyline','Spread','Over','Under','Total (Over)','Total (Under)','Run Line','Puck Line','Other'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ))}
          {row('Odds (American)', inp('odds', { placeholder: '-110 or +250', type: 'number' }))}
          {row('Units', inp('units', { placeholder: '1', type: 'number', step: '0.5', min: '0.1' }))}
          {row('Result', (
            <select className="input" value={form.result} onChange={e => field('result', e.target.value)} style={{ fontSize: '0.82rem', padding: '5px 8px' }}>
              <option value="">PENDING</option>
              <option value="WIN">WIN</option>
              <option value="LOSS">LOSS</option>
              <option value="PUSH">PUSH</option>
            </select>
          ))}
          {row('Book', inp('book', { placeholder: 'DraftKings, FanDuel...' }))}
        </div>

        {row('Notes / Line Info', (
          <textarea className="input" value={form.notes} onChange={e => field('notes', e.target.value)}
            rows={2} style={{ fontSize: '0.82rem', padding: '5px 8px', resize: 'vertical' }} placeholder="e.g. -1.5 run line, over 8.5" />
        ))}

        <div style={{ display: 'flex', gap: '16px', marginTop: '12px', marginBottom: '1.25rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.contest_entry} onChange={e => field('contest_entry', e.target.checked)} />
            [trophy] Contest Entry
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={form.is_public} onChange={e => field('is_public', e.target.checked)} />
            [view] Public Pick
          </label>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '9px', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ flex: 2, padding: '9px', borderRadius: '8px', border: 'none', background: saving ? 'rgba(74,222,128,0.1)' : 'rgba(74,222,128,0.15)', color: '#4ade80', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '0.82rem' }}>
            {saving ? 'Adding...' : '+ Add Pick'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Declare Winner Modal ──────────────────────────────────────────────────────
function DeclareWinnerModal({ userEmail, onClose, onDeclared }) {
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [month, setMonth]       = useState(() => new Date().toISOString().slice(0, 7));
  const [msg, setMsg]           = useState('');
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/contest-leaderboard?userId=&month=${month}`)
      .then(r => r.json())
      .then(d => {
        const eligible = (d.leaderboard || []).filter(e => e.total_settled >= 15);
        setEntries(eligible);
        if (eligible.length > 0 && !selected) setSelected(eligible[0]);
        setLoading(false);
      }).catch(() => setLoading(false));
  }, [month]); // eslint-disable-line

  async function declare() {
    if (!selected) return;
    setSaving(true);
    const record = `${selected.wins}-${selected.losses}${selected.pushes > 0 ? `-${selected.pushes}` : ''}`;
    const res = await fetch('/api/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminEmail: userEmail,
        type: 'contest_winner',
        title: `[trophy] ${month} Contest Winner: ${selected.display_name || selected.username}!`,
        message: `Congratulations to ${selected.display_name || selected.username} for winning the ${month} contest with a ${record} record and ${selected.units > 0 ? '+' : ''}${selected.units}u profit!`,
        month,
        winner: {
          user_id:      selected.user_id,
          username:     selected.username,
          display_name: selected.display_name,
          units:        selected.units,
          record,
        },
      }),
    });
    const d = await res.json();
    if (d.error) { setMsg(`Error: ${d.error}`); setSaving(false); return; }
    onDeclared();
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid rgba(255,184,0,0.3)', borderRadius: '16px', width: '100%', maxWidth: '520px', padding: '1.75rem', boxShadow: '0 24px 64px rgba(0,0,0,0.8)' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
          <div style={{ fontWeight: 900, fontSize: '1.1rem', color: '#FFB800' }}>[trophy] Declare Contest Winner</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}>x</button>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, display: 'block', marginBottom: '4px' }}>Contest Month</label>
          <input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} style={{ fontSize: '0.85rem' }} />
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1.5rem' }}>Loading eligible entries...</div>
        ) : entries.length === 0 ? (
          <div style={{ color: '#f87171', textAlign: 'center', padding: '1.5rem', fontSize: '0.82rem' }}>No users have reached 15+ settled picks for {month}.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '1.25rem', maxHeight: '280px', overflowY: 'auto' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, marginBottom: '4px' }}>
              Eligible Competitors ({entries.length}) - select winner
            </div>
            {entries.map((e, i) => {
              const isSelected = selected?.user_id === e.user_id;
              return (
                <div key={e.user_id} onClick={() => setSelected(e)} style={{
                  display: 'flex', alignItems: 'center', gap: '12px', padding: '0.65rem 0.85rem',
                  background: isSelected ? 'rgba(255,184,0,0.1)' : 'var(--bg-elevated)',
                  border: `1px solid ${isSelected ? 'rgba(255,184,0,0.5)' : 'var(--border)'}`,
                  borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s',
                }}>
                  <span style={{ fontSize: '1rem' }}>{i === 0 ? '[1st]' : i === 1 ? '[2nd]' : i === 2 ? '[3rd]' : `#${i + 1}`}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: isSelected ? '#FFB800' : 'var(--text-primary)', fontSize: '0.85rem' }}>
                      {e.display_name || e.username}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                      {e.wins}W-{e.losses}L . {e.total_settled} picks
                    </div>
                  </div>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '0.9rem', color: e.units >= 0 ? '#4ade80' : '#f87171' }}>
                    {e.units >= 0 ? '+' : ''}{e.units}u
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {msg && <div style={{ color: '#f87171', fontSize: '0.78rem', marginBottom: '1rem' }}>{msg}</div>}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 16px', borderRadius: '7px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.82rem' }}>Cancel</button>
          <button onClick={declare} disabled={saving || !selected || entries.length === 0} style={{
            padding: '7px 20px', borderRadius: '7px', border: 'none', fontWeight: 800, cursor: saving || !selected ? 'default' : 'pointer', fontSize: '0.82rem',
            background: saving || !selected ? 'rgba(255,184,0,0.3)' : 'rgba(255,184,0,0.85)', color: '#000',
          }}>
            {saving ? 'Declaring...' : '[trophy] Declare Winner & Announce'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── CONTESTS TAB ──────────────────────────────────────────────────────────────
function ContestsPanel({ userEmail }) {
  const [picks, setPicks]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [actionMsg, setActionMsg] = useState('');
  const [filter, setFilter]       = useState('review'); // review | all | approved | flagged | pending | rejected
  const [editPick, setEditPick]   = useState(null);
  const [showDeclare, setShowDeclare] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminFetch(`/api/contest-audit?action=log`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setPicks(d.picks || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [userEmail]);

  useEffect(() => { load(); }, [load]);

  async function handleOverride(pickId, status, customReason) {
    const reason = customReason
      || (status === 'REJECTED' ? prompt('Rejection reason (shown to admin log):') : 'Admin approved');
    if (status === 'REJECTED' && !reason) return;
    setActionMsg('Processing...');
    const res = await adminFetch('/api/contest-audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'override', pickId, overrideStatus: status, overrideReason: reason }),
    });
    const d = await res.json();
    if (d.error) { setActionMsg(`Error: ${d.error}`); } else { setActionMsg(`[ok] Pick ${status.toLowerCase()}`); load(); }
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleDelete(id) {
    if (!confirm('Permanently delete this contest pick? This cannot be undone.')) return;
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_pick', targetId: id }),
    });
    const d = await res.json();
    if (d.error) { setActionMsg(`Error: ${d.error}`); return; }
    setActionMsg('[ok] Pick deleted');
    setPicks(prev => prev.filter(p => p.id !== id));
    setTimeout(() => setActionMsg(''), 3000);
  }

  async function handleBatchAudit() {
    setActionMsg('Running AI audit...');
    const res = await adminFetch('/api/contest-audit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'batch-audit' }),
    });
    const d = await res.json();
    setActionMsg(`[ok] Audited ${d.audited || 0} picks`);
    load();
    setTimeout(() => setActionMsg(''), 4000);
  }

  async function handleTimingSweep() {
    if (!confirm('Run timing sweep? This auto-rejects picks submitted after game start. Cannot be undone.')) return;
    setActionMsg('Running timing sweep...');
    const res = await adminFetch('/api/contest-audit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'timing-sweep' }),
    });
    const d = await res.json();
    if (d.error) { setActionMsg(`Error: ${d.error}`); }
    else { setActionMsg(`[time] Swept ${d.swept} picks - ${d.violations} in-game submissions rejected`); load(); }
    setTimeout(() => setActionMsg(''), 6000);
  }

  function handleSavedPick(updated) {
    setPicks(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
    setActionMsg('[ok] Pick updated');
    setTimeout(() => setActionMsg(''), 3000);
  }

  // "In Review" = flagged or has audit issues — needs admin attention
  const reviewQueue = picks.filter(p =>
    p.audit_status === 'FLAGGED' || (!p.audit_status && !p.audit_override)
  );

  const filtered = filter === 'review'
    ? reviewQueue
    : filter === 'all'
    ? picks
    : filter === 'pending'
    ? picks.filter(p => !p.audit_status || p.audit_status === 'PENDING')
    : picks.filter(p => p.audit_status === filter.toUpperCase());

  const statusColor = s => s === 'APPROVED' ? '#4ade80' : s === 'FLAGGED' ? '#fbbf24' : s === 'REJECTED' ? '#f87171' : '#94a3b8';
  const statusBg    = s => s === 'APPROVED' ? 'rgba(74,222,128,0.08)' : s === 'FLAGGED' ? 'rgba(251,191,36,0.08)' : s === 'REJECTED' ? 'rgba(248,113,113,0.08)' : 'rgba(148,163,184,0.08)';

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading contest audit...</div>;

  return (
    <div>
      {editPick && <EditPickModal pick={editPick} userEmail={userEmail} onClose={() => setEditPick(null)} onSaved={handleSavedPick} />}
      {showDeclare && <DeclareWinnerModal userEmail={userEmail} onClose={() => setShowDeclare(false)} onDeclared={() => setActionMsg('[ok] Winner announced!')} />}

      {error && <div style={{ color: '#f87171', padding: '0.75rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)', marginBottom: '1rem' }}>[!] {error}</div>}
      {actionMsg && <div style={{ color: '#4ade80', padding: '0.5rem 0.75rem', background: 'rgba(74,222,128,0.05)', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.8rem' }}>{actionMsg}</div>}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {[
          ['review',   `[!] Review Queue${reviewQueue.length > 0 ? ` (${reviewQueue.length})` : ''}`],
          ['all',      'All'],
          ['approved', 'Approved'],
          ['flagged',  'Flagged'],
          ['pending',  'Pending'],
          ['rejected', 'Rejected'],
        ].map(([v, l]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
            border: `1px solid ${filter === v ? (v === 'review' && reviewQueue.length > 0 ? '#fbbf24' : '#FFB800') : '#222'}`,
            background: filter === v ? (v === 'review' && reviewQueue.length > 0 ? 'rgba(251,191,36,0.1)' : '#1a1200') : 'transparent',
            color: filter === v ? (v === 'review' && reviewQueue.length > 0 ? '#fbbf24' : '#FFB800') : '#666',
            fontWeight: filter === v ? 700 : 400,
          }}>{l}</button>
        ))}
        <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', flex: 1 }}>{filtered.length} picks</span>
        <button onClick={() => setShowDeclare(true)} style={{ padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, border: '1px solid rgba(255,184,0,0.5)', background: 'rgba(255,184,0,0.12)', color: '#FFB800' }}>[trophy] Declare Winner</button>
        <button onClick={handleBatchAudit} style={{ padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, border: '1px solid rgba(255,184,0,0.25)', background: 'rgba(255,184,0,0.06)', color: '#FFB800' }}>[target] AI Audit</button>
        <button onClick={handleTimingSweep} style={{ padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.07)', color: '#f87171' }} title="Auto-reject picks submitted after game start">[time] Timing</button>
        <button onClick={load} style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: '4px',
          color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 8px', fontSize: '0.72rem',
          fontFamily: 'inherit',
        }}>[refresh] Refresh</button>
      </div>

      {/* Rules bar */}
      <div style={{ padding: '0.5rem 0.85rem', background: '#0a0800', border: '1px solid rgba(255,184,0,0.12)', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.7rem', color: '#666', lineHeight: 1.6 }}>
        <span style={{ color: '#FFB800', fontWeight: 700 }}>RULES:</span> 1 play/day . Min odds -145, max +400 . Straight bets only (ML/Spread/Total) . No parlays/props . Locked on submit . AI audited . 15 settled picks to win
      </div>

      {/* Pick rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {filtered.map(p => {
          const isReview  = p.audit_status === 'FLAGGED' || (!p.audit_status && !p.audit_override);
          const borderCol = p.audit_status === 'FLAGGED' ? 'rgba(251,191,36,0.35)'
            : p.audit_status === 'REJECTED' ? 'rgba(248,113,113,0.3)'
            : p.audit_status === 'APPROVED' ? 'rgba(74,222,128,0.15)'
            : 'rgba(255,255,255,0.07)';

          // Build flag reasons for display
          const flags = [];
          if (p.audit_reason) {
            let reason = p.audit_reason;
            let hint = null;
            // Detect known AI false-positives and add admin context
            if (/future.*202[0-9]|202[0-9].*future/i.test(reason)) {
              hint = '[tip] Likely false positive - AI flagged the year 2026 as "future" from old training data. If the pick looks valid, click [ok] Admit.';
            } else if (/timing/i.test(reason) && !/submitted.*after/i.test(reason)) {
              hint = '[tip] AI had a timing concern. Check if the pick was placed before game start.';
            } else if (/pinnacle/i.test(reason)) {
              hint = '[tip] Odds were flagged vs Pinnacle sharp line. Could be an outlier book - verify the line was real.';
            }
            flags.push({ text: reason, hint });
          }
          if (!p.audit_status && !p.audit_override) flags.push({ text: 'Pending AI audit - not yet verified', hint: null });

          return (
            <div key={p.id} style={{
              background: 'var(--bg-elevated)', border: `1px solid ${borderCol}`,
              borderRadius: '9px', overflow: 'hidden',
              borderLeft: `4px solid ${isReview ? '#fbbf24' : statusColor(p.audit_status)}`,
            }}>
              {/* Main row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '0.7rem 0.9rem', flexWrap: 'wrap' }}>
                {/* Pick info */}
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text-primary)', fontSize: '0.88rem', fontWeight: 800 }}>{p.team}</span>
                    <span style={{ color: '#60a5fa', background: '#0d1a2b', padding: '1px 5px', borderRadius: '3px', fontSize: '0.63rem', fontWeight: 700 }}>{p.sport}</span>
                    <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.8rem', fontWeight: 700, color: p.odds > 0 ? '#4ade80' : '#f0f0f0' }}>{p.odds > 0 ? '+' : ''}{p.odds}</span>
                    <Badge label={p.audit_status || 'PENDING'} color={statusColor(p.audit_status)} bg={statusBg(p.audit_status)} border={`${statusColor(p.audit_status)}33`} />
                    {p.audit_override && <Badge label="OVERRIDE" color="#ff6b9d" bg="rgba(255,107,157,0.08)" border="rgba(255,107,157,0.2)" />}
                  </div>

                  {/* Detail row */}
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    <span style={{ fontWeight: 700, color: 'var(--text-secondary)' }}>{p.username}</span>
                    <span>{p.date}</span>
                    <span style={{ color: '#94a3b8', background: 'rgba(148,163,184,0.1)', padding: '0 5px', borderRadius: '3px', fontWeight: 600 }}>{p.bet_type || 'Moneyline'}</span>
                    <span>{p.units || 1}u risked</span>
                    {p.notes && <span style={{ color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' }}>"{p.notes}"</span>}
                  </div>

                  {/* Flag reasons — shown prominently */}
                  {flags.length > 0 && (
                    <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {flags.map((f, i) => {
                        const flagText = typeof f === 'string' ? f : f.text;
                        const flagHint = typeof f === 'object' ? f.hint : null;
                        return (
                          <div key={i}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '4px 8px', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: flagHint ? '5px 5px 0 0' : '5px', fontSize: '0.68rem' }}>
                              <span style={{ color: '#fbbf24', flexShrink: 0 }}>[!]</span>
                              <span style={{ color: '#e2c97e', lineHeight: 1.4 }}>{flagText}</span>
                            </div>
                            {flagHint && (
                              <div style={{ padding: '4px 8px', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.18)', borderTop: 'none', borderRadius: '0 0 5px 5px', fontSize: '0.65rem', color: '#93c5fd', lineHeight: 1.4 }}>
                                {flagHint}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Result + actions */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '5px', flexShrink: 0 }}>
                  {p.result && (
                    <span style={{ padding: '3px 10px', borderRadius: '5px', fontSize: '0.72rem', fontWeight: 800, background: p.result === 'WIN' ? 'rgba(74,222,128,0.12)' : p.result === 'LOSS' ? 'rgba(248,113,113,0.12)' : 'rgba(148,163,184,0.12)', color: p.result === 'WIN' ? '#4ade80' : p.result === 'LOSS' ? '#f87171' : '#94a3b8' }}>
                      {p.result}{p.profit != null ? ` . ${parseFloat(p.profit) >= 0 ? '+' : ''}${parseFloat(p.profit).toFixed(2)}u` : ''}
                    </span>
                  )}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button onClick={() => handleOverride(p.id, 'APPROVED', 'Admin approved')}
                      title="Admit to contest"
                      style={{ padding: '4px 9px', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(74,222,128,0.3)', background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>[ok] Admit</button>
                    <button onClick={() => handleOverride(p.id, 'REJECTED')}
                      title="Reject from contest"
                      style={{ padding: '4px 9px', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>x Reject</button>
                    <button onClick={() => setEditPick(p)}
                      title="Edit pick details"
                      style={{ padding: '4px 9px', borderRadius: '5px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(255,184,0,0.25)', background: 'rgba(255,184,0,0.07)', color: '#FFB800' }}>[edit] Edit</button>
                    <button onClick={() => handleDelete(p.id)}
                      title="Delete pick permanently"
                      style={{ padding: '4px 8px', borderRadius: '5px', fontSize: '0.7rem', cursor: 'pointer', border: '1px solid rgba(248,113,113,0.2)', background: 'transparent', color: 'rgba(248,113,113,0.6)' }}>[del]</button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {!filtered.length && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2.5rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
            {filter === 'review' ? '[ok] No picks need review - everything looks clean.' : `No contest picks with filter "${filter}".`}
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

  const load = useCallback(() => {
    setLoading(true);
    adminFetch(`/api/admin?action=activity`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function fmtDate(iso) {
    if (!iso) return '-';
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
    if (!iso) return '-';
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading activity...</div>;
  if (error)   return <div style={{ color: '#f87171', padding: '1rem', background: 'rgba(248,113,113,0.05)', borderRadius: '8px', border: '1px solid rgba(248,113,113,0.2)' }}>[!] {error}</div>;

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
          placeholder="Search user or email..."
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
        <button onClick={load} style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: '4px',
          color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 8px', fontSize: '0.72rem',
          fontFamily: 'inherit',
        }}>[refresh] Refresh</button>
      </div>

      {!hasIPs && (
        <div style={{ padding: '0.6rem 0.85rem', background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.12)', borderRadius: '7px', marginBottom: '1rem', fontSize: '0.72rem', color: '#888' }}>
          <span style={{ color: '#FFB800', fontWeight: 700 }}>[i] IP addresses</span> - requires Supabase service role key with audit log access. IPs will appear here once configured.
        </div>
      )}

      {/* Table */}
      <div style={{ overflowX: 'auto', background: 'var(--bg-elevated)', borderRadius: '10px', border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['User', 'Email', 'Last Sign-In', 'Last Activity', 'Time on Site', 'Joined', hasIPs ? 'IP Address' : null, 'Status']
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
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{u.username || '-'}</span>
                    </div>
                  </td>
                  {/* Email */}
                  <td style={{ padding: '0.6rem 0.85rem', color: 'var(--text-muted)', fontSize: '0.72rem' }}>{u.email || '-'}</td>
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
                        <span style={{ color: '#60a5fa', fontSize: '0.6rem' }}>[list] pick</span>
                      )}
                    </div>
                  </td>
                  {/* Time on Site */}
                  <td style={{ padding: '0.6rem 0.85rem', whiteSpace: 'nowrap' }}>
                    {u.total_time_seconds > 0 ? (() => {
                      const hrs  = Math.floor(u.total_time_seconds / 3600);
                      const mins = Math.floor((u.total_time_seconds % 3600) / 60);
                      const label = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                          <span style={{ color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem' }}>{label}</span>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.6rem' }}>{u.session_count} session{u.session_count !== 1 ? 's' : ''}</span>
                        </div>
                      );
                    })() : <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>-</span>}
                  </td>
                  {/* Joined */}
                  <td style={{ padding: '0.6rem 0.85rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                  </td>
                  {/* IP (conditional column) */}
                  {hasIPs && (
                    <td style={{ padding: '0.6rem 0.85rem', fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.68rem', color: u.ip_address ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                      {u.ip_address || '-'}
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
              <tr><td colSpan={hasIPs ? 7 : 6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No user data - ensure Supabase service role key is configured</td></tr>
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
    label:    '[trophy] Grade Picks',
    desc:     'Grades pending picks for all users by checking final ESPN scores.',
    schedule: 'Every 5 min, 12 PM-4 AM ET',
    path:     '/api/cron/grade-picks',
    lastRunKey: 'cron_grade_last_run',
  },
  {
    key:      'pregenerate',
    label:    '[AI] Pre-Generate Analyses',
    desc:     'Runs AI analysis on today\'s games and caches results so the Analyzer loads instantly.',
    schedule: '8 AM & 4 PM ET daily',
    path:     '/api/cron/pregenerate-analysis',
    lastRunKey: 'cron_pregenerate_last_run',
  },
  {
    key:      'trends',
    label:    '[up] Daily Trends',
    desc:     'Generates today\'s sharp betting edges using AI with live web search.',
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
    const res = await adminFetch(`/api/admin?action=cron_settings`);
    const d = await res.json();
    if (!d.error && d.settings) {
      // Flatten { key: { value, updated_at } } -> { key: value }
      const flat = {};
      Object.entries(d.settings).forEach(([k, v]) => { flat[k] = v?.value ?? v; });
      setSettings(flat);
    }
    setLoading(false);
  }, [userEmail]);

  useEffect(() => { load(); }, [load]);

  async function handleToggle(key, newVal) {
    await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cron_toggle', jobKey: key, enabled: newVal }),
    });
    setSettings(s => ({ ...s, [`cron_${key}_enabled`]: String(newVal) }));
  }

  async function handleRun(key, path) {
    setRunning(r => ({ ...r, [key]: true }));
    setRunResults(r => ({ ...r, [key]: null }));
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cron_run', jobPath: path }),
    });
    const d = await res.json();
    setRunning(r => ({ ...r, [key]: false }));
    // Unwrap: d = { ok, status, result } or { ok: false, error }
    setRunResults(r => ({ ...r, [key]: d.ok === false ? d : (d.result || d) }));
    load(); // refresh last-run stats
  }

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading cron status...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: '0.5rem 0.75rem', background: 'rgba(255,184,0,0.04)', border: '1px solid rgba(255,184,0,0.12)', borderRadius: '8px', flex: 1 }}>
          [i] Toggling pauses the job without redeploying. "Run Now" triggers it immediately regardless of schedule.
        </div>
        <button onClick={load} style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: '4px',
          color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 8px', fontSize: '0.72rem',
          fontFamily: 'inherit', flexShrink: 0,
        }}>[refresh] Refresh</button>
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
                <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace' }}>[time] {job.schedule}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1px' }}>Last Run</div>
                <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', fontFamily: 'IBM Plex Mono, monospace' }}>
                  {lastRun ? timeAgo(lastRun.last_run_at || lastRun.run_at || lastRun.generated_at) : '-'}
                </div>
              </div>
              {lastRun && (
                <div>
                  <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1px' }}>Result</div>
                  <div style={{ fontSize: '0.73rem', fontFamily: 'IBM Plex Mono, monospace' }}>
                    {lastRun.graded   != null && <span style={{ color: '#4ade80' }}>[ok] {lastRun.graded} graded</span>}
                    {lastRun.edges    != null && <span style={{ color: '#4ade80' }}>[ok] {lastRun.edges} edges</span>}
                    {lastRun.generated != null && <span style={{ color: '#4ade80' }}>[ok] {lastRun.generated} games</span>}
                    {lastRun.errors   != null && lastRun.errors > 0 && <span style={{ color: '#f87171', marginLeft: '8px' }}>[!] {lastRun.errors} errors</span>}
                    {lastRun.error    && <span style={{ color: '#f87171' }}>x {String(lastRun.error).slice(0, 60)}</span>}
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
                {isRunning ? '[wait] Running...' : '> Run Now'}
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
                    ? `x ${String(result.error).slice(0, 80)}`
                    : result.graded   != null ? `[ok] ${result.graded} picks graded in ${result.duration_ms}ms`
                    : result.edges    != null ? `[ok] ${result.edges} edges generated in ${result.duration_ms}ms`
                    : result.generated != null ? `[ok] ${result.generated} analyses in ${result.duration_ms}ms`
                    : '[ok] Done'}
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
  const [analysesDate,     setAnalysesDate]     = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [expandedAnalysis, setExpandedAnalysis] = useState(null); // id of expanded row
  const [gradingId,        setGradingId]        = useState(null); // id currently being saved
  const [aiRecord,         setAiRecord]         = useState(null); // { wins, losses, pushes, winPct, byConf, bySport }
  const [backfillMsg,      setBackfillMsg]      = useState('');
  const [backfillRunning,  setBackfillRunning]  = useState(false);
  const [autoGradeMsg,     setAutoGradeMsg]     = useState('');
  const [autoGradeRunning, setAutoGradeRunning] = useState(false);

  async function handleBackfill() {
    if (!confirm('Backfill commence_time on all historical picks using ESPN? This looks up game start times and updates the database.')) return;
    setBackfillRunning(true);
    setBackfillMsg('Running backfill...');
    try {
      const res = await adminFetch('/api/admin/backfill-commence-time', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (d.error) setBackfillMsg(`Error: ${d.error}`);
      else setBackfillMsg(`[ok] ${d.updated} updated, ${d.skipped} not found, ${d.failed} failed (${d.espnCalls || 0} ESPN calls)`);
    } catch (e) { setBackfillMsg(`Error: ${e.message}`); }
    setBackfillRunning(false);
    setTimeout(() => setBackfillMsg(''), 12000);
  }

  async function handleAutoGrade() {
    setAutoGradeRunning(true);
    setAutoGradeMsg('Auto-grading analyses against ESPN scores...');
    try {
      const res = await adminFetch('/api/admin/auto-grade-analyses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      if (d.error) setAutoGradeMsg(`Error: ${d.error}`);
      else setAutoGradeMsg(`[ok] ${d.graded} graded (${d.wins}W-${d.losses}L-${d.pushes}P), ${d.skipped} skipped, ${d.noScore} no score yet`);
    } catch (e) { setAutoGradeMsg(`Error: ${e.message}`); }
    setAutoGradeRunning(false);
    loadAiRecord();
    loadGeneratedAnalyses();
    setTimeout(() => setAutoGradeMsg(''), 12000);
  }

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
    adminFetch(`/api/admin?action=game_analyses&date=${d}`)
      .then(r => r.json())
      .then(data => setGeneratedAnalyses(data.analyses || []))
      .catch(() => setGeneratedAnalyses([]));
  }

  function loadAiRecord() {
    fetch('/api/admin/grade-analysis')
      .then(r => r.json())
      .then(data => { if (data.summary) setAiRecord(data.summary); })
      .catch(() => {});
  }

  async function gradeAnalysis(id, result) {
    setGradingId(id);
    try {
      await fetch('/api/admin/grade-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, result }),
      });
      // Optimistically update local state so the badge shows immediately
      setGeneratedAnalyses(prev => (prev || []).map(a =>
        a.id === id ? { ...a, prediction_result: result } : a
      ));
      loadAiRecord(); // refresh overall record
    } catch { /* silent */ } finally {
      setGradingId(null);
    }
  }

  // Fires ONE request per sport, sequentially. Each sport gets its own
  // 5-minute Vercel function call so we never hit the timeout regardless of
  // how many games are on the slate (e.g. 15 MLB games x 30s = fine).
  async function runPregenAnalysis(targetDate = null) {
    setPregenRunning(true);
    setPregenResult(null);
    setPregenLiveLog([]);

    // Sync the analyses viewer to the target date immediately
    if (targetDate) {
      setAnalysesDate(targetDate);
      loadGeneratedAnalyses(targetDate);
    }

    const SPORTS = ['mlb', 'nba', 'nhl', 'nfl', 'mls'];
    // force: false = skip games that already have a fresh analysis (< 3.5h old)
    // This prevents re-running the same matchup twice — only missing games get generated
    const base = { userEmail, force: false };
    if (targetDate) base.date = targetDate;

    let totalGenerated = 0, totalSkipped = 0, totalErrors = 0;
    const startTime = Date.now();

    for (let i = 0; i < SPORTS.length; i++) {
      const sport = SPORTS[i];
      // Show which sport is running in the live log with progress info
      setPregenLiveLog(prev => [...prev, {
        sport,
        status: 'running',
        count: null,
        sportIndex: i + 1,
        totalSports: SPORTS.length,
        ts: Date.now(),
      }]);

      try {
        const res = await fetch('/api/cron/pregenerate-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...base, sport }),
        });
        const data = await res.json();
        totalGenerated += data.generated || 0;
        totalSkipped   += data.skipped   || 0;
        totalErrors    += data.errors    || 0;

        // Mark this sport done in the live log with game details
        setPregenLiveLog(prev => prev.map(e =>
          e.sport === sport
            ? { ...e, status: data.generated > 0 ? 'done' : (data.skipped > 0 ? 'skipped' : 'done'), count: data.generated || 0, skipped: data.skipped || 0, games: data.games || [], error_list: data.error_list || [] }
            : e
        ));

        // Auto-refresh the cached analyses list after each sport completes
        // so the user can see new entries populating in real-time
        if (data.generated > 0) {
          loadGeneratedAnalyses();
        }
      } catch (err) {
        setPregenLiveLog(prev => prev.map(e =>
          e.sport === sport ? { ...e, status: 'error', error: err.message || 'Request failed' } : e
        ));
      }
    }

    const duration = Date.now() - startTime;
    setPregenResult({ generated: totalGenerated, skipped: totalSkipped, errors: totalErrors, duration_ms: duration });
    setPregenRunning(false);
    loadPregenLog();
    loadGeneratedAnalyses();
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
    adminFetch(`/api/admin?action=system`)
      .then(r => r.json())
      .then(d => setSysInfo(d))
      .catch(() => {});
  }

  useEffect(() => { loadSysInfo(); loadPregenLog(); loadGeneratedAnalyses(); loadAiRecord(); }, [userEmail]); // eslint-disable-line

  async function sendAnnouncement() {
    if (!announcement.trim()) return;
    setSending(true);
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'broadcast', value: announcement.trim() }),
    });
    const d = await res.json();
    if (!d.error) {
      setAnnouncement('');
      loadSysInfo(); // refresh to show new active announcement
    }
    setMsg(d.error ? `Error: ${d.error}` : '[ok] Announcement broadcast');
    setSending(false);
    setTimeout(() => setMsg(''), 5000);
  }

  async function clearAnnouncement() {
    if (!window.confirm('Clear the active announcement? It will be removed for all users.')) return;
    setClearing(true);
    const res = await adminFetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'broadcast', value: '' }),
    });
    const d = await res.json();
    if (!d.error) loadSysInfo();
    setMsg(d.error ? `Error: ${d.error}` : '[ok] Announcement cleared');
    setClearing(false);
    setTimeout(() => setMsg(''), 5000);
  }

  const activeMsg = sysInfo?.currentAnnouncement || '';
  const updatedAt = sysInfo?.announcementUpdatedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {msg && <div style={{ color: msg.startsWith('[ok]') ? '#4ade80' : '#f87171', padding: '0.5rem 0.75rem', background: msg.startsWith('[ok]') ? 'rgba(74,222,128,0.05)' : 'rgba(248,113,113,0.05)', borderRadius: '6px', fontSize: '0.8rem' }}>{msg}</div>}

      {/* ── Analyzer Pre-Generation ── */}
      <div className="card" style={{ padding: '1.2rem', borderColor: pregenRunning ? 'rgba(96,165,250,0.3)' : 'var(--border)' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          [sharp] Pre-Generate Analyses
          <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.2)', color: '#4ade80', letterSpacing: '0.07em' }}>AUTO 8AM + 4PM ET</span>
          {pregenRunning && <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '2px 6px', borderRadius: '4px', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.25)', color: '#60a5fa', letterSpacing: '0.07em', animation: 'pulse 1.5s infinite' }}>* RUNNING</span>}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '0.85rem', lineHeight: 1.5 }}>
          Generates a full BetOS AI analysis for every pre-game matchup and caches it in Supabase. Users get instant results instead of waiting 60-90s.
        </p>

        {/* Last run summary */}
        {pregenLog && !pregenRunning && (
          <div style={{ marginBottom: '0.75rem', padding: '0.55rem 0.85rem', background: 'rgba(96,165,250,0.05)', border: '1px solid rgba(96,165,250,0.12)', borderRadius: '7px', fontSize: '0.72rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ color: '#60a5fa' }}>[time] Last: <strong>{new Date(pregenLog.run_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</strong></span>
            <span style={{ color: '#4ade80' }}>[ok] {pregenLog.generated} generated</span>
            <span style={{ color: 'var(--text-muted)' }}>{'>>'} {pregenLog.skipped} skipped</span>
            {pregenLog.errors > 0 && <span style={{ color: '#f87171' }}>[!] {pregenLog.errors} errors</span>}
            <span style={{ color: 'var(--text-muted)' }}>[wait] {Math.round((pregenLog.duration_ms || 0) / 1000)}s</span>
          </div>
        )}

        {/* Live sport-by-sport progress during run */}
        {pregenLiveLog.length > 0 && (() => {
          const doneSports = pregenLiveLog.filter(e => e.status !== 'running').length;
          const totalSports = pregenLiveLog[0]?.totalSports || 5;
          const runningSport = pregenLiveLog.find(e => e.status === 'running');
          const pct = Math.round(((doneSports + (runningSport ? 0.5 : 0)) / totalSports) * 100);
          const totalGen = pregenLiveLog.reduce((s, e) => s + (e.count || 0), 0);
          return (
          <div style={{ marginBottom: '0.85rem', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '0.7rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {/* Overall progress bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '2px' }}>
              <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`, height: '100%',
                  background: pct >= 100 ? '#4ade80' : 'linear-gradient(90deg, #60a5fa, #818cf8)',
                  borderRadius: '3px',
                  transition: 'width 0.8s ease',
                }} />
              </div>
              <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.68rem', color: pct >= 100 ? '#4ade80' : '#60a5fa', minWidth: '42px', textAlign: 'right', fontWeight: 700 }}>
                {pct}%
              </span>
            </div>
            {pregenRunning && (
              <div style={{ fontSize: '0.65rem', color: '#888', display: 'flex', gap: '12px' }}>
                <span>Sport {doneSports + (runningSport ? 1 : 0)}/{totalSports}</span>
                {totalGen > 0 && <span style={{ color: '#4ade80' }}>{totalGen} cached so far</span>}
                {runningSport && <span style={{ color: '#60a5fa' }}>Processing {runningSport.sport.toUpperCase()}...</span>}
              </div>
            )}
            {/* Per-sport breakdown */}
            {pregenLiveLog.map(({ sport, status, count, skipped: sk, games, error, error_list }) => (
              <div key={sport} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.72rem' }}>
                <span style={{ width: '44px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: status === 'running' ? '#60a5fa' : '#888', fontSize: '0.65rem' }}>{sport.toUpperCase()}</span>
                {status === 'running' && <span style={{ color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', border: '2px solid #60a5fa', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} /> Generating analyses...</span>}
                {status === 'done' && count > 0 && (
                  <span style={{ color: '#4ade80' }}>[ok] {count} generated{sk > 0 ? `, ${sk} skipped` : ''}{games?.length ? ` . ${games.slice(0,3).map(g => g.split('(')[0].trim()).join(', ')}${games.length > 3 ? ` +${games.length-3}` : ''}` : ''}</span>
                )}
                {status === 'done' && count === 0 && <span style={{ color: '#555' }}>- No games found</span>}
                {status === 'skipped' && <span style={{ color: '#555' }}>- {sk > 0 ? `${sk} already cached` : 'No pre-game games'}</span>}
                {status === 'error' && <span style={{ color: '#f87171' }}>x {error?.slice(0, 80) || 'Failed'}</span>}
                {error_list?.length > 0 && <span style={{ color: '#f87171', fontSize: '0.6rem' }}> ({error_list.length} timeouts)</span>}
              </div>
            ))}
          </div>
          );
        })()}

        {/* Final result after run */}
        {pregenResult && !pregenRunning && (
          <div style={{
            padding: '0.65rem 0.85rem', borderRadius: '7px', marginBottom: '0.85rem', fontSize: '0.78rem',
            background: pregenResult.generated > 0 ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${pregenResult.generated > 0 ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.07)'}`,
          }}>
            <span style={{ color: '#4ade80', fontWeight: 700 }}>
              [ok] Done - {pregenResult.generated} generated . {pregenResult.skipped} skipped . {Math.round((pregenResult.duration_ms || 0) / 1000)}s
            </span>
            {pregenResult.error_list?.length > 0 && (
              <div style={{ color: '#f87171', marginTop: '5px', fontSize: '0.68rem' }}>
                [!] {pregenResult.error_list.slice(0, 3).join(' . ')}
              </div>
            )}
          </div>
        )}

        {(() => {
          // Use browser local time (respects user's OS timezone / profile setting)
          // instead of hardcoding ET — so "Today" matches what the user's clock says.
          const userTz   = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const localNow = new Date(new Date().toLocaleString('en-US', { timeZone: userTz }));
          const etFmt = (d) => {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
          };
          const todayET = etFmt(localNow);
          const etTom = new Date(localNow); etTom.setDate(etTom.getDate() + 1);
          const tomorrowET = etFmt(etTom);
          const labelFmt = (dateStr) => {
            const [y, m, d] = dateStr.split('-');
            return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          };
          return (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              className="btn-gold"
              onClick={() => { setAnalysesDate(todayET); loadGeneratedAnalyses(todayET); runPregenAnalysis(todayET); }}
              disabled={pregenRunning}
              style={{ opacity: pregenRunning ? 0.6 : 1 }}
            >
              {pregenRunning ? '[refresh] Running... (safe to switch tabs)' : `[sharp] Generate Today - ${labelFmt(todayET)}`}
            </button>
            <button
              onClick={() => { setAnalysesDate(tomorrowET); loadGeneratedAnalyses(tomorrowET); runPregenAnalysis(tomorrowET); }}
              disabled={pregenRunning}
              style={{
                opacity: pregenRunning ? 0.6 : 1,
                padding: '8px 14px', borderRadius: '8px', fontWeight: 700, fontSize: '0.82rem',
                border: '1px solid rgba(148,163,184,0.3)', background: 'rgba(148,163,184,0.06)',
                color: 'var(--text-secondary)', cursor: pregenRunning ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', transition: 'all 0.12s',
              }}
            >
              [date] Generate Tomorrow - {labelFmt(tomorrowET)}
            </button>
          </div>
          );
        })()}
      </div>

      {/* ── Generated Analyses Log ── */}
      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            [list] Generated Analyses
            {generatedAnalyses && (
              <span style={{ fontSize: '0.62rem', fontWeight: 600, color: generatedAnalyses.length > 0 ? '#4ade80' : '#555', background: generatedAnalyses.length > 0 ? 'rgba(74,222,128,0.1)' : 'rgba(255,255,255,0.04)', border: `1px solid ${generatedAnalyses.length > 0 ? 'rgba(74,222,128,0.25)' : 'var(--border)'}`, borderRadius: '4px', padding: '2px 7px' }}>
                {generatedAnalyses.length} cached
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* Prev day */}
            <button
              onClick={() => {
                const d = new Date(analysesDate + 'T12:00:00');
                d.setDate(d.getDate() - 1);
                const s = d.toISOString().split('T')[0];
                setAnalysesDate(s); loadGeneratedAnalyses(s);
              }}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 9px', fontSize: '0.78rem', lineHeight: 1 }}
            >{'<'}</button>
            {/* Date label - clicking opens the date input */}
            <label style={{ position: 'relative', cursor: 'pointer' }}>
              <span style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: '5px',
                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: '0.72rem', fontWeight: 600,
                fontFamily: 'IBM Plex Mono, monospace', userSelect: 'none',
              }}>
                {(() => {
                  const [y, m, d] = analysesDate.split('-');
                  return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                })()}
              </span>
              <input
                type="date"
                value={analysesDate}
                onChange={e => { setAnalysesDate(e.target.value); loadGeneratedAnalyses(e.target.value); }}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%' }}
              />
            </label>
            {/* Next day */}
            <button
              onClick={() => {
                const d = new Date(analysesDate + 'T12:00:00');
                d.setDate(d.getDate() + 1);
                const s = d.toISOString().split('T')[0];
                setAnalysesDate(s); loadGeneratedAnalyses(s);
              }}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 9px', fontSize: '0.78rem', lineHeight: 1 }}
            >{'>'}</button>
            {/* Refresh */}
            <button
              onClick={() => loadGeneratedAnalyses()}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '5px', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 9px', fontSize: '0.78rem' }}
            >[refresh]</button>
          </div>
        </div>

        {/* ── AI Prediction Record ── */}
        {aiRecord && (aiRecord.wins > 0 || aiRecord.losses > 0) && (
          <div style={{ marginBottom: '0.85rem', padding: '10px 14px', background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.18)', borderRadius: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 800, color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>[AI] AI Record</span>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {aiRecord.wins}W - {aiRecord.losses}L{aiRecord.pushes > 0 ? ` - ${aiRecord.pushes}P` : ''}
              </span>
              {aiRecord.winPct !== null && (
                <span style={{
                  fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.8rem', fontWeight: 800,
                  color: aiRecord.winPct >= 55 ? '#4ade80' : aiRecord.winPct >= 45 ? '#FFB800' : '#f87171',
                }}>
                  {aiRecord.winPct}%
                </span>
              )}
            </div>
            {/* Breakdown by confidence */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {['ELITE','HIGH','MEDIUM','LOW'].map(c => {
                const s = aiRecord.byConf?.[c];
                if (!s || (s.wins + s.losses + s.pushes) === 0) return null;
                const total = s.wins + s.losses;
                const pct = total > 0 ? Math.round((s.wins / total) * 100) : null;
                const col = { ELITE: '#00D48B', HIGH: '#4ade80', MEDIUM: '#FFB800', LOW: '#888' }[c];
                return (
                  <span key={c} style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '4px', background: `${col}14`, border: `1px solid ${col}35`, color: col, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700 }}>
                    {c} {s.wins}-{s.losses}{s.pushes > 0 ? `-${s.pushes}P` : ''}{pct !== null ? ` (${pct}%)` : ''}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {generatedAnalyses === null && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Loading...</div>
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
              const graded = a.prediction_result;
              const isGrading = gradingId === a.id;

              // Grade button helper
              const GradeBtn = ({ result, label, color }) => {
                const isActive = graded === result;
                return (
                  <button
                    onClick={e => { e.stopPropagation(); gradeAnalysis(a.id, isActive ? null : result); }}
                    disabled={isGrading}
                    title={isActive ? `Clear grade (currently ${result})` : `Mark as ${result}`}
                    style={{
                      padding: '2px 7px', borderRadius: '4px', fontSize: '0.6rem', fontWeight: 700,
                      border: `1px solid ${isActive ? color : 'rgba(255,255,255,0.1)'}`,
                      background: isActive ? `${color}22` : 'transparent',
                      color: isActive ? color : 'rgba(255,255,255,0.25)',
                      cursor: isGrading ? 'wait' : 'pointer',
                      transition: 'all 0.15s',
                      flexShrink: 0,
                    }}
                  >{label}</button>
                );
              };

              return (
                <div key={a.id} style={{ border: `1px solid ${graded === 'WIN' ? 'rgba(74,222,128,0.2)' : graded === 'LOSS' ? 'rgba(248,113,113,0.2)' : graded === 'PUSH' ? 'rgba(148,163,184,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: '8px', overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', background: isOpen ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)' }}>
                    <button
                      onClick={() => setExpandedAnalysis(isOpen ? null : a.id)}
                      style={{
                        flex: 1, background: 'none',
                        border: 'none', cursor: 'pointer', padding: '8px 12px',
                        display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left',
                        minWidth: 0,
                      }}
                    >
                      <span style={{ fontSize: '0.6rem', fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, color: '#60a5fa', minWidth: '30px' }}>{a.sport.toUpperCase()}</span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-primary)', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.away_team} @ {a.home_team}
                      </span>
                      {conf && (
                        <span style={{ fontSize: '0.58rem', fontWeight: 700, color: confColor, background: `${confColor}18`, border: `1px solid ${confColor}40`, borderRadius: '4px', padding: '1px 6px', flexShrink: 0 }}>{conf}</span>
                      )}
                      <span style={{ fontSize: '0.62rem', color: '#444', flexShrink: 0 }}>{ageLabel}</span>
                    </button>

                    {/* Grade buttons - always visible inline */}
                    <div style={{ display: 'flex', gap: '4px', padding: '0 8px', alignItems: 'center', flexShrink: 0 }}>
                      <GradeBtn result="WIN"  label="W" color="#4ade80" />
                      <GradeBtn result="LOSS" label="L" color="#f87171" />
                      <GradeBtn result="PUSH" label="P" color="#94a3b8" />
                    </div>

                    <button
                      onClick={() => setExpandedAnalysis(isOpen ? null : a.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 10px', color: '#444', fontSize: '0.65rem', flexShrink: 0 }}
                    >{isOpen ? '^' : 'v'}</button>
                  </div>

                  {isOpen && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '10px 12px', background: 'rgba(0,0,0,0.25)' }}>
                      {pickLine && (
                        <div style={{ marginBottom: '8px', padding: '6px 10px', background: 'rgba(255,184,0,0.07)', border: '1px solid rgba(255,184,0,0.2)', borderRadius: '6px', fontSize: '0.75rem', color: '#FFB800', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                          <span>[target] {pickLine}</span>
                          {graded && (
                            <span style={{
                              fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: '4px', flexShrink: 0,
                              color: graded === 'WIN' ? '#4ade80' : graded === 'LOSS' ? '#f87171' : '#94a3b8',
                              background: graded === 'WIN' ? 'rgba(74,222,128,0.12)' : graded === 'LOSS' ? 'rgba(248,113,113,0.12)' : 'rgba(148,163,184,0.12)',
                              border: `1px solid ${graded === 'WIN' ? 'rgba(74,222,128,0.3)' : graded === 'LOSS' ? 'rgba(248,113,113,0.3)' : 'rgba(148,163,184,0.3)'}`,
                            }}>
                              {graded === 'WIN' ? '[ok] WIN' : graded === 'LOSS' ? 'x LOSS' : '~ PUSH'}
                            </span>
                          )}
                        </div>
                      )}
                      <pre style={{ fontSize: '0.68rem', color: '#999', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, maxHeight: '300px', overflowY: 'auto' }}>
                        {a.analysis}
                      </pre>
                      <div style={{ marginTop: '8px', fontSize: '0.6rem', color: '#333', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>Generated: {new Date(a.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                        <span>Model: {a.model}</span>
                        {graded && <span style={{ color: graded === 'WIN' ? '#4ade80' : graded === 'LOSS' ? '#f87171' : '#94a3b8' }}>Graded: {graded}</span>}
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
          [!] Site Announcement
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
                {clearing ? 'Clearing...' : '[del] Clear'}
              </button>
            </div>
            <button
              onClick={() => setAnnouncement(activeMsg)}
              style={{ marginTop: '0.6rem', background: 'none', border: 'none', color: 'var(--gold)', fontSize: '0.7rem', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
            >
              [edit] Edit this message
            </button>
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
            No active announcement. Compose one below - it will appear as a banner for all users.
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
              {sending ? 'Sending...' : activeMsg ? '[!] Replace Announcement' : '[!] Broadcast Announcement'}
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

      {/* ── Admin Tools ── */}
      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>[?] Admin Tools</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={handleBackfill}
            disabled={backfillRunning}
            style={{ padding: '6px 14px', borderRadius: '6px', cursor: backfillRunning ? 'wait' : 'pointer', fontSize: '0.75rem', fontWeight: 700, border: '1px solid rgba(20,184,166,0.35)', background: 'rgba(20,184,166,0.07)', color: '#14b8a6', opacity: backfillRunning ? 0.6 : 1 }}
          >
            {backfillRunning ? '[refresh] Running...' : '[time] Backfill Commence Times'}
          </button>
          <button
            onClick={handleAutoGrade}
            disabled={autoGradeRunning}
            style={{ padding: '6px 14px', borderRadius: '6px', cursor: autoGradeRunning ? 'wait' : 'pointer', fontSize: '0.75rem', fontWeight: 700, border: '1px solid rgba(96,165,250,0.35)', background: 'rgba(96,165,250,0.07)', color: '#60a5fa', opacity: autoGradeRunning ? 0.6 : 1 }}
          >
            {autoGradeRunning ? '[refresh] Grading...' : '[AI] Auto-Grade AI Picks'}
          </button>
        </div>
        {backfillMsg && (
          <div style={{ marginTop: '8px', fontSize: '0.72rem', color: backfillMsg.startsWith('[ok]') ? '#4ade80' : backfillMsg.startsWith('Error') ? '#f87171' : '#60a5fa', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            {backfillMsg}
          </div>
        )}
        {autoGradeMsg && (
          <div style={{ marginTop: '8px', fontSize: '0.72rem', color: autoGradeMsg.startsWith('[ok]') ? '#4ade80' : autoGradeMsg.startsWith('Error') ? '#f87171' : '#60a5fa', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.06)' }}>
            {autoGradeMsg}
          </div>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: '0.65rem', marginTop: '6px', lineHeight: 1.5 }}>
          <strong>Backfill</strong> looks up ESPN game start times for all picks missing commence_time (enables verified pick status). <strong>Auto-Grade</strong> checks ESPN final scores and grades all ungraded AI analysis picks automatically.
        </p>
      </div>

      <div className="card" style={{ padding: '1.2rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>[fix] System Info</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
          {[
            { label: 'Admin Email', value: ADMIN_EMAILS.join(', ') || user?.email || '-' },
            { label: 'Environment', value: sysInfo ? sysInfo.environment : '...' },
            {
              label: 'Service Role',
              value: sysInfo === null ? '...' : (sysInfo.serviceRole ? '[ok] Configured' : 'x Missing (limited access)'),
              color: sysInfo === null ? undefined : (sysInfo.serviceRole ? '#4ade80' : '#f87171'),
            },
            { label: 'Supabase URL', value: sysInfo ? sysInfo.supabaseUrl : '...' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ padding: '0.65rem 0.85rem', background: 'var(--bg-elevated)', borderRadius: '8px', border: '1px solid var(--border)' }}>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>{label}</div>
              <div style={{ color: color || 'var(--text-secondary)', fontSize: '0.78rem', fontFamily: 'IBM Plex Mono, monospace' }}>{value}</div>
            </div>
          ))}
        </div>
        {sysInfo && !sysInfo.serviceRole && (
          <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.15)', borderRadius: '7px', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--gold)' }}>[i] To unlock full admin access</strong> - add <code style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: '3px' }}>SUPABASE_SERVICE_ROLE_KEY</code> to your Vercel environment variables (for production) or <code>.env.local</code> (for local dev). This grants the admin panel access to all rows regardless of RLS policies.
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN ADMIN TAB ────────────────────────────────────────────────────────────
// ── AI CHAT PANEL ─────────────────────────────────────────────────────────────
function AIChatPanel({ userEmail }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hey! Ask me anything about the app - bugs, data, features, code, or anything BetOS-related.' }
  ]);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const messagesEndRef         = React.useRef(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const newMessages = [...messages, { role: 'user', content: text }];
    setMessages(newMessages);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/admin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages, userEmail }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply, model: data.model, provider: data.provider }]);
    } catch (e) {
      setError(e.message);
      // Remove the optimistically-added user message so they can retry
      setMessages(prev => prev.slice(0, -1));
      setInput(text);
    }
    setLoading(false);
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function clearChat() {
    setMessages([{ role: 'assistant', content: 'Chat cleared. What do you need?' }]);
    setError('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Message thread */}
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '12px',
        padding: '1rem', minHeight: '380px', maxHeight: '520px', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: '0.75rem',
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex', flexDirection: 'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '80%',
              background: msg.role === 'user' ? 'rgba(255,184,0,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${msg.role === 'user' ? 'rgba(255,184,0,0.25)' : 'var(--border)'}`,
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              padding: '0.65rem 0.9rem',
              fontSize: '0.85rem',
              color: 'var(--text-primary)',
              lineHeight: '1.55',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>
            {msg.role === 'assistant' && msg.model && (
              <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', marginTop: '3px', paddingLeft: '2px' }}>
                {msg.provider === 'xai' ? '[sharp] Grok' : '[AI] Claude'} . {msg.model}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
              borderRadius: '12px 12px 12px 2px', padding: '0.65rem 0.9rem',
            }}>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                {[0,1,2].map(d => (
                  <div key={d} style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: 'var(--text-muted)',
                    animation: 'pulse 1.2s ease-in-out infinite',
                    animationDelay: `${d * 0.2}s`,
                  }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div style={{
            background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.2)',
            borderRadius: '8px', padding: '0.6rem 0.8rem', fontSize: '0.8rem', color: '#f87171',
          }}>
            [!] {error} - message restored above, try again.
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input row */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask about bugs, users, data, code... (Enter to send, Shift+Enter for newline)"
          rows={2}
          style={{
            flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: '8px', color: 'var(--text-primary)', padding: '0.65rem 0.85rem',
            fontSize: '0.85rem', resize: 'none', fontFamily: 'inherit', lineHeight: '1.45',
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            style={{
              padding: '0.6rem 1.1rem', borderRadius: '8px', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
              background: loading || !input.trim() ? 'rgba(255,184,0,0.1)' : 'rgba(255,184,0,0.15)',
              border: '1px solid rgba(255,184,0,0.35)', color: loading || !input.trim() ? 'rgba(255,184,0,0.4)' : 'var(--gold)',
              fontWeight: 700, fontSize: '0.82rem', transition: 'all 0.12s', whiteSpace: 'nowrap',
            }}
          >
            {loading ? '...' : 'Send '}
          </button>
          <button
            onClick={clearChat}
            style={{
              padding: '0.4rem 0.6rem', borderRadius: '8px', cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-muted)', fontSize: '0.72rem', transition: 'all 0.12s',
            }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AI Error Queue Panel ──────────────────────────────────────────────────────
function AIErrorQueuePanel({ userEmail }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('unresolved'); // all | unresolved | resolved
  const [actionMsg, setActionMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    adminFetch('/api/admin?action=ai_errors')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolve(id) {
    await adminFetch('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'resolve_ai_error', targetId: id }),
    });
    setActionMsg('[ok] Marked resolved');
    load();
    setTimeout(() => setActionMsg(''), 3000);
  }

  const errors = (data?.errors || []).filter(e => {
    if (filter === 'unresolved') return !e.resolved;
    if (filter === 'resolved')   return e.resolved;
    return true;
  });

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading AI error queue...</div>;

  return (
    <div>
      {actionMsg && <div style={{ color: '#4ade80', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{actionMsg}</div>}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', alignItems: 'center' }}>
        {[['unresolved','[rec] Unresolved'],['resolved','[ok] Resolved'],['all','All']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
            border: `1px solid ${filter === v ? '#f87171' : 'var(--border)'}`,
            background: filter === v ? 'rgba(248,113,113,0.08)' : 'transparent',
            color: filter === v ? '#f87171' : 'var(--text-muted)', fontWeight: filter === v ? 700 : 400,
          }}>{l}</button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{errors.length} error{errors.length !== 1 ? 's' : ''}</span>
        <button onClick={load} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 8px', fontSize: '0.72rem' }}>[refresh]</button>
      </div>

      {errors.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>[ok]</div>
          <div>{filter === 'unresolved' ? 'No unresolved AI errors - great shape!' : 'No errors in this filter.'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {errors.map(e => {
            let pickData = null;
            try { pickData = e.pick_data ? JSON.parse(e.pick_data) : null; } catch {}
            return (
              <div key={e.id} style={{
                background: 'var(--bg-elevated)', border: `1px solid ${e.resolved ? 'rgba(74,222,128,0.15)' : 'rgba(248,113,113,0.25)'}`,
                borderRadius: '10px', padding: '1rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.72rem', fontFamily: 'IBM Plex Mono, monospace', color: 'var(--text-muted)' }}>
                        {new Date(e.created_at).toLocaleString()}
                      </span>
                      {e.resolved && <span style={{ fontSize: '0.65rem', color: '#4ade80', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '4px', padding: '1px 6px' }}>RESOLVED</span>}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#f87171', fontWeight: 600, marginBottom: '6px' }}>
                      [!] {e.error_message}
                    </div>
                    {pickData && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', padding: '6px 8px', marginBottom: '6px', fontFamily: 'IBM Plex Mono, monospace' }}>
                        Pick: {pickData.team} . {pickData.bet_type} . {pickData.odds > 0 ? '+' : ''}{pickData.odds} . {pickData.sport}
                      </div>
                    )}
                    {e.ai_diagnosis && (
                      <div style={{ fontSize: '0.78rem', color: '#fbbf24', background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: '6px', padding: '6px 8px' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '6px' }}>[AI] AI Diagnosis:</span>
                        {e.ai_diagnosis}
                      </div>
                    )}
                  </div>
                  {!e.resolved && (
                    <button
                      onClick={() => resolve(e.id)}
                      style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', border: 'none', background: 'rgba(74,222,128,0.12)', color: '#4ade80', flexShrink: 0 }}
                    >
                      [ok] Resolve
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Concerns Panel (AI chatbot-flagged issues) ────────────────────────────────
function ConcernsPanel({ userEmail }) {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('unresolved');
  const [actionMsg, setActionMsg] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    adminFetch('/api/admin?action=concerns')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolve(id) {
    await adminFetch('/api/admin', {
      method: 'POST',
      body: JSON.stringify({ action: 'resolve_concern', targetId: id }),
    });
    setActionMsg('[ok] Marked resolved');
    load();
    setTimeout(() => setActionMsg(''), 3000);
  }

  const concerns = (data?.concerns || []).filter(c => {
    if (filter === 'unresolved') return !c.resolved;
    if (filter === 'resolved')   return c.resolved;
    return true;
  });

  if (loading) return <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>Loading concerns...</div>;

  return (
    <div>
      {actionMsg && <div style={{ color: '#4ade80', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{actionMsg}</div>}

      <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.15)', borderRadius: '7px', marginBottom: '1rem', fontSize: '0.75rem', color: '#888' }}>
        <span style={{ color: '#fbbf24', fontWeight: 700 }}>[!] Serious Concerns</span> - these are issues the AI chatbot determined were significant enough to escalate to admin review. Review each one and mark resolved when handled.
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem', alignItems: 'center' }}>
        {[['unresolved','[!] Unresolved'],['resolved','[ok] Resolved'],['all','All']].map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)} style={{
            padding: '4px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
            border: `1px solid ${filter === v ? '#fbbf24' : 'var(--border)'}`,
            background: filter === v ? 'rgba(251,191,36,0.08)' : 'transparent',
            color: filter === v ? '#fbbf24' : 'var(--text-muted)', fontWeight: filter === v ? 700 : 400,
          }}>{l}</button>
        ))}
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '0.75rem' }}>{concerns.length} concern{concerns.length !== 1 ? 's' : ''}</span>
        <button onClick={load} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-muted)', cursor: 'pointer', padding: '3px 8px', fontSize: '0.72rem' }}>[refresh]</button>
      </div>

      {concerns.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>[ok]</div>
          <div>{filter === 'unresolved' ? 'No unresolved concerns.' : 'No concerns in this filter.'}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {concerns.map(c => (
            <div key={c.id} style={{
              background: 'var(--bg-elevated)', border: `1px solid ${c.resolved ? 'rgba(74,222,128,0.15)' : 'rgba(251,191,36,0.25)'}`,
              borderRadius: '10px', padding: '1rem',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
                    {c.username && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)' }}>{c.username}</span>}
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', padding: '1px 6px' }}>{c.source || 'chatbot'}</span>
                    <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono, monospace' }}>{new Date(c.created_at).toLocaleString()}</span>
                    {c.resolved && <span style={{ fontSize: '0.65rem', color: '#4ade80', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '4px', padding: '1px 6px' }}>RESOLVED</span>}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>{c.message}</div>
                </div>
                {!c.resolved && (
                  <button
                    onClick={() => resolve(c.id)}
                    style={{ padding: '5px 12px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', border: 'none', background: 'rgba(74,222,128,0.12)', color: '#4ade80', flexShrink: 0 }}
                  >
                    [ok] Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Flags Panel: AI Errors + Concerns merged ─────────────────────────────────
function FlagsPanel({ userEmail }) {
  const [sub, setSub] = useState('ai_errors');
  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.6rem' }}>
        {[
          { id: 'ai_errors', label: '[rec] AI Errors' },
          { id: 'concerns',  label: '[!] Concerns' },
        ].map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            style={{ padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', border: `1px solid ${sub === t.id ? 'rgba(255,184,0,0.5)' : 'var(--border)'}`, background: sub === t.id ? 'rgba(255,184,0,0.08)' : 'transparent', color: sub === t.id ? 'var(--gold)' : 'var(--text-muted)', fontWeight: sub === t.id ? 700 : 400 }}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'ai_errors' && <AIErrorQueuePanel userEmail={userEmail} />}
      {sub === 'concerns'  && <ConcernsPanel     userEmail={userEmail} />}
    </div>
  );
}

// ── AI Tools Panel: Backtester + AI Lab merged ────────────────────────────────
function AIToolsPanel({ userEmail }) {
  const [sub, setSub] = useState('ailab');
  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.6rem' }}>
        {[
          { id: 'ailab',    label: '[test] AI Lab' },
          { id: 'backtest', label: '[up] Backtester' },
        ].map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            style={{ padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', border: `1px solid ${sub === t.id ? 'rgba(255,184,0,0.5)' : 'var(--border)'}`, background: sub === t.id ? 'rgba(255,184,0,0.08)' : 'transparent', color: sub === t.id ? 'var(--gold)' : 'var(--text-muted)', fontWeight: sub === t.id ? 700 : 400 }}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'ailab'    && <AILabPanel    userEmail={userEmail} />}
      {sub === 'backtest' && <BacktestPanel userEmail={userEmail} />}
    </div>
  );
}

// ── System Panel: Cron + Settings + AI Chat merged ────────────────────────────
function SystemMegaPanel({ userEmail }) {
  const [sub, setSub] = useState('system');
  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.6rem' }}>
        {[
          { id: 'system', label: '⚙ Settings' },
          { id: 'cron',   label: '[time] Cron Jobs' },
          { id: 'chat',   label: '[AI] AI Chat' },
        ].map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            style={{ padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', border: `1px solid ${sub === t.id ? 'rgba(255,184,0,0.5)' : 'var(--border)'}`, background: sub === t.id ? 'rgba(255,184,0,0.08)' : 'transparent', color: sub === t.id ? 'var(--gold)' : 'var(--text-muted)', fontWeight: sub === t.id ? 700 : 400 }}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'system' && <SystemPanel userEmail={userEmail} />}
      {sub === 'cron'   && <CronPanel   userEmail={userEmail} />}
      {sub === 'chat'   && <AIChatPanel userEmail={userEmail} />}
    </div>
  );
}

// ── Users+Activity Panel ──────────────────────────────────────────────────────
function UsersMegaPanel({ userEmail }) {
  const [sub, setSub] = useState('users');
  return (
    <div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.6rem' }}>
        {[
          { id: 'users',    label: '[users] Accounts' },
          { id: 'activity', label: '[live] Activity' },
        ].map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            style={{ padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', border: `1px solid ${sub === t.id ? 'rgba(255,184,0,0.5)' : 'var(--border)'}`, background: sub === t.id ? 'rgba(255,184,0,0.08)' : 'transparent', color: sub === t.id ? 'var(--gold)' : 'var(--text-muted)', fontWeight: sub === t.id ? 700 : 400 }}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'users'    && <UsersPanel    userEmail={userEmail} onNavigate={() => {}} />}
      {sub === 'activity' && <ActivityPanel userEmail={userEmail} />}
    </div>
  );
}

// ── Chat Room Admin Panel ─────────────────────────────────────────────────────
function ChatRoomAdminPanel({ userEmail }) {
  const [settings, setSettings]   = useState({});
  const [mods, setMods]           = useState([]);
  const [bans, setBans]           = useState([]);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [sub, setSub]             = useState('settings');
  const [promoteId, setPromoteId] = useState('');
  const [xpUserId, setXpUserId]   = useState('');
  const [xpAmount, setXpAmount]   = useState('');

  const adminFetch = useCallback(async (url, opts = {}) => {
    const { data: { session } } = await import('@/lib/supabase').then(m => m.supabase.auth.getSession());
    // Use imported supabase directly
    const s = await import('@/lib/supabase').then(m => m.supabase);
    const { data: { session: sess } } = await s.auth.getSession();
    const token = sess?.access_token;
    if (!token) return null;
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) } });
    return res.json().catch(() => null);
  }, []);

  const load = useCallback(async () => {
    try {
      const [sRes, mRes, bRes] = await Promise.all([
        fetch('/api/admin?action=chat_settings').then(r => r.json()),
        fetch('/api/admin?action=chat_mods').then(r => r.json()),
        fetch('/api/admin?action=chat_bans').then(r => r.json()),
      ]);
      if (sRes?.settings) setSettings(sRes.settings);
      if (mRes?.mods)     setMods(mRes.mods);
      if (bRes?.bans)     setBans(bRes.bans);
    } catch { /* non-critical */ }
  }, []);

  // Use adminFetch from AdminTab's helper approach
  const doAdminPost = useCallback(async (body) => {
    // Get token via supabase client
    const { createClient } = await import('@supabase/supabase-js');
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const { data: { session } } = await s.auth.getSession();
    const token = session?.access_token;
    if (!token) return null;
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.json().catch(() => null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSettings = async () => {
    setSaving(true);
    await doAdminPost({ action: 'update_chat_settings', settings });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const unban = async (userId) => {
    await doAdminPost({ action: 'chat_unban', targetUserId: userId });
    setBans(b => b.filter(x => x.user_id !== userId));
  };

  const demoteMod = async (userId) => {
    await doAdminPost({ action: 'chat_demote_mod', targetUserId: userId });
    setMods(m => m.filter(x => x.user_id !== userId));
  };

  const promoteMod = async () => {
    if (!promoteId.trim()) return;
    await doAdminPost({ action: 'chat_promote_mod', targetUserId: promoteId.trim() });
    setPromoteId(''); load();
  };

  const awardXp = async () => {
    if (!xpUserId.trim() || !xpAmount) return;
    const res = await doAdminPost({ action: 'award_xp', targetUserId: xpUserId.trim(), amount: parseInt(xpAmount) });
    if (res?.ok) { alert(`XP awarded! New total: ${res.newXp} (${res.rank})`); setXpUserId(''); setXpAmount(''); }
  };

  const fieldStyle = { width: '100%', boxSizing: 'border-box', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', color: 'var(--text-primary)', fontSize: '0.8rem' };
  const labelStyle = { fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block', marginBottom: '4px' };
  const rowStyle   = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' };

  return (
    <div>
      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.6rem', flexWrap: 'wrap' }}>
        {[
          { id: 'settings', label: '⚙ Settings' },
          { id: 'mods',     label: ` Mods (${mods.length})` },
          { id: 'bans',     label: `[X] Bans (${bans.length})` },
          { id: 'xp',       label: '⭐ XP / Ranks' },
        ].map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            style={{ padding: '5px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.78rem', border: `1px solid ${sub === t.id ? 'rgba(255,184,0,0.5)' : 'var(--border)'}`, background: sub === t.id ? 'rgba(255,184,0,0.08)' : 'transparent', color: sub === t.id ? 'var(--gold)' : 'var(--text-muted)', fontWeight: sub === t.id ? 700 : 400 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Settings */}
      {sub === 'settings' && (
        <div style={{ maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '0' }}>
          <div style={{ ...rowStyle }}>
            <div><div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>Chat enabled</div><div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Globally enable or disable the chat room</div></div>
            <input type="checkbox" checked={settings.chat_enabled === 'true'} onChange={e => setSettings(s => ({ ...s, chat_enabled: e.target.checked ? 'true' : 'false' }))} style={{ accentColor: 'var(--gold)', width: '17px', height: '17px', cursor: 'pointer' }} />
          </div>
          <div style={{ ...rowStyle }}>
            <div><div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>Require email verified</div><div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Block unverified accounts from chatting</div></div>
            <input type="checkbox" checked={settings.require_email_verified === 'true'} onChange={e => setSettings(s => ({ ...s, require_email_verified: e.target.checked ? 'true' : 'false' }))} style={{ accentColor: 'var(--gold)', width: '17px', height: '17px', cursor: 'pointer' }} />
          </div>
          <div style={{ ...rowStyle }}>
            <div><div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>Minimum XP to chat</div><div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>0 = anyone can chat. Raise to require activity first</div></div>
            <input type="number" min="0" max="10000" value={settings.min_xp_to_chat || '0'} onChange={e => setSettings(s => ({ ...s, min_xp_to_chat: e.target.value }))} style={{ width: '80px', ...fieldStyle, padding: '4px 8px' }} />
          </div>
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <div><div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>Max message length</div><div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Characters per message (50-2000)</div></div>
            <input type="number" min="50" max="2000" value={settings.max_message_length || '500'} onChange={e => setSettings(s => ({ ...s, max_message_length: e.target.value }))} style={{ width: '80px', ...fieldStyle, padding: '4px 8px' }} />
          </div>
          <button onClick={saveSettings} disabled={saving}
            style={{ marginTop: '1rem', padding: '8px 20px', borderRadius: '8px', background: saved ? 'rgba(74,222,128,0.2)' : 'rgba(255,184,0,0.18)', border: `1px solid ${saved ? 'rgba(74,222,128,0.5)' : 'rgba(255,184,0,0.4)'}`, color: saved ? '#4ade80' : 'var(--gold)', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', alignSelf: 'flex-start' }}>
            {saved ? '[ok] Saved' : saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}

      {/* Mods */}
      {sub === 'mods' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
            <input value={promoteId} onChange={e => setPromoteId(e.target.value)} placeholder="User UUID to promote..." style={{ ...fieldStyle, flex: 1 }} />
            <button onClick={promoteMod} style={{ padding: '6px 14px', borderRadius: '6px', background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
              + Promote
            </button>
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Tip: Get a user's UUID from the Users tab. Mods can delete messages, mute, and chat-ban users.</div>
          {mods.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '1rem', textAlign: 'center' }}>No moderators yet.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {mods.map(m => (
              <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                <span style={{ fontSize: '1.1rem' }}>{m.profiles?.avatar_emoji || '[user]'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>{m.profiles?.display_name || m.profiles?.username || 'Unknown'}</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>{m.user_id}</div>
                </div>
                <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)', color: '#a78bfa', fontWeight: 700 }}>{m.profiles?.rank_title || 'Degenerate'}</span>
                <button onClick={() => demoteMod(m.user_id)} style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: '5px', color: '#f87171', cursor: 'pointer', padding: '3px 8px', fontSize: '0.72rem', fontWeight: 600 }}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bans */}
      {sub === 'bans' && (
        <div>
          {bans.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', padding: '1rem', textAlign: 'center' }}>No active chat bans.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {bans.map(b => (
              <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: 'var(--bg-elevated)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '8px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>{b.profiles?.display_name || b.profiles?.username}</div>
                  {b.reason && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>"{b.reason}"</div>}
                  <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>{b.user_id}</div>
                </div>
                <button onClick={() => unban(b.user_id)} style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: '5px', color: '#4ade80', cursor: 'pointer', padding: '3px 10px', fontSize: '0.72rem', fontWeight: 600 }}>Unban</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* XP & Ranks */}
      {sub === 'xp' && (
        <div style={{ maxWidth: '520px' }}>
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Award / Deduct XP</div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input value={xpUserId} onChange={e => setXpUserId(e.target.value)} placeholder="User UUID..." style={{ ...fieldStyle, flex: 1 }} />
              <input type="number" value={xpAmount} onChange={e => setXpAmount(e.target.value)} placeholder="+/-XP" style={{ ...fieldStyle, width: '80px' }} />
              <button onClick={awardXp} style={{ padding: '6px 14px', borderRadius: '6px', background: 'rgba(255,184,0,0.15)', border: '1px solid rgba(255,184,0,0.4)', color: 'var(--gold)', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Award</button>
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '5px' }}>Use negative values to deduct. Rank title updates automatically.</div>
          </div>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--text-primary)' }}>Rank Tiers</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {[
              { title: 'Degenerate',   minXp: 0,     emoji: '[bet]', color: '#888' },
              { title: 'Square',       minXp: 100,   emoji: '[target]', color: '#a78bfa' },
              { title: 'Handicapper',  minXp: 300,   emoji: '[stats]', color: '#60a5fa' },
              { title: 'Sharp',        minXp: 700,   emoji: '[sharp]', color: '#34d399' },
              { title: 'Steam Chaser', minXp: 1500,  emoji: '[fire]', color: '#fb923c' },
              { title: 'Wiseguy',      minXp: 3000,  emoji: '[vibe]', color: '#f472b6' },
              { title: 'Line Mover',   minXp: 6000,  emoji: '[up]', color: '#facc15' },
              { title: 'Syndicate',    minXp: 10000, emoji: '[gem]', color: '#38bdf8' },
              { title: 'Whale',        minXp: 20000, emoji: '[whale]', color: '#c084fc' },
              { title: 'Legend',       minXp: 40000, emoji: '[crown]', color: '#FFB800' },
            ].map(r => (
              <div key={r.title} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px', background: 'var(--bg-elevated)', border: `1px solid ${r.color}22`, borderRadius: '6px' }}>
                <span style={{ fontSize: '1rem' }}>{r.emoji}</span>
                <span style={{ fontWeight: 700, fontSize: '0.82rem', color: r.color, flex: 1 }}>{r.title}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>{r.minXp.toLocaleString()}+ XP</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: '1rem', padding: '10px 12px', background: 'rgba(255,184,0,0.05)', border: '1px solid rgba(255,184,0,0.15)', borderRadius: '8px', fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--gold)' }}>How users earn XP:</strong> +1 XP per day for chatting . +5 XP per pick submitted . +20 XP per WIN . +3 XP per PUSH . XP is automatically calculated and rank title updates on each action.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Consolidated tab definitions ──────────────────────────────────────────────
const ADMIN_TABS = [
  { id: 'overview', label: '[stats] Overview',  desc: 'Site-wide stats, leaderboard, and recent sign-ups' },
  { id: 'users',    label: '[users] Users',     desc: 'Manage accounts, roles, bans, and view activity' },
  { id: 'picks',    label: '[list] Picks',     desc: 'Audit and moderate all user picks' },
  { id: 'contests', label: '[trophy] Contests',  desc: 'Active contests and participants' },
  { id: 'chat',     label: '[chat] Chat Room', desc: 'Chat settings, mods, bans, and XP/rank management' },
  { id: 'flags',    label: '[!] Flags',     desc: 'AI analysis errors and chatbot-escalated concerns' },
  { id: 'aitools',  label: '[test] AI Tools',  desc: 'AI Lab performance tracker and historical backtester' },
  { id: 'system',   label: '⚙ System',   desc: 'Site settings, scheduled jobs, and AI chat console' },
];

export default function AdminTab({ user }) {
  const [active, setActive] = useState('overview');
  // Track which panels have been visited — lazy-mount then keep alive.
  // A panel is mounted on first visit and never unmounted again, so any
  // in-flight API call (pre-gen, grading, etc.) continues even if the
  // admin clicks to a different panel mid-run.
  const [everMounted, setEverMounted] = React.useState(() => new Set(['overview']));

  const isAdmin = ADMIN_EMAILS.length > 0
    ? ADMIN_EMAILS.includes(user?.email?.toLowerCase())
    : true;

  if (!isAdmin) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem 2rem', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>[X]</div>
        <div style={{ fontWeight: 700, color: 'var(--text-secondary)', fontSize: '1.1rem', marginBottom: '8px' }}>Access Denied</div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>This panel is restricted to admins only.</div>
      </div>
    );
  }

  // Mark panel as ever-mounted whenever the user navigates to it
  React.useEffect(() => {
    setEverMounted(prev => {
      if (prev.has(active)) return prev;
      const next = new Set(prev);
      next.add(active);
      return next;
    });
  }, [active]);

  const desc = ADMIN_TABS.find(t => t.id === active)?.desc;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: '1.4rem', color: 'var(--gold)', margin: 0 }}> Admin Panel</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '3px 0 0' }}>
            Signed in as <strong style={{ color: 'var(--text-secondary)' }}>{user?.email}</strong>
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Badge label="ADMIN" color="#fbbf24" bg="rgba(251,191,36,0.1)" border="rgba(251,191,36,0.2)" />
        </div>
      </div>

      {/* Tab nav - compact, grouped feel */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px', padding: '6px' }}>
        {ADMIN_TABS.map(t => (
          <button key={t.id} onClick={() => setActive(t.id)}
            style={{
              padding: '6px 12px', borderRadius: '7px', cursor: 'pointer', fontSize: '0.8rem',
              border: 'none',
              background: active === t.id ? 'rgba(255,184,0,0.14)' : 'transparent',
              color: active === t.id ? 'var(--gold)' : 'var(--text-muted)',
              fontWeight: active === t.id ? 700 : 400,
              transition: 'all 0.12s',
            }}>
            {t.label}
          </button>
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: '-0.5rem 0 0' }}>{desc}</p>

      {/* Panel content - lazy-mount (first visit) then stay mounted forever.
          display:none hides the inactive panel without unmounting it, so any
          in-flight operations (pre-gen, batch grade, AI runs, etc.) continue
          uninterrupted even when the admin switches panels mid-run. */}
      {everMounted.has('overview') && <div style={{ display: active === 'overview' ? 'block' : 'none' }}><OverviewPanel      userEmail={user.email} /></div>}
      {everMounted.has('users')    && <div style={{ display: active === 'users'    ? 'block' : 'none' }}><UsersMegaPanel     userEmail={user.email} /></div>}
      {everMounted.has('picks')    && <div style={{ display: active === 'picks'    ? 'block' : 'none' }}><PicksAuditPanel    userEmail={user.email} /></div>}
      {everMounted.has('contests') && <div style={{ display: active === 'contests' ? 'block' : 'none' }}><ContestsPanel      userEmail={user.email} /></div>}
      {everMounted.has('chat')     && <div style={{ display: active === 'chat'     ? 'block' : 'none' }}><ChatRoomAdminPanel userEmail={user.email} /></div>}
      {everMounted.has('flags')    && <div style={{ display: active === 'flags'    ? 'block' : 'none' }}><FlagsPanel         userEmail={user.email} /></div>}
      {everMounted.has('aitools')  && <div style={{ display: active === 'aitools'  ? 'block' : 'none' }}><AIToolsPanel       userEmail={user.email} /></div>}
      {everMounted.has('system')   && <div style={{ display: active === 'system'   ? 'block' : 'none' }}><SystemMegaPanel    userEmail={user.email} /></div>}
    </div>
  );
}
