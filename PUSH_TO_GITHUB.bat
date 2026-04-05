@echo off
echo ========================================
echo   BetOS - Push to GitHub
echo ========================================
echo.

cd /d "%~dp0"

echo Clearing any stuck git lock files...
if exist ".git\HEAD.lock"  del /f /q ".git\HEAD.lock"
if exist ".git\index.lock" del /f /q ".git\index.lock"
if exist ".git\COMMIT_EDITMSG.lock" del /f /q ".git\COMMIT_EDITMSG.lock"
if exist ".git\config.lock" del /f /q ".git\config.lock"
echo Done.
echo.

git config user.email "kaisuupgrades@gmail.com"
git config user.name "kaisuupgrades-ship-it"

git add -A
git commit -m "DK-style bet slips, tab-switch fix, sound effects, scan animation, Add as Pick"
git push origin main

echo.
echo ========================================
if %ERRORLEVEL% EQU 0 (
    echo   SUCCESS! Code pushed to GitHub.
    echo   Vercel will auto-redeploy in ~60 seconds.
    echo.
    echo   Changes in this push:
    echo   - Pick History: DraftKings-style bet slip cards (replaces table)
    echo     Color-coded left border by result, odds/result/P/L stats row
    echo   - Tab-switch fix: server-side prompt cache (Supabase prompt_cache table)
    echo     Retries return instantly even if browser killed the first connection
    echo   - Auto-retry: detects Load failed / Failed to fetch and silently retries once
    echo   - WIN/LOSS sound effects fire when picks are graded (HistoryTab + Dashboard)
    echo   - TrendsTab: animated gold progress bar replaces loading skeleton
    echo     8-step scan animation with emoji labels and real-time percentage
    echo   - Analyzer: Add as Pick button auto-fills team/odds/bet type from AI report
    echo     User only selects unit size (0.5u / 1u / 2u / 3u / 5u)
    echo   - Pre-generation: per-sport API calls fix timeout, safe JSON parse fallback
    echo   - Tech stack hidden: all AI model labels show BetOS AI to users
) else (
    echo   Something went wrong. Check the error above.
)
echo ========================================
pause
