@echo off
REM ─────────────────────────────────────────────────────────────────────
REM  Barangay AI — start Ollama so the browser can reach it.
REM
REM  Double-click this file, or run it from a terminal. It does the two
REM  things the app needs, in the right order:
REM    1. frees port 11434 if a stale Ollama is already holding it
REM    2. starts the server with OLLAMA_ORIGINS=* so the browser is
REM       allowed to talk to it (without this you get a CORS error)
REM
REM  Step 1 is SKIPPED when the running server is already browser-reachable.
REM  Killing a healthy Ollama drops the loaded model out of memory, and the
REM  next reply then waits on a cold reload from disk for nothing.
REM
REM  Tired of running this? Make it permanent instead — see README
REM  "Skip this step forever".
REM ─────────────────────────────────────────────────────────────────────

title Barangay AI - Ollama

where ollama >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Ollama is not installed, or not on your PATH.
  echo   Get it free at https://ollama.com then run this again.
  echo.
  pause
  exit /b 1
)

REM ── Is it already running AND browser-reachable? ─────────────────────
REM origins-probe.invalid is a hostname nothing could legitimately allow.
REM Ollama's own defaults permit localhost origins, so probing with a
REM localhost origin would answer "reachable" on a server with no
REM OLLAMA_ORIGINS set at all. Only a wildcard allows this one — so a CORS
REM header back proves the server is already configured the way this
REM script would configure it. No curl (pre-1803 Windows) means no probe,
REM so we fall through to the restart path.
set "OLLAMA_READY="
set "OLLAMA_HDRS=%TEMP%\barangay-ai-ollama-probe.txt"

where curl >nul 2>&1
if not errorlevel 1 (
  curl -s -m 3 -H "Origin: http://origins-probe.invalid" -D "%OLLAMA_HDRS%" -o nul http://127.0.0.1:11434/api/tags >nul 2>&1
  if not errorlevel 1 (
    findstr /i /c:"access-control-allow-origin" "%OLLAMA_HDRS%" >nul 2>&1 && set "OLLAMA_READY=1"
  )
  if exist "%OLLAMA_HDRS%" del "%OLLAMA_HDRS%" >nul 2>&1
)

if defined OLLAMA_READY (
  echo.
  echo   Ollama is already running and the browser can reach it.
  echo   Nothing to do. Go back to the app and send a message.
  echo.
  pause
  exit /b 0
)

echo.
echo   [1/2] Stopping any Ollama that is already running...
taskkill /F /IM "ollama.exe" >nul 2>&1
taskkill /F /IM "ollama app.exe" >nul 2>&1

REM Give Windows a moment to actually release port 11434 before rebinding.
timeout /t 2 /nobreak >nul

echo   [2/2] Starting Ollama with browser access enabled...
echo.
echo   Leave this window OPEN while you use the app.
echo   Press Ctrl+C to stop the server.
echo.

set "OLLAMA_ORIGINS=*"
ollama serve

REM Only reached if the server exits — keep the window up so the user can
REM read the error instead of watching it flash closed.
echo.
echo   Ollama stopped. Read any message above, then close this window.
pause
