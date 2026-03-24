import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import { healthRoutes } from "./routes/health.js";
import { serverRoutes } from "./routes/servers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: true });

await app.register(fastifyCors, { origin: true });

// API routes
await app.register(healthRoutes, { prefix: "/api" });
await app.register(serverRoutes, { prefix: "/api" });

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
