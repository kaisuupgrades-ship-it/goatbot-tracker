/**
 * /api/picks/review — User submits a pick correction request.
 *
 * POST body: { pickId: number, message: string }
 *
 * Flow:
 *   1. Verify JWT — must match the pick's user_id
 *   2. Validate the pick exists and belongs to the user
 *   3. Basic message validation
 *   4. Insert into pick_review_requests
 *   5. Return { ok: true, analysis: string|null }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY     = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY || ANON_KEY);

async function getAuthUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch { return null; }
}

export async function POST(req) {
  const user = await getAuthUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated — please refresh and try again.' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { pickId, message } = body || {};

  if (!pickId || typeof pickId !== 'number') {
    return NextResponse.json({ error: 'pickId is required' }, { status: 400 });
  }

  const msg = (message || '').trim();
  if (!msg) {
    return NextResponse.json({ error: 'Please describe the issue and the corrected value.' }, { status: 400 });
  }
  if (msg.length < 10) {
    return NextResponse.json(
      { feedback: 'Please add more detail — describe what is wrong and what the correct value should be (e.g. "The result should be WIN, final score was 110–105").' },
      { status: 422 }
    );
  }

  // Verify the pick exists and belongs to this user
  const { data: pick, error: pickErr } = await supabaseAdmin
    .from('picks')
    .select('id, user_id, sport, team, bet_type, odds, result')
    .eq('id', pickId)
    .single();

  if (pickErr || !pick) {
    return NextResponse.json({ error: 'Pick not found.' }, { status: 404 });
  }
  if (pick.user_id !== user.id) {
    return NextResponse.json({ error: 'You can only request reviews for your own picks.' }, { status: 403 });
  }

  // Check for an existing PENDING request for this pick (prevent duplicates)
  const { data: existing } = await supabaseAdmin
    .from('pick_review_requests')
    .select('id, status')
    .eq('pick_id', pickId)
    .eq('status', 'PENDING')
    .maybeSingle();

  if (existing) {
    return NextResponse.json(
      { error: 'You already have a pending review request for this pick. Please wait for it to be resolved.' },
      { status: 409 }
    );
  }

  // Insert the review request
  const { error: insertErr } = await supabaseAdmin
    .from('pick_review_requests')
    .insert([{
      pick_id:     pickId,
      user_id:     user.id,
      user_message: msg,
      status:      'PENDING',
      created_at:  new Date().toISOString(),
    }]);

  if (insertErr) {
    // Table not created yet
    if (insertErr.code === '42P01' || (insertErr.message || '').includes('does not exist')) {
      return NextResponse.json({
        error: 'Review system is not yet configured. Please contact support.',
      }, { status: 503 });
    }
    console.error('pick_review insert error:', insertErr.message);
    return NextResponse.json({ error: 'Failed to submit request. Try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, analysis: null });
}
