'use client';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ── Auth helpers ────────────────────────────────────────────────────────────

export async function signUp(email, password, username) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username } },
  });
  return { data, error };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
}

// Always redirect back to the canonical production domain, regardless of which
// URL the user happened to land on (betos.win vs goatbot-tracker.vercel.app).
const SITE_URL =
  (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_SITE_URL)
    ? process.env.NEXT_PUBLIC_SITE_URL
    : typeof window !== 'undefined'
      ? 'https://betos.win'
      : '';

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${SITE_URL}/auth/callback`,
    },
  });
  return { data, error };
}

export async function resetPassword(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${SITE_URL}/auth/callback?type=recovery`,
  });
  return { data, error };
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getUser() {
  // Use getSession() so the Supabase client reads from localStorage and
  // auto-refreshes the access token with the refresh token when needed.
  // This keeps users logged in across page reloads without re-prompting.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  // getSession() returns cached user_metadata from localStorage which can be
  // stale (e.g. avatar_url updated server-side via admin API won't appear).
  // Fetch the authoritative user from the server so profile changes persist
  // across refreshes and tab switches.
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return session.user; // fallback to session user if fetch fails
  return user;
}

// ── Picks helpers ───────────────────────────────────────────────────────────

export async function fetchPicks(userId) {
  const { data, error } = await supabase
    .from('picks')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true });
  return { data: data || [], error };
}

export async function addPick(pick) {
  // Route through /api/picks so server-side contest validation runs
  // (daily limit, odds range, game-start block, ESPN commence_time lookup).
  // Direct Supabase inserts bypass all of these checks.
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { data: null, error: { message: 'Not authenticated' } };

    const res = await fetch('/api/picks', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ pick }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { data: null, error: { message: json.errors?.[0] || json.error || 'Save failed' } };
    }
    return { data: json.pick, error: null };
  } catch (err) {
    return { data: null, error: { message: err.message || 'Network error' } };
  }
}

export async function updatePick(id, updates) {
  // Route through /api/picks PATCH so server-side validation runs
  // (game-start lock, verified status, contest field protection).
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) return { data: null, error: { message: 'Not authenticated' } };

    const res = await fetch('/api/picks', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ pickId: id, updates }),
    });

    const json = await res.json();
    if (!res.ok) {
      return { data: null, error: { message: json.error || 'Update failed' } };
    }
    return { data: json.pick, error: null };
  } catch (err) {
    return { data: null, error: { message: err.message || 'Network error' } };
  }
}

export async function deletePick(id) {
  const { error } = await supabase.from('picks').delete().eq('id', id);
  return { error };
}

// ── Profile helpers ──────────────────────────────────────────────────────────

export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return { data, error };
}

export async function upsertProfile(profile) {
  const { data, error } = await supabase
    .from('profiles')
    .upsert([profile], { onConflict: 'id' })
    .select()
    .single();
  return { data, error };
}

// ── Pick public toggle ───────────────────────────────────────────────────────

export async function setPickPublic(id, isPublic) {
  const { data, error } = await supabase
    .from('picks')
    .update({ is_public: isPublic })
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

// ── Contest settings ────────────────────────────────────────────────────────

export async function fetchContest(userId) {
  const { data, error } = await supabase
    .from('contests')
    .select('*')
    .eq('user_id', userId)
    .single();
  return { data, error };
}

export async function upsertContest(contest) {
  const { data, error } = await supabase
    .from('contests')
    .upsert([contest], { onConflict: 'user_id' })
    .select()
    .single();
  return { data, error };
}
