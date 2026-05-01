@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
    node server.js
) else (
    python server.py
)
