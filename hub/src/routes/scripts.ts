import { FastifyInstance } from "fastify";
import { NodeSSH } from "node-ssh";
import { readdir, readFile, stat } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, "../../../scripts");

interface RunningScript {
  id: string;
  script: string;
  server: string;
  status: "running" | "completed" | "failed";
  output: string[];
  startedAt: number;
  finishedAt?: number;
  exitCode?: number;
}

const runs = new Map<string, RunningScript>();
let runCounter = 0;

async function listScriptsRecursive(dir: string, prefix = ""): Promise<{ path: string; name: string }[]> {
  const result: { path: string; name: string }[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result.push(...await listScriptsRecursive(fullPath, relPath));
      } else if (entry.name.endsWith(".sh")) {
        result.push({ path: relPath, name: entry.name });
      }
    }
  } catch {}
  return result;
}

export async function scriptRoutes(app: FastifyInstance) {
  // List available scripts
  app.get("/scripts", async () => {
    const scripts = await listScriptsRecursive(SCRIPTS_DIR);
    return { scripts };
  });

  // Read script content
  app.get<{ Params: { path: string } }>("/scripts/view/*", async (req, reply) => {
    const scriptPath = (req.params as any)["*"];
    const fullPath = join(SCRIPTS_DIR, scriptPath);
    try {
      const content = await readFile(fullPath, "utf-8");
      return { path: scriptPath, content };
    } catch {
      return reply.code(404).send({ error: "Script not found" });
    }
  });

  // Run a script on a server
  app.post<{ Body: { script: string; serverIp: string } }>("/scripts/run", async (req, reply) => {
    const { script, serverIp } = req.body;
    if (!script || !serverIp) {
      return reply.code(400).send({ error: "script and serverIp required" });
    }

    const scriptContent = await readFile(join(SCRIPTS_DIR, script), "utf-8").catch(() => null);
    if (!scriptContent) {
      return reply.code(404).send({ error: "Script not found" });
    }

    const id = `run-${++runCounter}-${Date.now()}`;
    const run: RunningScript = {
      id,
      script,
      server: serverIp,
      status: "running",
      output: [],
      startedAt: Date.now(),
    };
    runs.set(id, run);

    // Execute async — don't await
    executeScript(run, scriptContent, serverIp).catch((e) => {
      run.status = "failed";
      run.output.push(`[ERROR] ${e.message}`);
      run.finishedAt = Date.now();
    });

    return { id, status: "running" };
  });

  // Get run status and output
  app.get<{ Params: { id: string }; Querystring: { since?: string } }>("/scripts/runs/:id", async (req, reply) => {
    const run = runs.get(req.params.id);
    if (!run) return reply.code(404).send({ error: "Run not found" });

    const since = parseInt(req.query.since || "0", 10);
    return {
      id: run.id,
      script: run.script,
      server: run.server,
      status: run.status,
      output: run.output.slice(since),
      outputOffset: since,
      totalLines: run.output.length,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      exitCode: run.exitCode,
    };
  });

  // List recent runs
  app.get("/scripts/runs", async () => {
    const recent = Array.from(runs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 20)
      .map(({ output, ...rest }) => ({ ...rest, outputLines: output.length }));
    return { runs: recent };
  });
}

async function executeScript(run: RunningScript, scriptContent: string, serverIp: string) {
  const ssh = new NodeSSH();
  const keyPath = process.env.SSH_KEY_PATH || "/home/claude/.ssh/nest-deploy-key";

  try {
    await ssh.connect({
      host: serverIp,
      username: "claude",
      privateKeyPath: keyPath,
      readyTimeout: 10000,
    });

    run.output.push(`[INFO] Connected to ${serverIp}`);
    run.output.push(`[INFO] Running: ${run.script}`);
    run.output.push("---");

    const result = await ssh.execCommand(`bash -s`, {
      stdin: scriptContent,
      onStdout: (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        run.output.push(...lines);
      },
      onStderr: (chunk: Buffer) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        run.output.push(...lines.map((l) => `[STDERR] ${l}`));
      },
    });

    run.exitCode = result.code;
    run.status = result.code === 0 ? "completed" : "failed";
    run.output.push("---");
    run.output.push(`[INFO] Exit code: ${result.code}`);
  } catch (e: any) {
    run.status = "failed";
    run.output.push(`[ERROR] ${e.message}`);
  } finally {
    ssh.dispose();
    run.finishedAt = Date.now();
  }
}
