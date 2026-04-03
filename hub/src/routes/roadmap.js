// ── roadmap.js ────────────────────────────────────────
// Serves ROADMAP.md content
// ──────────────────────────────────────────────────────
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sendJson } from '../server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function roadmapRoutes(router) {
  router.get("/roadmap", async (req, res) => {
    const filePath = join(__dirname, "../../../ROADMAP.md");
    if (!existsSync(filePath)) {
      return sendJson(res, { content: "# Roadmap\n\nNo roadmap found." });
    }
    const content = await readFile(filePath, "utf-8");
    sendJson(res, { content });
  });
}
