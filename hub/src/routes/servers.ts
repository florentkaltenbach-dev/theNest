import { FastifyInstance } from "fastify";

const HETZNER_API = "https://api.hetzner.cloud/v1";

function hetznerHeaders() {
  return { Authorization: `Bearer ${process.env.HETZNER_API_TOKEN}` };
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
    ip: s.public_net.ipv4.ip,
    ipv6: s.public_net.ipv6.ip,
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
  app.get("/servers", async (req, reply) => {
    if (!process.env.HETZNER_API_TOKEN) {
      return reply.code(500).send({ error: "HETZNER_API_TOKEN not configured" });
    }

    const res = await fetch(`${HETZNER_API}/servers`, { headers: hetznerHeaders() });
    if (!res.ok) return reply.code(res.status).send({ error: "Hetzner API error" });

    const data = await res.json();
    return { servers: (data.servers as HetznerServer[]).map(mapServer) };
  });

  app.get<{ Params: { id: string } }>("/servers/:id", async (req, reply) => {
    if (!process.env.HETZNER_API_TOKEN) {
      return reply.code(500).send({ error: "HETZNER_API_TOKEN not configured" });
    }

    const { id } = req.params;

    // Fetch server and metrics in parallel
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

  // Server actions (reboot, shutdown, power on)
  app.post<{ Params: { id: string }; Body: { action: string } }>("/servers/:id/action", async (req, reply) => {
    if (!process.env.HETZNER_API_TOKEN) {
      return reply.code(500).send({ error: "HETZNER_API_TOKEN not configured" });
    }

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

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return reply.code(res.status).send({ error: "Hetzner API error", details: err });
    }

    const data = await res.json();
    return { success: true, action: data.action };
  });
}
