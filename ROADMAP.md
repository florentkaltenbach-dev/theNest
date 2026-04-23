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

## Bit-rot Triage — 2026-04-23

Pre-Phase-2 cleanup pass. Findings:

- `inwebclaude.ts` / `outwebclaude.ts` at repo root — deleted. Untracked agent-to-agent correspondence about a drift investigation; both bugs they flagged (HEAD 404, nohup → systemd) are already fixed in commits `f9acf4d` and `9c6ca0e`. Also violated the no-TS convention.
- `hub/src/routes/canvas.js` — documented. Actively used by `scripts.html`, persists `/opt/nest/data/canvas.json`. Added conventional 3-line header.
- `hub/src/routes/enhance.js` — documented. Admin-only self-modification API (`POST /api/nest/enhance`) wired through agent WS. No client UI yet; kept for future OpenClaw integration. Added conventional 3-line header.
- S7 — decision recorded inline on the Phase 1 line below.

---

## Phase 1: Harden What Exists ✅

Completed 2026-03-25. All bugs fixed, security hardened, deployed and verified.

- [x] B1–B5: All bugs resolved
- [x] S1–S6: All security issues resolved (S1 was false alarm, S2–S3 fixed in prior session)
- [ ] S7: Hub should not store secrets — rides with Phase 4 (age encryption). Pull forward *only* if new secrets are added to `hub/src/routes/secrets.js` or `config.env` before Phase 4 starts. As of 2026-04-23: no new secrets being added, stays deferred.

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

- [x] **O1: `scripts/tasks/` directory** — 2026-04-23. README defines JSON-in/JSON-out contract.
- [x] **O2: `aggregate-telemetry.sh`** — 2026-04-23. Reads `requests.jsonl` + token-windows, writes `/opt/nest/data/telemetry-summary.json`. Leaves OpenClaw slot for C10.
- [~] **O3: `api-surface-snapshot.sh`** — Skipped per step 3 reassessment (2026-04-23). Obviated by existing `/api/nest/wiring` + `/api/nest/surface` self-knowledge endpoints. Re-open if the signal changes.
- [~] **O4: Cron jobs** — Skipped per step 3 reassessment (7d waste 3.9%, below 5% threshold). Re-open if aggregation-on-demand becomes a bottleneck.

### Hub observability endpoints

- [x] **O5: Hub request logging** — (2026-04-03) Append-only JSONL at `/opt/nest/data/requests.jsonl`. Every request: ts, method, path, status, ms. 5MB cap with auto-rotation.
- [x] **O6: `GET /api/observability/tokens`** — 2026-04-23. Auto-regenerates summary if >5 min stale.
- [x] **O7: API surface** — (2026-04-03) Superseded by self-knowledge API: `GET /api/nest/surface` returns all routes grouped by file. `GET /api/nest/wiring` shows external connections.
- [x] **O8: `GET /api/roadmap`** — Already implemented in `routes/roadmap.js`.

### Client pages

- [x] **O9: Roadmap page** — `hub/static/roadmap.html`. Renders ROADMAP.md from `/api/roadmap`. Accessible at `/roadmap`.
- [x] **O10: Observability page** — 2026-04-23. `/observability` — waste indicator, top paths, status/method breakdown, window selector.

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

- [x] **C1: OpenClaw gateway running** — 2026-04-23. Native install (not Docker) under `claude` user's `systemd --user`, port 18789, config `/home/claude/.openclaw/`. Docker compose template kept for fresh-provisioning (`scripts/templates/docker-compose.openclaw.yml`, `alpine/openclaw:latest`).
- [ ] **C2: Codex OAuth authentication** — `HUMAN`. Gateway unauthenticated (`agents/main/models.json` has `provider: null`, `wizard_done: null`). Browser: `https://nest.kaltenbach.dev/claw/` → onboarding → `openai-codex`.
- [~] **C3: WebChat channel** — PARTIAL. Gateway UI serves but no WebChat channel config in `/home/claude/.openclaw/openclaw.json`. Needs C2 first.
- [x] **C4: Caddyfile route** — Pre-existing. `/etc/caddy/Caddyfile` routes `/claw/` → `localhost:18789` with WebSocket upgrade.

### Nest skills

- [~] **C5: `server-overview` skill** — Skeleton drafted 2026-04-23 at `skills/server-overview/SKILL.md`. Real validation requires C2.
- [ ] **C6: `container-manager` skill** — SKILL.md for start/stop/restart/logs via hub API.
- [ ] **C7: `script-runner` skill** — SKILL.md that invokes scripts from `scripts/tasks/`. Claw triggers, script executes, Claw interprets result.
- [ ] **C8: `token-report` skill** — SKILL.md that reads `/api/observability/tokens`. Claw can report on its own efficiency.

