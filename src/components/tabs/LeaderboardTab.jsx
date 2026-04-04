'use client';
import { useState, useEffect, useCallback } from 'react';
import { fetchProfile, upsertProfile } from '@/lib/supabase';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

// ── UserAvatar: shows real photo if available, falls back to emoji ─────────────
function UserAvatar({ userId, avatarEmoji, size = 32 }) {
  const [imgErr, setImgErr] = useState(false);
  const src = SUPABASE_URL && userId
    ? `${SUPABASE_URL}/storage/v1/object/public/avatars/${userId}.jpg`
    : null;
  const showImg = src && !imgErr;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
      fontSize: size * 0.5,
    }}>
      {showImg ? (
        <img
          src={src}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={() => setImgErr(true)}
        />
      ) : (
        <span>{avatarEmoji || '🎯'}</span>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n, decimals = 2) {
  const v = parseFloat(n) || 0;
  return (v >= 0 ? '+' : '') + v.toFixed(decimals);
}

function winPct(wins, total) {
  if (!total) return '—';
  return ((wins / total) * 100).toFixed(1) + '%';
}

// ── Rank Badge ────────────────────────────────────────────────────────────────

function RankBadge({ rank }) {
  if (rank === 1) return <span style={{ fontSize: '1.3rem' }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize: '1.3rem' }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize: '1.3rem' }}>🥉</span>;
  return (
    <span style={{
      fontFamily: 'IBM Plex Mono', fontSize: '0.85rem',
      color: 'var(--text-muted)', minWidth: '28px', textAlign: 'right',
    }}>
      #{rank}
    </span>
  );
}

// ── Verified Badge ─────────────────────────────────────────────────────────────

function VerifiedBadge({ count }) {
  if (!count || count < 1) return null;
  return (
    <span title={`${count} verified picks (submitted before game start)`} style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      background: 'rgba(74, 222, 128, 0.12)', color: '#4ade80',
      border: '1px solid rgba(74, 222, 128, 0.3)',
      borderRadius: '4px', padding: '1px 6px', fontSize: '0.68rem', fontWeight: 700,
      cursor: 'help',
    }}>
      ✓ {count}
    </span>
  );
}

// ── Sharp Score Bar ────────────────────────────────────────────────────────────

