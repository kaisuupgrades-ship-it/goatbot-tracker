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
git commit -m "BetOS update"
git push origin main

set PUSH_RESULT=%ERRORLEVEL%

echo.
echo ========================================
if %PUSH_RESULT% EQU 0 goto :success
goto :fail

:success
echo   SUCCESS! Code pushed to GitHub.
echo   Vercel will auto-redeploy in ~60 seconds.
goto :done

:fail
echo   Something went wrong. Check the error above.
goto :done

:done
echo ========================================
pause
