import { FastifyInstance } from "fastify";
import { WebSocket } from "ws";

interface AgentConnection {
  ws: WebSocket;
  hostname: string;
  lastMetrics: any;
  lastContainers: any[];
  discoveredRepos: any[];
  connectedAt: number;
}

// Store: hostname → agent connection
const agents = new Map<string, AgentConnection>();
// Store: client WebSockets subscribed to live updates
const clientSubs = new Set<WebSocket>();

export function sendToAgent(hostname: string, message: object): boolean {
  const agent = agents.get(hostname);
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return false;
  agent.ws.send(JSON.stringify(message));
  return true;
}

export function getAgentData(hostname?: string) {
  if (hostname) {
    const agent = agents.get(hostname);
    if (!agent) return null;
    return {
      hostname: agent.hostname,
      metrics: agent.lastMetrics,
      containers: agent.lastContainers,
      discoveredRepos: agent.discoveredRepos || [],
      connectedAt: agent.connectedAt,
    };
  }
  return Array.from(agents.values()).map((a) => ({
    hostname: a.hostname,
    metrics: a.lastMetrics,
    containers: a.lastContainers,
    discoveredRepos: a.discoveredRepos || [],
    connectedAt: a.connectedAt,
  }));
}

export function subscribeClient(ws: WebSocket) {
  clientSubs.add(ws);
  ws.on("close", () => clientSubs.delete(ws));

  // Send current state immediately
  const state = getAgentData();
  ws.send(JSON.stringify({ type: "agents", data: state }));
}

function broadcastToClients(msg: object) {
  const payload = JSON.stringify(msg);
  for (const client of clientSubs) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export async function agentWsRoutes(app: FastifyInstance) {
  app.get("/ws/agent", { websocket: true }, (socket, req) => {
    let hostname = "unknown";

    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "hello") {
          hostname = msg.hostname || "unknown";
          agents.set(hostname, {
            ws: socket,
            hostname,
            lastMetrics: null,
            lastContainers: [],
            discoveredRepos: [],
            connectedAt: Date.now(),
          });
          app.log.info(`Agent connected: ${hostname}`);
          broadcastToClients({ type: "agent_connected", hostname });
        }

        if (msg.type === "metrics") {
          const agent = agents.get(hostname);
          if (agent) agent.lastMetrics = msg.data;
          broadcastToClients({ type: "metrics", hostname, data: msg.data });
        }

        if (msg.type === "containers") {
          const agent = agents.get(hostname);
          if (agent) agent.lastContainers = msg.data;
          broadcastToClients({ type: "containers", hostname, data: msg.data });
        }

        if (msg.type === "command_result") {
          broadcastToClients({ type: "command_result", hostname, data: msg });
        }

        if (msg.type === "command_result" && msg.command === "discover" && msg.repos) {
          const agent = agents.get(hostname);
          if (agent) agent.discoveredRepos = msg.repos;
        }

        if (msg.type === "container_logs") {
          broadcastToClients({ type: "container_logs", hostname, data: msg.data });
        }
      } catch (e) {
        app.log.error(`Agent message parse error: ${e}`);
      }
    });

    socket.on("close", () => {
      agents.delete(hostname);
      app.log.info(`Agent disconnected: ${hostname}`);
      broadcastToClients({ type: "agent_disconnected", hostname });
    });
  });

  // Client WebSocket endpoint — receives live agent data
  app.get("/ws/client", { websocket: true }, (socket, req) => {
    subscribeClient(socket);

    socket.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Relay commands to the right agent
        if (msg.type === "command" && msg.hostname) {
          const agent = agents.get(msg.hostname);
          if (agent && agent.ws.readyState === WebSocket.OPEN) {
            agent.ws.send(JSON.stringify(msg));
          }
        }
      } catch (e) {
        app.log.error(`Client message parse error: ${e}`);
      }
    });
  });
}
