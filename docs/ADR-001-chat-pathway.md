# ADR-001: Chat pathway

> **Status:** proposed, decision pending
> **Date:** 2026-04-23
> **Context:** Phase 3 C9 audit surfaced a gap between the planned architecture and the shipped code.

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

## Recommendation

**Option A**, with one caveat. The Codex-CLI path is already working and demonstrably better at the thing it does (code edits with full workspace context). Reverting it for spec purity costs real capability. Update Nest.md to reflect reality: OpenClaw becomes an *optional* conversational channel (Telegram, Slack, etc.) for workflows where that interface matters, but the primary dashboard chat talks to Codex directly. Skills become Codex-CLI-level tools or context-builder modules, not OpenClaw-side dispatchers. `IClawAdapter` stays in §5 for anyone who wants the OpenClaw integration — just no longer required.

The caveat: before committing to A, try **one** Option-C experiment post-C2 to see whether OpenClaw adds enough value (skill dispatch, telemetry) to justify the second path. If not, A is the answer.

## Decision

_Pending user review._ Once chosen, update Nest.md §7, ROADMAP C5–C10, and resolve C9's `[?]` in WORKLIST.
