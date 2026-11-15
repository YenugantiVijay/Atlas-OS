@echo off
setlocal
cd /d "%~dp0"
title Atlas OS ERP - Local Preview

where node >nul 2>&1
if errorlevel 1 goto missing_tools
where npm >nul 2>&1
if errorlevel 1 goto missing_tools

if not exist "node_modules\.bin\vite.cmd" goto install
node scripts\check-zod-version.mjs >nul 2>&1
if not errorlevel 1 goto serve

:install
echo [INFO] Installing ERP dependencies...
call npm ci --no-audit --no-fund
if errorlevel 1 goto startup_failed

:serve
echo [INFO] Opening Atlas OS ERP at http://127.0.0.1:5173/
echo Keep this window open while using the preview.
call npm run dev -- --open
if errorlevel 1 goto startup_failed
exit /b 0

:missing_tools
echo [ERROR] Install Node.js LTS with npm, then reopen this launcher.
pause
exit /b 1

:startup_failed
echo [ERROR] The ERP preview did not start. See the message above.
pause
exit /b 1
