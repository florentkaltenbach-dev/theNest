# NEXT.md — Browser-Based Coding Agent

> **For Claude Code CLI on the server.** Read fully before acting. Execute in order. Each section has verification steps — pass them before moving on. If blocked, log the issue in `BUILD_LOG.md` at the repo root and continue with the next independent section.

---

## Goal

After this build, the operator can:

1. Open a browser on any device → talk to OpenClaw → dispatch a coding task
2. Close the browser. Walk away.
3. Claude Code runs headless on the server, works the task, commits results to git
4. Operator checks results later from GitHub (phone, tablet, anywhere)

No SSH. No open terminal. No laptop required after dispatch.

---

## Context

- **Repo:** `theNest` monorepo at `/opt/nest` (hub/, agent/, app/, scripts/)
- **Server:** Hetzner Ubuntu 24.04, Docker, Caddy, systemd
- **Domain:** nest.kaltenbach.dev (Caddy auto-TLS)
- **Hub:** Fastify on port 3000, behind Caddy reverse proxy
- **Auth:** JWT + API tokens (nest_xxx format). All powerful endpoints require admin role.
- **Spec:** Read `Nest.md` for architecture. Read `ROADMAP.md` for progress. This file implements parts of Phase 2 and Phase 3.
- **Self-deploy:** After code changes: `git add/commit/push` then call `POST /api/nest/enhance {"action":"deploy"}` with API token. The agent handles pull + build + restart.
- **API token:** Available in config.env as `NEST_API_TOKEN`. Use it for all API calls: `curl -H "Authorization: Bearer $NEST_API_TOKEN" https://nest.kaltenbach.dev/api/...`

### Token Efficiency Pyramid

```
        ┌─────────────┐
        │  Claude Code │  OAuth (Max sub) — only for intelligence
        │   (sparse)   │  Called via scripts, not directly
        ├──────────────┤
        │    Claw      │  ChatGPT sub (flat rate) — user-facing chat
        │  (frequent)  │  Dispatches tasks, delegates to scripts
        ├──────────────┤
        │   Scripts    │  Zero tokens — cron, API calls, orchestration
        │  (constant)  │  The workhorses. Both AIs invoke these.
        └──────────────┘
```

**Rule:** If it can be a script, it's a script. AI only gets called for decisions.

---

## Section 0: Preflight Checks

Before building anything, verify the current state:

```bash
# Claude Code installed?
claude --version

# Docker running?
docker ps

# Hub responding?
curl -s localhost:3000/api/health

# API token available?
source /opt/nest/config.env
curl -s -H "Authorization: Bearer $NEST_API_TOKEN" localhost:3000/api/agents

# Current Caddyfile?
cat /etc/caddy/Caddyfile

# Node version (OpenClaw needs 22+)?
node --version

# Git status clean?
cd /opt/nest && git status
```

Log results in `BUILD_LOG.md`. If anything is missing, fix it before proceeding.

If `NEST_API_TOKEN` is not in config.env, create one from the running hub:
```bash
source /opt/nest/config.env
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H "Content-Type: application/json" \
  -d "{\"password\": \"$NEST_ADMIN_PASSWORD\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
API_TOKEN=$(curl -s -X POST localhost:3000/api/auth/tokens -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" -d '{"name":"server-claude"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "NEST_API_TOKEN=$API_TOKEN" >> /opt/nest/config.env
```

---

## Section 1: Install OpenClaw in Docker

**Why:** OpenClaw is not running. We need to install it, authenticate with ChatGPT/Codex OAuth, and expose WebChat.

### 1.1 Install OpenClaw via Docker

```bash
# Create directory for OpenClaw data
sudo mkdir -p /opt/openclaw/data
sudo chown claude:claude /opt/openclaw/data

# Pull the slim image
docker pull ghcr.io/openclaw/openclaw:latest

# Run onboarding interactively (one-time setup)
# This will prompt for provider auth — choose openai-codex
docker run -it --rm \
  -v /opt/openclaw/data:/root/.openclaw \
  ghcr.io/openclaw/openclaw:latest \
  openclaw onboard --auth-choice openai-codex
```

**[ASK]** The onboard wizard will show an OAuth URL. Ask the operator to:
1. Open the URL in their browser
2. Log in with their ChatGPT account
3. Click "Continue" to authorize
4. Paste any confirmation back if prompted

### 1.2 Start OpenClaw as a persistent container

