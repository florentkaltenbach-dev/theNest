#!/usr/bin/env bash
# scripts/tasks/sources/nest-infra.sh
#
# Emits a C10 source-row for Nest's own request-layer health (the over-spend axis).
# Reads /opt/nest/data/requests.jsonl over the last 24h, surfaces total + waste-pct.
# No cap — kind=infra. Stdout: one JSON object.

set -Eeuo pipefail

LOG="${NEST_REQUESTS_LOG:-/opt/nest/data/requests.jsonl}"
WINDOW_MIN="${NEST_INFRA_WINDOW_MIN:-1440}"

NOW_ISO=$(date -u -Iseconds)
NOW_MS=$(date +%s%3N)
CUTOFF_MS=$((NOW_MS - WINDOW_MIN * 60 * 1000))

if [ ! -f "$LOG" ]; then
  jq -n --arg now "$NOW_ISO" '{
    id: "nest-infra", kind: "infra", label: "Nest hub requests", engine: null,
    period: null,
    cap: null,
    used: { amount: 0, asOf: $now },
    remaining: null,
    warnings: ["requests.jsonl missing"]
  }'
  exit 0
fi

STATS=$(jq -cs --argjson cutoff "$CUTOFF_MS" '
  map(select(.ts >= $cutoff)) as $w
  | ($w | length) as $total
  | ($w | map(select(.status >= 400)) | length) as $err
  | {
    total: $total,
    errors: $err,
    wastePct: (if $total == 0 then 0 else ($err * 100 / $total) end)
  }
' "$LOG")

jq -n \
  --arg now "$NOW_ISO" \
  --argjson windowMin "$WINDOW_MIN" \
  --argjson stats "$STATS" '
  {
    id: "nest-infra",
    kind: "infra",
    label: "Nest hub requests (24h)",
    engine: null,
    period: null,
    cap: null,
    used: { amount: $stats.total, asOf: $now },
    remaining: null,
    metrics: {
      windowMin: $windowMin,
      errors: $stats.errors,
      wastePct: $stats.wastePct
    },
    warnings: (if $stats.wastePct > 5 then ["waste-pct \($stats.wastePct | . * 10 | round / 10)% over 5% threshold"] else [] end)
  }'
