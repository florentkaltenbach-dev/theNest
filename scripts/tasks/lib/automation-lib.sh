#!/usr/bin/env bash
# scripts/tasks/lib/automation-lib.sh
#
# Shared helpers for the self-running board jobs (groomer, executor, janitor,
# auto-Done). SOURCE this, don't execute it. Exports: automation_cfg, is_paused,
# gql, alog. Depends: LINEAR_API_TOKEN (config.env), jq, python3, curl.

NEST_ROOT="${NEST_ROOT:-/opt/nest}"
set -a; . "$NEST_ROOT/config.env" 2>/dev/null || true; set +a
LINEAR_API="https://api.linear.app/graphql"
AUTOMATION_YAML="$NEST_ROOT/config/automation.yaml"

# automation_cfg <dotted.key> [default] — print a value from automation.yaml.
# Scalars print raw; dicts/lists print as compact JSON; missing prints default.
automation_cfg() {
  python3 - "$AUTOMATION_YAML" "$1" "${2:-}" <<'PY'
import sys, json, yaml
path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
cur = yaml.safe_load(open(path)) or {}
for part in key.split("."):
    cur = cur.get(part) if isinstance(cur, dict) else None
    if cur is None:
        break
if cur is None:
    print(default)
elif isinstance(cur, (dict, list)):
    print(json.dumps(cur))
else:
    print(cur)
PY
}

# is_paused — return 0 (true) if the pause flag file exists.
is_paused() {
  local flag; flag=$(automation_cfg pause_flag "$NEST_ROOT/data/automation.paused")
  [ -f "$flag" ]
}

# gql <query> [variables-json] — POST to Linear. Prints `.data` on success;
# writes a message to stderr and returns 1 on transport or GraphQL error.
gql() {
  local q="$1" vars="${2-}" resp
  [ -z "$vars" ] && vars='{}'
  resp=$(curl -s --max-time 30 "$LINEAR_API" \
    -H "Authorization: $LINEAR_API_TOKEN" -H "Content-Type: application/json" \
    --data "$(jq -n --arg q "$q" --argjson v "$vars" '{query:$q, variables:$v}')") \
    || { echo "gql: curl failed" >&2; return 1; }
  if echo "$resp" | jq -e '.errors' >/dev/null 2>&1; then
    echo "gql error: $(echo "$resp" | jq -c '.errors')" >&2
    return 1
  fi
  echo "$resp" | jq '.data'
}

# alog <basename> <json-line> — append one JSON object to the automation log dir.
alog() {
  local dir; dir=$(automation_cfg log_dir "$NEST_ROOT/data/automation")
  mkdir -p "$dir"
  printf '%s\n' "$2" >> "$dir/$1"
}

# hub_jwt — mint a short-lived admin JWT for hub API calls, signed with
# NEST_JWT_SECRET via the hub's own signer (no token stored anywhere).
hub_jwt() {
  node --input-type=module -e \
    "import {signJwt} from '$NEST_ROOT/hub/src/server.js'; process.stdout.write(signJwt({id:'automation',role:'admin',name:'automation'}, process.env.NEST_JWT_SECRET, '1h'))"
}

# conventions_fail_count — number of failing checks at the conventions
# self-audit (the regression baseline the executor gates on). Prints 9999 on
# error so a broken probe never reads as "green".
conventions_fail_count() {
  local tok port resp
  tok=$(hub_jwt) || { echo 9999; return 1; }
  port="${NEST_PORT:-3000}"
  resp=$(curl -s --max-time 10 -H "Authorization: Bearer $tok" \
    "http://localhost:$port/api/nest/health/conventions") || { echo 9999; return 1; }
  echo "$resp" | jq '[.conventions.checks[] | select(.pass==false)] | length' 2>/dev/null || echo 9999
}
