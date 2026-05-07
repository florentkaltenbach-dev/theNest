// hub/src/alerts.js
//
// Periodic watchdog that mails when host or appendage state changes (agent disconnects, brownfield appendage's containers disappear, etc.). State is tracked in memory — alerts fire only on transitions between *known* states. A null classification (no signal yet) never produces a transition. Exports: startAlertWatchdog(). Depends: ./mail.js, ./ws/agentHandler.js, ./ssh-discovery.js, ./appendages.js.

import { getAgentData } from "./ws/agentHandler.js";
import { getSshDiscovery } from "./ssh-discovery.js";
import { loadAppendages } from "./appendages.js";
import { sendMail } from "./mail.js";

const HOST_OFFLINE_THRESHOLD_MS = parseInt(process.env.NEST_HOST_OFFLINE_THRESHOLD_MS || "180000", 10);
const TICK_MS = parseInt(process.env.NEST_ALERT_TICK_MS || "60000", 10);

function recipients() {
  const raw = process.env.ALERT_RECIPIENTS || "ausfragezeichen@gmail.com";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

const hostState = new Map();        // hostname → "ok" | "offline" | null
const appendageState = new Map();   // appendageId → "installed" | "missing" | "partial" | null

function classifyHost(h) {
  if (!h.connected) return "offline";
  if (h.lastSeen && Date.now() - h.lastSeen > HOST_OFFLINE_THRESHOLD_MS) return "offline";
  return "ok";
}

/**
 * @returns {"installed" | "missing" | "partial" | null}
 *   null = no signal yet (no transitions counted while either prev or next is null).
 */
function classifyAppendage(a, hosts, isDiscovery) {
  if (isDiscovery) {
    // Discovery: target host must be reachable AND have containers reported.
    const host = hosts.find((h) => h.hostname === a.host);
    if (!host || !host.connected) return null;
    if (!Array.isArray(host.containers)) return null;
  } else {
    // Greenfield: at least one connected host must have non-empty containers,
    // otherwise the empty fleet would falsely classify everything as missing.
    const haveSignal = hosts.some((h) => h.connected && Array.isArray(h.containers) && h.containers.length > 0);
    if (!haveSignal) return null;
  }
  if (a.installed) return "installed";
  if (a.status === "partial") return "partial";
  return "missing";
}

async function notify(subject, body) {
  for (const to of recipients()) {
    try {
      await sendMail({ to, subject, body });
      console.log(`alert sent: ${subject} → ${to}`);
    } catch (e) {
      console.warn(`alert mail failed (${to}): ${e.message}`);
    }
  }
}

async function tick() {
  const hosts = [
    ...getAgentData().map((a) => ({ ...a, source: "agent" })),
    ...getSshDiscovery(),
  ];

  // ── hosts ──────────────────────────────────────────
  for (const h of hosts) {
    const next = classifyHost(h);
    const prev = hostState.get(h.hostname);
    hostState.set(h.hostname, next);
    // No alert when prev is undefined (first observation of this host) or unchanged.
    if (prev === undefined || prev === next) continue;
    if (next === "offline") {
      await notify(
        `Nest: host ${h.hostname} offline`,
        `Host ${h.hostname} (${h.source}) stopped reporting at ${new Date(h.lastSeen || Date.now()).toISOString()}.\n${h.error ? `Error: ${h.error}\n` : ""}`,
      );
    } else if (prev === "offline" && next === "ok") {
      await notify(
        `Nest: host ${h.hostname} back online`,
        `Host ${h.hostname} reconnected at ${new Date().toISOString()}.\n`,
      );
    }
  }

  // ── appendages ─────────────────────────────────────
  const { definitions } = loadAppendages();
  for (const def of definitions) {
    let a;
    if (def.discovery) {
      const host = hosts.find((h) => h.hostname === def.discovery.host);
      const containers = host?.containers || [];
      const matched = (def.discovery.containers?.match_any || []).map((p) => containers.find((c) => new RegExp(p).test(c.name || "")));
      const installed = matched.every(Boolean);
      a = {
        id: def.name,
        host: def.discovery.host,
        installed,
        status: installed ? "running" : (host?.connected ? "partial" : "host offline"),
        missing: (def.discovery.containers?.match_any || []).filter((_, i) => !matched[i]),
      };
    } else {
      const containers = hosts.flatMap((h) => h.containers || []);
      const imgRoot = def.container?.image?.split(":")?.[0];
      const c = containers.find((c) => (imgRoot && c.image?.includes(imgRoot)) || c.name === def.name);
      a = { id: def.name, installed: !!c, status: c?.status || "not installed" };
    }
    const next = classifyAppendage(a, hosts, !!def.discovery);
    const prev = appendageState.get(a.id);
    // Don't write null over a known state — that would erase context for the
    // next tick. Only update when we have a real reading.
    if (next !== null) appendageState.set(a.id, next);
    // Skip transitions involving null/undefined states.
    if (prev === undefined || prev === null || next === null || prev === next) continue;
    if (prev === "installed" && next !== "installed") {
      const detail = a.missing?.length ? `Missing patterns: ${a.missing.join(", ")}` : `Status: ${a.status}`;
      await notify(
        `Nest: appendage ${a.id} unhealthy`,
        `Appendage "${a.id}" was installed and is now ${next}.\n${detail}\nObserved at ${new Date().toISOString()}.\n`,
      );
    } else if (prev !== "installed" && next === "installed") {
      await notify(
        `Nest: appendage ${a.id} healthy`,
        `Appendage "${a.id}" is now installed and reporting healthy.\nObserved at ${new Date().toISOString()}.\n`,
      );
    }
  }
}

let timer;
export function startAlertWatchdog() {
  if (timer) clearInterval(timer);
  tick().catch((e) => console.warn(`alert watchdog tick failed: ${e.message}`));
  timer = setInterval(() => {
    tick().catch((e) => console.warn(`alert watchdog tick failed: ${e.message}`));
  }, TICK_MS);
}
