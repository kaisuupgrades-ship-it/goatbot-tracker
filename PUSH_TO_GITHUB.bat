@echo off
echo ========================================
echo   GOAT BOT - Push to GitHub
echo ========================================
echo.

cd /d "%~dp0"

git config user.email "kaisuupgrades@gmail.com"
git config user.name "kaisuupgrades-ship-it"

git init
git add -A
git commit -m "Initial commit: GOAT BOT Tracker"
git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/kaisuupgrades-ship-it/goatbot-tracker.git
git push -u origin main --force

echo.
echo ========================================
if %ERRORLEVEL% EQU 0 (
    echo   SUCCESS! Code pushed to GitHub.
) else (
    echo   Something went wrong. Check above for errors.
)
echo ========================================
pause
