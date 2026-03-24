import { FastifyInstance } from "fastify";
import { randomBytes, createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";

const USERS_FILE = process.env.NEST_USERS_FILE || "/opt/nest/users.json";

interface User {
  id: string;
  name: string;
  role: "admin" | "user";
  passwordHash: string;
  createdAt: number;
  createdBy?: string;
}

function hashPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}

async function loadUsers(): Promise<User[]> {
  try {
    if (existsSync(USERS_FILE)) {
      return JSON.parse(await readFile(USERS_FILE, "utf-8"));
    }
  } catch {}
  return [];
}

async function saveUsers(users: User[]): Promise<void> {
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

async function ensureAdminExists(): Promise<void> {
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

export async function authRoutes(app: FastifyInstance) {
  // Ensure admin user exists on startup
  await ensureAdminExists();

  app.post("/auth/login", async (req, reply) => {
    const { password, name } = req.body as { password?: string; name?: string };
    if (!password) return reply.code(400).send({ error: "Password required" });

    const users = await loadUsers();
    const hash = hashPassword(password);

    // Try matching by password hash
    const user = users.find((u) => u.passwordHash === hash);
    if (!user) {
      // Fallback: check env admin password for backward compatibility
      const adminPassword = process.env.NEST_ADMIN_PASSWORD;
      if (adminPassword && password === adminPassword) {
        const token = app.jwt.sign({ id: "admin", role: "admin", name: "Admin" }, { expiresIn: "7d" });
        return { token, role: "admin", name: "Admin" };
      }
      return reply.code(401).send({ error: "Invalid password" });
    }

    const token = app.jwt.sign({ id: user.id, role: user.role, name: user.name }, { expiresIn: "7d" });
    return { token, role: user.role, name: user.name };
  });

  app.get("/auth/me", async (req, reply) => {
    try {
      await req.jwtVerify();
      const { id, role, name } = req.user as any;
      return { id, role, name };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  // Create invitation (admin only)
  app.post<{ Body: { name: string; password: string } }>("/auth/invite", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    const { name, password } = req.body;
    if (!name || !password) return reply.code(400).send({ error: "name and password required" });

    const users = await loadUsers();
    const id = `user-${randomBytes(4).toString("hex")}`;

    users.push({
      id,
      name,
      role: "user",
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
      createdBy: (req.user as any).id,
    });
    await saveUsers(users);

    // Generate invite token (JWT with user ID, valid 7 days)
    const inviteToken = app.jwt.sign({ inviteFor: id, name }, { expiresIn: "7d" });

    return { id, name, role: "user", inviteToken };
  });

  // Accept invitation — user sets their own password via invite token
  app.post<{ Body: { token: string; password: string } }>("/auth/accept-invite", async (req, reply) => {
    const { token, password } = req.body;
    if (!token || !password) return reply.code(400).send({ error: "token and password required" });

    try {
      const decoded = app.jwt.verify(token) as any;
      if (!decoded.inviteFor) return reply.code(400).send({ error: "Invalid invite token" });

      const users = await loadUsers();
      const user = users.find((u) => u.id === decoded.inviteFor);
      if (!user) return reply.code(404).send({ error: "User not found" });

      user.passwordHash = hashPassword(password);
      await saveUsers(users);

      const loginToken = app.jwt.sign({ id: user.id, role: user.role, name: user.name }, { expiresIn: "7d" });
      return { token: loginToken, role: user.role, name: user.name };
    } catch {
      return reply.code(400).send({ error: "Invalid or expired invite token" });
    }
  });

  // List users (admin only)
  app.get("/auth/users", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });

    const users = await loadUsers();
    return {
      users: users.map(({ passwordHash, ...rest }) => rest),
    };
  });

  // Delete user (admin only)
  app.delete<{ Params: { id: string } }>("/auth/users/:id", async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const { role } = req.user as any;
    if (role !== "admin") return reply.code(403).send({ error: "Admin only" });
    if (req.params.id === "admin") return reply.code(400).send({ error: "Cannot delete admin" });

    let users = await loadUsers();
    users = users.filter((u) => u.id !== req.params.id);
    await saveUsers(users);
    return { success: true };
  });
}
