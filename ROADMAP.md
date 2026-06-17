# Nest Roadmap — strategic plan & phase history

> **Active task state lives in Linear** (workspace "AI Kanban Pilot", team key `AI`), queried via the `linear` MCP server. This file is the strategic plan-of-record: phase decisions, design rationale, evidence audits, version milestones, and history of shipped work.
>
> As of 2026-05-21, forward-looking checkbox markers (`[ ]`/`[/]`/`[~]`) were removed from items below — those are now Linear tickets (`AI-5`…`AI-44`). Cross-reference via `scripts/tasks-migration.yaml`. `[x]` markers stay as evidence of completed work.
>
> **How to use this file:** read for strategic context (why a phase exists, what shipped, what decisions were made). For "what should I work on next" → query Linear: tickets in `Spec'd` or `Working` for the active phase project.

## Bit-rot Triage — 2026-04-23

Pre-Phase-2 cleanup pass. Findings:

- `inwebclaude.ts` / `outwebclaude.ts` at repo root — deleted. Untracked agent-to-agent correspondence about a drift investigation; both bugs they flagged (HEAD 404, nohup → systemd) are already fixed in commits `f9acf4d` and `9c6ca0e`. Also violated the no-TS convention.
- `hub/src/routes/canvas.js` — documented. Actively used by `scripts.html`, persists `/opt/nest/data/canvas.json`. Added conventional 3-line header.
- `hub/src/routes/enhance.js` — documented. Admin-only self-modification API (`POST /api/nest/enhance`) wired through agent WS. No client UI yet; kept for future OpenClaw integration. Added conventional 3-line header.
- S7 — decision recorded inline on the Phase 1 line below.

---

## Cross-cutting: Pillars wing (architectural reorganization)  *(Linear: AI-46)*

Foundational restructure orthogonal to the phases below. Reorganizes the repo around three layers — pillars (typed interfaces), soil (existing implementations), roof (new short Nest.md). Prepared, not yet executed; status: handoff captured, ground not yet broken.

> Handoff: [docs/pillars-wing-handoff.md](docs/pillars-wing-handoff.md)
> Branch when implementing: `nest/pillars-wing`

---

## Phase 1: Harden What Exists ✅

Completed 2026-03-25. All bugs fixed, security hardened, deployed and verified.

- [x] B1–B5: All bugs resolved
- [x] S1–S6: All security issues resolved (S1 was false alarm, S2–S3 fixed in prior session)
- S7: Hub should not store secrets — rides with Phase 4 (age encryption). Pull forward *only* if new secrets are added to `hub/src/routes/secrets.js` or `config.env` before Phase 4 starts. As of 2026-04-23: no new secrets being added, stays deferred.

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

**Two-sided efficiency (added 2026-05-06):** Tokens are wasted both by *over-spend* (paying for what a script could do) and by *under-use* (paid/free flat-rate quota left idle at month-end, expired promo tokens). Strategic goal: maximize utilization of free/flat capacity (Claude Code sub, Codex sub, OpenRouter promos) before paying per-token. C10 ledger tracks both axes. *(Original 2026-05-06 plan also fed this signal into a "Step 4.5" multi-engine router; that router was cancelled 2026-05-21 — agent scaffolds are self-contained and the user picks one per task. Ledger remains useful as informational dashboard.)*

### Scripts layer

- [x] **O1: `scripts/tasks/` directory** — 2026-04-23. README defines JSON-in/JSON-out contract.
- [x] **O2: `aggregate-telemetry.sh`** — 2026-04-23. Reads `requests.jsonl` + token-windows, writes `/opt/nest/data/telemetry-summary.json`. Leaves OpenClaw slot for C10.
- **O3: `api-surface-snapshot.sh`** — Skipped per step 3 reassessment (2026-04-23). Obviated by existing `/api/nest/wiring` + `/api/nest/surface` self-knowledge endpoints. Re-open if the signal changes.
- **O4: Cron jobs** — Skipped per step 3 reassessment (7d waste 3.9%, below 5% threshold). Re-open if aggregation-on-demand becomes a bottleneck.

