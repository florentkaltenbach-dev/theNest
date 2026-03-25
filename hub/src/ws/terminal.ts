import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import * as pty from "node-pty";

let active: { ws: WebSocket; proc: pty.IPty } | null = null;

export async function terminalWsRoutes(app: FastifyInstance) {
  app.get("/ws/terminal", { websocket: true }, async (socket, req) => {
    const token = (req.query as Record<string, string>).token;
    if (!token) { socket.close(4001, "Missing token"); return; }

    let decoded: any = null;
    try {
      decoded = app.jwt.verify(token) as any;
    } catch {
      // JWT failed, try API token
      if (token.startsWith("nest_")) {
        const { loadTokens, hashPassword } = await import("../routes/auth.js");
        const tokens = await loadTokens();
        const tokenHash = hashPassword(token);
        const matched = tokens.find((t) => t.tokenHash === tokenHash);
        if (matched) {
          decoded = { id: matched.id, role: matched.role, name: matched.name };
        }
      }
      if (!decoded) {
        socket.close(4003, "Invalid token");
        return;
      }
    }

    if (decoded.role !== "admin") {
      socket.close(4003, "Admin only");
      return;
    }

    // Kill existing session
    if (active) {
      active.proc.kill();
      active.ws.close(4000, "Replaced by new session");
      active = null;
    }

    const cmd = (req.query as Record<string, string>).cmd || "bash";
    const proc = pty.spawn(cmd, [], {
      name: "xterm-256color",
      cwd: "/opt/nest",
      env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
    });

    active = { ws: socket, proc };

    proc.onData((data) => {
      if (socket.readyState === 1) socket.send(data);
    });

    proc.onExit(() => {
      if (socket.readyState === 1) socket.close(1000, "Process exited");
      active = null;
    });

    socket.on("message", (msg: Buffer | string) => {
      const str = msg.toString();
      if (str.startsWith('{"type":"resize"')) {
        try {
          const { cols, rows } = JSON.parse(str);
          proc.resize(cols, rows);
        } catch { /* ignore bad resize */ }
        return;
      }
      proc.write(str);
    });

    socket.on("close", () => {
      proc.kill();
      if (active?.ws === socket) active = null;
    });
  });
}