function SharpBar({ score, maxScore }) {
  const pct = maxScore > 0 ? Math.min((score / maxScore) * 100, 100) : 0;
  const color = score >= 20 ? '#FFB800' : score >= 10 ? '#4ade80' : '#888';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div style={{ flex: 1, height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.78rem', color, minWidth: '34px', textAlign: 'right' }}>
        {parseFloat(score || 0).toFixed(1)}
      </span>
    </div>
  );
}

// ── Public Profile Modal ──────────────────────────────────────────────────────

// Generate realistic mock pick history for a leaderboard entry
function generateMockPicks(entry) {
  const { wins, losses, total, username } = entry;
  const sports  = ['MLB', 'NBA', 'NFL', 'NHL'];
  const types   = ['Moneyline', 'Spread', 'Total (Over)', 'Total (Under)', 'Prop'];
  const teams   = ['LAD', 'NYY', 'BOS', 'HOU', 'ATL', 'PHI', 'SD', 'SEA', 'NYM', 'CHC', 'MIL', 'TB', 'MIN', 'CLE', 'SF', 'CIN'];
  const books   = ['FanDuel', 'DraftKings', 'BetMGM', 'Caesars'];
  const notes   = [
    'Sharp line movement, public fading the other side',
    'Strong situational spot — team 8-2 ATS in these scenarios',
    'Injury report favors this side, market hasn\'t adjusted',
    'Weather plays into this — blowing out to CF',
    'Line value vs closing line expectation',
    'High leverage spot — ace on mound, bullpen fresh',
    'Fade the public — 78% on the other side',
    '', '', '',
  ];

  const settled = wins + losses;
  const pending = total - settled;
  const picks = [];

  // Generate settled picks
  for (let i = 0; i < Math.min(settled, 20); i++) {
    const isWin = i < wins;
    const sport = sports[i % sports.length];
    const odds  = isWin ? (Math.random() > 0.5 ? -115 : -108) : (Math.random() > 0.5 ? -112 : +105);
    const profit = isWin ? (odds > 0 ? odds / 100 : 100 / Math.abs(odds)) : -1;
    const d = new Date();
    d.setDate(d.getDate() - (i * 2 + Math.floor(Math.random() * 3)));
    picks.push({
      id: `m_${username}_${i}`,
      date: d.toISOString().split('T')[0],
      sport,
      team: teams[i % teams.length],
      matchup: `${teams[i % teams.length]} vs ${teams[(i + 5) % teams.length]}`,
      bet_type: types[i % types.length],
      odds: String(odds),
      book: books[i % books.length],
      result: isWin ? 'WIN' : 'LOSS',
      profit: parseFloat(profit.toFixed(2)),
      notes: notes[i % notes.length],
      is_public: true,
      pending: false,
    });
  }

  // Generate pending picks (blurred)
  for (let i = 0; i < Math.min(pending, 3); i++) {
    const sport = sports[i % sports.length];
    const d = new Date();
    d.setDate(d.getDate() + i);
    picks.push({
      id: `mp_${username}_${i}`,
      date: d.toISOString().split('T')[0],
      sport,
      team: '???',
      matchup: '??? vs ???',
      bet_type: types[i % types.length],
      odds: '???',
      book: books[i % books.length],
      result: 'PENDING',
      profit: null,
      notes: '',
      is_public: true,
      pending: true,
    });
  }

  return picks;
}

function PublicProfileModal({ entry, onClose }) {
  const { rank, avatar_emoji, display_name, username, wins, losses, total, units, roi, verified_picks, sharp_score, id: userId } = entry;
  const winRate  = total > 0 ? ((wins / total) * 100).toFixed(1) : '—';
  const unitsNum = parseFloat(units) || 0;
  const roiNum   = parseFloat(roi) || 0;
  const [activeSection, setActiveSection] = useState('picks'); // picks | stats

  const allPicks = generateMockPicks(entry);
  const settledPicks = allPicks.filter(p => !p.pending);
  const pendingPicks = allPicks.filter(p => p.pending);

  // Streak calc
  let streak = 0, streakType = '';
  for (const p of settledPicks) {
    if (!streakType) { streakType = p.result; streak = 1; }
    else if (p.result === streakType) streak++;
    else break;
  }

  // Sport breakdown
  const sportBreakdown = {};
  settledPicks.forEach(p => {
    if (!sportBreakdown[p.sport]) sportBreakdown[p.sport] = { wins: 0, losses: 0 };
    if (p.result === 'WIN') sportBreakdown[p.sport].wins++;
    else sportBreakdown[p.sport].losses++;
  });

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '16px', width: '100%', maxWidth: '680px', maxHeight: '90vh',
          overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Shimmer top bar */}
        <div style={{
          height: '3px', flexShrink: 0,
          background: 'linear-gradient(90deg, transparent 0%, #FFB800 25%, #FFD700 50%, #FF9500 75%, transparent 100%)',
          backgroundSize: '200% auto', animation: 'prize-shimmer 2.5s linear infinite',
        }} />

        {/* Profile header */}
        <div style={{
          padding: '1.25rem 1.5rem 1rem', flexShrink: 0,
          background: 'linear-gradient(180deg, rgba(255,184,0,0.04) 0%, transparent 100%)',
          borderBottom: '1px solid var(--border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              {/* Avatar */}
              <div style={{
                width: '62px', height: '62px', borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(255,184,0,0.2), rgba(255,149,0,0.08))',
                border: '2px solid rgba(255,184,0,0.45)',
                flexShrink: 0, overflow: 'hidden',
                boxShadow: '0 0 14px rgba(255,184,0,0.2)',
              }}>
                <UserAvatar userId={userId} avatarEmoji={avatar_emoji} size={62} />
              </div>
              <div>
                <div style={{ fontWeight: 900, fontSize: '1.15rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                  {display_name || username}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '6px' }}>@{username}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.68rem', color: 'var(--gold)', background: 'rgba(255,184,0,0.12)', border: '1px solid rgba(255,184,0,0.35)', borderRadius: '5px', padding: '2px 8px', fontWeight: 800 }}>
                    #{rank} Ranked
                  </span>
                  {verified_picks > 0 && (
                    <span style={{ fontSize: '0.68rem', color: '#4ade80', background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', borderRadius: '5px', padding: '2px 8px', fontWeight: 800 }}>
                      ✓ {verified_picks} Verified
                    </span>
                  )}
                  {streak >= 3 && (
                    <span style={{ fontSize: '0.68rem', color: streakType === 'WIN' ? '#4ade80' : '#f87171', background: streakType === 'WIN' ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)', border: `1px solid ${streakType === 'WIN' ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`, borderRadius: '5px', padding: '2px 8px', fontWeight: 800 }}>
                      {streakType === 'WIN' ? '🔥' : '🧊'} {streak}-{streakType === 'WIN' ? 'W' : 'L'} streak
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.3rem', padding: '4px', flexShrink: 0, lineHeight: 1 }}>✕</button>
          </div>

          {/* Quick stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginTop: '1rem' }}>
            {[
              { label: 'Record', value: `${wins}–${losses}`, color: wins > losses ? 'var(--green)' : wins < losses ? 'var(--red)' : 'var(--text-primary)', sub: `${total} picks` },
              { label: 'Win %', value: `${winRate}%`, color: parseFloat(winRate) >= 55 ? 'var(--green)' : 'var(--text-primary)' },
              { label: 'Units', value: `${unitsNum >= 0 ? '+' : ''}${unitsNum.toFixed(1)}u`, color: unitsNum >= 0 ? 'var(--green)' : 'var(--red)' },
              { label: 'ROI', value: `${roiNum >= 0 ? '+' : ''}${roiNum.toFixed(1)}%`, color: roiNum >= 0 ? 'var(--green)' : 'var(--red)' },
              { label: 'Sharp Score', value: parseFloat(sharp_score || 0).toFixed(1), color: parseFloat(sharp_score) >= 20 ? '#FFB800' : '#4ade80' },
            ].map(s => (
              <div key={s.label} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>{s.label}</div>
                <div style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.95rem', fontWeight: 800, color: s.color }}>{s.value}</div>
                {s.sub && <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '1px' }}>{s.sub}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Section tabs */}
        <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          {[
            { id: 'picks', label: '📋 Pick History' },
            { id: 'stats', label: '📊 Breakdown' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              style={{
                flex: 1, padding: '0.65rem', border: 'none', cursor: 'pointer',
                background: activeSection === tab.id ? 'var(--bg-elevated)' : 'transparent',
                color: activeSection === tab.id ? 'var(--gold)' : 'var(--text-muted)',
                fontSize: '0.78rem', fontWeight: activeSection === tab.id ? 700 : 400,
                borderBottom: activeSection === tab.id ? '2px solid var(--gold)' : '2px solid transparent',
                transition: 'all 0.15s',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.5rem' }}>

          {/* ── Pick History tab ── */}
          {activeSection === 'picks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {/* Pending picks — blurred */}
              {pendingPicks.length > 0 && (
                <div style={{ marginBottom: '4px' }}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>⏳ Active Picks ({pendingPicks.length})</span>
                    <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '4px', padding: '1px 6px' }}>
                      🔒 Hidden until settled
                    </span>
                  </div>
                  {pendingPicks.map(p => (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '0.65rem 0.85rem',
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px',
                      marginBottom: '4px', filter: 'blur(5px)', userSelect: 'none', position: 'relative',
                    }}>
                      <span style={{ fontSize: '0.68rem', color: '#60a5fa', fontWeight: 700, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.2)', borderRadius: '4px', padding: '1px 6px', flexShrink: 0 }}>LIVE</span>
                      <span style={{ flex: 1, fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 600 }}>████ @ ████</span>
                      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.78rem', color: 'var(--text-muted)' }}>████</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Settled picks */}
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
                Settled Picks ({settledPicks.length})
              </div>
              {settledPicks.map((p) => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px', padding: '0.65rem 0.85rem',
                  background: 'var(--bg-elevated)', border: `1px solid ${p.result === 'WIN' ? 'rgba(74,222,128,0.15)' : 'rgba(255,69,96,0.12)'}`,
                  borderRadius: '8px', borderLeft: `3px solid ${p.result === 'WIN' ? 'var(--green)' : 'var(--red)'}`,
                }}>
                  {/* Result badge */}
                  <span style={{
                    fontSize: '0.62rem', fontWeight: 800, padding: '2px 6px', borderRadius: '4px', flexShrink: 0,
                    background: p.result === 'WIN' ? 'rgba(74,222,128,0.15)' : 'rgba(255,69,96,0.12)',
                    color: p.result === 'WIN' ? 'var(--green)' : 'var(--red)',
                    border: `1px solid ${p.result === 'WIN' ? 'rgba(74,222,128,0.3)' : 'rgba(255,69,96,0.25)'}`,
                    minWidth: '30px', textAlign: 'center',
                  }}>
                    {p.result === 'WIN' ? 'W' : 'L'}
                  </span>

                  {/* Sport + matchup */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '1px' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '3px', padding: '0 5px', fontWeight: 700 }}>{p.sport}</span>
                      <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.team} — {p.bet_type}
                      </span>
                    </div>
                    {p.notes && (
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.notes}
                      </div>
                    )}
                  </div>

                  {/* Odds */}
                  <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.75rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                    {parseInt(p.odds) > 0 ? '+' : ''}{p.odds}
                  </span>

                  {/* Profit */}
                  <span style={{
                    fontFamily: 'IBM Plex Mono', fontSize: '0.82rem', fontWeight: 700, flexShrink: 0,
                    color: (p.profit || 0) >= 0 ? 'var(--green)' : 'var(--red)', minWidth: '46px', textAlign: 'right',
                  }}>
                    {(p.profit || 0) >= 0 ? '+' : ''}{(p.profit || 0).toFixed(2)}u
                  </span>
                </div>
              ))}

              {settledPicks.length === 0 && (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                  No settled public picks yet.
                </div>
              )}
            </div>
          )}

          {/* ── Breakdown tab ── */}
          {activeSection === 'stats' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

              {/* Sharp Score */}
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Sharp Score</span>
                  <span style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, fontSize: '1.1rem', color: parseFloat(sharp_score) >= 20 ? '#FFB800' : '#4ade80' }}>
                    {parseFloat(sharp_score || 0).toFixed(1)}
                  </span>
                </div>
                <div style={{ height: '10px', background: 'var(--border)', borderRadius: '5px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: '5px',
                    width: `${Math.min((parseFloat(sharp_score || 0) / 40) * 100, 100)}%`,
                    background: parseFloat(sharp_score) >= 20 ? 'linear-gradient(90deg, #FFB800, #FF9500)' : 'linear-gradient(90deg, #4ade80, #22c55e)',
                    transition: 'width 0.8s ease',
                  }} />
                </div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                  ROI × √(verified picks) ÷ 10 — rewards consistency under pressure
                </div>
              </div>

              {/* Recent form */}
              <div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', fontWeight: 700 }}>
                  Recent Form (last {Math.min(settledPicks.length, 10)})
                </div>
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {settledPicks.slice(0, 10).map((p, i) => (
                    <div key={i} style={{
                      width: '32px', height: '32px', borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: p.result === 'WIN' ? 'rgba(0,212,139,0.15)' : 'rgba(255,69,96,0.15)',
                      border: `1px solid ${p.result === 'WIN' ? 'rgba(0,212,139,0.35)' : 'rgba(255,69,96,0.35)'}`,
                      fontSize: '0.68rem', fontWeight: 800, color: p.result === 'WIN' ? 'var(--green)' : 'var(--red)',
                    }}>
                      {p.result === 'WIN' ? 'W' : 'L'}
                    </div>
                  ))}
                  {settledPicks.length > 0 && (
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', paddingLeft: '4px' }}>← most recent</span>
                  )}
                </div>
              </div>

              {/* Sport breakdown */}
              {Object.keys(sportBreakdown).length > 0 && (
                <div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', fontWeight: 700 }}>
                    By Sport
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {Object.entries(sportBreakdown).map(([sport, { wins: sw, losses: sl }]) => {
                      const wr = sw + sl > 0 ? (sw / (sw + sl)) * 100 : 0;
                      return (
                        <div key={sport} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', minWidth: '46px' }}>{sport}</span>
                          <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono', minWidth: '44px' }}>{sw}–{sl}</span>
                          <div style={{ flex: 1, height: '6px', background: 'var(--border)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: '3px',
                              width: `${wr}%`,
                              background: wr >= 55 ? 'var(--green)' : wr >= 45 ? '#fbbf24' : 'var(--red)',
                              transition: 'width 0.6s ease',
                            }} />
                          </div>
                          <span style={{ fontSize: '0.68rem', fontFamily: 'IBM Plex Mono', color: wr >= 55 ? 'var(--green)' : 'var(--text-muted)', minWidth: '38px', textAlign: 'right' }}>
                            {wr.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.75rem 1.5rem', flexShrink: 0, borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ fontSize: '0.75rem' }}>🔒</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
            Pending picks are hidden until settled. Only verified, public picks are shown.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Leaderboard Row ────────────────────────────────────────────────────────────

function LeaderRow({ entry, maxScore, isMe, onViewProfile }) {
  const { rank, avatar_emoji, display_name, username, wins, losses, total, units, roi, verified_picks, sharp_score, id: userId } = entry;

  return (
    <div
      onClick={onViewProfile}
      style={{
        display: 'grid',
        gridTemplateColumns: '44px 1fr 80px 90px 80px 90px 100px',
        alignItems: 'center',
        gap: '8px',
        padding: '0.75rem 1rem',
        borderRadius: '8px',
        background: isMe ? 'rgba(255,184,0,0.07)' : 'var(--bg-surface)',
        border: isMe ? '1px solid rgba(255,184,0,0.35)' : '1px solid var(--border)',
        transition: 'background 0.15s, border-color 0.15s',
        cursor: 'pointer',
      }}
      onMouseEnter={e => { if (!isMe) { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'rgba(255,184,0,0.2)'; }}}
      onMouseLeave={e => { if (!isMe) { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}}
    >
      {/* Rank */}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <RankBadge rank={rank} />
      </div>

      {/* Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
        <UserAvatar userId={userId} avatarEmoji={avatar_emoji} size={30} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: isMe ? 'var(--gold)' : 'var(--text-primary)', fontSize: '0.9rem', truncate: true }}>
              {display_name || username}
            </span>
            {isMe && <span style={{ fontSize: '0.65rem', color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.05em' }}>YOU</span>}
            <VerifiedBadge count={verified_picks} />
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>@{username}</div>
        </div>
      </div>

      {/* Record */}
      <span style={{
        fontFamily: 'IBM Plex Mono', fontSize: '0.85rem',
        color: wins > losses ? 'var(--green)' : losses > wins ? 'var(--red)' : 'var(--text-secondary)',
      }}>
        {wins}–{losses}
      </span>

      {/* Win % */}
      <span style={{ fontFamily: 'IBM Plex Mono', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
        {winPct(wins, total)}
      </span>

      {/* Units */}
      <span style={{
        fontFamily: 'IBM Plex Mono', fontSize: '0.85rem',
        color: parseFloat(units) >= 0 ? 'var(--green)' : 'var(--red)',
        fontWeight: 700,
      }}>
        {fmt(units)}u
      </span>

      {/* ROI */}
      <span style={{
        fontFamily: 'IBM Plex Mono', fontSize: '0.82rem',
        color: parseFloat(roi) >= 0 ? 'var(--green)' : 'var(--red)',
      }}>
        {fmt(roi, 1)}%
      </span>

      {/* Sharp Score */}
      <SharpBar score={sharp_score} maxScore={maxScore} />
    </div>
  );
}


// ── Profile Editor ────────────────────────────────────────────────────────────

const AVATARS = ['🐐', '🔥', '⚡', '🦅', '🎯', '💎', '🏆', '🐺', '🦁', '🐉', '🤑', '📈'];

function ProfileEditor({ user, profile, onSave, onClose }) {
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [avatar, setAvatar]           = useState(profile?.avatar_emoji || '🎯');
  const [isPublic, setIsPublic]       = useState(profile?.is_public || false);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  async function handleSave() {
    setSaving(true);
    setError('');
    const { data, error: err } = await upsertProfile({
      id: user.id,
      username: profile?.username || user.user_metadata?.username || user.email?.split('@')[0],
      display_name: displayName.trim() || null,
      avatar_emoji: avatar,
      is_public: isPublic,
    });
    if (err) { setError(err.message); setSaving(false); return; }
    onSave(data);
    setSaving(false);
    onClose();
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 100,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '12px', padding: '1.5rem', width: '100%', maxWidth: '380px',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.2rem' }}>
          <h3 style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>Edit Public Profile</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
        </div>

        {/* Avatar picker */}
        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.5rem' }}>Avatar</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '1rem' }}>
          {AVATARS.map(a => (
            <button key={a} onClick={() => setAvatar(a)} style={{
              fontSize: '1.4rem', padding: '4px', borderRadius: '6px', cursor: 'pointer',
              background: avatar === a ? 'rgba(255,184,0,0.2)' : 'transparent',
              border: avatar === a ? '2px solid var(--gold)' : '2px solid transparent',
            }}>{a}</button>
          ))}
        </div>

        {/* Display name */}
        <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem' }}>
          Display Name <span style={{ color: 'var(--text-secondary)' }}>(optional)</span>
        </label>
        <input
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="e.g. SharpMoney69"
          maxLength={30}
          style={{
            width: '100%', background: 'var(--bg-base)', border: '1px solid var(--border)',
            borderRadius: '6px', padding: '0.5rem 0.75rem', color: 'var(--text-primary)',
            fontSize: '0.9rem', marginBottom: '1rem', boxSizing: 'border-box',
          }}
        />

        {/* Public toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', background: 'var(--bg-base)', borderRadius: '8px', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>Show on Leaderboard</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Your public picks will count toward your rank</div>
          </div>
          <button
            onClick={() => setIsPublic(v => !v)}
            style={{
              width: '44px', height: '24px', borderRadius: '12px', border: 'none', cursor: 'pointer',
              background: isPublic ? 'var(--gold)' : 'var(--border)',
              position: 'relative', transition: 'background 0.2s', flexShrink: 0,
            }}
          >
            <div style={{
              position: 'absolute', top: '3px',
              left: isPublic ? '23px' : '3px',
              width: '18px', height: '18px', borderRadius: '50%',
              background: 'white', transition: 'left 0.2s',
            }} />
          </button>
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: '0.8rem', marginBottom: '0.75rem' }}>{error}</div>}

        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            width: '100%', padding: '0.7rem', borderRadius: '8px', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
            background: 'linear-gradient(135deg, #FFB800, #FF8C00)', color: '#0a0a0a',
            fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.05em',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}

// ── Monthly Contest Banner ─────────────────────────────────────────────────────

function getContestDates() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt   = d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const daysLeft = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  return { start: fmt(start), end: fmt(end), daysLeft, month: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
}

function ContestBanner() {
  const [open, setOpen] = useState(false);
  const { start, end, daysLeft, month } = getContestDates();
  const urgent = daysLeft <= 5;

  return (
    /* Outer wrapper: provides animated border via spinning conic gradient */
    <div style={{
      position: 'relative',
      borderRadius: '14px',
      padding: '1.5px',
      overflow: 'hidden',
      boxShadow: '0 0 40px rgba(255,184,0,0.08), 0 8px 24px rgba(0,0,0,0.4)',
    }}>
      {/* Spinning gold spotlight — travels around the full border */}
      <div style={{
        position: 'absolute',
        top: '50%', left: '50%',
        width: '220%', height: '220%',
        transform: 'translate(-50%, -50%)',
        background: 'conic-gradient(from 0deg, transparent 0deg, rgba(255,184,0,0.12) 20deg, rgba(255,184,0,0.85) 50deg, rgba(255,220,80,1) 65deg, rgba(255,149,0,0.85) 80deg, rgba(255,184,0,0.12) 110deg, transparent 140deg)',
        animation: 'spin-border 3s linear infinite',
      }} />

      {/* Inner card */}
      <div style={{
        position: 'relative', zIndex: 1,
        background: 'linear-gradient(135deg, rgba(20,14,0,0.97) 0%, rgba(28,18,0,0.99) 100%)',
        borderRadius: '12.5px',
        overflow: 'hidden',
      }}>

      {/* Subtle radial glow behind trophy */}
      <div style={{
        position: 'absolute', top: '-20px', left: '16px',
        width: '80px', height: '80px',
        background: 'radial-gradient(circle, rgba(255,184,0,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Main header row — always visible */}
      <div
        onClick={() => setOpen(v => !v)}
        style={{ padding: '0.9rem 1.25rem', cursor: 'pointer', userSelect: 'none', position: 'relative' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Animated trophy */}
            <span style={{
              fontSize: '1.8rem', lineHeight: 1,
              animation: 'trophy-bounce 2s ease-in-out infinite',
              display: 'inline-block', filter: 'drop-shadow(0 0 8px rgba(255,184,0,0.6))',
            }}>🏆</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 900, color: '#FFD700', fontSize: '1.05rem', letterSpacing: '-0.02em', textShadow: '0 0 12px rgba(255,184,0,0.4)' }}>
                  Monthly Sharp Contest
                </span>
                {/* Prize pill with shimmer */}
                <span style={{
                  background: 'linear-gradient(90deg, rgba(255,184,0,0.25), rgba(255,149,0,0.2), rgba(255,184,0,0.25))',
                  backgroundSize: '200% auto',
                  animation: 'prize-shimmer 3s linear infinite',
                  color: '#FFD700',
                  border: '1px solid rgba(255,184,0,0.55)',
                  borderRadius: '20px', padding: '2px 12px', fontSize: '0.7rem', fontWeight: 900,
                  letterSpacing: '0.06em', textShadow: '0 0 8px rgba(255,184,0,0.5)',
                }}>$100 PRIZE</span>
                {/* Live badge */}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: 'rgba(74,222,128,0.1)', color: '#4ade80',
                  border: '1px solid rgba(74,222,128,0.3)',
                  borderRadius: '20px', padding: '2px 8px', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.05em',
                }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#4ade80', animation: 'live-pulse 2s infinite' }} />
                  LIVE
                </span>
              </div>
              <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.73rem', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>{month} · {start} – {end}</span>
                {daysLeft > 0 && (
                  <span style={{
                    color: urgent ? '#f87171' : '#60a5fa',
                    fontWeight: 700, fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.7rem',
                    background: urgent ? 'rgba(248,113,113,0.1)' : 'rgba(96,165,250,0.1)',
                    border: `1px solid ${urgent ? 'rgba(248,113,113,0.3)' : 'rgba(96,165,250,0.2)'}`,
                    borderRadius: '4px', padding: '0 5px',
                  }}>
                    {urgent ? '🔥' : '⏱'} {daysLeft}d left
                  </span>
                )}
              </div>
            </div>
          </div>
          <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.04em' }}>
            {open ? 'Hide rules ▲' : 'View rules ▼'}
          </span>
        </div>
      </div>

      {/* Expandable rules panel */}
      {open && (
        <div style={{ borderTop: '1px solid rgba(255,184,0,0.15)', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1.2rem', background: 'rgba(0,0,0,0.2)' }}>

          {/* Prize stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '8px' }}>
            {[
              { label: 'Prize',     value: '$100',       sub: 'Cash — top Sharp Score', icon: '💵' },
              { label: 'Period',    value: '1st – Last', sub: 'Resets each month',       icon: '📅' },
              { label: 'Entry',     value: 'FREE',       sub: 'No cost to compete',      icon: '🎟' },
              { label: 'Min Picks', value: '10',         sub: 'Verified required',        icon: '✅' },
            ].map(s => (
              <div key={s.label} style={{
                background: 'rgba(255,184,0,0.05)', borderRadius: '8px',
                padding: '0.7rem 0.8rem', border: '1px solid rgba(255,184,0,0.15)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '1rem', marginBottom: '4px' }}>{s.icon}</div>
                <div style={{ fontFamily: 'IBM Plex Mono', fontWeight: 800, color: '#FFD700', fontSize: '1rem' }}>{s.value}</div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,0.35)', marginTop: '1px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.45)', marginTop: '3px', lineHeight: 1.4 }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Rules */}
          <div>
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', fontWeight: 700 }}>
              Eligibility &amp; Rules
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {[
                { icon: '1️⃣', text: 'ONE PLAY PER DAY — each user gets exactly one contest pick per day. Choose wisely.' },
                { icon: '📐', text: 'MINIMUM ODDS: -145 — no heavy favorites. Max +400. Straight bets only (Moneyline, Spread, Totals). No parlays, props, or futures.' },
                { icon: '🔒', text: 'LOCKED ONCE POSTED — once your pick is submitted as a contest entry, it cannot be changed, edited, or deleted. Period.' },
                { icon: '📅', text: 'RESCHEDULES ≠ VOID — if your game gets rescheduled, the pick stands for the new date. You may post a new pick for that day, but do NOT delete the original.' },
                { icon: '✅', text: 'All contest picks are AI-audited for legitimacy — odds range, timing, and bet type are verified automatically. Flagged picks are reviewed by admin.' },
                { icon: '📊', text: 'Ranked by Sharp Score: ROI × √(verified picks) ÷ 10. Both win rate AND volume matter — you can\'t win by going 3-1 on 4 picks.' },
                { icon: '🛡', text: 'One account per person — duplicate accounts detected via IP and device fingerprint are permanently disqualified.' },
                { icon: '🚫', text: 'Manipulation, backdating, or fake accounts = permanent ban from all future contests.' },
                { icon: '💸', text: 'Winner paid via PayPal, Venmo, or Cash App within 3 business days of month end.' },
              ].map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '0.45rem 0.65rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: '0.8rem', flexShrink: 0, marginTop: '1px' }}>{r.icon}</span>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>{r.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* How to enter */}
          <div>
            <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', fontWeight: 700 }}>
              How to Enter — 3 Steps
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {[
                'Log picks in Pick History BEFORE games start — timestamped as verified.',
                'Mark picks as Public using the 👁 toggle in Pick History.',
                'Open ✎ My Profile → enable "Show on Leaderboard." Done.',
              ].map((text, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{
                    width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                    background: 'rgba(255,184,0,0.18)', border: '1px solid rgba(255,184,0,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '0.68rem', fontWeight: 900, color: '#FFB800',
                  }}>{i + 1}</span>
                  <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', lineHeight: 1.55 }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textAlign: 'center', paddingTop: '4px' }}>
            🎯 <strong style={{ color: 'rgba(255,184,0,0.8)' }}>BetOS</strong> users have the edge — use the Analyzer, log sharp plays, climb the board.
          </div>
        </div>
      )}
      </div>{/* /inner card */}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LeaderboardTab({ user, isDemo }) {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [profile, setProfile]         = useState(null);
  const [editOpen, setEditOpen]       = useState(false);
  const [viewEntry, setViewEntry]     = useState(null); // for PublicProfileModal

  const userId = user?.id;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (isDemo) params.set('demo', '1');
      else if (userId) params.set('userId', userId);
      const res = await fetch(`/api/leaderboard?${params.toString()}`);
      const json = await res.json();
      // Only throw hard errors (not empty leaderboard)
      if (json.error && !json.leaderboard) throw new Error(json.error);
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [userId, isDemo]);

  useEffect(() => { load(); }, [load]);

  // Load own profile
  useEffect(() => {
    if (!userId || isDemo) return;
    fetchProfile(userId).then(({ data }) => { if (data) setProfile(data); });
  }, [userId, isDemo]);

  const maxScore = data?.leaderboard?.[0]?.sharp_score || 1;
  const entries  = data?.leaderboard || [];

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* Monthly Contest Banner — top of page like a forum notice */}
      <ContestBanner />

      {/* Demo mode notice */}
      {(isDemo || data?.isDemo) && (
        <div style={{
          padding: '0.6rem 1rem', background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)',
          borderRadius: '8px', fontSize: '0.78rem', color: '#93c5fd', display: 'flex', gap: '8px', alignItems: 'center',
        }}>
          <span>👁</span>
          <span><strong>Demo Preview</strong> — This is sample data to show how the leaderboard works. Create an account and log your picks to appear on the real leaderboard.</span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h1 style={{ fontWeight: 900, fontSize: '1.4rem', color: 'var(--gold)', letterSpacing: '-0.02em', margin: 0 }}>
            🏆 Sharp Leaderboard
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '4px 0 0' }}>
            Ranked by Sharp Score — rewards ROI × verified pick volume
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {data && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'IBM Plex Mono' }}>
              {entries.length} handicappers · updated {new Date(data.cachedAt).toLocaleTimeString()}
            </span>
          )}
          <button onClick={load} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: '6px', padding: '5px 10px', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: '0.75rem',
          }}>↺ Refresh</button>
          {!isDemo && (
            <button onClick={() => setEditOpen(true)} style={{
              background: 'rgba(255,184,0,0.15)', border: '1px solid rgba(255,184,0,0.4)',
              borderRadius: '6px', padding: '5px 10px', cursor: 'pointer',
              color: 'var(--gold)', fontSize: '0.75rem', fontWeight: 700,
            }}>✎ My Profile</button>
          )}
        </div>
      </div>

      {/* User rank card */}
      {data?.userEntry && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,184,0,0.08), rgba(255,184,0,0.03))',
          border: '1px solid rgba(255,184,0,0.3)',
          borderRadius: '10px', padding: '1rem 1.25rem',
          display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
        }}>
          <UserAvatar userId={user?.id} avatarEmoji={data.userEntry.avatar_emoji} size={40} />
          <div>
            <div style={{ fontWeight: 800, color: 'var(--gold)', fontSize: '0.95rem' }}>
              You're ranked #{data.userRank} of {data.total}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
              {data.userEntry.wins}–{data.userEntry.losses} · {fmt(data.userEntry.units)}u · Sharp Score {parseFloat(data.userEntry.sharp_score || 0).toFixed(1)}
            </div>
          </div>
        </div>
      )}

      {/* How it works info */}
      {!isDemo && !data?.userEntry && !loading && (
        <div style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: '10px', padding: '1rem 1.25rem',
        }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px', fontSize: '0.9rem' }}>
            📣 Get on the board
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.6 }}>
            Mark picks as <strong style={{ color: 'var(--text-secondary)' }}>Public</strong> in Pick History, then set your profile to <strong style={{ color: 'var(--text-secondary)' }}>Show on Leaderboard</strong>.
            You need at least 3 public settled picks to appear.
            <strong style={{ color: 'var(--gold)' }}> Verified picks</strong> (submitted before game start) carry extra weight in your Sharp Score.
          </div>
        </div>
      )}

      {/* Column headers */}
      {entries.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '44px 1fr 80px 90px 80px 90px 100px',
          gap: '8px', padding: '0 1rem',
        }}>
          {['', 'Handicapper', 'Record', 'Win %', 'Units', 'ROI', 'Sharp Score'].map(h => (
            <span key={h} style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              {h}
            </span>
          ))}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {[...Array(5)].map((_, i) => (
            <div key={i} style={{
              height: '58px', background: 'var(--bg-surface)', borderRadius: '8px',
              border: '1px solid var(--border)', opacity: 1 - i * 0.12,
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--red)', fontSize: '0.85rem' }}>
          Failed to load leaderboard: {error}
          <br />
          <button onClick={load} style={{ marginTop: '0.5rem', background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.8rem' }}>
            Try again
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && entries.length === 0 && (
        <div style={{
          padding: '3rem 2rem', textAlign: 'center',
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '10px',
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🏆</div>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>No public handicappers yet</div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Be the first to go public. Mark picks as Public in History and enable your leaderboard profile.
          </div>
        </div>
      )}

      {/* Leaderboard rows */}
      {!loading && entries.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {entries.map(entry => (
            <LeaderRow
              key={entry.user_id}
              entry={entry}
              maxScore={maxScore}
              isMe={entry.user_id === userId}
              onViewProfile={() => setViewEntry(entry)}
            />
          ))}
        </div>
      )}

      {/* Sharp Score explanation */}
      <div style={{
        padding: '1rem', background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: '8px', fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Sharp Score</strong> = ROI × √(verified picks) ÷ 10. High ROI alone isn't enough — you need volume and consistency.{' '}
        <strong style={{ color: 'var(--green)' }}>✓ Verified</strong> = AI-audited, submitted before game start, odds between -145 and +400, straight bet only.{' '}
        Contest entries are <strong style={{ color: '#FFB800' }}>locked once posted</strong> — no edits, no deletes. One pick per day. All picks auto-posted to leaderboard after audit.
      </div>

      {/* Profile editor modal */}
      {editOpen && (
        <ProfileEditor
          user={user}
          profile={profile}
          onSave={(p) => setProfile(p)}
          onClose={() => setEditOpen(false)}
        />
      )}

      {/* Public profile view modal */}
      {viewEntry && (
        <PublicProfileModal
          entry={viewEntry}
          onClose={() => setViewEntry(null)}
        />
      )}
    </div>
  );
}
