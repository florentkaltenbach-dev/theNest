#!/usr/bin/env bash
# @name        📊 Status
# @description Show tmux session, processes, and ports
# @target      local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/../common.sh"

echo "Session:"
if session_exists; then
  tmux list-sessions -F "#{session_name} #{session_created_string}" | awk -v name="$SESSION_NAME" '$1 == name'
else
  echo "not running"
fi

echo
echo "Port $PORT:"
ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p { print }'

echo
echo "Recent logs:"
if session_exists; then
  tmux capture-pane -pt "$SESSION_NAME" -S -40
else
  echo "no tmux session"
fi

echo
echo "Mode:"
echo "hub watch + app auto-build"