### Hub observability endpoints

- [x] **O5: Hub request logging** — (2026-04-03) Append-only JSONL at `/opt/nest/data/requests.jsonl`. Every request: ts, method, path, status, ms. 5MB cap with auto-rotation.
- [x] **O6: `GET /api/observability/tokens`** — 2026-04-23. Auto-regenerates summary if >5 min stale.
- [x] **O7: API surface** — (2026-04-03) Superseded by self-knowledge API: `GET /api/nest/surface` returns all routes grouped by file. `GET /api/nest/wiring` shows external connections.
- [x] **O8: `GET /api/roadmap`** — Already implemented in `routes/roadmap.js`.

### Client pages

- [x] **O9: Roadmap page** — `hub/static/roadmap.html`. Renders ROADMAP.md from `/api/roadmap`. Accessible at `/roadmap`.
- [x] **O10: Observability page** — 2026-04-23. `/observability` — waste indicator, top paths, status/method breakdown, window selector.

### What counts as "wasted"

Two flavors of waste (per 2026-05-06 strategic reframe):

**Over-spend** — same result could have been achieved by a script:
- AI called to fetch data it didn't reason about
- AI called to format something a template could handle
- Failed tool calls that retry
- Repeated identical context within a short window

**Under-use** — paid/free capacity left idle:
- Flat-rate subscription quota unconsumed at month-end (Claude Code, Codex Pro)
- OpenRouter promo tokens expiring before use
- Cheaper engine sitting idle while pricier engine handles routine work

---

## Phase 3: OpenClaw — The Intelligence Layer

Install OpenClaw in Docker. Authenticate with ChatGPT subscription via Codex OAuth. Write Nest skills. Connect to hub.

### Install

- [x] **C1: OpenClaw gateway running** — 2026-04-23. Native install (not Docker) under `claude` user's `systemd --user`, port 18789, config `/home/claude/.openclaw/`. Docker compose template kept for fresh-provisioning (`scripts/templates/docker-compose.openclaw.yml`, `alpine/openclaw:latest`).
- [x] **C2: Codex OAuth authentication** — 2026-05-06. OAuth profile `openai-codex:ausfragezeichen@gmail.com` (mode `oauth`) registered under `auth.profiles` in `/home/claude/.openclaw/openclaw.json`.
- [x] **C3: WebChat channel** — 2026-05-06. Active sessions record `origin.provider: "webchat"` and `deliveryContext.channel: "webchat"`. (No top-level `channels` key in `openclaw.json` — newer OpenClaw stores channel as per-session origin metadata.)
- [x] **C4: Caddyfile route** — Pre-existing. `/etc/caddy/Caddyfile` routes `/claw/` → `localhost:18789` with WebSocket upgrade.

### Nest skills

- **C5: `server-overview` skill** — Skeleton drafted 2026-04-23 at `skills/server-overview/SKILL.md`. The original "skill-dispatch pending ADR-001" framing was retired 2026-05-21 (ADR-001 was about chat-pathway routing, never skill dispatch). The real open question — *how a canonical SKILL.md reaches each scaffold's native skill mechanism* — is now tracked in Linear as `AI-45` (and gates `AI-10` / C5 ticket).
- **C6: `container-manager` skill** — SKILL.md for start/stop/restart/logs via hub API. Same delivery question as C5 (`AI-11`, gated on `AI-45`).
- **C7: `script-runner` skill** — SKILL.md that invokes scripts from `scripts/tasks/`. Agent triggers, script executes, agent interprets result. Same delivery question (`AI-12`, gated on `AI-45`).
- **C8: `token-report` skill** — SKILL.md that reads `/api/observability/tokens`. Agent can report on its own efficiency. Same delivery question (`AI-13`, gated on `AI-45`).

### Hub integration

