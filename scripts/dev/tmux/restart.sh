#!/usr/bin/env bash
# @name        🔄 Restart
# @description Kill and restart the tmux session
# @target      local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/../common.sh"

if session_exists; then
  tmux kill-session -t "$SESSION_NAME"
fi

kill_port_process
start_watch_session
sleep 1
"$SCRIPT_DIR/status.sh"
