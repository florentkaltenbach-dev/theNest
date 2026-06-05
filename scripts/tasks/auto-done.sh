#!/usr/bin/env bash
# @name        auto-done
# @description Review → Done risk gate. Advances a Review ticket to Done iff:
#              kind ∉ always_human_kinds, no deny-list hit, a commit exists on
#              its branch, the diff is low-risk (size + no sensitive paths +
#              tests touched), and node --test passes on that branch. Else holds
#              it in Review with needs-human + the reason. Conventions is NOT a
#              gate (it reflects hub startup state, not the branch). Near-zero
#              tokens, deterministic.
# @target      local
# @args        json   ({}; {"dry_run":true} = decide + report, mutate nothing)
set -Eeuo pipefail

NEST_ROOT="/opt/nest"
. "$NEST_ROOT/scripts/tasks/lib/automation-lib.sh"
cd "$NEST_ROOT"
TS=$(date -Iseconds)
LOGDIR=$(automation_cfg log_dir "$NEST_ROOT/data/automation"); mkdir -p "$LOGDIR"

ARGS=$(cat || true); [ -z "$ARGS" ] && ARGS='{}'
DRY=$(echo "$ARGS" | jq -r '.dry_run // false')

# share the working-tree lock with the executor (both checkout branches)
exec 9>"$LOGDIR/repo.lock"
flock -n 9 || { jq -n '{skipped:"repo lock held"}'; exit 0; }

if is_paused && [ "$DRY" != true ]; then jq -n '{paused:true}'; exit 0; fi

# --- risk-gate config ------------------------------------------------------
ALWAYS_HUMAN=$(automation_cfg auto_done.always_human_kinds '[]')
MAX_FILES=$(automation_cfg auto_done.max_files 12)
MAX_LINES=$(automation_cfg auto_done.max_diff_lines 400)
REQ_TESTS=$(automation_cfg auto_done.require_tests_touched true)
SENS=$(automation_cfg auto_done.sensitive_paths '[]')
SENS_PATTERN=$(echo "$SENS" | jq -r 'if length>0 then join("|") else "$^" end')
DENY=$(automation_cfg spec_deny_list '[]')
DENY_PATTERN=$(echo "$DENY" | jq -r 'if length>0 then "\\b(" + join("|") + ")\\b" else "$^" end')

BOOT=$(gql 'query{ teams(filter:{key:{eq:"AI"}}){ nodes{ id
  states{ nodes{ id name } } labels{ nodes{ id name } } } } }')
TID=$(echo "$BOOT" | jq -r '.teams.nodes[0].id')
st(){ echo "$BOOT" | jq -r --arg n "$1" '.teams.nodes[0].states.nodes[]|select(.name==$n)|.id'; }
lbl(){ echo "$BOOT" | jq -r --arg n "$1" '.teams.nodes[0].labels.nodes[]|select(.name==$n)|.id'; }
DONE=$(st Done); L_NEEDHUMAN=$(lbl needs-human)

REVIEW=$(gql 'query($t:ID!){ issues(first:50, filter:{ team:{id:{eq:$t}},
  state:{name:{eq:"Review"}} }){ nodes{ id identifier title description
  branchName labels{ nodes{ id name } } } } }' \
  "$(jq -n --arg t "$TID" '{t:$t}')" | jq -c '.issues.nodes')
N=$(echo "$REVIEW" | jq 'length')

ORIG_BRANCH=$(git rev-parse --abbrev-ref HEAD)
DONED=0; HELD=0; SKIPPED=0; i=0
declare -a DEC=()
rec(){ DEC+=("$(jq -n --arg id "$1" --arg a "$2" --arg r "$3" '{issue:$id,action:$a,reason:$r}')"); }

hold(){ # $1=issueId $2=labelIds(json) $3=reason $4=ident
  rec "$4" hold "$3"; HELD=$((HELD+1))
  [ "$DRY" = true ] && return
  # idempotent: only label + comment the first time needs-human is applied
  if echo "$2" | jq -e --arg h "$L_NEEDHUMAN" 'index($h)' >/dev/null; then return; fi
  local ids; ids=$(echo "$2" | jq -c --arg h "$L_NEEDHUMAN" '. + [$h] | unique')
  gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
    "$(jq -n --arg id "$1" --argjson l "$ids" '{id:$id,i:{labelIds:$l}}')" >/dev/null || true
  gql 'mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}' \
    "$(jq -n --arg id "$1" --arg b "🤖 auto-Done held this in Review: $3" '{i:{issueId:$id,body:$b}}')" >/dev/null || true
}

