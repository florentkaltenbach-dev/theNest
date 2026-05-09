#!/usr/bin/env bash
# scripts/tasks/sources/openrouter-hermes.sh
#
# Emits a C10 source-row for Hermes' OpenRouter free-model usage.
# OpenRouter exposes credit usage via API, but not the free-model daily request
# counter, so daily requests are counted from Hermes gateway logs (`api_calls=N`).

set -Eeuo pipefail

HERMES_ENV="${HERMES_ENV:-/home/claude/.hermes/.env}"
LOG_FILE="${HERMES_GATEWAY_LOG:-/home/claude/.hermes/logs/gateway.log}"
FREE_DAILY_CAP_CONFIG="${NEST_CAP_OPENROUTER_FREE_REQUESTS_DAY:-}"
NOW_ISO=$(date -u -Iseconds)
DAY_START_ISO=$(date -u +%Y-%m-%dT00:00:00+00:00)
DAY_END_ISO=$(date -u -d 'tomorrow 00:00:00' -Iseconds)
DAY_PREFIX=$(date -u +%Y-%m-%d)

OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-}"
if [ -z "$OPENROUTER_API_KEY" ] && [ -f "$HERMES_ENV" ]; then
  # shellcheck disable=SC1090
  set -a && . "$HERMES_ENV" && set +a
fi

TOTAL_CREDITS=null
TOTAL_USAGE=null
CAP_SOURCE="researched-free-tier"
if [ -n "$OPENROUTER_API_KEY" ]; then
  RESP=$(curl -fsS -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/credits 2>/dev/null || true)
  if [ -n "$RESP" ]; then
    TOTAL_CREDITS=$(jq -r '.data.total_credits // null' <<<"$RESP")
    TOTAL_USAGE=$(jq -r '.data.total_usage // null' <<<"$RESP")
  fi
fi

if [ -n "$FREE_DAILY_CAP_CONFIG" ]; then
  CAP="$FREE_DAILY_CAP_CONFIG"
  CAP_SOURCE="config"
elif [ "$TOTAL_CREDITS" != "null" ] && awk "BEGIN { exit !($TOTAL_CREDITS >= 10) }"; then
  CAP=1000
else
  CAP=50
fi

USED=$(python3 - <<'PY' "$LOG_FILE" "$DAY_PREFIX"
import re, sys
path, day = sys.argv[1], sys.argv[2]
used = 0
try:
    fh = open(path, errors='ignore')
except OSError:
    fh = []
with fh:
    for line in fh:
        if not line.startswith(day):
            continue
        m = re.search(r'response ready: .*?api_calls=(\d+)', line)
        if m:
            used += int(m.group(1))
print(used)
PY
)

jq -n \
  --arg now "$NOW_ISO" \
  --arg ps "$DAY_START_ISO" \
  --arg pe "$DAY_END_ISO" \
  --arg capSource "$CAP_SOURCE" \
  --argjson used "$USED" \
  --argjson cap "$CAP" \
  --argjson totalCredits "$TOTAL_CREDITS" \
  --argjson totalUsage "$TOTAL_USAGE" '
  ($cap - $used) as $rem
  | {
    id: "openrouter-hermes", kind: "free-promo", label: "Hermes OpenRouter free models", engine: "hermes",
    period: { start: $ps, end: $pe, resetCadence: "daily-utc" },
    cap: { unit: "requests_day", amount: $cap },
    used: { amount: $used, asOf: $now },
    remaining: {
      amount: (if $rem < 0 then 0 else $rem end),
      percent: (if $cap > 0 then ((if $rem < 0 then 0 else $rem end) * 100 / $cap) else null end),
      unknown: false
    },
    metrics: {
      capSource: $capSource,
      openrouterTotalCredits: $totalCredits,
      openrouterTotalUsageUsd: $totalUsage,
      source: "Hermes gateway.log api_calls"
    },
    warnings: ([
      "OpenRouter API exposes credit usage, not the free-model daily request counter; used requests are counted from Hermes logs",
      "OpenRouter :free models are 50 requests/day below $10 purchased credits and 1000 requests/day once at least $10 credits are purchased; 20 RPM still applies"
    ] + (if $rem < 0 then ["over daily free-model cap by \($used - $cap) requests"] else [] end))
  }'
