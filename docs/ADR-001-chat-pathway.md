# ADR-001: Chat pathway

> **Status:** superseded (2026-05-06) — see "Supersession" at end.
> **Original status:** accepted (Option C, reframed) on 2026-04-23.
> **Context:** Phase 3 C9 audit surfaced a gap between the planned architecture and the shipped code.

## Decision

**Both backends coexist. A custom Nest chat interface will route between them; design deferred.**

- **Codex CLI** stays as the hub-context / write-mode backend. `chat.js` as shipped.
- **OpenClaw** stays as the skills/molts + multi-channel backend. Authenticated via C2, reachable at `/claw/`.
- **Above both**: a Nest-owned interface decides which engine handles a given request. Not yet designed (open thread in Nest.md §15).

Earlier options A (adopt direct-Codex only) and B (revert and build WebChat proxy) are not chosen. A would lose OpenClaw's skill/channel capabilities; B would lose Codex CLI's workspace-write UX. The two are *different tools*, not competing chat implementations.

## Consequences

- **C9 stays `[x]`** — but its meaning is narrowed: "Codex backend is live." A parallel `C9b` (OpenClaw backend wired into the custom interface) will be needed post-C2. ROADMAP and WORKLIST reflect this.
- **Nest.md §7 stays valid** for the OpenClaw path. §7 is amended to note that OpenClaw is *one* backend, not *the* backend.
- **Nest.md §15 gets a new open thread:** "Chat backend routing — how does the Nest interface pick Codex vs OpenClaw for a given request? User preference, task type, explicit selection?"
- **C2, C3, C5, C10 proceed as planned.** They bring OpenClaw online; that's still a prerequisite for skills and telemetry.
- **Custom chat interface** is a new scope item, placeholder in WORKLIST. Design conversation after a week of running both engines, when we know what each is good at.

## Planned (Nest.md §7 + ROADMAP C9)

OpenClaw is "the conversational interface." All chat flows through it.

- Browser hits `/claw/` → Caddy → OpenClaw WebChat on `:18789` → LLM → reply.
- The hub's `/api/chat/send` is **a proxy** into OpenClaw's WebChat channel.
- Skills live in OpenClaw (`skills/*/SKILL.md`). OpenClaw dispatches them based on user intent.
- Telemetry comes out of OpenClaw at `/home/claude/.openclaw/logs/telemetry.jsonl`.

This is the `IClawAdapter` interface in Nest.md §5: `webChatUrl()`, `registerSkill()`, `send()`.

## Built

`hub/src/routes/chat.js` bypasses OpenClaw entirely.

- `POST /api/chat/send` → `execFile("codex", [...])` → direct Codex CLI call (model `gpt-5.4`).
- Context is *injected* inline: live agent metrics, Hetzner server list, last ~20 messages of history.
- Response parsed out of Codex CLI's streamed output.
- Supports a `/apply` write mode that lets the model edit files under `/opt/nest`.
- **Skills are not invoked.** There is no dispatch step. The model sees the injected context and the user message; that's it.

The WebChat route `/claw/` is wired in Caddy (C4), and the OpenClaw gateway is running (C1) — but neither is on the critical chat path today.

## Why this matters

The two paths produce different systems, not just different backends.

| Dimension | Direct Codex CLI (built) | OpenClaw WebChat proxy (planned) |
|-----------|--------------------------|----------------------------------|
| Where chat runs | Hub process, spawning `codex` per message | OpenClaw gateway, persistent |
| Skill dispatch | None — context injection only | OpenClaw routes to `skills/*/SKILL.md` |
| Telemetry | Hub request log only | `~/.openclaw/logs/telemetry.jsonl` (C10 seam) |
| Works without gateway auth | Yes (Codex CLI has its own auth) | No — blocked on C2 |
| Matches `IClawAdapter` | No — adapter is unused | Yes |
| Matches Nest.md §7 routing example | No — no appendage dispatch | Yes |

## Implications of picking one

### Option A — Adopt the direct-Codex path

Update the spec to reflect what's shipped.

