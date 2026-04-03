// ── agentHandler.js ───────────────────────────────────
// WebSocket handlers for agent and browser-client connections
// ──────────────────────────────────────────────────────
import { WebSocket } from "ws";

// Store: hostname -> agent connection
const agents = new Map();
// Store: client WebSockets subscribed to live updates
const clientSubs = new Set();

export function sendToAgent(hostname, message) {
  const agent = agents.get(hostname);
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return false;
  agent.ws.send(JSON.stringify(message));
  return true;
}

export function getAgentData(hostname) {
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

export function subscribeClient(ws) {
  clientSubs.add(ws);
  ws.on("close", () => clientSubs.delete(ws));

  // Send current state immediately
  const state = getAgentData();
  ws.send(JSON.stringify({ type: "agents", data: state }));
}

function broadcastToClients(msg) {
  const payload = JSON.stringify(msg);
  for (const client of clientSubs) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

export function handleAgentWs(socket) {
  let hostname = "unknown";

  socket.on("message", (raw) => {
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
        console.log(`Agent connected: ${hostname}`);
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
      console.error(`Agent message parse error: ${e}`);
    }
  });

  socket.on("close", () => {
    agents.delete(hostname);
    console.log(`Agent disconnected: ${hostname}`);
    broadcastToClients({ type: "agent_disconnected", hostname });
  });
}

export function handleClientWs(socket) {
  subscribeClient(socket);

  socket.on("message", (raw) => {
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
      console.error(`Client message parse error: ${e}`);
    }
  });
}
