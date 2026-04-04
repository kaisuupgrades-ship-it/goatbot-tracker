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

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
    },
  });
  return { data, error };
}

export async function resetPassword(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback?type=recovery`,
  });
  return { data, error };
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
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
  const { data, error } = await supabase.from('picks').insert([pick]).select().single();
  return { data, error };
}

export async function updatePick(id, updates) {
  const { data, error } = await supabase
    .from('picks')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  return { data, error };
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
