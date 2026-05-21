#!/usr/bin/env python3
# scripts/apply-linear-config.py
#
# Idempotent applier for /opt/nest/config/linear.yaml against the Linear
# workspace named by team_key. Creates/updates workflow states and labels.
# Records IDs in /opt/nest/state/linear.json (gitignored) so subsequent runs
# are O(1) lookups instead of name-search.
#
# Default mode is additive-only (never deletes). Pass --prune to archive
# leftover Linear-side entities not present in YAML. --prune refuses to
# archive a state that has any issues attached. --dry-run + --yes available.

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "linear.yaml"
STATE_PATH = ROOT / "state" / "linear.json"
ENV_PATH = ROOT / "config.env"
LINEAR_GRAPHQL = "https://api.linear.app/graphql"

VALID_STATE_TYPES = {"backlog", "unstarted", "started", "completed", "canceled"}
VALID_PROJECT_STATES = {"backlog", "planned", "started", "paused",
                        "completed", "canceled"}


# ── env + io ────────────────────────────────────────────────────────────

def load_env_token() -> str:
    """Read LINEAR_API_TOKEN from process env, falling back to config.env."""
    token = os.environ.get("LINEAR_API_TOKEN", "").strip()
    if token:
        return token
    if ENV_PATH.is_file():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line.startswith("LINEAR_API_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def load_yaml(path: Path) -> dict:
    with path.open() as f:
        return yaml.safe_load(f)


def load_state(path: Path) -> dict:
    if not path.is_file():
        return {"team_id": None, "states": {}, "labels": {}}
    return json.loads(path.read_text())


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2) + "\n")


# ── linear graphql ──────────────────────────────────────────────────────

class LinearError(Exception):
    """Raised when Linear API returns an error response."""


