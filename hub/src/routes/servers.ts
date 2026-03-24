import { FastifyInstance } from "fastify";

const HETZNER_API = "https://api.hetzner.cloud/v1";

interface HetznerServer {
  id: number;
  name: string;
  status: string;
  server_type: { name: string; cores: number; memory: number; disk: number };
  datacenter: { name: string; location: { city: string; country: string } };
  public_net: {
    ipv4: { ip: string };
    ipv6: { ip: string };
  };
  image: { name: string; description: string } | null;
  created: string;
}

export async function serverRoutes(app: FastifyInstance) {
  app.get("/servers", async (req, reply) => {
    const token = process.env.HETZNER_API_TOKEN;
    if (!token) {
      return reply.code(500).send({ error: "HETZNER_API_TOKEN not configured" });
    }

    const res = await fetch(`${HETZNER_API}/servers`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return reply.code(res.status).send({ error: "Hetzner API error" });
    }

    const data = await res.json();
    const servers = (data.servers as HetznerServer[]).map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      ip: s.public_net.ipv4.ip,
      type: s.server_type.name,
      cores: s.server_type.cores,
      memory: s.server_type.memory,
      disk: s.server_type.disk,
      location: `${s.datacenter.location.city}, ${s.datacenter.location.country}`,
      image: s.image?.description ?? "Unknown",
      created: s.created,
    }));

    return { servers };
  });
}
