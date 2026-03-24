import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import fastifyJwt from "@fastify/jwt";
import fastifyWebsocket from "@fastify/websocket";
import { randomBytes } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { healthRoutes } from "./routes/health.js";
import { serverRoutes } from "./routes/servers.js";
import { authRoutes } from "./routes/auth.js";
import { scriptRoutes } from "./routes/scripts.js";
import { agentWsRoutes, getAgentData } from "./ws/agentHandler.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(fastifyCors, { origin: true });
await app.register(fastifyWebsocket);

// JWT — use secret from env or generate a random one
const jwtSecret = process.env.NEST_JWT_SECRET || randomBytes(32).toString("hex");
await app.register(fastifyJwt, { secret: jwtSecret });

// WebSocket routes (agent + client) — no JWT on WebSocket for now
await app.register(agentWsRoutes);

// Auth routes (public — no JWT required)
await app.register(authRoutes, { prefix: "/api" });

// Auth middleware for all other /api routes
app.addHook("onRequest", async (req, reply) => {
  if (!req.url.startsWith("/api/") || req.url.startsWith("/api/auth/")) return;
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
  }
});

// Protected API routes
await app.register(healthRoutes, { prefix: "/api" });
await app.register(serverRoutes, { prefix: "/api" });
await app.register(scriptRoutes, { prefix: "/api" });

// Agent data API (REST fallback for live metrics)
app.get("/api/agents", async () => ({ agents: getAgentData() }));
app.get<{ Params: { hostname: string } }>("/api/agents/:hostname", async (req, reply) => {
  const data = getAgentData(req.params.hostname);
  if (!data) return reply.code(404).send({ error: "Agent not found" });
  return data;
});

// Serve client app static build (if it exists)
const clientDist = join(__dirname, "../../app/dist");
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, {
    root: clientDist,
    prefix: "/",
    wildcard: false,
  });

  // SPA fallback — serve index.html for all non-API routes
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      reply.code(404).send({ error: "Not found" });
    } else {
      reply.sendFile("index.html");
    }
  });
}

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";

await app.listen({ port, host });
console.log(`Hub listening on ${host}:${port}`);
