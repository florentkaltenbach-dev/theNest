# Nest Setup Architecture

This artifact captures the current setup flow and the target setup flow.

## Current

```mermaid
flowchart TD
  Human[Human Operator] --> Local[Local Machine]
  Human --> Server[Fresh Server]

  Local --> CFG[config.env]
  Local --> CloudInit[scripts/setup/cloud-config.yaml]
  Local --> Bootstrap[scripts/setup/bootstrap.sh]

  CloudInit --> Server
  Bootstrap --> Server

  Server --> Repo[/opt/nest repo]
  Server --> ClaudeSvc[claude-code.service]
  Server --> ClaudeCLI[Claude CLI installed]
  Server --> HubCode[Hub code present]
  Server --> AgentCode[Agent code present]

  Human -->|manual| ClaudeLogin[claude login]
  Human -->|manual| CodexInstall[install codex CLI]
  Human -->|manual| CodexLogin[codex login]
  Human -->|manual| HubDeps[npm ci and build hub]
  Human -->|manual| AppDeps[npm ci and build app]
  Human -->|manual| AgentDeps[pip install agent deps]
  Human -->|manual| HubStart[start hub]
  Human -->|manual| AgentInstall[install nest-agent.service]

  ClaudeLogin --> ClaudeCreds[/home/claude/.claude/.credentials.json]
  CodexLogin --> CodexCreds[/home/claude/.codex/auth.json]
```

## Target

```mermaid
flowchart TD
  Human[Human Operator] --> Wizard[Single setup command or wizard]

  Wizard --> Preflight[preflight checks]
  Wizard --> CloudInit[provision server]
  Wizard --> Bootstrap[bootstrap deterministic steps]
  Wizard --> Pause1[pause only if claude oauth required]
  Wizard --> Pause2[pause only if codex oauth required]
  Wizard --> Resume[resume automatically]
  Wizard --> Verify[verification]

  Bootstrap --> Server[Fresh Server]
  Server --> Repo[/opt/nest]
  Server --> ClaudeCLI[Claude CLI]
  Server --> CodexCLI[Codex CLI]
  Server --> HubBuilt[Hub built]
  Server --> AppBuilt[Web app built]
  Server --> AgentDeps[Agent deps installed]
  Server --> HubSvc[nest-hub.service]
  Server --> AgentSvc[nest-agent.service]

  Pause1 --> ClaudeCreds[/home/claude/.claude/.credentials.json]
  Pause2 --> CodexCreds[/home/claude/.codex/auth.json]

  Resume --> StateFiles[durable memory files]
  StateFiles --> SetupState[setup progress]
  StateFiles --> AuthState[auth status]
  StateFiles --> Notes[operator notes]

  NewAgent[New agent session] --> StateFiles
```

## What Changes

- Human work shrinks to a few explicit auth pauses.
- Deterministic setup moves into automation.
- Context durability moves from conversation state into files.
- Hub and agent become managed services instead of ad hoc manual starts.
