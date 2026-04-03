#!/usr/bin/env bash
# @name        🔨 Build
# @description Build hub for production
# @target      local
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/../common.sh"

build_hub
echo "build complete"
