// ── enhance.js ────────────────────────────────────────
// Send enhance commands to connected agents
// ──────────────────────────────────────────────────────
import { sendToAgent, getAgentData } from "../ws/agentHandler.js";
import { sendJson, sendError } from '../server.js';

export function enhanceRoutes(router) {
  router.post("/nest/enhance", async (req, res) => {
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");
    const { action, target, packages, services } = req.body;
    if (!action) return sendError(res, 400, "action required");
    const agents = getAgentData();
    if (agents.length === 0) return sendError(res, 503, "No agents connected");
    const hostname = agents[0].hostname;
    const sent = sendToAgent(hostname, { command: "enhance", action, target: target || "hub", packages: packages || [], services: services || ["nest-hub"] });
    if (!sent) return sendError(res, 503, "Failed to send command to agent");
    sendJson(res, { status: "sent", action, target: target || "hub" });
  });
}
