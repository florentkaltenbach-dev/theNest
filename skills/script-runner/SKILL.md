---
name: script-runner
description: Use when the user asks to run, refresh, or inspect deterministic Nest task scripts from /opt/nest/scripts/tasks. Runs only allowlisted top-level task scripts with JSON stdin/stdout and summarizes the JSON result.
---

# script-runner

Run deterministic Nest task scripts from `/opt/nest/scripts/tasks/` and
interpret their JSON results. This skill is for the reusable JSON task scripts
described in `scripts/tasks/README.md`; it is not general shell access.

## When to use

Use this skill when the user asks to:

- Run or refresh a Nest task script
- Aggregate telemetry
- Aggregate token/quota ledger data
- Inspect what reusable task scripts are available
- Recompute a JSON artifact produced by `scripts/tasks/`

Do **not** use this for:

- Arbitrary shell commands
- Setup, bootstrap, deploy, install, uninstall, or system service commands
- Interactive scripts or scripts that require a TTY
- Scripts outside `/opt/nest/scripts/tasks/`
- Helper/source scripts under `/opt/nest/scripts/tasks/sources/`
- Container lifecycle actions (that's `container-manager`)

## Script contract

Every runnable task script must follow the local task contract:

- Read JSON args from stdin. Empty stdin means `{}`.
- Write exactly one top-level JSON object to stdout.
- Write logs/errors to stderr only.
- Exit 0 on success and non-zero on failure.
- Be idempotent for the same input, aside from timestamps.
- Keep side effects scoped to `/opt/nest/data/` or explicit JSON args.

If a script does not meet this contract, do not run it through this skill.

## Allowed scripts

Discover scripts with:

```sh
find /opt/nest/scripts/tasks -maxdepth 1 -type f -name '*.sh' -perm -111 -print | sort
```

Allowed today:

- `/opt/nest/scripts/tasks/aggregate-telemetry.sh` writes
  `/opt/nest/data/telemetry-summary.json`.
- `/opt/nest/scripts/tasks/aggregate-tokens.sh` writes
  `/opt/nest/data/token-ledger.json`.

Anything under `/opt/nest/scripts/tasks/sources/` is a source helper for
`aggregate-tokens.sh`, not a user-facing task. Do not run source helpers
directly.

## How to execute

Default args to `{}` unless the user gives specific JSON. Validate that args are
valid JSON before invoking a task.

```sh
cd /opt/nest
printf '%s\n' '{}' | scripts/tasks/aggregate-tokens.sh > /tmp/task-out.json
jq -e 'type == "object"' /tmp/task-out.json >/dev/null
cat /tmp/task-out.json
```

For custom args:

```sh
cd /opt/nest
printf '%s\n' '{"windowMinutes":60}' | scripts/tasks/aggregate-telemetry.sh > /tmp/task-out.json
jq -e 'type == "object"' /tmp/task-out.json >/dev/null
cat /tmp/task-out.json
```

Keep stderr separate from stdout. If stderr has useful warnings, summarize them
after confirming stdout is valid JSON.

## Response shape

Keep replies short:

- Name the task script that ran.
- Say whether it succeeded.
- Summarize the important JSON fields.
- Mention the output file when the script is one of the known writers above.
- Mention stderr warnings only if they change what the user should know.

Do not paste full JSON unless the user asks for raw output.

## Refusals

Refuse requests that would require:

- Shell pipelines beyond invoking one allowed task and validating JSON with `jq`
- Path traversal, absolute paths outside the allowlist, or script names with `/`
- Running source helpers directly
- Running non-executable, untracked, or newly generated scripts
- Mutating git-tracked source files
- Network calls not already embedded inside the allowed task script

Suggested refusal:

"I can run the allowlisted Nest task scripts in `scripts/tasks/`, but I won't
run arbitrary shell through `script-runner`. Put it behind a reviewed task script
first."

## Fallback

- If `/opt/nest/scripts/tasks/README.md` is missing, inspect the script headers
  before running anything and proceed only if the JSON stdin/stdout contract is
  clear.
- If a task exits non-zero, report the exit and summarize stderr. Do not invent
  a JSON result.
- If stdout is not valid JSON object output, treat the task as failed even when
  exit code is 0.
