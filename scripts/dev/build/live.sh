#!/usr/bin/env bash
# @name        🔴 Live
# @description Build and start with file watching
# @target      local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/../common.sh"

load_env

cleanup() {
  local code=$?
  if [[ -n "${HUB_PID:-}" ]]; then
    kill "$HUB_PID" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
  exit "$code"
}

trap cleanup EXIT INT TERM

(
  cd "$HUB_DIR"
  export PORT="$PORT"
  npm run dev
) &
HUB_PID=$!

wait -n "$HUB_PID"
