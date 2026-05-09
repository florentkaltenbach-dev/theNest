#!/usr/bin/env bash
# scripts/tasks/sources/claude-pro.sh
#
# Emits a C10 source-row for the Claude Pro/Max OAuth subscription consumed via Claude Code.
# Primary capacity is a calculated/researched 5h Claude Code prompt window, because
# Anthropic's live OAuth rate-limit headers are not reliably available from local logs.
# Monthly token totals are still reported under metrics.monthlyTokens.

set -Eeuo pipefail

PROJECTS_DIR="${CLAUDE_CODE_PROJECTS_DIR:-/home/claude/.claude/projects}"
RESET_DAY="${NEST_CAP_CLAUDE_PRO_RESET_DAY:-1}"
PROMPT_CAP_5H="${NEST_CAP_CLAUDE_CODE_PROMPTS_5H:-50}"
CAP_SOURCE="${NEST_CAP_CLAUDE_CODE_PROMPTS_5H:+config}"
CAP_SOURCE="${CAP_SOURCE:-researched-floor}"

NOW_ISO=$(date -u -Iseconds)
NOW_MS=$(date +%s%3N)
FIVE_HOURS_AGO_ISO=$(date -u -d '5 hours ago' -Iseconds)

period_start_ms=$(date -u -d "$(date -u +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N 2>/dev/null || echo 0)
if [ "$period_start_ms" -gt "$NOW_MS" ]; then
  period_start_ms=$(date -u -d "$(date -u -d '1 month ago' +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N)
fi
period_end_ms=$(date -u -d "$(date -u -d "@$((period_start_ms/1000))" +%Y-%m-%d) +1 month" +%s%3N)
period_start_iso=$(date -u -d "@$((period_start_ms/1000))" -Iseconds)
period_end_iso=$(date -u -d "@$((period_end_ms/1000))" -Iseconds)

shopt -s nullglob
JSONLS=()
for p in "$PROJECTS_DIR"/*/*.jsonl; do
  JSONLS+=("$p")
done

if [ "${#JSONLS[@]}" -eq 0 ]; then
  jq -n --arg now "$NOW_ISO" --arg ps "$period_start_iso" --arg pe "$period_end_iso" '{
    id: "claude-pro", kind: "oauth-sub", label: "Claude Max 5x (Claude Code)", engine: "claude-code",
    period: { start: $ps, end: $pe, resetCadence: "rolling-5h" },
    cap: { unit: "prompts_5h", amount: null },
    used: { amount: 0, asOf: $now },
    remaining: { amount: null, percent: null, unknown: true },
    warnings: ["no Claude Code session logs found"]
  }'
  exit 0
fi

MONTHLY_TOKENS=$(jq -cs --arg cutoff "$period_start_iso" '
  [ .[]
    | select(.timestamp != null and .timestamp >= $cutoff)
    | (.message.usage // {})
    | ((.input_tokens // 0) + (.output_tokens // 0) + (.cache_creation_input_tokens // 0))
  ] | add // 0
' "${JSONLS[@]}" 2>/dev/null)

PROMPTS_5H=$(jq -cs --arg cutoff "$FIVE_HOURS_AGO_ISO" '
  [ .[]
    | select(.timestamp != null and .timestamp >= $cutoff)
    | select(.type == "user" and (.userType // "") == "external")
  ] | length
' "${JSONLS[@]}" 2>/dev/null)

jq -n \
  --arg now "$NOW_ISO" \
  --arg ps "$FIVE_HOURS_AGO_ISO" \
  --arg pe "$NOW_ISO" \
  --arg monthlyStart "$period_start_iso" \
  --arg monthlyEnd "$period_end_iso" \
  --arg capSource "$CAP_SOURCE" \
  --argjson used "$PROMPTS_5H" \
  --argjson cap "$PROMPT_CAP_5H" \
  --argjson monthlyTokens "$MONTHLY_TOKENS" '
  ($cap - $used) as $rem
  | {
    id: "claude-pro", kind: "oauth-sub", label: "Claude Max 5x (Claude Code)", engine: "claude-code",
    period: { start: $ps, end: $pe, resetCadence: "rolling-5h" },
    cap: { unit: "prompts_5h", amount: $cap },
    used: { amount: $used, asOf: $now },
    remaining: {
      amount: (if $rem < 0 then 0 else $rem end),
      percent: (if $cap > 0 then ((if $rem < 0 then 0 else $rem end) * 100 / $cap) else null end),
      unknown: false
    },
    metrics: {
      monthlyTokens: $monthlyTokens,
      monthlyPeriod: { start: $monthlyStart, end: $monthlyEnd },
      capSource: $capSource
    },
    warnings: ([
      "calculated from local Claude Code logs; live Anthropic OAuth rate-limit headers unavailable here",
      "Claude Max 5x researched floor is 50 Claude Code prompts per 5h; official range is about 50-200 depending on task/context"
    ] + (if $rem < 0 then ["over conservative floor by \($used - $cap) prompts"] else [] end))
  }'
