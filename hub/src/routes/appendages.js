// hub/src/routes/appendages.js
//
// Lists JSON-defined appendage contracts from /opt/nest/appendages/, marks installed status from agent data + SSH-discovered hosts, dispatches install/uninstall, and offers logs/inspect/restart on brownfield (discovery) appendages via SSH. Exports: appendageRoutes(router). Depends: ../appendages.js, ../ws/agentHandler.js, ../ssh-discovery.js, ../ssh-exec.js.
import { getAgentData, sendToAgent } from "../ws/agentHandler.js";
import { getSshDiscovery } from "../ssh-discovery.js";
import { runSsh } from "../ssh-exec.js";
import { sendJson, sendError } from '../server.js';
import { loadAppendages, toLegacyCatalogEntry } from '../appendages.js';

/**
 * Snapshot of every host the hub knows about, regardless of source.
 * @returns {{ hostname: string, source: string, connected: boolean, containers: any[] }[]}
 */
function getAllHosts() {
  const agents = getAgentData() || [];
  const ssh = getSshDiscovery() || [];
  return [...agents.map((a) => ({ ...a, source: "agent" })), ...ssh];
}

function getStatusFor(def, allHosts) {
  if (def.discovery) {
    const host = allHosts.find((h) => h.hostname === def.discovery.host);
    if (!host) return { installed: false, status: "host not reachable", container: null, host: def.discovery.host };
    const containers = host.containers || [];
    const matched = (def.discovery.containers?.match_any || []).map((p) => {
      const re = new RegExp(p);
      return containers.find((c) => re.test(c.name || ""));
    });
    const allFound = matched.every(Boolean);
    return {
      installed: allFound,
      status: allFound ? "running" : (host.connected ? "partial" : "host offline"),
      host: def.discovery.host,
      matched: matched.map((c) => c?.name || null),
      missing: (def.discovery.containers?.match_any || []).filter((_, i) => !matched[i]),
    };
  }
  // Greenfield (container/compose) — match against any agent's running containers.
  const containers = allHosts.flatMap((h) => h.containers || []);
  const imgRoot = def.container?.image?.split(":")?.[0];
  const c = containers.find((c) => (imgRoot && c.image?.includes(imgRoot)) || c.name === def.name);
  return { installed: !!c, status: c?.status || "not installed", container: c?.id || null };
}

/**
 * Resolve a brownfield appendage by name. Returns the def, the SSH host record,
 * and the FULL set of running containers matching any of its match_any
 * patterns. Use this as the whitelist for lifecycle command targets.
 * @param {string} name
 * @returns {{ error?: string, status?: number, def?: any, host?: any, matched?: string[] }}
 */
function resolveBrownfield(name) {
  const { definitions } = loadAppendages();
  const def = definitions.find((d) => d.name === name);
  if (!def) return { error: `Appendage "${name}" not found`, status: 404 };
  if (!def.discovery) return { error: `"${name}" is not a brownfield (discovery) appendage`, status: 400 };
  const host = (getSshDiscovery() || []).find((h) => h.hostname === def.discovery.host);
  if (!host) return { error: `Host "${def.discovery.host}" not in ssh-hosts.json`, status: 404 };
  if (!host.connected) return { error: `Host "${def.discovery.host}" not currently reachable (${host.error || "no data yet"})`, status: 503 };
  const patterns = (def.discovery.containers?.match_any || []).map((p) => new RegExp(p));
  const matched = (host.containers || [])
    .filter((c) => patterns.some((re) => re.test(c.name || "")))
    .map((c) => c.name);
  return { def, host, matched };
}

/**
 * Pick a container name from the matched whitelist. If `arg` is given, it must
 * be in the whitelist (exact match — no substrings, no patterns). If omitted
 * and exactly one container matched, that one is used; otherwise null.
 * @param {{ matched: string[] }} ctx
 * @param {string|undefined} arg
 * @returns {string|null}
 */
function pickContainer(ctx, arg) {
  if (arg) return ctx.matched.includes(arg) ? arg : null;
  return ctx.matched.length === 1 ? ctx.matched[0] : null;
}

