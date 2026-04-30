# Nest Roadmap

> The canonical plan for closing gaps between what's built and the Nest.md vision.
> Any Claude Code instance should read this before starting work. Update after completing each item.
> Visible at nest.kaltenbach.dev/roadmap once Phase 2 is deployed.

## How to Use This File

- Pick up where the last session left off — check the `Current Focus` section
- Mark items `[x]` when done, add date
- If a task is in progress, mark `[~]` and note what's left
- Don't skip phases — they're ordered for a reason

---

## Current Focus

> **Phase 2: Observability & Token Efficiency**
> Status: NOT STARTED
> Reason: Before adding intelligence (OpenClaw), build the measurement layer. Scripts handle grunt work, AI handles thinking. Measure token waste from day one.

---

## Cross-cutting: Pillars wing (architectural reorganization)

Foundational restructure orthogonal to the phases below. Reorganizes the repo around three layers — pillars (typed interfaces), soil (existing implementations), roof (new short Nest.md). Prepared, not yet executed; status: handoff captured, ground not yet broken.

> Handoff: [docs/pillars-wing-handoff.md](docs/pillars-wing-handoff.md)
> Branch when implementing: `nest/pillars-wing`

---

## Phase 1: Harden What Exists ✅

Completed 2026-03-25. All bugs fixed, security hardened, deployed and verified.

- [x] B1–B5: All bugs resolved
- [x] S1–S6: All security issues resolved (S1 was false alarm, S2–S3 fixed in prior session)
- [ ] S7: Hub should not store secrets — deferred to age encryption phase

---

## Phase 2: Observability & Token Efficiency

Build the measurement and automation layer before adding AI. Scripts do the heavy lifting, AI does the thinking. Every API interaction is tracked.

### Design Principle: The Token Efficiency Pyramid

```
        ┌─────────────┐
        │  Claude Code │  Anthropic quota — architecture, code, complex reasoning
        │   (sparse)   │  Only called when intelligence is needed
        ├──────────────┤
        │    Claw      │  ChatGPT sub (flat rate) — operational chat, user-facing
        │  (frequent)  │  Delegates to scripts when possible
        ├──────────────┤
        │   Scripts    │  Zero tokens — cron jobs, API calls, data collection
        │  (constant)  │  Both AIs invoke these instead of making raw API calls
        └──────────────┘
```

**Rule:** If it can be a script, it's a script. AI only gets called for decisions.

### Scripts layer

- [ ] **O1: Create `scripts/tasks/` directory** — Reusable scripts that both AIs and cron jobs can invoke. Each script takes JSON args, returns JSON output.
- [ ] **O2: `aggregate-telemetry.sh`** — Reads OpenClaw telemetry JSONL + hub request logs. Computes: total tokens, tokens per provider, waste estimate. Writes summary JSON to `/opt/nest/data/telemetry-summary.json`.
- [ ] **O3: `api-surface-snapshot.sh`** — Scrapes all inter-component API interactions (hub↔agent, hub↔claw, hub↔Hetzner, hub↔client). Writes manifest JSON to `/opt/nest/data/api-surface.json`.
- [ ] **O4: Cron jobs** — Install crontab entries on server: telemetry aggregation every 5 min, API surface snapshot every 15 min.

### Hub observability endpoints

- [x] **O5: Hub request logging** — (2026-04-03) Append-only JSONL at `/opt/nest/data/requests.jsonl`. Every request: ts, method, path, status, ms. 5MB cap with auto-rotation.
- [ ] **O6: `GET /api/observability/tokens`** — Serves telemetry summary JSON. Token usage by provider, waste counter, 5-min granularity.
- [x] **O7: API surface** — (2026-04-03) Superseded by self-knowledge API: `GET /api/nest/surface` returns all routes grouped by file. `GET /api/nest/wiring` shows external connections.
- [x] **O8: `GET /api/roadmap`** — Already implemented in `routes/roadmap.js`.

### Client pages

- [x] **O9: Roadmap page** — `hub/static/roadmap.html`. Renders ROADMAP.md from `/api/roadmap`. Accessible at `/roadmap`.
- [ ] **O10: Observability page** — standalone HTML page. Token counter, API surface map, waste indicator. Accessible at `/observability`.

### What counts as "wasted"

A token is wasted if the same result could have been achieved by a script:
- AI called to fetch data it didn't reason about
- AI called to format something a template could handle
- Failed tool calls that retry
- Repeated identical context within a short window

---

## Phase 3: OpenClaw — The Intelligence Layer

Install OpenClaw in Docker. Authenticate with ChatGPT subscription via Codex OAuth. Write Nest skills. Connect to hub.

### Install

