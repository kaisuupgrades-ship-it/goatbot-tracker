-- Migration: game_analyses table — ensure correct schema and unique constraint
-- Run this in Supabase SQL Editor to fix the pregenerate-analysis pipeline.
--
-- Root cause of "45 generated · 0 cached" bug:
--   1. Upsert onConflict: 'sport,game_date,home_team,away_team' fails silently
--      when the unique constraint doesn't exist in Postgres.
--   2. Several columns added to the INSERT were never added to the table.

-- ── 1. Create table if it doesn't exist ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS game_analyses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sport            text NOT NULL,
  game_date        date NOT NULL,
  home_team        text NOT NULL,
  away_team        text NOT NULL,
  analysis         text,
  model            text,
  provider         text,
  was_fallback     boolean DEFAULT false,
  latency_ms       integer,
  tokens_in        integer,
  tokens_out       integer,
  prompt_version   text,
  trigger_source   text,
  run_id           text,
  prediction_pick  text,
  prediction_conf  text,
  prediction_edge  text,
  alternate_angles text,
  line_movement    text,
  unit_sizing      text,
  win_probability  text,
  prediction_result       text,
  prediction_graded_at    timestamptz,
  generated_at     timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now()
);

-- ── 2. Add any missing columns (safe to run even if columns already exist) ────
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS prompt_version   text;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS trigger_source   text;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS run_id           text;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS alternate_angles text;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS line_movement    text;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS unit_sizing      text;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS win_probability  text;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS was_fallback     boolean DEFAULT false;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS latency_ms       integer;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS tokens_in        integer;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS tokens_out       integer;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS prediction_result       text;
ALTER TABLE game_analyses ADD COLUMN IF NOT EXISTS prediction_graded_at   timestamptz;

-- ── 3. Add the unique constraint required by upsert onConflict ────────────────
-- Without this, every upsert returns an error and silently saves nothing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_analyses_sport_date_teams_key'
      AND conrelid = 'game_analyses'::regclass
  ) THEN
    ALTER TABLE game_analyses
      ADD CONSTRAINT game_analyses_sport_date_teams_key
      UNIQUE (sport, game_date, home_team, away_team);
  END IF;
END$$;

-- ── 4. Enable RLS (service role bypasses it, but good hygiene) ────────────────
ALTER TABLE game_analyses ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (already implicit, but explicit is clearer)
DROP POLICY IF EXISTS "service_role_all" ON game_analyses;
CREATE POLICY "service_role_all" ON game_analyses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Allow anon/authenticated users to read analyses (needed by GoatBot Analyzer)
DROP POLICY IF EXISTS "public_read" ON game_analyses;
CREATE POLICY "public_read" ON game_analyses
  FOR SELECT TO authenticated, anon USING (true);
