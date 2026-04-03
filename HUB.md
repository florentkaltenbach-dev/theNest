# HUB.md — The Head File

> The Hub reads this file. This file tells the Hub how to read everything else.

Nothing is served unless defined here. No unauthorized path, no unregistered file, no undocumented endpoint. The Hub is a closed system that presents itself through rules declared in this document.

---

## 1. Principle

The Hub generates its own interface by reading its own source tree. No extra documentation files. No READMEs. No maintained changelogs. The code describes itself through conventions — file headers, JSDoc comments, import statements, route registrations — and the Hub extracts, indexes, and serves that self-knowledge.

Caddy terminates TLS and forwards all traffic to the Hub. The Hub decides what to serve. Nothing else has opinions about content.

```
Browser → Caddy (TLS only) → Hub (everything)
```

---

## 2. Pages

Every page the Hub serves is registered here. A path not listed here returns 404. Adding a page means adding a line to this section and dropping an HTML file in `hub/static/`.

| Path | File | Title | Auth |
|------|------|-------|------|
| `/` | `index.html` | Home | yes |
| `/login` | `login.html` | Login | no |
| `/terminal` | `terminal.html` | Terminal | yes |
| `/scripts` | `scripts.html` | Scripts | yes |
| `/secrets` | `secrets.html` | Secrets | yes |
| `/settings` | `settings.html` | Settings | yes |
| `/tokens` | `tokens.html` | Tokens | yes |
| `/projects` | `projects.html` | Projects | yes |
| `/artifacts` | `artifacts.html` | Artifacts | yes |
| `/claw` | `claw.html` | OpenClaw | yes |
| `/commands` | `commands.html` | Commands | yes |
| `/invite` | `invite.html` | Invite | no |
| `/journeys` | `journeys.html` | Journeys | yes |
| `/onboarding` | `onboarding.html` | Onboarding | no |
| `/roadmap` | `roadmap.html` | Roadmap | yes |
| `/routes` | `routes.html` | API Surface | yes |
| `/server` | `server.html` | Server Detail | yes |
| `/tasks` | `tasks.html` | Tasks | yes |
| `/nest` | `nest.html` | Nest Explorer | yes |

The last entry — `/nest` — is the self-generated interface. One HTML page that fetches from the self-knowledge API and renders the Nest's own structure.

Static assets (icons, manifest) are served from `hub/static/` by filename. No directory listing. No path traversal.

---

## 3. The self-knowledge API

The Hub exposes its own structure as data. These endpoints power the `/nest` page. They are also available to OpenClaw as context.

### 3.1 Service map

`GET /api/nest/services`

Returns the service grouping. Source: this file, section 5.

```json
{
  "services": [
    { "id": "hub", "role": "The switchboard", "root": "hub/src" },
    { "id": "agent", "role": "The hands", "root": "agent" },
    { "id": "client", "role": "The eyes", "root": "hub/static" },
    { "id": "scripts", "role": "The workhorses", "root": "scripts" }
  ]
}
```

### 3.2 Folder contents

`GET /api/nest/folder?path=hub/src/routes`

Returns every file in a directory with its header extracted from the source.

```json
{
  "path": "hub/src/routes",
  "service": "hub",
  "files": [
    {
      "name": "auth.js",
      "header": "Login, invite, API token management",
      "exports": ["authRoutes"],
      "size": 4821,
      "lastCommit": { "hash": "a1b2c3d", "message": "fix JWT expiry", "date": "2026-03-28" }
    }
  ]
}
```

### 3.3 File detail

`GET /api/nest/file?path=hub/src/routes/auth.js`

Returns the full self-knowledge for one file.

```json
{
  "path": "hub/src/routes/auth.js",
  "service": "hub",
  "header": "Login, invite, API token management",
  "functions": [
    { "name": "authRoutes", "params": "router, jwt", "jsdoc": "..." },
    { "name": "loadUsers", "params": "", "returns": "Promise<User[]>" },
    { "name": "hashPassword", "params": "input: string", "returns": "string" }
  ],
  "imports": ["../server.js", "../types.js"],
  "importedBy": ["../index.js"],
  "routes": [
    { "method": "POST", "path": "/api/auth/login" },
    { "method": "POST", "path": "/api/auth/invite" },
    { "method": "POST", "path": "/api/auth/accept-invite" },
    { "method": "GET",  "path": "/api/auth/tokens" },
    { "method": "POST", "path": "/api/auth/tokens" },
    { "method": "DELETE","path": "/api/auth/tokens/:id" }
  ],
  "externalCalls": [],
  "lastCommit": { "hash": "a1b2c3d", "message": "fix JWT expiry", "date": "2026-03-28" },
  "recentHistory": [
    { "hash": "a1b2c3d", "message": "fix JWT expiry", "date": "2026-03-28" },
    { "hash": "e4f5g6h", "message": "add API token auth", "date": "2026-03-25" }
  ]
}
```

