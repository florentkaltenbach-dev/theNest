---
name: container-manager
description: Use when the user asks to inspect or manage Nest appendage containers, list appendage container state, fetch appendage logs or inspect output, or restart a known brownfield appendage container through the Nest hub appendage API.
---

# container-manager

Inspect and manage Nest appendage containers through the hub appendage API.
Default to read-only status, logs, and inspect actions. Restart is allowed only
for whitelisted brownfield appendage containers and only after the user
explicitly confirms the exact appendage and container.

## When to use

Use this skill when the user asks about:

- Which appendage containers are running
- Container state for known Nest appendages
- Logs for a mailcow or stoneshop appendage container
- Docker inspect data for a known appendage container
- Restarting a known brownfield appendage container

Do **not** use this for:

- General server health or resource pressure (that's `server-overview`)
- Token/quota reports (that's `token-report`)
- Running arbitrary maintenance scripts (that's `script-runner`)
- Arbitrary Docker, SSH, compose, or systemctl commands

## Safety model

The hub already has appendage contracts and live discovery data. Use those as
the authority. Do not run `docker` or `ssh` directly from the skill.

Rules:

- Start with `GET /api/appendages` and/or `GET /api/appendages/hosts`.
- Treat `matched[]` on discovery appendages as the container whitelist.
- Use exact appendage names and exact container names only.
- Never target raw container IDs, substrings, regexes, or user-invented names.
- If an appendage matches multiple containers, ask which exact container before
  logs, inspect, or restart.
- `install` and `uninstall` are provisioning/removal actions, not routine
  container management. Do not call them unless the user explicitly asks for
  install/uninstall and the surrounding task has already established that this
  is safe.
- Do not restart from a warning or failed health check by yourself.
- Before restart, confirm in plain language: appendage name, container name, and
  host. Wait for the user to approve that exact action.

## How to execute

Call the Nest hub. Auth is required.

```sh
set -a
. /home/claude/.openclaw/.env
set +a
curl -sS -H "Authorization: Bearer ${NEST_HUB_TOKEN:?}" \
  http://127.0.0.1:3000/api/appendages
```

Never echo, print, summarize, or paste the token itself.

Useful endpoints:

```sh
# Appendage inventory and contract-derived status.
curl -sS -H "Authorization: Bearer ${NEST_HUB_TOKEN:?}" \
  http://127.0.0.1:3000/api/appendages

# Host inventory, including agent and SSH-discovered containers.
curl -sS -H "Authorization: Bearer ${NEST_HUB_TOKEN:?}" \
  http://127.0.0.1:3000/api/appendages/hosts

# Logs for one whitelisted brownfield appendage container.
curl -sS -H "Authorization: Bearer ${NEST_HUB_TOKEN:?}" \
  "http://127.0.0.1:3000/api/appendages/<appendage>/logs?container=<container>&lines=200"

# Inspect one whitelisted brownfield appendage container.
curl -sS -H "Authorization: Bearer ${NEST_HUB_TOKEN:?}" \
  "http://127.0.0.1:3000/api/appendages/<appendage>/inspect?container=<container>"
```

Restart is a write action and requires explicit user confirmation first:

```sh
curl -sS -X POST \
  -H "Authorization: Bearer ${NEST_HUB_TOKEN:?}" \
  -H "Content-Type: application/json" \
  -d '{"container":"<exact-container-name>"}' \
  http://127.0.0.1:3000/api/appendages/<appendage>/restart
```

## Response shape

For status questions, answer with:

- A one-sentence headline: all appendages running, partial/offline appendage, or
  specific issue found.
- Short bullets for each relevant appendage: name, host, status, matched
  containers.
- Safe next actions: logs, inspect, or confirmed restart.

For logs, summarize the most relevant lines and mention the container and line
count. Do not paste huge log blocks unless the user asks.

For inspect, summarize only useful fields such as image, state, restart policy,
ports, mounts, and created time. Do not dump the full inspect JSON unless asked.

## Fallback

- If `NEST_HUB_TOKEN` is unavailable after sourcing
  `/home/claude/.openclaw/.env`: reply "I can't reach the Nest hub —
  `NEST_HUB_TOKEN` isn't available in `/home/claude/.openclaw/.env`. Mint one at
  /tokens and add it there."
- If the hub returns 401: the token is invalid or expired; ask the user to mint
  a new one.
- If an appendage endpoint returns "container query param required", list the
  exact options from the error and ask the user which one to target.
- If the host is offline or unreachable, say so and do not attempt a direct SSH
  workaround.
