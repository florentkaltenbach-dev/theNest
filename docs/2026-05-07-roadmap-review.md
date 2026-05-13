# Roadmap review — 2026-05-07

> Edit this file in place. Replies inline (after `→` on the question line, or in the boxed area). I'll read and update ROADMAP.md / WORKLIST.md to reflect your decisions.

## State of play after today's commit (`017fa0b`)

- **Phase 1** complete (since 2026-03-25).
- **Phase 2** complete. Token ledger replaced single-source telemetry. C10 graduated from `[/]` to `[x]`.
- **Phase 3** effectively closed today. Step 4 cleared its REASSESS gate. C5 ✓, C9 retired, C10 ✓, Telegram channel ✓.
- **Phase 5** mid-air. Schema gained `compose:` and `discovery:` branches. Loader/validator hand-rolled (no new deps). Greenfield `install_appendage` + `install_compose_appendage` + idempotent `remove_*` work. SSH-driven brownfield discovery shipped (`hub/src/ssh-discovery.js`).
- **Phase 8** all five D-items report `installed:true`. D1/D5 brownfield-adopted on stoneshop; D2/D3/D4 greenfield on nest.
- **Outbound mail** wired (kaltenbach mailcow as relay; no second mailcow on nest). Alert watchdog mails on state transitions. DKIM rotation in flight (Gmail cache TTL).

What molted today, vs. what was originally planned:

| Originally planned | What actually happened | Why |
|---|---|---|
| D1 mailcow as fresh install | Brownfield-adopted via SSH discovery | The user already runs mailcow on kaltenbach; reinstalling would be cargo-culting |
| D5 WooCommerce as fresh install | Brownfield-adopted via SSH discovery | Same — stoneshop is live customer infra |
| D3 Restic blocked on "scheduled-execution primitive" | Shipped via lobaro/restic-backup-docker (cron baked into image) | The schema didn't need extension; community image solved it |
| Multi-container D-items blocked | `compose:` branch added | Realised this was generic infra, not D-specific |
| Single mailcow for all needs (incl. nest's outbound) | Nest will be SMTP client of kaltenbach mailcow | Saves RAM + duplicate DNS/DKIM/DMARC work |
| Phase 4 secrets needed for any password handling | `env_from_secrets` shipped as plaintext passthrough on hub | Lets us close D3 today; Phase 4 still wanted but isn't a hard blocker |
| /appendages page deferred to "Phase 6 polish" | Shipped today as pragmatic A4/A5 cut | Curl-only access felt obviously wrong once we had 9 contracts |

What emerged today that was NOT in any roadmap:

- SSH-driven discovery + (someday) lifecycle execution as a permanent peer to the agent-WS path
- Hub-side outbound mail helper + alert watchdog
- Backup target reuse pattern (storage box has multiple repos, one per server)
- Mailcow API as a tool the hub could leverage (we used it manually; could automate)

---

## Section A — Strategic questions

### A1. Primary purpose, today (you can pick more than one)

- [ ] Manage my Hetzner fleet (servers, appendages, lifecycle)
- [ ] Personal automation hub (cron, mail, scripts, scheduled work)
- [ ] Chat-driven ops (talk to OpenClaw, route across LLMs by capacity)
- [ ] Observability & cost control across my AI subscriptions
- [ ] Self-hosting platform for stoneshop & future client work
- [ ] Other →

→

### A2. Who uses Nest?

- [ ] Just me, indefinitely
- [ ] Me now, but designed so a small team could join later
- [ ] Me + occasional collaborators with read-only access
- [ ] Other →

→

### A3. Time horizon for "v1.0" (per the milestone table at the bottom of ROADMAP.md)

- [ ] End of May 2026
- [ ] End of June 2026
- [ ] When it's done — no fixed date
- [ ] Reframe v1.0 — see A4

→

### A4. What does "v1.0" actually mean now? (The milestone table says "Full Nest.md vision realized, Dockbase appendages". Today's reality is different from that vision in ways the table doesn't reflect — e.g. brownfield > greenfield for D1/D5.)

→ Free text:

```


```

---

## Section B — Per-step reconsider

For each open or partial item, choose: **keep** / **drop** / **reframe** (and explain). Comment if any.

### Step 4.5: Custom Nest chat interface + multi-engine router

Original plan: pick a "second scaffold" peer to OpenClaw (Hermes-shape), build a router that picks engine based on remaining capacity from C10 ledger.

- [ ] Keep as planned
- [ ] Drop — OpenClaw + direct Codex/Claude is enough; no router needed
- [ ] Reframe — model selection inside *one* OpenClaw session (no second scaffold)
- [ ] Defer — revisit after a few weeks of using OpenClaw alone

→ Comment:

```


```

### Step 5: skill fan-out (C6/C7/C8)

C6 container-manager, C7 script-runner, C8 token-report.

- C7 (script-runner): we now have hub-side SSH command execution coming. Does C7 still need to be a *skill*, or just a hub endpoint that OpenClaw could call?
  - [ ] Keep as skill
  - [ ] Hub endpoint only
  - [ ] Both
  - → 
- C8 (token-report): C10 ledger + `/observability` page already render this. Does C8 add value as a skill, or is the page sufficient?
  - [ ] Keep as skill (chat-friendly summarisation)
  - [ ] Drop — page is the answer
  - [ ] Replace with daily summary email (use today's mail wiring)
  - → 
- C6 (container-manager): no skill exists yet. Still wanted?
  - [ ] Yes, ship it
  - [ ] Drop — `/appendages` page covers it
  - [ ] Reframe — narrower scope (e.g. logs only)
  - → 

### Phase 4: age-encrypted secrets (E1–E7)

Today `env_from_secrets` is a plaintext passthrough from hub's `process.env` to the agent's container. Works, but the hub sees plaintext.

- [ ] Full original scope (client-sealed, hub never sees plaintext, agent decrypts)
- [ ] Trim — encrypt-at-rest on disk, hub still touches plaintext at relay (simpler, partial)
- [ ] Defer — config.env + .gitignore is fine for personal use, revisit when collaborators arrive
- [ ] Reframe — "phone-based secret manager" referenced in memory becomes the spec

→ Comment:

```


```

### Phase 5 leftovers — A4, A5, A8, A9

- A4 wizard.steps form rendering — no contract uses it today.
  - [ ] Keep, write one example contract that uses it (which? mailbox creation? app-specific?)
  - [ ] Drop until a contract needs it
- A5 logs surfacing — `agent appendage_logs` command + UI panel.
  - [ ] Yes
  - [ ] Defer until I actually want logs from /appendages
- A8 git discovery — A7 (`discovery.py`) already does git-repo enumeration.
  - [ ] Drop A8, fold note into A7
  - [ ] Keep A8 as a separate richer view (commits, branches)
- A9 peer APIs — `consumes`/`apis` in the schema.
  - [ ] Keep — service mesh between appendages
  - [ ] Drop — compose internal networks already do this
  - [ ] Defer until a use case needs it

→ Comment:

```


```

### Phase 6: Client experience

- U5 distinctive UI — "European aesthetic, coding agent designs freely". Today's pages use `system-ui` and a navy/white palette — clean but not distinctive.
  - [ ] Yes — pick a vibe (palette? typography? motion?)  → 
  - [ ] Drop — boring-but-functional is fine for a personal tool
  - [ ] Defer
- U6 i18n English+German.
  - [ ] Yes  → which pages first?
  - [ ] Drop — single user, you read English fine
  - [ ] Defer
- U7 push notifications.
  - [ ] Yes  → web push on laptop or phone-native?
  - [ ] Drop — email alerts (today's wiring) cover this
  - [ ] Both
- U8 passkey/WebAuthn unlock.
  - [ ] Yes
  - [ ] Drop
  - [ ] Defer
- U9 native builds (TestFlight / Android).
  - [ ] Yes
  - [ ] Drop — PWA on iOS/Android via the existing pages is enough
  - [ ] Defer

→ Comment:

```


```

### Phase 7: Infrastructure

- I1/I2 Caddy API + auto-TLS per appendage. No appendage today declares public routes that aren't manually wired.
  - [ ] Yes — wire when first appendage needs HTTPS publicly
  - [ ] Drop — Caddyfile by hand is fine
  - [ ] Defer
- I3/I4 git webhook + deploy from chat.
  - [ ] Keep — one of the more "magical" features
  - [ ] Drop — local push + manual `systemctl restart` is fine
  - [ ] Defer
- I5/I6 multi-server appendage placement.
  - [ ] Keep — needed if you ever scale past one nest
  - [ ] Drop — single nest is the model
  - [ ] Defer
- I7 log retention archival.
  - [ ] Keep
  - [ ] Drop — current 5MB cap with rotation is enough
  - [ ] Defer
- I8 alerting via push notification. Today's mail watchdog covers transitions.
  - [ ] Replace plan with: extend mail watchdog (more rules) — no push needed
  - [ ] Add push on top of mail
  - [ ] Drop — mail is enough

→ Comment:

```


```

### Phase 8 — what does "done" mean now?

Today: D1–D5 all report `installed:true`. But D1/D5 are observe-only; we can't restart their services from nest. D2/D4 are greenfield-running but with caveats (D2 missing Matomo extension, D4 in local-only mode).

Pick one:

- [ ] **Phase 8 done.** All D-items have a hook into nest; lifecycle is a Phase 7-ish concern (alerting, ops) and gets tracked there.
- [ ] **Phase 8 has a "lifecycle" wave.** Add D6 (operate adopted appendages from hub via SSH) before calling Phase 8 done.
- [ ] **D2/D4 need extending.** Matomo + CrowdSec central enrollment need to land before Phase 8 closes.
- [ ] **Other →**

→ Comment:

```


```

---

## Section C — Newly emerged scope (decide whether to track)

These items emerged from today's work and aren't in any phase. Each gets: keep / drop / where it lives.

### C1. SSH command execution for adopted hosts

Hub-side helper: `runOnHost(alias, cmd) → {stdout, stderr, code}`. Powers restart/update buttons on `/appendages` discovery cards. Mirrors the `ssh-discovery.js` poller architecture.

- [ ] Keep, add as Phase 5 follow-on (call it A10)
- [ ] Keep, slot under Phase 7 (infrastructure / fleet ops)
- [ ] Drop — manual `ssh stoneshop docker compose ...` is fine
- [ ] Reframe →

→

### C2. Mailcow management automation

Today we manually inserted an API key in the mailcow DB to provision a mailbox + rotate DKIM. The same hub could automate: mailbox-per-appendage, DKIM rotation alert, mailbox quota monitoring.

- [ ] Keep — high leverage, especially if more services need their own mailbox
- [ ] Drop — manual-as-needed is fine
- [ ] Defer

→

### C3. DNS automation

Hetzner DNS Robot's 255-char limit cost time today. Hetzner DNS Console (separate product) has an API. A small `nest dns set <record>` would short-circuit future "edit a TXT record" tasks.

- [ ] Keep — useful for DKIM, ACME challenges, future appendage routes
- [ ] Drop — DNS edits are rare enough
- [ ] Defer

→

### C4. Daily summary email

Use today's mail wiring to send a daily digest: recent backups, alerts fired, new commits, token-ledger snapshot.

- [ ] Keep, cron-driven via scripts/tasks/
- [ ] Drop — alerts on state-change are enough
- [ ] Reframe — only on-demand via /api/mail/digest

→

### C5. Phone-based secret manager

Per memory: "phone-based secret manager planned later". Now that we have working SMTP + storage box + age-decryption-on-agent (planned), the phone could be the bootstrap path: scan QR → unlock secrets on hub.

- [ ] Yes — design as a v0.5 thing alongside Phase 4
- [ ] Defer — Phase 4 first, secret-manager second
- [ ] Drop — local config.env is fine forever

→

### C6. Dev-server iteration on stoneshop UI

You mentioned: "iterate on a local copy on the dev server to tinker with the UI". Could be a separate workflow: clone stoneshop on `ssh dev`, run compose with mounted UI volumes for hot-reload, proxy via `dev.kaltenbach.dev` or similar.

- [ ] Keep — its own slice, schedule when stoneshop UI work is needed
- [ ] Drop — out of scope for nest itself
- [ ] Belongs in stoneshop's repo, not nest's

→

---

## Section D — Priorities

### D1. Top 3 for next session (pick 3, ordered)

- [ ] Lifecycle for SSH-adopted appendages (restart/update buttons on /appendages)
- [ ] Phase 4 secrets (some scope per Section B)
- [ ] Step 4.5 multi-engine chat router design + first cut
- [ ] Step 5 skill fan-out (C6/C7/C8 or whatever survived Section B)
- [ ] Phase 6 U5 distinctive UI
- [ ] Phase 7 I1/I2 Caddy auto-config
- [ ] DKIM verification + cleanup once cache expires
- [ ] Daily summary email (C4 above)
- [ ] DNS automation (C3 above)
- [ ] Mailcow management automation (C2 above)
- [ ] Other →

1. 
2. 
3. 

### D2. Anything to drop entirely?

→

### D3. Anything that's BLOCKED on something I (the user) need to do, that I should do now?

→

---

## Section E — Honest pushback

A few places I think the current plan needs explicit pushback (you can override):

1. **C5 phone-based secrets is huge.** It's its own product. If we're going there, it dwarfs Phase 4. Worth deciding *before* starting Phase 4 whether the Phase 4 scope is "encrypt locally" or "encrypt with phone bootstrap."
2. **U9 native builds** in a one-user single-server context is a lot of infrastructure (Apple Developer account, code signing, TestFlight, Google Play console) for marginal benefit over PWA. Strongly suggest dropping unless you actually want a native installable app.
3. **Step 4.5 with a "second scaffold"** — Hermes-or-equivalent was always TBD. Two months later, you're using OpenClaw and Claude Code directly. The router may be solving a problem you no longer have. The capacity ledger (C10) is independently useful for visibility regardless of whether a router consumes it.
4. **A9 peer APIs** — appendages on the same docker network already have hostname resolution. The schema's `consumes`/`apis` adds an abstraction layer that may not pull its weight. Suggest dropping unless a concrete cross-appendage call appears.
5. **I3/I4 deploy-from-chat** — if you push commits and `systemctl restart nest-hub` from a terminal, that's 5 seconds. Webhook + chat command might be ~2 weeks of work for a small ergonomic win. Optional.

→ Reactions:

```


```