def gql(token: str, query: str, variables: dict | None = None,
        raise_on_error: bool = False) -> dict:
    """POST a GraphQL operation. By default, fatal-exits on any error.
    Pass raise_on_error=True to bubble a LinearError instead (for per-entity
    loops that should log-and-continue)."""
    payload = json.dumps({"query": query, "variables": variables or {}}).encode()
    req = urllib.request.Request(
        LINEAR_GRAPHQL,
        data=payload,
        headers={"Authorization": token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")
        if raise_on_error:
            raise LinearError(f"HTTP {e.code}: {msg}")
        sys.exit(f"FATAL: Linear API HTTP {e.code}: {msg}")
    except urllib.error.URLError as e:
        if raise_on_error:
            raise LinearError(f"unreachable: {e}")
        sys.exit(f"FATAL: Linear API unreachable: {e}")
    if body.get("errors"):
        first_msg = body["errors"][0].get("message", "")
        if raise_on_error:
            raise LinearError(first_msg or json.dumps(body["errors"]))
        sys.exit(f"FATAL: Linear API errors: {json.dumps(body['errors'])}")
    return body["data"]


def resolve_team(token: str, team_key: str) -> tuple[str, list[dict], list[dict], list[dict]]:
    """Return (team_id, states, labels, projects) for the given team key.
    Uses 4 small queries instead of 1 big one — Linear's complexity ceiling
    is 10k and the combined query lands ~11k."""
    data = gql(token, """
      query TeamLookup($key: String!) {
        teams(filter: { key: { eq: $key } }) {
          nodes { id key name }
        }
      }
    """, {"key": team_key})
    nodes = data["teams"]["nodes"]
    if not nodes:
        sys.exit(f"FATAL: team_key '{team_key}' did not match any team. "
                 f"Check Linear → Settings → Teams.")
    team_id = nodes[0]["id"]

    states = gql(token, """
      query TeamStates($id: String!) {
        team(id: $id) {
          states { nodes { id name type color description position } }
        }
      }
    """, {"id": team_id})["team"]["states"]["nodes"]

    labels = gql(token, """
      query TeamLabels($id: String!) {
        team(id: $id) {
          labels { nodes { id name color description } }
        }
      }
    """, {"id": team_id})["team"]["labels"]["nodes"]

    projects = gql(token, """
      query TeamProjects($id: String!) {
        team(id: $id) {
          projects { nodes { id name state description } }
        }
      }
    """, {"id": team_id})["team"]["projects"]["nodes"]

    return team_id, states, labels, projects


def create_state(token: str, team_id: str, s: dict) -> str:
    data = gql(token, """
      mutation StateCreate($input: WorkflowStateCreateInput!) {
        workflowStateCreate(input: $input) { workflowState { id } success }
      }
    """, {"input": {
        "teamId": team_id,
        "name": s["name"],
        "type": s["type"],
        "color": s["color"],
        "description": s.get("description") or "",
        "position": s["position"],
    }})
    return data["workflowStateCreate"]["workflowState"]["id"]


def update_state(token: str, state_id: str, patch: dict) -> None:
    gql(token, """
      mutation StateUpdate($id: String!, $input: WorkflowStateUpdateInput!) {
        workflowStateUpdate(id: $id, input: $input) { success }
      }
    """, {"id": state_id, "input": patch})


def create_label(token: str, team_id: str, lab: dict) -> str:
    data = gql(token, """
      mutation LabelCreate($input: IssueLabelCreateInput!) {
        issueLabelCreate(input: $input) { issueLabel { id } success }
      }
    """, {"input": {
        "teamId": team_id,
        "name": lab["name"],
        "color": lab["color"],
        "description": lab.get("description") or "",
    }})
    return data["issueLabelCreate"]["issueLabel"]["id"]


def update_label(token: str, label_id: str, patch: dict) -> None:
    gql(token, """
      mutation LabelUpdate($id: String!, $input: IssueLabelUpdateInput!) {
        issueLabelUpdate(id: $id, input: $input) { success }
      }
    """, {"id": label_id, "input": patch})


def create_project(token: str, team_id: str, p: dict) -> str:
    data = gql(token, """
      mutation ProjectCreate($input: ProjectCreateInput!) {
        projectCreate(input: $input) { project { id } success }
      }
    """, {"input": {
        "name": p["name"],
        "teamIds": [team_id],
        "state": p["state"],
        "description": p.get("description") or "",
    }})
    return data["projectCreate"]["project"]["id"]


def update_project(token: str, project_id: str, patch: dict) -> None:
    gql(token, """
      mutation ProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
        projectUpdate(id: $id, input: $input) { success }
      }
    """, {"id": project_id, "input": patch})


def archive_project(token: str, project_id: str) -> None:
    """Raises LinearError on failure so prune can log-and-continue."""
    gql(token, """
      mutation ProjectArchive($id: String!) {
        projectArchive(id: $id) { success }
      }
    """, {"id": project_id}, raise_on_error=True)


def state_has_issues(token: str, state_id: str) -> bool:
    """True if at least one issue is currently in this workflow state."""
    data = gql(token, """
      query StateIssues($id: String!) {
        workflowState(id: $id) {
          issues(first: 1) { nodes { id } }
        }
      }
    """, {"id": state_id})
    return bool(data["workflowState"]["issues"]["nodes"])


def archive_state(token: str, state_id: str) -> None:
    """Raises LinearError on failure so prune can log-and-continue."""
    gql(token, """
      mutation StateArchive($id: String!) {
        workflowStateArchive(id: $id) { success }
      }
    """, {"id": state_id}, raise_on_error=True)


def delete_label(token: str, label_id: str) -> None:
    """Raises LinearError on failure so prune can log-and-continue."""
    gql(token, """
      mutation LabelDelete($id: String!) {
        issueLabelDelete(id: $id) { success }
      }
    """, {"id": label_id}, raise_on_error=True)


# ── reconcile ───────────────────────────────────────────────────────────

def reconcile_states(token, team_id, cfg_states, existing, state_sidecar):
    """Returns (counts, updated_sidecar, leftover_existing_names)."""
    counts = {"created": 0, "updated": 0, "unchanged": 0}
    by_name = {s["name"]: s for s in existing}
    # Track which existing names we matched, to log warnings for stragglers.
    matched_names = set()

    for idx, want in enumerate(cfg_states):
        if want["type"] not in VALID_STATE_TYPES:
            sys.exit(f"FATAL: state '{want['name']}' has invalid type "
                     f"'{want['type']}'. Allowed: {sorted(VALID_STATE_TYPES)}")
        want_with_pos = {**want, "position": float(idx)}

        # Resolve existing state: prefer sidecar ID, fall back to name match.
        sid = state_sidecar.get(want["name"])
        cur = None
        if sid:
            cur = next((s for s in existing if s["id"] == sid), None)
        if cur is None:
            cur = by_name.get(want["name"])

        if cur is None:
            new_id = create_state(token, team_id, want_with_pos)
            state_sidecar[want["name"]] = new_id
            counts["created"] += 1
            print(f"  created  state  {want['name']}")
            continue

        matched_names.add(cur["name"])
        state_sidecar[want["name"]] = cur["id"]  # keep sidecar fresh

        # Drift check — only patch fields that differ.
        patch = {}
        if cur.get("type") != want["type"]:
            patch["type"] = want["type"]
        if (cur.get("color") or "").lower() != want["color"].lower():
            patch["color"] = want["color"]
        if (cur.get("description") or "") != (want.get("description") or ""):
            patch["description"] = want.get("description") or ""
        # name is the key; if cur["name"] != want["name"] we'd have created.

        if patch:
            update_state(token, cur["id"], patch)
            counts["updated"] += 1
            print(f"  updated  state  {want['name']} ({', '.join(patch)})")
        else:
            counts["unchanged"] += 1
            print(f"  unchanged state {want['name']}")

    leftovers = [s["name"] for s in existing if s["name"] not in matched_names]
    return counts, state_sidecar, leftovers


def reconcile_projects(token, team_id, cfg_projects, existing, project_sidecar):
    counts = {"created": 0, "updated": 0, "unchanged": 0}
    by_name = {p["name"]: p for p in existing}
    matched_names = set()

    for want in cfg_projects:
        if want["state"] not in VALID_PROJECT_STATES:
            sys.exit(f"FATAL: project '{want['name']}' has invalid state "
                     f"'{want['state']}'. Allowed: {sorted(VALID_PROJECT_STATES)}")

        pid = project_sidecar.get(want["name"])
        cur = None
        if pid:
            cur = next((p for p in existing if p["id"] == pid), None)
        if cur is None:
            cur = by_name.get(want["name"])

        if cur is None:
            new_id = create_project(token, team_id, want)
            project_sidecar[want["name"]] = new_id
            counts["created"] += 1
            print(f"  created  project {want['name']}")
            continue

        matched_names.add(cur["name"])
        project_sidecar[want["name"]] = cur["id"]

        patch = {}
        if cur.get("state") != want["state"]:
            patch["state"] = want["state"]
        if (cur.get("description") or "") != (want.get("description") or ""):
            patch["description"] = want.get("description") or ""

        if patch:
            update_project(token, cur["id"], patch)
            counts["updated"] += 1
            print(f"  updated  project {want['name']} ({', '.join(patch)})")
        else:
            counts["unchanged"] += 1
            print(f"  unchanged project {want['name']}")

    leftovers = [p["name"] for p in existing if p["name"] not in matched_names]
    return counts, project_sidecar, leftovers


def reconcile_labels(token, team_id, cfg_labels, existing, label_sidecar):
    counts = {"created": 0, "updated": 0, "unchanged": 0}
    by_name = {l["name"]: l for l in existing}
    matched_names = set()

    for want in cfg_labels:
        lid = label_sidecar.get(want["name"])
        cur = None
        if lid:
            cur = next((l for l in existing if l["id"] == lid), None)
        if cur is None:
            cur = by_name.get(want["name"])

        if cur is None:
            new_id = create_label(token, team_id, want)
            label_sidecar[want["name"]] = new_id
            counts["created"] += 1
            print(f"  created  label  {want['name']}")
            continue

        matched_names.add(cur["name"])
        label_sidecar[want["name"]] = cur["id"]

        patch = {}
        if (cur.get("color") or "").lower() != want["color"].lower():
            patch["color"] = want["color"]
        if (cur.get("description") or "") != (want.get("description") or ""):
            patch["description"] = want.get("description") or ""

        if patch:
            update_label(token, cur["id"], patch)
            counts["updated"] += 1
            print(f"  updated  label  {want['name']} ({', '.join(patch)})")
        else:
            counts["unchanged"] += 1
            print(f"  unchanged label {want['name']}")

    leftovers = [l["name"] for l in existing if l["name"] not in matched_names]
    return counts, label_sidecar, leftovers


# ── main ────────────────────────────────────────────────────────────────

def prune(token, existing_states, existing_labels, existing_projects,
          state_leftovers, label_leftovers, project_leftovers,
          dry_run: bool, assume_yes: bool) -> int:
    """Archive leftover states/projects and delete leftover labels.
    Returns 0 on success, nonzero on user-abort."""
    name_to_state = {s["name"]: s for s in existing_states}
    name_to_label = {l["name"]: l for l in existing_labels}
    name_to_project = {p["name"]: p for p in existing_projects}

    safe_states, blocked_states, reserved_states = [], [], []
    for n in state_leftovers:
        s = name_to_state[n]
        if s.get("type") not in VALID_STATE_TYPES:
            reserved_states.append((n, s.get("type")))
            continue
        if state_has_issues(token, s["id"]):
            blocked_states.append((n, s["id"]))
        else:
            safe_states.append((n, s["id"]))

    safe_labels = [(n, name_to_label[n]["id"]) for n in label_leftovers]
    safe_projects = [(n, name_to_project[n]["id"]) for n in project_leftovers]

    print("\nprune plan:")
    for n, _ in safe_states:
        print(f"  archive  state   {n}")
    for n, _ in blocked_states:
        print(f"  SKIP     state   {n}  (has issues attached — refuse to archive)")
    for n, t in reserved_states:
        print(f"  SKIP     state   {n}  (Linear-reserved type={t!r}, cannot archive)")
    for n, _ in safe_labels:
        print(f"  delete   label   {n}")
    for n, _ in safe_projects:
        print(f"  archive  project {n}")
    if not safe_states and not safe_labels and not safe_projects:
        print("  (nothing to prune)")
        return 0

    if dry_run:
        print("\n(--dry-run — no changes made)")
        return 0

    if not assume_yes:
        try:
            ans = input("\nType 'yes' to proceed: ").strip()
        except EOFError:
            ans = ""
        if ans != "yes":
            print("Aborted.")
            return 1

    print()
    failures = 0
    for n, sid in safe_states:
        try:
            archive_state(token, sid)
            print(f"  archived state   {n}")
        except LinearError as e:
            failures += 1
            print(f"  FAIL     state   {n}  ({e})")
    for n, lid in safe_labels:
        try:
            delete_label(token, lid)
            print(f"  deleted  label   {n}")
        except LinearError as e:
            failures += 1
            print(f"  FAIL     label   {n}  ({e})")
    for n, pid in safe_projects:
        try:
            archive_project(token, pid)
            print(f"  archived project {n}")
        except LinearError as e:
            failures += 1
            print(f"  FAIL     project {n}  ({e})")
    if failures:
        print(f"\n{failures} prune operation(s) failed — other entities processed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply config/linear.yaml to the Linear workspace.")
    parser.add_argument("--prune", action="store_true",
                        help="Archive leftover states + delete leftover labels "
                             "not present in YAML.")
    parser.add_argument("--dry-run", action="store_true",
                        help="With --prune, show plan without making changes.")
    parser.add_argument("--yes", action="store_true",
                        help="Skip the prune confirmation prompt.")
    args = parser.parse_args()

    token = load_env_token()
    if not token:
        sys.exit("FATAL: LINEAR_API_TOKEN unset (checked env + config.env).")

    cfg = load_yaml(CONFIG_PATH)
    team_key = cfg.get("team_key")
    if not team_key:
        sys.exit("FATAL: linear.yaml missing top-level team_key.")

    sidecar = load_state(STATE_PATH)
    sidecar.setdefault("states", {})
    sidecar.setdefault("labels", {})
    sidecar.setdefault("projects", {})

    print(f"resolving team_key={team_key} ...")
    team_id, existing_states, existing_labels, existing_projects = resolve_team(
        token, team_key)
    sidecar["team_id"] = team_id
    print(f"  team_id={team_id}, "
          f"{len(existing_states)} states, "
          f"{len(existing_labels)} labels, "
          f"{len(existing_projects)} projects existing")

    print("\nworkflow states:")
    s_counts, sidecar["states"], state_leftovers = reconcile_states(
        token, team_id, cfg.get("workflow_states", []),
        existing_states, sidecar["states"])

    print("\nlabels:")
    l_counts, sidecar["labels"], label_leftovers = reconcile_labels(
        token, team_id, cfg.get("labels", []),
        existing_labels, sidecar["labels"])

    print("\nprojects:")
    p_counts, sidecar["projects"], project_leftovers = reconcile_projects(
        token, team_id, cfg.get("projects", []),
        existing_projects, sidecar["projects"])

    save_state(STATE_PATH, sidecar)

    if args.prune:
        rc = prune(token, existing_states, existing_labels, existing_projects,
                   state_leftovers, label_leftovers, project_leftovers,
                   dry_run=args.dry_run, assume_yes=args.yes)
        if rc != 0:
            return rc
    else:
        for n in state_leftovers:
            print(f"WARN  state '{n}' exists in Linear but not in YAML — left alone")
        for n in label_leftovers:
            print(f"WARN  label '{n}' exists in Linear but not in YAML — left alone")
        for n in project_leftovers:
            print(f"WARN  project '{n}' exists in Linear but not in YAML — left alone")

    print("\nsummary:")
    print(f"  states:   created={s_counts['created']} "
          f"updated={s_counts['updated']} unchanged={s_counts['unchanged']} "
          f"skipped={len(state_leftovers)}")
    print(f"  labels:   created={l_counts['created']} "
          f"updated={l_counts['updated']} unchanged={l_counts['unchanged']} "
          f"skipped={len(label_leftovers)}")
    print(f"  projects: created={p_counts['created']} "
          f"updated={p_counts['updated']} unchanged={p_counts['unchanged']} "
          f"skipped={len(project_leftovers)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
