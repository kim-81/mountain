@echo off
cd /d "%~dp0"
set "TRAIL_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "TRAIL_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not "%TRAIL_NODE%"=="node" if not exist "%TRAIL_NODE%" (
  echo Node.js is required. See README.md.
  pause
  exit /b 1
)
"%TRAIL_NODE%" scripts\serve.mjs --open
pause
