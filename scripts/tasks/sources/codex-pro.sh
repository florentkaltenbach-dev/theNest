#!/usr/bin/env bash
# scripts/tasks/sources/codex-pro.sh
#
# Emits one C10 source-row for the Codex subscription consumed via OpenClaw.
# Remaining capacity comes from the LIVE ChatGPT backend usage endpoint
# (GET /backend-api/wham/usage, same token + endpoint the Codex CLI itself polls),
# which returns real 5h/7d used_percent. OpenAI does not publish the absolute caps,
# so capacity is percent-of-window. Token/cost volume from OpenClaw session JSONL is
# kept as a secondary metric (rollout-log rate_limits are null in exec mode, so we
# do not rely on them).

set -Eeuo pipefail

AUTH_PATH="${NEST_CODEX_AUTH:-/home/claude/.codex/auth.json}"
WHAM_URL="${NEST_CODEX_USAGE_URL:-https://chatgpt.com/backend-api/wham/usage}"
SESSIONS_DIR="${OPENCLAW_SESSIONS_DIR:-/home/claude/.openclaw/agents/main/sessions}"
RESET_DAY="${NEST_CAP_CODEX_PRO_RESET_DAY:-1}"
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

# ── Live remaining from the ChatGPT backend usage endpoint ──────────────────
USAGE_JSON='null'
ACCESS_TOKEN=$(jq -r '.tokens.access_token // empty' "$AUTH_PATH" 2>/dev/null || true)
if [ -n "$ACCESS_TOKEN" ]; then
  RESP=$(curl -fsS --max-time 20 \
    -H "Authorization: Bearer $ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    "$WHAM_URL" 2>/dev/null || true)
  if [ -n "$RESP" ] && echo "$RESP" | jq -e '.rate_limit.primary_window' >/dev/null 2>&1; then
    USAGE_JSON="$RESP"
  fi
fi

# ── Token/cost volume from OpenClaw session JSONL (secondary metric) ─────────
read -r PERIOD_TOKENS PERIOD_COST TOKENS_5H COST_5H CALLS_5H RECORDS < <(python3 - <<'PY' "$SESSIONS_DIR" "$period_start_ms" "$FIVE_HOURS_AGO_MS"
import glob, json, os, sys
sessions_dir = sys.argv[1]
month_cutoff = int(sys.argv[2])
five_cutoff = int(sys.argv[3])
period_tokens = period_cost = tokens_5h = cost_5h = calls_5h = records = 0
for path in glob.glob(os.path.join(sessions_dir, '*.jsonl')):
    base = os.path.basename(path)
    if '.trajectory.' in base or '.checkpoint.' in base or '.reset.' in base:
        continue
    try:
        fh = open(path, errors='ignore')
    except OSError:
        continue
    with fh:
        for line in fh:
            try:
                o = json.loads(line)
            except Exception:
                continue
            msg = o.get('message') if isinstance(o.get('message'), dict) else {}
            usage = msg.get('usage') if isinstance(msg.get('usage'), dict) else None
            if not usage:
                continue
            ts = o.get('timestamp') or msg.get('timestamp')
            if isinstance(ts, str):
                try:
                    from datetime import datetime
                    ts_ms = int(datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp() * 1000)
                except Exception:
                    continue
            elif isinstance(ts, (int, float)):
                ts_ms = int(ts)
            else:
                continue
            total = int(usage.get('totalTokens') or usage.get('total_tokens') or 0)
            cost = usage.get('cost', {}).get('total') if isinstance(usage.get('cost'), dict) else usage.get('totalCost')
            try:
                cost = float(cost or 0)
            except Exception:
                cost = 0
            if ts_ms >= month_cutoff:
                period_tokens += total
                period_cost += cost
                records += 1
            if ts_ms >= five_cutoff:
                tokens_5h += total
                cost_5h += cost
                calls_5h += 1
print(period_tokens, period_cost, tokens_5h, cost_5h, calls_5h, records)
PY
)

jq -n \
  --arg now "$NOW_ISO" \
  --arg ps "$period_start_iso" \
  --arg pe "$period_end_iso" \
  --argjson used "$PERIOD_TOKENS" \
  --argjson cost "$PERIOD_COST" \
  --argjson tokens5h "$TOKENS_5H" \
  --argjson cost5h "$COST_5H" \
  --argjson calls5h "$CALLS_5H" \
  --argjson records "$RECORDS" \
  --argjson usage "$USAGE_JSON" '
  ($usage.rate_limit // null) as $rl
  | ($rl.primary_window.used_percent // null) as $used5h
  | ($rl.secondary_window.used_percent // null) as $used7d
  | {
    id: "codex-pro", kind: "oauth-sub", label: "Codex via OpenClaw", engine: "openclaw",
    period: { start: $ps, end: $pe, resetCadence: "rolling-5h" },
    cap: { unit: "pct_5h", amount: (if $used5h != null then 100 else null end) },
    used: { amount: $used5h, asOf: $now },
    remaining: (
      if $used5h != null
      then { amount: (100 - $used5h), percent: (100 - $used5h), unknown: false }
      else { amount: null, percent: null, unknown: true }
      end
    ),
    metrics: {
      planType: ($usage.plan_type // null),
      weekly: (if $used7d != null then {
        usedPct: $used7d, remainingPct: (100 - $used7d),
        resetAt: ($rl.secondary_window.reset_at // null)
      } else null end),
      sessionResetAt: ($rl.primary_window.reset_at // null),
      creditsBalance: ($usage.credits.balance // null),
      hasCredits: ($usage.credits.has_credits // null),
      monthlyTokens: $used,
      monthlyCostUsdEquivalent: $cost,
      tokens5h: $tokens5h,
      cost5hUsdEquivalent: $cost5h,
      calls5h: $calls5h,
      countedUsageRecords: $records,
      capSource: (if $used5h != null then "chatgpt-wham-usage" else "unavailable" end),
      source: "wham/usage rate_limit + OpenClaw session JSONL message.usage"
    },
    warnings: (
      if $used5h != null
      then ["remaining is % of an undisclosed 5h window cap from the live ChatGPT backend usage endpoint"]
      else ["live ChatGPT usage endpoint unreachable or token expired; remaining Codex capacity unknown (token totals still shown)"]
      end
    )
  }'
