-- Migration: Add verification columns to picks table
-- Run this in the Supabase SQL editor.
--
-- verification_status: 'verified' | 'unverified' | 'pending'
--   'verified'   — passed timing + odds + game-exists checks
--   'unverified' — one or more checks failed (saved as personal pick)
--   'pending'    — pre-existing row, not yet evaluated (NULL treated same as 'pending')
--
-- verification_reasons: array of human-readable strings explaining why verification failed
--   e.g. ['Odds differ from market by 25 points', 'Game started 3 minutes ago']

ALTER TABLE picks
  ADD COLUMN IF NOT EXISTS verification_status  TEXT,
  ADD COLUMN IF NOT EXISTS verification_reasons TEXT[];

-- Index for fast leaderboard / sharp-board queries filtering by verification_status
CREATE INDEX IF NOT EXISTS idx_picks_verification_status
  ON picks (verification_status);

-- Back-fill: picks that have commence_time and were submitted before it can be
-- considered legacy-verified. Picks without commence_time stay NULL (pending).
-- This is safe to run multiple times (IF NOT EXISTS on column guards it).
UPDATE picks
SET verification_status = 'verified'
WHERE
  verification_status IS NULL
  AND commence_time IS NOT NULL
  AND created_at    IS NOT NULL
  AND created_at < commence_time;

-- Everything else that has a commence_time but was submitted after → unverified
UPDATE picks
SET verification_status = 'unverified',
    verification_reasons = ARRAY['Pick submitted after game started (legacy backfill)']
WHERE
  verification_status IS NULL
  AND commence_time IS NOT NULL
  AND created_at    IS NOT NULL
  AND created_at >= commence_time;
