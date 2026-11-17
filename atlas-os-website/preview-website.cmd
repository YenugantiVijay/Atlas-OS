@echo off
setlocal
cd /d "%~dp0"
title Atlas OS Website - Local Preview

where node >nul 2>&1
if errorlevel 1 goto missing_tools
where npm >nul 2>&1
if errorlevel 1 goto missing_tools

set "ATLAS_WEBSITE_STATE="
set "ATLAS_WEBSITE_PORT="
for /f "tokens=1,2" %%A in ('node scripts\wait-for-website.mjs --select-port') do (
  set "ATLAS_WEBSITE_STATE=%%A"
  set "ATLAS_WEBSITE_PORT=%%B"
)
if not defined ATLAS_WEBSITE_PORT goto startup_failed
if /i "%ATLAS_WEBSITE_STATE%"=="ready" goto open_browser

call npm run preview:prepare
if errorlevel 1 goto startup_failed

echo [INFO] Starting the website on port %ATLAS_WEBSITE_PORT%...
start "Atlas OS Website Live Server" cmd /d /k "npm run preview:serve -- --port %ATLAS_WEBSITE_PORT%"
node scripts\wait-for-website.mjs --port=%ATLAS_WEBSITE_PORT%
if errorlevel 1 goto startup_failed

:open_browser
echo [OK] Opening the website at http://127.0.0.1:%ATLAS_WEBSITE_PORT%/.
start "" "http://127.0.0.1:%ATLAS_WEBSITE_PORT%/"
if errorlevel 1 goto startup_failed
exit /b 0

:missing_tools
echo [ERROR] Install Node.js LTS with npm, then reopen this launcher.
pause
exit /b 1

:startup_failed
echo [ERROR] The website preview could not open. See the message above or in the Website Live Server window.
pause
exit /b 1
