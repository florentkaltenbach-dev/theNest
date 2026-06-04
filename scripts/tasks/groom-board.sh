#!/usr/bin/env bash
# @name        groom-board
# @description Backlog → Spec'd groomer: drafts specs for ai-ready+needs-spec
#              tickets (Codex, Claude fallback) until Spec'd hits buffer_target.
# @target      local
# @args        json   ({}; optional {"limit":N} caps how many to spec this run)
set -Eeuo pipefail

NEST_ROOT="/opt/nest"
. "$NEST_ROOT/scripts/tasks/lib/automation-lib.sh"
SCHEMA="$NEST_ROOT/scripts/tasks/sources/spec-schema.json"
ERRLOG=$(mktemp); trap 'rm -f "$ERRLOG"' EXIT
TODAY=$(date -I)

ARGS=$(cat || true); [ -z "$ARGS" ] && ARGS='{}'
LIMIT=$(echo "$ARGS" | jq -r '.limit // empty')

# --- pause gate ------------------------------------------------------------
if is_paused; then
  jq -n '{paused:true, specced:0, flagged:0, skipped:0, note:"automation.paused present"}'
  exit 0
fi

CFG_ENGINE=$(automation_cfg spec_engine codex)
CFG_FALLBACK=$(automation_cfg spec_fallback claude)
CFG_MODEL=$(automation_cfg codex_model "")
BUFFER=$(automation_cfg buffer_target 3)
DENY=$(automation_cfg spec_deny_list '[]')

# --- resolve team, states, label ids --------------------------------------
BOOT=$(gql 'query{ teams(filter:{key:{eq:"AI"}}){ nodes{ id
  states{ nodes{ id name type } } labels{ nodes{ id name } } } } }')
TID=$(echo "$BOOT" | jq -r '.teams.nodes[0].id')
lbl(){ echo "$BOOT" | jq -r --arg n "$1" '.teams.nodes[0].labels.nodes[]|select(.name==$n)|.id'; }
st(){ echo "$BOOT" | jq -r --arg n "$1" '.teams.nodes[0].states.nodes[]|select(.name==$n)|.id'; }
SPECD_STATE=$(st "Spec'd"); L_NEEDSPEC=$(lbl needs-spec); L_NEEDHUMAN=$(lbl needs-human)

