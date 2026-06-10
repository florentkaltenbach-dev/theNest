#!/usr/bin/env bash
# @name        run-eh-executor
# @description Energy Hack executor: pulls ONE Spec'd+ai-ready EH ticket (lowest
#              "Build order") → Working, branches it from the accumulate branch,
#              lets headless Claude implement it in /opt/energyhack, verifies with
#              pytest, then merges into the build branch + → Done (auto), or
#              → needs-human on genuine failure. Token/rate-limit walls revert the
#              ticket to Spec'd (NOT needs-human) so the next timer fire resumes.
#              One ticket per invocation.
# @target      local
# @args        json   ({}; {"dry_run":true} = select + plan only, no changes)
set -Eeuo pipefail

NEST_ROOT="/opt/nest"
. "$NEST_ROOT/scripts/tasks/lib/automation-lib.sh"   # gql + config.env (LINEAR_API_TOKEN)
EH_YAML="$NEST_ROOT/config/automation-eh.yaml"
TS=$(date -Iseconds)

# --- tiny config reader (the lib's automation_cfg is pinned to the Nest yaml) --
ehcfg(){ python3 - "$EH_YAML" "$1" "${2:-}" <<'PY'
import sys, json, yaml
path, key, default = sys.argv[1], sys.argv[2], sys.argv[3]
cur = yaml.safe_load(open(path)) or {}
for part in key.split('.'):
    cur = cur.get(part) if isinstance(cur, dict) else None
    if cur is None: break
if cur is None: print(default)
elif isinstance(cur, bool): print('true' if cur else 'false')
elif isinstance(cur, (dict, list)): print(json.dumps(cur))
else: print(cur)
PY
}

REPO=$(ehcfg repo /opt/energyhack)
BUILD=$(ehcfg build_branch build)
TEAM_KEY=$(ehcfg team_key AI)            # team that hosts the board (states/labels live here)
PROJECT_ID=$(ehcfg project_id "")        # this executor's scope within that team
VENV=$(ehcfg venv "$REPO/.venv")
LOGDIR=$(ehcfg log_dir "$NEST_ROOT/data/automation-eh"); mkdir -p "$LOGDIR"
PAUSE=$(ehcfg pause_flag "$NEST_ROOT/data/automation-eh.paused")
WIP_MAX=$(ehcfg wip_max 1)
AUTODONE=$(ehcfg auto_done true)
PUSH=$(ehcfg push_on_merge false)
TOKPATS=$(ehcfg token_limit_patterns '[]' | jq -r 'join("|")')

ARGS=$(cat || true); [ -z "$ARGS" ] && ARGS='{}'
DRY=$(echo "$ARGS" | jq -r '.dry_run // false')
WANT=$(echo "$ARGS" | jq -r '.issue // empty')

ehlog(){ printf '%s\n' "$(printf '%s' "$1" | jq -c .)" >> "$LOGDIR/executor.jsonl"; }

# --- single-flight lock (EH-specific tree) ---------------------------------
exec 9>"$LOGDIR/repo.lock"
flock -n 9 || { jq -n '{skipped:"eh repo lock held"}'; exit 0; }

# --- pause gate ------------------------------------------------------------
[ -f "$PAUSE" ] && { jq -n '{paused:true}'; exit 0; }

# --- resolve team / states / labels ----------------------------------------
BOOT=$(gql 'query($k:String!){ teams(filter:{key:{eq:$k}}){ nodes{ id
  states{ nodes{ id name } } labels{ nodes{ id name } } } } }' \
  "$(jq -n --arg k "$TEAM_KEY" '{k:$k}')") || { jq -n '{error:"linear boot failed"}'; exit 0; }
TID=$(echo "$BOOT" | jq -r '.teams.nodes[0].id')
st(){ echo "$BOOT" | jq -r --arg n "$1" '.teams.nodes[0].states.nodes[]|select(.name==$n)|.id'; }
lbl(){ echo "$BOOT" | jq -r --arg n "$1" '.teams.nodes[0].labels.nodes[]|select(.name==$n)|.id'; }
SPECD=$(st "Spec'd"); WORKING=$(st Working); REVIEW=$(st Review); DONE=$(st Done)
L_BLOCKED=$(lbl blocked); L_NEEDHUMAN=$(lbl needs-human)

