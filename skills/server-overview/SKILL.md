---
name: server-overview
description: Use when the user asks about the health or state of the Nest's servers — CPU/RAM/disk pressure, which containers are running, whether any agent has gone offline, or general "what's running" / "are the servers ok" questions. Reads pre-computed live state from the Nest hub instead of probing servers directly.
---

# server-overview

Answer questions about the health and state of every server in the Nest. Read pre-computed data from the hub — **do not fetch or compute metrics inline**. The Nest agents already push live data to the hub; your job is to read it, interpret it, and reply.

## When to use

User asks about:
- Whether servers are healthy
- CPU / RAM / disk pressure on any server
- What containers are running where
- Whether any agent has gone offline
- A general "what's the state of everything"

Do **not** use this skill for:
- Starting / stopping containers (that's `container-manager`)
- Running arbitrary commands (that's `script-runner`)
- Reporting token usage (that's `token-report`)

## Inputs

None. The hub already has the data.

## How to execute

Call the Nest hub. Auth is required.

```
GET http://127.0.0.1:3000/api/agents
Authorization: Bearer $NEST_HUB_TOKEN
```

(`NEST_HUB_TOKEN` is provisioned in OpenClaw's environment; if it isn't, see "Fallback".)

Response shape:

```json
{
  "agents": [
    {
      "hostname": "ubuntu-4gb-fsn1-1",
      "connected": true,
      "lastSeen": 1778071000000,
      "metrics": {
        "cpu": { "percent": 12 },
        "memory": { "percent": 44 },
        "disk": { "percent": 38 },
        "uptime_seconds": 86400
      },
      "containers": [
        { "name": "nest-openclaw", "status": "running" }
      ],
      "discoveredRepos": [
        { "name": "nest", "path": "/opt/nest", "dirty": false }
      ]
    }
  ]
}
```

For a single agent: `GET /api/agents/<hostname>`.

If `connected: false` or `lastSeen` is older than 90 seconds, treat the agent as offline and say so explicitly — don't speculate about metrics.

## Output

A short natural-language summary. Rules:

- Lead with the headline: all good, one server degraded, or one server offline. One sentence.
- Follow with per-server bullets only if there's something to say. If every server is within thresholds, don't list them all.
- Thresholds: CPU >80% sustained, RAM >85%, disk >90% → flag as pressure.
- If a container is not in `running` status, name it and say which server.
- End with "Anything specific you want to dig into?" only if a threshold tripped.

## Don't

- Don't invent metrics. If the hub didn't return a field, omit it from the reply.
- Don't page the user for informational states. Only "offline agent" or "disk >95%" warrants urgent framing.
- Don't loop `GET /agents/:hostname` when `GET /agents` returns them all.

## Fallback

- If `NEST_HUB_TOKEN` is unset: reply "I can't reach the Nest hub — `NEST_HUB_TOKEN` isn't set in my env. Mint one at /tokens and add it to `~/.openclaw/.env`."
- If `/api/agents` returns 5xx or times out: reply "Hub can't reach the agents right now. Try again in a minute, or check `journalctl -u nest-hub` for connection errors." Do not invent a stale picture from memory.
- If `/api/agents` returns 401: the token is invalid or expired — tell the user to mint a new one.
