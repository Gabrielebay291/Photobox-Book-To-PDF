@echo off
setlocal EnableExtensions
title Photobox Book to PDF
cd /d "%~dp0"

REM --- Require Node.js -------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  echo Install it from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

REM --- Install dependencies on first run ------------------------------------
if not exist "node_modules\" (
  echo First run: installing dependencies. This can take a few minutes...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    echo.
    pause
    exit /b 1
  )
)

set "PORT=3000"

echo.
echo ============================================================
echo   Photobox Book to PDF
echo   Open:  http://localhost:%PORT%
echo.
echo   Keep this window open while you use the app.
echo   Closing it (or pressing Ctrl+C) stops the server.
echo ============================================================
echo.

REM Open the browser a moment after the server has started.
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:%PORT%/'"

REM Run the server in THIS console (foreground). Because node shares this
REM window's console, closing the window or pressing Ctrl+C makes Windows
REM terminate node and any child processes it spawned -- no orphans.
node server.mjs

REM --- Safety net -----------------------------------------------------------
REM Reached only when node exits on its own (normal quit / Ctrl+C). Make sure
REM nothing is still listening on the port before we close.
echo.
echo Stopping server...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  taskkill /F /PID %%p >nul 2>&1
)

endlocal
