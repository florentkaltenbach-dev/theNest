// ── terminal.js ───────────────────────────────────────
// WebSocket handler for browser-based terminal (tmux + PTY)
// ──────────────────────────────────────────────────────
import * as pty from "node-pty";
import { execSync } from "child_process";
import { verifyJwt, parseQuery } from '../server.js';

const sessions = new Map();

function tmuxSessionExists(name) {
  try {
    execSync(`tmux has-session -t ${name} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export function createTerminalHandler(jwtSecret) {
  return async function handleTerminalWs(socket, req) {
    const query = parseQuery(req.url);
    const token = query.token;
    if (!token) { socket.close(4001, "Missing token"); return; }

    let decoded = null;
    try {
      decoded = verifyJwt(token, jwtSecret);
    } catch {
      // JWT failed, try API token
      if (token.startsWith("nest_")) {
        const { loadTokens, hashToken } = await import("../routes/auth.js");
        const tokens = await loadTokens();
        const tokenHash = hashToken(token);
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

    const sessionName = query.session || "nest-terminal";
    const cmd = query.cmd;

    // If another browser tab is viewing this session, close its WebSocket
    // The old PTY (tmux attach) dies naturally, tmux session persists
    const existing = sessions.get(sessionName);
    if (existing) {
      existing.ws.close(4000, "Replaced by new viewer");
      sessions.delete(sessionName);
    }

    const ptyOpts = {
      name: "xterm-256color",
      cwd: "/opt/nest",
      env: { ...process.env, TERM: "xterm-256color" },
    };

    let proc;
    const sessionExists = tmuxSessionExists(sessionName);

    if (sessionExists) {
      // Attach to existing tmux session
      proc = pty.spawn("tmux", ["attach-session", "-t", sessionName], ptyOpts);
    } else if (cmd && cmd !== "bash") {
      // Create new tmux session with specific command
      proc = pty.spawn("tmux", ["new-session", "-s", sessionName, cmd], ptyOpts);
    } else {
      // Create new tmux session with default shell
      proc = pty.spawn("tmux", ["new-session", "-s", sessionName], ptyOpts);
    }

    sessions.set(sessionName, { ws: socket, proc });

    proc.onData((data) => {
      if (socket.readyState === 1) socket.send(data);
    });

    proc.onExit(() => {
      if (socket.readyState === 1) socket.close(1000, "Process exited");
      if (sessions.get(sessionName)?.ws === socket) {
        sessions.delete(sessionName);
      }
    });

    socket.on("message", (msg) => {
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
      // Don't kill tmux — just clean up the PTY process.
      // The PTY (tmux attach) dies naturally, but the tmux session persists.
      if (sessions.get(sessionName)?.ws === socket) {
        sessions.delete(sessionName);
      }
    });
  };
}
