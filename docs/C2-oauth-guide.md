# C2: Codex OAuth — what to do

OpenClaw version verified against this guide: **2026.4.1**. If the version on the host differs, re-verify the UI elements below before following (see AGENTS.md → "Verify UI flows before prescribing them").

Everything except the OAuth handshake is pre-configured. There is one path — the Control UI at `/claw/` has **no in-browser OAuth button in this version**; the handshake has to be kicked off from the CLI.

## Current state (verified 2026-04-23)

- Gateway running on `127.0.0.1:18789` under `claude` user's systemd
- Wizard already ran 2026-04-02; gateway config complete
- Caddy routes `https://nest.kaltenbach.dev/claw/` → Hub; Hub gates with Nest auth, then proxies to the local OpenClaw gateway
- Workspace: `/opt/nest`
- Gateway auth: token mode (rotatable — see Step 0)
- Control UI allowed origin: `https://nest.kaltenbach.dev`
- `openai-codex` provider registered; `models[]` empty — OAuth populates it

## Step 0 — rotate the gateway token (recommended)

If the current token has been exposed outside the server (pasted into a chat, a ticket, screen-shared, etc.), rotate before continuing:

```bash
NEW=$(openssl rand -hex 24)
sudo -u claude /usr/bin/openclaw config set gateway.auth.token "$NEW"
sudo -u claude systemctl --user restart openclaw-gateway
printf 'new token: %s\n' "$NEW"   # capture in a password manager; do not paste this into chat or tickets
```

`openclaw config get gateway.auth.token` redacts the value as `__OPENCLAW_REDACTED__`, so inspection output is safe to share — only the echo above prints the real token. `openclaw dashboard --no-open` prints a `#token=...` URL with the current token; convenient but equally sensitive.

## Step 1 — open the Control UI

In a browser on your own device:

1. Go to `https://nest.kaltenbach.dev/claw/`. You'll land on the login gate (subtitle: "Gateway Dashboard").
2. Paste the gateway token into the **Gateway Token** field. Leave **Password** blank (optional in token mode).
3. Click **Connect**.

You should see the dashboard with nav tabs **Chat / Control / Agent / Settings** and a green gateway-status indicator.

**Avoid the `#token=<value>` URL form** the UI also accepts — it writes the token into browser history and is readable by extensions with `tabs` permission. Manual paste is equivalent auth, cleaner hygiene.

## Step 2 — run Codex OAuth from the server

SSH in. Run as `claude`:

```bash
sudo -u claude /usr/bin/openclaw onboard \
  --auth-choice openai-codex \
  --flow quickstart \
  --skip-daemon --skip-channels --skip-skills --skip-search
```

Flags:
- `--auth-choice openai-codex` — the only thing we want.
- `--flow quickstart` — no advanced prompts.
- `--skip-daemon` — gateway already running.
- `--skip-channels / --skip-skills / --skip-search` — defer to C3, C5.

The command prints an OAuth URL (e.g. `https://chatgpt.com/codex/oauth/...`) and a short verification code.

Two things to know:
- **The URL must be printed by the `openclaw` binary running in your SSH session.** Never accept this URL from anywhere else — an attacker-supplied URL could bind your ChatGPT identity to their OpenClaw instance.
- **The verification code is short-lived (~5–15 min).** If you pause past the window, rerun the command.

Open the URL in a browser on any device, paste the code, sign in with ChatGPT, approve. The terminal command exits when the handshake completes.

## Step 3 — verify

```bash
sudo jq '.providers["openai-codex"].models | length' /home/claude/.openclaw/agents/main/agent/models.json
# should be > 0

sudo jq '.tokens | keys' /home/claude/.openclaw/identity/device-auth.json
# should include more than just "operator"
```

Also refresh `/claw/` → **Settings → Models** — `openai-codex` should now list populated models.

## If something goes wrong

- **404/502 on `/claw/`** — check `systemctl is-active caddy`, `systemctl is-active nest-hub`, and `ss -tlnp | grep 18789`; Caddy, Hub, and the OpenClaw gateway should all be healthy.
- **Models still empty after OAuth succeeds** — restart the gateway: `sudo -u claude systemctl --user restart openclaw-gateway`.
- **"wizard.lastRunAt was already set" warning** — safe; re-entrant `onboard` updates only the auth slot.
- **Connect fails with "gateway auth failed"** — token typo, or the token was rotated after you copied it. Re-fetch from `openclaw.json` (via `sudo`) and retry.
