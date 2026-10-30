@echo off
cd /d "%~dp0"
title ISSB ASPIRANTS local server
echo ============================================
echo   ISSB ASPIRANTS - starting your local site
echo ============================================
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  echo Found Node.js - starting server on http://localhost:8000
  echo Your browser will open automatically. Keep this window open.
  node serve.mjs
  goto :done
)

where python >nul 2>nul
if %errorlevel%==0 (
  echo Found Python - starting server on http://localhost:8000
  start "" http://localhost:8000/index.html
  python -m http.server 8000
  goto :done
)

where py >nul 2>nul
if %errorlevel%==0 (
  echo Found Python launcher - starting server on http://localhost:8000
  start "" http://localhost:8000/index.html
  py -m http.server 8000
  goto :done
)

echo.
echo Neither Node.js nor Python was found on this computer.
echo Install Node.js (LTS) from https://nodejs.org, then double-click
echo this file again.
echo.
pause
exit /b 1

:done
echo.
echo The server has stopped. You can close this window.
pause
