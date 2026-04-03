# SERVER_SETUP_JOURNEY.md — Operator Runbook

> Operational journal. Documents the manual server bootstrap process, gaps, and automation priorities. Historical reference.

This document tracks the operator journey for bringing Nest onto a fresh server based on the repository state on April 1, 2026.

It reflects what is automated today and what still has to be done manually.

## Setup goals

The intended direction is:

1. Minimize human serialization time. A person should only do the steps that cannot be delegated or precomputed.
2. Reduce Claude and Codex token friction. Authentication is the next biggest blocker after human time.
3. Avoid depending on one long-lived conversation context. Durable memory should live in files that the active agent can reload.

Practical implication:

- The best setup flow is not "one human follows a long checklist".
- The best setup flow is "bootstrap everything deterministic, stop only for unavoidable auth, then resume automatically from files".

## 1. Before creating the server

On your local machine:

1. Clone this repo.
2. Copy [`config.env.example`](/opt/nest/config.env.example) to `config.env`.
3. Decide how each auth path will work:
   - `CLAUDE_AUTH_MODE=apikey` and set `ANTHROPIC_API_KEY`, or `CLAUDE_AUTH_MODE=oauth` and plan to run `claude login` on the server.
   - `CODEX_AUTH_MODE=apikey` and set `OPENAI_API_KEY`, or `CODEX_AUTH_MODE=oauth` and plan to run `codex login` on the server.
   - `REPO_AUTH_MODE=deploykey` or `REPO_AUTH_MODE=token`.
4. Set `SSH_KEY_PATH`, `NEST_REPO`, and `NEST_BRANCH` in `config.env`.
5. Make sure your SSH public key is the one you want baked into the new server.

Notes:

- [`scripts/setup/bootstrap.sh`](/opt/nest/scripts/setup/bootstrap.sh) uploads a local `config.env` if it exists.
- [`scripts/setup/cloud-config.yaml`](/opt/nest/scripts/setup/cloud-config.yaml) currently hardcodes one `ssh_authorized_keys` entry for the `claude` user. Replace that key before using it for another operator or machine.

## 2. Create the fresh server

Current assumptions in the repo:

- Provider: Hetzner
- OS: Ubuntu 24.04
- User data: [`scripts/setup/cloud-config.yaml`](/opt/nest/scripts/setup/cloud-config.yaml)

What that cloud-config does:

- Creates the `claude` user with passwordless sudo.
- Installs the configured SSH public key for `claude`.
- Applies DNS64 nameservers for IPv6-only networking.

After the server comes up, verify you can connect as `claude`.

## 3. Run the bootstrap

From your local checkout:

```bash
./scripts/setup/bootstrap.sh <server-ip-or-hostname>
```

What bootstrap automates today:

- Installs base packages: `build-essential`, `jq`, `unzip`, `fail2ban`, `python3-pip`, `python3-venv`
- Installs Node.js 22
- Installs Docker CE and adds `claude` to the `docker` group
- Installs GitHub CLI
- Installs Claude Code if `claude` is not already installed
- Hardens SSH
- Enables UFW for ports `22`, `80`, `443`
- Enables `fail2ban`
- Creates a 2 GB swap file
- Applies a small sysctl hardening profile
- Clones or updates the repo at `/opt/nest`
- Uploads local `config.env` to `/opt/nest/config.env` if present
- Adds `config.env` sourcing to `~/.bashrc`
- Creates `/etc/systemd/system/claude-code.service`
- Creates `/usr/local/bin/claude-session`
- Runs a small verification pass

## 4. Manual steps after bootstrap

These are still required in the current repo state.

### 4.1 Log into the server

```bash
ssh claude@<server>
cd /opt/nest
```

### 4.2 Complete interactive auth if using OAuth

If `CLAUDE_AUTH_MODE=oauth`:

```bash
claude login
```

Expected credential path used by the hub:

- `/home/claude/.claude/.credentials.json`

If `CODEX_AUTH_MODE=oauth`:

1. Make sure the Codex CLI is installed on the server.
2. Run:

```bash
codex login
```

Expected credential path used by the hub:

- `/home/claude/.codex/auth.json`

Important:

- The bootstrap installs Claude Code.
- The bootstrap does not install Codex CLI.
- The repo already expects Codex to exist on `PATH` and defaults to the `codex` binary in [`hub/src/routes/chat.ts`](/opt/nest/hub/src/routes/chat.ts).

### 4.3 Install project runtime dependencies

The bootstrap does not currently install the hub or agent dependencies.

Hub:

```bash
cd /opt/nest/hub
npm ci
npm run build
```

