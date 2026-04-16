/**
 * lib/auth.js — Shared request authentication helpers for BetOS API routes
 *
 * Every route that touches paid APIs (xAI, The Odds API, etc.) or user-private
 * data MUST call one of these helpers as the first thing in its handler body.
 *
 * Usage:
 *
 *   import { requireAuth } from '@/lib/auth';
 *
 *   export async function GET(req) {
 *     const { user, error } = await requireAuth(req);
 *     if (error) return error;   // 401 already serialised — just return it
 *     // user is a Supabase User object, guaranteed non-null from here
 *   }
 *
 * Helper summary:
 *   requireAuth(req)        — any valid logged-in user
 *   requireAdmin(req)       — valid user whose email is in NEXT_PUBLIC_ADMIN_EMAILS
 *   requireCronOrAuth(req)  — CRON_SECRET OR any valid user (cron + user-triggered routes)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// One admin client per module load. Service-role key so auth.getUser() works
// across all serverless instances without needing the user's own token scope.
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function extractBearerToken(req) {
  const authHeader = req.headers.get('authorization') || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

// ── requireAuth ───────────────────────────────────────────────────────────────
// Validates a Supabase JWT from the Authorization: Bearer <token> header.
// Returns { user: User, error: null } on success.
// Returns { user: null, error: NextResponse(401) } on failure.
export async function requireAuth(req) {
  const token = extractBearerToken(req);
  if (!token) {
    return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  try {
    const { data: { user }, error } = await getSupabaseAdmin().auth.getUser(token);
    if (error || !user) {
      return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    }
    return { user, error: null };
  } catch {
    return { user: null, error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
}

// ── requireAdmin ──────────────────────────────────────────────────────────────
// Same as requireAuth, plus checks that user.email is in NEXT_PUBLIC_ADMIN_EMAILS
// (comma-separated env var). Returns 403 Forbidden for valid-but-non-admin users.
// Returns { user: User, error: null } on success.
// Returns { user: null, error: NextResponse(401|403) } on failure.
export async function requireAdmin(req) {
  const { user, error } = await requireAuth(req);
  if (error) return { user: null, error };

  const adminEmails = (process.env.NEXT_PUBLIC_ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (adminEmails.length > 0 && !adminEmails.includes(user.email?.toLowerCase())) {
    return { user: null, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { user, error: null };
}

// ── requireCronOrAuth ─────────────────────────────────────────────────────────
// Accepts either:
//   - Authorization: Bearer <CRON_SECRET>   (internal Vercel cron / server call)
//   - Authorization: Bearer <supabase-jwt>  (user-triggered call)
// Use for routes that need to run on both a cron schedule AND be callable by users.
// Returns { user: User|null, isCron: boolean, error: null } on success.
// Returns { user: null, isCron: false, error: NextResponse(401) } on failure.
export async function requireCronOrAuth(req) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization') || '';

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { user: null, isCron: true, error: null };
  }

  const { user, error } = await requireAuth(req);
  if (error) return { user: null, isCron: false, error };
  return { user, isCron: false, error: null };
}