while [ "$i" -lt "$N" ]; do
  T=$(echo "$REVIEW" | jq -c ".[$i]"); i=$((i+1))
  ID=$(echo "$T" | jq -r .id); IDENT=$(echo "$T" | jq -r .identifier)
  TITLE=$(echo "$T" | jq -r .title); DESC=$(echo "$T" | jq -r '.description // ""')
  BRANCH=$(echo "$T" | jq -r '.branchName // ""')
  LBLS_NAME=$(echo "$T" | jq -c '[.labels.nodes[].name]')
  LBLS_ID=$(echo "$T" | jq -c '[.labels.nodes[].id]')
  KIND=$(echo "$LBLS_NAME" | jq -r '[.[]|select(startswith("kind/"))]|.[0] // "none"')

  # 1. kinds a human must always see
  if [ "$(echo "$ALWAYS_HUMAN" | jq -r --arg k "$KIND" 'index($k) != null')" = true ]; then
    hold "$ID" "$LBLS_ID" "kind \`$KIND\` always needs a human (always_human_kinds)." "$IDENT"; continue
  fi

  # 2. sensitive domain by title/description
  DHIT=$(printf '%s\n%s' "$TITLE" "$DESC" | grep -oiE "$DENY_PATTERN" | head -1 || true)
  if [ -n "$DHIT" ]; then
    hold "$ID" "$LBLS_ID" "hits deny-list (\"$DHIT\") — human review required." "$IDENT"; continue
  fi

  # 3. a verifiable branch must exist
  if [ -z "$BRANCH" ] || ! git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
    hold "$ID" "$LBLS_ID" "no implementation branch found — cannot verify." "$IDENT"; continue
  fi
  if [ "$(git rev-list --count "main..$BRANCH" 2>/dev/null || echo 0)" -eq 0 ]; then
    hold "$ID" "$LBLS_ID" "branch \`$BRANCH\` has no commit beyond main." "$IDENT"; continue
  fi

  # 4. diff risk: size, sensitive paths, tests touched
  NUMSTAT=$(git diff --numstat "main...$BRANCH" 2>/dev/null || true)
  CHANGED=$(printf '%s\n' "$NUMSTAT" | awk 'NF{print $3}')
  NFILES=$(printf '%s\n' "$CHANGED" | grep -c . || true)
  DLINES=$(printf '%s\n' "$NUMSTAT" | awk 'NF{a=$1;d=$2;if(a=="-")a=0;if(d=="-")d=0;s+=a+d} END{print s+0}')
  SHIT=$(printf '%s\n' "$CHANGED" | grep -iE "$SENS_PATTERN" | head -1 || true)
  if [ -n "$SHIT" ]; then
    hold "$ID" "$LBLS_ID" "touches a sensitive path (\`$SHIT\`) — human review required." "$IDENT"; continue
  fi
  if [ "$NFILES" -gt "$MAX_FILES" ] || [ "$DLINES" -gt "$MAX_LINES" ]; then
    hold "$ID" "$LBLS_ID" "change too large for auto-Done ($NFILES files / $DLINES lines, limits $MAX_FILES/$MAX_LINES)." "$IDENT"; continue
  fi
  if [ "$REQ_TESTS" = true ] && ! printf '%s\n' "$CHANGED" | grep -qiE '\.test\.(js|mjs|cjs|ts)$'; then
    hold "$ID" "$LBLS_ID" "no test file added or changed — green tests don't exercise this work." "$IDENT"; continue
  fi

  # 5. tests must pass on the branch (the real gate)
  git checkout -q "$BRANCH" 2>/dev/null || { hold "$ID" "$LBLS_ID" "could not checkout \`$BRANCH\`." "$IDENT"; continue; }
  TESTS_OK=true; node --test >/dev/null 2>&1 || TESTS_OK=false
  git checkout -q "$ORIG_BRANCH"
  if [ "$TESTS_OK" != true ]; then
    hold "$ID" "$LBLS_ID" "\`node --test\` no longer passes on \`$BRANCH\` (verification regression — circuit-breaker signal)." "$IDENT"
    [ "$DRY" = true ] || alog auto-done.jsonl "$(jq -n --arg t "$TS" --arg id "$IDENT" '{ts:$t,issue:$id,action:"held",reason:"verify-regression",breaker:true}')"
    continue
  fi

  # all gates pass → Done
  SHA=$(git rev-parse "$BRANCH")
  rec "$IDENT" done "low-risk ($NFILES files / $DLINES lines), tests pass on \`$SHA\`."; DONED=$((DONED+1))
  if [ "$DRY" != true ]; then
    gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
      "$(jq -n --arg id "$ID" --arg s "$DONE" '{id:$id,i:{stateId:$s}}')" >/dev/null
    gql 'mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}' \
      "$(jq -n --arg id "$ID" --arg b "✅ auto-Done: kind \`$KIND\`, low-risk ($NFILES files / $DLINES lines, tests touched), \`node --test\` passes on \`$BRANCH\` (\`$SHA\`), no sensitive path or deny-list hit. Advanced to Done." '{i:{issueId:$id,body:$b}}')" >/dev/null
    alog auto-done.jsonl "$(jq -n --arg t "$TS" --arg id "$IDENT" --arg sha "$SHA" '{ts:$t,issue:$id,action:"done",sha:$sha}')"
  fi
done

if [ "${#DEC[@]}" -eq 0 ]; then DECJSON='[]'; else DECJSON=$(printf '%s\n' "${DEC[@]}" | jq -s .); fi
jq -n --argjson d "$DONED" --argjson h "$HELD" --argjson s "$SKIPPED" --argjson c "$N" \
  --arg dry "$DRY" --argjson dec "$DECJSON" \
  '{dry_run:($dry=="true"), doned:$d, held:$h, skipped:$s, reviewed:$c, decisions:$dec}'
