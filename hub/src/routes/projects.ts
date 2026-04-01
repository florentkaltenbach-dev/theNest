import { FastifyInstance } from "fastify";
import { getAgentData, sendToAgent } from "../ws/agentHandler.js";

interface RegisteredInstance {
  host: string;
  path: string;
  branch?: string;
  commit?: string;
  registeredAt: number;
}

// In-memory registry for local instances (registered by external Claude Code sessions)
const localInstances: RegisteredInstance[] = [];

export async function projectRoutes(app: FastifyInstance) {

  // Trigger discovery on all connected agents
  app.post("/projects/discover", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    const agents = getAgentData() as any[];
    if (agents.length === 0) {
      return reply.code(503).send({ error: "No agents connected" });
    }

    let sent = 0;
    for (const agent of agents) {
      if (sendToAgent(agent.hostname, { command: "discover" })) {
        sent++;
      }
    }
    return { status: "discovering", agentsSent: sent };
  });

  // Get aggregated project overview
  app.get("/projects", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    // Fetch GitHub repos
    const githubToken = process.env.GITHUB_TOKEN;
    let githubRepos: any[] = [];
    if (githubToken) {
      try {
        const res = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
          headers: {
            Authorization: `token ${githubToken}`,
            Accept: "application/vnd.github.v3+json",
          },
        });
        if (res.ok) {
          githubRepos = await res.json();
        }
      } catch {}
    }

    // Get agent-discovered repos (stored on agent data)
    const agents = getAgentData() as any[];

    // Build project map: key = github full_name or repo name
    const projectMap = new Map<string, any>();

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
      const discoveredRepos = (agent as any).discoveredRepos || [];
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
        const project = projectMap.get(key)!;
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
        // Try to match container name to a project
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
      // Try to match to existing project
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
              p.instances.some((i: any) => i.dirty) ? "dirty" : "active",
    }));

    // Sort: active first, then dirty, then orphaned, then untracked
    const order = { dirty: 0, active: 1, untracked: 2, orphaned: 3 };
    projects.sort((a, b) => (order[a.status as keyof typeof order] ?? 4) - (order[b.status as keyof typeof order] ?? 4));

    return { projects };
  });

  // Clone a repo to /opt/repos/<name>/ on a server
  app.post<{ Body: { url: string; name: string; hostname?: string } }>("/projects/clone", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    const { url, name, hostname } = req.body;
    if (!url || !name) return reply.code(400).send({ error: "url and name required" });
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return reply.code(400).send({ error: "Invalid repo name" });

    const agents = getAgentData() as any[];
    const targetHost = hostname || agents[0]?.hostname;
    if (!targetHost) return reply.code(503).send({ error: "No agents connected" });

    const requestId = `clone-${Date.now()}`;
    const sent = sendToAgent(targetHost, {
      command: "clone_repo",
      url,
      name,
      requestId,
    });
    if (!sent) return reply.code(503).send({ error: "Agent not reachable" });

    return { status: "cloning", requestId, hostname: targetHost };
  });

  // Register a local instance (called by external Claude Code sessions)
  app.post<{ Body: RegisteredInstance }>("/projects/register", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    const { host, path, branch, commit } = req.body;
    if (!host || !path) return reply.code(400).send({ error: "host and path required" });

    // Update or add
    const idx = localInstances.findIndex((i) => i.host === host && i.path === path);
    const entry = { host, path, branch, commit, registeredAt: Date.now() };
    if (idx >= 0) {
      localInstances[idx] = entry;
    } else {
      localInstances.push(entry);
    }
    return { success: true };
  });
}
