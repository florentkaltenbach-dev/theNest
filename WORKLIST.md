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
- [ ] C2: Codex OAuth `HUMAN`. Open `https://nest.kaltenbach.dev/claw/`, run onboarding, pick `openai-codex`.
- [ ] C3: WebChat channel. `blocked-on: C2` (Control UI requires authenticated session).
- [x] C4: Caddyfile — pre-existing, `/claw/` → `localhost:18789`.
- [x] C9: Codex CLI backend live in `chat.js`. Per ADR-001 (accepted), Codex is one of two chat backends; a Nest-owned interface will route between them. `/chat/send` contract preserved. Follow-up: **C9b** below for the OpenClaw backend wiring.
- [ ] C10: telemetry bridge — aggregator points at `/home/claude/.openclaw/logs/telemetry.jsonl`. `blocked-on: C2` (no telemetry until OpenClaw processes chat via the gateway).
- [/] C5: `skills/server-overview/SKILL.md` skeleton drafted — triggers/API/thresholds written. Missing: end-to-end test with an authenticated OpenClaw (`blocked-on: C2`) and a decision on skill-dispatch mechanism pending ADR-001.
- [ ] C9b: OpenClaw backend wired into the custom chat interface. `blocked-on: C2` and on custom-interface scope (step 4.5 below). Parallel to C9; does not replace it.
- [ ] `REASSESS` end-of-phase checkpoint — after C2, verify: OpenClaw returns real replies via `/claw/`, telemetry file materializes, observability page shows OpenClaw data in addition to hub requests. Week of usage before scoping the custom interface.

## Step 4.5 — Custom Nest chat interface (placeholder)

Per ADR-001. Not scoped yet. Exists here so we don't lose it.

- [ ] Design: how does the interface decide Codex vs OpenClaw per request? (User toggle, task type, slash-commands, first-available — see Nest.md §16 → Chat backends.)
- [ ] Design: does history carry across backend switches?
- [ ] Design: unified telemetry view across both backends in `/observability`.
- [ ] Implementation: new `hub/static/chat.html` (or amend existing) + backend router in `chat.js` or a new route.

**Prerequisite:** at least one week of usage with both engines running, so routing decisions are informed by what each is actually good at.

## Step 5 — Phase 3 skill fan-out (parallelizable after C5)

Dispatch C6/C7/C8 as three subagents in parallel **only after** C5 proves the pattern.

- [ ] C6: `container-manager` skill
- [ ] C7: `script-runner` skill
- [ ] C8: `token-report` skill

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
