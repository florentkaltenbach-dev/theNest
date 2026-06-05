# C10: Multi-source token ledger — design

> **Update (2026-06-05):** the two "unknown remaining" gaps are closed with live data.
> - **Claude (`claude-pro`)** now reads real utilization from the Anthropic unified rate-limit
>   headers that `hub/src/routes/tokens.js` already samples every 15min (persisted to
>   `data/token-claude-latest.json`). The old log-counted "50 prompts/5h researched floor"
>   estimate is gone — it produced a meaningless "0% / over floor" while the real number sat
>   unused in the sampler.
> - **Codex (`codex-pro`)** now reads real 5h/7d `used_percent` live from the ChatGPT backend
>   `GET /backend-api/wham/usage` endpoint (same token+endpoint the Codex CLI polls). Remaining
>   is no longer "unknown." Rollout-log `rate_limits` were rejected as a source — they are `null`
>   in exec mode. OpenClaw token totals remain a secondary metric.
> - Both use `cap.unit: "pct_5h"` (providers don't publish absolute caps). The `NEST_CAP_*_TOKENS`
>   envs in `config.env` are now unused and can be removed.
> - The orphan `hub/src/codex-status.js` (zero consumers, duplicated the JWT decode in `tokens.js`)
>   was deleted. OpenRouter free-model counter stays log-counted — no API exposes it (researched).
>
> **Status:** implemented (2026-05-09). Source rows use live local usage caches where available and researched/conservative plan floors when providers do not expose exact remaining quota.
> **Constraint:** user uses OAuth subscriptions + free tokens only; no pay-per-token API credits. Primary axis is *remaining capacity*. Provider-reported exact remaining quota is preferred; otherwise the ledger marks `metrics.capSource="researched-floor"`.

## Goal

A single Nest endpoint that surfaces, across every AI consumer, how much paid/free quota is *used* and how much is *remaining*. Drives `/observability` for the human, and Step 4.5's router for capacity-aware engine selection.

## Sources

Each source has the same shape; differences are in the acquisition step.

```jsonc
{
  "id": "codex-pro",                     // stable identifier
  "kind": "oauth-sub" | "free-promo" | "infra",
  "label": "Codex Pro (via OpenClaw)",
  "engine": "openclaw" | "claude-code" | "openrouter" | null,
  "period": {
    "start": "2026-05-01T00:00:00Z",     // current billing window
    "end":   "2026-06-01T00:00:00Z",
    "resetCadence": "monthly" | "weekly" | "promo-fixed-date"
  },
  "cap": {
    "unit": "tokens" | "messages" | "requests" | "usd-equiv",
    "amount": 1500000                    // null when unknown
  },
  "used": {
    "amount": 412300,
    "asOf": "2026-05-06T13:50:00Z"
  },
  "remaining": {
    "amount": 1087700,                   // cap.amount - used.amount when both known
    "percent": 72.5,
    "unknown": false
  },
  "warnings": []                         // e.g. "promo expires in 3 days"
}
```

If a cap is unknown (user hasn't told Nest yet), `cap.amount=null`, `remaining.unknown=true`. The router should treat unknown-remaining as "low confidence — avoid" rather than "infinite — prefer."

### Source list (initial)

| id | kind | acquisition |
|----|------|-------------|
| `codex-pro` | oauth-sub | Fresh OpenClaw session JSONL `message.usage` records for token totals. OAuth subscriber remaining quota is not exposed locally, so remaining stays unknown. |
| `claude-pro` | oauth-sub | TBD — Claude Code's local usage log/cache (research). Cap from `NEST_CAP_CLAUDE_PRO`. |
| `openrouter-hermes` | free-promo | Hermes `gateway.log` daily `api_calls` count for `openrouter/free`, plus OpenRouter `/credits` to choose the researched free-model daily cap (50/day normally, 1000/day after $10 purchased credits). |
| `openrouter-promo-<model>` | free-promo | OpenRouter dashboard / API (`/credits`, `/keys/<id>`). One source row per active promo with its expiry as `period.end`. |
| `nest-infra` | infra | `requests.jsonl` — for the over-spend axis on Nest's own request layer. Doesn't have a cap. |

Future sources slot in by adding a row to the same shape.

## Cap configuration

User-supplied caps live in `config.env`:

```
NEST_CAP_CODEX_PRO_TOKENS=...
NEST_CAP_CODEX_PRO_RESET_DAY=1        # day of month
NEST_CAP_CLAUDE_PRO_TOKENS=...
NEST_CAP_CLAUDE_PRO_RESET_DAY=1
```

Reset cadence is computed from `RESET_DAY` plus calendar arithmetic. If the user changes plans mid-month, they edit `config.env` and the next aggregation reflects it.

## Aggregation

Reuse the existing scripts/tasks pattern.

- `scripts/tasks/aggregate-tokens.sh` — reads each source, writes `/opt/nest/data/token-ledger.json`.
- Run on demand from the endpoint (see "Endpoint: staleness").
- Per-source readers as small helper scripts under `scripts/tasks/sources/<id>.sh` — JSON-out, no shared state. Failure of one source must not break the others.

## Endpoint

```
GET /api/observability/tokens
Authorization: Bearer <hub token>

200 OK
{
  "generatedAt": "2026-05-06T13:55:00Z",
  "sources": [ ... ],                    // array of the shape above
  "totals": {
    "remainingByEngine": {
      "openclaw":     { "fraction": 0.72 },
      "claude-code":  { "fraction": 0.40 },
      "openrouter":   { "fraction": 0.95, "expiresInDays": 8 }
    }
  }
}
```

The `totals.remainingByEngine` block is the routing input for Step 4.5 — the router can pick "engine with the highest fraction remaining" without re-aggregating.

The existing path `/api/observability/tokens` (per O6) is reused; its current single-source response is replaced by this multi-source shape.

### Staleness

Re-aggregate on read if `generatedAt` is older than 5 minutes. Same pattern as O6 today.

## Existing aggregator

`scripts/tasks/aggregate-telemetry.sh:17` currently points at `/home/claude/.openclaw/logs/telemetry.jsonl` (file doesn't exist). Either:

- Replace with `aggregate-tokens.sh` (preferred — different scope: this is multi-source quota, not waste-pct).
- Or keep both and have the observability page render them side-by-side.

Decision: **replace**, since the new shape supersedes the old. The waste-pct axis (over-spend) for hub `requests.jsonl` becomes one entry under `nest-infra`.

## Open questions for implementation

- **Claude Code usage source.** Where does Claude Code log token consumption locally? Needs investigation — likely `~/.config/claude-code/` or a similar path. If only available remotely (Anthropic API), fall back to "unknown remaining."
- **OpenRouter API key.** User needs to supply a credentials path; we read promo/credit balance from the OpenRouter API (`GET /api/v1/credits`).
- **Cap units.** Codex Pro and Claude Pro caps may not be expressible in raw tokens — could be "messages/day" or "requests/5h." Schema's `cap.unit` accommodates this; renderers must handle each unit.
- **Reset boundary precision.** Month-start at user's local time, or UTC? Pick UTC for v1; revisit if confusing.

## Out of scope

- Pay-per-token API credit tracking (excluded by user constraint).
- Forecasting / "you'll run out by day 22" projections — start with raw used/remaining, add forecasts later if useful.
- Per-call cost attribution (requires deeper instrumentation; revisit after the basic ledger is live).

## Implementation order

1. Define `config.env` keys and have user supply caps for Codex Pro + Claude Pro.
2. Implement the OpenClaw-Codex source (`scripts/tasks/sources/codex-pro.sh`). It reads fresh OpenClaw session JSONL `message.usage`; do not rely on `.usage-cost-cache.json` because it can go stale.
3. Implement the Claude Code source — research the local data path first.
4. Implement the nest-infra source (mostly a port of existing `aggregate-telemetry.sh`).
5. Wire `aggregate-tokens.sh` and replace the current `/api/observability/tokens` payload.
6. Refresh `/observability` page.
7. Add OpenRouter source once the user has an active promo.
8. Expose `totals.remainingByEngine` so Step 4.5's router can consume it.
