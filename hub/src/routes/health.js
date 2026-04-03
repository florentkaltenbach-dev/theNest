// ── health.js ─────────────────────────────────────────
// Health-check endpoint
// ──────────────────────────────────────────────────────
import { sendJson } from '../server.js';

export function healthRoutes(router) {
  router.get("/health", async (req, res) => {
    sendJson(res, {
      status: "ok",
      version: "0.1.0",
      uptime: process.uptime(),
    });
  });
}
