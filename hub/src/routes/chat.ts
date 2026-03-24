import { FastifyInstance } from "fastify";
import { getAgentData } from "../ws/agentHandler.js";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

const history: ChatMessage[] = [];
let msgCounter = 0;

function makeId() {
  return `msg-${++msgCounter}-${Date.now()}`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function handleMessage(content: string): string {
  const lower = content.toLowerCase().trim();

  // Status queries
  if (lower.includes("status") || lower.includes("how are") || lower === "hi" || lower === "hello") {
    const agents = getAgentData() as any[];
    if (agents.length === 0) {
      return "All systems nominal. No agents connected yet — servers are reachable but not reporting live metrics.";
    }
    const lines = agents.map((a: any) => {
      if (!a.metrics) return `• **${a.hostname}**: connected, waiting for metrics`;
      const m = a.metrics;
      return `• **${a.hostname}**: CPU ${m.cpu.percent}%, RAM ${m.memory.percent}%, Disk ${m.disk.percent}%, up ${formatUptime(m.uptime_seconds)}`;
    });
    return `Here's the current status:\n\n${lines.join("\n")}`;
  }

  // Container queries
  if (lower.includes("container") || lower.includes("docker")) {
    const agents = getAgentData() as any[];
    const allContainers = agents.flatMap((a: any) => (a.containers || []).map((c: any) => ({ ...c, host: a.hostname })));
    if (allContainers.length === 0) return "No containers running on any connected server.";
    const lines = allContainers.map((c: any) =>
      `• **${c.name}** (${c.image}) on ${c.host} — ${c.status}${c.cpu_percent !== undefined ? ` · CPU ${c.cpu_percent}%` : ""}`
    );
    return `Found ${allContainers.length} container(s):\n\n${lines.join("\n")}`;
  }

  // Help
  if (lower.includes("help") || lower.includes("what can")) {
    return `I'm the Nest assistant. I can help with:\n\n• **status** — server health overview\n• **containers** — list running containers\n• **servers** — server inventory\n• **help** — this message\n\nMore capabilities coming soon: task routing, deployments, and OpenClaw integration.`;
  }

  // Servers
  if (lower.includes("server") || lower.includes("inventory")) {
    const agents = getAgentData() as any[];
    if (agents.length === 0) return "No agents connected. Check the Servers tab for your Hetzner inventory.";
    return `${agents.length} agent(s) connected: ${agents.map((a: any) => `**${a.hostname}**`).join(", ")}`;
  }

  return "I understood your message but I'm not sure how to help with that yet. Try asking about **status**, **containers**, or **help**.";
}

export async function chatRoutes(app: FastifyInstance) {
  app.get("/chat/history", async () => {
    return { messages: history.slice(-50) };
  });

  app.post<{ Body: { message: string } }>("/chat/send", async (req) => {
    const { message } = req.body;

    const userMsg: ChatMessage = { id: makeId(), role: "user", content: message, timestamp: Date.now() };
    history.push(userMsg);

    const response = handleMessage(message);
    const assistantMsg: ChatMessage = { id: makeId(), role: "assistant", content: response, timestamp: Date.now() };
    history.push(assistantMsg);

    return { userMessage: userMsg, assistantMessage: assistantMsg };
  });
}
