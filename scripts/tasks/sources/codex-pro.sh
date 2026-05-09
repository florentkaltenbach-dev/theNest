#!/usr/bin/env bash
# scripts/tasks/sources/codex-pro.sh
#
# Emits one C10 source-row for the Codex subscription consumed via OpenClaw.
# Primary capacity is a calculated/researched 5h local-message window; detailed
# token and cost-equivalent totals from OpenClaw's live usage cache are reported
# under metrics.

set -Eeuo pipefail

CACHE="${OPENCLAW_USAGE_CACHE:-/home/claude/.openclaw/agents/main/sessions/.usage-cost-cache.json}"
AUTH="${CODEX_AUTH_PATH:-/home/claude/.codex/auth.json}"
RESET_DAY="${NEST_CAP_CODEX_PRO_RESET_DAY:-1}"
MESSAGE_CAP_5H="${NEST_CAP_CODEX_PRO_LOCAL_MESSAGES_5H:-}"

NOW_ISO=$(date -u -Iseconds)
NOW_MS=$(date +%s%3N)
FIVE_HOURS_AGO_MS=$((NOW_MS - 5 * 60 * 60 * 1000))

period_start_ms=$(date -u -d "$(date -u +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N 2>/dev/null || echo 0)
if [ "$period_start_ms" -gt "$NOW_MS" ]; then
  period_start_ms=$(date -u -d "$(date -u -d '1 month ago' +%Y-%m-)$RESET_DAY 00:00:00" +%s%3N)
fi
period_end_ms=$(date -u -d "$(date -u -d "@$((period_start_ms/1000))" +%Y-%m-%d) +1 month" +%s%3N)
period_start_iso=$(date -u -d "@$((period_start_ms/1000))" -Iseconds)
period_end_iso=$(date -u -d "@$((period_end_ms/1000))" -Iseconds)
five_hours_ago_iso=$(date -u -d "@$((FIVE_HOURS_AGO_MS/1000))" -Iseconds)

PLAN="unknown"
if [ -f "$AUTH" ]; then
  PLAN=$(python3 - <<'PY' "$AUTH" 2>/dev/null || true
import base64, json, sys
try:
    data=json.load(open(sys.argv[1]))
    tok=data.get('tokens',{}).get('access_token','')
    payload=tok.split('.')[1]
    payload += '=' * (-len(payload) % 4)
    claims=json.loads(base64.urlsafe_b64decode(payload))
    auth=claims.get('https://api.openai.com/auth',{})
    print(auth.get('chatgpt_plan_type') or 'unknown')
except Exception:
    print('unknown')
PY
)
fi

if [ -z "$MESSAGE_CAP_5H" ]; then
  case "$PLAN" in
    plus) MESSAGE_CAP_5H=30 ;;
    pro) MESSAGE_CAP_5H=300 ;;
    *) MESSAGE_CAP_5H=30 ;;
  esac
  CAP_SOURCE="researched-floor"
else
  CAP_SOURCE="config"
fi

if [ ! -f "$CACHE" ]; then
  jq -n --arg now "$NOW_ISO" --arg ps "$five_hours_ago_iso" --arg pe "$NOW_ISO" '{
    id: "codex-pro", kind: "oauth-sub", label: "Codex (via OpenClaw)", engine: "openclaw",
    period: { start: $ps, end: $pe, resetCadence: "rolling-5h" },
    cap: { unit: "local_messages_5h", amount: null },
    used: { amount: 0, asOf: $now },
    remaining: { amount: null, percent: null, unknown: true },
    warnings: ["openclaw usage cache missing — emitting empty"]
  }'
  exit 0
fi

read -r PERIOD_TOKENS PERIOD_COST MESSAGES_5H COST_5H < <(jq -r --argjson cutoffMonth "$period_start_ms" --argjson cutoff5h "$FIVE_HOURS_AGO_MS" '
  [ .files | to_entries[] | .value.usageEntries // [] | .[] ] as $e
  | [
      ($e | map(select(.timestamp >= $cutoffMonth) | (.totalTokens // 0)) | add // 0),
      ($e | map(select(.timestamp >= $cutoffMonth) | (.totalCost // 0)) | add // 0),
      ($e | map(select(.timestamp >= $cutoff5h)) | length),
      ($e | map(select(.timestamp >= $cutoff5h) | (.totalCost // 0)) | add // 0)
    ] | @tsv
' "$CACHE")

jq -n \
  --arg now "$NOW_ISO" \
  --arg ps "$five_hours_ago_iso" \
  --arg pe "$NOW_ISO" \
  --arg monthlyStart "$period_start_iso" \
  --arg monthlyEnd "$period_end_iso" \
  --arg plan "$PLAN" \
  --arg capSource "$CAP_SOURCE" \
  --argjson used "$MESSAGES_5H" \
  --argjson cap "$MESSAGE_CAP_5H" \
  --argjson periodTokens "$PERIOD_TOKENS" \
  --argjson periodCost "$PERIOD_COST" \
  --argjson cost5h "$COST_5H" '
  ($cap - $used) as $rem
  | {
    id: "codex-pro", kind: "oauth-sub", label: "Codex (via OpenClaw)", engine: "openclaw",
    period: { start: $ps, end: $pe, resetCadence: "rolling-5h" },
    cap: { unit: "local_messages_5h", amount: $cap },
    used: { amount: $used, asOf: $now },
    remaining: {
      amount: (if $rem < 0 then 0 else $rem end),
      percent: (if $cap > 0 then ((if $rem < 0 then 0 else $rem end) * 100 / $cap) else null end),
      unknown: false
    },
    metrics: {
      plan: $plan,
      periodTokens: $periodTokens,
      periodCostUsdEquivalent: $periodCost,
      fiveHourCostUsdEquivalent: $cost5h,
      monthlyPeriod: { start: $monthlyStart, end: $monthlyEnd },
      capSource: $capSource
    },
    warnings: ([
      "calculated from OpenClaw local usage cache; OpenAI does not expose remaining Codex subscriber quota in the local OAuth file",
      "researched floor uses GPT-5.3-Codex local-message lower bound (Plus 30/5h, Pro 300/5h); real allowance varies by model, task size, context, and current OpenAI policy"
    ] + (if $rem < 0 then ["over conservative floor by \($used - $cap) local messages"] else [] end))
  }'
