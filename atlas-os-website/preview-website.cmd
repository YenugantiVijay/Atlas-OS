@echo off
setlocal enabledelayedexpansion

title Atlas OS Website - Local Preview Launcher

echo ======================================================
echo   ATLAS OS OFFICIAL WEBSITE - LOCAL PREVIEW LAUNCHER
echo ======================================================
echo.

:: 1. Verify Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js 18+ to run the preview server.
    echo.
    pause
    exit /b 1
)

:: 2. Change directory to website folder
cd /d "%~dp0"

:: 3. Check if server is already running on port 4321
netstat -ano | findstr :4321 | findstr LISTENING >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] Preview server is already running on port 4321!
    echo Opening http://localhost:4321/ in your default browser...
    start http://localhost:4321/
    goto :done
)

:: 4. Check if production dist exists, build if missing
if not exist "dist\index.html" (
    echo [INFO] Production build files not found in dist\. Building now...
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Build failed. Please inspect the output above.
        pause
        exit /b 1
    )
)

:: 5. Launch the local preview server
echo [INFO] Starting local preview server on http://localhost:4321/ ...
start "Atlas OS Website Preview Server" /min cmd /c "node scripts\serve-preview.mjs"

:: Wait briefly for server to bind port
timeout /t 2 /nobreak >nul 2>&1

:: Open browser
echo [OK] Opening http://localhost:4321/ in your default browser...
start http://localhost:4321/

:done
echo.
echo ======================================================
echo   Website preview is active at http://localhost:4321/
echo   To stop the preview server, close its command window.
echo ======================================================
echo.
