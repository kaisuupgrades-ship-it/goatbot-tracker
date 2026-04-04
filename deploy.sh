#!/bin/bash
# GOAT BOT — One-command deploy script
# Run: bash deploy.sh

set -e
echo ""
echo "🐐 GOAT BOT DEPLOY"
echo "═══════════════════"

# 1. Check prerequisites
command -v git >/dev/null 2>&1 || { echo "❌ git not found. Install it first."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "❌ node not found. Install Node.js 18+."; exit 1; }

# 2. Check .env.local exists
if [ ! -f .env.local ]; then
  echo "⚠️  No .env.local found. Copying from .env.example..."
  cp .env.example .env.local
  echo "📝 Edit .env.local with your real API keys before deploying."
  echo "   Then run this script again."
  exit 1
fi

# 3. Install dependencies
echo "📦 Installing dependencies..."
npm install

# 4. Git init if needed
if [ ! -d .git ]; then
  echo "🔧 Initializing git..."
  git init -b main
  git add -A
  git commit -m "GOAT BOT v1.0 — initial deploy"
fi

# 5. GitHub repo
echo ""
echo "📡 Push to GitHub..."
if ! git remote get-url origin >/dev/null 2>&1; then
  echo ""
  echo "No GitHub remote set. Choose one:"
  echo "  Option A: Create repo with GitHub CLI (if installed):"
  echo "    gh repo create goatbot-tracker --private --source=. --push"
  echo ""
  echo "  Option B: Create manually at github.com/new, then:"
  echo "    git remote add origin https://github.com/YOUR_USERNAME/goatbot-tracker.git"
  echo "    git push -u origin main"
  echo ""
  read -p "Enter your GitHub repo URL (or press Enter to skip): " REPO_URL
  if [ -n "$REPO_URL" ]; then
    git remote add origin "$REPO_URL"
    git push -u origin main
    echo "✅ Pushed to GitHub!"
  else
    echo "⏭️  Skipping GitHub push. You can do this later."
  fi
else
  git push -u origin main
  echo "✅ Pushed to GitHub!"
fi

# 6. Vercel deploy
echo ""
echo "🚀 Deploy to Vercel..."
if command -v vercel >/dev/null 2>&1; then
  echo "Deploying with Vercel CLI..."
  vercel --prod
else
  echo ""
  echo "Vercel CLI not found. Install it or deploy via web:"
  echo ""
  echo "  Option A: Install Vercel CLI:"
  echo "    npm i -g vercel && vercel --prod"
  echo ""
  echo "  Option B: Deploy via web:"
  echo "    1. Go to https://vercel.com/new"
  echo "    2. Import your GitHub repo"
  echo "    3. Add these environment variables:"
  echo "       NEXT_PUBLIC_SUPABASE_URL"
  echo "       NEXT_PUBLIC_SUPABASE_ANON_KEY"
  echo "       SUPABASE_SERVICE_ROLE_KEY"
  echo "       XAI_API_KEY"
  echo "       ODDS_API_KEY"
  echo "    4. Click Deploy"
fi

echo ""
echo "═══════════════════════════════"
echo "🐐 GOAT BOT deploy complete!"
echo ""
echo "⚠️  Don't forget:"
echo "  1. Set up Supabase (run supabase/schema.sql + supabase_leaderboard_migration.sql)"
echo "  2. Rotate your xAI API key at https://console.x.ai (it was exposed in chat)"
echo "  3. Add all env vars to Vercel dashboard"
echo "═══════════════════════════════"