### Hub integration

- [?] **C9: Chat route replaced** — `hub/src/routes/chat.js` calls local `codex` CLI (model `gpt-5.4`) with agent/Hetzner/history context, supports `/apply` write mode. **Different architecture** than the "replace stub with OpenClaw WebChat proxy" plan. Functional (`/chat/send` contract preserved), but whether this satisfies C9 depends on whether OpenClaw remains the chat pathway. See `docs/ADR-001-chat-pathway.md`.
- [~] **C10: Telemetry bridge** — Aggregator defaults `OPENCLAW_TELEMETRY=/home/claude/.openclaw/logs/telemetry.jsonl`. File doesn't exist yet (OpenClaw hasn't written telemetry without auth). Activates automatically after C2.

---

## Phase 4: The Security Model (age encryption)

The single biggest gap vs. the Nest.md vision. Without this, the hub is a trust violation — it sees all secrets.

### Client-side encryption

- [ ] **E1: age key derivation from passphrase** — On first setup, passphrase derives an age identity. Store in device secure storage (localStorage for web v1).
- [ ] **E2: Server key exchange** — Agent generates age key pair on install. Public key sent to hub. Client fetches public keys.
- [ ] **E3: Client encrypts secrets** — `ISecretTransfer.encrypt()` using `age-encryption` npm package. Encrypt for target server's public key.
- [ ] **E4: Hub relays opaque blobs** — Refactor `/api/secrets` to relay encrypted blobs, not read/write config.env. Hub never sees plaintext.
- [ ] **E5: Agent decrypts and injects** — Create `agent/nest_agent/secrets.py`. Receive blob, cache on disk, decrypt with own private key, inject into container env.

### Client-side provider calls

- [ ] **E6: Move Hetzner API calls to client** — Currently hub proxies Hetzner API (holding the token). Per Nest.md, the client should call Hetzner directly. Hub should never see the provider token.

### Backup

- [/] **E7: Secret export/import** — `hub/static/secrets.html` has CRUD UI over `config.env`; encrypted export/import not implemented. Depends on E1/E3 for the encryption primitives.

---

## Phase 5: The Appendage System

Transform the hardcoded catalog into the pluggable schema-driven architecture from Nest.md.

### Schema and validation

- [x] **A1: appendage-schema.json** — 2026-04-23. `config/appendage-schema.json` (Draft 2020-12). Validated against Nest.md §8 mail-server example.
- [ ] **A2: Appendage YAML files** — Create actual YAML definitions for the 5 existing catalog items + Claude Code + OpenClaw + website.
- [ ] **A3: Schema validation on install** — Agent validates appendage YAML before pulling images.

### Wizard renderer

- [ ] **A4: Client wizard screen** — HTML page reads `wizard.steps` from appendage YAML and renders dynamic form fields.
- [ ] **A5: Client appendage detail** — HTML page shows status, config, logs, actions.

### Agent lifecycle

- [ ] **A6: Full lifecycle in agent** — Create `agent/nest_agent/lifecycle.py`. Install, remove, update appendages. Handle volume management, port allocation, route registration.
- [/] **A7: Service discovery** — Pre-existing `agent/nest_agent/discovery.py` does git-repo discovery only. Missing: Docker container, systemd unit, and listening-port discovery per Nest.md spec.
- [ ] **A8: Git discovery** — Create `agent/nest_agent/git.py`. List repos on server with branch, recent commits.

### Peer APIs

- [ ] **A9: Appendage-to-appendage communication** — Implement `consumes` and `apis` from the contract. Service mesh via hub relay or direct Docker network.

---

## Phase 6: The Client Experience

Polish the client into the distinctive, European aesthetic described in Nest.md.

### Architecture cleanup

- [x] **U1–U3: Framework removal** — (2026-04-03) Replaced React Native/Expo app with vanilla HTML5 pages. Replaced Fastify+TypeScript with raw node:http+JSDoc. No stores, no query library, no component framework. Vanilla JS `fetch()` + `localStorage`.

### Design

- [x] **U4: Design tokens** — 2026-04-23. `DESIGN.md` — palette, method badges, typography, spacing, patterns. Dark mode deferred to U5.
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

- [/] **I7: Log retention** — `hub/src/index.js` caps `requests.jsonl` at 5 MB and rotates by discarding the oldest 50% of lines. Missing: per-period archival (7d detailed / 30d summaries / delete) per Nest.md spec.
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
