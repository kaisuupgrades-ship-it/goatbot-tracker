@echo off
echo ========================================
echo   GOAT BOT - Push to GitHub
echo ========================================
echo.

cd /d "%~dp0"

git config user.email "kaisuupgrades@gmail.com"
git config user.name "kaisuupgrades-ship-it"

git add -A
git commit -m "Auto-analyze picks, scoreboard merge refresh, contest rules (1/day -145 locked), AI audit, sidebar fix, odds board unified"
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
