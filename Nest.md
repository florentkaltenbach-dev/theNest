# Nest 🪺

> A self-hosted platform managed from a mobile or web client. Small core, pluggable appendages.

---

## Purpose of this document

Build specification for a coding agent. Contains all architectural decisions (63 total), interface definitions, repository structure, and a dependency graph. Open threads are flagged explicitly. The coding agent should follow the dependency graph, not a linear sequence.

**Origin:** This design evolved from a bash-based deploy system ([stoneshop](https://github.com/florentkaltenbach-dev/stoneshop) — two-phase bootstrap with config.env) into a full platform. Nest replaces manual SSH workflows, local CLI tools, and bash deploy scripts with a unified client application and server-side automation.

---

## 1. Overview

Nest is a mobile-first platform for managing servers, AI agents, and services. Users install the client application (iOS, Android, or web — single Expo codebase), connect a server provider, and build infrastructure by adding appendages: mail servers, websites, coding agents, chat assistants, backups, and more.

The client dispatches commands and can disconnect. All server-side components operate autonomously after initial configuration. The client is not required for ongoing operation.

### Core (always present)

| Component | Role |
|-----------|------|
| **Client app** | Holds all secrets and credentials. Dispatches configuration and commands. Built with Expo (iOS + Android + web from one TypeScript codebase). |
| **Hub** | Runs on one server. Relays messages, proxies traffic, executes cached scripts. Stateless — stores no secrets except one SSH key pair. No database. |
| **Agent** | Runs on every managed server. Reports metrics, manages containers, caches encrypted secrets, manages appendage lifecycle. Python daemon under systemd. |
| **OpenClaw** | Conversational interface. Routes user intents to the appropriate appendages. Operates fully without the client connected. |

### Appendages (pluggable, networked peers)

Appendages communicate via API. There is no dependency tree. If a peer appendage is unavailable, API calls fail gracefully.

| Category | Examples |
|----------|----------|
| Tooling | GitHub browser, Claude Code, deploy, backup, documentation |
| Services | Mail server, website, webshop, any Docker container |
| Future | Local fine-tuned models (Ollama), community marketplace |

Each appendage consists of: an OpenClaw skill (chat triggers) + a Docker container (runtime) + a config schema (setup wizard rendered in the client).

---

## 2. Current state

- 4 servers across 2 projects on an existing provider
- OpenClaw running on one server (currently accessed via SSH tunnel to WebChat on port 18789)
- Various projects and containers deployed
- Operator uses Claude Code CLI with OAuth on Windows (PowerShell)
- Manual SSH access to servers
- A domain is available for the dashboard

Nest replaces: manual SSH, local CLI tools, SSH-tunneled WebChat, bash deploy scripts. After Nest: everything is managed from the client application or through OpenClaw chat.

---

## 3. Customer journeys

### Journey 1: Administrator

```
Install client app
  → Set passphrase (derives age encryption key)
  → Enable biometric unlock
  → Connect server provider → enter API token
  → Client queries provider API directly → discovers existing servers
  → Select hub server → client installs hub + agent via SSH
  → Existing OpenClaw instance detected → migrated to reverse proxy
  → Add appendages via guided wizards (Claude Code, website, etc.)
  → Issue tasks via OpenClaw: "update the homepage title"
    → GitHub appendage locates relevant files
    → Claude Code appendage implements the change
    → Deploy appendage rolls out the update
    → Push notification confirms completion
```

### Journey 2: Invited user (customer)

```
Administrator generates invitation link
  → Customer installs client app
  → Opens link → pre-configured hub connection, restricted permissions
  → Sets own password
  → Views servers, services, status
  → Can trigger deploys, view logs, interact with OpenClaw, restart services
  → Cannot manage encryption keys, provision servers, or create invitations
  → Administrator retains full access
```

### Future journeys (open threads)

- Team access with granular role-based permissions
- Migration from existing hosting providers
- Horizontal scaling across multiple servers
- Third-party appendage development and publishing
- In-app onboarding and visual documentation

---

## 4. Architecture

### Single-server deployment (v1)

All components run on one server. Containerized with Docker. The network mesh (WireGuard) is pre-installed for future multi-server scaling.

Server requirements are not fixed — the client app recommends a server size based on the sum of minimum requirements declared by selected appendages.

```
Client app (iOS / Android / web)
  │
  │  HTTPS + WebSocket
  │
  ▼
┌─────────────────────────────────────────────┐
│ Server                                      │
│                                             │
│  ┌─────────┐    ┌─────────┐                 │
│  │   Hub   │◄──►│  Agent  │                 │
│  │ (relay) │    │ (local) │                 │
│  └────┬────┘    └────┬────┘                 │
│       │              │                      │
│  ┌────┴──────────────┴────────────────┐     │
│  │ Docker                             │     │
│  │                                    │     │
│  │  OpenClaw                          │     │
│  │  Claude Code                       │     │
│  │  Services (mail, web, shop, ...)   │     │
│  │  (appendages, added via client)    │     │
│  └────────────────────────────────────┘     │
│                                             │
│  Reverse proxy (IProxy, auto-TLS)           │
│  Network mesh (INetwork, for multi-server)  │
└─────────────────────────────────────────────┘
```

### Trust model

```
CLIENT APP:
  Holds: age private key, all secrets, provider API tokens
  Calls: server provider API directly (hub never receives provider tokens)
  Required for: adding new secrets, provisioning new servers, inviting users
  Not required for: ongoing operation of deployed services and agents

HUB:
  Holds: one SSH key pair (for script execution on managed servers)
  Stores: no secrets, no tokens, no database
  Does: relay messages, proxy traffic, execute cached scripts
  Fully operational when client is disconnected

AGENT:
  Holds: own age key pair, cached encrypted-for-me secret blob
  Does: decrypt own secrets locally, inject into containers, restart crashed services
  Fully operational when client is disconnected (uses cached secrets)
  Receives new secrets: requests from client via hub (hub relays opaque encrypted blob)

OPENCLAW:
  Fully operational when client is disconnected
  Uses cached state, indicates data staleness when applicable
  Routes tasks to available appendages

CLAUDE CODE:
  Unrestricted filesystem access, including the Nest source tree
  No approval gates on code modifications
  Interacts with GitHub through the GitHub appendage (orchestrated by OpenClaw)
```

### Secret lifecycle

```
New secret:
  Client encrypts with target server's age public key
    → sends encrypted blob to hub (HTTPS)
    → hub relays without reading → server agent receives
    → agent caches encrypted blob on disk
    → agent decrypts with own age private key
    → injects as environment variable into Docker container

Unattended restart (client offline):
  Container process exits
    → agent detects via Docker API
    → reads cached encrypted blob from disk
    → decrypts with own key → restarts container with secrets

Revocation:
  Client re-encrypts secrets without target server's public key
    → pushes updated blob → server's cached copy becomes stale
    → server can no longer decrypt on next restart

Backup:
  Client exports all secrets as one encrypted file
    → save to USB / external storage / cloud
    → restore: import into new client install + enter passphrase
```

### Data storage (no database)

| Data | Location | Format |
|------|----------|--------|
| Server inventory, metrics | Provider API (client queries directly) | Live API calls |
| Container status, resource usage | Docker API on each server (via agent) | Live queries |
| Project/appendage definitions | `projects.yaml` in git repository | Version-controlled YAML |
| Display names, labels, preferences | `config.yaml` in git repository | Version-controlled YAML |
| Automation scripts | Git repository, cloned on hub | Files |
| Encrypted secrets | Client device + server agents | age-encrypted file (NOT in git) |
| Script execution logs | Log files on hub disk | Append-only files |
| Monitoring snapshots | Log files on hub disk | Tiered: frequent metrics summarized at intervals, daily rollups |
| Auth sessions | In-memory on hub + device secure storage | Ephemeral |
| Audit trail | Git commit history + log files | Immutable |

**Monitoring log retention:** 7 days detailed snapshots, 30 days daily summaries, then deleted. Snapshot frequency is tiered by data type (fast-changing metrics more frequent than slow-changing inventory).

---

## 5. Interfaces

Every component is behind a swappable interface. The v1 implementation is listed. Any implementation can be replaced without modifying other components.

### IProxy

Routes HTTPS traffic to hub API, client dashboard, OpenClaw WebChat, and appendage web interfaces.

```typescript
interface IProxy {
  addRoute(host: string, path: string, target: string): Promise<void>
  removeRoute(host: string, path: string): Promise<void>
  listRoutes(): Promise<Route[]>
  enableTLS(domain: string): Promise<void>
  status(): Promise<{ healthy: boolean; uptime: number }>
}
// v1: Caddy
```

### IRepoSync

Synchronizes the hub's local clone of the public git repository.

```typescript
interface IRepoSync {
  clone(repoUrl: string, localPath: string): Promise<void>
  pull(localPath: string): Promise<{ newCommits: number }>
  onWebhook(payload: WebhookPayload): Promise<void>
  listFiles(localPath: string, subdir?: string): Promise<FileEntry[]>
  readFile(localPath: string, filePath: string): Promise<string>
  log(localPath: string, limit?: number): Promise<Commit[]>
}
// v1: git CLI wrapper
```

### IScriptRunner

Executes scripts on target servers via SSH. Does not transmit secrets — servers decrypt their own.

```typescript
interface IScriptRunner {
  run(opts: {
    scriptPath: string,
    targetServer: ServerId,
    env?: Record<string, string>,
    timeout?: number
  }): Promise<RunId>
  onOutput(runId: RunId, cb: (line: string) => void): void
  status(runId: RunId): Promise<RunStatus>
  cancel(runId: RunId): Promise<void>
  history(opts?: { server?: ServerId, limit?: number }): Promise<RunRecord[]>
}
// v1: SSH via node-ssh
```

### IServerProvider

Discovers and manages servers. Executed by the client application directly, never by the hub.

```typescript
interface IServerProvider {
  discoverAll(): Promise<DiscoveredServer[]>
  metrics(serverId: string): Promise<ServerMetrics>
  create(opts: {
    name: string, type: string, location: string, image: string
  }): Promise<DiscoveredServer>
  destroy(serverId: string): Promise<void>
  serverTypes(): Promise<ServerType[]>
  locations(): Promise<Location[]>
  setFirewall(serverId: string, rules: FirewallRule[]): Promise<void>
  snapshot(serverId: string, label: string): Promise<SnapshotId>
}
// v1: Hetzner Cloud API (or any provider implementing this interface)
```

### IClawAdapter

Proxies the OpenClaw WebChat interface and manages appendage skill registration.

```typescript
interface IClawAdapter {
  status(): Promise<{
    running: boolean, version: string,
    uptime: number, connectedChannels: string[]
  }>
  webChatUrl(): string
  registerSkill(skill: ClawSkill): Promise<void>
  listSkills(): Promise<ClawSkill[]>
  send(message: string): Promise<string>
  restart(): Promise<void>
}
// v1: OpenClaw WebChat proxy
```

### INetwork

VPN mesh connecting managed servers. Pre-installed on v1 single-server deployment, activated when scaling to multiple servers.

```typescript
interface INetwork {
  addPeer(opts: {
    name: string, publicKey: string, endpoint: string
  }): Promise<PeerConfig>
  removePeer(name: string): Promise<void>
  peers(): Promise<Peer[]>
  ping(name: string): Promise<{ latency: number; reachable: boolean }>
  selfConfig(): Promise<NetworkConfig>
  sshTarget(peerName: string): { host: string; port: number }
}
// v1: WireGuard
```

### ISecretTransfer

Encrypts and decrypts secrets. Implemented only in the client app (encrypt) and on server agents (decrypt). Never implemented on the hub.

```typescript
interface ISecretTransfer {
  encrypt(plaintext: string, recipientPublicKeys: string[]): Promise<string>
  decrypt(ciphertext: string, privateKeyPath: string): Promise<string>
  exportBackup(privateKeyPath: string, outputPath: string): Promise<void>
  importBackup(backupPath: string, privateKeyPath: string): Promise<void>
  listKeys(encryptedFilePath: string): Promise<string[]>
  reEncrypt(
    filePath: string, privateKeyPath: string,
    newRecipientKeys: string[]
  ): Promise<string>
}
// v1: age-encryption npm package (pure JS) in client, age CLI on servers
```

---

## 6. Agent

Python daemon under systemd. Approximately 1500–2000 lines. Runs on every managed server.

### Continuous reporting (push)

| Data | Interval |
|------|----------|
| Heartbeat (reachable, agent version, uptime) | 30s |
| System metrics (CPU, RAM, disk, load average) | 60s |
| Container inventory (name, image, status, resource usage) | On change |

### On-demand queries (pull)

| Request | Response |
|---------|----------|
| Container logs | Stream last N lines or follow tail |
| Git repositories on server | List repos, current branch, recent commits |
| Process list | Top processes by CPU/RAM |
| Container actions | Start, stop, restart |
| Secret cache | Store received encrypted blob, decrypt, inject into container |
| Self-update | Pull latest agent version from git repository |

### Appendage lifecycle management

| Action | Trigger |
|--------|---------|
| Install appendage | Client wizard completes → pull Docker image, configure, start container |
| Remove appendage | Client action → stop container, remove image, clean configuration |
| Update appendage | Client or OpenClaw command → pull new image, restart container |
| Route registration | Appendage configuration → register route in reverse proxy via IProxy |

### Coding agent access management

Claude Code runs in a Docker container. The agent manages its filesystem access:

- Mounts specific project volumes into the Claude Code container
- Provides scoped git access via mounted volumes
- Grants unrestricted access to the Nest source tree (self-modification enabled)
- Changes committed through the GitHub appendage

---

## 7. OpenClaw integration

OpenClaw serves as the conversational interface. It does not perform tasks directly — it routes user intents to the appropriate appendages.

### Routing example

```
User: "fix the checkout bug on stoneshop"

1. OpenClaw activates GitHub appendage → locates repository and relevant files
2. Context passed to Claude Code appendage
3. Claude Code reads source, implements fix, runs tests
4. Claude Code commits via GitHub appendage
5. GitHub appendage presents diff in chat
6. Deploy appendage rolls out the change
7. Push notification sent to client: task complete
```

### Autonomous operation

OpenClaw runs server-side. It continues operating when the client app is disconnected. Cached state is used for queries; staleness is indicated where applicable. Only new secret provisioning and server creation require the client.

### Skill authentication

The hub generates a skill-specific API token during appendage setup. Each skill receives minimum required permissions. Skills authenticate to the hub API using their assigned token.

---

## 8. Appendage contract

Every appendage follows a standard schema. Appendages are networked peers that communicate via API — not a dependency hierarchy. If a peer is unavailable, calls degrade gracefully.

```yaml
name: mail-server
version: 1.0.0
description: Self-hosted email with SMTP and IMAP
category: service               # service | tooling | model | custom

requirements:
  min_ram_mb: 512
  min_cpu_cores: 0.5
  min_disk_mb: 2048

container:
  image: docker.io/mailserver/docker-mailserver:latest
  ports:
    - "25:25"
    - "587:587"
    - "993:993"
  volumes:
    - mail-data:/var/mail
  env_from_secrets:
    - MAIL_DOMAIN
    - MAIL_ADMIN_PASSWORD

routes:
  - path: /mail
    port: 8080

apis:                            # APIs exposed to peer appendages
  - name: inbox
    port: 8081
    description: Query inbox via REST

consumes:                        # APIs called on peer appendages (optional)
  - appendage: local-model
    api: classify
    required: false              # graceful degradation if unavailable

skill:                           # OpenClaw integration (optional)
  name: mail-manager
  triggers:
    - "check my email"
    - "send email to"
  handler: skills/mail-manager/SKILL.md

wizard:                          # Setup UI rendered in client app
  steps:
    - field: MAIL_DOMAIN
      label: "Your email domain"
      type: text
      placeholder: "example.com"
    - field: MAIL_ADMIN_PASSWORD
      label: "Admin password"
      type: secret
```

The client reads this schema, renders the setup wizard, collects input, encrypts secrets, and instructs the agent to deploy the container. Server sizing recommendation = sum of `requirements` across all active appendages.

---

## 9. Authentication

| Method | Context |
|--------|---------|
| Passphrase | First-time setup. Creates account and derives age encryption key. |
| Biometric | Daily use. Face ID / fingerprint. Passphrase stored in device secure enclave. |
| Email + password | Web dashboard access, fallback when biometric unavailable. |
| Invitation link | Journey 2. Pre-configured hub connection with restricted permissions. |
| Token / env file | Headless access, CI, scripted automation. |

| Role | Capabilities | Restrictions |
|------|-------------|--------------|
| Admin | Full access to all features | None |
| User (invited) | View servers, trigger deploys, restart services, interact with OpenClaw, browse logs | No secret management, no server provisioning, no invitation creation |

---

## 10. Technology stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Client app | Expo (React Native) + TypeScript | Single codebase: iOS + Android + web |
| Navigation | Expo Router | File-based routing |
| UI | Custom design system (unstyled) | Design direction: distinctive, European aesthetic. Coding agent designs freely. |
| State management | Zustand + React Query | Zustand for UI state, React Query for server/API state |
| i18n | expo-localization + i18next | English + German from v1 |
| Theme | Follow system setting | Light and dark mode |
| Encryption in client | age-encryption npm | Pure JS implementation of age protocol |
| Push notifications | Expo Notifications | iOS + Android + web |
| Distribution (v1) | TestFlight (iOS) + internal track (Android) | Invite-only beta |
| Hub | Node.js + Fastify | WebSocket support for agent and client connections |
| Agent | Python + systemd | ~1500–2000 lines, Docker SDK (docker-py) |
| Reverse proxy | Caddy (IProxy) | Auto-TLS |
| VPN mesh | WireGuard (INetwork) | Pre-installed, activated on multi-server |
| Containers | Docker | Isolation for all appendages |
| Secrets | SOPS + age (ISecretTransfer) | Encrypted file, not in git, backup to external storage |
| Server provider | Any implementing IServerProvider | v1 default: Hetzner Cloud API |
| Git hosting | GitHub (IRepoSync) | Webhooks for auto-sync |
| License | MIT | |
| CI/CD | None for v1 | Manual builds |

---

## 11. Repository structure

One public mono-repo. No secrets stored in the repository.

```
nest/
├── Nest.md                         # This document
├── README.md
├── LICENSE                         # MIT
│
├── app/                            # Expo client (iOS + Android + web)
│   ├── app/                        # Expo Router
│   │   ├── (tabs)/
│   │   │   ├── index.tsx           # Home — server overview
│   │   │   ├── projects.tsx        # Appendages and projects
│   │   │   ├── claw.tsx            # OpenClaw chat view
│   │   │   ├── scripts.tsx         # Script browser and executor
│   │   │   ├── secrets.tsx         # Secret management
│   │   │   └── settings.tsx        # Auth, providers, preferences
│   │   ├── server/[id].tsx         # Server detail
│   │   ├── appendage/[id].tsx      # Appendage detail and configuration
│   │   ├── appendage/add.tsx       # Add appendage wizard
│   │   └── onboarding/             # First-time setup flow
│   ├── components/                 # Shared UI components
│   ├── services/
│   │   ├── api.ts                  # Hub API client
│   │   ├── provider.ts            # IServerProvider (runs in client)
│   │   ├── secrets.ts             # ISecretTransfer (runs in client)
│   │   └── ws.ts                  # WebSocket connection to hub
│   ├── stores/                     # Zustand stores
│   ├── i18n/
│   │   ├── en.json
│   │   └── de.json
│   ├── app.json
│   └── package.json
│
├── hub/                            # Relay hub (Node.js + Fastify)
│   ├── src/
│   │   ├── index.ts
│   │   ├── interfaces/            # TypeScript interface definitions
│   │   │   ├── IProxy.ts
│   │   │   ├── IRepoSync.ts
│   │   │   ├── IScriptRunner.ts
│   │   │   ├── IClawAdapter.ts
│   │   │   ├── INetwork.ts
│   │   │   └── ISecretTransfer.ts  # Type definitions only. Not implemented here.
│   │   ├── impl/                  # v1 implementations
│   │   │   ├── CaddyProxy.ts
│   │   │   ├── GitRepoSync.ts
│   │   │   ├── SshScriptRunner.ts
│   │   │   ├── OpenClawAdapter.ts
│   │   │   └── WireGuardNetwork.ts
│   │   ├── routes/
│   │   │   ├── servers.ts
│   │   │   ├── projects.ts
│   │   │   ├── scripts.ts
│   │   │   ├── claw.ts
│   │   │   ├── secrets.ts         # Opaque blob relay only
│   │   │   └── auth.ts
│   │   └── ws/
│   │       ├── agentHandler.ts
│   │       └── appHandler.ts
│   ├── Dockerfile
│   └── package.json
│
├── agent/                          # Server agent (Python)
│   ├── nest_agent/
│   │   ├── __init__.py
│   │   ├── main.py                # Entry point, WebSocket to hub
│   │   ├── metrics.py             # System metrics collection
│   │   ├── containers.py          # Docker container management
│   │   ├── secrets.py             # Encrypted blob cache, decrypt, inject
│   │   ├── git.py                 # Repository discovery on server
│   │   ├── lifecycle.py           # Appendage install/remove/update
│   │   └── discovery.py           # Auto-detect running services (Docker, systemd, ports)
│   ├── nest-agent.service         # systemd unit file
│   ├── install.sh                 # One-line installer
│   └── requirements.txt
│
├── scripts/                        # Automation scripts (executed by hub via SSH)
│   ├── setup/
│   │   ├── bootstrap.sh           # Initial server configuration
│   │   ├── harden.sh              # SSH hardening, firewall, fail2ban
│   │   ├── install-docker.sh
│   │   └── install-agent.sh
│   ├── appendages/
│   │   ├── install-openclaw.sh
│   │   ├── install-claude-code.sh
│   │   ├── install-website.sh
│   │   ├── install-mail.sh
│   │   └── install-webshop.sh
│   ├── maintenance/
│   │   ├── update-system.sh
│   │   ├── cleanup.sh
│   │   └── rotate-secrets.sh
│   └── templates/
│       ├── docker-compose.openclaw.yml
│       ├── docker-compose.claude-code.yml
│       └── Caddyfile.template
│
├── skills/                         # OpenClaw custom skills
│   ├── github-explorer/SKILL.md
│   ├── server-overview/SKILL.md
│   ├── script-runner/SKILL.md
│   ├── log-viewer/SKILL.md
│   └── deploy/SKILL.md
│
├── config/
│   ├── projects.example.yaml
│   ├── config.example.yaml
│   └── appendage-schema.json      # JSON schema for appendage contract
│
└── docs/                           # Visual documentation (diagrams preferred over prose)
    ├── architecture.svg
    ├── secret-flow.svg
    ├── appendage-contract.svg
    ├── trust-model.svg
    └── onboarding-flow.svg
```

---

## 12. SSH and server access

One shared SSH key pair used by all components:

- Hub uses it to execute scripts on managed servers
- Operator uses it for CLI/IDE SSH access (e.g., VS Code Remote)
- Server provider injects the public key into new instances automatically

The SSH private key is stored in the encrypted secrets file alongside API tokens. The hub receives a copy during initial setup. This is the single exception to the hub's "no secrets" rule — the hub requires SSH access to function.

Password-based SSH authentication is disabled on all managed servers during bootstrap.

---

## 13. Dependency graph

No prescribed build order. Follow the dependency arrows.

```
age key generation ← (no dependencies)
  │
  ▼
Client app shell (auth screens, passphrase, biometric)
  │
  ├──► IServerProvider impl (provider API client, runs in client)
  ├──► ISecretTransfer impl (age-encryption npm, runs in client)
  │
  ▼
Hub API (Fastify, stateless relay)
  │
  ├──► IProxy impl (Caddy configuration)
  ├──► IRepoSync impl (git clone/pull/webhook)
  ├──► Auth endpoints (JWT, invitation links)
  ├──► WebSocket handlers (client + agent connections)
  │
  ▼
Agent (Python daemon)
  │
  ├──► Metrics reporter (push)
  ├──► Container manager (Docker SDK)
  ├──► Secret cache (receive encrypted blob, decrypt, inject)
  ├──► ISecretTransfer impl (age CLI, runs on server)
  ├──► Service discovery (scan Docker, systemd, ports)
  ├──► Appendage lifecycle (install, remove, update)
  │
  ▼
IScriptRunner impl (SSH from hub to servers)
  │
  ▼
INetwork impl (WireGuard, pre-installed for scaling)
  │
  ▼
Bootstrap scripts (server setup, hardening, Docker installation)
  │
  ▼
IClawAdapter impl (OpenClaw proxy + skill registration)
  │
  ▼
OpenClaw skills (github-explorer, server-overview, script-runner, log-viewer, deploy)
  │
  ▼
Appendage system (contract schema validation, wizard renderer in client)
  │
  ▼
Individual appendages (mail, website, webshop, Claude Code, etc.)
```

---

## 14. Security rules

1. Hub stores no secrets except one SSH key pair required for script execution.
2. ISecretTransfer is never implemented on the hub. Type definitions are shared; implementations exist only in the client and agent.
3. Server provider API tokens remain in the client. The client queries provider APIs directly.
4. Each server caches secrets encrypted specifically for its own age public key. One server's cached blob is unusable by another server.
5. Revocation: re-encrypt without the target server's public key. The server can no longer decrypt on next restart.
6. The public repository contains no secrets. Designed for open-source distribution and customer use.
7. Claude Code operates with unrestricted filesystem access, including the Nest source tree. No approval gates on code modifications.
8. All server-side components operate autonomously. The client is required only for new secret provisioning, server creation, and user invitation.
9. OpenClaw always uses latest release. No version pinning.

---

## 15. Open threads

Issues identified but not yet resolved. Flagged so the coding agent skips or asks rather than guessing.

### Architecture
- Multi-server appendage placement logic (which appendage runs on which server)
- Detailed appendage-to-appendage API discovery mechanism

### Customer journeys
- Team access with granular permissions beyond admin/user
- Migration workflow from other hosting setups
- Horizontal scaling procedures
- Third-party appendage development and publishing process
- In-app onboarding tutorials and guided documentation

### Appendages
- Local model hosting: runtime selection, resource limits, scheduling
- Appendage marketplace: publishing, review, trust, installation
- Claude Code access granularity (currently: unrestricted)

### Business
- Setup service pricing model
- Customer access scope
- Support channel design

---

## 16. GitHub integration

Three authentication methods supported. User selects during setup.

| Method | Use case |
|--------|----------|
| GitHub App | Fine-grained repository permissions, webhook built-in |
| Personal Access Token | Simple, stored in encrypted secrets file |
| OAuth flow | User authorizes in client, token managed by the app |

---

## 17. Glossary

| Term | Definition |
|------|-----------|
| **Nest** | The platform. Name identical in DE/EN/NL/SV. 🪺 |
| **Core** | Four always-present components: client app, hub, agent, OpenClaw |
| **Appendage** | Any pluggable feature beyond the core. Networked peers, not a dependency tree. |
| **Hub** | Stateless relay process on one server. No database. |
| **Agent** | Python daemon on each managed server. Reports metrics, manages containers. |
| **Molt** | An OpenClaw skill provided by an appendage |
| **Opaque blob** | Encrypted data relayed through the hub without the hub being able to decrypt it |
| **age** | Modern encryption tool. Public key encrypts, private key decrypts. |
| **SOPS** | Mozilla tool that encrypts YAML values while keeping keys human-readable |

---

*63 architectural decisions. Authored collaboratively on March 24, 2026.*
