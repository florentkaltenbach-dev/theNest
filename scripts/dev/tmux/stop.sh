#!/usr/bin/env bash
# @name        ⏹️ Stop
# @description Stop the tmux session
# @target      local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/../common.sh"

if session_exists; then
  tmux kill-session -t "$SESSION_NAME"
fi

kill_port_process
echo "stopped"
