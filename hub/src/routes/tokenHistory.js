// hub/src/routes/tokenHistory.js
//
// Records a 5-min time series of remaining% per capped token source to token-history.jsonl
// and serves it for the observability page's Task-Manager-style graphs. Exports: tokenHistoryRoutes(router).
// Background sampler starts on import (disable with NEST_DISABLE_TOKEN_SAMPLER). Depends: loadTokenLedger from observability.js.

import { readFile, appendFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { sendJson, sendError } from '../server.js';
import { loadTokenLedger } from './observability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, "../../..");

const HISTORY_FILE = process.env.NEST_TOKEN_HISTORY || join(NEST_ROOT, "data/token-history.jsonl");
const SAMPLE_INTERVAL_MS = 5 * 60 * 1000;   // ledger refreshes ~5min, so sample at the same cadence
const SAMPLES_PER_DAY = Math.round((24 * 60) / 5);   // 288 at 5-min resolution
const RETENTION_DAYS = Number(process.env.NEST_TOKEN_HISTORY_DAYS) || 365;  // ~1yr ≈ 11 MB; kept for usage analysis
const MAX_SAMPLES = RETENTION_DAYS * SAMPLES_PER_DAY; // ~105k lines at the default 365 days
const TRIM_EVERY = SAMPLES_PER_DAY;          // amortize the full-file rewrite to ~once/day
const MAX_POINTS = 720;                       // cap points returned to the client (downsample stride)
const DEFAULT_HOURS = 24;
const MAX_HOURS = 168;                        // 7 days

let lastRecordedAt = null;
let appendsSinceTrim = 0;

/**
 * Decide the trustworthy per-slot usage signal for a source.
 * - "tokens": real token volume, but only when the engine logs complete per-message usage
 *   (metrics.usageTokensComplete === true). Codex exec-mode sessions log null, so its token
 *   sum undercounts — we deliberately skip it and fall back to capacity.
 * - "requests": a real local request counter (e.g. Hermes free-tier daily requests).
 * - "capacity": no trustworthy absolute counter, so bars are derived from the drop in the
 *   real remaining% (accurate, from the live rate-limit endpoint).
 * `counter` is the cumulative value to delta (null for capacity, which uses remaining% instead).
 * @param {Object} s
 * @returns {{ unit: string, counter: ?number }}
 */
function usageSignal(s) {
  const toks = s.metrics?.monthlyTokens ?? s.metrics?.periodTokens;
  if (typeof toks === "number" && s.metrics?.usageTokensComplete === true) return { unit: "tokens", counter: toks };
  if (typeof s.used?.amount === "number" && /request/.test(s.cap?.unit || "")) return { unit: "requests", counter: s.used.amount };
  return { unit: "capacity", counter: null };
}

/**
 * Extract a compact { t, r, w, u } sample from a ledger payload.
 * `r` = primary-window remaining% per capped source; `w` = weekly remaining% where reported;
 * `u` = cumulative usage counter (tokens or requests) for per-slot deltas.
 * Sources without a known remaining (e.g. infra request counts) are skipped.
 * @param {Object} ledger
 * @returns {{ t: number, r: Object, w: Object, u: Object }}
 */
function sampleFromLedger(ledger) {
  const r = {};
  const w = {};
  const u = {};
  for (const s of ledger.sources || []) {
    if (!s?.id || s.remaining == null || s.remaining.unknown === true) continue;
    const pct = s.remaining.percent;
    if (typeof pct !== "number") continue;
    r[s.id] = Math.round(pct);
    const weekly = s.metrics?.weekly?.remainingPct;
    if (typeof weekly === "number") w[s.id] = Math.round(weekly);
    const { counter } = usageSignal(s);
    if (counter != null) u[s.id] = counter;
  }
  return { t: Math.floor(Date.parse(ledger.generatedAt || "") / 1000) || Math.floor(Date.now() / 1000), r, w, u };
}

/**
 * Sample the current ledger and append one line to the history file, trimming to MAX_SAMPLES.
 * Skips writing if no capped source reported a known remaining value.
 */
async function recordSnapshot() {
  const { payload } = await loadTokenLedger();
  const entry = sampleFromLedger(payload);
  if (Object.keys(entry.r).length === 0) return;

  await mkdir(dirname(HISTORY_FILE), { recursive: true });
  await appendFile(HISTORY_FILE, JSON.stringify(entry) + "\n");
  lastRecordedAt = new Date(entry.t * 1000).toISOString();

  // Trim oldest lines past the retention cap. Reading + rewriting the whole file is the
  // costly part at a year of data, so only do it periodically (≈once/day), not every sample.
  if (++appendsSinceTrim >= TRIM_EVERY) {
    appendsSinceTrim = 0;
    const lines = (await readFile(HISTORY_FILE, "utf-8")).trim().split("\n").filter(Boolean);
    if (lines.length > MAX_SAMPLES) {
      await writeFile(HISTORY_FILE, lines.slice(-MAX_SAMPLES).join("\n") + "\n");
    }
  }
}

/**
 * Read history samples within the last `hours`, downsampled to <= MAX_POINTS points.
 * @param {number} hours
 * @returns {Promise<Array<{t:number,r:Object,w:Object}>>}
 */
async function readHistory(hours) {
  if (!existsSync(HISTORY_FILE)) return [];
  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
  const lines = (await readFile(HISTORY_FILE, "utf-8")).trim().split("\n").filter(Boolean);
  // Samples are 5-min apart and newest-last, so the window holds at most ~hours*12 lines;
  // parse only that tail (plus a day of slack for gaps) instead of a year of JSON.
  const tail = lines.slice(-(Math.ceil((hours * SAMPLES_PER_DAY) / 24) + SAMPLES_PER_DAY));
  const samples = tail
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((e) => e && e.t >= cutoff);

  if (samples.length <= MAX_POINTS) return samples;
  const stride = Math.ceil(samples.length / MAX_POINTS);
  const out = samples.filter((_, i) => i % stride === 0);
  if (out[out.length - 1] !== samples[samples.length - 1]) out.push(samples[samples.length - 1]);
  return out;
}

/**
 * Pull current source metadata (label, reset cadence, next-reset time) from the latest
 * ledger so the chart can label series and mark when capacity refills.
 * @returns {Promise<Array<{id:string,label:string,resetCadence:string,nextResetAt:?string}>>}
 */
async function sourceMeta() {
  try {
    const { payload } = await loadTokenLedger();
    return (payload.sources || [])
      .filter((s) => s?.id && s.remaining != null && s.remaining.unknown !== true && typeof s.remaining.percent === "number")
      .map((s) => ({
        id: s.id,
        label: s.label || s.id,
        resetCadence: s.period?.resetCadence || null,
        nextResetAt: s.period?.end || null,
        usageUnit: usageSignal(s).unit,
      }));
  } catch {
    return [];
  }
}

// ── Boot: schedule background sampling ───────────────────────────────────────
if (!process.env.NEST_DISABLE_TOKEN_SAMPLER) {
  recordSnapshot().catch((e) => console.warn('initial token-history sample failed:', e.message));
  const timer = setInterval(
    () => recordSnapshot().catch((e) => console.warn('token-history sample failed:', e.message)),
    SAMPLE_INTERVAL_MS,
  );
  timer.unref();
}

/**
 * Register the token-history endpoint.
 * @param {Object} router
 */
export function tokenHistoryRoutes(router) {
  // Time series of remaining% per capped source. Query: ?hours=24 (1..168).
  router.get("/observability/tokens/history", async (req, res) => {
    try {
      let hours = parseInt(req.query?.hours, 10);
      if (!Number.isFinite(hours)) hours = DEFAULT_HOURS;
      hours = Math.max(1, Math.min(MAX_HOURS, hours));
      const [samples, sources] = await Promise.all([readHistory(hours), sourceMeta()]);
      sendJson(res, {
        generatedAt: new Date().toISOString(),
        hours,
        sampleIntervalSec: SAMPLE_INTERVAL_MS / 1000,
        lastRecordedAt,
        sources,
        samples,
      });
    } catch (err) {
      sendError(res, 500, `Token history read failed: ${err.message}`);
    }
  });
}
