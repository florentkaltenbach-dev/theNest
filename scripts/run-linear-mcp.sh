#!/usr/bin/env bash
# scripts/run-linear-mcp.sh
#
# Wrapper for @tacticlaunch/mcp-linear stdio server. Sources LINEAR_API_TOKEN
# from /opt/nest/config.env so the token lives in one place. Three MCP clients
# (Claude Code project-level, Claude Code user-level, Codex) point at this.
#
# Stdio MCP protocol uses stdin/stdout — this script MUST NOT write to stdout.
# Diagnostics go to stderr only. `exec` replaces the shell so the child
# inherits stdio cleanly.

set -eu

CONFIG_ENV="/opt/nest/config.env"
PINNED_VERSION="1.1.2"

if [ ! -r "$CONFIG_ENV" ]; then
  echo "run-linear-mcp.sh: $CONFIG_ENV not readable" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a; . "$CONFIG_ENV"; set +a

if [ -z "${LINEAR_API_TOKEN:-}" ]; then
  echo "run-linear-mcp.sh: LINEAR_API_TOKEN unset in $CONFIG_ENV" >&2
  exit 1
fi

exec npx -y "@tacticlaunch/mcp-linear@${PINNED_VERSION}"
