@echo off
setlocal EnableExtensions
title StreamHouse

rem --------------------------------------------------------------------
rem  StreamHouse launcher for Windows.
rem
rem  Double-click this file (or the desktop shortcut that points at it) to
rem  start the media centre and open it in a window of its own. This
rem  console window *is* StreamHouse: closing it stops the server.
rem --------------------------------------------------------------------

rem This script lives in streamhouse\windows\ ; the app itself is one up.
cd /d "%~dp0.." || exit /b 1

if not defined PORT set "PORT=11471"
set "URL=http://127.0.0.1:%PORT%"

rem The app opens in Edge's app mode - its own window and taskbar icon, no tabs,
rem no address bar. Edge ships with Windows 10 and 11; without it, a browser tab.
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE="

echo.
echo   StreamHouse
echo   ===========
echo.

rem ---- 1. already running? Just open it, do not start a second copy ----
curl.exe -s -o nul --max-time 2 "%URL%/api/health" >nul 2>&1
if not errorlevel 1 (
  echo   Already running - opening it.
  call :open
  exit /b 0
)

rem ---- 2. find Node --------------------------------------------------
set "NODE="
for /f "delims=" %%N in ('where node 2^>nul') do if not defined NODE set "NODE=%%N"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LocalAppData%\Programs\nodejs\node.exe" set "NODE=%LocalAppData%\Programs\nodejs\node.exe"

if not defined NODE (
  echo   Node.js is not installed, and StreamHouse needs it to run.
  echo.
  echo   Install the LTS build from https://nodejs.org - the page is
  echo   opening now - then double-click this again.
  echo.
  start "" "https://nodejs.org/en/download"
  pause
  exit /b 1
)

rem npm sits next to node; fall back to whatever is on PATH.
for %%D in ("%NODE%") do set "NPM=%%~dpDnpm.cmd"
if not exist "%NPM%" set "NPM=npm"

rem ---- 3. dependencies, on first run ---------------------------------
if not exist "node_modules\express\package.json" (
  echo   First run - installing dependencies. This takes a minute.
  echo.
  call "%NPM%" install --no-audit --no-fund
  if errorlevel 1 goto :failed
  echo.
)

rem ---- 4. open the app once the server actually answers ---------------
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='%URL%'; $e='%EDGE%'; for($i=0; $i -lt 120; $i++){ try { Invoke-WebRequest -Uri ($u + '/api/health') -UseBasicParsing -TimeoutSec 1 | Out-Null; if($e){ Start-Process $e ('--app=' + $u) } else { Start-Process $u }; break } catch { Start-Sleep -Milliseconds 500 } }"

rem ---- 5. run it in the foreground so this window is the off switch ---
echo   Starting. Keep this window open - closing it stops StreamHouse.
"%NODE%" server\index.js
if errorlevel 1 goto :failed
exit /b 0

rem Opens the app: an Edge app window when Edge is there, a browser tab if not.
:open
if not defined EDGE goto :open_tab
start "" "%EDGE%" --app=%URL%
exit /b 0
:open_tab
start "" "%URL%"
exit /b 0

:failed
echo.
echo   StreamHouse stopped unexpectedly. The error is above.
echo.
pause
exit /b 1
