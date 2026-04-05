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
git commit -m "Add Admin Panel trigger for analyzer pre-generation cache"
git push origin main

echo.
echo ========================================
if %ERRORLEVEL% EQU 0 (
    echo   SUCCESS! Code pushed to GitHub.
    echo   Vercel will auto-redeploy in ~60 seconds.
    echo.
    echo   Changes in this push:
    echo   - Analyzer cache: pre-generates reports at 8AM + 4PM ET for all games
    echo     Users get instant results + a quick news-delta check instead of 60-90s wait
    echo   - Click the TV icon on any pick to jump straight to that game on Scoreboard
    echo   - Auto-grade now runs every 5 minutes during game hours (was every 30 min)
    echo   - Pick grading: fixed null result, sport uppercase, wrong column name
    echo   - Injury Intel: Claude Opus 4.6 + live web search as primary
    echo   - GoatBot: 4-tier AI cascade with Claude + Grok web search
    echo   - Final score shows in Pick History after game grades
    echo   - Calendar shows correct day in your timezone
) else (
    echo   Something went wrong. Check the error above.
)
echo ========================================
pause
