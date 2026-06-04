#!/usr/bin/env bash
# @name        auto-done
# @description Review → Done gate for low-risk kinds only. Advances a Review
#              ticket to Done iff: kind ∈ auto_done_allow_kinds, no deny-list
#              hit, a commit exists on its branch, node --test passes on that
#              branch, and conventions is not red. Else leaves it in Review
#              with needs-human + the reason. Near-zero tokens, deterministic.
# @target      local
# @args        json   ({})
set -Eeuo pipefail

NEST_ROOT="/opt/nest"
. "$NEST_ROOT/scripts/tasks/lib/automation-lib.sh"
cd "$NEST_ROOT"
TS=$(date -Iseconds)
LOGDIR=$(automation_cfg log_dir "$NEST_ROOT/data/automation"); mkdir -p "$LOGDIR"

# share the working-tree lock with the executor (both checkout branches)
exec 9>"$LOGDIR/repo.lock"
flock -n 9 || { jq -n '{skipped:"repo lock held"}'; exit 0; }

if is_paused; then jq -n '{paused:true}'; exit 0; fi

ALLOW=$(automation_cfg auto_done_allow_kinds '[]')
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

hold(){ # $1=issueId $2=labelIds(json) $3=reason
  local ids; ids=$(echo "$2" | jq -c --arg h "$L_NEEDHUMAN" '. + [$h] | unique')
  # only act if needs-human not already present (idempotent)
  if echo "$2" | jq -e --arg h "$L_NEEDHUMAN" 'index($h)' >/dev/null; then return; fi
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
  ALLOWED=$(echo "$ALLOW" | jq -r --arg k "$KIND" 'index($k) != null')
  if [ "$ALLOWED" != true ]; then
    hold "$ID" "$LBLS_ID" "kind \`$KIND\` is not in the auto-Done allow-list ($(echo "$ALLOW"|jq -r 'join(", ")')). A human must approve this."
    HELD=$((HELD+1)); continue
  fi

  HAY=$(printf '%s\n%s' "$TITLE" "$DESC")
  DHIT=$(printf '%s' "$HAY" | grep -oiE "$DENY_PATTERN" | head -1 || true)
  if [ -n "$DHIT" ]; then
    hold "$ID" "$LBLS_ID" "hits deny-list (\"$DHIT\") — human review required."
    HELD=$((HELD+1)); continue
  fi

  if [ -z "$BRANCH" ] || ! git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
    hold "$ID" "$LBLS_ID" "no implementation branch found — cannot verify."
    HELD=$((HELD+1)); continue
  fi
  if [ "$(git rev-list --count "main..$BRANCH" 2>/dev/null || echo 0)" -eq 0 ]; then
    hold "$ID" "$LBLS_ID" "branch \`$BRANCH\` has no commit beyond main."
    HELD=$((HELD+1)); continue
  fi

  # re-run verification on the branch
  git checkout -q "$BRANCH" 2>/dev/null || { hold "$ID" "$LBLS_ID" "could not checkout \`$BRANCH\`."; HELD=$((HELD+1)); continue; }
  TESTS_OK=true; node --test >/dev/null 2>&1 || TESTS_OK=false
  git checkout -q "$ORIG_BRANCH"
  CONV=$(conventions_status)

  if [ "$TESTS_OK" != true ]; then
    hold "$ID" "$LBLS_ID" "\`node --test\` no longer passes on \`$BRANCH\` (verification regression — circuit-breaker signal)."
    alog auto-done.jsonl "$(jq -n --arg t "$TS" --arg id "$IDENT" '{ts:$t,issue:$id,action:"held",reason:"verify-regression",breaker:true}')"
    HELD=$((HELD+1)); continue
  fi
  if [ "$CONV" = red ]; then
    hold "$ID" "$LBLS_ID" "conventions self-audit is red."
    HELD=$((HELD+1)); continue
  fi

  # all gates pass → Done
  SHA=$(git rev-parse "$BRANCH")
  gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
    "$(jq -n --arg id "$ID" --arg s "$DONE" '{id:$id,i:{stateId:$s}}')" >/dev/null
  gql 'mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}' \
    "$(jq -n --arg id "$ID" --arg b "✅ auto-Done: kind \`$KIND\` in the allow-list, \`node --test\` passes on \`$BRANCH\` (\`$SHA\`), conventions not red, no deny-list hit. Advanced to Done." '{i:{issueId:$id,body:$b}}')" >/dev/null
  alog auto-done.jsonl "$(jq -n --arg t "$TS" --arg id "$IDENT" --arg sha "$SHA" '{ts:$t,issue:$id,action:"done",sha:$sha}')"
  DONED=$((DONED+1))
done

jq -n --argjson d "$DONED" --argjson h "$HELD" --argjson s "$SKIPPED" --argjson c "$N" \
  '{doned:$d, held:$h, skipped:$s, reviewed:$c}'
