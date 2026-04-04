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

      // Get pick counts per user
      const { data: pickCounts } = await supabaseAdmin
        .from('picks')
        .select('user_id')
        .limit(5000);

      const counts = {};
      (pickCounts || []).forEach(p => { counts[p.user_id] = (counts[p.user_id] || 0) + 1; });

      const users = (profiles || []).map(u => ({ ...u, pick_count: counts[u.id] || 0 }));
      return NextResponse.json({ users });
    }

    if (action === 'picks') {
      const page  = parseInt(searchParams.get('page') || '0');
      const sport = searchParams.get('sport') || '';
      const uid   = searchParams.get('uid') || '';

      let query = supabaseAdmin
        .from('picks')
        .select('*, profiles(username)')
        .order('date', { ascending: false })
        .range(page * 50, page * 50 + 49);

      if (sport) query = query.eq('sport', sport);
      if (uid)   query = query.eq('user_id', uid);

      const { data: picks, error } = await query;
      if (error) throw error;
      return NextResponse.json({ picks: picks || [] });
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
  const { action, userEmail, targetId, value } = body;

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
