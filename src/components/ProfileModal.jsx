'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TIMEZONES, saveLocalPrefs } from '@/lib/userPrefs';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Rate limit windows (milliseconds)
const LIMITS = {
  display_name: 7  * 24 * 60 * 60 * 1000, // 7 days
  username:     7  * 24 * 60 * 60 * 1000, // 7 days
  email:        30 * 24 * 60 * 60 * 1000, // 30 days
  phone:         7 * 24 * 60 * 60 * 1000, // 7 days
};

function msToReadable(ms) {
  const days  = Math.floor(ms / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `${days}d ${hours}h`;
  const mins = Math.floor((ms % (60 * 60 * 1000)) / 60000);
  return `${hours}h ${mins}m`;
}

function getTimeUntilAllowed(lastChangedAt, limitMs) {
  if (!lastChangedAt) return 0;
  const lastMs = Date.parse(lastChangedAt); // always UTC for ISO 8601 strings from Supabase
  if (isNaN(lastMs)) return 0;
  return Math.max(0, limitMs - (Date.now() - lastMs));
}

// ── Avatar display helpers ──────────────────────────────────────────────────
function avatarUrl(userId) {
  if (!SUPABASE_URL || !userId) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/avatars/${userId}.jpg`;
}

// ── Avatar Crop Modal ────────────────────────────────────────────────────────
const CROP_SIZE = 280; // px — the circular crop frame size

function CropModal({ imageSrc, onConfirm, onCancel }) {
  const imgRef     = useRef(null);
  const [pos, setPos]       = useState({ x: 0, y: 0 });
  const [scale, setScale]   = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const lastMouse = useRef(null);

  function initImage() {
    const img = imgRef.current;
    if (!img) return;
    const ms = Math.max(CROP_SIZE / img.naturalWidth, CROP_SIZE / img.naturalHeight);
    setMinScale(ms);
    setScale(ms);
    setPos({ x: 0, y: 0 });
  }

  function clampPos(rawX, rawY, sc) {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const dispW = img.naturalWidth  * sc;
    const dispH = img.naturalHeight * sc;
    const maxX = Math.max(0, (dispW - CROP_SIZE) / 2);
    const maxY = Math.max(0, (dispH - CROP_SIZE) / 2);
    return { x: Math.max(-maxX, Math.min(maxX, rawX)), y: Math.max(-maxY, Math.min(maxY, rawY)) };
  }

  function onMouseDown(e) {
    e.preventDefault();
    setDragging(true);
    lastMouse.current = { x: e.clientX, y: e.clientY };
  }
  function onTouchStart(e) {
    const t = e.touches[0];
    setDragging(true);
    lastMouse.current = { x: t.clientX, y: t.clientY };
  }
  function onMove(clientX, clientY) {
    if (!dragging || !lastMouse.current) return;
    const dx = clientX - lastMouse.current.x;
    const dy = clientY - lastMouse.current.y;
    lastMouse.current = { x: clientX, y: clientY };
    setPos(p => clampPos(p.x + dx, p.y + dy, scale));
  }
  function onMouseMove(e) { onMove(e.clientX, e.clientY); }
  function onTouchMove(e) { const t = e.touches[0]; onMove(t.clientX, t.clientY); }
  function endDrag() { setDragging(false); lastMouse.current = null; }

  function onScaleChange(newScale) {
    setScale(newScale);
    setPos(p => clampPos(p.x, p.y, newScale));
  }

  function handleConfirm() {
    const img = imgRef.current;
    if (!img) return;
    const OUTPUT = 300;
    const canvas = document.createElement('canvas');
    canvas.width  = OUTPUT;
    canvas.height = OUTPUT;
    const ctx = canvas.getContext('2d');

    // In display space, the image center is at (CROP_SIZE/2 + pos.x, CROP_SIZE/2 + pos.y).
    // Crop center is at (CROP_SIZE/2, CROP_SIZE/2).
    // In natural image coords, the crop's top-left corner is:
    const sx = (img.naturalWidth  / 2) - (pos.x / scale) - (CROP_SIZE / 2 / scale);
    const sy = (img.naturalHeight / 2) - (pos.y / scale) - (CROP_SIZE / 2 / scale);
    const sw = CROP_SIZE / scale;

    ctx.drawImage(img, sx, sy, sw, sw, 0, 0, OUTPUT, OUTPUT);
    canvas.toBlob(blob => onConfirm(blob), 'image/jpeg', 0.92);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '16px',
        padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem',
        maxWidth: '360px', width: '100%',
      }}>
        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>
          Crop Avatar
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '-0.5rem' }}>
          Drag to reposition · Zoom to fit
        </div>

        {/* Crop frame */}
        <div style={{
          position: 'relative', width: CROP_SIZE, height: CROP_SIZE, margin: '0 auto',
          overflow: 'hidden', borderRadius: '50%',
          border: '3px solid var(--gold)', cursor: dragging ? 'grabbing' : 'grab',
          background: '#111', userSelect: 'none',
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
        }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={endDrag}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            alt=""
            onLoad={initImage}
            draggable={false}
            style={{
              position: 'absolute',
              width:  imgRef.current ? imgRef.current.naturalWidth  * scale + 'px' : 'auto',
              height: imgRef.current ? imgRef.current.naturalHeight * scale + 'px' : 'auto',
              left: '50%', top: '50%',
              transform: `translate(calc(-50% + ${pos.x}px), calc(-50% + ${pos.y}px))`,
              pointerEvents: 'none',
            }}
          />
        </div>

        {/* Zoom slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '1rem', color: 'var(--text-muted)', lineHeight: 1 }}>−</span>
          <input
            type="range"
            min={minScale}
            max={minScale * 4}
            step={0.01}
            value={scale}
            onChange={e => onScaleChange(parseFloat(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--gold)' }}
          />
          <span style={{ fontSize: '1rem', color: 'var(--text-muted)', lineHeight: 1 }}>+</span>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1, padding: '9px', borderRadius: '8px', cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', fontSize: '0.82rem', fontFamily: 'inherit',
            }}
          >Cancel</button>
          <button
            onClick={handleConfirm}
            style={{
              flex: 2, padding: '9px', borderRadius: '8px', cursor: 'pointer',
              background: 'linear-gradient(135deg, #FFB800, #FF9500)',
              border: 'none', color: '#000', fontSize: '0.82rem', fontWeight: 700, fontFamily: 'inherit',
            }}
          >✓ Use Photo</button>
        </div>
      </div>
    </div>
  );
}

// ── Section separator ───────────────────────────────────────────────────────
function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: '0.62rem', fontWeight: 700, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.1em',
      marginBottom: '10px', marginTop: '4px',
    }}>
      {children}
    </div>
  );
}

// ── Input row ───────────────────────────────────────────────────────────────
function FieldRow({ label, children, hint, locked, lockedMsg }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
        <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</label>
        {locked && lockedMsg && (
          <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '2px 7px', borderRadius: '4px' }}>
            🔒 {lockedMsg}
          </span>
        )}
      </div>
      {hint && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginBottom: '6px' }}>{hint}</div>}
      {children}
    </div>
  );
}

// ── Main modal ──────────────────────────────────────────────────────────────
export default function ProfileModal({ user, onClose, onUpdated }) {
  const meta = user?.user_metadata || {};

  // Derive current values
  const userId    = user?.id;
  const currentUsername = meta.username || user?.email?.split('@')[0] || '';
  const currentEmail    = user?.email || '';
  const currentPhone    = meta.phone || '';
  const currentAvatar   = meta.avatar_url || null;

  // Rate-limit timestamps (stored in user_metadata)
  const displayNameChangedAt = meta.display_name_changed_at || null;
  const usernameChangedAt    = meta.username_changed_at    || null;
  const emailChangedAt       = meta.email_changed_at       || null;
  const phoneChangedAt       = meta.phone_changed_at       || null;

  const displayNameWait = getTimeUntilAllowed(displayNameChangedAt, LIMITS.display_name);
  const usernameWait    = getTimeUntilAllowed(usernameChangedAt,    LIMITS.username);
  const emailWait       = getTimeUntilAllowed(emailChangedAt,       LIMITS.email);
  const phoneWait       = getTimeUntilAllowed(phoneChangedAt,       LIMITS.phone);

  // Form state
  const [username,         setUsername]         = useState(currentUsername);
  const [displayName,      setDisplayName]      = useState(''); // loaded from profiles table below
  const [originalDisplayName, setOriginalDisplayName] = useState(''); // for change detection
  const [email,       setEmail]       = useState(currentEmail);
  const [phone,       setPhone]       = useState(currentPhone);

  // Load display_name from profiles table on mount
  useEffect(() => {
    if (!userId) return;
    supabase.from('profiles').select('display_name, username').eq('id', userId).single()
      .then(({ data }) => {
        if (data?.display_name) {
          setDisplayName(data.display_name);
          setOriginalDisplayName(data.display_name);
        }
        // If no username in form yet, seed from profiles table
        if (!currentUsername && data?.username) setUsername(data.username);
      }).catch(() => {});
  }, [userId]); // eslint-disable-line

  // Preferences
  const [timezone,    setTimezone]    = useState(meta.timezone    || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York');
  const [oddsFormat,  setOddsFormat]  = useState(meta.odds_format || 'american');

  // Avatar state
  const [avatarPreview,    setAvatarPreview]    = useState(currentAvatar ? avatarUrl(userId) : null);
  const [avatarFile,       setAvatarFile]       = useState(null);
  const [avatarUploading,  setAvatarUploading]  = useState(false);
  // Crop modal
  const [cropSrc,     setCropSrc]     = useState(null);   // raw ObjectURL for the picker
  const [showCrop,    setShowCrop]    = useState(false);

  // UI state
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState(null);
  const [success,  setSuccess]  = useState(null);
  const [activeTab, setActiveTab] = useState('profile'); // 'profile' | 'security'

  const fileInputRef = useRef(null);

  // ── Session token for API auth (replaces @supabase/ssr dependency) ────────
  const [accessToken, setAccessToken] = useState('');
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setAccessToken(data?.session?.access_token || '');
    });
  }, []);

  function authHeaders(extra = {}) {
    return { ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}), ...extra };
  }

  // ── Avatar pick → open crop modal ──────────────────────────────────────
  function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be under 10 MB.');
      return;
    }
    if (!['image/jpeg','image/png','image/webp','image/gif','image/heic'].includes(file.type)) {
      setError('Please pick a JPEG, PNG, WebP, GIF, or HEIC image.');
      return;
    }
    // Release any previous object URL
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    const src = URL.createObjectURL(file);
    setCropSrc(src);
    setShowCrop(true);
    setError(null);
    // Reset the input so picking the same file again still fires onChange
    e.target.value = '';
  }

  function handleCropConfirm(blob) {
    // blob is the cropped JPEG from canvas
    const croppedFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    setAvatarFile(croppedFile);
    // Show preview as circle in profile section
    const preview = URL.createObjectURL(blob);
    if (avatarPreview && avatarPreview.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(preview);
    setShowCrop(false);
    if (cropSrc) { URL.revokeObjectURL(cropSrc); setCropSrc(null); }
  }

  function handleCropCancel() {
    setShowCrop(false);
    if (cropSrc) { URL.revokeObjectURL(cropSrc); setCropSrc(null); }
  }

  // ── Save profile ─────────────────────────────────────────────────────────
  async function handleSave() {
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      // 1. Upload avatar if new file selected
      let newAvatarUrl = currentAvatar;
      if (avatarFile) {
        setAvatarUploading(true);
        const uploadRes = await fetch('/api/profile/avatar', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': avatarFile.type }),
          body: avatarFile,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Avatar upload failed');
        newAvatarUrl = uploadData.avatar_url;
        setAvatarUploading(false);
      }

      // 2. Build update payload (only changed fields)
      const updates = {};
      const now = new Date().toISOString();

      const trimmedDisplayName = displayName.trim();
      if (trimmedDisplayName && trimmedDisplayName !== originalDisplayName) {
        if (displayNameWait > 0) throw new Error(`Display name locked for ${msToReadable(displayNameWait)} — can change once per week.`);
        if (trimmedDisplayName.length < 2) throw new Error('Display name must be at least 2 characters.');
        if (trimmedDisplayName.length > 40) throw new Error('Display name must be 40 characters or less.');
        updates.display_name = trimmedDisplayName;
        updates.display_name_changed_at = now;
      }

      if (username !== currentUsername) {
        if (usernameWait > 0) throw new Error(`Username locked for ${msToReadable(usernameWait)}.`);
        if (username.trim().length < 3) throw new Error('Username must be at least 3 characters.');
        if (username.trim().length > 24) throw new Error('Username must be 24 characters or less.');
        if (!/^[a-zA-Z0-9_\-. ]+$/.test(username.trim())) throw new Error('Username can only contain letters, numbers, spaces, underscores, hyphens, and dots.');
        updates.username = username.trim();
        updates.username_changed_at = now;
      }

      if (email !== currentEmail) {
        if (emailWait > 0) throw new Error(`Email locked for ${msToReadable(emailWait)}.`);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email address.');
        updates.email = email.trim();
        updates.email_changed_at = now;
      }

      if (phone !== currentPhone) {
        if (phoneWait > 0) throw new Error(`Phone locked for ${msToReadable(phoneWait)}.`);
        const cleaned = phone.replace(/\D/g, '');
        if (phone && cleaned.length < 10) throw new Error('Enter a valid phone number (10+ digits).');
        updates.phone = phone.trim();
        updates.phone_changed_at = now;
      }

      if (newAvatarUrl !== currentAvatar) {
        updates.avatar_url = newAvatarUrl;
      }

      // Preferences — always save (no rate limit)
      if (timezone   !== (meta.timezone    || '')) updates.timezone    = timezone;
      if (oddsFormat !== (meta.odds_format || 'american')) updates.odds_format = oddsFormat;

      if (Object.keys(updates).length === 0) {
        setSuccess('No changes to save.');
        setSaving(false);
        return;
      }

      // 3. Send to API (updates user_metadata + profiles table)
      const res  = await fetch('/api/profile', {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');

      // Also persist prefs locally so they're immediately available
      saveLocalPrefs({ timezone, odds_format: oddsFormat });

      setSuccess('Profile updated! Some changes (like email) may require confirmation.');
      setAvatarFile(null);
      onUpdated?.(data.user);

    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
      setAvatarUploading(false);
    }
  }

  // ── Password change ───────────────────────────────────────────────────────
  const [pwSending, setPwSending]   = useState(false);
  const [pwSuccess, setPwSuccess]   = useState(null);
  const [pwError,   setPwError]     = useState(null);

  async function handlePasswordReset() {
    setPwSending(true); setPwError(null); setPwSuccess(null);
    try {
      const res  = await fetch('/api/profile/reset-password', { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send reset email');
      setPwSuccess(`Reset link sent to ${currentEmail}`);
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwSending(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const inputStyle = (disabled) => ({
    width: '100%', padding: '8px 11px',
    background: disabled ? 'var(--bg-base)' : 'var(--bg-elevated)',
    border: `1px solid ${disabled ? 'var(--border)' : 'rgba(255,255,255,0.1)'}`,
    borderRadius: '7px', color: disabled ? 'var(--text-muted)' : 'var(--text-primary)',
    fontSize: '0.85rem', fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
    cursor: disabled ? 'not-allowed' : 'text',
    transition: 'border 0.15s',
  });

  return (
    <>
    {showCrop && cropSrc && (
      <CropModal
        imageSrc={cropSrc}
        onConfirm={handleCropConfirm}
        onCancel={handleCropCancel}
      />
    )}
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
        animation: 'fadeIn 0.15s ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '14px', width: '100%', maxWidth: '440px',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        animation: 'slideUp 0.2s cubic-bezier(0.4,0,0.2,1)',
      }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.1rem 1.4rem', borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>My Profile</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '1px' }}>{currentEmail}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem', padding: '4px 7px', borderRadius: '6px' }}
          >
            ✕
          </button>
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: '0', padding: '0 1.4rem', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
        }}>
          {['profile','security'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                padding: '10px 14px 8px', fontSize: '0.78rem', fontWeight: 600,
                color: activeTab === tab ? 'var(--gold)' : 'var(--text-muted)',
                borderBottom: `2px solid ${activeTab === tab ? 'var(--gold)' : 'transparent'}`,
                transition: 'all 0.15s',
                textTransform: 'capitalize',
              }}
            >
              {tab === 'profile' ? '👤 Profile' : '🔒 Security'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.4rem' }}>

          {activeTab === 'profile' && (
            <>
              {/* Avatar */}
              <SectionLabel>Avatar</SectionLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: '68px', height: '68px', borderRadius: '50%',
                    background: 'var(--bg-elevated)', border: '2px solid var(--border)',
                    overflow: 'hidden', cursor: 'pointer', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    position: 'relative',
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  title="Click to upload avatar"
                >
                  {avatarPreview ? (
                    <img
                      src={avatarPreview}
                      alt="Avatar"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={() => setAvatarPreview(null)}
                    />
                  ) : meta.avatar_emoji ? (
                    <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>{meta.avatar_emoji}</span>
                  ) : (
                    <span style={{ fontSize: '1.6rem', color: 'var(--text-muted)' }}>
                      {currentUsername[0]?.toUpperCase() || '?'}
                    </span>
                  )}
                  {/* Overlay hint */}
                  <div style={{
                    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: 0, transition: 'opacity 0.15s', borderRadius: '50%',
                    fontSize: '1.2rem',
                  }}
                    onMouseEnter={e => e.currentTarget.style.opacity = 1}
                    onMouseLeave={e => e.currentTarget.style.opacity = 0}
                  >
                    📷
                  </div>
                </div>
                <div>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      borderRadius: '7px', padding: '6px 13px', cursor: 'pointer',
                      color: 'var(--text-secondary)', fontSize: '0.78rem', fontFamily: 'inherit',
                      display: 'block', marginBottom: '5px',
                    }}
                  >
                    {avatarFile ? '✓ Cropped & ready' : 'Upload & crop photo'}
                  </button>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    JPEG, PNG, WebP or GIF · drag to crop<br />Can update anytime
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: 'none' }}
                  onChange={handleAvatarChange}
                />
              </div>

              {/* Identity */}
              <SectionLabel>Identity</SectionLabel>

              {/* Display Name */}
              <FieldRow
                label="Display Name"
                hint="Your name shown in chat, leaderboard, and profile cards. Separate from your @handle."
                locked={displayNameWait > 0}
                lockedMsg={displayNameWait > 0 ? `changes in ${msToReadable(displayNameWait)}` : null}
              >
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  disabled={displayNameWait > 0}
                  placeholder="e.g. StatSnipe"
                  maxLength={40}
                  style={inputStyle(displayNameWait > 0)}
                  onFocus={e => { if (!displayNameWait) e.target.style.borderColor = 'var(--gold)'; }}
                  onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                />
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'right' }}>
                  {displayName.length}/40 · Can change every 7 days
                </div>
              </FieldRow>

              {/* Username / @handle */}
              <FieldRow
                label="Username"
                hint="Your @handle — shown on the leaderboard and in picks. 3–24 characters, no spaces."
                locked={usernameWait > 0}
                lockedMsg={usernameWait > 0 ? `changes in ${msToReadable(usernameWait)}` : null}
              >
                <div style={{ position: 'relative' }}>
                  <span style={{
                    position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)',
                    color: 'var(--text-muted)', fontSize: '0.85rem', pointerEvents: 'none',
                  }}>@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
                    disabled={usernameWait > 0}
                    placeholder="StatSnipe"
                    maxLength={24}
                    style={{ ...inputStyle(usernameWait > 0), paddingLeft: '22px' }}
                    onFocus={e => { if (!usernameWait) e.target.style.borderColor = 'var(--gold)'; }}
                    onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                  />
                </div>
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '4px', textAlign: 'right' }}>
                  {username.length}/24 · Can change every 7 days
                </div>
              </FieldRow>

              {/* Email */}
              <SectionLabel>Contact</SectionLabel>
              <FieldRow
                label="Email"
                hint="A confirmation will be sent to the new address."
                locked={emailWait > 0}
                lockedMsg={emailWait > 0 ? `changes in ${msToReadable(emailWait)}` : null}
              >
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  disabled={emailWait > 0}
                  placeholder="you@example.com"
                  style={inputStyle(emailWait > 0)}
                  onFocus={e => { if (!emailWait) e.target.style.borderColor = 'var(--gold)'; }}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Can change every 30 days
                </div>
              </FieldRow>

              <FieldRow
                label="Phone (optional)"
                hint="For future SMS alerts and 2FA. Not shown publicly."
                locked={phoneWait > 0}
                lockedMsg={phoneWait > 0 ? `changes in ${msToReadable(phoneWait)}` : null}
              >
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  disabled={phoneWait > 0}
                  placeholder="+1 555-555-5555"
                  style={inputStyle(phoneWait > 0)}
                  onFocus={e => { if (!phoneWait) e.target.style.borderColor = 'var(--gold)'; }}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Can change every 7 days
                </div>
              </FieldRow>
            </>
          )}

          {/* ── Preferences section (always visible) ─────────────────── */}
          {activeTab === 'profile' && (
            <>
              <SectionLabel>Preferences</SectionLabel>
              <FieldRow label="Timezone" hint="Game times will display in your local time.">
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  style={{
                    width: '100%', padding: '9px 11px', borderRadius: '8px', fontSize: '0.85rem',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontFamily: 'inherit', cursor: 'pointer',
                  }}
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </FieldRow>
              <FieldRow label="Odds Format" hint="How odds are displayed throughout BetOS.">
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[
                    { value: 'american', label: 'American  (+150 / -110)' },
                    { value: 'decimal',  label: 'Decimal  (2.50 / 1.91)' },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setOddsFormat(opt.value)}
                      style={{
                        flex: 1, padding: '9px 10px', borderRadius: '8px', fontSize: '0.8rem',
                        fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.15s',
                        background: oddsFormat === opt.value ? 'var(--gold)' : 'var(--bg-elevated)',
                        color: oddsFormat === opt.value ? '#000' : 'var(--text-secondary)',
                        border: `1px solid ${oddsFormat === opt.value ? 'var(--gold)' : 'var(--border)'}`,
                        fontWeight: oddsFormat === opt.value ? 700 : 400,
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </FieldRow>
            </>
          )}

          {activeTab === 'security' && (
            <>
              <SectionLabel>Password</SectionLabel>
              <div style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: '10px', padding: '1rem 1.1rem', marginBottom: '20px',
              }}>
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Change Password
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px', lineHeight: 1.6 }}>
                  We'll send a secure reset link to <strong style={{ color: 'var(--text-secondary)' }}>{currentEmail}</strong>. The link expires in 1 hour.
                </div>
                <button
                  onClick={handlePasswordReset}
                  disabled={pwSending}
                  style={{
                    background: 'var(--bg-overlay)', border: '1px solid var(--border)',
                    borderRadius: '7px', padding: '7px 14px', cursor: pwSending ? 'not-allowed' : 'pointer',
                    color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'inherit',
                    opacity: pwSending ? 0.6 : 1,
                  }}
                >
                  {pwSending ? 'Sending…' : '📧 Send Reset Link'}
                </button>
                {pwSuccess && <div style={{ marginTop: '8px', fontSize: '0.75rem', color: '#4ade80' }}>✓ {pwSuccess}</div>}
                {pwError   && <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--red)' }}>✗ {pwError}</div>}
              </div>

              <SectionLabel>Account Info</SectionLabel>
              <div style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: '10px', padding: '1rem 1.1rem',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>User ID</span>
                    <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{userId?.slice(0, 8)}…</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Email verified</span>
                    <span style={{ color: meta.email_verified ? '#4ade80' : 'var(--gold)' }}>
                      {meta.email_verified ? '✓ Verified' : '⚠ Unverified'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Member since</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Status messages */}
          {error   && <div style={{ marginTop: '12px', padding: '9px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '7px', color: 'var(--red)', fontSize: '0.78rem' }}>✗ {error}</div>}
          {success && <div style={{ marginTop: '12px', padding: '9px 12px', background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: '7px', color: '#4ade80', fontSize: '0.78rem' }}>✓ {success}</div>}
        </div>

        {/* Footer */}
        {activeTab === 'profile' && (
          <div style={{
            padding: '1rem 1.4rem', borderTop: '1px solid var(--border)',
            display: 'flex', gap: '8px', justifyContent: 'flex-end',
            flexShrink: 0,
          }}>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: '1px solid var(--border)', borderRadius: '7px',
                padding: '8px 16px', cursor: 'pointer', color: 'var(--text-muted)',
                fontSize: '0.82rem', fontFamily: 'inherit',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || avatarUploading}
              style={{
                background: 'var(--gold)', border: 'none', borderRadius: '7px',
                padding: '8px 20px', cursor: saving ? 'not-allowed' : 'pointer',
                color: '#000', fontWeight: 700, fontSize: '0.82rem', fontFamily: 'inherit',
                opacity: saving ? 0.7 : 1, transition: 'opacity 0.15s',
              }}
            >
              {avatarUploading ? 'Uploading…' : saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
    </>
  );
}
