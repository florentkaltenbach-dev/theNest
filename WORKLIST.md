# WORKLIST.md — Nest active work plan

> Canonical sequence. Pick up from the first unchecked item. Rules in AGENTS.md §Nest Development Workflow.
> Tags: `[x]` done + date · `[~]` in progress · `[ ]` pending · `REASSESS` human-decision gate · `HUMAN` requires user action.

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
- [ ] C3: WebChat channel — gated on C2. Configure via Control UI post-onboarding.
- [x] C4: Caddyfile — pre-existing, `/claw/` → `localhost:18789`.
- [x] C9: chat.js uses local Codex CLI — pre-existing. Different backend than the ROADMAP's WebChat-proxy plan; same `/chat/send` contract. Includes agent-metric context and `/apply` write mode.
- [~] C10: telemetry bridge — aggregator points at `/home/claude/.openclaw/logs/telemetry.jsonl`. File materializes once OpenClaw processes chat (i.e., after C2).
- [~] C5: `skills/server-overview/SKILL.md` skeleton drafted. End-to-end validation requires C2.
- [ ] `REASSESS` end-of-phase checkpoint — after C2, verify: chat via `/claw/` returns real replies, telemetry file exists, observability page shows OpenClaw data.

## Step 5 — Phase 3 skill fan-out (parallelizable after C5)

Dispatch C6/C7/C8 as three subagents in parallel **only after** C5 proves the pattern.

- [ ] C6: `container-manager` skill
- [ ] C7: `script-runner` skill
- [ ] C8: `token-report` skill

## Step 6+ — Menu (not active)

Selection happens after step 5 completes. Audit 2026-04-23 updated the baseline — items marked `[x]` or `[~]` are already done or partial and can be skipped or shortened when their phase becomes active.

- **Phase 4 (age encryption):** E1–E5 not started. E6 not done (hub still proxies Hetzner; client-direct is the goal). E7 partial (`secrets.html` has CRUD; no encrypted export/import).
- **Phase 5 (appendages):** A1 [x] (`config/appendage-schema.json`). A7 [x] (pre-existing `agent/nest_agent/discovery.py`, git-repo discovery only — Docker/systemd/port discovery still open). A2–A6, A8, A9 open.
- **Phase 6 (client):** U4 [x] (`DESIGN.md`). U5–U9 open.
- **Phase 7 (infra):** I1–I8 all open. I7 partial (5MB cap on `requests.jsonl` with 50% rotation; no per-period archival).
- **Phase 8 (Dockbase):** D1–D5 open.

S7 (hub storing secrets): confirmed still plaintext in `hub/src/routes/secrets.js` → `/opt/nest/config.env`. Rides with Phase 4 per 2026-04-23 decision.

---

## Log

- 2026-04-23 — WORKLIST created. Steps 1 and 2 already complete (committed 95f7e67, 40473be).
- 2026-04-23 — Step 3 reassessment: 7d waste 3.9% < 5% threshold → O3/O4 skipped, advancing to step 4.
- 2026-04-23 — Audit of ROADMAP vs reality. Surprise finds: C9 (chat.js) already routes to Codex CLI, A7 (`discovery.py`) pre-existing, C4 (Caddyfile) pre-existing. ROADMAP and WORKLIST sanitized to match. Only genuine remaining Phase 3 gates are C2 (HUMAN) and C3 (post-C2).
