// hub/src/routes/observability.js
//
// Two endpoints: /observability/tokens (C10 multi-source ledger) and /observability/requests (hub request stats / waste). Each regenerates its source via aggregate-*.sh if older than 5min. Exports: observabilityRoutes(router). Depends: jq, scripts/tasks/aggregate-tokens.sh, scripts/tasks/aggregate-telemetry.sh.

import { readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sendJson, sendError } from '../server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, "../../..");
const STALE_AFTER_MS = 5 * 60 * 1000;

const TOKENS_FILE = process.env.NEST_TOKEN_LEDGER || join(NEST_ROOT, "data/token-ledger.json");
const TOKENS_AGGREGATOR = process.env.NEST_TOKEN_AGGREGATOR || join(NEST_ROOT, "scripts/tasks/aggregate-tokens.sh");
const SUMMARY_FILE = process.env.NEST_TELEMETRY_SUMMARY || join(NEST_ROOT, "data/telemetry-summary.json");
const SUMMARY_AGGREGATOR = process.env.NEST_TELEMETRY_AGGREGATOR || join(NEST_ROOT, "scripts/tasks/aggregate-telemetry.sh");

/**
 * Run an aggregator script, piping a JSON args object on stdin.
 * @param {string} script
 * @param {Object} args
 * @returns {Promise<Object>}
 */
function runAggregator(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(script, [], { stdio: ["pipe", "pipe", "pipe"] });
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

/**
 * Read cached file if fresh (mtime within STALE_AFTER_MS), otherwise re-run aggregator.
 * Optional `freshIf` predicate gets the parsed cached payload — return false to force regen.
 * @param {string} cachePath
 * @param {string} aggregatorPath
 * @param {Object} args
 * @param {(payload: Object) => boolean} [freshIf]
 * @returns {Promise<{ payload: Object, source: string }>}
 */
async function loadOrRegenerate(cachePath, aggregatorPath, args, freshIf) {
  if (existsSync(cachePath)) {
    const st = await stat(cachePath);
    if (Date.now() - st.mtimeMs < STALE_AFTER_MS) {
      const payload = JSON.parse(await readFile(cachePath, "utf-8"));
      if (!freshIf || freshIf(payload)) return { payload, source: "cache" };
    }
  }
  const payload = await runAggregator(aggregatorPath, args);
  return { payload, source: "regenerated" };
}

/**
 * Load the C10 token ledger, using the 5-min cache when fresh. Shared by the
 * /observability/tokens endpoint and the token-history recorder (tokenHistory.js).
 * @returns {Promise<{ payload: Object, source: string }>}
 */
export function loadTokenLedger() {
  return loadOrRegenerate(TOKENS_FILE, TOKENS_AGGREGATOR, {});
}

/**
 * Cheap read of the cached token ledger that never re-runs the (~2s, live-API) aggregator.
 * For consumers needing only stable metadata (labels, reset cadence/time) and tolerant of
 * up-to-5-min staleness — e.g. the history chart's sourceMeta(), called on every window change.
 * Keeping the live regen out of that path is what makes window switching instant; the dedicated
 * /observability/tokens endpoint and the 5-min sampler keep the cache fresh. Falls back to a
 * full regen only when no cache file exists yet (first boot).
 * @returns {Promise<{ payload: Object, source: string }>}
 */
export async function peekTokenLedger() {
  if (existsSync(TOKENS_FILE)) {
    try { return { payload: JSON.parse(await readFile(TOKENS_FILE, "utf-8")), source: "cache" }; }
    catch { /* corrupt/partial cache — fall through to a full regen */ }
  }
  return loadTokenLedger();
}

export function observabilityRoutes(router) {
  // C10 multi-source token ledger.
  router.get("/observability/tokens", async (req, res) => {
    try {
      const { payload, source } = await loadTokenLedger();
      sendJson(res, { ...payload, _source: source });
    } catch (err) {
      sendError(res, 500, `Token ledger aggregation failed: ${err.message}`);
    }
  });

  // Hub request stats / waste-pct / top paths. (Was the body of /tokens before C10.)
  router.get("/observability/requests", async (req, res) => {
    try {
      const windowMinutes = req.query?.window ? parseInt(req.query.window, 10) : undefined;
      const { payload, source } = await loadOrRegenerate(
        SUMMARY_FILE, SUMMARY_AGGREGATOR,
        { windowMinutes },
        (p) => !windowMinutes || p.windowMinutes === windowMinutes,
      );
      sendJson(res, { ...payload, _source: source });
    } catch (err) {
      sendError(res, 500, `Telemetry aggregation failed: ${err.message}`);
    }
  });
}
