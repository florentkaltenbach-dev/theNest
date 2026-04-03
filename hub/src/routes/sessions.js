// ── sessions.js ───────────────────────────────────────
// Tmux session management (list / create / kill)
// ──────────────────────────────────────────────────────
import { exec } from "child_process";
import { promisify } from "util";
import { sendJson, sendError } from '../server.js';

const execAsync = promisify(exec);

export function sessionRoutes(router) {
  router.get("/sessions", async (req, res) => {
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");
    try {
      const { stdout } = await execAsync('tmux list-sessions -F "#{session_name}|#{session_created}|#{session_windows}|#{session_attached}" 2>/dev/null || echo ""');
      const sessions = stdout.trim().split("\n").filter(Boolean).map((line) => {
        const [name, created, windows, attached] = line.split("|");
        return { name, created: new Date(parseInt(created) * 1000).toISOString(), windows: parseInt(windows), attached: parseInt(attached) > 0 };
      });
      sendJson(res, { sessions });
    } catch {
      sendJson(res, { sessions: [] });
    }
  });

  router.post("/sessions", async (req, res) => {
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");
    const { name, cmd } = req.body;
    if (!name) return sendError(res, 400, "name required");
    try {
      await execAsync(`tmux has-session -t "${name}" 2>/dev/null`);
      return sendJson(res, { name, status: "exists" });
    } catch {}
    try {
      const command = cmd ? `tmux new-session -d -s "${name}" ${cmd}` : `tmux new-session -d -s "${name}"`;
      await execAsync(command);
      sendJson(res, { name, status: "created" }, 201);
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });

  router.delete("/sessions/:name", async (req, res) => {
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");
    try {
      await execAsync(`tmux kill-session -t "${req.params.name}"`);
      sendJson(res, { success: true });
    } catch {
      sendError(res, 404, "Session not found");
    }
  });
}
