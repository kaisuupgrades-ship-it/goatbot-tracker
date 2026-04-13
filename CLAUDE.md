# BetOS / GoatBot — AI Session Context

## What This Is
**BetOS** (live at [betos.win](https://betos.win)) — full-stack AI sports betting intelligence platform. Users track picks, analyze games with AI, view live odds/scores, and compete on a leaderboard. Next.js 14 App Router + Supabase + Vercel.

---

## Stack
- **Framework:** Next.js 14.2 (App Router, `/src` layout)
- **Database/Auth:** Supabase (Postgres + RLS + Realtime)
- **Hosting:** Vercel (auto-deploys on `git push origin main`)
- **AI:** xAI Grok 4 primary (`https://api.x.ai/v1`) + Anthropic Claude fallback
- **Odds:** The Odds API (`the-odds-api.com`) primary; `odds-api.io` legacy fallback
- **Scores:** ESPN public API (`site.api.espn.com/apis/site/v2/sports/...`)
- **UI:** React 18, Tailwind CSS (CDN only — no JIT), Recharts

---

## Key Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY       # server-only routes
XAI_API_KEY                     # Grok 4 — primary AI
ANTHROPIC_API_KEY               # Claude fallback
THE_ODDS_API_KEY                # The Odds API
ODDS_API_KEY                    # Legacy odds-api.io (fallback only)
CRON_SECRET                     # Protects /api/cron/* routes
NEXT_PUBLIC_SITE_URL            # https://betos.win
```

---

## Project Structure
```
src/app/api/
  admin/                # Admin actions, broadcast, system info
  cron/
    grade-picks/          # Every 5 min during game hours
    pregenerate-analysis/ # 8am + 4pm ET — pre-games only
    trends/               # 9am + 5pm ET
    grade-check/          # Every 2h safety net for missed grades
  goatbot/              # Main AI analysis engine (Grok 4 + web search)
  odds/                 # Live odds → Supabase cache → UI
  picks/                # CRUD for user picks
  injury-intel/         # Injury/lineup scanner (xAI + live search)
  leaderboard/          # Public leaderboard + contest standings

src/components/tabs/
  ScoreboardTab.jsx     # Main scoreboard — scores, odds, weather, injuries
  AnalyzerTab.jsx       # AI game analysis + pick report
  OddsTab.jsx           # Live odds board
  TrackerTab.jsx        # Pick + unit tracker

src/lib/
  gradeEngine.js        # Shared grading logic (cron + manual)
  ai.js                 # Shared AI call helpers
  supabase.js           # Supabase client + auth helpers
```

---

## Critical Rules

<important>
**Before every commit:**
- Run `npm run build` — if it fails, fix it before pushing. No exceptions.
- Verify no regressions: grading, odds display, and AI analysis must still work.
- Every changed line must trace directly to the request. If you touched it, justify it.
</important>

<important>
**Code discipline:**
- Surgical changes only. Don't refactor adjacent code, reformat, or "improve" things not asked about.
- Match existing style exactly — naming conventions, error handling patterns, import order.
- Minimum code that solves the problem. If you write 200 lines and it could be 50, rewrite it.
- No abstractions for single-use code. No features beyond what was asked.
- If something is unclear, stop. Name what's confusing. Ask. Don't guess silently.
</important>

### Odds Pipeline
1. Client → `/api/odds?sport=<key>` → L1 in-memory cache (5 min) → L2 Supabase cache → The Odds API
2. **Pinnacle odds are decimal format** — convert via `pinPriceToAmerican()` in `odds/route.js`
3. **Price validation is mandatory** — use `validML()`, `validSpreadJuice()`, `validTotal()` in `ScoreboardTab.jsx`:
   - ML: `|price| >= 100 && |price| <= 1500` | Spread juice: `|price| >= 100 && |price| <= 300`
   - Totals: sport-specific (MLB: 5–16, NBA: 170–260, NHL: 3–10)
4. **Scan ALL bookmakers** — never only `bookmakers[0]`; prefer a book with both sides valid
5. Clear stale odds cache: `DELETE FROM settings WHERE key LIKE 'odds_cache_%'`

### AI Analysis (GoatBot)
- Primary model: `grok-4` via xAI in `/api/goatbot/route.js` — `maxDuration = 300`
- Analyses pre-generated into `game_analyses` by the pregenerate cron
- User request flow: check cache → freshness delta if fresh → full generation if stale
- **Pregenerate cron runs for `state === 'pre'` only** — never re-add `state === 'in'`, wastes tokens

### Team Logos (AnalyzerTab)
- `TEAM_SPORT_MAP` maps team name → sport; `SPORT_ABBR_MAP` has per-sport abbreviation maps
- **Never use a flat cross-sport abbreviation map** — causes wrong logos across sports
- ESPN CDN: `https://a.espncdn.com/i/teamlogos/{sport}/500/{abbr}.png`

### Security Patterns (follow on every new route)
- Require JWT auth for any user-modifying operation
- Use anon key + RLS for public reads; service role for admin/cron only
- Never hardcode emails or secrets — use env vars (`ADMIN_EMAILS`, etc.)
- Never accept `userId` from request body — verify via Supabase JWT
- Cron routes: fail-closed — if `CRON_SECRET` is unset, return 503

---

## Cron Jobs

| Route | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/grade-picks` | `*/5 15-23,0-9 * * *` | Grade picks during game hours |
| `/api/cron/pregenerate-analysis` | 12:00, 14:00, 16:00 | Pre-generate AI analyses |
| `/api/cron/pregenerate-analysis?retry=true` | 16:05 | Retry games with null prediction_pick |
| `/api/cron/trends` | 9:00, 17:00 | Refresh AI trend analysis |
| `/api/cron/grade-check` | `0 */2 * * *` | Safety net for ungraded picks |
| `/api/cron/refresh-odds` | `*/15 * * * *` | Keep odds_cache fresh |

All cron routes require `Authorization: Bearer <CRON_SECRET>`.

---

## Supabase Key Tables

| Table | Purpose |
|---|---|
| `picks` | User picks — `user_id`, `sport`, `team`, `bet_type`, `odds`, `result`, `contest_entry` |
| `profiles` | User profiles — username, avatar, bio, role |
| `settings` | Key-value store — odds cache, cron logs (`cron_*_last_run`), announcements |
| `game_analyses` | Pre-generated AI reports — keyed by `sport + game_date + home_team + away_team` |
| `odds_cache` | Per-game odds rows — `sport`, `game_id`, `home_team`, `away_team`, `odds_data` |
| `messages` | DM/inbox messages |

---

## Deployment & Git

- `git push origin main` → Vercel auto-deploys (~1-2 min) → `https://betos.win`
- Vercel project: `goatbot-tracker`
- **Stuck lock files:** `rm .git/index.lock .git/HEAD.lock` (Git Bash — not `del`)
- **Smart quote bug:** Pasting from chat inserts Unicode `"` that breaks bash — type quotes manually
- **Always push to `main`**
