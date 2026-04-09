import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(req) {
  // Require admin JWT
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.length > 0 && !adminEmails.includes(user.email?.toLowerCase())) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(parseInt(searchParams.get('days') || '7'), 30);
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();

  // Recent log entries
  const { data: rows, error } = await supabase
    .from('api_usage_log')
    .select('*')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    // Table may not exist yet — return empty rather than 500
    if (error.code === '42P01') {
      return NextResponse.json({ rows: [], latest: null, bySport: {}, tableExists: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Latest snapshot (most recent row with requests_remaining)
  const latest = rows?.find(r => r.requests_remaining != null) || null;

  // Credits consumed per sport (sum of requests_used across window)
  const bySport = {};
  for (const r of (rows || [])) {
    if (!r.sport) continue;
    bySport[r.sport] = (bySport[r.sport] || 0) + (r.requests_used || 0);
  }

  // Daily rollup for sparkline chart
  const byDay = {};
  for (const r of (rows || [])) {
    const day = r.created_at?.slice(0, 10);
    if (!day) continue;
    byDay[day] = (byDay[day] || 0) + (r.requests_used || 0);
  }

  return NextResponse.json({
    rows: rows || [],
    latest,
    bySport,
    byDay,
    tableExists: true,
  });
}
