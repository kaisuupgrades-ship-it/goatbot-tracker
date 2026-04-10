#!/usr/bin/env node
/**
 * One-time setup: creates the error_log table in Supabase.
 * Usage: node scripts/create-error-log-table.mjs
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// Load .env.local manually
function loadEnv() {
  const candidates = [
    resolve(__dir, '../.env.local'),          // repo root (normal checkout)
    resolve(__dir, '../../../../.env.local'), // worktree: scripts/ is 4 levels below goatbot-app/
  ];
  for (const envPath of candidates) {
    try {
      const env = readFileSync(envPath, 'utf8');
      for (const line of env.split('\n')) {
        const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)\s*$/);
        if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      return; // stop at first found
    } catch { /* try next */ }
  }
}
loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROJECT_REF  = SUPABASE_URL?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS error_log (
  id            bigserial PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  level         text NOT NULL DEFAULT 'error' CHECK (level IN ('error', 'warn', 'info')),
  source        text NOT NULL DEFAULT 'client' CHECK (source IN ('client', 'api', 'cron', 'webhook')),
  endpoint      text,
  message       text NOT NULL,
  stack         text,
  metadata      jsonb,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved      boolean NOT NULL DEFAULT false,
  resolved_at   timestamptz,
  resolved_by   text
);

CREATE INDEX IF NOT EXISTS idx_error_log_level       ON error_log (level);
CREATE INDEX IF NOT EXISTS idx_error_log_source      ON error_log (source);
CREATE INDEX IF NOT EXISTS idx_error_log_resolved    ON error_log (resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_created_at  ON error_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_user_id     ON error_log (user_id);

ALTER TABLE error_log ENABLE ROW LEVEL SECURITY;

-- Service role: full access
CREATE POLICY IF NOT EXISTS "service_role_all" ON error_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Authenticated users: INSERT only (client-side error logging)
CREATE POLICY IF NOT EXISTS "authenticated_insert" ON error_log
  FOR INSERT TO authenticated WITH CHECK (true);
`.trim();

async function run() {
  console.log(`Project ref: ${PROJECT_REF}`);
  console.log('Attempting table creation via Supabase Management API...\n');

  // Try Supabase Management API (requires personal access token, not service role)
  // This will 401, but we handle that gracefully and show the SQL.
  const mgmtUrl = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  try {
    const res = await fetch(mgmtUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: CREATE_SQL }),
    });

    if (res.ok) {
      console.log('✅ Table created successfully via Management API.');
      return;
    }

    const body = await res.text().catch(() => '');
    console.log(`Management API returned ${res.status} (expected if using service role key — that's OK).`);
    if (body) console.log('Response:', body.slice(0, 200));
  } catch (e) {
    console.log(`Management API request failed: ${e.message}`);
  }

  // Try calling exec_sql RPC (works if the function is defined in the DB)
  console.log('\nTrying exec_sql RPC fallback...');
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sql: CREATE_SQL }),
    });
    if (res.ok) {
      console.log('✅ Table created via exec_sql RPC.');
      return;
    }
  } catch { /* fall through */ }

  // Verify table exists already (maybe already created)
  console.log('\nChecking if table already exists...');
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/error_log?limit=1`, {
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
      },
    });
    if (res.ok) {
      console.log('✅ error_log table already exists — no action needed.');
      return;
    }
  } catch { /* fall through */ }

  // Manual fallback — print the SQL for the user to run
  console.log('\n⚠  Could not auto-create the table (Management API requires a Personal Access Token).');
  console.log('Run the following SQL in your Supabase SQL Editor:\n');
  console.log('  https://app.supabase.com/project/' + PROJECT_REF + '/editor\n');
  console.log('─'.repeat(60));
  console.log(CREATE_SQL);
  console.log('─'.repeat(60));
  console.log('\nCopy the SQL above → paste into Supabase SQL Editor → Run.');
}

run().catch(e => { console.error(e); process.exit(1); });
