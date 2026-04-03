#!/usr/bin/env bash
# @name        📦 Common Utilities
# @description Shared logging and IPv6 helpers for bootstrap scripts
# @target      local
# ── theNest Bootstrap: Shared Utilities ────────────────

set -Eeuo pipefail

# ── Colors & Logging ──────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
die()     { error "$@"; exit 1; }

# ── IPv6 Helpers ──────────────────────────────────────
# scp needs brackets around IPv6, ssh does not.

is_ipv6() { [[ "$1" == *:* ]]; }

ssh_host() {
  if is_ipv6 "$1"; then echo "[$1]"; else echo "$1"; fi
}
