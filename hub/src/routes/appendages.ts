import { FastifyInstance } from "fastify";
import { getAgentData, sendToAgent } from "../ws/agentHandler.js";

interface AppendageDef {
  id: string;
  name: string;
  description: string;
  category: "service" | "tooling" | "model";
  image: string;
  ports?: Record<string, string>;
  minRamMb: number;
  minCpuCores: number;
  installed?: boolean;
  status?: string;
}

const CATALOG: AppendageDef[] = [
  {
    id: "nginx",
    name: "Nginx",
    description: "High-performance web server and reverse proxy",
    category: "service",
    image: "nginx:alpine",
    ports: { "8080/tcp": "8080" },
    minRamMb: 64,
    minCpuCores: 0.25,
  },
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    description: "Self-hosted monitoring tool",
    category: "tooling",
    image: "louislam/uptime-kuma:1",
    ports: { "3001/tcp": "3001" },
    minRamMb: 128,
    minCpuCores: 0.25,
  },
  {
    id: "gitea",
    name: "Gitea",
    description: "Lightweight self-hosted Git service",
    category: "tooling",
    image: "gitea/gitea:latest",
    ports: { "3002/tcp": "3000" },
    minRamMb: 256,
    minCpuCores: 0.5,
  },
  {
    id: "portainer",
    name: "Portainer",
    description: "Docker management UI",
    category: "tooling",
    image: "portainer/portainer-ce:latest",
    ports: { "9443/tcp": "9443" },
    minRamMb: 128,
    minCpuCores: 0.25,
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Run local LLMs (Llama, Mistral, etc.)",
    category: "model",
    image: "ollama/ollama:latest",
    ports: { "11434/tcp": "11434" },
    minRamMb: 4096,
    minCpuCores: 2,
  },
];

function getInstalledAppendages(): AppendageDef[] {
  const agents = getAgentData() as any[];
  const containers = agents.flatMap((a: any) => a.containers || []);

  return CATALOG.map((app) => {
    const container = containers.find((c: any) =>
      c.image.includes(app.image.split(":")[0]) || c.name === app.id
    );
    return {
      ...app,
      installed: !!container,
      status: container?.status || "not installed",
    };
  });
}

export async function appendageRoutes(app: FastifyInstance) {
  app.get("/appendages", async () => {
    return { appendages: getInstalledAppendages() };
  });

  app.get("/appendages/catalog", async () => {
    return { catalog: CATALOG };
  });

  app.post<{ Body: { appendageId: string; hostname: string } }>("/appendages/install", async (req, reply) => {
    const { appendageId, hostname } = req.body;
    const def = CATALOG.find((a) => a.id === appendageId);
    if (!def) return reply.code(404).send({ error: "Appendage not found in catalog" });

    const sent = sendToAgent(hostname, {
      command: "install_appendage",
      image: def.image,
      name: def.id,
      ports: def.ports || {},
    });

    if (!sent) return reply.code(404).send({ error: "Agent not connected" });

    return {
      success: true,
      message: `Installing ${def.name} on ${hostname}...`,
    };
  });
}
