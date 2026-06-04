#!/usr/bin/env bash
# @name        nest-janitor
# @description Health + circuit-breaker + buffer-keeper + weekly reconcile for
#              the self-running board. Computes buffer depth, oldest Working
#              age, cancel rate, token-waste %, conventions status; trips the
#              breaker (pause flag + mail) on any breach; tops up the Spec'd
#              buffer; once per ISO week appends a shipped digest to ROADMAP.
#              Always runs (even when paused) so it can report and hold.
# @target      local
# @args        json   ({}; {"dry_run":true} computes + reports, no side effects;
#                       {"force_reconcile":true} runs the weekly digest now)
set -Eeuo pipefail

NEST_ROOT="/opt/nest"
. "$NEST_ROOT/scripts/tasks/lib/automation-lib.sh"
cd "$NEST_ROOT"
TS=$(date -Iseconds)
LOGDIR=$(automation_cfg log_dir "$NEST_ROOT/data/automation"); mkdir -p "$LOGDIR"
PAUSE_FLAG=$(automation_cfg pause_flag "$NEST_ROOT/data/automation.paused")

ARGS=$(cat || true); [ -z "$ARGS" ] && ARGS='{}'
DRY=$(echo "$ARGS" | jq -r '.dry_run // false')
FORCE_REC=$(echo "$ARGS" | jq -r '.force_reconcile // false')

BUFFER_TARGET=$(automation_cfg buffer_target 3)
CB=$(automation_cfg circuit_breaker '{}')
cbv(){ echo "$CB" | jq -r --arg k "$1" '.[$k] // empty'; }
BUF_MIN=$(cbv buffer_min);        WORK_MAX_H=$(cbv working_max_age_hours)
CANCEL_WIN=$(cbv cancel_rate_window); CANCEL_MAX=$(cbv cancel_rate_max)
WASTE_MAX=$(cbv token_waste_pct_max)

BOOT=$(gql 'query{ teams(filter:{key:{eq:"AI"}}){ nodes{ id } } }')
TID=$(echo "$BOOT" | jq -r '.teams.nodes[0].id')

# --- signals ---------------------------------------------------------------
BUFFER=$(gql 'query($t:ID!){ issues(filter:{team:{id:{eq:$t}},state:{name:{eq:"Spec'"'"'d"}}}){ nodes{id} } }' \
  "$(jq -n --arg t "$TID" '{t:$t}')" | jq '.issues.nodes|length')

# oldest Working age (hours) via startedAt
NOW_EPOCH=$(date +%s)
OLDEST_H=$(gql 'query($t:ID!){ issues(filter:{team:{id:{eq:$t}},state:{name:{eq:"Working"}}}){ nodes{ startedAt } } }' \
  "$(jq -n --arg t "$TID" '{t:$t}')" \
  | jq -r --argjson now "$NOW_EPOCH" '[.issues.nodes[]|.startedAt|select(.!=null)|sub("\\.[0-9]+Z$";"Z")|((($now)-(fromdate))/3600)]|max // 0 | floor')

# cancels in the window (canceledAt within CANCEL_WIN hours)
WIN_EPOCH=$(( NOW_EPOCH - CANCEL_WIN*3600 ))
CANCELS=$(gql 'query($t:ID!){ issues(filter:{team:{id:{eq:$t}},state:{name:{eq:"Cancelled"}}}){ nodes{ canceledAt } } }' \
  "$(jq -n --arg t "$TID" '{t:$t}')" \
  | jq -r --argjson win "$WIN_EPOCH" '[.issues.nodes[]|.canceledAt|select(.!=null)|sub("\\.[0-9]+Z$";"Z")|select(fromdate>=$win)]|length')

WASTE=$(jq -r '.hub.waste.wastePct // 0 | floor' "$NEST_ROOT/data/telemetry-summary.json" 2>/dev/null || echo 0)
CONV=$(conventions_status)

# --- evaluate breaches -----------------------------------------------------
BREACHES='[]'
add_breach(){ BREACHES=$(echo "$BREACHES" | jq -c --arg b "$1" '. + [$b]'); }
[ -n "$BUF_MIN" ]   && [ "$BUFFER" -lt "$BUF_MIN" ]      && add_breach "Spec'd buffer $BUFFER < min $BUF_MIN"
[ -n "$WORK_MAX_H" ] && [ "$OLDEST_H" -gt "$WORK_MAX_H" ] && add_breach "oldest Working ${OLDEST_H}h > ${WORK_MAX_H}h"
[ -n "$CANCEL_MAX" ] && [ "$CANCELS" -gt "$CANCEL_MAX" ]  && add_breach "cancels $CANCELS > $CANCEL_MAX in ${CANCEL_WIN}h"
[ -n "$WASTE_MAX" ]  && [ "$WASTE" -gt "$WASTE_MAX" ]     && add_breach "token-waste ${WASTE}% > ${WASTE_MAX}%"
[ "$CONV" = red ] && add_breach "conventions self-audit is red"
NBREACH=$(echo "$BREACHES" | jq 'length')
ALREADY_PAUSED=$([ -f "$PAUSE_FLAG" ] && echo true || echo false)

