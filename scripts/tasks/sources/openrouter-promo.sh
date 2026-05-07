#!/usr/bin/env bash
# scripts/tasks/sources/openrouter-promo.sh
#
# Emits a C10 source-row for OpenRouter free promo credits.
# Calls GET https://openrouter.ai/api/v1/credits with OPENROUTER_API_KEY.
# If the key isn't set, emits no source (exits 0 with empty stdout) — design says
# OpenRouter is opt-in once the user has an active promo.

set -Eeuo pipefail

KEY="${OPENROUTER_API_KEY:-}"
NOW_ISO=$(date -u -Iseconds)

if [ -z "$KEY" ]; then
  exit 0
fi

# Note: the OpenRouter credits API returns total/used credit balance in USD-equivalent.
# Per-model promo expiries aren't on this endpoint — keeping that as a follow-up.
RESP=$(curl -fsS -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/credits 2>/dev/null || true)
if [ -z "$RESP" ]; then
  jq -n --arg now "$NOW_ISO" '{
    id: "openrouter", kind: "free-promo", label: "OpenRouter (credits API failed)", engine: "openrouter",
    period: { start: null, end: null, resetCadence: "promo-fixed-date" },
    cap: { unit: "usd-equiv", amount: null },
    used: { amount: 0, asOf: $now },
    remaining: { amount: null, percent: null, unknown: true },
    warnings: ["OpenRouter /credits call failed"]
  }'
  exit 0
fi

jq --arg now "$NOW_ISO" '
  (.data // {}) as $d
  | ($d.total_credits // 0) as $cap
  | ($d.total_usage // 0) as $used
  | ($cap - $used) as $rem
  | {
    id: "openrouter", kind: "free-promo", label: "OpenRouter credits", engine: "openrouter",
    period: { start: null, end: null, resetCadence: "promo-fixed-date" },
    cap: { unit: "usd-equiv", amount: $cap },
    used: { amount: $used, asOf: $now },
    remaining: {
      amount: (if $rem < 0 then 0 else $rem end),
      percent: (if $cap > 0 then ($rem * 100 / $cap) else null end),
      unknown: false
    },
    warnings: []
  }' <<<"$RESP"
