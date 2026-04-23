#!/usr/bin/env bash
# @name        aggregate-telemetry
# @description Summarize hub requests + token windows into /opt/nest/data/telemetry-summary.json
# @target      local
# @args        json
#
# Stdin:  {"windowMinutes": <int, default 1440>}
# Stdout: summary JSON (also written to /opt/nest/data/telemetry-summary.json)
# Stderr: logs

set -Eeuo pipefail

DATA_DIR="${NEST_DATA_DIR:-/opt/nest/data}"
REQUESTS_LOG="$DATA_DIR/requests.jsonl"
TOKEN_WINDOWS="$DATA_DIR/token-windows.jsonl"
TOKEN_STATE="$DATA_DIR/token-state.json"
OPENCLAW_TELEMETRY="${OPENCLAW_TELEMETRY:-/opt/nest/data/openclaw/logs/telemetry.jsonl}"
OUT_FILE="$DATA_DIR/telemetry-summary.json"

# ── parse args ──────────────────────────────────────────
ARGS=$(cat || echo '{}')
[ -z "$ARGS" ] && ARGS='{}'
WINDOW_MINUTES=$(echo "$ARGS" | jq -r '.windowMinutes // 1440')

NOW_MS=$(date +%s%3N)
CUTOFF_MS=$((NOW_MS - WINDOW_MINUTES * 60 * 1000))
GENERATED_AT=$(date -Iseconds)

echo "aggregate-telemetry: window=${WINDOW_MINUTES}min cutoff=${CUTOFF_MS}" >&2

# ── hub request stats ───────────────────────────────────
if [ -f "$REQUESTS_LOG" ]; then
  REQUEST_STATS=$(jq -cs --argjson cutoff "$CUTOFF_MS" '
    map(select(.ts >= $cutoff)) as $w
    | ($w | length) as $total
    | {
        total: $total,
        byStatus: ($w | group_by(.status / 100 | floor) | map({key: ((.[0].status/100|floor|tostring) + "xx"), value: length}) | from_entries),
        byMethod: ($w | group_by(.method) | map({key: .[0].method, value: length}) | from_entries),
        topPaths: ($w | group_by(.path) | map({path: .[0].path, count: length}) | sort_by(-.count) | .[0:10]),
        errors: ($w | map(select(.status >= 400)) | length),
        latencyMs: ($w | map(.ms) | sort as $s
          | if length == 0 then {p50: 0, p95: 0, max: 0}
            else {p50: $s[(length/2|floor)], p95: $s[(length*0.95|floor)], max: $s[-1]}
            end)
      }
  ' "$REQUESTS_LOG")
else
  REQUEST_STATS='{"total":0,"byStatus":{},"byMethod":{},"topPaths":[],"errors":0,"latencyMs":{"p50":0,"p95":0,"max":0}}'
fi

# ── waste heuristics (no OpenClaw needed) ───────────────
# Signals we can compute today:
#   1. Error rate: 4xx/5xx over total
#   2. Duplicate path hits within 2s (same method+path) — retry/spam indicator
if [ -f "$REQUESTS_LOG" ]; then
  WASTE=$(jq -cs --argjson cutoff "$CUTOFF_MS" '
    map(select(.ts >= $cutoff)) as $w
    | ($w | length) as $total
    | ($w | map(select(.status >= 400)) | length) as $err
    | ($w | sort_by(.path, .method, .ts)
         | [range(0; length-1) as $i | if .[$i].path == .[$i+1].path and .[$i].method == .[$i+1].method and (.[$i+1].ts - .[$i].ts) < 2000 then 1 else 0 end]
         | add // 0) as $dup
    | {
        totalRequests: $total,
        errorRequests: $err,
        duplicateRequests: $dup,
        wastePct: (if $total == 0 then 0 else (($err + $dup) * 100 / $total) end)
      }
  ' "$REQUESTS_LOG")
else
  WASTE='{"totalRequests":0,"errorRequests":0,"duplicateRequests":0,"wastePct":0}'
fi

# ── token windows ───────────────────────────────────────
if [ -f "$TOKEN_WINDOWS" ]; then
  TOKEN_DATA=$(jq -cs '
    {
      windowCount: length,
      recentPeaks: (sort_by(.ended) | reverse | .[0:10])
    }
  ' "$TOKEN_WINDOWS")
else
  TOKEN_DATA='{"windowCount":0,"recentPeaks":[]}'
fi

TOKEN_STATE_JSON='null'
[ -f "$TOKEN_STATE" ] && TOKEN_STATE_JSON=$(cat "$TOKEN_STATE")

# ── openclaw telemetry (Phase 3 — placeholder) ──────────
if [ -f "$OPENCLAW_TELEMETRY" ]; then
  OPENCLAW=$(jq -cs '
    {
      available: true,
      eventCount: length,
      byProvider: (group_by(.provider // "unknown") | map({key: (.[0].provider // "unknown"), value: {count: length, tokens: (map(.tokens // 0) | add)}}) | from_entries)
    }
  ' "$OPENCLAW_TELEMETRY")
else
  OPENCLAW='{"available":false,"reason":"openclaw not installed (Phase 3)"}'
fi

# ── assemble summary ────────────────────────────────────
SUMMARY=$(jq -n \
  --arg generatedAt "$GENERATED_AT" \
  --argjson windowMinutes "$WINDOW_MINUTES" \
  --argjson requests "$REQUEST_STATS" \
  --argjson waste "$WASTE" \
  --argjson tokenWindows "$TOKEN_DATA" \
  --argjson tokenState "$TOKEN_STATE_JSON" \
  --argjson openclaw "$OPENCLAW" \
  '{
    generatedAt: $generatedAt,
    windowMinutes: $windowMinutes,
    hub: { requests: $requests, waste: $waste },
    tokens: { windows: $tokenWindows, state: $tokenState },
    openclaw: $openclaw
  }')

mkdir -p "$DATA_DIR"
echo "$SUMMARY" > "$OUT_FILE"
echo "$SUMMARY"
