/**
 * Centralized admin authentication utilities.
 * Single source of truth for admin email list and auth helpers.
 */

import { createClient } from '@supabase/supabase-js';

// ── Admin emails from env vars ───────────────────────────────────────────────
export const ADMIN_EMAILS = (
  process.env.ADMIN_EMAILS ||
  process.env.NEXT_PUBLIC_ADMIN_EMAILS ||
  ''
).split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

export function isAdmin(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

// ── Supabase admin client (fail-closed) ──────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY && typeof window === 'undefined') {
  console.error('[adminAuth] WARNING: SUPABASE_SERVICE_ROLE_KEY is not set — admin operations will fail.');
}

/**
 * Returns a Supabase client with the service role key.
 * Throws if the service key is not configured.
 */
export function getSupabaseAdmin() {
  if (!SERVICE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured. Cannot perform admin operations.');
  }
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

// Pre-built instance for convenience (lazy — only used server-side)
let _adminClient = null;
export function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = getSupabaseAdmin();
  }
  return _adminClient;
}

// ── Auth helper: extract user from JWT ───────────────────────────────────────
export async function getAuthUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const admin = supabaseAdmin();
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) return null;
    return user;
  } catch {
    return null;
  }
}

/**
 * Verify the request is from an admin user.
 * Returns { user, error } — if error is set, return it as a 401/403 response.
 */
export async function requireAdmin(req) {
  const user = await getAuthUser(req);
  if (!user) return { user: null, error: 'Unauthorized — no valid session' };
  if (!isAdmin(user.email)) return { user, error: 'Forbidden — not an admin' };
  return { user, error: null };
}
