import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY);

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

async function getAdminUser(req) {
  const auth  = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    if (isAdminEmail(user.email)) return user;
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role === 'admin') return user;
    return null;
  } catch { return null; }
}

async function getAuthUser(req) {
  const auth  = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    return error ? null : user;
  } catch { return null; }
}

// ── GET — paginated, filterable list (admin only) ────────────────────────────
export async function GET(req) {
  const adminUser = await getAdminUser(req);
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const page     = Math.max(1, parseInt(sp.get('page')  || '1', 10));
  const limit    = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '50', 10)));
  const offset   = (page - 1) * limit;
  const level    = sp.get('level')    || null;   // error|warn|info
  const source   = sp.get('source')   || null;   // client|api|cron|webhook
  const resolved = sp.get('resolved') || null;   // 'true'|'false'
  const search   = sp.get('search')   || null;   // full-text
  const from     = sp.get('from')     || null;   // ISO date
  const to       = sp.get('to')       || null;   // ISO date

  try {
    let q = supabaseAdmin
      .from('error_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (level)    q = q.eq('level', level);
    if (source)   q = q.eq('source', source);
    if (resolved !== null) q = q.eq('resolved', resolved === 'true');
    if (from)     q = q.gte('created_at', from);
    if (to)       q = q.lte('created_at', to);
    if (search)   q = q.or(`message.ilike.%${search}%,endpoint.ilike.%${search}%,stack.ilike.%${search}%`);

    const { data, error, count } = await q;

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ tableNotFound: true, items: [], total: 0, page, limit });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Unresolved count for badge
    const { count: unresolvedCount } = await supabaseAdmin
      .from('error_log')
      .select('*', { count: 'exact', head: true })
      .eq('resolved', false);

    return NextResponse.json({
      items: data || [],
      total: count || 0,
      page,
      limit,
      pages: Math.ceil((count || 0) / limit),
      unresolvedCount: unresolvedCount || 0,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── POST — log a new error (any authenticated user, or unauthenticated from server) ──
export async function POST(req) {
  // Server-side calls use CRON_SECRET header; client calls use JWT
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';
  const isServerCall = cronSecret && authHeader === `Bearer ${cronSecret}`;

  let userId = null;
  if (!isServerCall) {
    // Require auth for client-side logging (prevents anonymous spam)
    const user = await getAuthUser(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    userId = user.id;
  }

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const {
    level    = 'error',
    source   = 'client',
    endpoint = null,
    message,
    stack    = null,
    metadata = null,
  } = body;

  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

  const validLevels  = ['error', 'warn', 'info'];
  const validSources = ['client', 'api', 'cron', 'webhook'];
  if (!validLevels.includes(level))   return NextResponse.json({ error: 'invalid level' },  { status: 400 });
  if (!validSources.includes(source)) return NextResponse.json({ error: 'invalid source' }, { status: 400 });

  try {
    const { data, error } = await supabaseAdmin.from('error_log').insert({
      level,
      source,
      endpoint: endpoint ? String(endpoint).slice(0, 500) : null,
      message:  String(message).slice(0, 5000),
      stack:    stack    ? String(stack).slice(0, 10000)   : null,
      metadata: metadata || null,
      user_id:  userId,
    }).select('id').single();

    if (error) {
      if (error.code === '42P01') return NextResponse.json({ tableNotFound: true }, { status: 503 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ id: data.id, ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── PATCH — resolve/unresolve errors (admin only) ────────────────────────────
export async function PATCH(req) {
  const adminUser = await getAdminUser(req);
  if (!adminUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { ids, resolved = true, clearAll = false } = body;

  try {
    if (clearAll) {
      // Delete all resolved entries
      const { error } = await supabaseAdmin
        .from('error_log')
        .delete()
        .eq('resolved', true);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, action: 'cleared_resolved' });
    }

    if (!Array.isArray(ids) || !ids.length) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 });
    }

    const update = {
      resolved,
      resolved_at:  resolved ? new Date().toISOString() : null,
      resolved_by:  resolved ? adminUser.email           : null,
    };

    const { error } = await supabaseAdmin
      .from('error_log')
      .update(update)
      .in('id', ids);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