- [x] **C9: Codex backend in chat.js** — **Retired 2026-05-06.** Deleted `chat.js` + `claw.html`; OpenClaw via OAuth already reaches Codex, so the in-house path was the same backend twice. Reusable Codex auth introspection lifted to `hub/src/codex-status.js` for C10's quota tracker. See ADR-001 Supersession.
- **C9b: OpenClaw backend reachable** — Caddy `/claw/` proxy already exposes OpenClaw to the browser. (The original 2026-05-06 plan paired this with a "Nest-owned router that calls OpenClaw alongside a second scaffold (Hermes)" — that router was cancelled 2026-05-21. Agent scaffolds are self-contained; the user picks one per task. OpenRouter is the escape hatch if generic LLM routing is ever needed.)
- **C10: Multi-source token ledger + capacity tracker** — Reframed 2026-05-06. Strategic goal: **maximize utilization of free/flat capacity** so paid subscription quota isn't left idle. **User scope (2026-05-06):** OAuth subs + free tokens only, no pay-per-token credits. Sources: Codex Pro via OpenClaw OAuth, Claude Pro/Max via Claude Code OAuth, OpenRouter free promos (via Hermes), plus hub requests for Nest infra. Primary axis is *remaining* (cap − used, or promo expiry). *(Original plan also fed a Step 4.5 router; that router was cancelled 2026-05-21 — ledger remains useful as informational dashboard at `/tokens`.)*

---

## Phase 4: The Security Model (age encryption)

The single biggest gap vs. the Nest.md vision. Without this, the hub is a trust violation — it sees all secrets.

> Acceptance criteria + test plan: [docs/sops-age-vaultwarden-plan.md](docs/sops-age-vaultwarden-plan.md)

### Client-side encryption

- **E1: age key derivation from passphrase** — On first setup, passphrase derives an age identity. Store in device secure storage (localStorage for web v1).
- **E2: Server key exchange** — Agent generates age key pair on install. Public key sent to hub. Client fetches public keys.
- **E3: Client encrypts secrets** — `ISecretTransfer.encrypt()` using `age-encryption` npm package. Encrypt for target server's public key.
- **E4: Hub relays opaque blobs** — Refactor `/api/secrets` to relay encrypted blobs, not read/write config.env. Hub never sees plaintext.
- **E5: Agent decrypts and injects** — Create `agent/nest_agent/secrets.py`. Receive blob, cache on disk, decrypt with own private key, inject into container env.

### Client-side provider calls

- **E6: Move Hetzner API calls to client** — Currently hub proxies Hetzner API (holding the token). Per Nest.md, the client should call Hetzner directly. Hub should never see the provider token.

### Backup

- **E7: Secret export/import** — `hub/static/secrets.html` has CRUD UI over `config.env`; encrypted export/import not implemented. Depends on E1/E3 for the encryption primitives.

---

## Phase 5: The Appendage System

Transform the hardcoded catalog into the pluggable schema-driven architecture from Nest.md.

### Schema and validation

- [x] **A1: appendage-schema.json** — 2026-04-23. `config/appendage-schema.json` (Draft 2020-12). Validated against Nest.md §8 mail-server example.
- [x] **A2: Appendage definition files** — 2026-05-07. `appendages/{website,uptime-kuma,gitea,portainer,ollama}.json` ship the 5 catalog items as JSON-against-the-schema (Nest.md §8 updated to permit JSON or YAML). Claude Code + OpenClaw appendages still TODO — they live as bespoke install scripts today (Phase 3 C1) and would need a different shape for OAuth onboarding.
- **A3: Schema validation on install** — 2026-05-07. `hub/src/appendages.js` hand-rolled validator runs at load time; invalid files surface in `GET /api/appendages` under `invalid[]`. Hub-side only — agent does not re-validate (trust boundary: hub). Add agent-side check if/when appendages can come from untrusted sources.

### Wizard renderer

- **A4: Client wizard screen** — 2026-05-07. `/appendages` page lists all contracts with install/uninstall buttons. **Wizard step rendering not yet wired** — current install button just dispatches with built-in defaults. Will need to render `wizard.steps` form fields when a contract requires user input (no contract today does).
- **A5: Client appendage detail** — 2026-05-07. `/appendages` page shows status, mode (container/compose/discovery), host, image/compose source, matched/missing container patterns for discovery appendages, and actions. Logs not surfaced yet (would need an agent `appendage_logs` command).

