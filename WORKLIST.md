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

## Step 4 — Phase 3 OpenClaw [x] 2026-05-07

Closed out 2026-05-07. C10 ledger live, all OpenClaw channels (WebChat + Telegram) confirmed, C5 skill validated end-to-end. C9b absorbed into Step 4.5.

Per 2026-04-23 audit: the C-chain was mostly already done (some pre-existing, some this session). C2/C3 done 2026-05-06; C5/Telegram/C9b/C10 done 2026-05-07.

- [x] C1: gateway running — native install, port 18789 (2026-04-23).
- [x] C2: Codex OAuth — 2026-05-06. Profile `openai-codex:ausfragezeichen@gmail.com` (mode `oauth`) registered under `auth.profiles` in `openclaw.json`.
- [x] C3: WebChat channel — 2026-05-06. Active and in use: live sessions `f0fe28fa-…` and `6115710e-…` both record `origin.provider: "webchat"` and `deliveryContext.channel: "webchat"`. (No `channels` key in `openclaw.json` — newer OpenClaw stores channel as per-session origin metadata, not as a top-level config block.)
- [x] C4: Caddyfile — updated 2026-05-08. Caddy sends all traffic to Hub; Hub gates `/claw` with Nest auth, enforces same-origin WS upgrades, then proxies to OpenClaw on `127.0.0.1:18789`.
- [x] C9: Codex CLI backend — **retired 2026-05-06**. Deleted `hub/src/routes/chat.js` and `hub/static/claw.html`; removed wiring from `index.js` and `HUB.md`. Reusable Codex OAuth introspection lifted to `hub/src/codex-status.js` (consumer: C10). Rationale in `docs/ADR-001-chat-pathway.md` Supersession.
- [x] C10: 2026-05-07. Multi-source token ledger live. Sources: `codex-pro` (OpenClaw `.usage-cost-cache.json`), `claude-pro` (`~/.claude/projects/*/*.jsonl` aggregation), `openrouter-promo` (opt-in via `OPENROUTER_API_KEY`), `nest-infra` (hub `requests.jsonl`). Aggregator: `scripts/tasks/aggregate-tokens.sh` + `scripts/tasks/sources/*.sh`. Endpoint: `GET /api/observability/tokens` (multi-source shape per `docs/C10-token-ledger-design.md`). Sibling endpoint `GET /api/observability/requests` retains hub waste/path stats. `/observability` page renders both. Caps configured via `config.env` (`NEST_CAP_CODEX_PRO_TOKENS` etc.); without caps, `remaining.unknown=true` per design. **Pending user action:** populate caps in `config.env` to unlock `totals.remainingByEngine` for Step 4.5 router consumption.
- [x] C5: 2026-05-06. SKILL.md written + symlinked into `~/.openclaw/plugin-skills/`; `openclaw skills info server-overview` reports ✓ Ready. Round-trip validated end-to-end via Telegram DM (per 2026-05-06 log); `lastSeen`/`connected` bug fixed in `agentHandler.js`.
- [x] C9b: 2026-05-06. Absorbed into Step 4.5. Caddy `/claw/` proxy is the network-layer wiring; Nest-side router is what remains, tracked under 4.5.
- [x] Telegram channel — 2026-05-06. Confirmed working (round-trip validated via Telegram DM).
- [x] `REASSESS` end-of-phase checkpoint — 2026-05-07. Step 4 gate cleared with C10 ledger live (see Step 4 close-out log).

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
- **Phase 5 (appendages):** A1 [x], A2 [x] (8 JSON contracts in `appendages/`), A3 [/] (hub-side validator covers compose:+env: extension). A6 [/] — install/remove for both single-container *and* compose paths; update + lifecycle.py + Caddy registration still missing. A7 [/] — git-repo discovery in `discovery.py`; Docker/systemd/port discovery still missing; **SSH-driven discovery** is the next milestone, blocks D1+D5 brownfield. A4 (wizard), A5 (detail), A8, A9 [ ].
- **Phase 6 (client):** U4 [x] (`DESIGN.md`). U5–U9 [ ].
- **Phase 7 (infra):** I1–I6, I8 [ ]. I7 [/] — 5MB cap with 50% rotation on `requests.jsonl`; no per-period archival.
- **Phase 8 (Dockbase):** D1 [/], D2 [/], D3 [/], D4 [/], D5 [/]. All 5 items now have `installed:true` paths in `/api/appendages` — D2/D3/D4 greenfield on nest, D1/D5 brownfield-adopted on stoneshop.de via SSH discovery.

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
| C4 Caddyfile /claw/ | `systemctl is-active caddy` → active. `/etc/caddy/Caddyfile` proxies all traffic to Hub; Hub owns `/claw` and proxies authenticated traffic to OpenClaw on `127.0.0.1:18789`. Updated 2026-05-08. |

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
- 2026-05-08 — `/claw` moved behind the Hub perimeter. Caddy now forwards all traffic to Hub; `hub/src/openclawProxy.js` requires Nest auth for HTTP, rejects cross-origin WS upgrades before proxying, strips `/claw`, and optionally injects `Authorization: Bearer $HUB_OPENCLAW_UPSTREAM_PASSWORD` upstream without parsing OpenClaw's app frames.
- 2026-05-06 — C10 scope locked: user only uses OAuth subscriptions (Codex Pro, Claude Pro/Max) + free tokens (OpenRouter promos). No pay-per-token API credits. Ledger optimizes for *remaining-capacity* axis; over-spend axis is essentially N/A.
- 2026-05-06 — C5 finished: SKILL.md rewritten with OpenClaw frontmatter, references new `/api/agents` endpoint (added to `nest.js`), symlinked into `~/.openclaw/plugin-skills/`. `openclaw skills info server-overview` shows ✓ Ready. Pending: user mints `NEST_HUB_TOKEN` and tests in chat.
- 2026-05-06 — C10 design doc written at `docs/C10-token-ledger-design.md`. Schema, source list, aggregator strategy, open questions.
- 2026-05-06 — Bug fix: `index.js` was missing `saveTokens` from the auth.js import; `tryAuth` crashed the hub on every successful API-token validation (latent until the first hub token was minted today for OpenClaw). Added the import.
- 2026-05-06 — Telegram channel: confirmed working — user asked C5 questions via Telegram and got a (failed-but-coherent) response. Move from "pending OpenClaw confirmation" to done once user verifies the round-trip post-fix.
- 2026-05-06 — C5 round-trip validated end-to-end via Telegram DM: skill triggered, called `/api/agents`, parsed response, applied threshold logic, rendered structured answer. **But the answer was wrong** — agent reported "offline" because the endpoint computed `lastSeen` from `connectedAt` (set once at WS connect, never updated). Fixed: `agentHandler.js` now tracks `lastMessageAt` per inbound message and exposes `connected` from `ws.readyState`. `/api/agents` simplified to trust the WS layer.
- 2026-05-07 — **Step 4 close-out.** C10 implemented per design doc: 4 source scripts (`codex-pro`, `claude-pro`, `openrouter-promo`, `nest-infra`) + orchestrator `aggregate-tokens.sh`. `/api/observability/tokens` now serves the multi-source ledger; request stats moved to sibling `/api/observability/requests`. `/observability` page rebuilt to render both. Cap envs documented in `config.env.example`. **Browser test pending** — chrome-devtools tunnel was down at write time; server-side both endpoints validated with JWT (3 sources reporting; `claude-pro` 4.5M tokens, `codex-pro` 38.5M tokens this period; `nest-infra` 24h request waste 19.1%). REASSESS gate cleared: telemetry feeds /observability ✓, OpenClaw data sits next to hub requests ✓, 2+ weeks of OpenClaw usage on the books ✓.
- 2026-05-07 — **Phase 5/8 vertical slice landed.** Skipped Step 4.5 + Step 5 (skill fanout) and went straight at the appendage system. New: `appendages/{website,uptime-kuma,gitea,portainer,ollama}.json` (5 JSON contracts replacing the hardcoded catalog in `routes/appendages.js`); `hub/src/appendages.js` loader + hand-rolled validator (no new npm deps); agent `install_appendage` extended to mount volumes and recreate stale containers. End-to-end exercise: `POST /api/appendages/install website on ubuntu-4gb-fsn1-1` → agent pulled `nginx:alpine`, ran with port 80→8080 + `/opt/nest/data/website/public:/usr/share/nginx/html:ro` → `curl :8080` returned placeholder index → `/api/appendages` reports `installed:true, status:running`. **Format choice:** Nest.md §8 was YAML-only; updated to permit JSON since hub has no YAML parser dep and JSON keeps the platform-native posture intact. **Out of scope this slice:** A4 wizard, A5 detail page, lifecycle.py extraction, remove/update commands, Matomo extension for D2, schema validation on agent side.
- 2026-05-07 — **Lifecycle + D4 follow-on.** Added `remove_appendage` agent command (idempotent — already-absent is success) + `POST /api/appendages/uninstall`. Smoke test: install website → uninstall website → idempotent uninstall (still 200) → reinstall → `curl :8080` 200. New: `appendages/crowdsec.json` (`crowdsecurity/crowdsec:latest`) installed end-to-end; LAPI healthy via `cscli lapi status`; central-API enrollment fails on IPv6-only host (deferred until Phase 4 secret injection). **D1 (Mailcow) + D5 (WooCommerce)** explicitly blocked on a multi-container schema extension; **D3 (Restic)** blocked on a scheduled-execution primitive — surfacing both as the next contract evolution rather than half-shipping them.
- 2026-05-07 — **Compose extension + D3 + brownfield pivot.** Added `compose:` to the appendage contract (with `git:` or `inline:` source, plus `env:` for variable interpolation) + `env:` to single-container path. Agent gained `install_compose_appendage` / `remove_compose_appendage` — clones repo (or writes inline YAML) into `/opt/nest/data/appendages/<name>/`, runs `docker compose up -d/down`. Smoke-tested with WP+mariadb (inline 2-container compose, container `wordpress-test_wp` returned 200 on `:8082`, then uninstalled cleanly). D3 Restic shipped via `lobaro/restic-backup-docker` using the new `env:` field (cron `0 4 * * *`, retention `--keep-last 7 --keep-daily 7 --keep-weekly 4 --keep-monthly 6`); first manual backup ran (snapshot `afbf66b9`). **Pivot:** D1 + D5 reframed as *brownfield adoption* — both stacks already run on `stoneshop.de` (confirmed via `ssh stoneshop docker ps`); the right tool is SSH-driven discovery (hub polls `ssh <host> docker ps`, no agent install on the remote, contracts match running images).
- 2026-05-07 — **Brownfield adoption shipped.** New `discovery:` branch in the appendage contract — alternative to `container:`/`compose:`. Block specifies `host` + `containers.match_any` (regex array). Hub gained `hub/src/ssh-discovery.js` polling each entry in `config/ssh-hosts.json` (`stoneshop`, 60s) via `ssh <alias> docker ps --format json`, surfacing the result in the same shape as agent data via `getSshDiscovery()`. Routes: `/api/appendages` matches against agent + ssh hosts; `/api/appendages/hosts` exposes the merged host list; install/uninstall on a `discovery:` appendage returns 400 with an explanation. **Stoneshop adopted:** `appendages/stoneshop.json` matches 4 `dockbase_*` containers → `installed:true`. **Mailcow adopted:** `appendages/mailcow.json` matches 7 `mailcowdockerized-*-mailcow-1` containers → `installed:true`. With this, every Phase 8 D-item (D1–D5) has a running `installed:true` path. Lifecycle on adopted appendages (restart, update, etc.) is the next step — needs SSH command-execution alongside the existing discovery poller.
- 2026-05-07 — **Real backup target wired.** Reused user's existing Hetzner storage box (`u518455.your-storagebox.de:23`); generated a dedicated keypair `id_ed25519_storagebox`, installed via stoneshop's existing pubkey access (`install-ssh-key`). Restic appendage rewritten v0.1→v0.2: snapshots only the critical paths (config.env, users.json, tokens.json, setup.json, canvas.json, website/public, /home/claude/.openclaw, /etc/caddy/Caddyfile, memory dir, IDENTITY/HEARTBEAT/USER/TOOLS.md) to dedicated repo `sftp:storagebox:backups/nest`. **First implementation of `env_from_secrets`** added on hub side as a passthrough from process.env — `RESTIC_PASSWORD` lives in `config.env` (gitignored), hub forwards via WS to agent at install time, agent injects into container. Phase 4 will replace this with age-encrypted delivery. First snapshot `832a48ba` landed on the storage box (43k files / 369 MiB). Bug fix along the way: agent's volume-handling `os.makedirs` blew up when host path was a file (`/opt/nest/config.env`); now skips mkdir if path exists. **Mailcow decision:** no mailcow on nest; outbound mail will go through the existing kaltenbach mailcow as an SMTP relay client (when implementation lands).
- 2026-05-07 — **SMTP relay live + DKIM rotation.** Created `nest@kaltenbach.dev` mailbox via mailcow API on kaltenbach (10.0.0.1, distinct from stoneshop's customer mailcow). SMTP_HOST/PORT/USER/PASS/FROM persisted in `/opt/nest/config.env`. First test mail sent from nest via Python smtplib through `mail.kaltenbach.dev:587` STARTTLS → delivered to ausfragezeichen@gmail.com; postfix log: `status=sent (250 2.0.0 OK)`. **Discovered DKIM was broken for all kaltenbach.dev outbound mail** — mailcow signing with a 2048-bit key, DNS publishing a 1024-bit key (mismatched, probably from a long-past mailcow upgrade that regenerated keys without updating DNS). Rotated mailcow to a fresh 1024-bit key (fits Hetzner DNS Robot's 255-char limit cleanly), user updated TXT record, propagation visible on Cloudflare + Google resolvers. Second test mail sent for confirmation — pending user-side header verification. Fix benefits everyone on the domain (florent@, info@, stoneshop@, nest@), not just nest.
- 2026-05-07 — **/appendages UI shipped.** New page `hub/static/appendages.html` (registered in `HUB.md` under Live topic). Renders all contracts as cards with mode badge (container/compose/discovery), status pill, install/uninstall buttons (disabled+messaged for discovery mode since brownfield is observe-only). Discovery cards also render a per-pattern match list (✓ matched container name / ✗ missing pattern). Shows the loader's `invalid[]` output up top so a broken contract surfaces immediately rather than just disappearing from the catalog. 30s auto-refresh keeps SSH-discovered status fresh.
- 2026-05-07 — **Outbound mail wired hub-side.** `hub/src/mail.js` exports `sendMail({to, subject, body})` — implementation spawns `python3` + `smtplib` (already on the box; avoids adding nodemailer or rolling raw SMTP). `hub/src/routes/mail.js` exposes `POST /api/mail/test` (admin-only) and a "Send test mail" button on `/appendages` triggers it. End-to-end verified through hub: button → POST → python3 subprocess → SMTP STARTTLS at mail.kaltenbach.dev → Gmail accepted (`status=sent 250`). `SMTP_*` env documented in `config.env.example`.
- 2026-05-07 — **Alert watchdog landed (with one painful bug).** `hub/src/alerts.js` runs every `NEST_ALERT_TICK_MS` (default 60s). Tracks per-host {connected/disconnected} and per-appendage {installed/missing/partial} in memory. State changes between *known* states fire `sendMail()` to `ALERT_RECIPIENTS`. **Bug introduced + fixed:** first version naively classified appendages on tick 1 before the agent had pushed its container list, so all appendages classified as "missing"; tick 2 saw real data, fired 5 spurious "healthy" alerts. Fix: classifier returns `null` when there's no signal (no connected agent has any containers reported yet, or for discovery, the target host hasn't been polled), and transitions involving `null` are never counted. `notify()` skips writing null-over-known so context isn't erased. Lessons: the boot-grace concept needs to wait for *meaningful* data, not just elapsed ticks. The 5 spurious mails landed in the user's inbox but failed DKIM (separate issue) so they were also discounted by Gmail.
- 2026-05-07 — **DKIM still failing despite key rotation.** Mailcow's signing private key derives byte-for-byte to the same public key DNS now publishes (verified via `openssl rsa -pubout` on the redis-stored private key, comparing against `dig +short TXT dkim._domainkey.kaltenbach.dev`). So the keys match. Yet test mail at 13:02 still showed `dkim=fail` at Gmail. Most likely cause: Gmail's internal recursive resolvers cached the old DNS record (TTL=7200) and continue using it for verification; Cloudflare 1.1.1.1 + Google 8.8.8.8 already return the new record but Gmail's MX may have a separate cache. Decision: wait up to 2 hours for cache expiry then re-test. If still failing, switch to a fresh selector (no cache history).
