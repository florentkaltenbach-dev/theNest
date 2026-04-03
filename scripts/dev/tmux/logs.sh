#!/usr/bin/env bash
# @name        📋 Logs
# @description Tail logs from the tmux session
# @target      local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/../common.sh"

if ! session_exists; then
  echo "tmux session '$SESSION_NAME' is not running" >&2
  exit 1
fi

tmux attach -t "$SESSION_NAME"
