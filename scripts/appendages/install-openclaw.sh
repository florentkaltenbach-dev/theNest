#!/usr/bin/env bash
# @name        install-openclaw
# @description Pull and start the OpenClaw gateway container via docker compose
# @target      local
# @args        none
#
# Idempotent: safe to re-run. Does NOT perform OAuth onboarding — that step
# (Phase 3 C2) requires an interactive browser session:
#
#   docker compose -f scripts/templates/docker-compose.openclaw.yml exec \
#     openclaw openclaw onboard --auth-choice openai-codex

set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/opt/nest/scripts/templates/docker-compose.openclaw.yml}"
DATA_DIR="${NEST_OPENCLAW_DATA:-/opt/nest/data/openclaw}"

echo "install-openclaw: compose=$COMPOSE_FILE data=$DATA_DIR" >&2

mkdir -p "$DATA_DIR"

echo "→ pulling image" >&2
docker compose -f "$COMPOSE_FILE" pull

echo "→ starting container" >&2
docker compose -f "$COMPOSE_FILE" up -d

echo "→ status" >&2
docker compose -f "$COMPOSE_FILE" ps

jq -n --arg data "$DATA_DIR" --arg url "http://127.0.0.1:18789" \
  '{status: "running", webchat: $url, dataDir: $data, nextStep: "C2 — openclaw onboard --auth-choice openai-codex (browser required)"}'
