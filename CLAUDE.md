# BetOS / GoatBot — Project Context for AI Sessions

## What This Is
**BetOS** (live at [betos.win](https://betos.win)) is a full-stack AI sports betting intelligence platform. Users track picks, analyze games with AI, view live odds/scores, and compete on a leaderboard. Built with Next.js 14 App Router + Supabase + Vercel.

---

## Stack
- **Framework:** Next.js 14.2 (App Router, `/src` layout)
- **Database/Auth:** Supabase (Postgres + Row Level Security + Realtime)
- **Hosting:** Vercel (auto-deploys on every `git push origin main`)
- **AI:** xAI Grok 4 (primary — `https://api.x.ai/v1`) + Anthropic Claude (fallback)
- **Odds:** The Odds API (`the-odds-api.com`) — primary; `odds-api.io` — legacy fallback
- **Scores:** ESPN public API (`site.api.espn.com/apis/site/v2/sports/...`)
- **Weather:** Open-Meteo (free, no key needed)
- **UI:** React 18, Tailwind CSS (via CDN classes only — no JIT compiler), Recharts

---

## Key Environment Variables
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY       # server-only routes use this
XAI_API_KEY                     # Grok 4 — primary AI
ANTHROPIC_API_KEY               # Claude fallback
THE_ODDS_API_KEY                # The Odds API
ODDS_API_KEY                    # Legacy odds-api.io (fallback only)
CRON_SECRET                     # Protects /api/cron/* routes
NEXT_PUBLIC_SITE_URL            # https://betos.win (canonical)
```

---

## Project Structure
```
src/
  app/
    api/
      admin/          # Admin actions (broadcast announcements, system info)
      auto-analyze/   # Bulk AI analysis trigger
      auto-pick/      # AI auto-pick generation
      backtest/       # Historical backtesting engine
      chat/           # ChatRoom realtime messages
      contest-audit/  # Audit picks for contest eligibility
      contest-leaderboard/
      cron/
        grade-picks/        # Runs every 5 min: 0-9, 10-14, 15-23 UTC (full 24hr coverage)
        pregenerate-analysis/ # Runs 12:00 + 20:00 UTC — only state==='pre' games
        trends/             # Runs 9:00 + 17:00 UTC
      follow/         # Follow/unfollow users
      goatbot/        # Main AI analysis engine (xAI Grok 4 + web search)
      grade-game/     # Manual single-game grading
      grade-picks/    # Manual grade trigger
      h2h/            # Head-to-head user comparison
      injury-intel/   # Injury/lineup scanner (xAI with live web search)
      insights/       # AI betting insights
      leaderboard/    # Public leaderboard
      messages/       # Inbox/DM system
      odds/           # Live odds (The Odds API → Supabase cache → UI)
      parse-slip/     # Parse bet slip screenshots/text
      picks/          # CRUD for user picks
      profile/        # User profile + avatar + password reset
      public-profile/ # Public-facing profile data
      settings/       # Key-value store (used for odds cache, cron logs, etc.)
      sports/         # ESPN sport/league listing
      transcribe/     # Voice-to-text (Whisper)
      trends/         # AI trend analysis
      user-search/    # Search users by username
      verify-game/    # Verify game data
      verify-pick/    # Verify pick outcome
      weather/        # Weather data for outdoor venues
    auth/
      callback/       # OAuth callback handler
      exchange/       # Token exchange
      reset-password/ # Password reset flow
    dashboard/        # Main app shell (server component)
    layout.js         # Root layout (fonts, metadata)
    page.js           # Landing / auth gate

  components/
    AuthPage.jsx            # Login/signup UI
    BetSlipModal.jsx        # Bet slip add/edit modal
    Dashboard.jsx           # Main client shell — tab router
    GolfLeaderboard.jsx     # Golf-specific scoreboard
    InboxPanel.jsx          # DM inbox
    ProfileModal.jsx        # Own profile editor
    PublicProfileModal.jsx  # View other users' profiles
    Sidebar.jsx             # Left nav sidebar
    TennisScoreboard.jsx    # Tennis-specific scoreboard
    VoiceInput.jsx          # Mic/voice input component
    tabs/
      AdminTab.jsx          # Admin panel (owner-only)
      AnalyzerTab.jsx       # AI game analysis + pick report
      ChatRoomTab.jsx       # Live chat room
      FeaturedGamesTab.jsx  # Starred/featured games with day navigation
      FollowingTab.jsx      # Following feed
      HistoryTab.jsx        # Pick history + stats
      LeaderboardTab.jsx    # Contest leaderboard
      OddsTab.jsx           # Live odds board
      ScoreboardTab.jsx     # Main scoreboard (scores + weather + injury intel sidebar)
      TrackerTab.jsx        # Pick tracker / unit tracker
      TrendsTab.jsx         # AI trend analysis
      UserSearchTab.jsx     # Find users
      admin/
        BacktestPanel.jsx   # Backtest runner UI

  lib/
    ai.js               # Shared AI call helpers
    contestValidation.js # Contest eligibility rules
    demoData.js         # Demo/sample data
    gradeEngine.js      # Shared pick grading logic (used by cron + manual)
    odds.js             # Odds formatting utilities
    sessionTracker.js   # Session tracking
    sounds.js           # Sound effects
    supabase.js         # Supabase client + auth/picks/profile helpers
    userPrefs.js        # Local user preferences
    weather.js          # Weather fetch + parsing
```

---

## Critical Patterns & Rules

### Odds Pipeline
1. Client calls `/api/odds?sport=<key>`
2. Route checks L1 in-memory cache (5 min) → L2 Supabase cache (5 min game window / 15 min off-peak)
3. If cache miss: fetches The Odds API, validates, stores to both caches
4. **Pinnacle odds come as decimal (European) format** — must convert via `pinPriceToAmerican()` in `odds/route.js`
5. `ScoreboardTab.jsx` enriches ESPN game data with bookmaker odds in `enrichedGames` useMemo
6. **Price validation is mandatory** — use `validML()`, `validSpreadJuice()`, `validTotal()` in `ScoreboardTab.jsx`
   - ML: `|price| >= 100 && |price| <= 1500`
   - Spread juice: `|price| >= 100 && |price| <= 300`
   - Totals: sport-specific ranges (e.g., MLB: 5–16, NBA: 170–260, NHL: 3–10)
7. When scanning bookmakers for ML, **scan ALL bookmakers** (not just `bookmakers[0]`) and prefer one with both sides valid
8. **To clear stale odds cache:** `DELETE FROM settings WHERE key LIKE 'odds_cache_%'`

### AI Analysis (GoatBot)
- Primary model: `grok-4` via xAI API (`/api/goatbot/route.js`)
- `maxDuration = 300` (5 min Vercel timeout for AI routes)
- Game analyses are pre-generated into `game_analyses` table by the pregenerate cron
- On user request: check cache first → if fresh, do a "freshness check" delta update → if stale/miss, generate fresh
- Pregenerate cron: **only runs for `state === 'pre'` games** (not `in` or `post`) to save tokens

### Cron Jobs (vercel.json)
| Route | Schedule | Purpose |
|---|---|---|
| `/api/cron/grade-picks` | Every 5 min, 0-9 UTC (8pm-4am ET) | Late/west-coast games |
| `/api/cron/grade-picks` | Every 5 min, 10-14 UTC (5am-9am ET) | Gap coverage — early afternoon |
| `/api/cron/grade-picks` | Every 5 min, 15-23 UTC (10am-6pm ET) | Main daytime + evening window |
| `/api/cron/pregenerate-analysis` | 12:00/14:00/16:00 UTC (per sport) | Pre-generate AI analyses |
| `/api/cron/trends` | 9:00 UTC + 17:00 UTC | Refresh trend analysis |

All cron routes require `Authorization: Bearer <CRON_SECRET>` header.

### Supabase Key Tables
| Table | Purpose |
|---|---|
| `picks` | User picks — fields: `user_id`, `sport`, `pick`, `odds`, `result`, `contest_entry`, `audit_status` |
| `profiles` | User profiles — username, avatar, bio, role |
| `settings` | Key-value store — `odds_cache_<sport>`, `cron_*_last_run`, announcements |
| `game_analyses` | Pre-generated AI reports — keyed by `game_id` + `sport` |
| `contests` | Per-user contest enrollment |
| `messages` | DM/inbox messages |

### Contest / Audit
- `contest_entry = true/false` — whether a pick counts toward contest standings
- `audit_status` — `'PENDING'`, `'APPROVED'`, `'REJECTED'`
- Admin can approve picks without counting them toward contest: `audit_status = 'APPROVED', contest_entry = false`
- Contest audit endpoint: `/api/contest-audit`

### Team Logo Resolution (AnalyzerTab)
- `TEAM_SPORT_MAP` maps every team name → its sport (`mlb`, `nba`, `nfl`, `nhl`)
- `SPORT_ABBR_MAP` has per-sport abbreviation maps — **never use a flat cross-sport map** (causes wrong logos)
- `teamLogoUrl(sport, name)` derives the correct sport from the team name first, ignores the fallback sport argument
- ESPN logo CDN: `https://a.espncdn.com/i/teamlogos/{sport}/500/{abbr}.png`

### Injury Intel Sidebar (ScoreboardTab)
- Manual-only — no auto-refresh interval
- Results persisted in `sessionStorage` (`intelText`, `intelTs`) — survive tab switches, clear on page refresh
- Powered by xAI with live web search via `/api/injury-intel`

### Featured Games Tab
- Day navigation: `‹ Yesterday | Today | ›` arrows + gold "Today" jump button when off today
- Per-game × unstar buttons on "no live data" pills
- `viewDate` state drives ESPN fetch for that day's slate

---

## Deployment
- `git push origin main` → Vercel auto-deploys (takes ~1-2 min)
- Production URL: `https://betos.win`
- Vercel project: `goatbot-tracker`
- All staging/preview domains redirect → `betos.win` (see `vercel.json`)

## Git Notes
- **Lock files:** `.git/index.lock` and `.git/HEAD.lock` can get stuck on the mounted Windows volume
  - Fix: `rm .git/index.lock .git/HEAD.lock` from Git Bash (not `del` — that's CMD syntax)
- **Smart quote paste bug:** Copying commands from chat can paste Unicode quotes (`"`) that break bash
  - Fix: use `git commit -am "..."` (type quotes manually) or use `-am` to skip the `git add` step
- **Branch:** `main` — always push to `main`

---

## Known Security Issues (Audit: April 5 2026)

### CRITICAL — Fix Immediately
- **`.env.local` may be in git history** — if ever committed, rotate ALL keys (xAI, Anthropic, Odds API, Groq, Supabase). Ensure `.env.local` is in `.gitignore`.
- **Admin email hardcoded in 6 routes** — `kaisuupgrades@gmail.com` is in `admin/route.js`, `backtest/route.js`, `contest-audit/route.js`, `cron/pregenerate-analysis/route.js`, `cron/trends/route.js`, `trends/route.js`. Move to `ADMIN_EMAILS` env var.

### HIGH — Auth Gaps
- **chat, follow, messages, picks routes accept spoofed user IDs** — these accept `userId` from request body without JWT verification. Add Supabase auth token validation.
- **Cron routes silently allow unauthenticated access if `CRON_SECRET` is unset** — change to fail-closed: if `!cronSecret`, return 503.
- **9 routes use service role key unnecessarily** — chat, follow, messages, contest-leaderboard, leaderboard, odds, goatbot, auto-analyze, backtest should use anon key + RLS.

### MEDIUM — Input Validation & Rate Limiting
- **No rate limiting on `/api/goatbot` and `/api/injury-intel`** — expensive AI calls, vulnerable to abuse.
- **SSRF risk in `/api/parse-slip`** — fetches arbitrary URLs from user input. Add domain allowlist or block internal IPs.
- **Avatar upload has no magic-byte validation** — only checks file size, not actual file type.
- **Multiple routes lack input validation** — admin, backtest, contest-audit, user-search accept unvalidated query params.

### Patterns to Follow When Adding New Routes
- Always require JWT auth for user-modifying operations
- Use anon key + RLS for public reads; reserve service role for admin/cron only
- Validate all query params against allowed values
- Add rate limiting for any route that calls external APIs
- Never hardcode emails/secrets — use env vars

---

## Known Operational Issues (Health Check: April 5 2026)
- **`game_analyses` table is empty** — pregenerate cron appears to not be firing or is failing silently
- **Daily trends/edges are 12+ hours stale** — trends cron at 09:00 UTC may not be running
- **Zero cron log entries in settings table** — logging writes may be failing even when crons execute
- **Pick grading IS working** — despite no logs, picks are being graded (suggests grade-picks cron runs but doesn't log)

---

## What NOT to Do
- Never use a flat cross-sport `TEAM_ABBR_MAP` — always use sport-scoped lookup to avoid wrong logos
- Never check only `bookmakers[0]` for odds — scan all bookmakers
- Never skip ML/spread/total price validation — FanDuel and others return garbage futures prices for game lines
- Never add `state === 'in'` back to the pregenerate cron filter — live games waste tokens
- Never add auto-refresh to Injury Intel — user explicitly removed it
- Never use `del` in Git Bash — use `rm`
- Never use `localStorage` in components — use `sessionStorage` for per-session persistence
- Never hardcode admin emails — use `ADMIN_EMAILS` env var
- Never use service role key for public/unauthenticated endpoints — use anon key + RLS
- Never accept `userId` from request body without JWT verification
