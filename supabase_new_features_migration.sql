-- ============================================================
-- BetOS New Features Migration
-- Run this in your Supabase SQL Editor (safe to re-run — all IF NOT EXISTS)
-- ============================================================

-- ── 1. User Sessions Table (time-on-site tracking) ───────────
CREATE TABLE IF NOT EXISTS user_sessions (
  id              text PRIMARY KEY,   -- client-generated UUID per session
  user_id         uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  duration_seconds integer DEFAULT 0,
  ip_address      text,
  device_type     text,
  browser         text,
  os              text,
  screen          text
);
CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_started_at_idx ON user_sessions (started_at DESC);
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
-- Users can only see their own sessions; service role can see all (admin)
CREATE POLICY IF NOT EXISTS "Users can read own sessions"
  ON user_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Anyone can upsert session data"
  ON user_sessions FOR ALL USING (true) WITH CHECK (true);

-- ── 2. AI Error Logs Table ───────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_error_logs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pick_id         uuid REFERENCES picks(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  error_message   text,
  pick_data       text,  -- JSON stringified pick for context
  ai_diagnosis    text,  -- AI's attempt to explain the error
  resolved        boolean DEFAULT false,
  resolved_at     timestamptz,
  resolved_by     text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_error_logs_created_idx ON ai_error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_error_logs_resolved_idx ON ai_error_logs (resolved);
ALTER TABLE ai_error_logs ENABLE ROW LEVEL SECURITY;
-- Admin only (via service role)
CREATE POLICY IF NOT EXISTS "Service role full access to ai_error_logs"
  ON ai_error_logs FOR ALL USING (false) WITH CHECK (false);

-- ── 3. AI Concerns Table (chatbot-reported serious concerns) ─
CREATE TABLE IF NOT EXISTS ai_concerns (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  message     text NOT NULL,
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  username    text,
  source      text DEFAULT 'chatbot',   -- 'chatbot' | 'feedback' | 'manual'
  resolved    boolean DEFAULT false,
  resolved_at timestamptz,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_concerns_resolved_idx ON ai_concerns (resolved);
CREATE INDEX IF NOT EXISTS ai_concerns_created_idx ON ai_concerns (created_at DESC);
ALTER TABLE ai_concerns ENABLE ROW LEVEL SECURITY;
-- Admin only
CREATE POLICY IF NOT EXISTS "Service role full access to ai_concerns"
  ON ai_concerns FOR ALL USING (false) WITH CHECK (false);

-- ── 4. Add extra profile columns ────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS twitter_handle  text,
  ADD COLUMN IF NOT EXISTS location        text,
  ADD COLUMN IF NOT EXISTS bio             text,
  ADD COLUMN IF NOT EXISTS display_name    text;
