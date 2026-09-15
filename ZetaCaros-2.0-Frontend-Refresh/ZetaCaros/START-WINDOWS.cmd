@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS, then run this file again.
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) !== 24) { console.error('Please use Node.js 24 LTS.'); process.exit(1); }"
if errorlevel 1 (
  pause
  exit /b 1
)
echo ZetaCaros 2.0 - Inventory and sales
echo No npm install is required for normal use.
echo Open the URL printed after the ready message in your browser.
echo Keep this window open. Press Ctrl+C to stop the server.
node backend/src/app.js
pause
