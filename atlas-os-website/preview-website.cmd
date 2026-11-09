@echo off
setlocal

title Atlas OS Website - Live Preview
cd /d "%~dp0"

echo ======================================================
echo   ATLAS OS WEBSITE - ONE-CLICK LIVE PREVIEW
echo ======================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is required. Install Node.js and try again.
  pause
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm could not be found in your PATH.
  pause
  exit /b 1
)

if not exist "node_modules\astro\astro.js" (
  echo [INFO] Installing website dependencies from the lockfile...
  call npm ci
  if errorlevel 1 (
    echo [ERROR] npm ci failed; check the terminal output.
    pause
    exit /b 1
  )
)

netstat -ano | findstr ":4321 " | findstr LISTENING >nul 2>&1
if errorlevel 1 (
  echo [INFO] Starting Astro live development server...
  start "Atlas OS Website Live Server" cmd /k "npm run dev -- --host 127.0.0.1 --port 4321"
  timeout /t 4 /nobreak >nul
) else (
  echo [INFO] A server is already listening on port 4321.
)

echo [INFO] Opening http://localhost:4321/
start "" "http://localhost:4321/"
echo.
echo Edit src\pages or src\components to see hot-reloaded changes.
echo Close the Live Server window to stop the development server.
echo.
