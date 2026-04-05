---
name: goatbot-health-check
description: Run a full health check on the BetOS / GoatBot platform. Checks Supabase cron jobs, stuck picks, stale odds cache, game analysis freshness, trends staleness, and API security issues. Use this skill whenever the user says "health check", "is everything running", "check the crons", "are picks grading", "is the site healthy", "what's broken", "system status", "run diagnostics", or asks about the health of betos.win, goatbot, odds pipeline, or cron jobs.
---

# GoatBot Health Check

This skill runs a comprehensive diagnostic on the BetOS/GoatBot platform, checking live database state, cron job execution, cache freshness, and known security patterns.

## When to run this

Run this whenever the user wants to know if the platform is healthy, if crons are firing, if picks are grading, or if something seems broken. Also run proactively if the user reports a bug that could be caused by stale data or failed crons.

## Health Check Procedure

### 1. Cron Job Status

Query the Supabase `settings` table for all keys matching `cron_%`. Check last run timestamps against expected schedules:

| Job | Expected Frequency | Stale If |
|-----|-------------------|----------|
| grade-picks | Every 5 min (17-23, 0-8 UTC) | No log entry, or >30 min old during game hours |
| pregenerate-analysis | 12:00 + 20:00 UTC | >13 hours old |
| trends | 09:00 + 17:00 UTC | >9 hours old |

Use this SQL via the Supabase `execute_sql` MCP tool:
```sql
SELECT key, value FROM settings WHERE key LIKE 'cron_%' ORDER BY key;
```

### 2. Stuck Picks

Check for picks that should have been graded but weren't:
```sql
SELECT id, sport, pick, created_at, result
FROM picks
WHERE result = 'pending'
  AND created_at < NOW() - INTERVAL '24 hours'
ORDER BY created_at;
```

If any rows return, these are stuck and need manual grading or investigation.

### 3. Odds Cache Freshness

```sql
SELECT key,
  (value::json->>'timestamp')::text as cached_at
FROM settings
WHERE key LIKE 'odds_cache_%'
ORDER BY key;
```

Flag any cache older than 30 minutes during game hours (17-08 UTC), or older than 2 hours during off-peak.

### 4. Game Analyses

```sql
SELECT sport, COUNT(*) as count, MAX(created_at) as latest
FROM game_analyses
GROUP BY sport
ORDER BY latest DESC;
```

If the table is empty or the latest entry is >24 hours old, the pregenerate cron is likely not running.

### 5. Trends / Daily Edges

```sql
SELECT key,
  (value::json->>'generated')::text as generated_at,
  LEFT((value::json->>'edges')::text, 200) as preview
FROM settings
WHERE key = 'ai_daily_edges';
```

Flag if older than 12 hours.

### 6. Quick Security Spot-Check

Remind the user about critical security items from the last audit:
- Is `.env.local` in `.gitignore`?
- Are API keys rotated since last exposure?
- Are admin emails still hardcoded (should be env vars)?

Check with:
```bash
grep -r "env.local" goatbot-app/.gitignore
grep -rn "kaisuupgrades" goatbot-app/src/app/api/ | head -10
```

## Output Format

Present results as a status dashboard:

```
GOATBOT HEALTH CHECK — [date/time]

Pick Grading:     [OK / WARNING / ISSUE] — [details]
Odds Cache:       [OK / WARNING / ISSUE] — [details]
Game Analyses:    [OK / WARNING / ISSUE] — [details]
Daily Trends:     [OK / WARNING / ISSUE] — [details]
Cron Logging:     [OK / WARNING / ISSUE] — [details]
Security:         [OK / WARNING / ISSUE] — [details]

ACTIONS NEEDED:
1. [action item if any]
2. [action item if any]
```

If everything is healthy, say so clearly and move on. Don't over-explain when things are fine.