```bash
docker run -d \
  --name openclaw \
  --restart unless-stopped \
  -v /opt/openclaw/data:/root/.openclaw \
  -p 18789:3000 \
  ghcr.io/openclaw/openclaw:latest \
  openclaw start --gateway
```

### 1.3 Add Caddyfile route

Edit `/etc/caddy/Caddyfile`. Keep the existing `nest.kaltenbach.dev` block. Add OpenClaw:

```
nest.kaltenbach.dev {
    # ... existing config (dotfiles block, headers, reverse_proxy) ...

    # OpenClaw WebChat — proxied under /claw/
    handle_path /claw/* {
        reverse_proxy localhost:18789
    }
}
```

Reload Caddy:
```bash
sudo systemctl reload caddy
```

### 1.4 Verify

```bash
# Container running?
docker ps --filter name=openclaw

# WebChat responding?
curl -s -o /dev/null -w '%{http_code}' localhost:18789

# Accessible via Caddy?
curl -s -o /dev/null -w '%{http_code}' https://nest.kaltenbach.dev/claw/
```

**Done when:** Operator can open `https://nest.kaltenbach.dev/claw/` in a browser and see the OpenClaw WebChat interface.

**Commit:** `git add -A && git commit -m "Install OpenClaw: Docker container + Caddyfile route"`

---

## Section 2: Headless Claude Code Execution

**Why:** Claude Code needs to run without a terminal, capture output, and survive disconnection.

### 2.1 Create the task runner script

Create `scripts/tasks/claude-task.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: claude-task.sh --project /path --prompt "do something" [--task-id auto]
# Runs Claude Code headless. Logs output. Commits results.

TASK_DIR="/opt/nest/data/tasks"
mkdir -p "$TASK_DIR"

PROJECT=""
PROMPT=""
TASK_ID=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

[[ -z "$PROJECT" ]] && echo "ERROR: --project required" && exit 1
[[ -z "$PROMPT" ]] && echo "ERROR: --prompt required" && exit 1
[[ -z "$TASK_ID" ]] && TASK_ID="task-$(date +%Y%m%d-%H%M%S)-$$"

STATE_FILE="$TASK_DIR/$TASK_ID.json"
LOG_FILE="$TASK_DIR/$TASK_ID.log"

# Write initial state
python3 -c "
import json
state = {
    'id': '$TASK_ID',
    'project': '$PROJECT',
    'prompt': '''$PROMPT''',
    'status': 'running',
    'started': '$(date -Iseconds)',
    'finished': None,
    'exit_code': None,
    'git_diff_summary': None
}
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
"

echo "[$(date -Iseconds)] Task $TASK_ID started" | tee "$LOG_FILE"
echo "[$(date -Iseconds)] Project: $PROJECT" | tee -a "$LOG_FILE"
echo "[$(date -Iseconds)] Prompt: $PROMPT" | tee -a "$LOG_FILE"
echo "---" >> "$LOG_FILE"

cd "$PROJECT"
GIT_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "no-git")

# Run Claude Code headless
# Try -p (print mode) first, fall back to --print
EXIT_CODE=0
claude -p "$PROMPT" >> "$LOG_FILE" 2>&1 || EXIT_CODE=$?

echo "---" >> "$LOG_FILE"
echo "[$(date -Iseconds)] Claude Code exited with code $EXIT_CODE" | tee -a "$LOG_FILE"

# Git lock for parallel safety
LOCK_FILE="$PROJECT/.nest-task-lock"
for i in $(seq 1 30); do
  if mkdir "$LOCK_FILE" 2>/dev/null; then
    trap "rmdir '$LOCK_FILE' 2>/dev/null" EXIT
    break
  fi
  echo "[$(date -Iseconds)] Waiting for git lock..." >> "$LOG_FILE"
  sleep 2
done

# Capture results
GIT_AFTER=$(git rev-parse HEAD 2>/dev/null || echo "no-git")
DIFF_SUMMARY=""
if [[ "$GIT_BEFORE" != "$GIT_AFTER" ]]; then
  DIFF_SUMMARY="Commits: $(git log --oneline "$GIT_BEFORE..$GIT_AFTER" | head -10)"
elif [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  git add -A
  git commit -m "nest-task: $TASK_ID" >> "$LOG_FILE" 2>&1 || true
  DIFF_SUMMARY="Auto-committed: $(git diff --stat HEAD~1 2>/dev/null | tail -1)"
  git push origin HEAD >> "$LOG_FILE" 2>&1 || echo "[WARN] git push failed" >> "$LOG_FILE"
else
  DIFF_SUMMARY="No changes"
fi

echo "[$(date -Iseconds)] Diff: $DIFF_SUMMARY" | tee -a "$LOG_FILE"

# Update state
python3 -c "
import json
with open('$STATE_FILE', 'r') as f:
    state = json.load(f)
state['status'] = 'done' if $EXIT_CODE == 0 else 'failed'
state['finished'] = '$(date -Iseconds)'
state['exit_code'] = $EXIT_CODE
state['git_diff_summary'] = '''$DIFF_SUMMARY'''
with open('$STATE_FILE', 'w') as f:
    json.dump(state, f, indent=2)
"

echo "[$(date -Iseconds)] Task $TASK_ID finished" | tee -a "$LOG_FILE"
```