- [ ] **C1: Docker Compose for OpenClaw** — Slim image (`node:22-bookworm-slim`, ~500MB). Mount volumes for config + data. Add to server's Docker setup.
- [ ] **C2: Codex OAuth authentication** — Run `openclaw onboard --auth-choice openai-codex`. Interactive — requires user to paste OAuth URL in browser. Uses ChatGPT subscription (flat rate, no per-token billing).
- [ ] **C3: WebChat channel** — Enable built-in WebChat. Configure gateway auth (token mode).
- [ ] **C4: Caddyfile route** — Reverse proxy `/claw/` to OpenClaw WebChat port. TLS via existing cert.

### Nest skills

- [ ] **C5: `server-overview` skill** — SKILL.md that calls `GET /api/agents` for live metrics. Claw reads pre-computed data, no tokens wasted on data fetching.
- [ ] **C6: `container-manager` skill** — SKILL.md for start/stop/restart/logs via hub API.
- [ ] **C7: `script-runner` skill** — SKILL.md that invokes scripts from `scripts/tasks/`. Claw triggers, script executes, Claw interprets result.
- [ ] **C8: `token-report` skill** — SKILL.md that reads `/api/observability/tokens`. Claw can report on its own efficiency.

### Hub integration

- [ ] **C9: Route chat through OpenClaw** — Replace `hub/src/routes/chat.js` keyword stub with OpenClaw WebChat proxy. Preserve existing API contract (`POST /chat/send` → `{userMessage, assistantMessage}`).
- [ ] **C10: Telemetry bridge** — Feed OpenClaw's `~/.openclaw/logs/telemetry.jsonl` into the observability pipeline (O2 script reads it).

---

## Phase 4: The Security Model (age encryption)

The single biggest gap vs. the Nest.md vision. Without this, the hub is a trust violation — it sees all secrets.

> Acceptance criteria + test plan: [docs/sops-age-vaultwarden-plan.md](docs/sops-age-vaultwarden-plan.md)

### Client-side encryption

- [ ] **E1: age key derivation from passphrase** — On first setup, passphrase derives an age identity. Store in device secure storage (localStorage for web v1).
- [ ] **E2: Server key exchange** — Agent generates age key pair on install. Public key sent to hub. Client fetches public keys.
- [ ] **E3: Client encrypts secrets** — `ISecretTransfer.encrypt()` using `age-encryption` npm package. Encrypt for target server's public key.
- [ ] **E4: Hub relays opaque blobs** — Refactor `/api/secrets` to relay encrypted blobs, not read/write config.env. Hub never sees plaintext.
- [ ] **E5: Agent decrypts and injects** — Create `agent/nest_agent/secrets.py`. Receive blob, cache on disk, decrypt with own private key, inject into container env.

### Client-side provider calls

- [ ] **E6: Move Hetzner API calls to client** — Currently hub proxies Hetzner API (holding the token). Per Nest.md, the client should call Hetzner directly. Hub should never see the provider token.

### Backup

- [ ] **E7: Secret export/import** — Client can export all secrets as encrypted file, import on new device with passphrase.

---

## Phase 5: The Appendage System

Transform the hardcoded catalog into the pluggable schema-driven architecture from Nest.md.

### Schema and validation

- [ ] **A1: appendage-schema.json** — JSON schema for the YAML contract (name, version, requirements, container, routes, apis, skill, wizard).
- [ ] **A2: Appendage YAML files** — Create actual YAML definitions for the 5 existing catalog items + Claude Code + OpenClaw + website.
- [ ] **A3: Schema validation on install** — Agent validates appendage YAML before pulling images.

### Wizard renderer

- [ ] **A4: Client wizard screen** — HTML page reads `wizard.steps` from appendage YAML and renders dynamic form fields.
- [ ] **A5: Client appendage detail** — HTML page shows status, config, logs, actions.

### Agent lifecycle

- [ ] **A6: Full lifecycle in agent** — Create `agent/nest_agent/lifecycle.py`. Install, remove, update appendages. Handle volume management, port allocation, route registration.
- [ ] **A7: Service discovery** — Create `agent/nest_agent/discovery.py`. Auto-detect running services (Docker containers, systemd units, listening ports) and match to known appendages.
- [ ] **A8: Git discovery** — Create `agent/nest_agent/git.py`. List repos on server with branch, recent commits.

### Peer APIs

- [ ] **A9: Appendage-to-appendage communication** — Implement `consumes` and `apis` from the contract. Service mesh via hub relay or direct Docker network.

### First appendage: Vaultwarden

