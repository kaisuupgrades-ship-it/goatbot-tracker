-- migration_pick_columns.sql
-- Adds columns to picks table that the grading/parsing pipeline depends on.
-- Safe to re-run: each column is wrapped in a DO block that catches duplicate_column errors.

-- line: spread/total line value (-1.5, +3.5, 8.5, etc.)
DO $$ BEGIN
  ALTER TABLE picks ADD COLUMN line numeric(10,2);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- side: which side of the bet ('home', 'away', 'over', 'under')
DO $$ BEGIN
  ALTER TABLE picks ADD COLUMN side text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- home_team: home team name from ESPN lookup at submission time
DO $$ BEGIN
  ALTER TABLE picks ADD COLUMN home_team text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- away_team: away team name from ESPN lookup at submission time
DO $$ BEGIN
  ALTER TABLE picks ADD COLUMN away_team text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- pick_type: normalized bet category ('moneyline', 'spread', 'total', 'prop')
-- NOTE: there is a separate legacy pick_type column used for 'contest'/'verified'/'personal'.
-- This new column carries the BET category; the route handles both.
-- If this column already exists with different semantics, review before applying.
DO $$ BEGIN
  ALTER TABLE picks ADD COLUMN pick_type text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- graded_at: timestamp when the pick result was set
DO $$ BEGIN
  ALTER TABLE picks ADD COLUMN graded_at timestamptz;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- graded_home_score: home team final score recorded at grading time
DO $$ BEGIN
  ALTER TABLE picks ADD COLUMN graded_home_score integer;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- graded_away_score: away team final score recorded at grading time
DO $$ BEGIN
  ALTER TABLE picks ADD COLUMN graded_away_score integer;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
