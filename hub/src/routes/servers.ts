import { FastifyInstance } from "fastify";

const HETZNER_API = "https://api.hetzner.cloud/v1";

function hetznerHeaders(json = false) {
  const h: Record<string, string> = { Authorization: `Bearer ${process.env.HETZNER_API_TOKEN}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function requireToken(reply: any): boolean {
  if (!process.env.HETZNER_API_TOKEN) {
    reply.code(500).send({ error: "HETZNER_API_TOKEN not configured" });
    return false;
  }
  return true;
}

async function hetznerError(res: Response, reply: any) {
  const err = await res.json().catch(() => ({}));
  return reply.code(res.status).send({ error: "Hetzner API error", details: err });
}

/** Map a period shorthand to { start, end } ISO strings. */
function periodToRange(period: string): { start: string; end: string } {
  const end = new Date();
  const ms: Record<string, number> = {
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

interface HetznerServer {
  id: number;
  name: string;
  status: string;
  server_type: { name: string; cores: number; memory: number; disk: number; description: string };
  datacenter: { name: string; location: { city: string; country: string } };
  public_net: {
    ipv4: { ip: string };
    ipv6: { ip: string };
  };
  image: { name: string; description: string } | null;
  created: string;
  ingoing_traffic: number | null;
  outgoing_traffic: number | null;
  included_traffic: number;
  rescue_enabled: boolean;
  backup_window: string | null;
  labels: Record<string, string>;
}

function mapServer(s: HetznerServer) {
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

export async function serverRoutes(app: FastifyInstance) {
  // ── List servers ──────────────────────────────────────
  app.get("/servers", async (req, reply) => {
    if (!requireToken(reply)) return;

    const res = await fetch(`${HETZNER_API}/servers`, { headers: hetznerHeaders() });
    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { servers: (data.servers as HetznerServer[]).map(mapServer) };
  });

  // ── Get server detail with metrics ────────────────────
  app.get<{ Params: { id: string } }>("/servers/:id", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const [serverRes, metricsRes] = await Promise.all([
      fetch(`${HETZNER_API}/servers/${id}`, { headers: hetznerHeaders() }),
      fetch(
        `${HETZNER_API}/servers/${id}/metrics?type=cpu,disk,network&start=${new Date(Date.now() - 3600000).toISOString()}&end=${new Date().toISOString()}`,
        { headers: hetznerHeaders() }
      ),
    ]);

    if (!serverRes.ok) return reply.code(serverRes.status).send({ error: "Server not found" });

    const serverData = await serverRes.json();
    const server = mapServer(serverData.server as HetznerServer);

    let metrics = null;
    if (metricsRes.ok) {
      const m = await metricsRes.json();
      metrics = m.metrics;
    }

    return { server, metrics };
  });

  // ── Server actions (reboot, shutdown, power on, reset) ─
  app.post<{ Params: { id: string }; Body: { action: string } }>("/servers/:id/action", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const { action } = req.body;
    const allowed = ["reboot", "shutdown", "poweron", "reset"];
    if (!allowed.includes(action)) {
      return reply.code(400).send({ error: `Invalid action. Allowed: ${allowed.join(", ")}` });
    }

    const res = await fetch(`${HETZNER_API}/servers/${id}/actions/${action}`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { success: true, action: data.action };
  });

  // ── 1. Get server metrics ─────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { type?: string; period?: string } }>(
    "/servers/:id/metrics",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { id } = req.params;
      const type = req.query.type ?? "cpu,disk,network";
      const period = req.query.period ?? "1h";
      const { start, end } = periodToRange(period);

      const res = await fetch(
        `${HETZNER_API}/servers/${id}/metrics?type=${encodeURIComponent(type)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
        { headers: hetznerHeaders() }
      );

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { metrics: data.metrics };
    }
  );

  // ── 2. Request VNC console ────────────────────────────
  app.post<{ Params: { id: string } }>("/servers/:id/console", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const res = await fetch(`${HETZNER_API}/servers/${id}/actions/request_console`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { wss_url: data.wss_url, password: data.password, action: data.action };
  });

  // ── 3. Enable rescue mode ─────────────────────────────
  app.post<{ Params: { id: string } }>("/servers/:id/rescue", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const res = await fetch(`${HETZNER_API}/servers/${id}/actions/enable_rescue`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ type: "linux64" }),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { root_password: data.root_password, action: data.action };
  });

  // ── 4. Disable rescue mode ────────────────────────────
  app.delete<{ Params: { id: string } }>("/servers/:id/rescue", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const res = await fetch(`${HETZNER_API}/servers/${id}/actions/disable_rescue`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { success: true, action: data.action };
  });

  // ── 5. Rebuild server ─────────────────────────────────
  app.post<{ Params: { id: string }; Body: { image: string } }>("/servers/:id/rebuild", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const { image } = req.body;
    if (!image) return reply.code(400).send({ error: "image is required" });

    const res = await fetch(`${HETZNER_API}/servers/${id}/actions/rebuild`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ image }),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { root_password: data.root_password, action: data.action };
  });

  // ── 6. Resize server (change type) ────────────────────
  app.put<{ Params: { id: string }; Body: { server_type: string; upgrade_disk: boolean } }>(
    "/servers/:id/resize",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { id } = req.params;
      const { server_type, upgrade_disk } = req.body;
      if (!server_type) return reply.code(400).send({ error: "server_type is required" });

      const res = await fetch(`${HETZNER_API}/servers/${id}/actions/change_type`, {
        method: "POST",
        headers: hetznerHeaders(true),
        body: JSON.stringify({ server_type, upgrade_disk: upgrade_disk ?? false }),
      });

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { success: true, action: data.action };
    }
  );

  // ── 7. Set reverse DNS ────────────────────────────────
  app.put<{ Params: { id: string }; Body: { ip: string; dns_ptr: string } }>(
    "/servers/:id/rdns",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { id } = req.params;
      const { ip, dns_ptr } = req.body;
      if (!ip || dns_ptr === undefined) return reply.code(400).send({ error: "ip and dns_ptr are required" });

      const res = await fetch(`${HETZNER_API}/servers/${id}/actions/change_dns_ptr`, {
        method: "POST",
        headers: hetznerHeaders(true),
        body: JSON.stringify({ ip, dns_ptr }),
      });

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { success: true, action: data.action };
    }
  );

  // ── 8. Enable backups ─────────────────────────────────
  app.post<{ Params: { id: string } }>("/servers/:id/backups", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const res = await fetch(`${HETZNER_API}/servers/${id}/actions/enable_backup`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { success: true, action: data.action };
  });

  // ── 9. Disable backups ────────────────────────────────
  app.delete<{ Params: { id: string } }>("/servers/:id/backups", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const res = await fetch(`${HETZNER_API}/servers/${id}/actions/disable_backup`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { success: true, action: data.action };
  });

  // ── 10. Attach ISO ────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { iso: string } }>("/servers/:id/iso", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const { iso } = req.body;
    if (!iso) return reply.code(400).send({ error: "iso is required" });

    const res = await fetch(`${HETZNER_API}/servers/${id}/actions/attach_iso`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify({ iso }),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { success: true, action: data.action };
  });

  // ── 11. Detach ISO ────────────────────────────────────
  app.delete<{ Params: { id: string } }>("/servers/:id/iso", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const res = await fetch(`${HETZNER_API}/servers/${id}/actions/detach_iso`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { success: true, action: data.action };
  });

  // ── 12. List snapshots for server ─────────────────────
  app.get<{ Params: { id: string } }>("/servers/:id/snapshots", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const res = await fetch(
      `${HETZNER_API}/images?type=snapshot&sort=created:desc&status=available`,
      { headers: hetznerHeaders() }
    );

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    const serverId = Number(id);
    const snapshots = (data.images as any[]).filter((img: any) => img.created_from?.id === serverId);
    return { snapshots };
  });

  // ── 13. Create snapshot ───────────────────────────────
  app.post<{ Params: { id: string }; Body: { description?: string } }>(
    "/servers/:id/snapshot",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { id } = req.params;
      const { description } = req.body ?? {};

      const res = await fetch(`${HETZNER_API}/servers/${id}/actions/create_image`, {
        method: "POST",
        headers: hetznerHeaders(true),
        body: JSON.stringify({ description: description ?? "", type: "snapshot" }),
      });

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { image: data.image, action: data.action };
    }
  );

  // ── 14. Delete snapshot ───────────────────────────────
  app.delete<{ Params: { id: string } }>("/snapshots/:id", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const res = await fetch(`${HETZNER_API}/images/${id}`, {
      method: "DELETE",
      headers: hetznerHeaders(),
    });

    if (!res.ok) return hetznerError(res, reply);

    return { success: true };
  });

  // ── 15. List firewalls ────────────────────────────────
  app.get("/firewalls", async (req, reply) => {
    if (!requireToken(reply)) return;

    const res = await fetch(`${HETZNER_API}/firewalls`, { headers: hetznerHeaders() });
    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { firewalls: data.firewalls };
  });

  // ── 16. Apply firewall to server ──────────────────────
  app.post<{ Params: { id: string }; Body: { firewall_id: number } }>(
    "/servers/:id/firewall",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { id } = req.params;
      const { firewall_id } = req.body;
      if (!firewall_id) return reply.code(400).send({ error: "firewall_id is required" });

      const res = await fetch(`${HETZNER_API}/firewalls/${firewall_id}/actions/apply_to_resources`, {
        method: "POST",
        headers: hetznerHeaders(true),
        body: JSON.stringify({ apply_to: [{ type: "server", server: { id: Number(id) } }] }),
      });

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { success: true, actions: data.actions };
    }
  );

  // ── 17. Remove firewall from server ───────────────────
  app.delete<{ Params: { id: string; fwId: string } }>(
    "/servers/:id/firewall/:fwId",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { id, fwId } = req.params;
      const res = await fetch(`${HETZNER_API}/firewalls/${fwId}/actions/remove_from_resources`, {
        method: "POST",
        headers: hetznerHeaders(true),
        body: JSON.stringify({ remove_from: [{ type: "server", server: { id: Number(id) } }] }),
      });

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { success: true, actions: data.actions };
    }
  );

  // ── 18. List volumes ──────────────────────────────────
  app.get("/volumes", async (req, reply) => {
    if (!requireToken(reply)) return;

    const res = await fetch(`${HETZNER_API}/volumes`, { headers: hetznerHeaders() });
    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { volumes: data.volumes };
  });

  // ── 19. Attach volume to server ───────────────────────
  app.post<{ Params: { id: string }; Body: { volume_id: number } }>(
    "/servers/:id/volume/attach",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { id } = req.params;
      const { volume_id } = req.body;
      if (!volume_id) return reply.code(400).send({ error: "volume_id is required" });

      const res = await fetch(`${HETZNER_API}/volumes/${volume_id}/actions/attach`, {
        method: "POST",
        headers: hetznerHeaders(true),
        body: JSON.stringify({ server: Number(id) }),
      });

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { success: true, action: data.action };
    }
  );

  // ── 20. Detach volume ─────────────────────────────────
  app.post<{ Params: { volId: string } }>("/volumes/:volId/detach", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { volId } = req.params;
    const res = await fetch(`${HETZNER_API}/volumes/${volId}/actions/detach`, {
      method: "POST",
      headers: hetznerHeaders(),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { success: true, action: data.action };
  });

  // ── 21. Resize volume ─────────────────────────────────
  app.post<{ Params: { volId: string }; Body: { size: number } }>(
    "/volumes/:volId/resize",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { volId } = req.params;
      const { size } = req.body;
      if (!size) return reply.code(400).send({ error: "size is required" });

      const res = await fetch(`${HETZNER_API}/volumes/${volId}/actions/resize`, {
        method: "POST",
        headers: hetznerHeaders(true),
        body: JSON.stringify({ size }),
      });

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { success: true, action: data.action };
    }
  );

  // ── 22. List server types ─────────────────────────────
  app.get("/server-types", async (req, reply) => {
    if (!requireToken(reply)) return;

    const res = await fetch(`${HETZNER_API}/server_types`, { headers: hetznerHeaders() });
    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { server_types: data.server_types };
  });

  // ── 23. List images (for rebuild) ─────────────────────
  app.get("/images", async (req, reply) => {
    if (!requireToken(reply)) return;

    const res = await fetch(`${HETZNER_API}/images?type=system&sort=description:asc`, {
      headers: hetznerHeaders(),
    });
    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { images: data.images };
  });

  // ── 24. List ISOs ─────────────────────────────────────
  app.get("/isos", async (req, reply) => {
    if (!requireToken(reply)) return;

    const res = await fetch(`${HETZNER_API}/isos?sort=description:asc`, {
      headers: hetznerHeaders(),
    });
    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { isos: data.isos };
  });

  // ── 25. Update server (name/labels) ───────────────────
  app.put<{ Params: { id: string }; Body: { name?: string; labels?: Record<string, string> } }>(
    "/servers/:id",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { id } = req.params;
      const { name, labels } = req.body;

      const body: Record<string, any> = {};
      if (name !== undefined) body.name = name;
      if (labels !== undefined) body.labels = labels;

      const res = await fetch(`${HETZNER_API}/servers/${id}`, {
        method: "PUT",
        headers: hetznerHeaders(true),
        body: JSON.stringify(body),
      });

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { server: mapServer(data.server as HetznerServer) };
    }
  );

  // ── 26. Delete server ─────────────────────────────────
  app.delete<{ Params: { id: string } }>("/servers/:id", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { id } = req.params;
    const res = await fetch(`${HETZNER_API}/servers/${id}`, {
      method: "DELETE",
      headers: hetznerHeaders(),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return { success: true, action: data.action };
  });

  // ── 27. Create server ─────────────────────────────────
  app.post<{
    Body: {
      name: string;
      server_type: string;
      image: string;
      location?: string;
      ssh_keys?: number[];
      user_data?: string;
      labels?: Record<string, string>;
      automount?: boolean;
      volumes?: number[];
      firewalls?: { firewall: number }[];
      start_after_create?: boolean;
    };
  }>("/servers", async (req, reply) => {
    if (!requireToken(reply)) return;

    const { name, server_type, image } = req.body;
    if (!name || !server_type || !image) {
      return reply.code(400).send({ error: "name, server_type, and image are required" });
    }

    const res = await fetch(`${HETZNER_API}/servers`, {
      method: "POST",
      headers: hetznerHeaders(true),
      body: JSON.stringify(req.body),
    });

    if (!res.ok) return hetznerError(res, reply);

    const data = await res.json();
    return {
      server: mapServer(data.server as HetznerServer),
      action: data.action,
      root_password: data.root_password,
    };
  });

  // ── 28. Change protection ─────────────────────────────
  app.put<{ Params: { id: string }; Body: { delete?: boolean; rebuild?: boolean } }>(
    "/servers/:id/protection",
    async (req, reply) => {
      if (!requireToken(reply)) return;

      const { id } = req.params;
      const { delete: del, rebuild } = req.body;

      const res = await fetch(`${HETZNER_API}/servers/${id}/actions/change_protection`, {
        method: "POST",
        headers: hetznerHeaders(true),
        body: JSON.stringify({ delete: del, rebuild }),
      });

      if (!res.ok) return hetznerError(res, reply);

      const data = await res.json();
      return { success: true, action: data.action };
    }
  );
}
