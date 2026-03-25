import { FastifyInstance } from "fastify";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function sessionRoutes(app: FastifyInstance) {
  // List active tmux sessions (admin only)
  app.get("/sessions", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    try {
      const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}|#{session_created}|#{session_windows}|#{session_attached}" 2>/dev/null || echo ""');
      const sessions = stdout.trim().split("\n").filter(Boolean).map((line) => {
        const [name, created, windows, attached] = line.split("|");
        return {
          name,
          created: new Date(parseInt(created) * 1000).toISOString(),
          windows: parseInt(windows),
          attached: parseInt(attached) > 0,
        };
      });
      return { sessions };
    } catch {
      return { sessions: [] };
    }
  });

  // Create a new tmux session (admin only)
  app.post<{ Body: { name: string; cmd?: string } }>("/sessions", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    const { name, cmd } = req.body;
    if (!name) return reply.code(400).send({ error: "name required" });

    // Check if session already exists
    try {
      await execAsync(`tmux has-session -t "${name}" 2>/dev/null`);
      return { name, status: "exists" };
    } catch {
      // Session doesn't exist, create it
    }

    try {
      const command = cmd
        ? `tmux new-session -d -s "${name}" ${cmd}`
        : `tmux new-session -d -s "${name}"`;
      await execAsync(command);
      return reply.code(201).send({ name, status: "created" });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // Kill a tmux session (admin only)
  app.delete<{ Params: { name: string } }>("/sessions/:name", async (req, reply) => {
    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    try {
      await execAsync(`tmux kill-session -t "${req.params.name}"`);
      return { success: true };
    } catch {
      return reply.code(404).send({ error: "Session not found" });
    }
  });
}
