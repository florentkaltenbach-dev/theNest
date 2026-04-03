// ── auth.js ───────────────────────────────────────────
// Authentication: login, users, invites, API tokens
// ──────────────────────────────────────────────────────
import { randomBytes, createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { sendJson, sendError, verifyJwt } from '../server.js';

const USERS_FILE = process.env.NEST_USERS_FILE || "/opt/nest/users.json";

export function hashPassword(password) {
  return createHash("sha256").update(password).digest("hex");
}

async function loadUsers() {
  try {
    if (existsSync(USERS_FILE)) {
      return JSON.parse(await readFile(USERS_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

async function saveUsers(users) {
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

const TOKENS_FILE = process.env.NEST_TOKENS_FILE || "/opt/nest/tokens.json";

export async function loadTokens() {
  try {
    if (existsSync(TOKENS_FILE)) {
      return JSON.parse(await readFile(TOKENS_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

export async function saveTokens(tokens) {
  await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
}

async function ensureAdminExists() {
  const users = await loadUsers();
  if (users.some((u) => u.role === "admin")) return;

  const adminPassword = process.env.NEST_ADMIN_PASSWORD;
  if (!adminPassword) return;

  users.push({
    id: "admin",
    name: "Admin",
    role: "admin",
    passwordHash: hashPassword(adminPassword),
    createdAt: Date.now(),
  });
  await saveUsers(users);
}

export function authRoutes(router, jwt) {
  // Ensure admin user exists on startup
  ensureAdminExists();

  router.get("/direct-login", async (req, res) => {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nest Direct Login</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #171c2b;
      --card: #ffffff;
      --ink: #161a28;
      --muted: #6b7280;
      --line: #d7dce5;
      --accent: #1a1a2e;
      --accent-2: #2563eb;
      --error: #b91c1c;
      --ok: #166534;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at top, #27324a 0%, var(--bg) 55%);
      font: 16px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: var(--card);
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
    }
    h1 {
      margin: 0 0 6px;
      font-size: 32px;
      text-align: center;
    }
    p {
      margin: 0 0 18px;
      color: var(--muted);
      text-align: center;
    }
    input {
      width: 100%;
      padding: 14px 16px;
      border: 1px solid var(--line);
      border-radius: 10px;
      font: inherit;
      margin-bottom: 12px;
    }
    .row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    button {
      border: 0;
      border-radius: 10px;
      padding: 12px 14px;
      font: inherit;
      cursor: pointer;
    }
    .ghost {
      background: #eef2f7;
      color: var(--ink);
    }
    .primary {
      width: 100%;
      background: var(--accent);
      color: white;
      font-weight: 700;
      margin-top: 4px;
    }
    .status {
      min-height: 22px;
      margin: 8px 0 0;
      font-size: 14px;
      text-align: center;
    }
    .error { color: var(--error); }
    .ok { color: var(--ok); }
    code {
      display: inline-block;
      background: #f2f4f8;
      padding: 1px 6px;
      border-radius: 6px;
      font-size: 13px;
    }
    .hint {
      margin-top: 14px;
      font-size: 13px;
      color: var(--muted);
      text-align: left;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Nest</h1>
    <p>Direct login fallback. This bypasses the app shell.</p>
    <input id="password" type="password" placeholder="Admin password" autofocus />
    <div class="row">
      <button class="ghost" id="toggle">Show password</button>
      <button class="ghost" id="check">Check server</button>
    </div>
    <button class="primary" id="submit">Sign in</button>
    <div class="status" id="status"></div>
    <div class="hint">
      If this works while <code>/login</code> does not, the problem is in the client shell rather than authentication.
    </div>
  </div>
  <script>
    const password = document.getElementById("password");
    const status = document.getElementById("status");
    const toggle = document.getElementById("toggle");
    const submit = document.getElementById("submit");
    const check = document.getElementById("check");

    function setStatus(text, cls) {
      status.textContent = text || "";
      status.className = "status" + (cls ? " " + cls : "");
    }

    async function handleLogin() {
      const value = password.value.trim();
      if (!value) {
        setStatus("Enter your admin password.", "error");
        return;
      }
      submit.disabled = true;
      setStatus("Signing in...", "");
      try {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: value }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || "Login failed");
        }
        localStorage.setItem("nest_token", data.token);
        setStatus("Login succeeded. Redirecting...", "ok");
        window.location.href = "/";
      } catch (err) {
        setStatus(err.message || "Login failed", "error");
      } finally {
        submit.disabled = false;
      }
    }

    async function handleCheck() {
      check.disabled = true;
      setStatus("Checking server...", "");
      try {
        const res = await fetch("/api/health");
        const data = await res.json();
        if (!res.ok) throw new Error("Server check failed");
        setStatus("Server reachable. Version " + data.version + ".", "ok");
      } catch (err) {
        setStatus(err.message || "Server check failed", "error");
      } finally {
        check.disabled = false;
      }
    }

    toggle.addEventListener("click", () => {
      password.type = password.type === "password" ? "text" : "password";
      toggle.textContent = password.type === "password" ? "Show password" : "Hide password";
    });
    check.addEventListener("click", handleCheck);
    submit.addEventListener("click", handleLogin);
    password.addEventListener("keydown", (event) => {
      if (event.key === "Enter") handleLogin();
    });
  </script>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  router.post("/auth/login", async (req, res) => {
    const { password, name } = req.body;
    if (!password) return sendError(res, 400, "Password required");

    const users = await loadUsers();
    const hash = hashPassword(password);

    // Try matching by password hash
    const user = users.find((u) => u.passwordHash === hash);
    if (!user) {
      // Fallback: check env admin password for backward compatibility
      const adminPassword = process.env.NEST_ADMIN_PASSWORD;
      if (adminPassword && password === adminPassword) {
        const token = jwt.sign({ id: "admin", role: "admin", name: "Admin" }, "7d");
        return sendJson(res, { token, role: "admin", name: "Admin" });
      }
      return sendError(res, 401, "Invalid password");
    }

    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, "7d");
    sendJson(res, { token, role: user.role, name: user.name });
  });

  router.get("/auth/me", async (req, res) => {
    if (!req.user) return sendError(res, 401, "Unauthorized");
    const { id, role, name } = req.user;
    sendJson(res, { id, role, name });
  });

  // Create invitation (admin only)
  router.post("/auth/invite", async (req, res) => {
    if (!req.user) return sendError(res, 401, "Unauthorized");

    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");

    const { name, password } = req.body;
    if (!name || !password) return sendError(res, 400, "name and password required");

    const users = await loadUsers();
    const id = `user-${randomBytes(4).toString("hex")}`;

    users.push({
      id,
      name,
      role: "user",
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
      createdBy: req.user.id,
    });
    await saveUsers(users);

    // Generate invite token (JWT with user ID, valid 7 days)
    const inviteToken = jwt.sign({ inviteFor: id, name }, "7d");

    sendJson(res, { id, name, role: "user", inviteToken });
  });

  // Accept invitation — user sets their own password via invite token
  router.post("/auth/accept-invite", async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return sendError(res, 400, "token and password required");

    try {
      const decoded = jwt.verify(token);
      if (!decoded.inviteFor) return sendError(res, 400, "Invalid invite token");

      const users = await loadUsers();
      const user = users.find((u) => u.id === decoded.inviteFor);
      if (!user) return sendError(res, 404, "User not found");

      user.passwordHash = hashPassword(password);
      await saveUsers(users);

      const loginToken = jwt.sign({ id: user.id, role: user.role, name: user.name }, "7d");
      sendJson(res, { token: loginToken, role: user.role, name: user.name });
    } catch {
      sendError(res, 400, "Invalid or expired invite token");
    }
  });

  // List users (admin only)
  router.get("/auth/users", async (req, res) => {
    if (!req.user) return sendError(res, 401, "Unauthorized");

    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");

    const users = await loadUsers();
    sendJson(res, {
      users: users.map(({ passwordHash, ...rest }) => rest),
    });
  });

  // Delete user (admin only)
  router.delete("/auth/users/:id", async (req, res) => {
    if (!req.user) return sendError(res, 401, "Unauthorized");

    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");
    if (req.params.id === "admin") return sendError(res, 400, "Cannot delete admin");

    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === req.params.id);
    if (idx === -1) return sendError(res, 404, "User not found");
    users.splice(idx, 1);
    await saveUsers(users);
    sendJson(res, { success: true });
  });

  // Create API token (admin only)
  router.post("/auth/tokens", async (req, res) => {
    if (!req.user) return sendError(res, 401, "Unauthorized");
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");

    const { name } = req.body;
    if (!name) return sendError(res, 400, "name required");

    // Generate a random token: nest_<64 hex chars>
    const rawToken = `nest_${randomBytes(32).toString("hex")}`;
    const id = `tok-${randomBytes(4).toString("hex")}`;

    const tokens = await loadTokens();
    tokens.push({
      id,
      name,
      tokenHash: hashPassword(rawToken),
      role: "admin",
      createdAt: Date.now(),
    });
    await saveTokens(tokens);

    // Return the raw token ONCE — it's never stored/shown again
    sendJson(res, { id, name, token: rawToken });
  });

  // List API tokens (admin only) — never returns the token itself
  router.get("/auth/tokens", async (req, res) => {
    if (!req.user) return sendError(res, 401, "Unauthorized");
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");

    const tokens = await loadTokens();
    sendJson(res, {
      tokens: tokens.map(({ tokenHash, ...rest }) => rest),
    });
  });

  // Delete API token (admin only)
  router.delete("/auth/tokens/:id", async (req, res) => {
    if (!req.user) return sendError(res, 401, "Unauthorized");
    const { role } = req.user;
    if (role !== "admin") return sendError(res, 403, "Admin only");

    const tokens = await loadTokens();
    const idx = tokens.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return sendError(res, 404, "Token not found");
    tokens.splice(idx, 1);
    await saveTokens(tokens);
    sendJson(res, { success: true });
  });
}
