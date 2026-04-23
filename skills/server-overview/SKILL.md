---
name: server-overview
version: 1.0.0
triggers:
  - "how are the servers"
  - "server status"
  - "system overview"
  - "are the servers ok"
  - "what's running"
---

# server-overview

Answer questions about the health and state of every server in the nest. Reads pre-computed data from the hub — **do not fetch or compute metrics inline**. The scripts layer and the agent already push live data to the hub; your job is to read it, interpret it, and reply.

## When to use

User asks about:
- Whether servers are healthy
- CPU/RAM/disk pressure on any server
- What containers are running where
- Whether any agent has gone offline

Do **not** use this skill for:
- Starting/stopping containers (that's `container-manager`)
- Running arbitrary commands (that's `script-runner`)
- Reporting token usage (that's `token-report`)

## Inputs

None. The hub already has the data.

## How to execute

Call the hub, not the servers directly.

```
GET http://hub:3000/api/agents
Authorization: Bearer $NEST_HUB_TOKEN
```

Response shape (truncated):

```json
{
  "agents": [
    {
      "hostname": "ubuntu-4gb-fsn1-1",
      "connected": true,
      "lastSeen": 1776947000000,
      "metrics": { "cpuPct": 12, "ramPct": 44, "diskPct": 38 },
      "containers": [
        { "name": "nest-openclaw", "status": "running", "image": "ghcr.io/openclaw/openclaw:latest" }
      ]
    }
  ]
}
```

If `connected: false` or `lastSeen` is more than 90 seconds old, treat the agent as offline and say so explicitly — don't speculate about metrics.

## Output

A short natural-language summary. Rules:

- Lead with the headline: all good, one server degraded, or one server offline. One sentence.
- Follow with per-server bullets only if there's something to say. If every server is within thresholds, don't list them all.
- Thresholds: CPU >80% sustained, RAM >85%, disk >90% → flag as pressure.
- If a container is not running, name it and say which server.
- End with "Anything specific you want to dig into?" only if a threshold tripped.

## Don't

- Don't invent metrics. If the hub didn't return a field, omit it from the reply.
- Don't page the user for informational states. Only "offline agent" or "disk >95%" warrants urgent framing.
- Don't call `/api/agents/:hostname` in a loop when `/api/agents` returns them all.

## Fallback

If `/api/agents` returns 5xx or times out, reply: "Hub can't reach the agents right now. I can't give you a current picture — try again in a minute, or check `journalctl -u nest-hub` for connection errors." Do not invent a stale picture from memory.
