import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 15;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Verify the bearer token and return the user (no @supabase/ssr dependency)
async function getUser(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  return user;
}

export async function PATCH(req) {
  try {
    const user = await getUser(req);
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const body = await req.json();
    const {
      username, username_changed_at,
      email,    email_changed_at,
      phone,    phone_changed_at,
      avatar_url,
      timezone,      // e.g. 'America/New_York'
      odds_format,   // 'american' | 'decimal'
    } = body;

    // Build metadata update (merges with existing)
    const metaUpdate = {};
    if (username    !== undefined) { metaUpdate.username            = username;    }
    if (username_changed_at)       { metaUpdate.username_changed_at = username_changed_at; }
    if (phone       !== undefined) { metaUpdate.phone               = phone;       }
    if (phone_changed_at)          { metaUpdate.phone_changed_at    = phone_changed_at;    }
    if (avatar_url  !== undefined) { metaUpdate.avatar_url          = avatar_url;  }
    if (email_changed_at)          { metaUpdate.email_changed_at    = email_changed_at;    }
    if (timezone    !== undefined) { metaUpdate.timezone            = timezone;    }
    if (odds_format !== undefined) { metaUpdate.odds_format         = odds_format; }

    // Email update (goes through Supabase auth separately)
    if (email && email !== user.email) {
      const { error: emailErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, { email });
      if (emailErr) return NextResponse.json({ error: emailErr.message }, { status: 400 });
    }

    // user_metadata update via admin API (merges with existing)
    const existing = user.user_metadata || {};
    const { data: updated, error: metaErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...existing, ...metaUpdate },
    });
    if (metaErr) return NextResponse.json({ error: metaErr.message }, { status: 400 });

    return NextResponse.json({ user: updated.user });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
