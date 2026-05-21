# SOPS + age + Vaultwarden — Feature Plan

> Acceptance criteria for Phase 4 (E1–E7) and the first Phase 5 appendage.
> Done = all four test sections pass on a fresh Hetzner CX11 with no manual
> intervention beyond the install script. The trust-model section is written
> first and never allowed to regress.

## Scope

### Phase 4 mapping (encrypted secrets)

- **E1** — passphrase → age identity in browser secure storage
- **E2** — agent generates age keypair on install, registers public key with hub
- **E3** — client encrypts via `age-encryption` npm to target server's pubkey + a backup recipient
- **E4** — `/api/secrets` becomes an opaque-blob relay; current `config.env` editing is removed
- **E5** — `agent/nest_agent/secrets.py` caches blob, decrypts with own key, injects into container env
- **E7** — encrypted backup file export/import

### Phase 5 starter (Vaultwarden as first appendage)

- **A1** — write `config/appendage-schema.json`
- New: `appendages/vaultwarden.yaml` per Nest.md §8
  - container: `vaultwarden/server:latest`
  - declared `min_ram_mb: 256`
  - route `/vault`
  - secret `ADMIN_TOKEN` collected by wizard
  - optional SMTP block

## Test plan (definition of done)

### A. Trust-model invariants — write first, never regress

- [ ] Hub logs every request body. End-to-end secret push: plaintext appears nowhere on hub disk or logs — only the age-armored blob.
- [ ] Pause hub mid-flow under a debugger; memory dump contains no plaintext.
- [ ] CI grep test: `ISecretTransfer` is not imported anywhere under `hub/src/`.
- [ ] Server-key isolation: blob from server A, dropped on server B, restart B's container → decryption fails.
- [ ] Revocation works: re-encrypt secrets file without server A's pubkey, push, restart A's container → A's container fails to start.

### B. Secret lifecycle round-trip

- [ ] Fresh client + passphrase deterministically generates an age identity; logout + login with same passphrase recovers it.
- [ ] Set a secret in UI → restart consuming container → secret present in new container's env (proves agent's cached blob + autonomous restart works without the client online).
- [ ] Export backup file → wipe browser storage → import backup with passphrase → all secrets restored.
- [ ] Edit a secret value → old value gone from agent cache within one push cycle.

### C. Vaultwarden as appendage

- [ ] Install via wizard rendered from `appendages/vaultwarden.yaml`. Container comes up; Caddy auto-routes `/vault` with TLS; `ADMIN_TOKEN` injected from the secrets pipeline (not hardcoded, not in git).
- [ ] Bitwarden iOS/Android app points at the domain, logs in, saves a credential, retrieves it on a second device.
- [ ] Restart the server. Vaultwarden returns unattended — no client needed. Credentials still retrievable.
- [ ] Uninstall via UI removes container, volume, and Caddy route. Secret marked revoked.

### D. Resource budget

- [ ] `docker stats` after 24h idle: Vaultwarden under 150 MB RAM, near-zero CPU. SOPS+age add zero resident process.
- [ ] Hub RAM unchanged before/after the secrets refactor (we're removing logic, not adding).

## Files this plan touches

| File | Status | Action |
|---|---|---|
| `hub/src/routes/secrets.js` | exists, plaintext config.env | replace with opaque blob relay (E4) |
| `hub/src/types.js` | exists, no ISecretTransfer | add `ISecretTransfer` (E3 client side only) |
| `agent/nest_agent/secrets.py` | missing | create (E5) |
| `config/appendage-schema.json` | missing | create (A1) |
| `appendages/vaultwarden.yaml` | missing | create (V1) |
| `config.env.example` | exists | reduce to non-secret bootstrap vars only |
| Client setup screen in `hub/static/` | exists | add passphrase → age identity flow (E1) |

## Verification

- CI grep test for the trust-model invariant: `! grep -rn ISecretTransfer hub/src/`
- End-to-end: provision a fresh CX11 with the install script, run sections A–D, confirm each checkbox.
- `docker stats --no-stream` snapshot before refactor and 24h after Vaultwarden install for the budget delta.
