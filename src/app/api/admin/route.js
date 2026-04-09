import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY);

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

// Verify admin identity from JWT — NEVER trust client-supplied email
async function getAdminUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    if (isAdminEmail(user.email)) return user;
    // Check DB role as fallback
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profile?.role === 'admin') return user;
    return null; // neither email-list nor DB role
  } catch { return null; }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action') || 'stats';

  // Verify admin via JWT — ignore any client-supplied email
  const adminUser = await getAdminUser(req);
  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const adminEmail = adminUser.email;

  try {
    if (action === 'stats') {
      // Site-wide stats
      const [
        { count: totalUsers },
        { count: totalPicks },
        { data: recentPicks },
        { data: profiles },
      ] = await Promise.all([
        supabaseAdmin.from('profiles').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('picks').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('picks').select('result, sport, profit, created_at').order('created_at', { ascending: false }).limit(200),
        supabaseAdmin.from('profiles').select('id, username, created_at, is_banned').order('created_at', { ascending: false }).limit(100),
      ]);

      const wins   = (recentPicks || []).filter(p => p.result === 'WIN').length;
      const losses = (recentPicks || []).filter(p => p.result === 'LOSS').length;
      const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : null;

      const sportCounts = {};
      (recentPicks || []).forEach(p => { sportCounts[p.sport] = (sportCounts[p.sport] || 0) + 1; });

      return NextResponse.json({
        totalUsers:  totalUsers || 0,
        totalPicks:  totalPicks || 0,
        winRate,
        sportCounts,
        recentUsers: profiles || [],
      });
    }

    if (action === 'users') {
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      // Per-user pick stats: wins, losses, pushes, units, last pick date
      const { data: allPicks } = await supabaseAdmin
        .from('picks')
        .select('user_id, result, profit, date, sport')
        .limit(10000);

      const stats = {};
      (allPicks || []).forEach(p => {
        if (!stats[p.user_id]) stats[p.user_id] = { wins: 0, losses: 0, pushes: 0, total: 0, units: 0, lastDate: null, sports: {} };
        const s = stats[p.user_id];
        s.total++;
        if (p.result === 'WIN')  s.wins++;
        if (p.result === 'LOSS') s.losses++;
        if (p.result === 'PUSH') s.pushes++;
        if (p.result === 'WIN' || p.result === 'LOSS' || p.result === 'PUSH') s.units += parseFloat(p.profit) || 0;
        if (p.date && (!s.lastDate || p.date > s.lastDate)) s.lastDate = p.date;
        if (p.sport) s.sports[p.sport] = (s.sports[p.sport] || 0) + 1;
      });

      // Get emails from auth.users (requires service role)
      let emailMap = {};
      try {
        const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
        (authData?.users || []).forEach(u => { emailMap[u.id] = u.email; });
      } catch { /* service role may not be available */ }

      const users = (profiles || []).map(u => {
        const s = stats[u.id] || { wins: 0, losses: 0, pushes: 0, total: 0, units: 0, lastDate: null, sports: {} };
        const roi = s.total > 0 ? parseFloat(((s.units / s.total) * 100).toFixed(1)) : null;
        const topSport = Object.entries(s.sports).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
        return {
          ...u,
          email: emailMap[u.id] || null,
          wins: s.wins, losses: s.losses, pushes: s.pushes,
          pick_count: s.total, units: parseFloat(s.units.toFixed(2)),
          roi, last_pick: s.lastDate, top_sport: topSport,
        };
      });
      return NextResponse.json({ users });
    }

    if (action === 'picks') {
      const page  = parseInt(searchParams.get('page') || '0');
      const sport = searchParams.get('sport') || '';
      const uid   = searchParams.get('uid') || '';

      let query = supabaseAdmin
        .from('picks')
        .select('*')
        .order('date', { ascending: false })
        .range(page * 50, page * 50 + 49);

      if (sport) query = query.eq('sport', sport);
      if (uid)   query = query.eq('user_id', uid);

      const { data: picks, error } = await query;
      if (error) throw error;

      // Fetch usernames separately (no FK constraint between picks and profiles)
      const userIds = [...new Set((picks || []).map(p => p.user_id).filter(Boolean))];
      let usernameMap = {};
      if (userIds.length > 0) {
        const { data: profileRows } = await supabaseAdmin
          .from('profiles')
          .select('id, username')
          .in('id', userIds);
        (profileRows || []).forEach(p => { usernameMap[p.id] = p.username; });
      }

      const enrichedPicks = (picks || []).map(p => ({
        ...p,
        profiles: { username: usernameMap[p.user_id] || 'Unknown' },
      }));

      return NextResponse.json({ picks: enrichedPicks });
    }

    if (action === 'cron_settings') {
      // Fetch all cron-related settings: enabled flags + last-run summaries
      const { data: rows } = await supabaseAdmin
        .from('settings')
        .select('key, value, updated_at')
        .or('key.like.cron_%_enabled,key.like.cron_%_last_run,key.eq.cron_grade_last_run,key.eq.cron_trends_last_run,key.eq.cron_pregenerate_last_run');
      const map = {};
      (rows || []).forEach(r => { map[r.key] = { value: r.value, updated_at: r.updated_at }; });
      return NextResponse.json({ settings: map });
    }

    if (action === 'system') {
      // Also fetch current announcement from settings table
      const { data: announcementRow } = await supabaseAdmin
        .from('settings')
        .select('value, updated_at')
        .eq('key', 'announcement')
        .single();

      return NextResponse.json({
        environment: process.env.NODE_ENV || 'production',
        serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? '✓ Set' : '✗ Missing',
        currentAnnouncement: announcementRow?.value || '',
        announcementUpdatedAt: announcementRow?.updated_at || null,
      });
    }

    if (action === 'contests') {
      const { data: contests, error } = await supabaseAdmin
        .from('contests')
        .select('*, profiles(username)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      return NextResponse.json({ contests: contests || [] });
    }

    if (action === 'activity') {
      // Pull all auth users (last_sign_in_at, created_at) — requires service role
      let authUsers = [];
      try {
        const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 500 });
        authUsers = authData?.users || [];
      } catch { /* service role not configured */ }

      // Last pick timestamp per user
      const { data: allPicks } = await supabaseAdmin
        .from('picks')
        .select('user_id, created_at')
        .order('created_at', { ascending: false })
        .limit(5000);

      const lastPickMap = {};
      (allPicks || []).forEach(p => {
        if (!lastPickMap[p.user_id] || p.created_at > lastPickMap[p.user_id]) {
          lastPickMap[p.user_id] = p.created_at;
        }
      });

      // IP addresses from Supabase audit log (service role only)
      let ipMap = {};
      try {
        const { data: auditData } = await supabaseAdmin
          .schema('auth')
          .from('audit_log_entries')
          .select('actor_id, payload, created_at')
          .order('created_at', { ascending: false })
          .limit(3000);

        (auditData || []).forEach(entry => {
          if (!entry.actor_id || ipMap[entry.actor_id]) return;
          const payload = typeof entry.payload === 'string' ? JSON.parse(entry.payload) : (entry.payload || {});
          const ip = payload.ip_address
            || payload.traits?.ip_address
            || null;
          if (ip) ipMap[entry.actor_id] = ip;
        });
      } catch { /* audit_log_entries not accessible */ }

      // Profile rows for usernames / ban status
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, username, is_banned')
        .limit(500);

      const profileMap = {};
      (profiles || []).forEach(p => { profileMap[p.id] = p; });

      // Session time tracking — aggregate per user
      let sessionMap = {};
      try {
        const { data: sessionRows } = await supabaseAdmin
          .from('user_sessions')
          .select('user_id, duration_seconds, started_at')
          .order('started_at', { ascending: false })
          .limit(5000);
        (sessionRows || []).forEach(s => {
          if (!sessionMap[s.user_id]) sessionMap[s.user_id] = { totalSeconds: 0, sessions: 0, lastSeen: null };
          sessionMap[s.user_id].totalSeconds += s.duration_seconds || 0;
          sessionMap[s.user_id].sessions++;
          if (!sessionMap[s.user_id].lastSeen || s.started_at > sessionMap[s.user_id].lastSeen) {
            sessionMap[s.user_id].lastSeen = s.started_at;
          }
        });
      } catch { /* user_sessions table may not exist yet */ }

      const activity = authUsers.map(u => ({
        id: u.id,
        email: u.email,
        username: profileMap[u.id]?.username || null,
        is_banned: profileMap[u.id]?.is_banned || false,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        last_pick: lastPickMap[u.id] || null,
        ip_address: ipMap[u.id] || null,
        total_time_seconds: sessionMap[u.id]?.totalSeconds || 0,
        session_count: sessionMap[u.id]?.sessions || 0,
        last_seen: sessionMap[u.id]?.lastSeen || null,
      }));

      // Sort: most recently signed-in first
      activity.sort((a, b) => {
        if (!a.last_sign_in_at && !b.last_sign_in_at) return 0;
        if (!a.last_sign_in_at) return 1;
        if (!b.last_sign_in_at) return -1;
        return new Date(b.last_sign_in_at) - new Date(a.last_sign_in_at);
      });

      return NextResponse.json({ activity });
    }

    if (action === 'sessions') {
      // Return recent session logs with device info and time spent
      const { data: sessions } = await supabaseAdmin
        .from('user_sessions')
        .select('*, profiles(username)')
        .order('started_at', { ascending: false })
        .limit(500);
      return NextResponse.json({ sessions: sessions || [] });
    }

    if (action === 'ai_errors') {
      const { data: errors } = await supabaseAdmin
        .from('ai_error_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      return NextResponse.json({ errors: errors || [] });
    }

    if (action === 'concerns') {
      const { data: concerns } = await supabaseAdmin
        .from('ai_concerns')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      return NextResponse.json({ concerns: concerns || [] });
    }

    if (action === 'game_analyses') {
      const date = searchParams.get('date') || new Date().toISOString().split('T')[0];
      const { data: analyses } = await supabaseAdmin
        .from('game_analyses')
        .select('id, sport, away_team, home_team, game_date, model, generated_at, updated_at, analysis, prediction_result, prediction_graded_at')
        .eq('game_date', date)
        .order('updated_at', { ascending: false });
      return NextResponse.json({ analyses: analyses || [], date });
    }

    if (action === 'chat_settings') {
      const { data } = await supabaseAdmin.from('chat_settings').select('key, value');
      const settings = {};
      (data || []).forEach(r => { settings[r.key] = r.value; });
      return NextResponse.json({ settings });
    }

    if (action === 'chat_mods') {
      const { data: mods } = await supabaseAdmin
        .from('chat_mods')
        .select('user_id, created_at, profiles:profiles!user_id(username, display_name, avatar_emoji, xp, rank_title)')
        .order('created_at', { ascending: false });
      return NextResponse.json({ mods: mods || [] });
    }

    if (action === 'chat_bans') {
      const { data: bans } = await supabaseAdmin
        .from('chat_bans')
        .select('id, user_id, reason, created_at, active, profiles:profiles!user_id(username, display_name)')
        .eq('active', true)
        .order('created_at', { ascending: false });
      return NextResponse.json({ bans: bans || [] });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Admin API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const body = await req.json();
  const { action, targetId, value, newEmail, newPassword, newUsername } = body;

  // Session tracking — verify JWT so users can only log their own session
  if (action === 'track_session') {
    const { userId, sessionId, durationSeconds, deviceInfo } = body;
    if (!userId || !sessionId) return NextResponse.json({ ok: false });

    // Verify the caller's JWT and confirm it matches the userId in the body
    const headerAuth = req.headers.get('authorization') || '';
    const token = headerAuth.replace(/^Bearer\s+/i, '').trim();
    if (token) {
      try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !user) {
          return NextResponse.json({ ok: false, error: 'Auth verification failed' }, { status: 403 });
        }
        // Allow if: JWT user matches the requested userId, OR the caller is an admin
        if (user.id !== userId && !isAdminEmail(user.email)) {
          const { data: profile } = await supabaseAdmin.from('profiles').select('role').eq('id', user.id).single();
          if (profile?.role !== 'admin') {
            return NextResponse.json({ ok: false, error: 'User ID mismatch' }, { status: 403 });
          }
        }
      } catch {
        return NextResponse.json({ ok: false, error: 'Auth verification failed' }, { status: 403 });
      }
    } else {
      // No token provided — reject unauthenticated session tracking
      return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 });
    }

    // Get real IP from Vercel headers
    const ip = req.headers.get('x-real-ip')
      || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      || null;
    try {
      await supabaseAdmin.from('user_sessions').upsert([{
        id: sessionId,
        user_id: userId,
        duration_seconds: durationSeconds || 0,
        ip_address: ip,
        device_type: deviceInfo?.deviceType || null,
        browser: deviceInfo?.browser || null,
        os: deviceInfo?.os || null,
        screen: deviceInfo?.screen || null,
        started_at: deviceInfo?.startedAt || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }], { onConflict: 'id' });
    } catch { /* non-critical */ }
    return NextResponse.json({ ok: true });
  }

  // All actions below require admin JWT
  const adminUser = await getAdminUser(req);
  if (!adminUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const adminEmail = adminUser.email;

  try {
    if (action === 'ban_user') {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ is_banned: value })
        .eq('id', targetId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'delete_pick') {
      const { error } = await supabaseAdmin
        .from('picks')
        .delete()
        .eq('id', targetId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'reset_pick') {
      // Reset a pick back to PENDING — clears result, profit, and graded timestamps
      const { error } = await supabaseAdmin
        .from('picks')
        .update({
          result:            null,
          profit:            null,
          graded_at:         null,
          graded_home_score: null,
          graded_away_score: null,
          admin_edited_at:   new Date().toISOString(),
          admin_edited_by:   adminEmail,
        })
        .eq('id', targetId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'add_pick') {
      // Admin manually creates a pick for any user
      const { userId, date, sport, team, odds, bet_type, matchup, units, result, notes, contest_entry, is_public, book, line, side, home_team, away_team } = body;
      if (!userId)  return NextResponse.json({ error: 'userId is required' },  { status: 400 });
      if (!date)    return NextResponse.json({ error: 'date is required' },    { status: 400 });
      if (!sport)   return NextResponse.json({ error: 'sport is required' },   { status: 400 });
      if (!team)    return NextResponse.json({ error: 'team is required' },    { status: 400 });
      if (odds == null) return NextResponse.json({ error: 'odds is required' }, { status: 400 });

      // Auto-compute profit if a settled result is provided
      let profit = null;
      const unitVal = parseFloat(units) || 1;
      const oddsInt = parseInt(odds);
      if (result === 'WIN') {
        profit = oddsInt > 0 ? parseFloat((unitVal * oddsInt / 100).toFixed(2)) : parseFloat((unitVal * 100 / Math.abs(oddsInt)).toFixed(2));
      } else if (result === 'LOSS') {
        profit = -unitVal;
      } else if (result === 'PUSH') {
        profit = 0;
      }

      const { data: newPick, error } = await supabaseAdmin.from('picks').insert([{
        user_id:       userId,
        date,
        sport,
        team,
        odds:          oddsInt,
        bet_type:      bet_type      || 'Moneyline',
        matchup:       matchup       || null,
        units:         unitVal,
        result:        result        || null,
        profit:        profit        !== null ? profit : null,
        notes:         notes         || null,
        contest_entry: contest_entry ?? false,
        is_public:     is_public     ?? true,
        book:          book          || null,
        line:          line          || null,
        side:          side          || null,
        home_team:     home_team     || null,
        away_team:     away_team     || null,
        admin_edited_at: new Date().toISOString(),
        admin_edited_by: adminEmail,
        created_at:    new Date().toISOString(),
        updated_at:    new Date().toISOString(),
      }]).select().single();

      if (error) throw error;
      return NextResponse.json({ ok: true, pick: newPick });
    }

    if (action === 'edit_pick') {
      // Admin can correct: team, sport, bet_type, line, odds, units, result, notes, is_public, contest_entry
      const allowed = ['team', 'sport', 'bet_type', 'line', 'odds', 'units', 'result', 'notes', 'is_public', 'contest_entry', 'profit', 'date'];
      const updates = {};
      for (const key of allowed) {
        if (body[key] !== undefined) updates[key] = body[key];
      }
      if (!Object.keys(updates).length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

      // Validate result/profit consistency
      if (updates.result !== undefined || updates.profit !== undefined) {
        const result = updates.result;
        const profit = updates.profit != null ? parseFloat(updates.profit) : null;
        if (result === 'LOSS' && profit != null && profit > 0) {
          return NextResponse.json({ error: 'LOSS result cannot have positive profit' }, { status: 400 });
        }
        if (result === 'WIN' && profit != null && profit < 0) {
          return NextResponse.json({ error: 'WIN result cannot have negative profit' }, { status: 400 });
        }
        // VOID/PUSH automatically zero out profit (no units won or lost)
        if ((result === 'VOID' || result === 'PUSH') && updates.profit === undefined) {
          updates.profit = 0;
        }
      }

      updates.admin_edited_at = new Date().toISOString();
      updates.admin_edited_by = adminEmail;
      const { error } = await supabaseAdmin.from('picks').update(updates).eq('id', targetId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'set_role') {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ role: value })
        .eq('id', targetId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'edit_profile') {
      const allowed = ['username', 'display_name', 'bio', 'avatar_emoji', 'role', 'is_banned', 'twitter_handle', 'location'];
      const updates = {};
      for (const key of allowed) {
        if (body[key] !== undefined) updates[key] = body[key];
      }
      if (!Object.keys(updates).length) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
      updates.updated_at = new Date().toISOString();
      const { error } = await supabaseAdmin.from('profiles').update(updates).eq('id', targetId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'log_concern') {
      const { message, userId, username, source } = body;
      if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 });
      try {
        await supabaseAdmin.from('ai_concerns').insert([{
          message,
          user_id: userId || null,
          username: username || null,
          source: source || 'chatbot',
          created_at: new Date().toISOString(),
        }]);
      } catch { /* table may not exist yet — non-critical */ }
      return NextResponse.json({ ok: true });
    }

    if (action === 'create_user') {
      if (!newEmail || !newPassword) {
        return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
      }
      // Check for duplicate username before creating
      if (newUsername) {
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('username', newUsername)
          .maybeSingle();
        if (existingProfile) {
          return NextResponse.json({ error: `Username "${newUsername}" is already taken` }, { status: 409 });
        }
      }
      // Create the auth user via service role (admin API)
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: newEmail,
        password: newPassword,
        email_confirm: true, // skip email verification
        user_metadata: { username: newUsername || newEmail.split('@')[0] },
      });
      if (authError) throw authError;

      // Create their profile row
      if (authData?.user?.id) {
        await supabaseAdmin.from('profiles').upsert([{
          id: authData.user.id,
          username: newUsername || newEmail.split('@')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }], { onConflict: 'id' });
      }

      return NextResponse.json({ ok: true, userId: authData?.user?.id });
    }

    if (action === 'cron_toggle') {
      // Enable or disable a cron job — stored as a soft flag in settings
      const { jobKey, enabled } = body;
      if (!jobKey) return NextResponse.json({ error: 'jobKey required' }, { status: 400 });
      await supabaseAdmin.from('settings').upsert(
        [{ key: `cron_${jobKey}_enabled`, value: enabled ? 'true' : 'false' }],
        { onConflict: 'key' }
      );
      return NextResponse.json({ ok: true, jobKey, enabled });
    }

    if (action === 'cron_run') {
      // Manually trigger a cron job from the admin panel
      const { jobPath } = body;
      if (!jobPath) return NextResponse.json({ error: 'jobPath required' }, { status: 400 });
      // Construct absolute URL from the incoming request's origin
      const origin = new URL(req.url).origin;
      const secret = process.env.CRON_SECRET;
      const headers = { 'Content-Type': 'application/json' };
      if (secret) headers['Authorization'] = `Bearer ${secret}`;
      try {
        const res = await fetch(`${origin}${jobPath}`, { headers, signal: AbortSignal.timeout(55000) });
        const text = await res.text();
        let result;
        try { result = JSON.parse(text); } catch { result = { raw: text.slice(0, 300) }; }
        return NextResponse.json({ ok: true, status: res.status, result });
      } catch (fetchErr) {
        return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
      }
    }

    if (action === 'log_ai_error') {
      const { pickId, userId, errorMsg, pickData, diagnosis } = body;
      try {
        await supabaseAdmin.from('ai_error_logs').insert([{
          pick_id: pickId || null,
          user_id: userId || null,
          error_message: errorMsg || 'Unknown error',
          pick_data: pickData ? JSON.stringify(pickData) : null,
          ai_diagnosis: diagnosis || null,
          created_at: new Date().toISOString(),
          resolved: false,
        }]);
      } catch { /* non-critical */ }
      return NextResponse.json({ ok: true });
    }

    if (action === 'resolve_ai_error') {
      const { error } = await supabaseAdmin
        .from('ai_error_logs')
        .update({ resolved: true, resolved_at: new Date().toISOString(), resolved_by: adminEmail })
        .eq('id', targetId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'resolve_concern') {
      const { error } = await supabaseAdmin
        .from('ai_concerns')
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq('id', targetId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    // ── Chat moderation actions ────────────────────────────────────────────────
    if (action === 'chat_mute') {
      const { targetUserId, reason, durationMinutes } = body;
      if (!targetUserId) return NextResponse.json({ error: 'targetUserId required' }, { status: 400 });
      const mins = Math.min(Math.max(parseInt(durationMinutes || 30), 1), 10080);
      const expiresAt = new Date(Date.now() + mins * 60000).toISOString();
      await supabaseAdmin.from('chat_mutes').delete().eq('user_id', targetUserId);
      await supabaseAdmin.from('chat_mutes').insert([{
        user_id: targetUserId, muted_by: adminUser.id, reason: reason || null, expires_at: expiresAt,
      }]);
      return NextResponse.json({ ok: true, expiresAt });
    }

    if (action === 'chat_unmute') {
      const { targetUserId } = body;
      await supabaseAdmin.from('chat_mutes').delete().eq('user_id', targetUserId);
      return NextResponse.json({ ok: true });
    }

    if (action === 'chat_ban') {
      const { targetUserId, reason } = body;
      if (!targetUserId) return NextResponse.json({ error: 'targetUserId required' }, { status: 400 });
      await supabaseAdmin.from('chat_bans').update({ active: false }).eq('user_id', targetUserId);
      await supabaseAdmin.from('chat_bans').insert([{
        user_id: targetUserId, banned_by: adminUser.id, reason: reason || null, active: true,
      }]);
      return NextResponse.json({ ok: true });
    }

    if (action === 'chat_unban') {
      const { targetUserId } = body;
      await supabaseAdmin.from('chat_bans').update({ active: false }).eq('user_id', targetUserId);
      return NextResponse.json({ ok: true });
    }

    if (action === 'chat_promote_mod') {
      const { targetUserId } = body;
      if (!targetUserId) return NextResponse.json({ error: 'targetUserId required' }, { status: 400 });
      await supabaseAdmin.from('chat_mods').upsert([{
        user_id: targetUserId, promoted_by: adminUser.id, created_at: new Date().toISOString(),
      }], { onConflict: 'user_id' });
      return NextResponse.json({ ok: true });
    }

    if (action === 'chat_demote_mod') {
      const { targetUserId } = body;
      await supabaseAdmin.from('chat_mods').delete().eq('user_id', targetUserId);
      return NextResponse.json({ ok: true });
    }

    if (action === 'update_chat_settings') {
      const { settings } = body;
      if (!settings || typeof settings !== 'object') return NextResponse.json({ error: 'settings required' }, { status: 400 });
      const rows = Object.entries(settings).map(([key, value]) => ({
        key, value: String(value), updated_at: new Date().toISOString(),
      }));
      const { error } = await supabaseAdmin.from('chat_settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'award_xp') {
      const { targetUserId, amount } = body;
      if (!targetUserId || !amount) return NextResponse.json({ error: 'targetUserId and amount required' }, { status: 400 });
      const { data: profile } = await supabaseAdmin.from('profiles').select('xp').eq('id', targetUserId).single();
      const newXp = Math.max(0, (profile?.xp || 0) + parseInt(amount));
      // Compute rank — reuse same tier data
      const RANKS = [
        { title: 'Degenerate', minXp: 0 }, { title: 'Square', minXp: 100 },
        { title: 'Handicapper', minXp: 300 }, { title: 'Sharp', minXp: 700 },
        { title: 'Steam Chaser', minXp: 1500 }, { title: 'Wiseguy', minXp: 3000 },
        { title: 'Line Mover', minXp: 6000 }, { title: 'Syndicate', minXp: 10000 },
        { title: 'Whale', minXp: 20000 }, { title: 'Legend', minXp: 40000 },
      ];
      let rank = RANKS[0];
      for (const r of RANKS) { if (newXp >= r.minXp) rank = r; }
      const { error: xpErr } = await supabaseAdmin.from('profiles').update({ xp: newXp, rank_title: rank.title }).eq('id', targetUserId);
      if (xpErr) return NextResponse.json({ error: xpErr.message }, { status: 500 });
      return NextResponse.json({ ok: true, newXp, rank: rank.title });
    }

    if (action === 'chat_delete_message') {
      const { messageId } = body;
      if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });
      const { error } = await supabaseAdmin.from('chat_messages').delete().eq('id', messageId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'broadcast') {
      // Store a site-wide announcement in a settings table (if it exists)
      const { error } = await supabaseAdmin
        .from('settings')
        .upsert([{ key: 'announcement', value: value, updated_at: new Date().toISOString() }], { onConflict: 'key' });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Admin POST error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
