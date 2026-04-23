# scripts/tasks/ — Reusable JSON task scripts

Scripts in this directory are the **bottom of the token efficiency pyramid** (ROADMAP Phase 2). They do deterministic data work so that AI doesn't have to. Both humans, cron jobs, the hub, and OpenClaw invoke them identically.

## Contract

Every task script MUST:

1. **Read JSON args from stdin.** Empty stdin means "no args." Do not read from `$1..$N`.
2. **Write JSON result to stdout.** Exactly one top-level JSON object. No trailing prose, no logs mixed in.
3. **Write logs and errors to stderr.** Never to stdout.
4. **Exit 0 on success, non-zero on failure.** On failure, stdout MAY be empty; stderr SHOULD explain.
5. **Be idempotent.** Running a task twice with the same input must produce the same output (up to timestamps).
6. **Be side-effect-scoped.** If a task writes files, it writes only under `/opt/nest/data/` or a path passed in its JSON args. Never under `hub/src/`, `agent/`, or git-tracked config.

## Metadata header

Every script starts with the Nest script header (see `scripts/setup/bootstrap.sh` for reference):

```bash
#!/usr/bin/env bash
# @name        aggregate-telemetry
# @description Reads requests.jsonl, writes telemetry-summary.json
# @target      local
# @args        json
set -Eeuo pipefail
```

## Invocation patterns

```bash
# No args
echo '{}' | scripts/tasks/aggregate-telemetry.sh

# With args
echo '{"windowMinutes": 60}' | scripts/tasks/aggregate-telemetry.sh

# From Node (hub)
const { execSync } = require('child_process');
const out = execSync('scripts/tasks/aggregate-telemetry.sh', { input: '{}' });
const result = JSON.parse(out);
```

## Parsing JSON in bash

Use `jq` for both read and write. It's already on every Nest server.

```bash
ARGS=$(cat)                                    # read stdin
WINDOW=$(echo "$ARGS" | jq -r '.windowMinutes // 60')

# Build output
jq -n --arg ts "$(date -Iseconds)" --argjson n "$COUNT" \
  '{generatedAt: $ts, requestCount: $n}'
```

## What does NOT belong here

- One-off server setup (goes in `scripts/setup/`)
- Developer workflow helpers (goes in `scripts/dev/`)
- Anything that requires an interactive TTY
- Anything that needs credentials outside `config.env`

## Current tasks

| Task | Input | Output | Used by |
|------|-------|--------|---------|
| `aggregate-telemetry.sh` | `{windowMinutes?: number}` | telemetry summary JSON | `GET /api/observability/tokens`, cron (5 min) |