TRIPPED=false
if [ "$NBREACH" -gt 0 ] && [ "$ALREADY_PAUSED" != true ] && [ "$DRY" != true ]; then
  echo "PAUSED $(date -Iseconds): $(echo "$BREACHES"|jq -r 'join("; ")')" > "$PAUSE_FLAG"
  send_alert "🚨 Nest automation paused — circuit-breaker" \
    "The self-running board was paused at $TS. Breached signals:
$(echo "$BREACHES" | jq -r '.[] | "  - " + .')

The pause flag is at $PAUSE_FLAG. The groomer, executor, and auto-Done jobs now no-op. A human must investigate and remove the flag to resume." \
    >/dev/null 2>&1 && MAIL=sent || MAIL=failed
  alog janitor.jsonl "$(jq -n --arg t "$TS" --argjson b "$BREACHES" --arg m "${MAIL:-?}" '{ts:$t,action:"tripped",breaches:$b,mail:$m}')"
  TRIPPED=true
fi

# --- buffer keeper (only when healthy + not paused) ------------------------
GROOM_TRIGGERED=false
if [ "$DRY" != true ] && [ ! -f "$PAUSE_FLAG" ] && [ "$BUFFER" -lt "$BUFFER_TARGET" ]; then
  echo '{}' | "$NEST_ROOT/scripts/tasks/groom-board.sh" >/dev/null 2>&1 || true
  GROOM_TRIGGERED=true
fi

# --- weekly reconcile ------------------------------------------------------
WEEK=$(date +%G-W%V)
WEEKFILE="$LOGDIR/last-reconcile-week"
LAST_WEEK=$(cat "$WEEKFILE" 2>/dev/null || echo "")
RECONCILED=false
if [ "$DRY" != true ] && { [ "$FORCE_REC" = true ] || [ "$WEEK" != "$LAST_WEEK" ]; }; then
  SINCE_EPOCH=$(( NOW_EPOCH - 7*24*3600 ))
  DONELIST=$(gql 'query($t:ID!){ issues(first:100, filter:{team:{id:{eq:$t}},state:{name:{eq:"Done"}}}){ nodes{ identifier title completedAt } } }' \
    "$(jq -n --arg t "$TID" '{t:$t}')" \
    | jq -c --argjson s "$SINCE_EPOCH" '[.issues.nodes[]|select(.completedAt!=null and (.completedAt|sub("\\.[0-9]+Z$";"Z")|fromdate)>=$s)]')
  NDONE=$(echo "$DONELIST" | jq 'length')
  if [ "$NDONE" -gt 0 ]; then
    {
      printf '\n## Shipped %s (auto-reconciled %s)\n\n' "$WEEK" "$(date -I)"
      echo "$DONELIST" | jq -r '.[] | "- **\(.identifier)** — \(.title)"'
    } >> "$NEST_ROOT/ROADMAP.md"
    send_alert "📦 Nest weekly shipped digest ($WEEK)" \
      "$NDONE ticket(s) reached Done in the past week:
$(echo "$DONELIST" | jq -r '.[] | "  - " + .identifier + " — " + .title')" >/dev/null 2>&1 || true
  fi
  echo "$WEEK" > "$WEEKFILE"
  alog janitor.jsonl "$(jq -n --arg t "$TS" --arg w "$WEEK" --argjson n "$NDONE" '{ts:$t,action:"reconciled",week:$w,shipped:$n}')"
  RECONCILED=true
fi

jq -n --argjson buf "$BUFFER" --argjson old "$OLDEST_H" --argjson can "$CANCELS" \
  --argjson waste "$WASTE" --arg conv "$CONV" --argjson br "$BREACHES" \
  --argjson tripped "$TRIPPED" --argjson groom "$GROOM_TRIGGERED" \
  --argjson rec "$RECONCILED" --argjson dry "$([ "$DRY" = true ] && echo true || echo false)" \
  '{dry_run:$dry, signals:{buffer:$buf, oldest_working_h:$old, cancels_in_window:$can, token_waste_pct:$waste, conventions:$conv},
    breaches:$br, tripped:$tripped, buffer_topped_up:$groom, reconciled:$rec}'
