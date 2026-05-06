@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
    node server.js
    if not %errorlevel%==0 pause
) else if exist "%~dp0tools\node\node.exe" (
    "%~dp0tools\node\node.exe" server.js
    if not %errorlevel%==0 pause
) else (
    echo Node.js er paakraevet for at starte kortserveren.
    echo Installer Node.js 18 eller nyere, eller hent den lokale fallback-binary, og koer start-map.bat igen.
    pause
)
