import { FastifyInstance } from "fastify";
import { randomBytes } from "crypto";

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const { password } = req.body as { password?: string };
    const adminPassword = process.env.NEST_ADMIN_PASSWORD;

    if (!adminPassword) {
      return reply.code(500).send({ error: "NEST_ADMIN_PASSWORD not configured" });
    }

    if (!password || password !== adminPassword) {
      return reply.code(401).send({ error: "Invalid password" });
    }

    const token = app.jwt.sign({ role: "admin" }, { expiresIn: "7d" });
    return { token };
  });

  app.get("/auth/me", async (req, reply) => {
    try {
      await req.jwtVerify();
      return { role: (req.user as any).role };
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
}