- [ ] **V1: appendages/vaultwarden.yaml** — Per Nest.md §8. `vaultwarden/server:latest`, 256 MB declared, `/vault` route, `ADMIN_TOKEN` secret, optional SMTP.
- [ ] **V2: Wizard end-to-end** — Install via UI, Caddy auto-routes, `ADMIN_TOKEN` injected via E5 pipeline.
- [ ] **V3: Mobile + restart proof** — Bitwarden app round-trip; survives unattended server restart.
- [ ] **V4: Uninstall** — Container, volume, route, secret all removed.

> Acceptance criteria: [docs/sops-age-vaultwarden-plan.md](docs/sops-age-vaultwarden-plan.md)

---

## Phase 6: The Client Experience

Polish the client into the distinctive, European aesthetic described in Nest.md.

### Architecture cleanup

- [x] **U1–U3: Framework removal** — (2026-04-03) Replaced React Native/Expo app with vanilla HTML5 pages. Replaced Fastify+TypeScript with raw node:http+JSDoc. No stores, no query library, no component framework. Vanilla JS `fetch()` + `localStorage`.

### Design

- [ ] **U4: Design system** — Color tokens, spacing scale, typography. Dark mode and light mode. Follow system setting.
- [ ] **U5: Distinctive UI** — The spec says "European aesthetic, coding agent designs freely." This is the creative phase — make it beautiful.

### Features

- [ ] **U6: i18n** — English + German. Lightweight browser-side string tables.
- [ ] **U7: Push notifications** — Web push or server-side notifications for task completion and alerts.
- [ ] **U8: Biometric unlock** — Browser-native passkey or WebAuthn flow.
- [ ] **U9: Native builds** — TestFlight (iOS) + internal track (Android).

---

## Phase 7: Infrastructure & Resilience

### IProxy (Caddy management)

- [ ] **I1: Caddy API integration** — Dynamic route add/remove via Caddy's admin API instead of static Caddyfile.
- [ ] **I2: Auto-TLS per appendage** — When an appendage declares routes, automatically configure Caddy.

### IRepoSync

- [ ] **I3: Git webhook handler** — Hub receives GitHub webhook, auto-pulls, rebuilds, restarts.
- [ ] **I4: Deploy from chat** — "deploy latest" via OpenClaw triggers git pull + rebuild.

### INetwork

- [ ] **I5: WireGuard mesh** — Pre-install WireGuard, activate when second server is added.
- [ ] **I6: Multi-server appendage placement** — Decide which appendage runs on which server based on resource requirements.

### Monitoring

- [ ] **I7: Log retention** — 7 days detailed, 30 days daily summaries, then delete. Per Nest.md spec.
- [ ] **I8: Alerting** — Agent detects unhealthy containers, hub notifies client via push notification.

---

## Phase 8: The Dockbase Legacy

Bring the battle-tested stoneshop/Dockbase patterns into Nest as appendages.

- [ ] **D1: Mail server appendage** — Based on `DOCKBASE-PLAN-FINAL.md` Mailcow integration. YAML contract + install script.
- [ ] **D2: Website appendage** — Static site + Matomo analytics. From Dockbase website stack.
- [ ] **D3: Backup appendage** — Restic backup with retention policies. From Dockbase backup architecture.
- [ ] **D4: CrowdSec appendage** — IDS/WAF. From Dockbase shared infrastructure.
- [ ] **D5: WooCommerce appendage** — FrankenPHP + MariaDB + KeyDB. From Dockbase shop stack.

---

## Backlog: appendage ideas

Captured ideas not yet scoped for a sprint. One doc per idea in `docs/`.

- [ ] **mathviz appendage** — ManimCE-based 3D math visualization tool with a web UI to browse and create renders. See [docs/mathviz-appendage.md](docs/mathviz-appendage.md).

---

## Version Milestones

| Version | What | Phases |
|---------|------|--------|
| **v0.2** | Solid foundation — bugs fixed, security patched | Phase 1 ✅ |
| **v0.3** | Observability, token tracking, scripts layer, roadmap visible | Phase 2 |
| **v0.4** | OpenClaw live, Nest skills, Claw + Claude Code collaborating | Phase 3 |
| **v0.5** | Encrypted secrets, trust model implemented | Phase 4 |
| **v0.6** | Appendage system with dynamic wizards | Phase 5 |
| **v0.7** | Beautiful client, i18n, native builds | Phase 6 |
| **v0.8** | Dynamic routing, webhooks, monitoring | Phase 7 |
| **v1.0** | Full Nest.md vision realized, Dockbase appendages | Phase 8 |

---

*Last updated: 2026-04-03. Phase 1 complete. Refactor complete: Fastify→raw node:http, TypeScript→JSDoc, 9 deps→3, self-knowledge engine live. O5 done. Phase 2 in progress.*