### 2.2 Create the dispatcher

Create `scripts/tasks/dispatch-task.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Usage: dispatch-task.sh --project /path --prompt "do something"
# Launches claude-task.sh as a systemd transient service

PROJECT=""
PROMPT=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --project) PROJECT="$2"; shift 2 ;;
    --prompt) PROMPT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

[[ -z "$PROJECT" ]] && echo "ERROR: --project required" && exit 1
[[ -z "$PROMPT" ]] && echo "ERROR: --prompt required" && exit 1

TASK_ID="task-$(date +%Y%m%d-%H%M%S)-$$"
SCRIPT_PATH="/opt/nest/scripts/tasks/claude-task.sh"

sudo systemd-run \
  --unit="nest-task-${TASK_ID}" \
  --description="Nest coding task: ${TASK_ID}" \
  --working-directory="$PROJECT" \
  --uid=claude \
  --setenv="HOME=/home/claude" \
  --setenv="PATH=/usr/local/bin:/usr/bin:/bin" \
  --remain-after-exit \
  bash "$SCRIPT_PATH" \
    --project "$PROJECT" \
    --prompt "$PROMPT" \
    --task-id "$TASK_ID"

echo "Dispatched: $TASK_ID"
```

### 2.3 Verify

```bash
chmod +x scripts/tasks/claude-task.sh scripts/tasks/dispatch-task.sh
mkdir -p /opt/nest/data/tasks

# Test with a trivial task
bash scripts/tasks/dispatch-task.sh \
  --project /opt/nest \
  --prompt "Add a one-line comment at the top of ROADMAP.md: '# Headless test successful'"

# Check it's running
systemctl status 'nest-task-*'

# Wait, then check result
cat /opt/nest/data/tasks/task-*.json | python3 -m json.tool
```

**Done when:** Task dispatched via script runs Claude Code headless, commits results, state JSON shows `"status": "done"`.

**Commit:** `git add scripts/tasks/ && git commit -m "Headless task runner: dispatch Claude Code via systemd"`

---

## Section 3: Hub Task API

**Why:** The client app and OpenClaw need to dispatch and query tasks via HTTP.

### 3.1 Create task routes

Create `hub/src/routes/tasks.ts`:

```typescript
import { FastifyInstance } from "fastify";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const TASK_DIR = "/opt/nest/data/tasks";
const DISPATCH_SCRIPT = "/opt/nest/scripts/tasks/dispatch-task.sh";

export async function taskRoutes(app: FastifyInstance) {
  // List all tasks (admin only)
  app.get("/tasks", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    try {
      const files = await readdir(TASK_DIR);
      const tasks = [];
      for (const f of files.filter((f) => f.endsWith(".json"))) {
        tasks.push(JSON.parse(await readFile(join(TASK_DIR, f), "utf-8")));
      }
      tasks.sort((a, b) => b.started.localeCompare(a.started));
      return { tasks };
    } catch {
      return { tasks: [] };
    }
  });

  // Get single task (admin only)
  app.get<{ Params: { id: string } }>("/tasks/:id", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    try {
      const raw = await readFile(join(TASK_DIR, `${req.params.id}.json`), "utf-8");
      return JSON.parse(raw);
    } catch {
      return reply.code(404).send({ error: "Task not found" });
    }
  });

  // Get task log (admin only)
  app.get<{ Params: { id: string } }>("/tasks/:id/log", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    try {
      const log = await readFile(join(TASK_DIR, `${req.params.id}.log`), "utf-8");
      return { id: req.params.id, log };
    } catch {
      return reply.code(404).send({ error: "Log not found" });
    }
  });

  // Dispatch new task (admin only)
  app.post<{ Body: { project?: string; prompt: string } }>("/tasks", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    const { prompt, project } = req.body;
    if (!prompt) return reply.code(400).send({ error: "prompt required" });

    const targetProject = project || "/opt/nest";

    try {
      const { stdout } = await execAsync(
        `bash ${DISPATCH_SCRIPT} --project "${targetProject}" --prompt "${prompt.replace(/"/g, '\\"')}"`
      );
      const match = stdout.match(/Dispatched: (task-[\w-]+)/);
      return reply.code(202).send({ id: match ? match[1] : "unknown", status: "dispatched" });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });
}
```

### 3.2 Register in hub

Edit `hub/src/index.ts`:
- Add import: `import { taskRoutes } from "./routes/tasks.js";`
- Register in protected section: `await app.register(taskRoutes, { prefix: "/api" });`

### 3.3 Deploy and verify

```bash
cd /opt/nest && git add -A && git commit -m "Hub task API: dispatch, list, get, logs — admin only"
git push origin main

