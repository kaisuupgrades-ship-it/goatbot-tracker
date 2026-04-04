import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  try {
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('value, updated_at')
      .eq('key', key)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ key, value: data?.value || null, updated_at: data?.updated_at || null });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
