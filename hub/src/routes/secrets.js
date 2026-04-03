// ── secrets.js ────────────────────────────────────────
// Manage config.env secrets (list / set / delete)
// ──────────────────────────────────────────────────────
import { readFile, writeFile } from "fs/promises";
import { sendJson, sendError } from '../server.js';

const CONFIG_PATH = process.env.NEST_CONFIG_PATH || "/opt/nest/config.env";
const SAFE_TO_LIST = ["CLAUDE_AUTH_MODE", "CODEX_AUTH_MODE", "REPO_AUTH_MODE", "NEST_REPO", "NEST_BRANCH", "SSH_KEY_PATH"];

async function parseEnvFile() {
  const entries = new Map();
  try {
    const content = await readFile(CONFIG_PATH, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx);
      let value = trimmed.substring(eqIdx + 1);
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      entries.set(key, value);
    }
  } catch {}
  return entries;
}

function maskValue(value) {
  if (!value) return "(empty)";
  if (value.length <= 4) return "****";
  return value.substring(0, 4) + "•".repeat(Math.min(value.length - 4, 20));
}

export function secretRoutes(router) {
  router.get("/secrets", async (req, res) => {
    const entries = await parseEnvFile();
    const secrets = [];
    for (const [key, value] of entries) {
      secrets.push({ key, hasValue: !!value, masked: SAFE_TO_LIST.includes(key) ? value : maskValue(value), editable: !SAFE_TO_LIST.includes(key) });
    }
    sendJson(res, { secrets });
  });

  router.post("/secrets", async (req, res) => {
    const { key, value } = req.body;
    if (!key || !key.match(/^[A-Z_][A-Z0-9_]*$/)) return sendError(res, 400, "Invalid key format. Use UPPER_SNAKE_CASE.");
    const entries = await parseEnvFile();
    entries.set(key, value);
    const lines = ["# ── theNest Configuration ──", "# NEVER commit this file — it contains secrets.", ""];
    for (const [k, v] of entries) {
      const needsQuotes = v.includes(" ") || v.includes('"') || v.includes("'");
      lines.push(`${k}=${needsQuotes ? `"${v}"` : v}`);
    }
    await writeFile(CONFIG_PATH, lines.join("\n") + "\n", "utf-8");
    sendJson(res, { success: true, key });
  });

  router.delete("/secrets/:key", async (req, res) => {
    const entries = await parseEnvFile();
    if (!entries.has(req.params.key)) return sendError(res, 404, "Key not found");
    entries.delete(req.params.key);
    const lines = ["# ── theNest Configuration ──", "# NEVER commit this file — it contains secrets.", ""];
    for (const [k, v] of entries) {
      const needsQuotes = v.includes(" ") || v.includes('"') || v.includes("'");
      lines.push(`${k}=${needsQuotes ? `"${v}"` : v}`);
    }
    await writeFile(CONFIG_PATH, lines.join("\n") + "\n", "utf-8");
    sendJson(res, { success: true });
  });
}
