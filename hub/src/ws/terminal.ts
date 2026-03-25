import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import * as pty from "node-pty";

let active: { ws: WebSocket; proc: pty.IPty } | null = null;

export async function terminalWsRoutes(app: FastifyInstance) {
  app.get("/ws/terminal", { websocket: true }, (socket, req) => {
    const token = (req.query as Record<string, string>).token;
    if (!token) { socket.close(4001, "Missing token"); return; }

    try {
      app.jwt.verify(token);
    } catch {
      socket.close(4003, "Invalid token");
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
