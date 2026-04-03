// ── projects.js ───────────────────────────────────────
// Aggregated project overview, clone, register instances
// ──────────────────────────────────────────────────────
import { getAgentData, sendToAgent } from "../ws/agentHandler.js";
import { sendJson, sendError } from '../server.js';

// In-memory registry for local instances (registered by external Claude Code sessions)
const localInstances = [];

export function projectRoutes(router) {

  // Trigger discovery on all connected agents
  router.post("/projects/discover", async (req, res) => {
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");

    const agents = getAgentData();
    if (agents.length === 0) {
      return sendError(res, 503, "No agents connected");
    }

    let sent = 0;
    for (const agent of agents) {
      if (sendToAgent(agent.hostname, { command: "discover" })) {
        sent++;
      }
    }
    sendJson(res, { status: "discovering", agentsSent: sent });
  });

  // Get aggregated project overview
  router.get("/projects", async (req, res) => {
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");

    // Fetch GitHub repos
    const githubToken = process.env.GITHUB_TOKEN;
    let githubRepos = [];
    if (githubToken) {
      try {
        const apiRes = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        });
        if (apiRes.ok) {
          githubRepos = await apiRes.json();
        }
      } catch {}
    }

    // Get agent-discovered repos (stored on agent data)
    const agents = getAgentData();

    // Build project map: key = github full_name or repo name
    const projectMap = new Map();

    // Add GitHub repos
    for (const repo of githubRepos) {
      projectMap.set(repo.full_name, {
        name: repo.name,
        github: {
          fullName: repo.full_name,
          url: repo.html_url,
          defaultBranch: repo.default_branch,
          lastPush: repo.pushed_at,
          description: repo.description,
          private: repo.private,
        },
        instances: [],
        containers: [],
        agents: [],
      });
    }

    // Add agent-discovered repos
    for (const agent of agents) {
      const discoveredRepos = agent.discoveredRepos || [];
      for (const repo of discoveredRepos) {
        const key = repo.github || repo.name;
        if (!projectMap.has(key)) {
          projectMap.set(key, {
            name: repo.name,
            github: repo.github ? { fullName: repo.github } : null,
            instances: [],
            containers: [],
            agents: [],
          });
        }
        const project = projectMap.get(key);
        project.instances.push({
          host: agent.hostname,
          path: repo.path,
          branch: repo.branch,
          commit: repo.commit,
          commitMessage: repo.commitMessage,
          dirty: repo.dirty,
        });
        if (!project.agents.includes(agent.hostname)) {
          project.agents.push(agent.hostname);
        }
      }

      // Map containers to projects by name heuristic
      const containers = agent.containers || [];
      for (const container of containers) {
        for (const [, project] of projectMap) {
          if (container.name.toLowerCase().includes(project.name.toLowerCase()) ||
              project.name.toLowerCase().includes(container.name.split("-")[0].toLowerCase())) {
            project.containers.push({
              id: container.id,
              name: container.name,
              image: container.image,
              status: container.status,
              host: agent.hostname,
            });
          }
        }
      }
    }

    // Add locally registered instances
    for (const inst of localInstances) {
      let matched = false;
      for (const [, project] of projectMap) {
        const instName = inst.path.split(/[/\\]/).pop()?.toLowerCase();
        if (instName === project.name.toLowerCase()) {
          project.instances.push(inst);
          matched = true;
          break;
        }
      }
      if (!matched) {
        const name = inst.path.split(/[/\\]/).pop() || "unknown";
        projectMap.set(`local:${name}`, {
          name,
          github: null,
          instances: [inst],
          containers: [],
          agents: [],
        });
      }
    }

    // Convert to array and add status
    const projects = Array.from(projectMap.values()).map((p) => ({
      ...p,
      status: p.instances.length === 0 ? "orphaned" :
              p.github === null ? "untracked" :
              p.instances.some((i) => i.dirty) ? "dirty" : "active",
    }));

    // Sort: active first, then dirty, then orphaned, then untracked
    const order = { dirty: 0, active: 1, untracked: 2, orphaned: 3 };
    projects.sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4));

    sendJson(res, { projects });
  });

  // Clone a repo to /opt/repos/<name>/ on a server
  router.post("/projects/clone", async (req, res) => {
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");

    const { url, name, hostname } = req.body;
    if (!url || !name) return sendError(res, 400, "url and name required");
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return sendError(res, 400, "Invalid repo name");

    const agents = getAgentData();
    const targetHost = hostname || agents[0]?.hostname;
    if (!targetHost) return sendError(res, 503, "No agents connected");

    const requestId = `clone-${Date.now()}`;
    const sent = sendToAgent(targetHost, {
      command: "clone_repo",
      url,
      name,
      requestId,
    });
    if (!sent) return sendError(res, 503, "Agent not reachable");

    sendJson(res, { status: "cloning", requestId, hostname: targetHost });
  });

  // Register a local instance (called by external Claude Code sessions)
  router.post("/projects/register", async (req, res) => {
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");

    const { host, path, branch, commit } = req.body;
    if (!host || !path) return sendError(res, 400, "host and path required");

    // Update or add
    const idx = localInstances.findIndex((i) => i.host === host && i.path === path);
    const entry = { host, path, branch, commit, registeredAt: Date.now() };
    if (idx >= 0) {
      localInstances[idx] = entry;
    } else {
      localInstances.push(entry);
    }
    sendJson(res, { success: true });
  });
}
