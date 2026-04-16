# BetOS Full Systems Audit — April 13, 2026

**Overall: 15 PASS · 3 WARNING · 1 FAIL**

---

## 1. Build Check — ✅ PASS

- Command: `npm run build`
- Exit code: **0**
- Compiled successfully — zero JS/TypeScript errors
- All 19 API routes and 6 pages built cleanly
- Note: two admin routes (`/api/admin/auto-grade-analyses`, `/api/admin/error-log`) previously failed in the worktree environment due to missing env vars at build time — confirmed clean when built from the main repo with `.env.local` present

---

## 2. Supabase Data Health

### Stuck PENDING Picks (>24h) — ✅ PASS

Query: `picks?result=eq.pending&created_at=lt.2026-04-12T00:00:00.000Z`

Result: **0 rows** — no stuck pending picks.

### Null-Result Picks — ✅ PASS

Query: `picks?result=is.null`

Result: 2 picks, both dated **2026-04-14** (tomorrow's games, not yet graded). Expected behavior.

```
id: d2a47d58  sport=ALL   team=Seattle Mariners   matchup=HOU @ SEA   date=2026-04-14
id: 4bf2f2ab  sport=ALL   team=Chicago Cubs       matchup=CHC @ PHI   date=2026-04-14
```

### Win/Loss Breakdown — ✅ PASS

Query: `picks?select=result&limit=5000`

| Result | Count |
|--------|-------|
| WIN    | 31    |
| LOSS   | 37    |
| PUSH   | 6     |
| null   | 2     |
| **Total** | **76** |

### Picks with Null `commence_time` — ⚠️ MINOR (expected)

Query: `picks?commence_time=is.null`

Result: **10 picks** — all for unsupported/manual sports with no ESPN game to match. These will not auto-grade. Expected behavior.

```
PARLAY  | 2-Leg Parlay                       | date=2026-04-09 | WIN
MLB     | Under 6.5                          | ARI @ NYM       | date=2026-04-07 | LOSS
NCAAF   | Michigan Wolverines                | Mich vs Uconn   | date=2026-04-07 | PUSH
NCAAB   | ILL vs UCONN                       | ILL at UCONN    | date=2026-04-05 | WIN
ALL     | Over 6                             | KC @ CLE        | date=2026-04-07 | PUSH
Soccer  | Roma                               | Roma @ Inter    | date=2026-04-05 | LOSS
Other   | Ludvig Aberg                       |                 | date=2026-04-05 | LOSS
Other   | 5 Pick Parlay (Under 139.5, ...)   |                 | date=2026-04-05 | LOSS
NCAAB   | Auburn                             | Tulsa at Auburn | date=2026-04-05 | WIN
MLB     | Under 7.5                          | CHC @ TB        | date=2026-04-07 | PUSH
```

### game_analyses — Apr 12 Null prediction_pick — ⚠️ ACTION NEEDED

Query: `game_analyses?game_date=in.(2026-04-12,2026-04-13)&prediction_pick=is.null`

Result: **12 analyses on Apr 12** have `prediction_pick = null` — AI generated an analysis but the pick regex failed to parse a structured pick line.

```
nhl  | New York Islanders    vs Montreal Canadiens  | 2026-04-12
mlb  | St. Louis Cardinals   vs Boston Red Sox      | 2026-04-12
mls  | Columbus Crew         vs Orlando City SC      | 2026-04-12
mlb  | Milwaukee Brewers     vs Washington Nationals | 2026-04-12
nba  | San Antonio Spurs     vs Denver Nuggets       | 2026-04-12
mlb  | Cincinnati Reds       vs Los Angeles Angels   | 2026-04-12
nhl  | New Jersey Devils     vs Ottawa Senators      | 2026-04-12
nhl  | Anaheim Ducks         vs Vancouver Canucks    | 2026-04-12
nba  | Miami Heat            vs Atlanta Hawks        | 2026-04-12
nhl  | Calgary Flames        vs Utah Mammoth         | 2026-04-12
+ 2 more (mlb/mls)
```

**Mitigation:** The new retry cron (`5 16 * * *` → 12:05 PM ET) will re-analyze all 12 of these today.

### game_analyses — Apr 13 (Today) — ✅ PASS

**20 analyses for today, all have `prediction_pick`.**

```
[PICK] MLB | Athletics vs Texas Rangers               | updated=2026-04-13T04:13 | src=scheduled_task
[PICK] MLB | Dodgers vs New York Mets                 | updated=2026-04-13T04:13 | src=scheduled_task
[PICK] MLB | Baltimore Orioles vs Arizona Diamondbacks| updated=2026-04-13T04:12 | src=scheduled_task
[PICK] MLB | Pittsburgh Pirates vs Washington Nationals| updated=2026-04-13T04:12 | src=scheduled_task
[PICK] MLB | Philadelphia Phillies vs Chicago Cubs    | updated=2026-04-13T04:12 | src=scheduled_task
[PICK] MLB | Seattle Mariners vs Houston Astros       | updated=2026-04-13T04:12 | src=scheduled_task
[PICK] MLB | New York Yankees vs Los Angeles Angels   | updated=2026-04-13T04:12 | src=scheduled_task
[PICK] MLB | Atlanta Braves vs Miami Marlins          | updated=2026-04-13T04:13 | src=scheduled_task
[PICK] MLB | Minnesota Twins vs Boston Red Sox        | updated=2026-04-13T04:13 | src=scheduled_task
[PICK] MLB | St. Louis Cardinals vs Cleveland Guardians| updated=2026-04-13T04:13 | src=scheduled_task
[PICK] NHL | Vegas Golden Knights vs Winnipeg Jets    | updated=2026-04-13T04:16 | src=scheduled_task
[PICK] NHL | Seattle Kraken vs Los Angeles Kings      | updated=2026-04-13T04:16 | src=scheduled_task
[PICK] NHL | Philadelphia Flyers vs Carolina Hurricanes| updated=2026-04-13T04:15 | src=scheduled_task
[PICK] NHL | Tampa Bay Lightning vs Detroit Red Wings | updated=2026-04-13T04:15 | src=scheduled_task
[PICK] NHL | Toronto Maple Leafs vs Dallas Stars      | updated=2026-04-13T04:15 | src=scheduled_task
[PICK] NHL | St Louis Blues vs Minnesota Wild         | updated=2026-04-13T04:15 | src=scheduled_task
[PICK] NHL | Nashville Predators vs San Jose Sharks   | updated=2026-04-13T04:16 | src=scheduled_task
[PICK] NHL | Chicago Blackhawks vs Buffalo Sabres     | updated=2026-04-13T04:16 | src=scheduled_task
[PICK] NHL | Edmonton Oilers vs Colorado Avalanche    | updated=2026-04-13T04:16 | src=scheduled_task
[PICK] NHL | Florida Panthers vs New York Rangers     | updated=2026-04-13T04:15 | src=scheduled_task
```

All generated at ~04:12–04:16 UTC via `scheduled_task` trigger (manual/admin run overnight). The scheduled 12:00 UTC and 16:00 UTC cron passes had not yet fired at time of audit.

### game_analyses Totals (Apr 12–13)

| Metric | Value |
|--------|-------|
| Total analyses | 56 |
| Apr 12 | 36 |
| Apr 13 | 20 |
| Null prediction_pick | 12 (all Apr 12) |
| By sport | nhl: 16, nba: 15, mlb: 23, mls: 2 |
| By trigger_source | cron_4pm: 23, scheduled_task: 25, admin_per_sport: 8 |

### Duplicate Analyses — ✅ PASS

No duplicate entries (same sport + game_date + home_team + away_team) found in Apr 12–13.

---

## 3. Cron Health

### `cron_grade_last_run` — ✅ PASS
```
run_at: 2026-04-13T05:50:21.905Z
skipped: 0
```
Grade-picks cron ran today. Healthy.

### `cron_pregenerate_last_run` — ✅ PASS
```
run_at:    2026-04-12T16:01:17.430Z
generated: 31
errors:    0
skipped:   2
```
Last standard cron run was yesterday at 4pm ET. Apr 13 analyses were pre-generated via `scheduled_task` at ~4am UTC (all healthy). The 8am ET and noon ET cron passes had not yet fired at time of audit — expected.

### `cron_grade_check_last_run` — ⚠️ STALE
```
run_at: 2026-04-11T12:00:29.346Z
```
Scheduled every 2 hours (`0 */2 * * *`). Log is **2 days old**. The cron may be executing but its Supabase log write is silently failing.

### `cron_trends_last_run` — ❌ FAIL
```
run_at: N/A  (no value)
```
**No log entry has ever been written.** Scheduled at 09:00 UTC and 17:00 UTC daily. This issue was also flagged in the April 5 audit and remains unresolved. The trends cron is either not firing or its log write is broken.

---

## 4. Vercel Deployment — ✅ PASS

```
git log --oneline -5:

078fa3b Merge branch 'claude/quirky-austin': add midday retry pass for pregenerate-analysis
e85b36e feat(cron): add midday retry pass for pregenerate-analysis
50606c2 fix(grading): fix two bugs causing April 12 AI analyses to remain PENDING
e0392bd fix(build): remove duplicate cronSecret declaration in pregenerate-analysis
bbeec92 fix(security): apply production readiness audit fixes
```

Latest commit on `main` matches expected state. No drift between local and remote.

---

## 5. API Endpoint Spot Checks

### `GET https://betos.win/api/odds?sport=MLB` — ✅ PASS
- HTTP 200
- Returns multi-bookmaker data: FanDuel, BetOnline, LowVig, Caesars, and others
- Sample game: Houston Astros @ Seattle Mariners (2026-04-13T20:11Z)
- h2h, spreads markets present with valid prices

### `GET https://betos.win/api/leaderboard` — ✅ PASS
- HTTP 200
- Response keys: `leaderboard`, `userRank`, `userEntry`, `total`, `isDemo`, `filter`, `cachedAt`
- Structured correctly

---

## 6. Code Quality

### Hardcoded API Keys in `src/` — ✅ PASS
```
grep -rn "sk-ant-api|xai-|gsk_|5c1bc7a5e90" src/
→ No matches found
```

### Hardcoded Admin Emails in `src/app/api/` — ✅ PASS
```
grep -rn "kaisuupgrades@gmail|jjroh97@gmail" src/app/api/
→ No matches found
```
All admin routes correctly use `process.env.ADMIN_EMAILS`.

### `.env.local` in `.gitignore` — ✅ PASS
```
.gitignore line 26: .env*.local
.gitignore line 27: .env
```

### Silent Catch Blocks — ✅ PASS (no critical issues)

Bare `catch {}` blocks found in non-admin routes — all reviewed and acceptable:

| File | Line | Pattern | Assessment |
|------|------|---------|------------|
| `cron/grade-picks/route.js:67` | `} catch { return null; }` | Golf data parse helper — null = data unavailable | ✅ OK |
| `auto-pick/route.js:22` | `} catch {` | Auth getter — returns null on failure | ✅ OK |
| `chat/route.js` (multiple) | `/* non-critical */` | Chat analytics side-effects | ✅ OK |
| `cron/pregenerate-analysis/route.js:1397` | `/* non-critical */` | Progress write | ✅ OK |

No silent catches on critical money paths (grading, picks CRUD, AI generation).

---

## 7. Cron Schedule Verification — ✅ PASS

All 15 entries in `vercel.json` verified:

| Schedule | Path |
|----------|------|
| `*/15 * * * *` | `/api/cron/refresh-odds` |
| `0 9 * * *` | `/api/cron/trends` |
| `0 17 * * *` | `/api/cron/trends` |
| `*/5 15-23 * * *` | `/api/cron/grade-picks` |
| `*/5 0-9 * * *` | `/api/cron/grade-picks` |
| `*/5 10-14 * * *` | `/api/cron/grade-picks` |
| `0 12 * * *` | `/api/cron/pregenerate-analysis?sport=mlb` |
| `6 12 * * *` | `/api/cron/pregenerate-analysis?sport=nba` |
| `12 12 * * *` | `/api/cron/pregenerate-analysis?sport=nhl` |
| `18 12 * * *` | `/api/cron/pregenerate-analysis?sport=nfl` |
| `24 12 * * *` | `/api/cron/pregenerate-analysis?sport=mls` |
| `0 14 * * *` | `/api/cron/pregenerate-analysis` |
| `0 16 * * *` | `/api/cron/pregenerate-analysis` |
| `5 16 * * *` | `/api/cron/pregenerate-analysis?retry=true` ← new |
| `0 */2 * * *` | `/api/cron/grade-check` |

---

## Final Scorecard

| Section | Status |
|---------|--------|
| Build (`npm run build`) | ✅ PASS |
| Stuck PENDING picks (>24h) | ✅ PASS |
| Null-result picks | ✅ PASS |
| Win/Loss/Push breakdown | ✅ PASS |
| Null `commence_time` picks | ⚠️ MINOR — 10 picks, all non-standard sports, expected |
| game_analyses null pick — Apr 13 (today) | ✅ PASS |
| game_analyses null pick — Apr 12 | ⚠️ 12 affected — retry cron fires today at 16:05 UTC |
| Duplicate analyses | ✅ PASS |
| grade-picks cron | ✅ PASS — ran today at 05:50 UTC |
| pregenerate-analysis cron | ✅ PASS — Apr 13 slate healthy |
| grade-check cron log | ⚠️ STALE — last logged Apr 11, 2 days old |
| trends cron | ❌ FAIL — never logged, unresolved since Apr 5 audit |
| Vercel deployment / git state | ✅ PASS |
| `GET /api/odds?sport=MLB` | ✅ PASS — HTTP 200, valid data |
| `GET /api/leaderboard` | ✅ PASS — HTTP 200, valid data |
| Hardcoded API keys | ✅ PASS |
| Hardcoded admin emails | ✅ PASS |
| `.env.local` in `.gitignore` | ✅ PASS |
| Silent catch blocks | ✅ PASS |
| Cron schedule alignment | ✅ PASS |

**15 PASS · 3 WARNING · 1 FAIL**

---

## Open Action Items

1. **[FAIL] Trends cron never logs** — `cron_trends_last_run` has no value. Investigate `src/app/api/cron/trends/route.js` log write. Either the cron isn't firing on Vercel or the Supabase upsert is failing silently.

2. **[WARNING] grade-check log stale** — `cron_grade_check_last_run` is 2 days old despite a 2-hour schedule. Same symptom as above — likely a silent log write failure in `src/app/api/cron/grade-check/route.js`.

3. **[WARNING] Apr 12 null picks** — 12 analyses with `prediction_pick = null`. Retry cron (`5 16 * * *`) scheduled to re-analyze these today at 12:05 PM ET. Verify after 16:10 UTC that the count drops to 0.
