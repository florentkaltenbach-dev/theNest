// ── scripts.js ────────────────────────────────────────
// Script listing, viewing, execution via SSH
// ──────────────────────────────────────────────────────
import { NodeSSH } from "node-ssh";
import { readdir, readFile, stat } from "fs/promises";
import { join, dirname, basename, resolve } from "path";
import { fileURLToPath } from "url";
import { sendJson, sendError, parseQuery } from '../server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(__dirname, "../../../scripts");
const REPOS_DIR = process.env.NEST_REPOS_DIR || "/opt/repos";

const runs = new Map();
let runCounter = 0;

function parseScriptTags(content, filename) {
  const lines = content.split("\n").slice(0, 20);
  const tags = {};
  for (const line of lines) {
    const m = line.match(/^#\s*@(\w+)\s+(.+)$/);
    if (m) tags[m[1]] = m[2].trim();
  }
  return {
    name: tags.name || basename(filename, ".sh"),
    description: tags.description || null,
    author: tags.author || null,
    target: tags.target || "any",
    args: tags.args || null,
    dangerous: tags.dangerous === "true",
  };
}

function findSources(content) {
  const sources = [];
  const re = /(?:source|\.)\s+"([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    let src = m[1];
    src = src.replace(/\$\{[^}]+\}\//g, "").replace(/\$[A-Za-z_]+\//g, "");
    if (src) sources.push(src);
  }
  return sources;
}

function hasPositionalArgs(content) {
  return /\$[1-9]|\$\{[1-9]/.test(content);
}

async function enrichScript(dir, relPath, repo = null) {
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

async function listScriptsRecursive(dir, prefix = "") {
  const result = [];
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

export function scriptRoutes(router) {
  // List available scripts with enriched metadata
  router.get("/scripts", async (req, res) => {
    // Built-in scripts
    const builtinPaths = await listScriptsRecursive(SCRIPTS_DIR);
    const builtinScripts = await Promise.all(
      builtinPaths.map((p) => enrichScript(SCRIPTS_DIR, p, null))
    );

    // Repo scripts from /opt/repos/*/
    const repoScripts = [];
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

    sendJson(res, { scripts: [...builtinScripts, ...repoScripts] });
  });

  // Read script content
  router.get("/scripts/view/*", async (req, res) => {
    const scriptPath = req.params['*'];
    const query = parseQuery(req.url);
    const repo = query.repo || null;
    if (!scriptPath || scriptPath.includes("..")) {
      return sendError(res, 400, "Invalid path");
    }
    if (repo && !/^[a-zA-Z0-9_-]+$/.test(repo)) {
      return sendError(res, 400, "Invalid repo name");
    }
    const baseDir = repo ? join(REPOS_DIR, repo) : SCRIPTS_DIR;
    const fullPath = resolve(baseDir, scriptPath);
    if (!fullPath.startsWith(resolve(baseDir))) {
      return sendError(res, 400, "Invalid path");
    }
    try {
      const content = await readFile(fullPath, "utf-8");
      sendJson(res, { path: scriptPath, content, repo });
    } catch {
      sendError(res, 404, "Script not found");
    }
  });

  // Run a script on a server
  router.post("/scripts/run", async (req, res) => {
    const { script, serverIp, repo } = req.body;
    if (!script || !serverIp) {
      return sendError(res, 400, "script and serverIp required");
    }
    if (repo && !/^[a-zA-Z0-9_-]+$/.test(repo)) {
      return sendError(res, 400, "Invalid repo name");
    }

    const baseDir = repo ? join(REPOS_DIR, repo) : SCRIPTS_DIR;
    const scriptContent = await readFile(join(baseDir, script), "utf-8").catch(() => null);
    if (!scriptContent) {
      return sendError(res, 404, "Script not found");
    }

    const id = `run-${++runCounter}-${Date.now()}`;
    const run = {
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

    sendJson(res, { id, status: "running" });
  });

  // Get run status and output
  router.get("/scripts/runs/:id", async (req, res) => {
    const run = runs.get(req.params.id);
    if (!run) return sendError(res, 404, "Run not found");

    const query = parseQuery(req.url);
    const since = parseInt(query.since || "0", 10);
    sendJson(res, {
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
    });
  });

  // List recent runs
  router.get("/scripts/runs", async (req, res) => {
    const recent = Array.from(runs.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 20)
      .map(({ output, ...rest }) => ({ ...rest, outputLines: output.length }));
    sendJson(res, { runs: recent });
  });
}

async function executeScript(run, scriptContent, serverIp) {
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
      onStdout: (chunk) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        run.output.push(...lines);
      },
      onStderr: (chunk) => {
        const lines = chunk.toString().split("\n").filter(Boolean);
        run.output.push(...lines.map((l) => `[STDERR] ${l}`));
      },
    });

    run.exitCode = result.code ?? undefined;
    run.status = result.code === 0 ? "completed" : "failed";
    run.output.push("---");
    run.output.push(`[INFO] Exit code: ${result.code}`);
  } catch (e) {
    run.status = "failed";
    run.output.push(`[ERROR] ${e.message}`);
  } finally {
    ssh.dispose();
    run.finishedAt = Date.now();
  }
}
