#!/usr/bin/env bash
# scripts/tasks/aggregate-tokens.sh
# @name        aggregate-tokens
# @description C10 multi-source token ledger. Runs every source under sources/, assembles ledger JSON.
# @target      local
# @args        json
#
# Stdin:  ignored.
# Stdout: ledger JSON. Also written to /opt/nest/data/token-ledger.json.
# Stderr: per-source errors (a single source failing does not abort the run).

set -Eeuo pipefail

DATA_DIR="${NEST_DATA_DIR:-/opt/nest/data}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCES_DIR="$SCRIPT_DIR/sources"
OUT_FILE="$DATA_DIR/token-ledger.json"

# Load config.env for cap envs without leaking unrelated vars to subprocesses.
# shellcheck disable=SC1091
[ -f /opt/nest/config.env ] && set -a && . /opt/nest/config.env && set +a

GENERATED_AT=$(date -u -Iseconds)
SOURCE_JSONS=()

for src in "$SOURCES_DIR"/*.sh; do
  [ -x "$src" ] || continue
  name=$(basename "$src" .sh)
  if out=$("$src" 2>/dev/null) && [ -n "$out" ]; then
    if echo "$out" | jq -e . >/dev/null 2>&1; then
      SOURCE_JSONS+=("$out")
    else
      echo "aggregate-tokens: $name emitted invalid JSON" >&2
    fi
  else
    echo "aggregate-tokens: $name produced no output (skipped)" >&2
  fi
done

# Assemble. `totals.remainingByEngine` aggregates remaining.percent per engine
# across sources where remaining is known. Used by Step 4.5's router.
SOURCES_ARR=$(printf '%s\n' "${SOURCE_JSONS[@]}" | jq -cs '.')

LEDGER=$(jq -n --arg generatedAt "$GENERATED_AT" --argjson sources "$SOURCES_ARR" '
  $sources as $s
  | {
    generatedAt: $generatedAt,
    sources: $s,
    totals: {
      remainingByEngine: (
        $s
        | map(select(.engine != null and .remaining != null and .remaining.unknown != true))
        | group_by(.engine)
        | map({
            key: .[0].engine,
            value: {
              fraction: ((map(.remaining.percent // 0) | add) / (length * 100)),
              sources: length
            }
          })
        | from_entries
      )
    }
  }
')

mkdir -p "$DATA_DIR"
echo "$LEDGER" > "$OUT_FILE"
echo "$LEDGER"
