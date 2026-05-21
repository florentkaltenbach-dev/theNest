---
name: token-report
description: Use when the user asks about AI token usage, quota, remaining capacity, free credits, prompt windows, OpenClaw/Codex/Claude/Hermes capacity, or "how much quota is left". Reads the Nest token ledger from /api/observability/tokens and summarizes the current capacity picture.
---

# token-report

Report current AI capacity and token/quota usage from the Nest token ledger. Read
the precomputed ledger from the hub; do not inspect raw session logs inline.

## When to use

Use this skill when the user asks about:
- Remaining AI capacity or quota
- Claude/Codex/OpenClaw/Hermes token usage
- OpenRouter free-model or promo credit status
- Whether an engine is close to a limit
- Token waste or unusually high request error rate

Do **not** use this for:
- Server CPU/RAM/disk/container health (that's `server-overview`)
- Running arbitrary maintenance scripts (that's `script-runner`)
- Starting/stopping containers (that's `container-manager`)

## How to execute

Call the Nest hub:

```sh
set -a
. /home/claude/.openclaw/.env
set +a
curl -sS -H "Authorization: Bearer ${NEST_HUB_TOKEN:?}" \
  http://127.0.0.1:3000/api/observability/tokens
```

Never echo, print, summarize, or paste the token itself.

## Response shape

The endpoint returns:

```json
{
  "generatedAt": "2026-05-21T16:14:08+00:00",
  "sources": [
    {
      "id": "claude-pro",
      "label": "Claude Max 5x (Claude Code)",
      "engine": "claude-code",
      "cap": { "unit": "prompts_5h", "amount": 50 },
      "used": { "amount": 432, "asOf": "..." },
      "remaining": { "amount": 0, "percent": 0, "unknown": false },
      "metrics": {},
      "warnings": []
    }
  ],
  "totals": {
    "remainingByEngine": {
      "hermes": { "fraction": 1, "sources": 1 }
    }
  }
}
```

`sources[]` is authoritative. `totals.remainingByEngine` is a routing summary
only and omits unknown remaining capacity.

## Output

Lead with one compact headline:
- "Hermes has the clearest remaining capacity; Claude is at/over its conservative floor; Codex remaining is unknown."
- "All tracked sources have comfortable remaining capacity."
- "One tracked source is at a limit and one source has elevated request waste."

Then include only useful bullets:
- For each quota source, show `label`, used, remaining, unit, and warning status.
- If `remaining.unknown == true`, say remaining is unknown and explain why if a warning says so.
- For `nest-infra`, report request count and `metrics.wastePct` when present. Flag waste above 5%.
- Mention `generatedAt` if the user asks whether data is fresh or if it is older than 5 minutes.

Keep the answer short. Do not dump JSON unless the user explicitly asks.

## Thresholds

- Remaining percent <= 10%: call it near exhausted.
- Remaining percent <= 25%: call it low.
- Unknown remaining: call it unknown, not healthy.
- `nest-infra.metrics.wastePct > 5`: flag request waste.
- Any warning in a source should be summarized once, not copied verbatim unless it is short and essential.

## Fallback

- If `NEST_HUB_TOKEN` is unavailable after sourcing `/home/claude/.openclaw/.env`: reply "I can't reach the Nest hub — `NEST_HUB_TOKEN` isn't available in `/home/claude/.openclaw/.env`. Mint one at /tokens and add it there."
- If `/api/observability/tokens` returns 5xx or times out: reply "The token ledger could not regenerate right now. Try again in a minute, or check `scripts/tasks/aggregate-tokens.sh` and `journalctl -u nest-hub`."
- If the response has no `sources[]`: say the ledger returned no sources; do not invent usage.
