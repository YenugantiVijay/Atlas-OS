@echo off
setlocal

title Atlas OS Website - Open Real Live Website
cd /d "%~dp0"

echo ======================================================
echo   ATLAS OS - OPEN REAL WEBSITE WITH LIVE RELOAD
echo ======================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js and try again.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  pause
  exit /b 1
)

node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0] > 22 || (v[0] === 22 && (v[1] > 23 || (v[1] === 23 && v[2] >= 4))) ? 0 : 1)"
if errorlevel 1 (
  echo [ERROR] Install a current Node.js 24 LTS release, then retry.
  pause
  exit /b 1
)

node -e "try { const installed=require('./node_modules/astro/package.json').version; const locked=require('./package-lock.json').packages['node_modules/astro'].version; process.exit(installed === locked ? 0 : 1) } catch { process.exit(1) }" >nul 2>&1
if errorlevel 1 (
  echo [INFO] Installing website dependencies...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] Failed to install website dependencies.
    pause
    exit /b 1
  )
)

node scripts\wait-for-website.mjs --probe
if errorlevel 2 (
  pause
  exit /b 1
)
if errorlevel 1 (
  echo [INFO] Starting the official Astro development server...
  start "Atlas OS Website Live Server" cmd /k "npm run dev -- --host 127.0.0.1 --port 4321"
)

echo [INFO] Checking website startup...
node scripts\wait-for-website.mjs
if errorlevel 1 (
  echo.
  echo [ERROR] Could not open the website. Check the Live Server terminal.
  pause
  exit /b 1
)

echo [OK] Opening the actual Atlas OS homepage...
start "" "http://127.0.0.1:4321/"
echo.
echo Changes to src\pages and src\components reload in the browser.
echo To stop the server, close "Atlas OS Website Live Server".
echo.
