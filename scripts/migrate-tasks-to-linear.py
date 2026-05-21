#!/usr/bin/env python3
# scripts/migrate-tasks-to-linear.py
#
# One-shot migration: read tasks-migration.yaml, look up project/label/state
# IDs from state/linear.json (written by apply-linear-config.py), and create
# Linear issues via issueCreate. Idempotent by title: tickets whose title
# already exists in the team's open issues are skipped.
#
# Prerequisite: apply-linear-config.py has been run so the sidecar exists.

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "tasks-migration.yaml"
SIDECAR = ROOT / "state" / "linear.json"
ENV_PATH = ROOT / "config.env"
LINEAR_GRAPHQL = "https://api.linear.app/graphql"

BODY_TEMPLATE = """**Source:** {source}

{body}

---
_Migrated 2026-05-21 from WORKLIST + ROADMAP. Body is the verbatim source line;
please add goal, context, and acceptance criteria before moving to Spec'd._"""

DEFAULT_STATE = "Backlog"  # all migrated tickets start here


def load_token() -> str:
    t = os.environ.get("LINEAR_API_TOKEN", "").strip()
    if t:
        return t
    if ENV_PATH.is_file():
        for line in ENV_PATH.read_text().splitlines():
            if line.startswith("LINEAR_API_TOKEN="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def gql(token: str, query: str, variables: dict | None = None) -> dict:
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
        sys.exit(f"FATAL: Linear API HTTP {e.code}: "
                 f"{e.read().decode('utf-8', errors='replace')}")
    except urllib.error.URLError as e:
        sys.exit(f"FATAL: Linear API unreachable: {e}")
    if body.get("errors"):
        sys.exit(f"FATAL: Linear API errors: {json.dumps(body['errors'])}")
    return body["data"]


def fetch_existing_titles(token: str, team_id: str) -> set[str]:
    """Return titles of all non-archived issues in the team — used for idempotency."""
    titles: set[str] = set()
    cursor = None
    while True:
        q = """
          query TeamIssues($id: String!, $after: String) {
            team(id: $id) {
              issues(first: 100, after: $after) {
                nodes { title archivedAt }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
        """
        data = gql(token, q, {"id": team_id, "after": cursor})
        conn = data["team"]["issues"]
        for n in conn["nodes"]:
            if n.get("archivedAt") is None:
                titles.add(n["title"])
        if not conn["pageInfo"]["hasNextPage"]:
            break
        cursor = conn["pageInfo"]["endCursor"]
    return titles


def create_issue(token: str, *, team_id: str, title: str, description: str,
                 state_id: str, label_ids: list[str], project_id: str) -> str:
    data = gql(token, """
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) { issue { id identifier } success }
      }
    """, {"input": {
        "teamId": team_id,
        "title": title,
        "description": description,
        "stateId": state_id,
        "labelIds": label_ids,
        "projectId": project_id,
    }})
    return data["issueCreate"]["issue"]["identifier"]


def main() -> int:
    token = load_token()
    if not token:
        sys.exit("FATAL: LINEAR_API_TOKEN unset (env + config.env).")

    if not SIDECAR.is_file():
        sys.exit(f"FATAL: {SIDECAR} not found. Run apply-linear-config.py first.")
    sidecar = json.loads(SIDECAR.read_text())
    team_id = sidecar.get("team_id")
    states = sidecar.get("states", {})
    labels = sidecar.get("labels", {})
    projects = sidecar.get("projects", {})

    if not (team_id and states and labels and projects):
        sys.exit("FATAL: sidecar missing team_id/states/labels/projects. "
                 "Run apply-linear-config.py first.")

    if DEFAULT_STATE not in states:
        sys.exit(f"FATAL: default state {DEFAULT_STATE!r} missing from sidecar.")
    default_state_id = states[DEFAULT_STATE]

    manifest = yaml.safe_load(MANIFEST.read_text())
    tickets = manifest.get("tickets", [])
    if not tickets:
        sys.exit("FATAL: manifest has no tickets.")

    print(f"loading existing titles from team {team_id} ...")
    existing_titles = fetch_existing_titles(token, team_id)
    print(f"  {len(existing_titles)} existing non-archived issues")

    print(f"\nmigrating {len(tickets)} tickets:")
    created = skipped = errors = 0

    for t in tickets:
        title = t["title"]
        if title in existing_titles:
            print(f"  skipped  '{title}' (already exists)")
            skipped += 1
            continue

        # Resolve IDs.
        try:
            project_id = projects[t["project"]]
        except KeyError:
            print(f"  ERROR    '{title}' — unknown project {t['project']!r}")
            errors += 1
            continue

        label_ids = []
        unknown = []
        for lab in t.get("labels", []):
            lid = labels.get(lab)
            if lid:
                label_ids.append(lid)
            else:
                unknown.append(lab)
        if unknown:
            print(f"  ERROR    '{title}' — unknown labels: {unknown}")
            errors += 1
            continue

        description = BODY_TEMPLATE.format(source=t["source"], body=t["body"].rstrip())

        try:
            identifier = create_issue(
                token,
                team_id=team_id,
                title=title,
                description=description,
                state_id=default_state_id,
                label_ids=label_ids,
                project_id=project_id,
            )
            print(f"  created  {identifier}  '{title}'")
            created += 1
        except SystemExit as e:
            print(f"  ERROR    '{title}' — {e}")
            errors += 1

    print(f"\nsummary: created={created} skipped={skipped} errors={errors}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
