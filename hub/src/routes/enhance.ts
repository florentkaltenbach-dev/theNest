import { FastifyInstance } from "fastify";
import { sendToAgent, getAgentData } from "../ws/agentHandler.js";

interface EnhanceBody {
  action: "add-dependency" | "rebuild" | "restart";
  target?: string;
  packages?: string[];
  services?: string[];
}

export async function enhanceRoutes(app: FastifyInstance) {
  app.post<{ Body: EnhanceBody }>("/nest/enhance", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    const { action, target, packages, services } = req.body;

    if (!action) return reply.code(400).send({ error: "action required" });

    const agents = getAgentData() as any[];
    if (agents.length === 0) {
      return reply.code(503).send({ error: "No agents connected" });
    }

    const hostname = agents[0].hostname;
    const sent = sendToAgent(hostname, {
      command: "enhance",
      action,
      target: target || "hub",
      packages: packages || [],
      services: services || ["nest-hub"],
    });

    if (!sent) {
      return reply.code(503).send({ error: "Failed to send command to agent" });
    }

    return { status: "sent", action, target: target || "hub" };
  });
}