# --- routing guard: this executor acts ONLY within its own project ----------
# The board shares team AI with the Nest board; project_id is the partition.
# Refuse to run unscoped — an empty project_id would scan all of team AI and
# collide with the Nest executor. See config/automation-eh.yaml.
[ -z "$PROJECT_ID" ] && { jq -n '{error:"project_id not set in automation-eh.yaml — refusing to scan all of team AI"}'; exit 0; }

# --- WIP guard (scoped to this project) ------------------------------------
WIPC=$(gql 'query($p:ID!){ issues(filter:{project:{id:{eq:$p}},
  state:{name:{eq:"Working"}}}){ nodes{ id } } }' \
  "$(jq -n --arg p "$PROJECT_ID" '{p:$p}')" | jq '.issues.nodes|length')
if [ "$WIPC" -ge "$WIP_MAX" ]; then
  jq -n --argjson w "$WIPC" '{skipped:"EH Working at WIP limit", working:$w}'; exit 0
fi

# --- pick: eligible Spec'd+ai-ready, lowest "Build order: N" (fallback number) -
ELIG=$(gql 'query($p:ID!){ issues(first:100, filter:{ project:{id:{eq:$p}},
  state:{name:{eq:"Spec'"'"'d"}} }){ nodes{ id identifier number title description
  branchName labels{ nodes{ name } } } } }' \
  "$(jq -n --arg p "$PROJECT_ID" '{p:$p}')" \
  | jq -c '[.issues.nodes[]
      | select([.labels.nodes[].name] | index("ai-ready"))
      | select(([.labels.nodes[].name] | index("blocked")) | not)
      | select(([.labels.nodes[].name] | index("needs-human")) | not)
      | . + {order: ((.description // "") | capture("(?i)Build order:\\s*(?<n>[0-9]+)").n // "999" | tonumber)}]')

if [ -n "$WANT" ]; then
  PICK=$(echo "$ELIG" | jq -c --arg w "$WANT" '[.[]|select(.identifier==$w)] | .[0] // empty')
  [ -z "$PICK" ] && { jq -n --arg w "$WANT" '{skipped:("requested "+$w+" not eligible")}'; exit 0; }
else
  PICK=$(echo "$ELIG" | jq -c 'sort_by(.order, .number) | .[0] // empty')
  [ -z "$PICK" ] && { jq -n '{skipped:"no eligible Spec'"'"'d EH ticket"}'; exit 0; }
fi

ID=$(echo "$PICK" | jq -r .id);    IDENT=$(echo "$PICK" | jq -r .identifier)
TITLE=$(echo "$PICK" | jq -r .title); DESC=$(echo "$PICK" | jq -r '.description // ""')
ORDER=$(echo "$PICK" | jq -r .order)
BRANCH=$(echo "$PICK" | jq -r '.branchName // ("eh-"+(.number|tostring))')

if [ "$DRY" = "true" ]; then
  jq -n --arg id "$IDENT" --arg b "$BRANCH" --arg t "$TITLE" --argjson o "$ORDER" --argjson w "$WIPC" \
    '{dry_run:true, would_execute:$id, build_order:$o, branch:$b, title:$t, working_now:$w}'
  exit 0
fi

cd "$REPO"

# --- ensure the accumulate branch exists -----------------------------------
git rev-parse --verify "$BUILD" >/dev/null 2>&1 || git branch "$BUILD" main

# --- branch the ticket FROM the build branch (so it sees prior tickets) -----
RETURN_TO_BUILD=0
cleanup(){ [ "$RETURN_TO_BUILD" = 1 ] && { git reset -q --hard >/dev/null 2>&1; git checkout -q "$BUILD" >/dev/null 2>&1; } || true; }
trap cleanup EXIT
git checkout -q "$BUILD"
git branch -D "$BRANCH" >/dev/null 2>&1 || true
git checkout -q -b "$BRANCH" "$BUILD"
RETURN_TO_BUILD=1
START_SHA=$(git rev-parse HEAD)

# --- bootstrap the venv so the engine + verify can run pytest ---------------
RUNLOG="$LOGDIR/exec-$IDENT.log"
{ echo "=== $TS  $IDENT  $TITLE (build order $ORDER) ==="; } > "$RUNLOG"
[ -d "$VENV" ] || python3 -m venv "$VENV" >>"$RUNLOG" 2>&1
"$VENV/bin/pip" install -q --upgrade pip >>"$RUNLOG" 2>&1 || true
"$VENV/bin/pip" install -q pytest >>"$RUNLOG" 2>&1 || true
[ -f requirements.txt ] && "$VENV/bin/pip" install -q -r requirements.txt >>"$RUNLOG" 2>&1 || true

# --- now move the ticket to Working ----------------------------------------
gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
  "$(jq -n --arg id "$ID" --arg s "$WORKING" '{id:$id,i:{stateId:$s}}')" >/dev/null
ehlog "$(jq -n --arg id "$IDENT" --arg t "$TS" '{ts:$t,issue:$id,action:"working"}')"

# --- hand to headless Claude (the engine) ----------------------------------
PROMPT="You are the Energy Hack executor implementing exactly one Linear ticket,
$IDENT, for the EnergyHackPrep app in the CURRENT directory ($REPO), on git
branch $BRANCH. That branch ALREADY contains every previously-completed ticket —
build on what is there, do not recreate it.

Authoritative spec: the files 01_foundation_and_asset_copilot.md,
02_battery_brain.md, 03_demo_hardening_and_reframe_kit.md in this repo. Read the
one the ticket references for full detail.

Hard rules:
- Build at the REPO ROOT. Do NOT create a nested energy-hack/ subfolder.
- The app MUST work offline with ZERO API keys (template mode). Network/LLM is an
  enhancement, never a dependency.
- Put genuinely shared logic in toolkit/. Reuse existing toolkit modules; never
  duplicate them.
- Implement ONLY this ticket's slice. Do not build other tickets' files.
- Write a pytest test under tests/ that proves this ticket's acceptance criteria.
  Use the project venv to run it: \`$VENV/bin/python -m pytest -q\`. The WHOLE
  suite must pass (do not break earlier tickets). Install any genuinely missing
  dependency into that venv with \`$VENV/bin/pip install\`.
- Commit with a message '<verb> <object> ($IDENT)' including the Co-Authored-By
  trailer. Stage files by name (never 'git add -A'). Do NOT push, do NOT open a
  PR, do NOT modify Linear, do NOT touch any other ticket.
- If you cannot finish (ambiguous spec, unfixable failure), STOP without
  committing broken code and end your reply with exactly:
  EXECUTOR_BLOCKED: <one-line reason>.

--- TICKET $IDENT: $TITLE ---
$DESC"

set +e
claude -p "$PROMPT" --mcp-config "$NEST_ROOT/.mcp.json" \
  --dangerously-skip-permissions --permission-mode bypassPermissions \
  </dev/null >>"$RUNLOG" 2>&1
set -e

# --- classify the run ------------------------------------------------------
NEW_SHA=$(git rev-parse HEAD)
MADE_COMMIT=$([ "$(git rev-list --count "$START_SHA"..HEAD)" -gt 0 ] && echo true || echo false)
BLOCKED_MARK=$(grep -oE 'EXECUTOR_BLOCKED:.*' "$RUNLOG" | head -1 || true)
TOKEN_HIT=$([ -n "$TOKPATS" ] && grep -qiE "$TOKPATS" "$RUNLOG" && echo true || echo false)

# Token/rate-limit wall with no commit → transient. Revert to Spec'd, no blame.
if [ "$TOKEN_HIT" = true ] && [ "$MADE_COMMIT" != true ]; then
  gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
    "$(jq -n --arg id "$ID" --arg s "$SPECD" '{id:$id,i:{stateId:$s}}')" >/dev/null || true
  ehlog "$(jq -n --arg id "$IDENT" --arg t "$TS" '{ts:$t,issue:$id,action:"token_limit",note:"reverted to Spec'"'"'d; will retry next tick"}')"
  jq -n --arg id "$IDENT" '{executed:$id, result:"token_limit", note:"reverted to Spec'"'"'d for retry"}'
  exit 0
fi

# --- verify (never trust the agent) ----------------------------------------
"$VENV/bin/python" -m pytest -q >>"$RUNLOG" 2>&1; PYRC=$?
# pytest: 0=all pass, 5=no tests collected (gamed gate), else=failures/errors.
TESTS_OK=$([ "$PYRC" -eq 0 ] && echo true || echo false)

block(){ # $1 = reason — add blocked+needs-human, move to Review for a human.
  gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
    "$(jq -n --arg id "$ID" --arg s "$REVIEW" '{id:$id,i:{stateId:$s}}')" >/dev/null || true
  # add labels by id (preserve ai-ready)
  CURIDS=$(gql 'query($id:String!){ issue(id:$id){ labels{ nodes{ id } } } }' \
    "$(jq -n --arg id "$ID" '{id:$id}')" | jq -c '[.issue.labels.nodes[].id]')
  ADD=$(echo "$CURIDS" | jq -c --arg b "$L_BLOCKED" --arg h "$L_NEEDHUMAN" '. + [$b,$h] | unique')
  gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
    "$(jq -n --arg id "$ID" --argjson l "$ADD" '{id:$id,i:{labelIds:$l}}')" >/dev/null || true
  gql 'mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}' \
    "$(jq -n --arg id "$ID" --arg b "🤖 EH executor blocked on \`$BRANCH\`: $1 (build branch untouched; log: $RUNLOG)" '{i:{issueId:$id,body:$b}}')" >/dev/null || true
  ehlog "$(jq -n --arg id "$IDENT" --arg r "$1" --arg t "$TS" '{ts:$t,issue:$id,action:"blocked",reason:$r}')"
  jq -n --arg id "$IDENT" --arg r "$1" '{executed:$id, result:"blocked", reason:$r}'
}

if [ -n "$BLOCKED_MARK" ]; then block "${BLOCKED_MARK#EXECUTOR_BLOCKED: }"; exit 0; fi
if [ "$MADE_COMMIT" != true ]; then block "agent made no commit (see log)"; exit 0; fi
if [ "$PYRC" -eq 5 ]; then block "pytest collected no tests — acceptance not exercised"; exit 0; fi
if [ "$TESTS_OK" != true ]; then block "pytest failed after implementation (rc=$PYRC)"; exit 0; fi

# --- success → merge into the build branch, then advance the ticket --------
git checkout -q "$BUILD"
git merge -q --no-ff --no-edit "$BRANCH" >>"$RUNLOG" 2>&1
MERGE_SHA=$(git rev-parse HEAD)
RETURN_TO_BUILD=0   # we are already on build with the merge committed; don't reset
if [ "$PUSH" = true ]; then git push -q origin "$BUILD" >>"$RUNLOG" 2>&1 || true; fi

TARGET=$([ "$AUTODONE" = true ] && echo "$DONE" || echo "$REVIEW")
RESULT=$([ "$AUTODONE" = true ] && echo "done" || echo "review")
gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
  "$(jq -n --arg id "$ID" --arg s "$TARGET" '{id:$id,i:{stateId:$s}}')" >/dev/null
gql 'mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}' \
  "$(jq -n --arg id "$ID" --arg b "✅ EH executor: implemented on \`$BRANCH\`, merged into \`$BUILD\` (\`$MERGE_SHA\`). pytest green. The app now runs from the \`$BUILD\` branch." '{i:{issueId:$id,body:$b}}')" >/dev/null
ehlog "$(jq -n --arg id "$IDENT" --arg sha "$MERGE_SHA" --arg br "$BUILD" --arg r "$RESULT" '{ts:"'"$TS"'",issue:$id,action:$r,sha:$sha,branch:$br}')"
jq -n --arg id "$IDENT" --arg sha "$MERGE_SHA" --arg br "$BUILD" --arg r "$RESULT" \
  '{executed:$id, result:$r, merged_into:$br, commit:$sha}'
