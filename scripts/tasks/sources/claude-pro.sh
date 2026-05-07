#!/usr/bin/env bash
# scripts/tasks/sources/claude-pro.sh
#
# Emits a C10 source-row for the Claude Pro/Max OAuth subscription consumed via Claude Code.
# Aggregates message.usage records from ~/.claude/projects/*/*.jsonl for the current monthly period.
# Stdout: one JSON object. Stderr: logs. Exit non-zero on hard failure.

set -Eeuo pipefail

PROJECTS_DIR="${CLAUDE_CODE_PROJECTS_DIR:-/home/claude/.claude/projects}"
RESET_DAY="${NEST_CAP_CLAUDE_PRO_RESET_DAY:-1}"
CAP="${NEST_CAP_CLAUDE_PRO_TOKENS:-}"

NOW_ISO=$(date -u -Iseconds)
NOW_MS=$(date +%s%3N)

period_start_ms=$(date -u -d "$(date -u +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N 2>/dev/null || echo 0)
if [ "$period_start_ms" -gt "$NOW_MS" ]; then
  period_start_ms=$(date -u -d "$(date -u -d '1 month ago' +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N)
fi
period_end_ms=$(date -u -d "$(date -u -d "@$((period_start_ms/1000))" +%Y-%m-%d) +1 month" +%s%3N)
period_start_iso=$(date -u -d "@$((period_start_ms/1000))" -Iseconds)
period_end_iso=$(date -u -d "@$((period_end_ms/1000))" -Iseconds)

# Collect all jsonl files; bail with empty source if none.
shopt -s nullglob
JSONLS=()
for p in "$PROJECTS_DIR"/*/*.jsonl; do
  JSONLS+=("$p")
done

if [ "${#JSONLS[@]}" -eq 0 ]; then
  jq -n --arg now "$NOW_ISO" --arg ps "$period_start_iso" --arg pe "$period_end_iso" '{
    id: "claude-pro", kind: "oauth-sub", label: "Claude Pro/Max (via Claude Code)", engine: "claude-code",
    period: { start: $ps, end: $pe, resetCadence: "monthly" },
    cap: { unit: "tokens", amount: null },
    used: { amount: 0, asOf: $now },
    remaining: { amount: null, percent: null, unknown: true },
    warnings: ["no Claude Code session logs found"]
  }'
  exit 0
fi

# Sum input + output + cache_creation tokens (cache_read is mostly free billing-wise; skip it).
# Filter by ISO timestamp string compare against period_start_iso (ISO-8601 sorts lexically).
USED=$(jq -cs --arg cutoff "$period_start_iso" '
  [ .[]
    | select(.timestamp != null and .timestamp >= $cutoff)
    | (.message.usage // {})
    | ((.input_tokens // 0) + (.output_tokens // 0) + (.cache_creation_input_tokens // 0))
  ] | add // 0
' "${JSONLS[@]}" 2>/dev/null)

# Build warnings about cap unit mismatch — Pro/Max actually rate-limit on
# 5h-rolling messages, not monthly tokens. Be honest.
WARN_UNIT='Cap unit is approximate — Claude Pro/Max actually rate-limits on rolling messages, not monthly tokens.'

if [ -n "$CAP" ]; then
  jq -n \
    --arg now "$NOW_ISO" \
    --arg ps "$period_start_iso" \
    --arg pe "$period_end_iso" \
    --argjson used "$USED" \
    --argjson cap "$CAP" \
    --arg w "$WARN_UNIT" '
    ($cap - $used) as $rem
    | {
      id: "claude-pro", kind: "oauth-sub", label: "Claude Pro/Max (via Claude Code)", engine: "claude-code",
      period: { start: $ps, end: $pe, resetCadence: "monthly" },
      cap: { unit: "tokens", amount: $cap },
      used: { amount: $used, asOf: $now },
      remaining: {
        amount: (if $rem < 0 then 0 else $rem end),
        percent: (if $cap > 0 then ($rem * 100 / $cap) else null end),
        unknown: false
      },
      warnings: ([$w] + (if $rem < 0 then ["over cap by \($used - $cap) tokens"] else [] end))
    }'
else
  jq -n \
    --arg now "$NOW_ISO" \
    --arg ps "$period_start_iso" \
    --arg pe "$period_end_iso" \
    --argjson used "$USED" '
    {
      id: "claude-pro", kind: "oauth-sub", label: "Claude Pro/Max (via Claude Code)", engine: "claude-code",
      period: { start: $ps, end: $pe, resetCadence: "monthly" },
      cap: { unit: "tokens", amount: null },
      used: { amount: $used, asOf: $now },
      remaining: { amount: null, percent: null, unknown: true },
      warnings: ["NEST_CAP_CLAUDE_PRO_TOKENS not set — remaining unknown"]
    }'
fi
