@echo off
echo ========================================
echo   GOAT BOT - Push to GitHub
echo ========================================
echo.

cd /d "%~dp0"

git config user.email "kaisuupgrades@gmail.com"
git config user.name "kaisuupgrades-ship-it"

git add -A
git commit -m "Profile modal (avatar/username/email/phone + rate limits), leaderboard avatars, tournament banner on landing page"
git push origin main

echo.
echo ========================================
if %ERRORLEVEL% EQU 0 (
    echo   SUCCESS! Code pushed to GitHub.
    echo   Vercel will auto-redeploy in ~60 seconds.
) else (
    echo   Something went wrong. Check above for errors.
)
echo ========================================
pause
