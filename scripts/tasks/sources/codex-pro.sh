#!/usr/bin/env bash
# scripts/tasks/sources/codex-pro.sh
#
# Emits one C10 source-row for the Codex Pro OAuth subscription consumed via OpenClaw.
# Reads OpenClaw's per-session usage cache, sums tokens for the current monthly period.
# Stdout: one JSON object (the source-row). Stderr: logs. Exit non-zero on hard failure.

set -Eeuo pipefail

CACHE="${OPENCLAW_USAGE_CACHE:-/home/claude/.openclaw/agents/main/sessions/.usage-cost-cache.json}"
RESET_DAY="${NEST_CAP_CODEX_PRO_RESET_DAY:-1}"
CAP="${NEST_CAP_CODEX_PRO_TOKENS:-}"

NOW_ISO=$(date -u -Iseconds)
NOW_MS=$(date +%s%3N)

# ── current monthly period start/end (UTC) ──────────────
period_start_ms=$(date -u -d "$(date -u +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N 2>/dev/null || echo 0)
if [ "$period_start_ms" -gt "$NOW_MS" ]; then
  period_start_ms=$(date -u -d "$(date -u -d '1 month ago' +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N)
fi
period_end_ms=$(date -u -d "$(date -u -d "@$((period_start_ms/1000))" +%Y-%m-%d) +1 month" +%s%3N)
period_start_iso=$(date -u -d "@$((period_start_ms/1000))" -Iseconds)
period_end_iso=$(date -u -d "@$((period_end_ms/1000))" -Iseconds)

if [ ! -f "$CACHE" ]; then
  jq -n --arg now "$NOW_ISO" --arg ps "$period_start_iso" --arg pe "$period_end_iso" '{
    id: "codex-pro", kind: "oauth-sub", label: "Codex Pro (via OpenClaw)", engine: "openclaw",
    period: { start: $ps, end: $pe, resetCadence: "monthly" },
    cap: { unit: "tokens", amount: null },
    used: { amount: 0, asOf: $now },
    remaining: { amount: null, percent: null, unknown: true },
    warnings: ["openclaw usage cache missing — emitting empty"]
  }'
  exit 0
fi

USED=$(jq -c --argjson cutoff "$period_start_ms" '
  [ .files
    | to_entries[]
    | .value.usageEntries // []
    | .[]
    | select(.timestamp >= $cutoff)
    | (.totalTokens // 0)
  ] | add // 0
' "$CACHE")

if [ -n "$CAP" ]; then
  jq -n \
    --arg now "$NOW_ISO" \
    --arg ps "$period_start_iso" \
    --arg pe "$period_end_iso" \
    --argjson used "$USED" \
    --argjson cap "$CAP" '
    ($cap - $used) as $rem
    | {
      id: "codex-pro", kind: "oauth-sub", label: "Codex Pro (via OpenClaw)", engine: "openclaw",
      period: { start: $ps, end: $pe, resetCadence: "monthly" },
      cap: { unit: "tokens", amount: $cap },
      used: { amount: $used, asOf: $now },
      remaining: {
        amount: (if $rem < 0 then 0 else $rem end),
        percent: (if $cap > 0 then ($rem * 100 / $cap) else null end),
        unknown: false
      },
      warnings: (if $rem < 0 then ["over cap by \($used - $cap) tokens"] else [] end)
    }'
else
  jq -n \
    --arg now "$NOW_ISO" \
    --arg ps "$period_start_iso" \
    --arg pe "$period_end_iso" \
    --argjson used "$USED" '
    {
      id: "codex-pro", kind: "oauth-sub", label: "Codex Pro (via OpenClaw)", engine: "openclaw",
      period: { start: $ps, end: $pe, resetCadence: "monthly" },
      cap: { unit: "tokens", amount: null },
      used: { amount: $used, asOf: $now },
      remaining: { amount: null, percent: null, unknown: true },
      warnings: ["NEST_CAP_CODEX_PRO_TOKENS not set — remaining unknown"]
    }'
fi
