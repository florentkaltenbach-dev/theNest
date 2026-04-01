import { FastifyInstance } from "fastify";
import { NodeSSH } from "node-ssh";
import { readdir, readFile, stat } from "fs/promises";
import { join, dirname, basename, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, "../../../scripts");
const REPOS_DIR = process.env.NEST_REPOS_DIR || "/opt/repos";

interface ScriptMeta {
  path: string;
  name: string;
  description: string | null;
  author: string | null;
  target: "remote" | "local" | "any";
  args: string | null;
  dangerous: boolean;
  lines: number;
  modified: string;
  sources: string[];
  hasArgs: boolean;
  repo: string | null;
}

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

function parseScriptTags(content: string, filename: string): Omit<ScriptMeta, "path" | "lines" | "modified" | "sources" | "hasArgs" | "repo"> {
  const lines = content.split("\n").slice(0, 20);
  const tags: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(/^#\s*@(\w+)\s+(.+)$/);
    if (m) tags[m[1]] = m[2].trim();
  }
  return {
    name: tags.name || basename(filename, ".sh"),
    description: tags.description || null,
    author: tags.author || null,
    target: (tags.target as "remote" | "local" | "any") || "any",
    args: tags.args || null,
    dangerous: tags.dangerous === "true",
  };
}

function findSources(content: string): string[] {
  const sources: string[] = [];
  const re = /(?:source|\.)\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    // Extract just the relative filename portion
    let src = m[1];
    // Strip variable prefixes like ${SCRIPT_DIR}/
    src = src.replace(/\$\{[^}]+\}\//g, "").replace(/\$[A-Za-z_]+\//g, "");
    if (src) sources.push(src);
  }
  return sources;
}

function hasPositionalArgs(content: string): boolean {
  return /\$[1-9]|\$\{[1-9]/.test(content);
}

async function enrichScript(dir: string, relPath: string, repo: string | null = null): Promise<ScriptMeta> {
  const fullPath = join(dir, relPath);
  const [content, fstat] = await Promise.all([
    readFile(fullPath, "utf-8"),
    stat(fullPath),
  ]);
  const tags = parseScriptTags(content, basename(relPath));
  return {
    path: relPath,
    ...tags,
    lines: content.split("\n").length,
    modified: fstat.mtime.toISOString(),
    sources: findSources(content),
    hasArgs: hasPositionalArgs(content),
    repo,
  };
}

async function listScriptsRecursive(dir: string, prefix = ""): Promise<string[]> {
  const result: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        result.push(...await listScriptsRecursive(fullPath, relPath));
      } else if (entry.name.endsWith(".sh")) {
        result.push(relPath);
      }
    }
  } catch {}
  return result;
}

export async function scriptRoutes(app: FastifyInstance) {
  // List available scripts with enriched metadata
  app.get("/scripts", async () => {
    // Built-in scripts
    const builtinPaths = await listScriptsRecursive(SCRIPTS_DIR);
    const builtinScripts = await Promise.all(
      builtinPaths.map((p) => enrichScript(SCRIPTS_DIR, p, null))
    );

    // Repo scripts from /opt/repos/*/
    const repoScripts: ScriptMeta[] = [];
    try {
      const repos = await readdir(REPOS_DIR, { withFileTypes: true });
      for (const repo of repos) {
        if (!repo.isDirectory()) continue;
        const repoDir = join(REPOS_DIR, repo.name);
        const paths = await listScriptsRecursive(repoDir);
        const scripts = await Promise.all(
          paths.map((p) => enrichScript(repoDir, p, repo.name))
        );
        repoScripts.push(...scripts);
      }
    } catch {
      // /opt/repos/ doesn't exist yet — that's fine
    }

    return { scripts: [...builtinScripts, ...repoScripts] };
  });

  // Read script content
  app.get<{ Params: { path: string }; Querystring: { repo?: string } }>("/scripts/view/*", async (req, reply) => {
    const scriptPath = (req.params as any)["*"];
    const repo = req.query.repo || null;
    if (!scriptPath || scriptPath.includes("..")) {
      return reply.code(400).send({ error: "Invalid path" });
    }
    if (repo && !/^[a-zA-Z0-9_-]+$/.test(repo)) {
      return reply.code(400).send({ error: "Invalid repo name" });
    }
    const baseDir = repo ? join(REPOS_DIR, repo) : SCRIPTS_DIR;
    const fullPath = resolve(baseDir, scriptPath);
    if (!fullPath.startsWith(resolve(baseDir))) {
      return reply.code(400).send({ error: "Invalid path" });
    }
    try {
      const content = await readFile(fullPath, "utf-8");
      return { path: scriptPath, content, repo };
    } catch {
      return reply.code(404).send({ error: "Script not found" });
    }
  });

  // Run a script on a server
  app.post<{ Body: { script: string; serverIp: string; repo?: string } }>("/scripts/run", async (req, reply) => {
    const { script, serverIp, repo } = req.body;
    if (!script || !serverIp) {
      return reply.code(400).send({ error: "script and serverIp required" });
    }
    if (repo && !/^[a-zA-Z0-9_-]+$/.test(repo)) {
      return reply.code(400).send({ error: "Invalid repo name" });
    }

    const baseDir = repo ? join(REPOS_DIR, repo) : SCRIPTS_DIR;
    const scriptContent = await readFile(join(baseDir, script), "utf-8").catch(() => null);
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

    run.exitCode = result.code ?? undefined;
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
