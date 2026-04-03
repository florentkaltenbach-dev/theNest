#!/usr/bin/env bash
# @name        ▶️ Start
# @description Start the hub in a tmux session
# @target      local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/../common.sh"

if session_exists; then
  echo "tmux session '$SESSION_NAME' already exists"
  exit 0
fi

kill_port_process
start_watch_session
sleep 1
"$SCRIPT_DIR/status.sh"
