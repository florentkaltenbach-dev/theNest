#!/usr/bin/env bash
# @name        run-executor
# @description Executor loop: pulls ONE Spec'd+ai-ready ticket → Working, lets
#              headless Claude implement it on the ticket's branch, verifies
#              tests + conventions (no-regression), then → Review (SHA + verify
#              command) or blocked+needs-human. One ticket per invocation.
# @target      local
# @args        json   ({}; {"dry_run":true} = select + plan only, no changes)
set -Eeuo pipefail

NEST_ROOT="/opt/nest"
. "$NEST_ROOT/scripts/tasks/lib/automation-lib.sh"
cd "$NEST_ROOT"
TS=$(date -Iseconds)

ARGS=$(cat || true); [ -z "$ARGS" ] && ARGS='{}'
DRY=$(echo "$ARGS" | jq -r '.dry_run // false')
WANT=$(echo "$ARGS" | jq -r '.issue // empty')   # optional: force one ticket
LOGDIR=$(automation_cfg log_dir "$NEST_ROOT/data/automation"); mkdir -p "$LOGDIR"

# --- single-flight lock (shared with auto-done: both mutate the working tree)-
exec 9>"$LOGDIR/repo.lock"
flock -n 9 || { jq -n '{skipped:"repo lock held (another executor/auto-done run)"}'; exit 0; }

# --- pause gate ------------------------------------------------------------
if is_paused; then jq -n '{paused:true}'; exit 0; fi

# --- resolve team / states / labels ----------------------------------------
BOOT=$(gql 'query{ teams(filter:{key:{eq:"AI"}}){ nodes{ id
  states{ nodes{ id name } } labels{ nodes{ id name } } } } }')
TID=$(echo "$BOOT" | jq -r '.teams.nodes[0].id')
st(){ echo "$BOOT" | jq -r --arg n "$1" '.teams.nodes[0].states.nodes[]|select(.name==$n)|.id'; }
lbl(){ echo "$BOOT" | jq -r --arg n "$1" '.teams.nodes[0].labels.nodes[]|select(.name==$n)|.id'; }
WORKING=$(st Working); REVIEW=$(st Review)
L_BLOCKED=$(lbl blocked); L_NEEDHUMAN=$(lbl needs-human)

# --- routing: app projects this (Nest) executor must NOT touch --------------
# Each autonomous app board lives in its own Linear project with its own
# executor (different repo + verify). Exclude those project ids; tickets with no
# project stay ours. See config/automation.yaml `external_projects`.
EXTERNAL_PROJECTS=$(automation_cfg external_projects '[]')
not_external='select((.project.id // "") as $p | ($ext | index($p)) | not)'

# --- WIP guard (Working ≤ 2) -----------------------------------------------
WIPC=$(gql 'query($t:ID!){ issues(filter:{team:{id:{eq:$t}},
  state:{name:{eq:"Working"}}}){ nodes{ id project{ id } } } }' \
  "$(jq -n --arg t "$TID" '{t:$t}')" \
  | jq --argjson ext "$EXTERNAL_PROJECTS" "[.issues.nodes[] | $not_external] | length")
if [ "$WIPC" -ge 2 ]; then
  jq -n --argjson w "$WIPC" '{skipped:"Working at WIP limit", working:$w}'; exit 0
fi

