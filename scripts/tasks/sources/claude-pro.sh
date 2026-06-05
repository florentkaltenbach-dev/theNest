#!/usr/bin/env bash
# scripts/tasks/sources/claude-pro.sh
#
# Emits a C10 source-row for the Claude Pro/Max OAuth subscription consumed via Claude Code.
# Remaining capacity comes from the REAL Anthropic unified rate-limit headers, which the hub's
# tokens.js samples every 15min and persists to token-claude-latest.json. Anthropic does not
# publish the absolute 5h/7d caps, so capacity is expressed as percent-of-window (the only
# correct model). Monthly token volume is still reported from local Claude Code logs as a metric.

set -Eeuo pipefail

LATEST_FILE="${NEST_CLAUDE_LATEST:-/opt/nest/data/token-claude-latest.json}"
PROJECTS_DIR="${CLAUDE_CODE_PROJECTS_DIR:-/home/claude/.claude/projects}"
RESET_DAY="${NEST_CAP_CLAUDE_PRO_RESET_DAY:-1}"
STALE_AFTER_S="${NEST_CLAUDE_STALE_AFTER_S:-1500}"   # 25min; sampler runs every 15min

NOW_ISO=$(date -u -Iseconds)
NOW_S=$(date +%s)

# Monthly token volume (secondary metric) from local Claude Code session logs.
period_start_ms=$(date -u -d "$(date -u +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N 2>/dev/null || echo 0)
if [ "$period_start_ms" -gt "$((NOW_S * 1000))" ]; then
  period_start_ms=$(date -u -d "$(date -u -d '1 month ago' +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N)
fi
period_start_iso=$(date -u -d "@$((period_start_ms/1000))" -Iseconds)
period_end_iso=$(date -u -d "$(date -u -d "@$((period_start_ms/1000))" +%Y-%m-%d) +1 month" -Iseconds)

shopt -s nullglob
JSONLS=()
for p in "$PROJECTS_DIR"/*/*.jsonl; do JSONLS+=("$p"); done
MONTHLY_TOKENS=0
if [ "${#JSONLS[@]}" -gt 0 ]; then
  MONTHLY_TOKENS=$(jq -cs --arg cutoff "$period_start_iso" '
    [ .[]
      | select(.timestamp != null and .timestamp >= $cutoff)
      | (.message.usage // {})
      | ((.input_tokens // 0) + (.output_tokens // 0) + (.cache_creation_input_tokens // 0))
    ] | add // 0
  ' "${JSONLS[@]}" 2>/dev/null || echo 0)
fi

# No live snapshot yet → remaining unknown (do NOT fall back to a meaningless estimate).
if [ ! -f "$LATEST_FILE" ]; then
  jq -n --arg now "$NOW_ISO" --arg ps "$period_start_iso" --arg pe "$period_end_iso" \
        --argjson monthlyTokens "$MONTHLY_TOKENS" '{
    id: "claude-pro", kind: "oauth-sub", label: "Claude Max 5x (Claude Code)", engine: "claude-code",
    period: { start: $ps, end: $pe, resetCadence: "rolling-5h" },
    cap: { unit: "pct_5h", amount: 100 },
    used: { amount: null, asOf: $now },
    remaining: { amount: null, percent: null, unknown: true },
    metrics: { monthlyTokens: $monthlyTokens, capSource: "anthropic-unified-headers" },
    warnings: ["no Claude rate-limit snapshot yet; hub tokens.js sampler has not written token-claude-latest.json"]
  }'
  exit 0
fi

jq -n \
  --arg now "$NOW_ISO" \
  --argjson nowS "$NOW_S" \
  --argjson staleAfter "$STALE_AFTER_S" \
  --arg monthlyStart "$period_start_iso" \
  --arg monthlyEnd "$period_end_iso" \
  --argjson monthlyTokens "$MONTHLY_TOKENS" \
  --slurpfile snap "$LATEST_FILE" '
  ($snap[0]) as $s
  | ($s.session.utilization_pct // 0) as $used5h
  | (100 - $used5h) as $rem5h
  | ($s.weekly.utilization_pct // 0) as $used7d
  | ((($s.fetchedAt // "") | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601?) // 0) as $fetchedS
  | (($nowS - $fetchedS) > $staleAfter) as $stale
  | {
    id: "claude-pro", kind: "oauth-sub", label: "Claude Max 5x (Claude Code)", engine: "claude-code",
    period: {
      start: ($s.fetchedAt // $now),
      end: ($s.session.remaining_seconds as $r | if $r then (($nowS + $r) | todateiso8601) else null end),
      resetCadence: "rolling-5h"
    },
    cap: { unit: "pct_5h", amount: 100 },
    used: { amount: $used5h, asOf: ($s.fetchedAt // $now) },
    remaining: { amount: $rem5h, percent: $rem5h, unknown: false },
    metrics: {
      weekly: {
        usedPct: $used7d,
        remainingPct: (100 - $used7d),
        remainingSeconds: ($s.weekly.remaining_seconds // null),
        status: ($s.weekly.status // null)
      },
      sessionStatus: ($s.session.status // null),
      overallStatus: ($s.status // null),
      overageAvailable: ($s.overage_available // null),
      monthlyTokens: $monthlyTokens,
      monthlyPeriod: { start: $monthlyStart, end: $monthlyEnd },
      capSource: "anthropic-unified-headers",
      snapshotAt: ($s.fetchedAt // null)
    },
    warnings: (
      [ "remaining is % of an undisclosed 5h window cap from live Anthropic unified rate-limit headers" ]
      + (if $stale then ["Claude snapshot is stale (>\($staleAfter)s old); hub sampler may be down"] else [] end)
    )
  }'
