import { FastifyInstance } from "fastify";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function roadmapRoutes(app: FastifyInstance) {
  app.get("/roadmap", async () => {
    const filePath = join(__dirname, "../../../ROADMAP.md");
    if (!existsSync(filePath)) {
      return { content: "# Roadmap\n\nNo roadmap found." };
    }
    const content = await readFile(filePath, "utf-8");
    return { content };
  });
}
