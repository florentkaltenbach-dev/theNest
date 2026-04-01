import { FastifyInstance } from "fastify";
import { readFile, appendFile, mkdir } from "fs/promises";

const CACHE_TTL_MS = 60_000;
const WINDOWS_FILE = "/opt/nest/data/token-windows.jsonl";

let cache: { result: any; at: number } = { result: null, at: 0 };
let lastReset: number | null = null;
let peak = 0;

async function getAccessToken(): Promise<string> {
  // Always re-read — Claude Code may refresh the token
  const creds = JSON.parse(await readFile("/home/claude/.claude/.credentials.json", "utf-8"));
  return creds.claudeAiOauth.accessToken;
}

export async function tokenRoutes(app: FastifyInstance) {
  app.get("/tokens/limits", async (_req, reply) => {
    const now = Date.now();
    if (cache.result && now - cache.at < CACHE_TTL_MS) return cache.result;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
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

      const h = (name: string) => res.headers.get(name);
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
      return result;
    } catch (err: any) {
      reply.code(502).send({ error: "Failed to fetch token limits", detail: err.message });
    }
  });

  app.get("/tokens/waste", async () => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let windows: Array<{ ended: string; peak_pct: number }> = [];
    try {
      windows = (await readFile(WINDOWS_FILE, "utf-8"))
        .trim().split("\n").filter(Boolean)
        .map((l) => JSON.parse(l))
        .filter((w) => new Date(w.ended).getTime() > cutoff);
    } catch {}

    const burned = windows.reduce((s, w) => s + w.peak_pct, 0);
    return {
      current_session_pct: peak,
      completed_windows: windows.slice(-10),
      week_total_windows: windows.length,
      week_avg_pct: windows.length ? Math.round(burned / windows.length) : 0,
      week_total_burned: burned,
    };
  });
}
