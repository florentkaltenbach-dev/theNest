// ── tokens.js ─────────────────────────────────────────
// Claude + Codex token/rate-limit status endpoints
// ──────────────────────────────────────────────────────
import { readFile, appendFile, mkdir } from "fs/promises";
import { sendJson, sendError } from '../server.js';

const CACHE_TTL_MS = 60_000;
const WINDOWS_FILE = "/opt/nest/data/token-windows.jsonl";
const CODEX_AUTH_PATH = "/home/claude/.codex/auth.json";

// ── Claude state ─────────────────────────────────────
let cache = { result: null, at: 0 };
let lastReset = null;
let peak = 0;

// ── Codex state ──────────────────────────────────────
let codexCache = { result: null, at: 0 };

async function getAccessToken() {
  // Always re-read — Claude Code may refresh the token
  const creds = JSON.parse(await readFile("/home/claude/.claude/.credentials.json", "utf-8"));
  return creds.claudeAiOauth.accessToken;
}

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

export function tokenRoutes(router) {
  // ── Claude endpoints ─────────────────────────────────
  router.get("/tokens/limits", async (req, res) => {
    const now = Date.now();
    if (cache.result && now - cache.at < CACHE_TTL_MS) return sendJson(res, cache.result);

    try {
      const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "authorization": `Bearer ${await getAccessToken()}`,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      const h = (name) => apiRes.headers.get(name);
      const sessionUtil = parseFloat(h("anthropic-ratelimit-unified-5h-utilization") || "0");
      const sessionReset = parseInt(h("anthropic-ratelimit-unified-5h-reset") || "0", 10);
      const weeklyUtil = parseFloat(h("anthropic-ratelimit-unified-7d-utilization") || "0");
      const weeklyReset = parseInt(h("anthropic-ratelimit-unified-7d-reset") || "0", 10);
      const nowSec = Math.floor(now / 1000);

      const result = {
        status: h("anthropic-ratelimit-unified-status") || "unknown",
        subscription: "Claude Max 5x",
        session: {
          utilization_pct: Math.round(sessionUtil * 100),
          remaining_seconds: Math.max(0, sessionReset - nowSec),
          status: h("anthropic-ratelimit-unified-5h-status") || "unknown",
        },
        weekly: {
          utilization_pct: Math.round(weeklyUtil * 100),
          remaining_seconds: Math.max(0, weeklyReset - nowSec),
          status: h("anthropic-ratelimit-unified-7d-status") || "unknown",
        },
        overage_available: h("anthropic-ratelimit-unified-overage-status") === "available",
        representativeClaim: h("anthropic-ratelimit-unified-representative-claim"),
        fallbackPercentage: parseFloat(h("anthropic-ratelimit-unified-fallback-percentage") || "0"),
        fetchedAt: new Date().toISOString(),
      };

      // Track window resets
      const sessionPct = result.session.utilization_pct;
      if (lastReset !== null && sessionReset !== lastReset && peak > 0) {
        await mkdir("/opt/nest/data", { recursive: true });
        await appendFile(WINDOWS_FILE, JSON.stringify({
          ended: new Date(lastReset * 1000).toISOString(),
          peak_pct: peak,
        }) + "\n");
        peak = 0;
      }
      lastReset = sessionReset;
      peak = Math.max(peak, sessionPct);

      cache = { result, at: now };
      sendJson(res, result);
    } catch (err) {
      sendError(res, 502, "Failed to fetch token limits");
    }
  });

  router.get("/tokens/waste", async (req, res) => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let windows = [];
    try {
      windows = (await readFile(WINDOWS_FILE, "utf-8"))
        .trim().split("\n").filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((w) => new Date(w.ended).getTime() > cutoff);
    } catch {}

    const burned = windows.reduce((s, w) => s + w.peak_pct, 0);
    sendJson(res, {
      current_session_pct: peak,
      completed_windows: windows.slice(-10),
      week_total_windows: windows.length,
      week_avg_pct: windows.length ? Math.round(burned / windows.length) : 0,
      week_total_burned: burned,
    });
  });

  // ── Codex endpoint ───────────────────────────────────
  // ChatGPT Plus is flat-rate — no per-request rate limits.
  // We decode the OAuth JWT to surface subscription status.
  router.get("/tokens/codex/status", async (req, res) => {
    const now = Date.now();
    if (codexCache.result && now - codexCache.at < CACHE_TTL_MS) return sendJson(res, codexCache.result);

    let raw;
    try {
      raw = await readFile(CODEX_AUTH_PATH, "utf-8");
    } catch {
      return sendError(res, 503, "Codex not configured");
    }

    try {
      const creds = JSON.parse(raw);
      const accessToken = creds.tokens?.access_token;
      if (!accessToken) throw new Error("No access_token in auth.json");

      const claims = decodeJwtPayload(accessToken);
      const auth = claims["https://api.openai.com/auth"] || {};
      const profile = claims["https://api.openai.com/profile"] || {};

      const expMs = (claims.exp || 0) * 1000;
      const issuedMs = (claims.iat || 0) * 1000;
      const expired = expMs < now;
      const subscriptionStart = auth.chatgpt_subscription_active_start || null;
      const subscriptionUntil = auth.chatgpt_subscription_active_until || null;
      const organizations = Array.isArray(auth.organizations) ? auth.organizations : [];

      const result = {
        configured: true,
        auth_mode: creds.auth_mode || "chatgpt",
        plan: auth.chatgpt_plan_type || "unknown",
        email: profile.email || null,
        account_id: creds.tokens?.account_id || auth.chatgpt_account_id || null,
        user_id: auth.chatgpt_user_id || auth.user_id || null,
        organization_count: organizations.length,
        scopes: claims.scp || [],
        token_issued: new Date(issuedMs).toISOString(),
        token_expires: new Date(expMs).toISOString(),
        token_remaining_seconds: Math.max(0, Math.round((expMs - now) / 1000)),
        token_lifetime_seconds: Math.max(0, Math.round((expMs - issuedMs) / 1000)),
        token_expired: expired,
        subscription_active_start: subscriptionStart,
        subscription_active_until: subscriptionUntil,
        last_refresh: creds.last_refresh || null,
        fetchedAt: new Date().toISOString(),
      };

      codexCache = { result, at: now };
      sendJson(res, result);
    } catch (err) {
      sendError(res, 502, "Failed to parse Codex credentials");
    }
  });
}
