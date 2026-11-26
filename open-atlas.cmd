@echo off
setlocal
cd /d "%~dp0"
title Atlas OS - Local Live Servers

:menu
echo.
echo Atlas OS local live servers
echo.
echo   W  Website
echo   E  ERP Tool
echo   O  Owner Portal
echo   A  Open all three
echo   Q  Quit
echo.
choice /C WEOAQ /N /M "Choose a preview [W/E/O/A/Q]: "
if errorlevel 255 exit /b 1
if errorlevel 5 exit /b 0
if errorlevel 4 goto open_all
if errorlevel 3 goto open_owner
if errorlevel 2 goto open_erp
if errorlevel 1 goto open_website
exit /b 1

:open_website
call "%~dp0preview-website.cmd"
goto menu

:open_erp
call "%~dp0preview-tool.cmd"
goto menu

:open_owner
call "%~dp0preview-owner.cmd"
goto menu

:open_all
start "Atlas OS Website Preview" /D "%~dp0atlas-os-website" "%ComSpec%" /d /c preview-website.cmd
if errorlevel 1 echo [ERROR] Could not launch the website window. Press W to retry it separately.
call "%~dp0preview-tool.cmd" both
goto menu