# Deploy via Nest API
source /opt/nest/config.env
curl -s -X POST localhost:3000/api/nest/enhance \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "deploy"}'

# Wait for restart, then test
sleep 60
curl -s -H "Authorization: Bearer $NEST_API_TOKEN" localhost:3000/api/tasks
```

**Done when:** `GET /api/tasks` returns task list, `POST /api/tasks` dispatches a new task.

---

## Section 4: Client Tasks Page + Commands Update

**Why:** The operator needs to see tasks and dispatch them from the Nest dashboard, not just curl.

### 4.1 Add API functions

Edit `app/services/api.ts` — add:

```typescript
export async function getTasks() {
  return fetchAPI<{ tasks: any[] }>("/tasks");
}

export async function getTaskLog(id: string) {
  return fetchAPI<{ id: string; log: string }>(`/tasks/${id}/log`);
}

export async function dispatchTask(prompt: string, project?: string) {
  return fetchAPI<{ id: string; status: string }>("/tasks", {
    method: "POST",
    body: JSON.stringify({ prompt, project }),
  });
}
```

### 4.2 Create tasks page

Create `app/app/tasks.tsx` — a non-tab page (same pattern as `roadmap.tsx`, `projects.tsx`):

- Header with back button, title "Tasks", and a "New Task" button
- New Task form: text input for prompt, optional project path, dispatch button
- Task list: cards showing id, prompt, status badge (running=orange, done=green, failed=red), started time, git diff summary
- Click a task to expand and show the full log
- Auto-refresh every 10 seconds while any task is "running"
- Dark background matching other Nest pages

### 4.3 Update Commands tab

Edit `app/app/(tabs)/commands.tsx` — add a Tasks card:

```typescript
{
  id: "tasks",
  icon: ">>",
  title: "Tasks",
  subtitle: "Dispatch and monitor coding tasks",
  onPress: () => router.push("/tasks"),
},
```

### 4.4 Deploy

```bash
cd /opt/nest && git add -A && git commit -m "Tasks page: dispatch and monitor coding tasks from browser"
git push origin main
source /opt/nest/config.env
curl -s -X POST localhost:3000/api/nest/enhance \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "deploy"}'
```

**Done when:** Operator can open nest.kaltenbach.dev → Commands → Tasks → dispatch a task and see it running.

---

## Section 5: OpenClaw Coding Task Skill

**Why:** The operator types "fix the login bug" in OpenClaw chat → task gets dispatched.

### 5.1 Create the skill

Create `skills/coding-task/SKILL.md`:

```markdown
# Coding Task

Dispatch coding tasks to Claude Code. Tasks run headless on the server. Results are committed to git.

## Triggers

- "fix", "implement", "refactor", "add", "update", "create", "build", "write", "code"
  followed by a description of the change
- "task: ..."
- "run claude on ..."

## Behavior

1. Extract the task description from the user message
2. Call `POST http://localhost:3000/api/tasks` with the API token from environment
3. Report the task ID to the user
4. If the user asks about a task status, call `GET http://localhost:3000/api/tasks`

## API

### Dispatch a task
```
POST http://localhost:3000/api/tasks
Authorization: Bearer {NEST_API_TOKEN}
Content-Type: application/json

{ "project": "/opt/nest", "prompt": "the user's request" }
```

### Check status
```
GET http://localhost:3000/api/tasks
Authorization: Bearer {NEST_API_TOKEN}
```

## Response Templates

**On dispatch:**
> Task `{id}` dispatched. Claude Code is working on it headlessly. Ask me "task status" anytime, or check nest.kaltenbach.dev/tasks.

**On status (running):**
> Task `{id}` is still running. Started {time_ago}.

