// ── servers.js ────────────────────────────────────────
// Hetzner Cloud server management (28+ routes)
// ──────────────────────────────────────────────────────
import { sendJson, sendError, parseQuery } from '../server.js';

const HETZNER_API = "https://api.hetzner.cloud/v1";

function hetznerHeaders(json = false) {
  const h = { Authorization: `Bearer ${process.env.HETZNER_API_TOKEN}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function requireToken(res) {
  if (!process.env.HETZNER_API_TOKEN) {
    sendError(res, 500, "HETZNER_API_TOKEN not configured");
    return false;
  }
  return true;
}

async function hetznerError(apiRes, res) {
  const err = await apiRes.json().catch(() => ({}));
  return sendJson(res, { error: "Hetzner API error", details: err }, apiRes.status);
}

/** Map a period shorthand to { start, end } ISO strings. */
function periodToRange(period) {
  const end = new Date();
  const ms = {
    "1h": 3600000,
    "6h": 6 * 3600000,
    "24h": 24 * 3600000,
    "7d": 7 * 24 * 3600000,
    "30d": 30 * 24 * 3600000,
  };
  const delta = ms[period] ?? ms["1h"];
  const start = new Date(end.getTime() - delta);
  return { start: start.toISOString(), end: end.toISOString() };
}

function mapServer(s) {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    ip: s.public_net.ipv4?.ip ?? null,
    ipv6: s.public_net.ipv6?.ip ?? null,
    type: s.server_type.name,
    typeDescription: s.server_type.description,
    cores: s.server_type.cores,
    memory: s.server_type.memory,
    disk: s.server_type.disk,
    location: `${s.datacenter.location.city}, ${s.datacenter.location.country}`,
    datacenter: s.datacenter.name,
    image: s.image?.description ?? "Unknown",
    created: s.created,
    inTraffic: s.ingoing_traffic,
    outTraffic: s.outgoing_traffic,
    includedTraffic: s.included_traffic,
    rescue: s.rescue_enabled,
    backups: !!s.backup_window,
    labels: s.labels,
  };
}

export function serverRoutes(router) {
  // ── List servers ──────────────────────────────────────
  router.get("/servers", async (req, res) => {
    if (!requireToken(res)) return;

    const apiRes = await fetch(`${HETZNER_API}/servers`, { headers: hetznerHeaders() });
    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { servers: data.servers.map(mapServer) });
  });

  // ── Get server detail with metrics ────────────────────
  router.get("/servers/:id", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const [serverRes, metricsRes] = await Promise.all([
      fetch(`${HETZNER_API}/servers/${id}`, { headers: hetznerHeaders() }),
      fetch(
        `${HETZNER_API}/servers/${id}/metrics?type=cpu,disk,network&start=${new Date(Date.now() - 3600000).toISOString()}&end=${new Date().toISOString()}`,
        { headers: hetznerHeaders() }
      ),
    ]);

    if (!serverRes.ok) return sendError(res, serverRes.status, "Server not found");

    const serverData = await serverRes.json();
    const server = mapServer(serverData.server);

    let metrics = null;
    if (metricsRes.ok) {
      const m = await metricsRes.json();
      metrics = m.metrics;
    }

    sendJson(res, { server, metrics });
  });

  // ── Server actions (reboot, shutdown, power on, reset) ─
  router.post("/servers/:id/action", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { action } = req.body;
    const allowed = ["reboot", "shutdown", "poweron", "reset"];
    if (!allowed.includes(action)) {
      return sendError(res, 400, `Invalid action. Allowed: ${allowed.join(", ")}`);
    }

    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/${action}`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Get server metrics ────────────────────────────────
  router.get("/servers/:id/metrics", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const query = parseQuery(req.url);
    const type = query.type ?? "cpu,disk,network";
    const period = query.period ?? "1h";
    const { start, end } = periodToRange(period);

    const apiRes = await fetch(
      `${HETZNER_API}/servers/${id}/metrics?type=${encodeURIComponent(type)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      { headers: hetznerHeaders() }
    );

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { metrics: data.metrics });
  });

  // ── Request VNC console ───────────────────────────────
  router.post("/servers/:id/console", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/request_console`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { wss_url: data.wss_url, password: data.password, action: data.action });
  });

  // ── Enable rescue mode ────────────────────────────────
  router.post("/servers/:id/rescue", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/enable_rescue`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ type: "linux64" }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { root_password: data.root_password, action: data.action });
  });

  // ── Disable rescue mode ───────────────────────────────
  router.delete("/servers/:id/rescue", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/disable_rescue`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Rebuild server ────────────────────────────────────
  router.post("/servers/:id/rebuild", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { image } = req.body;
    if (!image) return sendError(res, 400, "image is required");

    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/rebuild`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ image }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { root_password: data.root_password, action: data.action });
  });

  // ── Resize server (change type) ───────────────────────
  router.put("/servers/:id/resize", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { server_type, upgrade_disk } = req.body;
    if (!server_type) return sendError(res, 400, "server_type is required");

    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/change_type`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ server_type, upgrade_disk: upgrade_disk ?? false }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Set reverse DNS ───────────────────────────────────
  router.put("/servers/:id/rdns", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { ip, dns_ptr } = req.body;
    if (!ip || dns_ptr === undefined) return sendError(res, 400, "ip and dns_ptr are required");

    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/change_dns_ptr`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ ip, dns_ptr }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Enable backups ────────────────────────────────────
  router.post("/servers/:id/backups", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/enable_backup`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Disable backups ───────────────────────────────────
  router.delete("/servers/:id/backups", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/disable_backup`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Attach ISO ────────────────────────────────────────
  router.post("/servers/:id/iso", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { iso } = req.body;
    if (!iso) return sendError(res, 400, "iso is required");

    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/attach_iso`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ iso }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Detach ISO ────────────────────────────────────────
  router.delete("/servers/:id/iso", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/detach_iso`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── List snapshots for server ─────────────────────────
  router.get("/servers/:id/snapshots", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const apiRes = await fetch(
      `${HETZNER_API}/images?type=snapshot&sort=created:desc&status=available`,
      { headers: hetznerHeaders() }
    );

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    const serverId = Number(id);
    const snapshots = data.images.filter((img) => img.created_from?.id === serverId);
    sendJson(res, { snapshots });
  });

  // ── Create snapshot ───────────────────────────────────
  router.post("/servers/:id/snapshot", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { description } = req.body ?? {};

    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/create_image`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ description: description ?? "", type: "snapshot" }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { image: data.image, action: data.action });
  });

  // ── Delete snapshot ───────────────────────────────────
  router.delete("/snapshots/:id", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/images/${id}`, {
      method: "DELETE",
      headers: hetznerHeaders(),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    sendJson(res, { success: true });
  });

  // ── List firewalls ────────────────────────────────────
  router.get("/firewalls", async (req, res) => {
    if (!requireToken(res)) return;

    const apiRes = await fetch(`${HETZNER_API}/firewalls`, { headers: hetznerHeaders() });
    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { firewalls: data.firewalls });
  });

  // ── Apply firewall to server ──────────────────────────
  router.post("/servers/:id/firewall", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { firewall_id } = req.body;
    if (!firewall_id) return sendError(res, 400, "firewall_id is required");

    const apiRes = await fetch(`${HETZNER_API}/firewalls/${firewall_id}/actions/apply_to_resources`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ apply_to: [{ type: "server", server: { id: Number(id) } }] }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, actions: data.actions });
  });

  // ── Remove firewall from server ───────────────────────
  router.delete("/servers/:id/firewall/:fwId", async (req, res) => {
    if (!requireToken(res)) return;

    const { id, fwId } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/firewalls/${fwId}/actions/remove_from_resources`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ remove_from: [{ type: "server", server: { id: Number(id) } }] }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, actions: data.actions });
  });

  // ── List volumes ──────────────────────────────────────
  router.get("/volumes", async (req, res) => {
    if (!requireToken(res)) return;

    const apiRes = await fetch(`${HETZNER_API}/volumes`, { headers: hetznerHeaders() });
    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { volumes: data.volumes });
  });

  // ── Attach volume to server ───────────────────────────
  router.post("/servers/:id/volume/attach", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { volume_id } = req.body;
    if (!volume_id) return sendError(res, 400, "volume_id is required");

    const apiRes = await fetch(`${HETZNER_API}/volumes/${volume_id}/actions/attach`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ server: Number(id) }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Detach volume ─────────────────────────────────────
  router.post("/volumes/:volId/detach", async (req, res) => {
    if (!requireToken(res)) return;

    const { volId } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/volumes/${volId}/actions/detach`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Resize volume ─────────────────────────────────────
  router.post("/volumes/:volId/resize", async (req, res) => {
    if (!requireToken(res)) return;

    const { volId } = req.params;
    const { size } = req.body;
    if (!size) return sendError(res, 400, "size is required");

    const apiRes = await fetch(`${HETZNER_API}/volumes/${volId}/actions/resize`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ size }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── List server types ─────────────────────────────────
  router.get("/server-types", async (req, res) => {
    if (!requireToken(res)) return;

    const apiRes = await fetch(`${HETZNER_API}/server_types`, { headers: hetznerHeaders() });
    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { server_types: data.server_types });
  });

  // ── List images (for rebuild) ─────────────────────────
  router.get("/images", async (req, res) => {
    if (!requireToken(res)) return;

    const apiRes = await fetch(`${HETZNER_API}/images?type=system&sort=description:asc`, {
      headers: hetznerHeaders(),
    });
    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { images: data.images });
  });

  // ── List ISOs ─────────────────────────────────────────
  router.get("/isos", async (req, res) => {
    if (!requireToken(res)) return;

    const apiRes = await fetch(`${HETZNER_API}/isos?sort=description:asc`, {
      headers: hetznerHeaders(),
    });
    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { isos: data.isos });
  });

  // ── Update server (name/labels) ───────────────────────
  router.put("/servers/:id", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { name, labels } = req.body;

    const body = {};
    if (name !== undefined) body.name = name;
    if (labels !== undefined) body.labels = labels;

    const apiRes = await fetch(`${HETZNER_API}/servers/${id}`, {
      method: "PUT",
      headers: hetznerHeaders(true),
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { server: mapServer(data.server) });
  });

  // ── Delete server ─────────────────────────────────────
  router.delete("/servers/:id", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const apiRes = await fetch(`${HETZNER_API}/servers/${id}`, {
      method: "DELETE",
      headers: hetznerHeaders(),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });

  // ── Create server ─────────────────────────────────────
  router.post("/servers", async (req, res) => {
    if (!requireToken(res)) return;

    const { name, server_type, image } = req.body;
    if (!name || !server_type || !image) {
      return sendError(res, 400, "name, server_type, and image are required");
    }

    const apiRes = await fetch(`${HETZNER_API}/servers`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify(req.body),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, {
      server: mapServer(data.server),
      action: data.action,
      root_password: data.root_password,
    });
  });

  // ── Change protection ─────────────────────────────────
  router.put("/servers/:id/protection", async (req, res) => {
    if (!requireToken(res)) return;

    const { id } = req.params;
    const { delete: del, rebuild } = req.body;

    const apiRes = await fetch(`${HETZNER_API}/servers/${id}/actions/change_protection`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ delete: del, rebuild }),
    });

    if (!apiRes.ok) return hetznerError(apiRes, res);

    const data = await apiRes.json();
    sendJson(res, { success: true, action: data.action });
  });
}
