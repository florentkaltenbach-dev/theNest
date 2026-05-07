# WORKLIST.md — Nest active work plan

> Canonical sequence. Pick up from the first unchecked item. Rules in AGENTS.md §Nest Development Workflow.
> Markers: `[x]` done · `[ ]` not started (may carry `blocked-on: <item>`) · `[~]` mid-edit · `[/]` partial (+ note on what's missing) · `[?]` evidence weak. Gates: `REASSESS`, `HUMAN`.

---

## Step 1 — Bit-rot triage (parallelizable) [x] 2026-04-23

Committed as `95f7e67`.

- [x] Track A: delete `inwebclaude.ts` / `outwebclaude.ts`
- [x] Track B: document `canvas.js` + `enhance.js` with convention headers
- [x] Track C: S7 verdict — rides with Phase 4, condition recorded in ROADMAP

## Step 2 — Phase 2 vertical slice (sequential) [x] 2026-04-23

Committed as `40473be`.

- [x] O1: `scripts/tasks/` + README (JSON-in / JSON-out convention)
- [x] O2: `aggregate-telemetry.sh` → `/opt/nest/data/telemetry-summary.json`
- [x] O6: `GET /api/observability/tokens` (auto-regenerates if >5min stale)
- [x] O10: `/observability` page (waste indicator, top paths, breakdowns)

## Step 3 — Reassess observability signal [x] 2026-04-23

**Outcome: skip O3/O4, proceed to step 4.**

Waste-pct across windows:

| Window | Total | Errors | Dupes | Waste % |
|--------|------:|-------:|------:|--------:|
| 1h     |   22  |    3   |   3   |  27.3%  |
| 6h     |   67  |   10   |   5   |  22.4%  |
| 24h    |   70  |   11   |   5   |  22.9%  |
| **7d** |  **563** | **15** | **7** | **3.9%** |

Short windows are noise-dominated by same-session probe activity. 7-day is representative.

**Waste composition (24h sample):**
- Errors: `/favicon.ico` 404 × 3 (missing asset, not retry waste) · `/api/*` 401 × 5 (unauthenticated probes) · `/` 404 × 1, `/nest` 404 × 1 (one-offs) · `/api/servers` 500 × 1 (genuine bug, file separately).
- Duplicates: all browser asset-fetch patterns (favicon, icon-192.png, manifest.webmanifest) within 74–266ms — browser parallelism, not app retries.

Nothing in the data resembles "AI-for-data-fetching waste" that O3/O4 would catch. O3 also overlaps with the existing self-knowledge `/api/nest/wiring` endpoint. Cron (O4) can be added trivially if a future signal emerges.

**Noted for later:** `/api/servers` 500 — one-off, not on the critical path, tracked here for eventual investigation. **Investigated 2026-04-23:** all 5 historical 500s have 1–2 ms response time, consistent with `requireToken()` firing before the fetch — i.e., `HETZNER_API_TOKEN` was not in `config.env` at the time. Token is now set, direct API call returns 200 + 3 servers, endpoint works. No code change.

- [x] Read waste data across windows.
- [x] Verdict: 7d waste 3.9% < 5% threshold. Skip O3/O4.

## Step 4 — Phase 3 OpenClaw

Per 2026-04-23 audit: the C-chain is mostly already done (some via pre-existing code, some this session). Only C2 + C3 remain, both blocked on the user.

- [x] C1: gateway running — native install, port 18789 (2026-04-23).
- [x] C2: Codex OAuth — 2026-05-06. Profile `openai-codex:ausfragezeichen@gmail.com` (mode `oauth`) registered under `auth.profiles` in `openclaw.json`.
- [x] C3: WebChat channel — 2026-05-06. Active and in use: live sessions `f0fe28fa-…` and `6115710e-…` both record `origin.provider: "webchat"` and `deliveryContext.channel: "webchat"`. (No `channels` key in `openclaw.json` — newer OpenClaw stores channel as per-session origin metadata, not as a top-level config block.)
- [x] C4: Caddyfile — pre-existing, `/claw/` → `localhost:18789`.
- [x] C9: Codex CLI backend — **retired 2026-05-06**. Deleted `hub/src/routes/chat.js` and `hub/static/claw.html`; removed wiring from `index.js` and `HUB.md`. Reusable Codex OAuth introspection lifted to `hub/src/codex-status.js` (consumer: C10). Rationale in `docs/ADR-001-chat-pathway.md` Supersession.
- [/] C10: multi-source token ledger + capacity tracker. Strategic goal (2026-05-06): **maximize utilization of free/flat capacity** so paid subscription quota isn't left idle. **Scope constraint (2026-05-06):** user only uses OAuth subscriptions and free tokens — no pay-per-token API credits. So the ledger tracks three source families, all flat-rate or free: (a) Codex Pro via OpenClaw OAuth (`agents/main/sessions/.usage-cost-cache.json` + plan info from `hub/src/codex-status.js`); (b) Claude Pro/Max via Claude Code OAuth (TBD source); (c) OpenRouter free promos (per-model, time-limited). Plus hub `requests.jsonl` for the over-spend axis on Nest's own infra. **Primary axis is *remaining*** (cap − used) — there's nothing to "overspend" on, the goal is to consume what's allotted before it expires. Feeds Step 4.5 router for capacity-aware engine selection.
- [/] C5: `skills/server-overview/SKILL.md` skeleton drafted — triggers/API/thresholds written. End-to-end exercise now possible (C2+C3 done). Skill-dispatch mechanism still pending ADR-001.
- [~] C9b: OpenClaw backend already reachable via Caddy `/claw/` proxy (so "wiring" is done at the network layer). What remains: the Nest-owned multi-engine router in step 4.5, which calls OpenClaw alongside the second scaffold. Track under step 4.5 from now on.
- [ ] Telegram channel — user requested reactivation via OpenClaw chat (2026-05-06). Tracked here so it lands in the channel inventory once OpenClaw confirms.
- [ ] `REASSESS` end-of-phase checkpoint — verify: telemetry projection feeds `/observability`, OpenClaw data sits next to hub requests. Week of usage before scoping the custom interface.

## Step 4.5 — Custom Nest chat interface + multi-engine router

Reframed 2026-05-06 (was: "Codex vs OpenClaw"). Goal: a Nest-owned chat surface that picks among *agent scaffolds* (OpenClaw, Hermes-or-equivalent, possibly more), each fronting some LLM. **Routing is capacity-aware** — prefer the engine with idle free/flat quota (data from C10) so paid subscriptions don't sit unused.

Hermes (per user 2026-05-06): a peer to OpenClaw — agent scaffolding in front of an LLM, API or OAuth. Not yet selected; keep the slot generic so other scaffolds fit too.

Token sources/engines in scope: Claude Code subscription, Codex subscription (via OpenClaw), OpenRouter free promos, plus whichever scaffold/LLM Hermes resolves to.

- [ ] Pick the second scaffold — research candidates that fit "Hermes-shape": OAuth/API in front of an LLM, can be self-hosted alongside OpenClaw, supports OpenRouter and/or Anthropic.
- [ ] Design: routing policy. User toggle? Task type? **Free-quota-first** (consume promo / flat-rate before paying)? Per-slash-command override? Likely a hybrid.
- [ ] Design: does history carry across engine switches, or per-engine?
- [ ] Design: how the router queries C10 for live capacity per engine.
- [ ] Implementation: `hub/static/chat.html` (new or refactor of `claw.html`) + router in `chat.js`. Router replaces the direct-Codex path (C9 retirement).

**Prerequisite:** at least one week of OpenClaw usage + the second scaffold installed, so routing decisions are informed by real strengths and quotas.

## Step 5 — Phase 3 skill fan-out (parallelizable after C5)

Dispatch C6/C7/C8 as three subagents in parallel **only after** C5 proves the pattern.

- [ ] C6: `container-manager` skill
- [ ] C7: `script-runner` skill
- [ ] C8: `token-report` skill — reads Nest's multi-source ledger (C10), not OpenClaw's own usage cache. Surfaces used + unused-quota across all sources.

## Step 6+ — Menu (not active)

Selection happens after step 5 completes. Audit 2026-04-23 updated the baseline — items marked `[x]` or `[~]` are already done or partial and can be skipped or shortened when their phase becomes active.

- **Phase 4 (age encryption):** E1–E5 [ ]. E6 [ ] — hub/src/routes/{servers,chat}.js still call `api.hetzner.cloud` directly; client-direct is the goal. E7 [/] — `secrets.html` has CRUD; encrypted export/import missing.
- **Phase 5 (appendages):** A1 [x] (`config/appendage-schema.json`). A7 [/] — git-repo discovery in `discovery.py`; Docker/systemd/port discovery still missing. A2–A6, A8, A9 [ ].
- **Phase 6 (client):** U4 [x] (`DESIGN.md`). U5–U9 [ ].
- **Phase 7 (infra):** I1–I6, I8 [ ]. I7 [/] — 5MB cap with 50% rotation on `requests.jsonl`; no per-period archival.
- **Phase 8 (Dockbase):** D1–D5 [ ].

S7 (hub storing secrets): confirmed still plaintext in `hub/src/routes/secrets.js` → `/opt/nest/config.env`. Rides with Phase 4 per 2026-04-23 decision.

---

## Evidence audit (2026-04-23)

One-line verification per `[x]`. All confirmed live; no demotions to `[?]`.

| Item | Evidence |
|------|----------|
| Track A delete orphan .ts | `ls /opt/nest/*.ts` → no such file. Commit `95f7e67`. |
| Track B document canvas/enhance | `head -3 hub/src/routes/{canvas,enhance}.js` → convention headers present. Commit `95f7e67`. |
| Track C S7 verdict recorded | `ROADMAP.md:31` carries S7 line with 2026-04-23 condition. Commit `95f7e67`. |
| O1 scripts/tasks README | `ls scripts/tasks/README.md` → 2431 bytes. Commit `40473be`. |
| O2 aggregate-telemetry | `echo '{}' \| scripts/tasks/aggregate-telemetry.sh` → emits summary JSON with 70 requests over 24h. Commit `40473be`. |
| O6 /api/observability/tokens | `curl /api/routes \| jq '.routes[] \| select(.url=="/api/observability/tokens")'` → present. Commit `40473be`. |
| O10 /observability page | Same curl for `/observability` → present. 20 pages loaded per `journalctl`. Commit `40473be`. |
| Step 3 read waste data | Commit `589f0b3` records per-window numbers (1h/6h/24h/7d). |
| Step 3 verdict | `589f0b3` records 7d=3.9% < 5% → skip O3/O4. |
| C1 gateway running | `ss -tlnp \| grep 18789` → `openclaw-gateway` PID 323664. `curl 127.0.0.1:18789/` → 200. Pre-existing. |
| C4 Caddyfile /claw/ | `systemctl is-active caddy` → active. `/etc/caddy/Caddyfile` contains `handle_path /claw/* { reverse_proxy localhost:18789 }`. Pre-existing. |

## Log

- 2026-04-23 — WORKLIST created. Steps 1 and 2 already complete (committed 95f7e67, 40473be).
- 2026-04-23 — Step 3 reassessment: 7d waste 3.9% < 5% threshold → O3/O4 skipped, advancing to step 4.
- 2026-04-23 — Audit of ROADMAP vs reality. Surprise finds: C9 (chat.js) already routes to Codex CLI, A7 (`discovery.py`) pre-existing, C4 (Caddyfile) pre-existing. ROADMAP and WORKLIST sanitized to match.
- 2026-04-23 — Convention update: `[/]` partial, `[?]` review, `blocked-on` suffix, removal-goal audit rule added to AGENTS.md. Applied to E7, I7, A7, C3, C5, C9, C10.
- 2026-04-23 — Evidence audit: all 11 `[x]` items verified with live commands. No demotions.
- 2026-05-06 — C2 done. OAuth profile present in `openclaw.json`. C3/C5/C9b/C10 unblocked but still unfinished; C3 is now the next actionable step.
- 2026-05-06 — Re-checked: C3 also already done (WebChat channel is in use; recorded as per-session origin metadata, not a top-level `channels` key). C10 reclassified `[/]` — the aggregator path is wrong, not a wait-for-data state. Telegram channel item added.
- 2026-05-06 — C10 reframed: multi-source token ledger (hub + OpenClaw + Claude Code + future Hermes) plus unused-quota tracking for flat-rate OAuth subs. OpenClaw's own usage UI is fine; Nest's value is the cross-source view + unused-capacity signal.
- 2026-05-06 — C9 slated for retirement (Codex via OpenClaw is the same backend twice). Step 4.5 reframed: backends are OpenClaw vs Hermes, not Codex vs OpenClaw. C8 token-report rewired to consume the multi-source ledger.
- 2026-05-06 — Strategic goal recorded: maximize utilization of free/flat capacity (Claude Code sub, Codex sub, OpenRouter promos). C10 grows a "remaining capacity" axis that Step 4.5's router consumes — route to the engine with the most idle free quota. Hermes generalized to "second agent scaffold, TBD"; OpenRouter added as a token source.
- 2026-05-06 — Cleanup: deleted dead `chat.js` + `claw.html` (Caddy had been swallowing `/claw` and `/claw/*` to OpenClaw, orphaning the in-house page). Lifted Codex OAuth introspection to `hub/src/codex-status.js` for C10. ADR-001 superseded; Nest.md §7, HUB.md, index.js updated.
- 2026-05-06 — C10 scope locked: user only uses OAuth subscriptions (Codex Pro, Claude Pro/Max) + free tokens (OpenRouter promos). No pay-per-token API credits. Ledger optimizes for *remaining-capacity* axis; over-spend axis is essentially N/A.
- 2026-05-06 — C5 finished: SKILL.md rewritten with OpenClaw frontmatter, references new `/api/agents` endpoint (added to `nest.js`), symlinked into `~/.openclaw/plugin-skills/`. `openclaw skills info server-overview` shows ✓ Ready. Pending: user mints `NEST_HUB_TOKEN` and tests in chat.
- 2026-05-06 — C10 design doc written at `docs/C10-token-ledger-design.md`. Schema, source list, aggregator strategy, open questions.
- 2026-05-06 — Bug fix: `index.js` was missing `saveTokens` from the auth.js import; `tryAuth` crashed the hub on every successful API-token validation (latent until the first hub token was minted today for OpenClaw). Added the import.
- 2026-05-06 — Telegram channel: confirmed working — user asked C5 questions via Telegram and got a (failed-but-coherent) response. Move from "pending OpenClaw confirmation" to done once user verifies the round-trip post-fix.
- 2026-05-06 — C5 round-trip validated end-to-end via Telegram DM: skill triggered, called `/api/agents`, parsed response, applied threshold logic, rendered structured answer. **But the answer was wrong** — agent reported "offline" because the endpoint computed `lastSeen` from `connectedAt` (set once at WS connect, never updated). Fixed: `agentHandler.js` now tracks `lastMessageAt` per inbound message and exposes `connected` from `ws.readyState`. `/api/agents` simplified to trust the WS layer.
