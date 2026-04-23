# C2: Codex OAuth — what to do

Everything except your browser click is pre-configured. Pick one path.

## Current state (verified 2026-04-23)

- Gateway running on `127.0.0.1:18789` under `claude` user's systemd
- Wizard already ran 2026-04-02; gateway config complete
- Caddy routes `https://nest.kaltenbach.dev/claw/` → gateway
- Workspace: `/opt/nest`
- Gateway auth: token mode, token exists (don't need to pick one)
- Control UI allowed origin: `https://nest.kaltenbach.dev`
- `openai-codex` provider is registered but `models[]` is empty — this is what OAuth fills in

You do **not** need to:
- Pick a port, bind, or token
- Choose a workspace
- Install a daemon (already running)
- Configure Caddy

You only need to **complete the OAuth handshake with OpenAI Codex.**

## Path A — browser only (recommended)

1. Open `https://nest.kaltenbach.dev/claw/` in a normal browser.
2. In the Control UI, go to **Providers → OpenAI Codex** (exact label may vary by OpenClaw version).
3. Click **Connect / Sign in with ChatGPT**.
4. Complete the OpenAI OAuth flow in the popup/redirect.
5. Return to the Control UI. You should see models populated under `openai-codex` and a green auth indicator.

Done. Tell me and I'll run the post-C2 prep pass on C3 / C5 / C10 / C9b.

## Path B — terminal + browser (if the Control UI route is unclear)

Run on the server as the `claude` user:

```bash
openclaw onboard \
  --auth-choice openai-codex \
  --flow quickstart \
  --skip-daemon \
  --skip-channels \
  --skip-skills \
  --skip-search
```

Why the flags:
- `--auth-choice openai-codex` — the only thing we actually want to do.
- `--flow quickstart` — no advanced/manual prompts.
- `--skip-daemon` — gateway is already running.
- `--skip-channels / --skip-skills / --skip-search` — defer those to follow-up steps (C3, C5, etc.); don't let them block this one.

The command will print an OAuth URL and a short code. Open the URL in a browser on any device, paste the code, sign in with your ChatGPT account, approve access. The terminal command returns when the flow completes.

## Verifying success

After either path:

```bash
sudo jq '.providers["openai-codex"].models | length' /home/claude/.openclaw/agents/main/agent/models.json
# should be > 0

sudo jq '.tokens | keys' /home/claude/.openclaw/identity/device-auth.json
# should include more than just "operator"
```

## If something goes wrong

- 404 on `/claw/` — `systemctl is-active caddy` and `ss -tlnp | grep 18789` should both be fine; if not, Caddy or the gateway is down.
- OAuth URL doesn't open — it's likely `https://chatgpt.com/codex/oauth/...`. Nothing Nest-specific; retry.
- "wizard.lastRunAt was already set" warning — safe; we're running `onboard` re-entrant to update just the auth.
- Models array stays empty after OAuth succeeds — gateway may need a restart: `sudo -u claude systemctl --user restart openclaw-gateway` (or kill PID 323664 and the user-level systemd will relaunch it).