### 3.4 Route surface

`GET /api/nest/surface`

Returns every registered route, grouped by source file. Built automatically from route registrations — not documented separately.

```json
{
  "routes": [
    { "method": "GET", "path": "/api/health", "file": "routes/health.js", "auth": false },
    { "method": "POST", "path": "/api/auth/login", "file": "routes/auth.js", "auth": false },
    { "method": "GET", "path": "/api/servers", "file": "routes/servers.js", "auth": true }
  ],
  "websockets": [
    { "path": "/ws/agent", "file": "ws/agentHandler.js" },
    { "path": "/ws/client", "file": "ws/agentHandler.js" },
    { "path": "/ws/terminal", "file": "ws/terminal.js" }
  ],
  "total": { "routes": 42, "websockets": 3 }
}
```

### 3.5 Import graph

`GET /api/nest/graph`

Returns the dependency graph of the entire codebase, extracted from import/from statements.

```json
{
  "nodes": [
    { "path": "hub/src/index.js", "service": "hub" },
    { "path": "hub/src/server.js", "service": "hub" },
    { "path": "hub/src/routes/auth.js", "service": "hub" }
  ],
  "edges": [
    { "from": "hub/src/index.js", "to": "hub/src/routes/auth.js" },
    { "from": "hub/src/routes/auth.js", "to": "hub/src/server.js" }
  ],
  "orphans": []
}
```

`orphans` lists files that nothing imports and that import nothing. Likely dead code.

### 3.6 Convention compliance

`GET /api/nest/health/conventions`

The Hub audits itself against the rules in this document.

```json
{
  "status": "yellow",
  "checks": {
    "fileHeaders": { "pass": 15, "fail": 3, "missing": ["routes/canvas.js", "routes/roadmap.js", "routes/artifacts.js"] },
    "jsdocExports": { "pass": 42, "fail": 7 },
    "serviceAssignment": { "assigned": 28, "orphaned": 0 },
    "pageRegistration": { "registered": 19, "unregistered": 0 },
    "maxFileLength": { "pass": 17, "fail": 1, "violations": [{ "file": "routes/projects.js", "lines": 247 }] }
  }
}
```

### 3.7 Cross-service wiring

`GET /api/nest/wiring`

What each file talks to outside of itself. Extracted by scanning for `fetch(`, `ssh.connect(`, `ws.send(`, `child_process`, `docker`.

```json
{
  "external": [
    { "file": "routes/servers.js", "target": "api.hetzner.cloud", "type": "http" },
    { "file": "routes/scripts.js", "target": "managed servers", "type": "ssh" },
    { "file": "routes/chat.js", "target": "OpenClaw", "type": "process" }
  ],
  "internal": [
    { "file": "ws/agentHandler.js", "target": "agent", "type": "websocket" },
    { "file": "ws/terminal.js", "target": "node-pty", "type": "native" }
  ]
}
```

### 3.8 Live state

`GET /api/nest/state`

Combines live system data with the structural data from above.

```json
{
  "hub": { "uptime": 84200, "routes": 42, "wsConnections": 3 },
  "agents": { "connected": 1, "hostname": "nest-1" },
  "containers": { "running": 4, "stopped": 1 },
  "scripts": { "available": 12, "runsToday": 3 },
  "sessions": { "active": 2 },
  "conventions": { "status": "yellow", "issues": 4 }
}
```

---

## 4. Extraction rules

How the Hub reads its own source tree. No extra files needed. The code describes itself.

### 4.1 File headers

The first comment block in every `.js`, `.py`, or `.sh` file. Extract lines starting with `//`, `#`, or `"""` until the first non-comment line.

```
// hub/src/routes/auth.js
//
// Login, invite, API token management.
// Exports: authRoutes(router, jwt)
// Depends: NEST_ADMIN_PASSWORD env var
```

Extraction: first line = path (verify matches actual path), remaining lines = description. If the header is missing, the file fails the convention check.

### 4.2 Exported functions

Scan for `export function` and `export async function`. Extract the function name, parameters, and the JSDoc block immediately above it (if any).

Pattern:
```
/** @param {Router} router */
export function authRoutes(router, jwt) {
```

Yields: `{ name: "authRoutes", params: "router, jwt", jsdoc: "@param {Router} router" }`

### 4.3 Import graph

