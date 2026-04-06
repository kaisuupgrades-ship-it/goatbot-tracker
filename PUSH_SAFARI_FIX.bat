@echo off
cd /d "%~dp0"
echo Pushing Safari unicode fix from: %CD%
echo.
git add -A
git commit -m "fix: replace emoji/unicode with ASCII for Safari compat"
git push origin main
echo.
echo ============================================
if errorlevel 1 (
    echo FAILED - check error above
) else (
    echo DONE - Vercel will deploy in ~60 seconds
    echo Check: betos.win
)
echo ============================================
pause
