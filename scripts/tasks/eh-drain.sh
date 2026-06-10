#!/usr/bin/env bash
# @name        eh-drain
# @description Burn-through mode for the Energy Hack board: invoke the EH executor
#              back-to-back with NO waits until the Spec'd queue is empty, a
#              token/rate-limit wall is hit, or the loop is paused. Replaces the
#              fixed-cadence timer — run this when you have tokens to spend and it
#              sprints through as many tickets as those tokens allow, then stops
#              cleanly. One ticket at a time (the executor's own flock + WIP=1).
# @target      local
# @args        json   (ignored)
set -Eeuo pipefail

NEST_ROOT="/opt/nest"
LOGDIR="/opt/nest/data/automation-eh"; mkdir -p "$LOGDIR"
EXEC="$NEST_ROOT/scripts/tasks/run-eh-executor.sh"
MAX="${EH_DRAIN_MAX:-40}"          # safety cap on iterations
WAIT_SECS="${EH_DRAIN_WAIT:-8}"    # brief pause only when waiting on an in-flight run

# single-flight: only one drain at a time
exec 8>"$LOGDIR/drain.lock"
flock -n 8 || { jq -n '{skipped:"drain already running"}'; exit 0; }

stamp(){ date -Iseconds; }
dlog(){ printf '%s %s\n' "$(stamp)" "$1" >> "$LOGDIR/drain.log"; }

dlog "drain start (max=$MAX)"
i=0; built=0
while [ "$i" -lt "$MAX" ]; do
  i=$((i+1))
  OUT=$(echo '{}' | "$EXEC" 2>>"$LOGDIR/drain.log" || true)
  dlog "iter $i -> $OUT"

  EXECUTED=$(echo "$OUT" | jq -r '.executed // empty' 2>/dev/null || true)
  RESULT=$(echo "$OUT"   | jq -r '.result   // empty' 2>/dev/null || true)
  SKIPPED=$(echo "$OUT"  | jq -r '.skipped  // empty' 2>/dev/null || true)
  PAUSED=$(echo "$OUT"   | jq -r '.paused   // empty' 2>/dev/null || true)

  # tokens exhausted → stop (the ticket was reverted to Spec'd; rerun later)
  if [ "$RESULT" = "token_limit" ]; then
    dlog "stop: token_limit after $built built"
    jq -n --argjson b "$built" --argjson n "$i" '{stopped:"token_limit", built:$b, iterations:$n}'; exit 0
  fi
  # paused by a human → stop
  if [ -n "$PAUSED" ]; then
    dlog "stop: paused"
    jq -n --argjson b "$built" '{stopped:"paused", built:$b}'; exit 0
  fi
  # a ticket got worked (done/review/blocked) → keep sprinting, no wait
  if [ -n "$EXECUTED" ]; then
    [ "$RESULT" = "done" ] || [ "$RESULT" = "review" ] && built=$((built+1))
    continue
  fi
  # transient: another run holds the repo lock / WIP full → wait briefly, retry
  case "$SKIPPED" in
    *"lock held"*|*"WIP limit"*) i=$((i-1)); sleep "$WAIT_SECS"; continue ;;
  esac
  # queue drained, or any other skip → done
  dlog "stop: ${SKIPPED:-empty} after $built built"
  jq -n --argjson b "$built" --arg s "${SKIPPED:-queue empty}" '{stopped:$s, built:$b}'; exit 0
done

dlog "stop: max_iterations after $built built"
jq -n --argjson b "$built" --argjson n "$i" '{stopped:"max_iterations", built:$b, iterations:$n}'
