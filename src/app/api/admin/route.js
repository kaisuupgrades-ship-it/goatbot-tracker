import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ADMIN_EMAILS = ['kaisuupgrades@gmail.com'];

// Use service role key if available, otherwise fall back to anon (limited access)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function isAdmin(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const action    = searchParams.get('action') || 'stats';
  const userEmail = searchParams.get('userEmail') || '';

  if (!isAdmin(userEmail)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

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
        s.units += parseFloat(p.profit) || 0;
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

    if (action === 'system') {
      return NextResponse.json({
        environment: process.env.NODE_ENV || 'production',
        serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? '✓ Set' : '✗ Missing',
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

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('Admin API error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  const body = await req.json();
  const { action, userEmail, targetId, value, newEmail, newPassword, newUsername } = body;

  if (!isAdmin(userEmail)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

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

    if (action === 'set_role') {
      const { error } = await supabaseAdmin
        .from('profiles')
        .update({ role: value })
        .eq('id', targetId);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === 'create_user') {
      if (!newEmail || !newPassword) {
        return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
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