**On status (done):**
> Task `{id}` finished. {git_diff_summary}. Check the commit on GitHub.

**On status (failed):**
> Task `{id}` failed (exit code {code}). Want to see the log?
```

### 5.2 Register with OpenClaw

```bash
# Find OpenClaw's skill directory
docker exec openclaw ls /root/.openclaw/skills/ 2>/dev/null || echo "Create it"

# Copy skill into the container's skill path
docker cp skills/coding-task openclaw:/root/.openclaw/skills/coding-task

# Make the API token available to OpenClaw
source /opt/nest/config.env
docker exec openclaw sh -c "echo 'NEST_API_TOKEN=$NEST_API_TOKEN' >> /root/.openclaw/.env"

# Restart to pick up new skill
docker restart openclaw
```

### 5.3 Verify

Open `https://nest.kaltenbach.dev/claw/` in a browser. Type:

> "task status"

OpenClaw should call the tasks API and report current tasks.

**Done when:** OpenClaw responds to task-related messages by calling the Nest API.

**Commit:** `git add skills/ && git commit -m "OpenClaw coding-task skill: dispatch Claude Code from chat"`

---

## Section 6: Final Verification — The Self-Proving Task

**Why:** The pipeline should prove itself by running a real task end-to-end through the browser.

### 6.1 Dispatch the verification task

Open `https://nest.kaltenbach.dev/claw/` in a browser. Type:

> "Add a badge to the top of README.md that says '🟢 Browser pipeline verified — [date]'. Also add a section called 'Architecture' with a brief description of the Nest: self-hosted platform manager with a token efficiency pyramid (scripts at base, OpenClaw in middle, Claude Code at top)."

### 6.2 Verify the full chain

1. [ ] OpenClaw received the message and dispatched a task
2. [ ] `GET /api/tasks` shows the task with status "running"
3. [ ] Task status changes to "done"
4. [ ] Git log shows a new commit with the changes
5. [ ] GitHub shows the commit (check from phone)
6. [ ] README.md has the badge and Architecture section
7. [ ] Close the browser. Reopen later. Task history persists.

### 6.3 Update ROADMAP.md

Mark these items as done with today's date:
- C1 (Docker Compose for OpenClaw) — if not using compose, note that it's a plain Docker run
- C3 (WebChat channel)
- C4 (Caddyfile route)
- C5-C7 (skills — at least coding-task)
- C9 (Route chat through OpenClaw) — partially, chat keyword stub still exists but OpenClaw is live

Add new completed items for:
- Headless task runner (systemd-based)
- Hub task API (dispatch, list, get, logs)
- Client tasks page
- OpenClaw coding-task skill

**Commit:** `git add -A && git commit -m "Pipeline verified: browser → OpenClaw → Claude Code → git commit"`

---

## Section 7: Cleanup

### 7.1 Task cleanup cron

```bash
# Create cleanup script
cat > /opt/nest/scripts/tasks/cleanup-tasks.sh << 'EOF'
#!/usr/bin/env bash
find /opt/nest/data/tasks -name "*.json" -mtime +7 -delete
find /opt/nest/data/tasks -name "*.log" -mtime +7 -delete
EOF
chmod +x /opt/nest/scripts/tasks/cleanup-tasks.sh

# Add to crontab
(crontab -l 2>/dev/null; echo "0 4 * * * /opt/nest/scripts/tasks/cleanup-tasks.sh") | crontab -
```

### 7.2 Update BUILD_LOG.md

Log what was built, any issues encountered, and the final state of the system.

### 7.3 Final commit and deploy

```bash
cd /opt/nest && git add -A && git commit -m "Cleanup: task retention cron, build log"
git push origin main
source /opt/nest/config.env
curl -s -X POST localhost:3000/api/nest/enhance \
  -H "Authorization: Bearer $NEST_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "deploy"}'
```

---

## Notes for Claude Code

- **Do not skip sections.** Each builds on the previous.
- **Adapt paths.** Inspect the running system before assuming paths, ports, or container names.
- **ASK the operator** when you see `[ASK]` tags. Don't guess credentials or OAuth tokens.
- **Test each section** before moving on. Verification steps are not optional.
- **Commit after each section** with a descriptive message.
- **Deploy via the Nest API** — use `POST /api/nest/enhance {"action":"deploy"}`, not manual SSH commands.
- **Update ROADMAP.md** as you complete items.
- **The final task in Section 6 must go through the browser.** That's the proof the pipeline works.
- **If `claude -p` doesn't work**, try `claude --print` or check `claude --help` for the correct non-interactive flag.