- Nest.md §7 rewrites: OpenClaw is *not* the chat router. It becomes a peer conversational UI (optional) for workflows that benefit from channels/Telegram/etc.
- `IClawAdapter` in §5 becomes optional or is removed.
- Skills need a new home. The `server-overview` SKILL.md and its siblings become instructions embedded in chat.js's context builder, or become tools exposed to Codex's tool-calling.
- C5 changes shape: "the first real skill" is no longer an OpenClaw concept.
- C10 telemetry bridge can be deleted or retargeted at hub request logs only.
- C6/C7/C8 are re-specified or cancelled.

Pro: The shipped system keeps working. No migration. Codex CLI is a high-quality modern agent loop with its own tool support.
Con: The Nest.md "OpenClaw routes intents to appendages" vision (§7 routing example) is abandoned. The `molt` abstraction (appendages contributing skills) loses its delivery mechanism.

### Option B — Revert C9 and build the WebChat proxy

Mark C9 `[ ]`, rebuild `chat.js` as an OpenClaw client.

- After C2, `chat.js` POSTs to OpenClaw's WebChat send endpoint with a gateway token.
- The Codex-CLI code is either deleted or kept as a fallback when OpenClaw is down.
- Skills land in OpenClaw as designed. C5–C8 run end-to-end through the gateway.
- `/apply` write mode needs a home — either OpenClaw has an equivalent, or we add a hub-side tool that the gateway can call.

Pro: Spec is preserved. Appendages (Phase 5) can register skills with a natural host. IClawAdapter is the contract.
Con: Rework. Live chat breaks briefly. Must re-implement `/apply` on OpenClaw side or keep a hybrid. Codex CLI's better UX may not transfer.

### Option C — Hybrid: OpenClaw for chat, Codex CLI for code-writing

Route normal chat through OpenClaw (for skill dispatch, telemetry, channels). Keep Codex CLI as a distinct `/apply` endpoint for write operations the user triggers explicitly.

Pro: Best of both. Matches how humans actually work (conversation ≠ coding).
Con: Two auth flows. Two telemetry streams. UI has to know which mode it's in.

## Recommendation (historical — superseded by decision above)

Earlier draft of this ADR recommended Option A with a post-C2 Option-C experiment. User reframed Option C: both backends coexist as *tools*, and a custom Nest interface routes. This reframing removes the wastefulness objection to C (no duplicated chat pathway — different jobs) and is now accepted.

## What to do next (derived from the decision)

- [x] ADR status flipped to accepted (this commit).
- [ ] Nest.md §7 amended to note OpenClaw is one backend, not the only one.
- [ ] Nest.md §15 gets a new open thread on chat backend routing.
- [ ] WORKLIST: C9 `[?]` → `[x]` with "Codex backend" note. Add placeholder for the custom interface.
- [ ] ROADMAP: C9 `[?]` → `[x]` with same note. Flag C9b as follow-up (OpenClaw backend wiring, post-C2).
- [ ] `REASSESS` after C2: spend a week using both engines. Only then scope the custom-interface router.

## Supersession (2026-05-06)

This ADR is superseded. Once C2 (OpenClaw OAuth) landed, the planned "two coexisting backends" collapsed: OpenClaw reaches Codex via the same OAuth, so the `chat.js` direct-CLI path was the same backend twice. The Nest-context advantage of `chat.js` (live agent state, Hetzner snapshot in the system prompt) is more naturally delivered by **C5 server-overview skill** — OpenClaw fetches the same context on demand via Nest's API.

Cleanup performed 2026-05-06:
- Deleted `hub/static/claw.html` and `hub/src/routes/chat.js`.
- Removed `chatRoutes(api)` and the `/claw` row from `HUB.md` page table + service map.
- Lifted the reusable Codex auth introspection into `hub/src/codex-status.js` for C10's quota tracker.
- Nest.md §7 rewritten to reflect OpenClaw-only backend.

The future Nest-owned router (Step 4.5 in WORKLIST) is **not** what this ADR described. It picks among **agent scaffolds** (OpenClaw + a TBD second one like Hermes), not among LLM backends, and routes capacity-aware to maximize free/flat-quota utilization. A new ADR will document that decision when scope solidifies.
