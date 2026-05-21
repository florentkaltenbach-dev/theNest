// hub/src/ssh-discovery.js
//
// Polls SSH-managed hosts for `docker ps` and surfaces the result in the same shape getAgentData() returns. Aliases come from /opt/nest/config/ssh-hosts.json. On poll failure, the next interval doubles (cap 600s); a successful poll resets. Exports: startSshDiscovery(), getSshDiscovery(). Depends: ./ssh-exec.js, config/ssh-hosts.json.

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { runSsh } from "./ssh-exec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, "../..");
const CONFIG_PATH = process.env.NEST_SSH_HOSTS || join(NEST_ROOT, "config/ssh-hosts.json");
const MAX_INTERVAL_MS = 600_000;  // backoff cap

const cache = new Map();
/** @type {Map<string, { alias: string, label: string, baseIntervalMs: number, currentIntervalMs: number, failures: number, timer: NodeJS.Timeout|null, stopped: boolean }>} */
const hostStates = new Map();

/**
 * Run `ssh <alias> docker ps --format '{{json .}}'` and parse each line.
 * @param {string} alias
 * @returns {Promise<{ ok: boolean, containers: any[], error?: string, lastSeen: number }>}
 */
async function pollHost(alias) {
  const r = await runSsh(alias, "docker ps --format '{{json .}}'", { timeoutMs: 30_000 });
  if (!r.ok) {
    const reason = r.timedOut
      ? "ssh timeout"
      : r.exitCode === null
        ? `ssh error: ${r.stderr.slice(0, 200)}`
        : `ssh exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`;
    return { ok: false, containers: [], error: reason, lastSeen: Date.now() };
  }
  const containers = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const c = JSON.parse(line);
      containers.push({
        id: c.ID,
        name: c.Names,
        image: c.Image,
        status: c.State || "running",
        statusText: c.Status,
      });
    } catch {
      // Skip malformed lines but keep going.
    }
  }
  return { ok: true, containers, lastSeen: Date.now() };
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { hosts: [] };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch (e) {
    console.warn(`ssh-discovery: bad config at ${CONFIG_PATH}: ${e.message}`);
    return { hosts: [] };
  }
}

/**
 * Run one tick for a host, update cache + backoff state, schedule the next tick.
 * @param {ReturnType<typeof hostStates.get>} state
 */
async function tick(state) {
  if (state.stopped) return;
  const result = await pollHost(state.alias);
  cache.set(state.alias, { alias: state.alias, label: state.label, ...result, backoff: { failures: state.failures, nextMs: state.currentIntervalMs } });
  if (result.ok) {
    if (state.failures > 0) {
      console.log(`ssh-discovery: ${state.alias} recovered after ${state.failures} failure(s)`);
    }
    state.failures = 0;
    state.currentIntervalMs = state.baseIntervalMs;
  } else {
    state.failures += 1;
    state.currentIntervalMs = Math.min(state.currentIntervalMs * 2, MAX_INTERVAL_MS);
    if (state.failures === 1 || state.failures % 5 === 0) {
      console.warn(`ssh-discovery: ${state.alias} poll failed (${state.failures}x): ${result.error}; next in ${Math.round(state.currentIntervalMs / 1000)}s`);
    }
  }
  if (state.stopped) return;
  state.timer = setTimeout(() => tick(state), state.currentIntervalMs);
  state.timer.unref?.();
}

/**
 * Start polling each configured host. Idempotent — repeat calls cancel and
 * re-arm timers against the current config without duplicating them.
 */
export function startSshDiscovery() {
  for (const s of hostStates.values()) {
    s.stopped = true;
    if (s.timer) clearTimeout(s.timer);
  }
  hostStates.clear();

  const cfg = loadConfig();
  for (const h of cfg.hosts || []) {
    const alias = h.alias;
    if (!alias) continue;
    const baseIntervalMs = (h.poll_seconds || 60) * 1000;
    const state = {
      alias,
      label: h.label || alias,
      baseIntervalMs,
      currentIntervalMs: baseIntervalMs,
      failures: 0,
      timer: null,
      stopped: false,
    };
    hostStates.set(alias, state);
    tick(state).catch(() => {});  // first tick immediately
  }
}

/**
 * Get cached SSH-discovery results in the same shape as agentData entries.
 * @returns {{ hostname: string, label: string, connected: boolean, lastSeen: number, containers: any[], error?: string, source: string, backoff?: { failures: number, nextMs: number } }[]}
 */
export function getSshDiscovery() {
  const out = [];
  for (const v of cache.values()) {
    out.push({
      hostname: v.alias,
      label: v.label,
      source: "ssh",
      connected: !!v.ok,
      lastSeen: v.lastSeen,
      containers: v.containers,
      error: v.error,
      backoff: v.backoff,
    });
  }
  return out;
}
