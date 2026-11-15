@echo off
setlocal
call "%~dp0atlas-os-website\preview-website.cmd"
exit /b %errorlevel%
