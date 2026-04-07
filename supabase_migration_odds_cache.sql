-- ============================================================
-- odds_cache table — Centralized per-game odds storage
-- Run this in the Supabase SQL Editor for project vhlqfxembugromsnjvzm
-- ============================================================

CREATE TABLE IF NOT EXISTS odds_cache (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sport           text NOT NULL,
  game_id         text NOT NULL,
  home_team       text NOT NULL,
  away_team       text NOT NULL,
  commence_time   timestamptz NOT NULL,
  odds_data       jsonb NOT NULL,          -- full bookmaker array + pinnacle + suspectOdds
  game_status     text DEFAULT 'pre',      -- 'pre' | 'live' | 'post'
  last_fetched_at timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now(),
  UNIQUE(sport, game_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_odds_cache_sport         ON odds_cache(sport);
CREATE INDEX IF NOT EXISTS idx_odds_cache_status        ON odds_cache(game_status);
CREATE INDEX IF NOT EXISTS idx_odds_cache_commence      ON odds_cache(commence_time);
CREATE INDEX IF NOT EXISTS idx_odds_cache_sport_status  ON odds_cache(sport, game_status);
CREATE INDEX IF NOT EXISTS idx_odds_cache_last_fetched  ON odds_cache(last_fetched_at);

-- RLS: allow service role full access; anon can read (odds are public)
ALTER TABLE odds_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON odds_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Anon read" ON odds_cache
  FOR SELECT TO anon USING (true);

CREATE POLICY "Authenticated read" ON odds_cache
  FOR SELECT TO authenticated USING (true);
