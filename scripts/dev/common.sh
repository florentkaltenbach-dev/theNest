#!/usr/bin/env bash
# @name        📦 Common
# @description Shared functions for dev scripts
# @target      local
set -euo pipefail

ROOT="/opt/nest"
HUB_DIR="$ROOT/hub"
SESSION_NAME="nest"
CONFIG_FILE="$ROOT/config.env"
PORT="${PORT:-3000}"

load_env() {
  set -a
  # shellcheck disable=SC1090
  . "$CONFIG_FILE"
  set +a
}

ensure_tmux() {
  command -v tmux >/dev/null 2>&1 || {
    echo "tmux is required but not installed" >&2
    exit 1
  }
}

session_exists() {
  tmux has-session -t "$SESSION_NAME" 2>/dev/null
}

kill_port_process() {
  local pid
  pid="$(ss -ltnp 2>/dev/null | awk -v p=":$PORT" '$4 ~ p { if (match($0, /pid=[0-9]+/)) print substr($0, RSTART + 4, RLENGTH - 4) }' | head -n 1)"
  if [[ -n "${pid:-}" ]]; then
    kill "$pid" 2>/dev/null || true
    sleep 1
  fi
}

build_hub() {
  echo "No build step needed — plain JS runs directly"
}

start_watch_session() {
  ensure_tmux
  load_env
  tmux new-session -d -s "$SESSION_NAME" "cd '$ROOT' && bash '$ROOT/scripts/dev/build/live.sh'"
}

start_session() {
  ensure_tmux
  load_env
  tmux new-session -d -s "$SESSION_NAME" "cd '$HUB_DIR' && export PORT='$PORT' && set -a && . '$CONFIG_FILE' && set +a && node src/index.js"
}
