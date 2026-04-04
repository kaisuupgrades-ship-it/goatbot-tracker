-- ============================================================
-- BetOS Full Migration
-- Run this in your Supabase SQL Editor (safe to re-run — all IF NOT EXISTS)
-- ============================================================

-- ── 1. Add missing columns to picks table ────────────────────
ALTER TABLE picks
  ADD COLUMN IF NOT EXISTS units              numeric(6, 2)  DEFAULT 1,
  ADD COLUMN IF NOT EXISTS contest_entry      boolean        DEFAULT false,
  ADD COLUMN IF NOT EXISTS audit_status       text           CHECK (audit_status IN ('APPROVED', 'FLAGGED', 'REJECTED', 'PENDING')),
  ADD COLUMN IF NOT EXISTS audit_reason       text,
  ADD COLUMN IF NOT EXISTS audit_ai_used      boolean        DEFAULT false,
  ADD COLUMN IF NOT EXISTS audited_at         timestamptz,
  ADD COLUMN IF NOT EXISTS audit_override     boolean        DEFAULT false,
  ADD COLUMN IF NOT EXISTS audit_override_by  text,
  ADD COLUMN IF NOT EXISTS audit_override_at  timestamptz,
  ADD COLUMN IF NOT EXISTS contest_rejected_date date,
  ADD COLUMN IF NOT EXISTS ai_analysis        text,
  ADD COLUMN IF NOT EXISTS ai_model           text,
  ADD COLUMN IF NOT EXISTS analyzed_at        timestamptz;

-- ── 2. Settings table (for announcements, config flags) ──────
CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       text,
  updated_at  timestamptz DEFAULT now()
);

-- Allow anon to read settings (for displaying announcements to all users)
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Settings are publicly readable"
  ON settings FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Only service role can write settings"
  ON settings FOR ALL USING (false) WITH CHECK (false);

-- ── 3. AI usage rate-limiting table ──────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id  uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date     date NOT NULL,
  count    integer DEFAULT 0,
  PRIMARY KEY (user_id, date)
);
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users can read own usage"
  ON ai_usage FOR SELECT USING (auth.uid() = user_id);

-- ── 4. Pick analyses table (AI reports stored separately) ─────
CREATE TABLE IF NOT EXISTS pick_analyses (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pick_id     uuid REFERENCES picks(id) ON DELETE CASCADE NOT NULL,
  analysis    text,
  model       text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE pick_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users can view own pick analyses"
  ON pick_analyses FOR SELECT
  USING (
    pick_id IN (SELECT id FROM picks WHERE user_id = auth.uid())
  );

-- ── 5. Add columns to profiles (if missing) ──────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_banned   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS role        text    DEFAULT 'user';

-- ── 6. Indexes for contest/audit queries ─────────────────────
CREATE INDEX IF NOT EXISTS picks_contest_entry_idx  ON picks (contest_entry) WHERE contest_entry = true;
CREATE INDEX IF NOT EXISTS picks_audit_status_idx   ON picks (audit_status);
CREATE INDEX IF NOT EXISTS picks_contest_date_idx   ON picks (user_id, date, contest_entry);

-- ── 7. Admin RLS: allow service role full access ──────────────
-- Picks: admin can view all public + contest picks
CREATE POLICY IF NOT EXISTS "Admin can view all contest picks"
  ON picks FOR SELECT
  USING (
    auth.jwt() ->> 'role' = 'service_role'
    OR auth.uid() = user_id
    OR (is_public = true)
  );

-- ── 8. Ensure picks with contest_entry=true have is_public=true ─
-- This view-level update keeps leaderboard in sync (optional trigger)
CREATE OR REPLACE FUNCTION sync_contest_entry_public()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.contest_entry = true AND NEW.audit_status = 'APPROVED' THEN
    NEW.is_public = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS picks_contest_sync ON picks;
CREATE TRIGGER picks_contest_sync
  BEFORE INSERT OR UPDATE ON picks
  FOR EACH ROW EXECUTE FUNCTION sync_contest_entry_public();