Client HTML pages are served directly from `/opt/nest/hub/static`.
There is no separate app build step.

Agent Python dependencies, using the current system Python service model:

```bash
python3 -m pip install -r /opt/nest/agent/requirements.txt
```

### 4.4 Start the hub

The repo has a Hub entrypoint in [`hub/src/index.ts`](/opt/nest/hub/src/index.ts), but no checked-in `nest-hub.service` unit yet.

Current manual start option:

```bash
cd /opt/nest/hub
npm start
```

The hub listens on:

- `HOST`, default `0.0.0.0`
- `PORT`, default `3000`

Important config used by the hub:

- `HETZNER_API_TOKEN`
- `NEST_ADMIN_PASSWORD`
- `NEST_JWT_SECRET` recommended for stable auth across restarts

### 4.5 Install and enable the agent service

The agent service file exists in the repo, but the bootstrap does not install it.

```bash
sudo cp /opt/nest/agent/nest-agent.service /etc/systemd/system/nest-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now nest-agent
```

The current service expects:

- Hub available at `ws://localhost:3000/ws/agent`
- Python deps from [`agent/requirements.txt`](/opt/nest/agent/requirements.txt) already installed

### 4.6 Decide how the hub gets first-run secrets

There are two possible paths:

1. Put `HETZNER_API_TOKEN` and `NEST_ADMIN_PASSWORD` directly into `/opt/nest/config.env` before starting the hub.
2. Start the hub first, then use the public `/api/setup/complete` onboarding route implemented in [`hub/src/routes/setup.ts`](/opt/nest/hub/src/routes/setup.ts), which writes those values into `config.env` and marks setup complete in `/opt/nest/setup.json`.

## 5. Validation checklist

On the server, verify:

```bash
command -v claude
command -v codex
test -f /home/claude/.claude/.credentials.json
test -f /home/claude/.codex/auth.json
docker --version
node --version
python3 --version
sudo systemctl status claude-code.service
sudo systemctl status nest-agent
curl http://127.0.0.1:3000/api/health
```

From the Nest UI, verify:

- `/api/setup/status` no longer reports `needsSetup: true`
- Claude token status loads
- Codex token status loads
- Agent appears connected
- Hetzner server list loads

## 6. Current gaps in automation

These are not handled end-to-end by the repo today:

- Replacing the SSH key in [`scripts/setup/cloud-config.yaml`](/opt/nest/scripts/setup/cloud-config.yaml)
- Installing Codex CLI on the server
- Running `claude login`
- Running `codex login`
- Installing hub npm dependencies
- Building the hub
- Installing app npm dependencies
- Building the web app
- Installing agent Python dependencies
- Installing or defining a `nest-hub` systemd unit
- Installing `nest-agent.service`

## 7. Automation priorities

If the goal is to reduce total setup time, the priorities should be:

1. Move every deterministic server action into bootstrap or first-boot automation.
2. Isolate unavoidable human auth into the fewest possible pauses.
3. Persist setup state and operator intent in files so a new agent session can resume without rereading a long chat.

Concrete implications for this repo:

- `bootstrap.sh` should install Codex CLI, hub dependencies, app dependencies, and agent dependencies.
- `bootstrap.sh` should build the hub and optional web app.
- The repo should include a `nest-hub.service` and install both hub and agent units automatically.
- Bootstrap should write a machine-readable progress file so reruns can skip completed phases.
- OAuth-required phases should be explicit pause points: "run `claude login`", "run `codex login`", then continue.
- Server state, setup progress, and operator notes should be written to files under `/opt/nest`, not kept only in chat history.

## 8. Memory-file approach

To reduce dependence on a single conversation window, keep durable state in files such as:

- `SERVER_SETUP_JOURNEY.md`: operator runbook
- `setup.json`: coarse setup completion state
- `users.json`: local auth/user state
- a future `STATE.md` or `memory/` directory for:
  - current server inventory
  - auth status per provider
  - last completed setup phase
  - known manual blockers
  - follow-up tasks

The working rule should be:

- If an agent would need to remember it across sessions, it belongs in a file.

## 9. Minimum operator journey

In short, the current operator path is:

1. Prepare local `config.env`.
2. Update cloud-init SSH key.
3. Create fresh Ubuntu 24.04 server with the provided cloud-config.
4. Run `./scripts/setup/bootstrap.sh <server>`.
5. SSH in as `claude`.
6. Run `claude login`.
7. Install Codex CLI if needed.
8. Run `codex login`.
9. Install hub, app, and agent dependencies.
10. Build the hub and web app.
11. Start the hub.
12. Install and start `nest-agent`.
13. Complete onboarding values if they were not already in `config.env`.
