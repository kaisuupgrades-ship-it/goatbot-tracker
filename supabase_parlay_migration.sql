-- ============================================================
-- Parlay Builder Migration
-- Run in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/vhlqfxembugromsnjvzm/sql
-- ============================================================

-- ── 1. Add parlay columns to the picks table ─────────────────────────────────
ALTER TABLE picks
  ADD COLUMN IF NOT EXISTS is_parlay            boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS parlay_leg_count     integer,
  ADD COLUMN IF NOT EXISTS parlay_combined_odds integer;

-- ── 2. Create parlay_legs table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parlay_legs (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  pick_id      uuid        NOT NULL REFERENCES picks(id) ON DELETE CASCADE,
  leg_number   integer     NOT NULL,
  team         text        NOT NULL,
  sport        text        NOT NULL,
  bet_type     text        NOT NULL,
  line         numeric,                  -- spread/total line value; null for ML
  odds         integer     NOT NULL,     -- American odds for this leg
  game_id      text,                     -- ESPN game ID
  home_team    text,
  away_team    text,
  game_date    date,
  result       text CHECK (result IN ('WIN','LOSS','PUSH','VOID') OR result IS NULL),
  created_at   timestamptz DEFAULT now() NOT NULL
);

-- ── 3. Indexes for AI parlay-pattern analyzer ────────────────────────────────
-- "Which 2-leg sport combos have the highest win rate?"
-- "What bet types correlate well in parlays?"

CREATE INDEX IF NOT EXISTS idx_parlay_legs_pick_id
  ON parlay_legs (pick_id);

CREATE INDEX IF NOT EXISTS idx_parlay_legs_sport
  ON parlay_legs (sport);

CREATE INDEX IF NOT EXISTS idx_parlay_legs_result
  ON parlay_legs (result);

CREATE INDEX IF NOT EXISTS idx_parlay_legs_bet_type
  ON parlay_legs (bet_type);

-- Composite: powers queries like "GROUP BY sport, bet_type WHERE result='WIN'"
CREATE INDEX IF NOT EXISTS idx_parlay_legs_sport_bet_type_result
  ON parlay_legs (sport, bet_type, result);

-- ── 4. Row Level Security ────────────────────────────────────────────────────
ALTER TABLE parlay_legs ENABLE ROW LEVEL SECURITY;

-- Users can only read legs belonging to their own picks
CREATE POLICY "Users can view own parlay legs"
  ON parlay_legs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM picks
      WHERE picks.id = parlay_legs.pick_id
        AND picks.user_id = auth.uid()
    )
  );

-- Service role (used by /api/picks) bypasses RLS automatically — no insert
-- policy needed here; inserts are always done server-side via service role key.
