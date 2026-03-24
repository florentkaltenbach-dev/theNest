#!/usr/bin/env bash
# ── theNest Bootstrap: Shared Utilities ────────────────
# Sourced by bootstrap.sh and future setup scripts.

set -Eeuo pipefail

# ── Colors ─────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Logging ────────────────────────────────────────────
info()    { echo -e "${BLUE}[INFO]${NC}  $(date +%H:%M:%S)  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $(date +%H:%M:%S)  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $(date +%H:%M:%S)  $*" >&2; }
success() { echo -e "${GREEN}[OK]${NC}    $(date +%H:%M:%S)  $*"; }

die() { error "$@"; exit 1; }

# ── State Tracking ─────────────────────────────────────
# Phases are tracked in /opt/nest/.bootstrap-state on the server.
# Each completed phase is one line in the file.

REMOTE_STATE_FILE="/opt/nest/.bootstrap-state"

phase_done() {
  local phase="$1"
  run_remote "grep -qxF '${phase}' '${REMOTE_STATE_FILE}' 2>/dev/null" && return 0 || return 1
}

mark_done() {
  local phase="$1"
  run_remote "echo '${phase}' >> '${REMOTE_STATE_FILE}'"
  success "Phase '${phase}' completed"
}

# ── SSH ────────────────────────────────────────────────
# SSH_USER, SSH_KEY, and SERVER_IP are set by bootstrap.sh before sourcing.
# SSH_OPTS is built as an array to handle paths with spaces.

build_ssh_opts() {
  SSH_OPTS=(
    -o StrictHostKeyChecking=accept-new
    -o UserKnownHostsFile=/dev/null
    -o LogLevel=ERROR
    -o ConnectTimeout=10
    -i "${SSH_KEY}"
  )
}

run_remote() {
  local cmd="$1"
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SERVER_IP}" "bash -lc '${cmd}'"
}

run_remote_sudo() {
  local cmd="$1"
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SERVER_IP}" "sudo bash -c '${cmd}'"
}

upload_file() {
  local src="$1" dest="$2"
  scp "${SSH_OPTS[@]}" "${src}" "${SSH_USER}@${SERVER_IP}:${dest}"
}

run_remote_script() {
  local script="$1"
  ssh "${SSH_OPTS[@]}" "${SSH_USER}@${SERVER_IP}" "sudo bash -s" < "${script}"
}

detect_ssh_user() {
  if ssh "${SSH_OPTS[@]}" "claude@${SERVER_IP}" "true" 2>/dev/null; then
    echo "claude"
  elif ssh "${SSH_OPTS[@]}" "root@${SERVER_IP}" "true" 2>/dev/null; then
    echo "root"
  else
    echo ""
  fi
}

wait_for_ssh() {
  local user="$1"
  local max_attempts="${2:-30}"
  local attempt=0

  info "Waiting for SSH as '${user}'..."
  while [ $attempt -lt $max_attempts ]; do
    if ssh "${SSH_OPTS[@]}" "${user}@${SERVER_IP}" "true" 2>/dev/null; then
      success "SSH connection established as '${user}'"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 5
  done

  die "SSH connection failed after ${max_attempts} attempts"
}
