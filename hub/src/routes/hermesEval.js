// hub/src/routes/hermesEval.js
//
// Hermes/OpenRouter benchmark history API.
// Exports: hermesEvalRoutes(router). Depends: data/hermes-eval/runs.jsonl

import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sendJson, sendError } from "../server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, "../../..");
const DATA_DIR = process.env.NEST_HERMES_EVAL_DIR || join(NEST_ROOT, "data/hermes-eval");
const HISTORY_FILE = join(DATA_DIR, "runs.jsonl");
const LATEST_FILE = join(DATA_DIR, "latest.json");

function clampLimit(value) {
  const n = parseInt(value || "30", 10);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(180, n));
}

async function readJsonl(path, limit) {
  if (!existsSync(path)) return [];
  const raw = await readFile(path, "utf-8");
  return raw
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((line) => JSON.parse(line))
    .reverse();
}

/** Register Hermes evaluation routes. */
export function hermesEvalRoutes(router) {
  router.get("/hermes-eval", async (req, res) => {
    try {
      const limit = clampLimit(req.query?.limit);
      const runs = await readJsonl(HISTORY_FILE, limit);
      let latest = runs[0] || null;
      if (existsSync(LATEST_FILE)) {
        latest = JSON.parse(await readFile(LATEST_FILE, "utf-8"));
      }
      sendJson(res, { latest, runs });
    } catch (err) {
      sendError(res, 500, `Hermes eval history failed: ${err.message}`);
    }
  });
}
