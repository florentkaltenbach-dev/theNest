// hub/src/routes/observability.js
//
// Serves telemetry summary from /opt/nest/data/telemetry-summary.json. Regenerates via scripts/tasks/aggregate-telemetry.sh if stale. Exports: observabilityRoutes(router). Depends: jq in PATH, scripts/tasks/aggregate-telemetry.sh.

import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sendJson, sendError } from '../server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, "../../..");
const SUMMARY_FILE = process.env.NEST_TELEMETRY_SUMMARY || join(NEST_ROOT, "data/telemetry-summary.json");
const AGGREGATOR = process.env.NEST_TELEMETRY_AGGREGATOR || join(NEST_ROOT, "scripts/tasks/aggregate-telemetry.sh");
const STALE_AFTER_MS = 5 * 60 * 1000;

/**
 * Run the aggregator, piping JSON args on stdin. Resolves with parsed JSON from stdout.
 * @param {Object} args
 * @returns {Promise<Object>}
 */
function runAggregator(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(AGGREGATOR, [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`aggregator exit ${code}: ${stderr}`));
      try { resolve(JSON.parse(stdout)); }
      catch (e) { reject(new Error(`aggregator bad JSON: ${e.message}`)); }
    });
    child.stdin.end(JSON.stringify(args || {}));
  });
}

async function loadOrRegenerate(windowMinutes) {
  if (existsSync(SUMMARY_FILE)) {
    const st = await stat(SUMMARY_FILE);
    if (Date.now() - st.mtimeMs < STALE_AFTER_MS) {
      const raw = await readFile(SUMMARY_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (!windowMinutes || parsed.windowMinutes === windowMinutes) return { summary: parsed, source: "cache" };
    }
  }
  const summary = await runAggregator({ windowMinutes });
  return { summary, source: "regenerated" };
}

export function observabilityRoutes(router) {
  router.get("/observability/tokens", async (req, res) => {
    try {
      const windowMinutes = req.query?.window ? parseInt(req.query.window, 10) : undefined;
      const { summary, source } = await loadOrRegenerate(windowMinutes);
      sendJson(res, { ...summary, _source: source });
    } catch (err) {
      sendError(res, 500, `Telemetry aggregation failed: ${err.message}`);
    }
  });
}
