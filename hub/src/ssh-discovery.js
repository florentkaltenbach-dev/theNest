// hub/src/ssh-discovery.js
//
// Polls SSH-managed hosts for `docker ps` and surfaces the result in the same shape getAgentData() returns. Aliases come from /opt/nest/config/ssh-hosts.json. Exports: startSshDiscovery(), getSshDiscovery(). Depends: ssh aliases configured in ~/.ssh/config (read by the host's ssh client).

import { readFileSync, existsSync } from "fs";
import { spawn } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEST_ROOT = join(__dirname, "../..");
const CONFIG_PATH = process.env.NEST_SSH_HOSTS || join(NEST_ROOT, "config/ssh-hosts.json");

const cache = new Map();

/**
 * Run `ssh <alias> docker ps --format '{{json .}}'` and parse each line.
 * @param {string} alias
 * @returns {Promise<{ ok: boolean, containers: any[], error?: string, lastSeen: number }>}
 */
function pollHost(alias) {
  return new Promise((resolve) => {
    const child = spawn(
      "ssh",
      ["-o", "ConnectTimeout=10", "-o", "BatchMode=yes", alias, "docker ps --format '{{json .}}'"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => resolve({ ok: false, containers: [], error: e.message, lastSeen: Date.now() }));
    child.on("close", (code) => {
      if (code !== 0) {
        return resolve({ ok: false, containers: [], error: `ssh exit ${code}: ${stderr.trim().slice(0, 200)}`, lastSeen: Date.now() });
      }
      const containers = [];
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
          const c = JSON.parse(line);
          // Normalize to the agent-data container shape (id/name/image/status).
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
      resolve({ ok: true, containers, lastSeen: Date.now() });
    });
    // Hard timeout — if ssh hangs, kill it.
    setTimeout(() => child.kill("SIGKILL"), 30_000);
  });
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
 * Start polling each configured host on its own interval. Idempotent — repeat
 * calls update intervals to current config without duplicating timers.
 */
let timers = [];
export function startSshDiscovery() {
  for (const t of timers) clearInterval(t);
  timers = [];
  const cfg = loadConfig();
  for (const h of cfg.hosts || []) {
    const alias = h.alias;
    if (!alias) continue;
    const interval = (h.poll_seconds || 60) * 1000;
    const tick = async () => {
      const result = await pollHost(alias);
      cache.set(alias, { alias, label: h.label || alias, ...result });
    };
    tick().catch(() => {});  // first tick immediately
    timers.push(setInterval(tick, interval));
  }
}

/**
 * Get cached SSH-discovery results in the same shape as agentData entries.
 * @returns {{ hostname: string, label: string, connected: boolean, lastSeen: number, containers: any[], error?: string, source: string }[]}
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
    });
  }
  return out;
}
