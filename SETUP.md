# GOAT BOT Tracker — Deployment Guide

## What you're deploying
A full-stack web app where anyone can sign up, track their sports picks, and run AI-powered analysis. Built with Next.js + Supabase + xAI (Grok-4).

---

## Step 1 — Create your Supabase project (free)

1. Go to **https://supabase.com** and sign up (free)
2. Click **New project**, give it a name (e.g. "goatbot"), choose a region, set a password
3. Wait ~2 min for it to spin up
4. Go to **SQL Editor** → **New query** — run these two files in order:
   - First: paste `supabase/schema.sql` and hit **Run**
   - Then: paste `supabase_leaderboard_migration.sql` and hit **Run** (adds profiles + leaderboard columns)
5. Go to **Settings → API** and copy:
   - `Project URL` (looks like `https://abc123.supabase.co`)
   - `anon` / `public` key
   - `service_role` secret key (needed for Admin Panel — keep this server-only!)

---

## Step 2 — Set up the project locally

```bash
cd goatbot-app
npm install
cp .env.example .env.local
```

Edit `.env.local` with your values:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...   # from Supabase Settings → API → service_role (Admin Panel uses this)
XAI_API_KEY=xai-your-new-key-here       # from https://console.x.ai
ODDS_API_KEY=your-odds-api-key          # from https://odds-api.io
```

> **⚠️ Security:** Your xAI API key was visible in this chat session. Rotate it immediately at https://console.x.ai before deploying.

Run locally:
```bash
npm run dev
# Open http://localhost:3000
```

---

## Step 3 — Seed your existing picks

After you create an account in the app:
1. Go to Supabase Dashboard → **Authentication → Users**
2. Copy your user UUID
3. Go to **SQL Editor** and run the seed query at the bottom of `supabase/schema.sql` (replace `YOUR-USER-UUID`)

Or just use the **History tab** to manually add your picks through the UI.

---

## Step 4 — Deploy to Vercel (free, live in 2 minutes)

1. Push this folder to a GitHub repo:
   ```bash
   cd goatbot-app
   git init
   git add .
   git commit -m "Initial GOAT BOT Tracker"
   git remote add origin https://github.com/YOUR_USERNAME/goatbot-tracker.git
   git push -u origin main
   ```

2. Go to **https://vercel.com** → **New Project** → Import your GitHub repo

3. In the **Environment Variables** section, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only — Vercel keeps this secret)
   - `XAI_API_KEY`
   - `ODDS_API_KEY`

4. Click **Deploy** — you'll get a live URL like `https://goatbot-tracker.vercel.app`

5. Share that URL with anyone you want to give access

---

## Features

### Tab 1: Tracker Dashboard
- Real-time stats: record, units P/L, ROI, streak, pace projection
- Equity curve chart
- 30-day contest calendar (color-coded wins/losses)
- Recent picks list

### Tab 2: Pick History
- Add, edit, delete picks
- Contest settings (name, start date, bankroll)
- Filter by result and sport
- Sortable table with all pick details
- Auto-calculates profit based on odds + result

### Tab 3: Analyzer
- **GOAT BOT Live** — real-time AI pick generation via Grok-4 + live web search
- **Filter Analysis** — P/L breakdown by sport, odds range, bet type
- **Kelly Calculator** — optimal bet sizing from edge estimate
- **Head-to-Head Scorer** — factor-by-factor matchup scorecard

---

## Customizing

- Change the 30-day contest length: edit `buildCalendar()` in `TrackerTab.jsx`
- Change the GOAT BOT system prompt: edit `SYSTEM_PROMPT` in `src/app/api/goatbot/route.js`
- Add sports / bet types / books: edit the arrays at the top of `HistoryTab.jsx`
- Invite specific users: create accounts for them via Supabase Auth dashboard, or enable email signups

---

## Tech Stack

| Layer | Tech | Why |
|-------|------|-----|
| Frontend | Next.js 14 (App Router) | React framework, easy Vercel deploy |
| Auth + DB | Supabase | Free tier, Postgres, built-in RLS auth |
| AI | xAI Grok-4 | Live web search, sharp analysis |
| Charts | Recharts | Clean React-native charting |
| Styling | Tailwind CSS | Utility classes, dark theme |
| Deploy | Vercel | Free tier, auto-deploys from GitHub |
