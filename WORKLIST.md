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

## Step 3 — Reassess observability signal `REASSESS`

- [ ] Read live `/observability` output across representative windows (24h, 7d).
- [ ] **Criterion:** if waste-pct < 5% over a non-noisy sample → skip O3/O4, jump to step 4.
- [ ] Otherwise: finish O3 (`api-surface-snapshot.sh`) and O4 (cron: O2 every 5 min, O3 every 15 min).
- [ ] Update this step's outcome inline and proceed.

## Step 4 — Phase 3 OpenClaw (strict sequential)

- [ ] C1: Docker Compose for OpenClaw (`node:22-bookworm-slim`)
- [ ] C2: Codex OAuth onboarding `HUMAN` (requires browser)
- [ ] C3: WebChat channel + gateway token auth
- [ ] C10: telemetry bridge — pipe `~/.openclaw/logs/telemetry.jsonl` into O2 aggregator (Phase 2↔3 seam, must land right after C3 so token data stays unified)
- [ ] C4: Caddyfile route `/claw/` → OpenClaw WebChat port
- [ ] C9: replace `hub/src/routes/chat.js` keyword stub with WebChat proxy
- [ ] C5: `server-overview` skill — first real skill, proves the pattern
- [ ] `REASSESS` end-of-phase checkpoint

## Step 5 — Phase 3 skill fan-out (parallelizable after C5)

Dispatch C6/C7/C8 as three subagents in parallel **only after** C5 proves the pattern.

- [ ] C6: `container-manager` skill
- [ ] C7: `script-runner` skill
- [ ] C8: `token-report` skill

## Step 6+ — Menu (not active)

Selection happens after step 5 completes.

- Phase 4 (age encryption): E1, E2, E3, E4, E5, E6, E7
- Phase 5 (appendages): A1–A9
- Phase 6 (client): U4–U9
- Phase 7 (infra): I1–I8
- Phase 8 (Dockbase): D1–D5

---

## Log

- 2026-04-23 — WORKLIST created. Steps 1 and 2 already complete (committed 95f7e67, 40473be).
