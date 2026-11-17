@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 goto missing_tools
where npm >nul 2>&1
if errorlevel 1 goto missing_tools

set "ATLAS_PREVIEW_MODE=development"
if exist ".env.staging" set "ATLAS_PREVIEW_MODE=staging"
if exist ".env.staging.local" set "ATLAS_PREVIEW_MODE=staging"

node scripts\wait-for-erp.mjs %ATLAS_PREVIEW_MODE% --probe
if errorlevel 2 goto startup_failed
if not errorlevel 1 goto open_browser

if not exist "node_modules\.bin\vite.cmd" goto install
node scripts\check-zod-version.mjs >nul 2>&1
if not errorlevel 1 goto serve

:install
echo [INFO] Installing ERP dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 goto startup_failed

:serve
echo [INFO] Starting the shared ERP and Owner Portal server in %ATLAS_PREVIEW_MODE% mode...
start "Atlas OS ERP and Owner Portal" cmd /d /k "npm run dev -- --mode %ATLAS_PREVIEW_MODE%"
node scripts\wait-for-erp.mjs %ATLAS_PREVIEW_MODE%
if errorlevel 1 goto startup_failed

:open_browser
if /i "%~1"=="owner" goto open_owner
start "" "http://127.0.0.1:5173/"
if /i not "%~1"=="both" exit /b 0

:open_owner
start "" "http://localhost:5173/owner/"
exit /b 0

:missing_tools
echo [ERROR] Install Node.js LTS with npm, then reopen this launcher.
pause
exit /b 1

:startup_failed
echo [ERROR] The ERP and Owner Portal preview could not open. See the message above.
pause
exit /b 1