### Agent lifecycle

- **A6: Full lifecycle in agent** — 2026-05-07. `install_appendage` (single-container) accepts `volumes` + `env`; `install_compose_appendage` clones a git repo or writes inline YAML, runs `docker compose up -d`. `remove_appendage` + `remove_compose_appendage` both idempotent. Missing: `update_appendage`, port-allocation negotiation, Caddy route registration, lifecycle.py extraction. **Note:** the agent install path is for *greenfield* targets; brownfield servers (already running stacks like stoneshop.de) get a different treatment via SSH-driven discovery — see Phase 5 follow-on.
- **A7: Service discovery** — Pre-existing `agent/nest_agent/discovery.py` does git-repo discovery only. Missing: Docker container, systemd unit, and listening-port discovery per Nest.md spec.
- **A8: Git discovery** — Create `agent/nest_agent/git.py`. List repos on server with branch, recent commits.

### Peer APIs

- **A9: Appendage-to-appendage communication** — Implement `consumes` and `apis` from the contract. Service mesh via hub relay or direct Docker network.

### First appendage: Vaultwarden

- **V1 (Linear: AI-47):** appendages/vaultwarden.yaml** — Per Nest.md §8. `vaultwarden/server:latest`, 256 MB declared, `/vault` route, `ADMIN_TOKEN` secret, optional SMTP.
- **V2 (Linear: AI-48):** Wizard end-to-end** — Install via UI, Caddy auto-routes, `ADMIN_TOKEN` injected via E5 pipeline.
- **V3 (Linear: AI-49):** Mobile + restart proof** — Bitwarden app round-trip; survives unattended server restart.
- **V4 (Linear: AI-50):** Uninstall** — Container, volume, route, secret all removed.

> Acceptance criteria: [docs/sops-age-vaultwarden-plan.md](docs/sops-age-vaultwarden-plan.md)

---

## Phase 6: The Client Experience

Polish the client into the distinctive, European aesthetic described in Nest.md.

### Architecture cleanup

- [x] **U1–U3: Framework removal** — (2026-04-03) Replaced React Native/Expo app with vanilla HTML5 pages. Replaced Fastify+TypeScript with raw node:http+JSDoc. No stores, no query library, no component framework. Vanilla JS `fetch()` + `localStorage`.

### Design

- [x] **U4: Design tokens** — 2026-04-23. `DESIGN.md` — palette, method badges, typography, spacing, patterns. Dark mode deferred to U5.
- **U5: Distinctive UI** — The spec says "European aesthetic, coding agent designs freely." This is the creative phase — make it beautiful.

### Features

- **U6: i18n** — English + German. Lightweight browser-side string tables.
- **U7: Push notifications** — Web push or server-side notifications for task completion and alerts.
- **U8: Biometric unlock** — Browser-native passkey or WebAuthn flow.
- **U9: Native builds** — TestFlight (iOS) + internal track (Android).

---

## Phase 7: Infrastructure & Resilience

### IProxy (Caddy management)

- **I1: Caddy API integration** — Dynamic route add/remove via Caddy's admin API instead of static Caddyfile.
- **I2: Auto-TLS per appendage** — When an appendage declares routes, automatically configure Caddy.

### IRepoSync

- **I3: Git webhook handler** — Hub receives GitHub webhook, auto-pulls, rebuilds, restarts.
- **I4: Deploy from chat** — "deploy latest" via OpenClaw triggers git pull + rebuild.

### INetwork

- **I5: WireGuard mesh** — Pre-install WireGuard, activate when second server is added.
- **I6: Multi-server appendage placement** — Decide which appendage runs on which server based on resource requirements.

### Monitoring

