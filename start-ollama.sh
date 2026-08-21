#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
#  Barangay AI — start Ollama so the browser can reach it. (macOS/Linux)
#
#  Run with:  ./start-ollama.sh      (once:  chmod +x start-ollama.sh)
#
#  It does the two things the app needs, in the right order:
#    1. frees port 11434 if a stale Ollama is already holding it
#    2. starts the server with OLLAMA_ORIGINS=* so the browser is
#       allowed to talk to it (without this you get a CORS error)
#
#  Step 1 is SKIPPED when the running server is already browser-reachable.
#  Killing a healthy Ollama drops the loaded model out of memory, and the
#  next reply then waits on a cold reload from disk for nothing.
#
#  Tired of running this? Make it permanent instead — see README
#  "Skip this step forever".
# ─────────────────────────────────────────────────────────────────────
set -u

# A hostname nothing could ever legitimately allow. Ollama's own defaults
# permit localhost origins, so probing with a localhost origin would answer
# "reachable" on a server that has no OLLAMA_ORIGINS set at all. Only a
# wildcard allows this one — so a CORS header here proves the server is
# already configured the way this script would configure it.
PROBE_ORIGIN='http://origins-probe.invalid'

# Running AND wildcard-CORS-enabled? Then there is nothing to fix.
# No curl means no probe, so fall through to the restart path.
ollama_reachable() {
  command -v curl >/dev/null 2>&1 || return 1
  curl -sS -m 3 -D - -o /dev/null -H "Origin: ${PROBE_ORIGIN}" \
    http://127.0.0.1:11434/api/tags 2>/dev/null \
    | grep -qi '^access-control-allow-origin'
}

if ! command -v ollama >/dev/null 2>&1; then
  echo
  echo "  Ollama is not installed, or not on your PATH."
  echo "  Get it free at https://ollama.com then run this again."
  echo
  exit 1
fi

if ollama_reachable; then
  echo
  echo "  Ollama is already running and the browser can reach it."
  echo "  Nothing to do. Go back to the app and send a message."
  echo
  exit 0
fi

echo
echo "  [1/2] Stopping any Ollama that is already running..."
pkill -f 'ollama serve' 2>/dev/null || true
pkill -x ollama 2>/dev/null || true

# Give the OS a moment to actually release port 11434 before rebinding.
sleep 2

echo "  [2/2] Starting Ollama with browser access enabled..."
echo
echo "  Leave this terminal OPEN while you use the app."
echo "  Press Ctrl+C to stop the server."
echo

export OLLAMA_ORIGINS="*"
exec ollama serve