export function appendageRoutes(router) {
  router.get("/appendages", async (req, res) => {
    const { definitions, invalid } = loadAppendages();
    const allHosts = getAllHosts();
    const appendages = definitions.map((def) => ({
      ...toLegacyCatalogEntry(def),
      ...getStatusFor(def, allHosts),
    }));
    sendJson(res, { appendages, invalid });
  });

  router.get("/appendages/catalog", async (req, res) => {
    const { definitions, invalid } = loadAppendages();
    sendJson(res, { catalog: definitions.map(toLegacyCatalogEntry), invalid });
  });

  router.get("/appendages/hosts", async (req, res) => {
    sendJson(res, { hosts: getAllHosts() });
  });

  router.get("/appendages/:name", async (req, res) => {
    const { definitions } = loadAppendages();
    const def = definitions.find((d) => d.name === req.params.name);
    if (!def) return sendError(res, 404, `Appendage "${req.params.name}" not found`);
    sendJson(res, { appendage: def });
  });

  router.post("/appendages/install", async (req, res) => {
    const { appendageId, hostname } = req.body || {};
    if (!appendageId || !hostname) return sendError(res, 400, "appendageId and hostname required");
    const { definitions } = loadAppendages();
    const def = definitions.find((d) => d.name === appendageId);
    if (!def) return sendError(res, 404, `Appendage "${appendageId}" not found`);
    if (def.discovery) {
      return sendError(res, 400, `"${appendageId}" is a brownfield (discovery) appendage — there is no install path; status is observed, not provisioned.`);
    }

    const legacy = toLegacyCatalogEntry(def);

    // env_from_secrets: hub looks each name up in its own process.env (which
    // includes config.env via systemd EnvironmentFile) and merges into the
    // env shipped to the agent. Phase 4 will replace this with age-encrypted
    // delivery; today this is a plaintext-over-WS passthrough.
    const secretEnv = {};
    for (const k of (def.container?.env_from_secrets || [])) {
      if (process.env[k] !== undefined) secretEnv[k] = process.env[k];
    }

    const cmd = legacy.mode === "compose"
      ? {
          command: "install_compose_appendage",
          name: def.name,
          git: def.compose.git || null,
          inline: def.compose.inline || null,
          branch: def.compose.branch || "main",
          file: def.compose.file || "docker-compose.yml",
          init_script: def.compose.init_script || null,
          env: { ...legacy.env, ...secretEnv },
        }
      : {
          command: "install_appendage",
          image: def.container.image,
          name: def.name,
          ports: legacy.ports,
          volumes: legacy.volumes,
          env: { ...legacy.env, ...secretEnv },
        };

    const sent = sendToAgent(hostname, cmd);
    if (!sent) return sendError(res, 404, `Agent "${hostname}" not connected`);
    sendJson(res, { success: true, message: `Installing ${def.name} on ${hostname}...`, mode: legacy.mode });
  });

  // ── Brownfield lifecycle: logs / inspect / restart ─────────────────────
  // Only valid for `discovery:` appendages. Container arg is whitelisted
  // against the set actually matching match_any patterns on the live host —
  // we never interpolate raw user input into the SSH command.

  router.get("/appendages/:name/logs", async (req, res) => {
    const ctx = resolveBrownfield(req.params.name);
    if (ctx.error) return sendError(res, ctx.status, ctx.error);
    const container = pickContainer(ctx, req.query?.container);
    if (!container) return sendError(res, 400, `container query param required; one of: ${ctx.matched.join(", ") || "(none running)"}`);
    let lines = parseInt(req.query?.lines, 10);
    if (!Number.isFinite(lines) || lines <= 0) lines = 200;
    lines = Math.min(lines, 2000);
    const r = await runSsh(ctx.def.discovery.host, `docker logs --tail ${lines} --timestamps ${container}`, { timeoutMs: 15_000, stderrLimit: 200_000 });
    if (!r.ok && !r.stdout && !r.stderr) return sendError(res, 502, `ssh failed: exit=${r.exitCode} timedOut=${r.timedOut}`);
    // docker writes logs to *stderr* in the absence of -t; merge.
    sendJson(res, { container, lines, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, durationMs: r.durationMs });
  });

  router.get("/appendages/:name/inspect", async (req, res) => {
    const ctx = resolveBrownfield(req.params.name);
    if (ctx.error) return sendError(res, ctx.status, ctx.error);
    const container = pickContainer(ctx, req.query?.container);
    if (!container) return sendError(res, 400, `container query param required; one of: ${ctx.matched.join(", ") || "(none running)"}`);
    const r = await runSsh(ctx.def.discovery.host, `docker inspect ${container}`, { timeoutMs: 15_000, stderrLimit: 4096 });
    if (!r.ok) return sendError(res, 502, `inspect failed: exit=${r.exitCode} ${r.stderr.slice(0, 200)}`);
    try {
      sendJson(res, { container, inspect: JSON.parse(r.stdout) });
    } catch (e) {
      sendError(res, 502, `inspect returned non-JSON: ${e.message}`);
    }
  });

  router.post("/appendages/:name/restart", async (req, res) => {
    if (req.user?.role !== "admin") return sendError(res, 403, "Admin only");
    const ctx = resolveBrownfield(req.params.name);
    if (ctx.error) return sendError(res, ctx.status, ctx.error);
    const container = pickContainer(ctx, req.body?.container);
    if (!container) return sendError(res, 400, `body.container required; one of: ${ctx.matched.join(", ") || "(none running)"}`);
    const r = await runSsh(ctx.def.discovery.host, `docker restart ${container}`, { timeoutMs: 60_000 });
    if (!r.ok) return sendError(res, 502, `restart failed: exit=${r.exitCode} ${r.stderr.slice(0, 200)}`);
    sendJson(res, { container, restarted: true, durationMs: r.durationMs, stdout: r.stdout.trim() });
  });

  router.post("/appendages/uninstall", async (req, res) => {
    const { appendageId, hostname } = req.body || {};
    if (!appendageId || !hostname) return sendError(res, 400, "appendageId and hostname required");
    const { definitions } = loadAppendages();
    const def = definitions.find((d) => d.name === appendageId);
    if (def?.discovery) {
      return sendError(res, 400, `"${appendageId}" is a brownfield appendage — uninstall happens out-of-band on the source host.`);
    }
    const mode = def?.compose ? "compose" : "container";
    const cmd = mode === "compose"
      ? { command: "remove_compose_appendage", name: appendageId, file: def.compose.file || "docker-compose.yml" }
      : { command: "remove_appendage", name: appendageId };
    const sent = sendToAgent(hostname, cmd);
    if (!sent) return sendError(res, 404, `Agent "${hostname}" not connected`);
    sendJson(res, { success: true, message: `Removing ${appendageId} on ${hostname}...`, mode });
  });
}