# --- how many do we need? --------------------------------------------------
SPECD_COUNT=$(gql 'query($t:ID!){ issues(filter:{team:{id:{eq:$t}},
  state:{name:{eq:"Spec'"'"'d"}}}){ nodes{ id } } }' \
  "$(jq -n --arg t "$TID" '{t:$t}')" | jq '.issues.nodes|length')
NEED=$(( BUFFER - SPECD_COUNT ))
[ -n "$LIMIT" ] && [ "$LIMIT" -lt "$NEED" ] && NEED=$LIMIT

# --- fetch Backlog candidates (needs-spec), newest filter, sort client-side -
CANDS=$(gql 'query($t:ID!){ issues(first:50, filter:{ team:{id:{eq:$t}},
  state:{type:{eq:"backlog"}}, labels:{some:{name:{eq:"needs-spec"}}} }){
  nodes{ id identifier title description priority
    labels{ nodes{ id name } } } } }' \
  "$(jq -n --arg t "$TID" '{t:$t}')" \
  | jq -c '[.issues.nodes[]
      | select([.labels.nodes[].name] | index("ai-ready"))
      | select(([.labels.nodes[].name] | index("human-only")) | not)]
      | sort_by(if .priority==0 then 999 else .priority end)')

CONSIDERED=$(echo "$CANDS" | jq 'length')
if [ "$NEED" -le 0 ]; then
  jq -n --argjson c "$CONSIDERED" --argjson b "$SPECD_COUNT" \
    '{specced:0, flagged:0, skipped:$c, note:"buffer full", specd_count:$b}'
  exit 0
fi

# --- engines ---------------------------------------------------------------
build_prompt(){ # $1=title $2=desc
  cat <<EOF
You are drafting a specification for a Linear ticket on the Nest project (a raw
node:http hub + vanilla HTML client; tests run via \`node --test\`, a self-audit
lives at GET /api/nest/health/conventions). Do NOT run commands or read files —
draft only from the ticket text below.

Ticket title: $1
Ticket description: ${2:-(empty)}

Produce a crisp goal, a one-paragraph context, an integer priority
(1=urgent, 2=high, 3=normal, 4=low), and 2-4 acceptance criteria. At least TWO
criteria MUST be mechanically verifiable: set verifiable=true and give an exact
shell/curl/test/file-check command in "command". For non-verifiable criteria set
verifiable=false and command=null.
EOF
}

extract_json(){ python3 -c '
import sys,json
s=sys.stdin.read(); i=s.find("{")
while i!=-1:
    d=0
    for j in range(i,len(s)):
        if s[j]=="{": d+=1
        elif s[j]=="}":
            d-=1
            if d==0:
                try: json.loads(s[i:j+1]); print(s[i:j+1]); sys.exit(0)
                except Exception: break
    i=s.find("{",i+1)
sys.exit(1)'; }

run_engine(){ # $1=engine $2=prompt $3=outfile -> 0 ok
  case "$1" in
    codex)
      local m=(); [ -n "$CFG_MODEL" ] && m=(-m "$CFG_MODEL")
      codex exec --sandbox read-only "${m[@]}" --output-schema "$SCHEMA" "$2" \
        </dev/null >"$3" 2>>"$ERRLOG" && jq -e . "$3" >/dev/null 2>&1 ;;
    claude)
      local cp="$2

Output ONLY one JSON object (no prose, no code fence) with keys: goal (string),
context (string), priority (integer 1-4), acceptance_criteria (array of objects
each with text (string), verifiable (boolean), command (string or null))."
      claude -p "$cp" --model sonnet </dev/null 2>>"$ERRLOG" \
        | extract_json >"$3" && jq -e . "$3" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

draft_spec(){ # $1=prompt $2=outfile -> prints engine name, 0 ok
  if run_engine "$CFG_ENGINE" "$1" "$2"; then echo "$CFG_ENGINE"; return 0; fi
  if [ -n "$CFG_FALLBACK" ] && [ "$CFG_FALLBACK" != "$CFG_ENGINE" ] \
     && run_engine "$CFG_FALLBACK" "$1" "$2"; then echo "$CFG_FALLBACK"; return 0; fi
  return 1
}

flag_human(){ # $1=issueId $2=labelIds(json) $3=reason
  local ids; ids=$(echo "$2" | jq -c '. + ["'"$L_NEEDHUMAN"'"] | unique')
  gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
    "$(jq -n --arg id "$1" --argjson l "$ids" '{id:$id,i:{labelIds:$l}}')" >/dev/null || true
  gql 'mutation($i:CommentCreateInput!){commentCreate(input:$i){success}}' \
    "$(jq -n --arg id "$1" --arg b "🤖 groomer: $3" '{i:{issueId:$id,body:$b}}')" >/dev/null || true
}

# --- main loop -------------------------------------------------------------
SPECCED=0; FLAGGED=0; SKIPPED=0; i=0
while [ "$i" -lt "$CONSIDERED" ] && [ "$SPECCED" -lt "$NEED" ]; do
  C=$(echo "$CANDS" | jq -c ".[$i]"); i=$((i+1))
  ID=$(echo "$C" | jq -r .id); IDENT=$(echo "$C" | jq -r .identifier)
  TITLE=$(echo "$C" | jq -r .title); DESC=$(echo "$C" | jq -r '.description // ""')
  CUR_LABELS=$(echo "$C" | jq -c '[.labels.nodes[].id]')

  # deny-list: whole-word/phrase match (\bterm\b), case-insensitive, over
  # title+description. Word boundaries matter — a bare substring "age" would
  # wrongly hit "appendage"/"storage", which are everywhere in this project.
  HAY=$(printf '%s\n%s' "$TITLE" "$DESC")
  DENY_PATTERN=$(echo "$DENY" | jq -r 'if length>0 then "\\b(" + join("|") + ")\\b" else "$^" end')
  DENIED=$(printf '%s' "$HAY" | grep -oiE "$DENY_PATTERN" | head -1 || true)
  if [ -n "$DENIED" ]; then
    flag_human "$ID" "$CUR_LABELS" "hits spec deny-list (\"$DENIED\") — needs a human to spec."
    alog groom.jsonl "$(jq -n --arg t "$TODAY" --arg id "$IDENT" --arg r "deny:$DENIED" '{ts:$t,issue:$id,action:"flagged",reason:$r}')"
    FLAGGED=$((FLAGGED+1)); continue
  fi

  # draft
  OUT=$(mktemp)
  if ! ENG=$(draft_spec "$(build_prompt "$TITLE" "$DESC")" "$OUT"); then
    flag_human "$ID" "$CUR_LABELS" "spec engines failed to draft ($(tail -1 "$ERRLOG" 2>/dev/null | cut -c1-160)). Needs a human."
    alog groom.jsonl "$(jq -n --arg t "$TODAY" --arg id "$IDENT" '{ts:$t,issue:$id,action:"flagged",reason:"engine-failed"}')"
    FLAGGED=$((FLAGGED+1)); rm -f "$OUT"; continue
  fi

  NAC=$(jq '.acceptance_criteria|length' "$OUT")
  NVER=$(jq '[.acceptance_criteria[]|select(.verifiable)]|length' "$OUT")
  if [ "$NVER" -lt 2 ] || [ "$NAC" -lt 2 ] || [ "$NAC" -gt 4 ]; then
    flag_human "$ID" "$CUR_LABELS" "could not produce 2-4 ACs with ≥2 verifiable (got $NAC ACs, $NVER verifiable). Needs a human."
    alog groom.jsonl "$(jq -n --arg t "$TODAY" --arg id "$IDENT" --argjson ac "$NAC" --argjson v "$NVER" '{ts:$t,issue:$id,action:"flagged",reason:"weak-acs",acs:$ac,verifiable:$v}')"
    FLAGGED=$((FLAGGED+1)); rm -f "$OUT"; continue
  fi

  # build spec markdown, new description, new labels (drop needs-spec)
  SPEC_MD=$( { printf '\n\n---\n## Spec — auto-groomed (%s, engine: %s)\n\n' "$TODAY" "$ENG"
    printf '**Goal:** %s\n\n' "$(jq -r .goal "$OUT")"
    printf '**Context:** %s\n\n' "$(jq -r .context "$OUT")"
    printf '**Acceptance criteria:**\n'
    jq -r '.acceptance_criteria[] | "- [ ] " + .text + (if .command then "  — verify: `" + .command + "`" else "" end)' "$OUT"
  } )
  NEWDESC="${DESC}${SPEC_MD}"
  PRIO=$(jq -r '.priority' "$OUT"); case "$PRIO" in 1|2|3|4) ;; *) PRIO=3;; esac
  NEWLABELS=$(echo "$CUR_LABELS" | jq -c --arg ns "$L_NEEDSPEC" 'map(select(. != $ns))')

  if gql 'mutation($id:String!,$i:IssueUpdateInput!){issueUpdate(id:$id,input:$i){success}}' \
       "$(jq -n --arg id "$ID" --arg d "$NEWDESC" --argjson p "$PRIO" \
              --arg s "$SPECD_STATE" --argjson l "$NEWLABELS" \
              '{id:$id,i:{description:$d,priority:$p,stateId:$s,labelIds:$l}}')" >/dev/null; then
    alog groom.jsonl "$(jq -n --arg t "$TODAY" --arg id "$IDENT" --arg e "$ENG" --argjson ac "$NAC" --argjson v "$NVER" --argjson p "$PRIO" '{ts:$t,issue:$id,action:"specced",engine:$e,acs:$ac,verifiable:$v,priority:$p}')"
    SPECCED=$((SPECCED+1))
  else
    alog groom.jsonl "$(jq -n --arg t "$TODAY" --arg id "$IDENT" '{ts:$t,issue:$id,action:"error",reason:"issueUpdate-failed"}')"
    SKIPPED=$((SKIPPED+1))
  fi
  rm -f "$OUT"
done

jq -n --argjson s "$SPECCED" --argjson f "$FLAGGED" --argjson k "$SKIPPED" \
      --argjson c "$CONSIDERED" --argjson need "$NEED" --arg eng "$CFG_ENGINE" \
  '{specced:$s, flagged:$f, skipped:$k, considered:$c, target_fill:$need, engine:$eng}'