- **I7: Log retention** — `hub/src/index.js` caps `requests.jsonl` at 5 MB and rotates by discarding the oldest 50% of lines. Missing: per-period archival (7d detailed / 30d summaries / delete) per Nest.md spec.
- **I8: Alerting** — Agent detects unhealthy containers, hub notifies client via push notification.

---

## Phase 8: The Dockbase Legacy

Bring the battle-tested stoneshop/Dockbase patterns into Nest as appendages.

- **D1: Mail server appendage** — 2026-05-07. Adopted as brownfield via the new `discovery:` contract branch. `appendages/mailcow.json` matches 7 `mailcowdockerized-*` containers on the `stoneshop` SSH host; `/api/appendages` reports `installed:true, status:running`. **Decision (2026-05-07):** nest will *not* run its own mailcow. For automated email sending, nest will authenticate to the existing kaltenbach mailcow as an SMTP relay client (mailbox `nest@<some-domain>`, creds in `config.env` via `env_from_secrets`). Saves ~3GB RAM and avoids duplicate SPF/DKIM/DMARC/TLS work. **Lifecycle (2026-05-21):** logs/inspect/restart over SSH command-execution shipped (`/api/appendages/:name/{logs,inspect,restart}`, admin-only on restart); `update` still deferred (mailcow's update flow is its own playbook, not auto-driven from nest).
- **D2: Website appendage** — 2026-05-07. Static-site half live: `appendages/website.json` boots `nginx:alpine` with `/opt/nest/data/website/public` mounted read-only on host port 8080. End-to-end install/uninstall/reinstall exercised on `ubuntu-4gb-fsn1-1`. Missing: Matomo analytics container + shared mariadb/Caddy from stoneshop's `docker-compose.shared.yml`. Tracking that as D2-extended; basic-static is enough to consider the appendage path *proven* end-to-end.
- [x] **D3: Backup appendage** — 2026-05-07. `appendages/restic.json` (lobaro/restic-backup-docker) snapshots critical nest state (config.env / users / tokens / canvas / website / openclaw / Caddyfile / agent memory) to a dedicated repo `backups/nest` on the existing Hetzner storage box. Cron `0 4 * * *`, retention `--keep-last 7 --keep-daily 7 --keep-weekly 4 --keep-monthly 6`. First snapshot `832a48ba` landed (43k files / 369 MiB). Password loaded via `env_from_secrets: ["RESTIC_PASSWORD"]` (hub passes through from `config.env` — Phase 4 will replace with age-encrypted delivery).
- **D4: CrowdSec appendage** — 2026-05-07. `appendages/crowdsec.json` (`crowdsecurity/crowdsec:latest`) installed end-to-end on `ubuntu-4gb-fsn1-1`. Container healthy via `cscli lapi status`. v1 runs in local-only mode (central-API enrollment fails on IPv6-only hosts; deferred until enrollment via `env_from_secrets` is wired through Phase 4 secrets). Bouncer integration with Caddy still TODO.
- **D5: WooCommerce appendage** — 2026-05-07. Adopted as brownfield via `appendages/stoneshop.json` (`discovery:` contract, matches `dockbase_frankenphp` + `dockbase_mariadb` + `dockbase_keydb` + `dockbase_matomo_(web|shop)`). Reports `installed:true, status:running` against the `stoneshop` SSH host. **Lifecycle (2026-05-21):** logs/inspect/restart routes shipped; `dockbase_keydb` restart proven end-to-end via Nest API (792ms round-trip; container cycled `starting → healthy` in 12s).

---

## Backlog: appendage ideas

Captured ideas not yet scoped for a sprint. One doc per idea in `docs/`.

- **mathviz appendage** (Linear: AI-51) — ManimCE-based 3D math visualization tool with a web UI to browse and create renders. See [docs/mathviz-appendage.md](docs/mathviz-appendage.md).

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

*Last updated: 2026-05-06. Phase 1 complete. Phase 2 complete. Phase 3: C2 + C3 done (Codex OAuth + WebChat live, sessions flowing). Next actionable: C10 (repoint telemetry aggregator at the real OpenClaw session files), then C5 end-to-end exercise. Telegram channel reactivation requested.*

## Shipped 2026-W23 (auto-reconciled 2026-06-04)

- **AI-12** — C7 — script-runner skill
- **AI-11** — C6 — container-manager skill

## Shipped 2026-W24 (auto-reconciled 2026-06-08)

- **AI-55** — Stand up the self-running board — Lab automation (groomer · executor · auto-Done · janitor)
- **AI-39** — I7 — Per-period log archival (7d/30d/delete)
- **AI-29** — U6 — i18n (English + German string tables)
- **AI-26** — A8 — Git discovery (agent/nest_agent/git.py)
- **AI-25** — A7 — Extend discovery.py: Docker / systemd / listening-port
- **AI-23** — A5 — Surface appendage logs on detail page
- **AI-22** — A4 — Wizard step rendering on /appendages
- **AI-12** — C7 — script-runner skill
- **AI-11** — C6 — container-manager skill

## Shipped 2026-W25 (auto-reconciled 2026-06-15)

- **AI-105** — UI: Time range slider with "current" mode as default
- **AI-98** — UI: Inverter residual heatmap on overview page
- **AI-96** — Agent rail · answers link back into UI
- **AI-95** — Agent rail · seeded entry points
- **AI-94** — Agent rail · context-aware side panel
- **AI-93** — NEXT · Limitations / next-steps slide
- **AI-92** — NEXT · Uncertainty + sample counts
- **AI-91** — NEXT · Exportable Fix-First work order
- **AI-90** — NEXT · Forward projection to threshold
- **AI-89** — NEXT · Module-type degradation comparison
- **AI-88** — NEXT · Group-level (combiner) drift
- **AI-87** — NEXT · Repair-effectiveness (before/after)
- **AI-86** — NEXT · Validate 2–3 inverters
- **AI-85** — NEXT · Lead-time vs ticket (timeline graphic)
- **AI-84** — NEXT · Fleet recoverable-€ headline
- **AI-83** — M8 · Demo discipline & pitch
- **AI-82** — M7 · Thin two-page dashboard
- **AI-81** — M6 · Thin decision agent
- **AI-80** — M5 · Error-code + ticket evidence
- **AI-79** — M4 · Financial attribution (lost kWh → €)
- **AI-78** — M3 · Degradation, incidents & curtailment exclusion
- **AI-77** — M2 · Healthy-year-1 expected-power baseline
- **AI-76** — M1 · Data spine (schema, joins, DuckDB tables)
- **AI-75** — M0 · Commit & de-risk the toolchain
- **AI-57** — Serve energyhack.kaltenbach.dev — Streamlit service + kaltenbach nginx proxy
- **AI-58** — Docs — ARCHITECTURE.md + DEMO_SCRIPTS.md + README.md
- **AI-59** — preflight.py — no-network PASS/FAIL harness
- **AI-73** — Offline-hardening pass — friendly errors + backend badge
- **AI-72** — toolkit/branding.py — reframe/rename presets
- **AI-71** — pages/2_Battery_Brain.py — dispatch page
- **AI-70** — toolkit/battery_opt.py — PuLP dispatch LP
- **AI-69** — pages/1_Asset_Copilot.py — flagship flow
- **AI-68** — app.py — landing + portfolio overview
- **AI-67** — toolkit/charts.py — reusable Plotly builders
- **AI-66** — toolkit/llm_writer.py — offline-first writer + template fallback
- **AI-65** — toolkit/anomaly.py — detection rule tree + graceful degrade
- **AI-64** — toolkit/sample_data.py — story-shaped demo data + load_demo()
- **AI-63** — toolkit/financials.py — revenue loss + monthly KPIs
- **AI-62** — toolkit/pv_model.py — expected generation + PR + peer fallback
- **AI-61** — toolkit/data_mapper.py — EN/DE schema mapping
- **AI-60** — Scaffold: repo layout + requirements + .env.example
- **AI-51** — Mathviz appendage — ManimCE 3D math visualizer
