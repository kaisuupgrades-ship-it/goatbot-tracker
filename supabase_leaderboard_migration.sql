-- ============================================================
-- GOAT BOT Leaderboard Migration
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Profiles table (links to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username        TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  is_public       BOOLEAN DEFAULT false,
  avatar_emoji    TEXT DEFAULT '🐐',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Profiles: anyone can read public profiles
CREATE POLICY "Public profiles are viewable by everyone"
  ON profiles FOR SELECT
  USING (is_public = true OR auth.uid() = id);

-- Profiles: users can only update their own
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- Profiles: users can insert their own
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);


-- 2. Add leaderboard columns to picks table
ALTER TABLE picks
  ADD COLUMN IF NOT EXISTS submitted_at   TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS is_public      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS commence_time  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS game_id        TEXT;

-- Prevent clients from setting submitted_at manually (server trust)
-- We handle this via a trigger
CREATE OR REPLACE FUNCTION set_submitted_at()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.submitted_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS picks_submitted_at ON picks;
CREATE TRIGGER picks_submitted_at
  BEFORE INSERT ON picks
  FOR EACH ROW EXECUTE FUNCTION set_submitted_at();

-- Second layer of defense: sanitize commence_time on INSERT.
-- If a client somehow bypasses the server API and sets a bogus commence_time
-- (e.g. far future to fake verification), this trigger nulls it out.
-- Rules:
--   1. commence_time must be within 3 days of the pick's date field.
--   2. commence_time must not be more than 24h in the past (no stale times).
-- Legitimate picks entered via /api/picks always get commence_time from ESPN
-- and will pass these checks. Any tampered value gets wiped.
CREATE OR REPLACE FUNCTION sanitize_commence_time()
RETURNS TRIGGER AS $$
DECLARE
  pick_date_ts TIMESTAMPTZ;
  diff_days    NUMERIC;
BEGIN
  IF NEW.commence_time IS NULL THEN
    RETURN NEW;  -- nothing to sanitize
  END IF;

  -- Parse the date field to midnight UTC
  BEGIN
    pick_date_ts := (NEW.date::DATE)::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    NEW.commence_time := NULL;
    RETURN NEW;
  END;

  -- Must be within ±3 calendar days of the pick's date
  diff_days := ABS(EXTRACT(EPOCH FROM (NEW.commence_time - pick_date_ts)) / 86400.0);
  IF diff_days > 3 THEN
    NEW.commence_time := NULL;
    RETURN NEW;
  END IF;

  -- Must not be more than 24h in the past (prevents using old game times to appear early)
  IF NEW.commence_time < (NOW() - INTERVAL '24 hours') THEN
    -- Allow: pick might be entered same-day after a morning game. Keep it.
    -- But if it's more than 24h stale, null it — that's suspicious.
    NEW.commence_time := NULL;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS picks_sanitize_commence_time ON picks;
CREATE TRIGGER picks_sanitize_commence_time
  BEFORE INSERT ON picks
  FOR EACH ROW EXECUTE FUNCTION sanitize_commence_time();


-- 3. Leaderboard stats view
-- A pick is "verified" if submitted_at < commence_time (exact game start, required).
-- commence_time is populated at pick submission via /api/verify-game (ESPN lookup).
-- Picks without commence_time are unverifiable and won't count toward verified_picks.
-- Minimum 1 settled public pick to appear on the board.
CREATE OR REPLACE VIEW leaderboard_stats AS
SELECT
  p.user_id,
  pr.username,
  COALESCE(pr.display_name, pr.username) AS display_name,
  pr.avatar_emoji,
  -- Total settled picks
  COUNT(*) FILTER (
    WHERE p.result IN ('WIN','LOSS','PUSH')
    AND p.is_public = true
  ) AS total,
  COUNT(*) FILTER (
    WHERE p.result = 'WIN'
    AND p.is_public = true
  ) AS wins,
  COUNT(*) FILTER (
    WHERE p.result = 'LOSS'
    AND p.is_public = true
  ) AS losses,
  COUNT(*) FILTER (
    WHERE p.result = 'PUSH'
    AND p.is_public = true
  ) AS pushes,
  -- Units profit
  COALESCE(
    SUM(CAST(p.profit AS NUMERIC)) FILTER (
      WHERE p.result IN ('WIN','LOSS','PUSH')
      AND p.is_public = true
    ), 0
  ) AS units,
  -- ROI %
  CASE
    WHEN COUNT(*) FILTER (WHERE p.result IN ('WIN','LOSS','PUSH') AND p.is_public = true) > 0
    THEN (
      COALESCE(SUM(CAST(p.profit AS NUMERIC)) FILTER (WHERE p.result IN ('WIN','LOSS','PUSH') AND p.is_public = true), 0)
      / COUNT(*) FILTER (WHERE p.result IN ('WIN','LOSS','PUSH') AND p.is_public = true)
    ) * 100
    ELSE 0
  END AS roi,
  -- Verified picks: must have exact commence_time AND been submitted before it
  COUNT(*) FILTER (
    WHERE p.result IN ('WIN','LOSS','PUSH')
    AND p.is_public = true
    AND p.commence_time IS NOT NULL
    AND p.submitted_at IS NOT NULL
    AND p.submitted_at < p.commence_time
  ) AS verified_picks,
  -- Sharp Score: ROI * sqrt(verified_count) / 10 — rewards both edge and volume
  CASE
    WHEN COUNT(*) FILTER (WHERE p.result IN ('WIN','LOSS','PUSH') AND p.is_public = true) >= 5
    THEN ROUND(
      (
        COALESCE(SUM(CAST(p.profit AS NUMERIC)) FILTER (WHERE p.result IN ('WIN','LOSS','PUSH') AND p.is_public = true), 0)
        / COUNT(*) FILTER (WHERE p.result IN ('WIN','LOSS','PUSH') AND p.is_public = true)
      ) * 100
      * SQRT(
        GREATEST(
          COUNT(*) FILTER (
            WHERE p.result IN ('WIN','LOSS','PUSH')
            AND p.is_public = true
            AND p.commence_time IS NOT NULL
            AND p.submitted_at IS NOT NULL
            AND p.submitted_at < p.commence_time
          ),
          1
        )
      ) / 10
    , 2)
    ELSE 0
  END AS sharp_score
FROM picks p
JOIN profiles pr ON pr.id = p.user_id
WHERE pr.is_public = true
GROUP BY p.user_id, pr.username, pr.display_name, pr.avatar_emoji
HAVING COUNT(*) FILTER (
  WHERE p.result IN ('WIN','LOSS','PUSH') AND p.is_public = true
) >= 1;

-- Grant access to the view
GRANT SELECT ON leaderboard_stats TO anon, authenticated;


-- 4. Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- 5. Index for performance
CREATE INDEX IF NOT EXISTS picks_user_public_idx ON picks (user_id, is_public, result);
CREATE INDEX IF NOT EXISTS picks_submitted_at_idx ON picks (submitted_at);