Scan for `import ... from '...'` and `import('...')`. Resolve relative paths against the file location. Record as edges.

For Python: scan for `import` and `from ... import`. For shell: scan for `source` and `. ` (dot-space).

### 4.4 Route registrations

The router records every `router.get()`, `router.post()`, `router.delete()` call. At registration time, it stores the method, path, and source file. No scanning needed — the router itself is the source of truth.

### 4.5 External call detection

Scan source files for patterns that indicate external communication:

| Pattern | Type |
|---------|------|
| `fetch('http` or `fetch(\`http` | http |
| `new NodeSSH()` or `ssh.connect` | ssh |
| `ws.send(` or `socket.send(` | websocket |
| `child_process` or `spawn(` or `exec(` | process |
| `docker` (in Python) | docker |

Record the file, the target (extract URL or hostname if possible), and the type.

### 4.6 Git history

Shell out to `git log` for any file. Cache results on startup, invalidate on `--watch` restart.

```
git log --format='%H %ai %s' -n 10 -- <filepath>
```

---

## 5. Service map

Every file in the repo belongs to exactly one service. A file not listed under any service is an orphan and triggers a convention warning.

| Service | Role | Root path | Rule |
|---------|------|-----------|------|
| **hub** | The switchboard | `hub/src/` | `.js` files in hub/src/ |
| **client** | The eyes | `hub/static/` | All files in hub/static/ |
| **agent** | The hands | `agent/` | All files in agent/ |
| **scripts** | The workhorses | `scripts/` | All files in scripts/ |
| **meta** | The spec | repo root | All root-level files not claimed by another service |
| **docs** | Reference | `docs/` | All files in docs/ |
| **runtime** | Not in repo | — | config.env, setup.json, users.json, CLAUDE.md |

Assignment is by path prefix. If a file's path starts with a service's root, it belongs to that service. Root-level files (`.md`, `.gitignore`, `LICENSE`, `config.env.example`, etc.) belong to meta.

`hub/package.json` and `hub/package-lock.json` belong to hub.

---

## 6. Conventions

Rules the Hub enforces on itself. Checked by `/api/nest/health/conventions`.

| Rule | What | How checked |
|------|------|-------------|
| File header | Every `.js` file in `hub/src/` has a 3-line comment header | First 5 lines contain `//` |
| JSDoc exports | Every `export function` has a `/** */` block above it | Regex before export |
| Service assignment | Every file on disk is in exactly one service | Path prefix match |
| Page registration | Every `.html` in `hub/static/` is in the page table (section 2) | Set comparison |
| Max file length | No file exceeds 200 lines | `wc -l` |
| No orphan imports | Every import target resolves to an existing file | Path resolution |
| No dead files | Every `.js` file is either imported by something or is `index.js` | Graph check |

---

## 7. The `/nest` page

One HTML file. One `<script>` block. Fetches from the self-knowledge API and renders the Nest's structure. No server-side HTML generation.

It shows:

1. **Service overview** — each service with its role, file count, convention status
2. **Folder browser** — click into any service, see its folders and files with headers
3. **File detail** — click a file, see its functions, imports, routes, git history
4. **Route surface** — every API endpoint and WebSocket path, grouped by file
5. **Import graph** — visual wiring of what connects to what
6. **Convention health** — green/yellow/red with specific violations listed
7. **Live state** — connected agents, running containers, active sessions
8. **Cross-service wiring** — what talks to external systems

All data comes from `GET /api/nest/*`. The page is a viewer. The API is the truth.

---

## 8. Implementation in server.js

The self-knowledge system is built into `nest.js` as a module. On startup (and on `--watch` restart), the Hub:

1. Reads this file (HUB.md) — parses the page table from section 2
2. Walks the source tree — extracts headers, functions, imports from every file
3. Records route registrations — the router logs every `.get()`, `.post()`, `.delete()`
4. Caches git history — shells out to `git log` for each file
5. Runs convention checks — compares what's on disk against the rules in section 6
6. Serves the results at `/api/nest/*`

The scan runs once on startup. It's fast — the repo is small. Results are cached in memory. On `--watch` restart (file change detected), the cache rebuilds.

No database. No external dependencies. The Hub reads files and serves what it finds.

---

## 9. What this enables

A developer (human or AI) opens the Nest in a browser and sees the entire system: every service, every file, every function, every route, every connection, every convention violation. The documentation is always correct because it's extracted from the running code. Nothing is maintained separately.

OpenClaw can query the same API. "What does auth.js do?" is answered by reading the file header and function index. "What changed this week?" is answered by git history. "Are there any problems?" is answered by the convention check.

The Nest knows itself.