# --- pick: highest-priority Spec'd + ai-ready, skip the rest ---------------
ELIG=$(gql 'query($t:ID!){ issues(first:50, filter:{ team:{id:{eq:$t}},
  state:{name:{eq:"Spec'"'"'d"}} }){ nodes{ id identifier title description
  branchName priority project{ id } labels{ nodes{ id name } } } } }' \
  "$(jq -n --arg t "$TID" '{t:$t}')" \
  | jq -c --argjson ext "$EXTERNAL_PROJECTS" "[.issues.nodes[]
      | $not_external
      | select([.labels.nodes[].name] | index(\"ai-ready\"))
      | select(([.labels.nodes[].name] | index(\"human-only\")) | not)
      | select(([.labels.nodes[].name] | index(\"needs-spec\")) | not)
      | select(([.labels.nodes[].name] | index(\"blocked\")) | not)]")
if [ -n "$WANT" ]; then
  PICK=$(echo "$ELIG" | jq -c --arg w "$WANT" '[.[]|select(.identifier==$w)] | .[0] // empty')
  [ -z "$PICK" ] && { jq -n --arg w "$WANT" '{skipped:("requested ticket "+$w+" is not an eligible Spec'"'"'d+ai-ready ticket")}'; exit 0; }
else
  PICK=$(echo "$ELIG" | jq -c 'sort_by(if .priority==0 then 999 else .priority end) | .[0] // empty')
  [ -z "$PICK" ] && { jq -n '{skipped:"no eligible Spec'"'"'d ticket"}'; exit 0; }
fi

ID=$(echo "$PICK" | jq -r .id);    IDENT=$(echo "$PICK" | jq -r .identifier)
TITLE=$(echo "$PICK" | jq -r .title); DESC=$(echo "$PICK" | jq -r '.description // ""')
BRANCH=$(echo "$PICK" | jq -r .branchName)
CUR_IDS=$(echo "$PICK" | jq -c '[.labels.nodes[].id]')

if [ "$DRY" = "true" ]; then
  jq -n --arg id "$IDENT" --arg b "$BRANCH" --arg t "$TITLE" --argjson w "$WIPC" \
    '{dry_run:true, would_execute:$id, branch:$b, title:$t, working_now:$w}'
  exit 0
fi

# --- branch FIRST, from main -----------------------------------------------
# Branch off main (the automation lives there now) so each ticket branch is a
# clean fork of main — no stacking, and prod stays on main between runs. Done
# before the Linear move so a git failure can't orphan the ticket in Working.
# The EXIT trap returns the working tree to main (discarding any uncommitted
# leftovers on the ticket branch) so a blocked/failed run never leaves prod on
# a feature branch. Only armed once we actually leave main.
RETURN_TO_MAIN=0
cleanup_branch(){ [ "$RETURN_TO_MAIN" = 1 ] && { git reset -q --hard >/dev/null 2>&1; git checkout -q main >/dev/null 2>&1; } || true; }
trap cleanup_branch EXIT
git checkout -q main
git branch -D "$BRANCH" >/dev/null 2>&1 || true
git checkout -q -b "$BRANCH" main
RETURN_TO_MAIN=1
START_SHA=$(git rev-parse HEAD)

# --- now move to Working ---------------------------------------------------
gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
  "$(jq -n --arg id "$ID" --arg s "$WORKING" '{id:$id,i:{stateId:$s}}')" >/dev/null
alog executor.jsonl "$(jq -n --arg id "$IDENT" --arg t "$TS" '{ts:$t,issue:$id,action:"working"}')"
BASE_FAILS=$(conventions_fail_count)

# --- hand to headless Claude (the engine) ----------------------------------
RUNLOG="$LOGDIR/exec-$IDENT.log"
PROMPT="You are the Nest executor implementing exactly one Linear ticket, $IDENT,
on branch $BRANCH. Read CLAUDE.md and AGENTS.md first and follow every
convention. Implement the ticket below to satisfy its acceptance criteria.
Then run \`node --test\` and make it pass. Commit with a message
'<verb> <object> ($IDENT)' including the Co-Authored-By trailer; stage files by
name (never 'git add -A'). Do NOT push, do NOT open a PR, do NOT modify Linear,
do NOT touch any other ticket. If you cannot finish (missing dependency,
ambiguous spec, unfixable build), STOP without committing broken code and end
your reply with exactly: EXECUTOR_BLOCKED: <one-line reason>.

--- TICKET $IDENT: $TITLE ---
$DESC"

set +e
claude -p "$PROMPT" --mcp-config "$NEST_ROOT/.mcp.json" \
  --dangerously-skip-permissions --permission-mode bypassPermissions \
  </dev/null >"$RUNLOG" 2>&1
set -e

# --- verify (never trust the agent's word) ---------------------------------
NEW_SHA=$(git rev-parse HEAD)
MADE_COMMIT=$([ "$(git rev-list --count "$START_SHA"..HEAD)" -gt 0 ] && echo true || echo false)
BLOCKED_MARK=$(grep -oE 'EXECUTOR_BLOCKED:.*' "$RUNLOG" | head -1 || true)
node --test >>"$RUNLOG" 2>&1 && TESTS_OK=true || TESTS_OK=false
NOW_FAILS=$(conventions_fail_count)
NO_REGRESS=$([ "$NOW_FAILS" -le "$BASE_FAILS" ] && echo true || echo false)

block(){ # $1 = reason — adds blocked+needs-human, preserving existing labels.
  local newl
  newl=$(echo "$CUR_IDS" | jq -c --arg b "$L_BLOCKED" --arg h "$L_NEEDHUMAN" '. + [$b,$h] | unique')
  gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
    "$(jq -n --arg id "$ID" --argjson l "$newl" '{id:$id,i:{labelIds:$l}}')" >/dev/null || true
  gql 'mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}' \
    "$(jq -n --arg id "$ID" --arg b "🤖 executor blocked on $BRANCH: $1 (left in Working for a human; log: $RUNLOG)" '{i:{issueId:$id,body:$b}}')" >/dev/null || true
  alog executor.jsonl "$(jq -n --arg id "$IDENT" --arg r "$1" --arg t "$TS" '{ts:$t,issue:$id,action:"blocked",reason:$r}')"
  jq -n --arg id "$IDENT" --arg r "$1" '{executed:$id, result:"blocked", reason:$r}'
}

if [ -n "$BLOCKED_MARK" ]; then block "${BLOCKED_MARK#EXECUTOR_BLOCKED: }"; exit 0; fi
if [ "$MADE_COMMIT" != true ]; then block "agent made no commit (cc exit; see log)"; exit 0; fi
if [ "$TESTS_OK" != true ]; then block "node --test failed after implementation"; exit 0; fi
if [ "$NO_REGRESS" != true ]; then block "conventions regressed ($BASE_FAILS→$NOW_FAILS failing checks)"; exit 0; fi

# --- success → Review with SHA + verification command ----------------------
gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
  "$(jq -n --arg id "$ID" --arg s "$REVIEW" '{id:$id,i:{stateId:$s}}')" >/dev/null
gql 'mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}' \
  "$(jq -n --arg id "$ID" --arg b "✅ executor: implemented on branch \`$BRANCH\`, commit \`$NEW_SHA\`. Tests pass; conventions did not regress ($BASE_FAILS→$NOW_FAILS failing). Verify: \`git checkout $BRANCH && node --test\` then the conventions self-audit. Awaiting human review." '{i:{issueId:$id,body:$b}}')" >/dev/null
alog executor.jsonl "$(jq -n --arg id "$IDENT" --arg sha "$NEW_SHA" --arg br "$BRANCH" '{issue:$id,action:"review",sha:$sha,branch:$br}')"
jq -n --arg id "$IDENT" --arg sha "$NEW_SHA" --arg br "$BRANCH" \
  '{executed:$id, result:"review", commit:$sha, branch:$br}'
