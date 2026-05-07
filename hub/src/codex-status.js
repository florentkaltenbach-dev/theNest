// hub/src/codex-status.js
//
// Read local Codex CLI OAuth status (plan, account, token expiry). Exports: readCodexStatus(). Depends: NEST_CODEX_AUTH env var (defaults to /home/claude/.codex/auth.json). Intended consumer: C10 token ledger for Codex Pro quota tracking.

import { readFile } from 'node:fs/promises';

const AUTH_PATH = process.env.NEST_CODEX_AUTH || '/home/claude/.codex/auth.json';

/**
 * @returns {Promise<{loggedIn: boolean, plan?: string, email?: string|null, expiresAt?: string|null, reason?: string}>}
 */
export async function readCodexStatus() {
  try {
    const raw = await readFile(AUTH_PATH, 'utf-8');
    const auth = JSON.parse(raw);
    const accessToken = auth.tokens?.access_token;
    if (!accessToken) return { loggedIn: false, reason: 'access token missing' };

    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64url').toString());
    const openaiAuth = payload['https://api.openai.com/auth'] || {};
    const profile = payload['https://api.openai.com/profile'] || {};
    return {
      loggedIn: true,
      plan: openaiAuth.chatgpt_plan_type || 'unknown',
      email: profile.email || null,
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    };
  } catch (err) {
    return { loggedIn: false, reason: err.message };
  }
}
