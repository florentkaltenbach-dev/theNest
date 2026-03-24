import { FastifyInstance } from "fastify";
import { readFile, writeFile } from "fs/promises";

const CONFIG_PATH = process.env.NEST_CONFIG_PATH || "/opt/nest/config.env";

// Public keys that are safe to show existence of (not values)
const SAFE_TO_LIST = ["CLAUDE_AUTH_MODE", "REPO_AUTH_MODE", "NEST_REPO", "NEST_BRANCH", "SSH_KEY_PATH"];

interface SecretEntry {
  key: string;
  hasValue: boolean;
  masked: string;
  editable: boolean;
}

async function parseEnvFile(): Promise<Map<string, string>> {
  const entries = new Map<string, string>();
  try {
    const content = await readFile(CONFIG_PATH, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx);
      let value = trimmed.substring(eqIdx + 1);
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      entries.set(key, value);
    }
  } catch {}
  return entries;
}

function maskValue(value: string): string {
  if (!value) return "(empty)";
  if (value.length <= 4) return "****";
  return value.substring(0, 4) + "•".repeat(Math.min(value.length - 4, 20));
}

export async function secretRoutes(app: FastifyInstance) {
  app.get("/secrets", async () => {
    const entries = await parseEnvFile();
    const secrets: SecretEntry[] = [];
    for (const [key, value] of entries) {
      secrets.push({
        key,
        hasValue: !!value,
        masked: SAFE_TO_LIST.includes(key) ? value : maskValue(value),
        editable: !SAFE_TO_LIST.includes(key),
      });
    }
    return { secrets };
  });

  app.post<{ Body: { key: string; value: string } }>("/secrets", async (req, reply) => {
    const { key, value } = req.body;
    if (!key || !key.match(/^[A-Z_][A-Z0-9_]*$/)) {
      return reply.code(400).send({ error: "Invalid key format. Use UPPER_SNAKE_CASE." });
    }

    const entries = await parseEnvFile();
    entries.set(key, value);

    // Rebuild env file
    const lines = ["# ── theNest Configuration ──", "# NEVER commit this file — it contains secrets.", ""];
    for (const [k, v] of entries) {
      // Quote values that contain spaces or special chars
      const needsQuotes = v.includes(" ") || v.includes('"') || v.includes("'");
      lines.push(`${k}=${needsQuotes ? `"${v}"` : v}`);
    }

    await writeFile(CONFIG_PATH, lines.join("\n") + "\n", "utf-8");
    return { success: true, key };
  });

  app.delete<{ Params: { key: string } }>("/secrets/:key", async (req, reply) => {
    const entries = await parseEnvFile();
    if (!entries.has(req.params.key)) {
      return reply.code(404).send({ error: "Key not found" });
    }
    entries.delete(req.params.key);

    const lines = ["# ── theNest Configuration ──", "# NEVER commit this file — it contains secrets.", ""];
    for (const [k, v] of entries) {
      const needsQuotes = v.includes(" ") || v.includes('"') || v.includes("'");
      lines.push(`${k}=${needsQuotes ? `"${v}"` : v}`);
    }
    await writeFile(CONFIG_PATH, lines.join("\n") + "\n", "utf-8");
    return { success: true };
  });
}
