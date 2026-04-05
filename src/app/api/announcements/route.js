/**
 * /api/announcements
 * GET  — returns active announcements (latest first), public
 * POST — admin creates announcement or declares contest winner
 *        body: { adminEmail, type, title, body, month?, winner? }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 10;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

function isAdmin(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

export async function GET() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.json({ announcements: [] });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;
    return NextResponse.json({ announcements: data || [] });
  } catch (err) {
    return NextResponse.json({ announcements: [], error: err.message });
  }
}

export async function POST(req) {
  try {
    const body = await req.json();
    const { adminEmail, type = 'general', title, message, month, winner } = body;

    if (!isAdmin(adminEmail)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }
    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const row = {
      type,
      title,
      body: message || null,
      month: month || null,
      winner_user_id:      winner?.user_id      || null,
      winner_username:     winner?.username      || null,
      winner_display_name: winner?.display_name  || null,
      winner_units:        winner?.units         || null,
      winner_record:       winner?.record        || null,
      created_by: adminEmail,
      is_active: true,
    };

    const { data, error } = await supabase.from('announcements').insert(row).select().single();
    if (error) throw error;

    return NextResponse.json({ announcement: data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const adminEmail = searchParams.get('adminEmail');

    if (!isAdmin(adminEmail)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    await supabase.from('announcements').update({ is_active: false }).eq('id', id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
