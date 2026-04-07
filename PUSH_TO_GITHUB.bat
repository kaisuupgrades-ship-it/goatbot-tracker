@echo off
echo ========================================
echo   BetOS - Push to GitHub + Deploy
echo ========================================
echo.

cd /d "%~dp0"

echo [1/5] Clearing any stuck git lock files...
if exist ".git\HEAD.lock"        del /f /q ".git\HEAD.lock"
if exist ".git\index.lock"       del /f /q ".git\index.lock"
if exist ".git\COMMIT_EDITMSG.lock" del /f /q ".git\COMMIT_EDITMSG.lock"
if exist ".git\config.lock"      del /f /q ".git\config.lock"
if exist ".git\MERGE_HEAD.lock"  del /f /q ".git\MERGE_HEAD.lock"
if exist ".git\rebase-merge"     rmdir /s /q ".git\rebase-merge"
echo Done.
echo.

git config user.email "kaisuupgrades@gmail.com"
git config user.name "kaisuupgrades-ship-it"

echo [2/5] Pulling latest from GitHub (sync before push)...
git pull --rebase origin main
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   Pull failed - trying merge instead...
    git pull origin main
)
echo.

echo [3/5] Staging all changes...
git add -A

echo [4/5] Committing...
git diff --cached --quiet
if %ERRORLEVEL% EQU 0 (
    echo Nothing new to commit - will still push any unpushed commits.
) else (
    for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set dt=%%I
    set TIMESTAMP=%dt:~0,4%-%dt:~4,2%-%dt:~6,2% %dt:~8,2%:%dt:~10,2%
    git commit -m "BetOS update - %TIMESTAMP%"
)
echo.

echo [5/5] Pushing to GitHub (Vercel will auto-deploy)...
git push origin main
set PUSH_RESULT=%ERRORLEVEL%

echo.
echo ========================================
if %PUSH_RESULT% EQU 0 (
    echo   SUCCESS! Pushed to GitHub.
    echo   Vercel deploy will start in ~30 seconds.
    echo   Check: https://vercel.com/lead-forgev1/goatbot-tracker
) else (
    echo   Push failed - check the error above.
    echo   If it asks to sign in, use your browser to authenticate.
)
echo ========================================
echo.
pause
