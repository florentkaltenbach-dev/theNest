// hub/src/nest.js
//
// Self-knowledge engine. Scans source tree, extracts metadata, serves /nest/*.
// Exports: scanNest(rootDir), nestRoutes(router, nestState)
// Depends: child_process (git log), node:fs, node:path

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname, extname, sep } from 'node:path';
import { execSync } from 'node:child_process';
import { sendJson, sendError, parseQuery } from './server.js';

// ── Service definitions ────────────────────────────────

const SERVICES = [
  { id: 'hub', role: 'The switchboard', root: 'hub/src' },
  { id: 'client', role: 'The eyes', root: 'hub/static' },
  { id: 'agent', role: 'The hands', root: 'agent' },
  { id: 'scripts', role: 'The workhorses', root: 'scripts' },
  { id: 'docs', role: 'Reference', root: 'docs' },
  { id: 'meta', role: 'The spec', root: '' },
];

// ── File walking ───────────────────────────────────────

function walkDir(dir, exts, recursive = false) {
  const results = [];
  if (!existsSync(dir)) return results;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      results.push(...walkDir(full, exts, true));
    } else if (entry.isFile() && exts.includes(extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

function listRootFiles(rootDir) {
  const allow = new Set(['.md', '.gitignore']);
  const allowNames = new Set(['.gitignore', 'LICENSE', 'config.env.example']);
  const results = [];
  if (!existsSync(rootDir)) return results;
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name);
    if (allow.has(ext) || allowNames.has(entry.name)) {
      results.push(join(rootDir, entry.name));
    }
  }
  return results;
}

// ── Header extraction ──────────────────────────────────

function extractHeader(content, ext) {
  const lines = content.split('\n');
  const header = [];

  if (ext === '.js') {
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//')) { header.push(trimmed); continue; }
      if (trimmed === '') { if (header.length > 0) header.push(''); continue; }
      break;
    }
  } else if (ext === '.py') {
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#')) { header.push(trimmed); continue; }
      if (trimmed === '') { if (header.length > 0) header.push(''); continue; }
      break;
    }
  } else if (ext === '.sh') {
    let skippedShebang = false;
    for (const line of lines) {
      const trimmed = line.trimStart();
      if (!skippedShebang && trimmed.startsWith('#!')) { skippedShebang = true; continue; }
      if (trimmed.startsWith('#')) { header.push(trimmed); continue; }
      if (trimmed === '') { if (header.length > 0) header.push(''); continue; }
      break;
    }
  }

  // Trim trailing empty lines from header
  while (header.length > 0 && header[header.length - 1] === '') header.pop();
  return header.join('\n');
}

// ── Function extraction (.js only) ─────────────────────

function extractFunctions(content, ext) {
  if (ext !== '.js') return [];
  const lines = content.split('\n');
  const functions = [];
  const exportRe = /^export\s+(async\s+)?function\s+(\w+)\s*\(([^)]*)\)/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(exportRe);
    if (!m) continue;
    const fn = { name: m[2], params: m[3].trim(), async: !!m[1], jsdoc: null };

    // Look for JSDoc in the 5 lines before
    const searchStart = Math.max(0, i - 5);
    let jsdocLines = [];
    let inDoc = false;
    for (let j = searchStart; j < i; j++) {
      const trimmed = lines[j].trimStart();
      if (trimmed.startsWith('/**')) inDoc = true;
      if (inDoc) jsdocLines.push(lines[j]);
      if (trimmed.endsWith('*/')) { inDoc = false; }
    }
    if (jsdocLines.length > 0) fn.jsdoc = jsdocLines.join('\n');
    functions.push(fn);
  }
  return functions;
}

// ── Import extraction (.js only) ───────────────────────

function extractImports(content, ext, filePath, rootDir) {
  if (ext !== '.js') return [];
  const imports = [];
  const staticRe = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  const dynamicRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;

  while ((m = staticRe.exec(content)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      const resolved = resolve(dirname(filePath), spec);
      imports.push(relative(rootDir, resolved));
    } else {
      imports.push(spec);
    }
  }
  while ((m = dynamicRe.exec(content)) !== null) {
    const spec = m[1];
    if (spec.startsWith('.')) {
      const resolved = resolve(dirname(filePath), spec);
      imports.push(relative(rootDir, resolved));
    } else {
      imports.push(spec);
    }
  }
  return imports;
}

// ── Service assignment ─────────────────────────────────

function assignService(relPath) {
  // Check from most specific to least specific
  for (const svc of SERVICES) {
    if (svc.id === 'meta') continue;
    if (svc.root && relPath.startsWith(svc.root + '/')) return svc.id;
    if (svc.root && relPath.startsWith(svc.root + sep)) return svc.id;
  }
  return 'meta';
}

// ── Graph builder ──────────────────────────────────────

function buildGraph(files, rootDir) {
  const nodes = [];
  const edges = [];
  const incomingSet = new Set();
  const outgoingSet = new Set();

  for (const [relPath, file] of files) {
    if (extname(relPath) !== '.js') continue;
    nodes.push(relPath);
    for (const imp of file.imports) {
      if (imp.startsWith('node:') || !imp.startsWith('hub/')) continue;
      const target = imp.endsWith('.js') ? imp : imp + '.js';
      edges.push({ from: relPath, to: target });
      outgoingSet.add(relPath);
      incomingSet.add(target);
    }
  }

  const orphans = nodes.filter((n) => {
    if (n.endsWith('index.js')) return false;
    return !incomingSet.has(n) && !outgoingSet.has(n);
  });

  return { nodes, edges, orphans };
}

// ── Wiring detection ───────────────────────────────────

function detectWiring(files) {
  const external = [];
  const internal = [];

  for (const [relPath, file] of files) {
    const content = file.content;
    const ext = extname(relPath);

    // HTTP fetch
    const fetchRe = /fetch\s*\(\s*[`'"](https?:\/\/[^`'")\s]+)/g;
    let m;
    while ((m = fetchRe.exec(content)) !== null) {
      external.push({ file: relPath, type: 'http', url: m[1] });
    }
    // fetch without captured URL
    if (/fetch\s*\(\s*[`'"]http/.test(content) && external.filter((e) => e.file === relPath && e.type === 'http').length === 0) {
      external.push({ file: relPath, type: 'http', url: null });
    }

    // SSH
    if (/new NodeSSH\(\)|ssh\.connect/.test(content)) {
      external.push({ file: relPath, type: 'ssh' });
    }

    // WebSocket
    if (/socket\.send\(|ws\.send\(/.test(content)) {
      internal.push({ file: relPath, type: 'websocket' });
    }

    // Process spawning
    if (/\b(spawn|exec|execSync|execFile)\s*\(/.test(content)) {
      internal.push({ file: relPath, type: 'process' });
    }

    // Docker (Python files)
    if (ext === '.py' && /docker/i.test(content)) {
      external.push({ file: relPath, type: 'docker' });
    }
  }

  return { external, internal };
}

// ── Convention checks ──────────────────────────────────

function checkConventions(files, rootDir, pageList) {
  const checks = [];
  let failCount = 0;

  // 1. fileHeaders: every .js in hub/src/ has comment in first 5 lines
  const hubJsFiles = [...files.entries()].filter(([p]) => p.startsWith('hub/src/') && p.endsWith('.js'));
  const missingHeaders = hubJsFiles.filter(([, f]) => {
    const first5 = f.content.split('\n').slice(0, 5).join('\n');
    return !/\/\//.test(first5);
  });
  const headerPass = missingHeaders.length === 0;
  if (!headerPass) failCount++;
  checks.push({ id: 'fileHeaders', pass: headerPass, detail: headerPass ? 'All hub/src/*.js files have headers' : `Missing headers: ${missingHeaders.map(([p]) => p).join(', ')}` });

  // 2. jsdocExports: every export function has /** */ above it
  const missingJsdoc = [];
  for (const [relPath, file] of files) {
    if (extname(relPath) !== '.js') continue;
    for (const fn of file.functions) {
      if (!fn.jsdoc) missingJsdoc.push(`${relPath}:${fn.name}`);
    }
  }
  const jsdocPass = missingJsdoc.length === 0;
  if (!jsdocPass) failCount++;
  checks.push({ id: 'jsdocExports', pass: jsdocPass, detail: jsdocPass ? 'All exports have JSDoc' : `Missing: ${missingJsdoc.slice(0, 10).join(', ')}${missingJsdoc.length > 10 ? ` (+${missingJsdoc.length - 10} more)` : ''}` });

  // 3. serviceAssignment: every file maps to a service
  const unmapped = [...files.keys()].filter((p) => !assignService(p));
  const svcPass = unmapped.length === 0;
  if (!svcPass) failCount++;
  checks.push({ id: 'serviceAssignment', pass: svcPass, detail: svcPass ? 'All files assigned to a service' : `Unmapped: ${unmapped.join(', ')}` });

  // 4. pageRegistration: every .html in hub/static/ in page table
  const htmlFiles = [...files.keys()].filter((p) => p.startsWith('hub/static/') && p.endsWith('.html'));
  const pageFiles = new Set((pageList || []).map((p) => `hub/static/${p.file}`));
  const unregistered = htmlFiles.filter((p) => !pageFiles.has(p));
  const pagePass = unregistered.length === 0;
  if (!pagePass) failCount++;
  checks.push({ id: 'pageRegistration', pass: pagePass, detail: pagePass ? 'All HTML pages registered' : `Unregistered: ${unregistered.join(', ')}` });

  // 5. maxFileLength: no file > 200 lines
  const longFiles = [...files.entries()].filter(([, f]) => f.lines > 200);
  const lengthPass = longFiles.length === 0;
  if (!lengthPass) failCount++;
  checks.push({ id: 'maxFileLength', pass: lengthPass, detail: lengthPass ? 'All files under 200 lines' : `Over limit: ${longFiles.map(([p, f]) => `${p} (${f.lines})`).join(', ')}` });

  const total = checks.length;
  const status = failCount === 0 ? 'green' : failCount > total / 2 ? 'red' : 'yellow';
  return { status, checks };
}

// ── Git history ────────────────────────────────────────

function cacheGitHistory(files, rootDir) {
  for (const [relPath, file] of files) {
    try {
      const raw = execSync(`git log --format='%h %aI %s' -n 5 -- ${relPath}`, {
        cwd: rootDir, encoding: 'utf-8',
      });
      file.gitHistory = raw.trim().split('\n').filter(Boolean).map((line) => {
        const spaceIdx = line.indexOf(' ');
        const hash = line.slice(0, spaceIdx);
        const rest = line.slice(spaceIdx + 1);
        const dateEnd = rest.indexOf(' ');
        const date = rest.slice(0, dateEnd);
        const message = rest.slice(dateEnd + 1);
        return { hash, date, message };
      });
    } catch {
      file.gitHistory = [];
    }
  }
}

// ── scanNest ───────────────────────────────────────────

/**
 * @param {string} rootDir - absolute path to the nest root
 * @param {{ pages?: Array }} opts - optional page list for convention checks
 * @returns {Promise<Object>} nestState
 */
export async function scanNest(rootDir, opts = {}) {
  const files = new Map();

  // Collect file paths
  const paths = [
    ...walkDir(join(rootDir, 'hub/src'), ['.js'], true),
    ...walkDir(join(rootDir, 'agent/nest_agent'), ['.py']),
    ...walkDir(join(rootDir, 'scripts'), ['.sh'], true),
    ...walkDir(join(rootDir, 'docs'), ['.md']),
    ...listRootFiles(rootDir),
  ];

  for (const absPath of paths) {
    const relPath = relative(rootDir, absPath);
    const content = readFileSync(absPath, 'utf-8');
    const ext = extname(absPath);
    const st = statSync(absPath);
    const lineCount = content.split('\n').length;

    files.set(relPath, {
      path: relPath,
      service: assignService(relPath),
      header: extractHeader(content, ext),
      size: st.size,
      lines: lineCount,
      functions: extractFunctions(content, ext),
      imports: extractImports(content, ext, absPath, rootDir),
      exports: extractFunctions(content, ext).map((f) => f.name),
      gitHistory: [],
      content,
    });
  }

  const graph = buildGraph(files, rootDir);
  const wiring = detectWiring(files);
  const conventions = checkConventions(files, rootDir, opts.pages || []);

  cacheGitHistory(files, rootDir);

  return { files, graph, wiring, conventions, services: SERVICES };
}

// ── Path security ──────────────────────────────────────

function validatePath(queryPath, rootDir) {
  if (!queryPath) return null;
  const resolved = resolve(rootDir, queryPath);
  if (!resolved.startsWith(rootDir + sep) && resolved !== rootDir) return null;
  const rel = relative(rootDir, resolved);
  if (rel.startsWith('..')) return null;
  // Must be within a known service root (or meta at root level)
  const svc = assignService(rel);
  if (!svc) return null;
  return rel;
}

// ── nestRoutes ─────────────────────────────────────────

/**
 * @param {{ get: Function, routes: Array }} router
 * @param {Object} nestState
 */
export function nestRoutes(router, nestState, fullRouter) {
  const { files, graph, wiring, conventions, services } = nestState;

  // 1. GET /nest/services
  router.get('/nest/services', (req, res) => {
    sendJson(res, { services });
  }, 'hub/src/nest.js');

  // 2. GET /nest/folder?path=X
  router.get('/nest/folder', (req, res) => {
    const rootDir = resolve(dirname(new URL(import.meta.url).pathname), '../..');
    const query = parseQuery(req.url);
    const prefix = validatePath(query.path || '', rootDir);
    if (prefix === null) return sendError(res, 400, 'Invalid path');

    const result = [];
    for (const [relPath, file] of files) {
      if (!relPath.startsWith(prefix)) continue;
      const lastCommit = file.gitHistory.length > 0 ? file.gitHistory[0] : null;
      result.push({
        path: relPath,
        header: file.header,
        exports: file.exports,
        size: file.size,
        lastCommit,
      });
    }

    // Split into direct files and subdirectories
    const directFiles = [];
    const subdirs = new Set();
    const prefixDepth = prefix ? prefix.split('/').length : 0;

    for (const item of result) {
      const parts = item.path.split('/');
      const depth = parts.length;
      if (depth === prefixDepth + 1) {
        // Direct child file
        directFiles.push(item);
      } else if (depth > prefixDepth + 1) {
        // File in a subdirectory — record the subdir name
        subdirs.add(parts.slice(0, prefixDepth + 1).join('/'));
      }
    }

    const dirs = [...subdirs].map(d => ({
      name: d.split('/').pop(),
      path: d,
      isDir: true,
    }));

    sendJson(res, { path: prefix, files: directFiles, directories: dirs });
  }, 'hub/src/nest.js');

  // 3. GET /nest/file?path=X
  router.get('/nest/file', (req, res) => {
    const rootDir = resolve(dirname(new URL(import.meta.url).pathname), '../..');
    const query = parseQuery(req.url);
    const relPath = validatePath(query.path, rootDir);
    if (!relPath) return sendError(res, 400, 'Invalid path');

    const file = files.get(relPath);
    if (!file) return sendError(res, 404, 'File not found in scan');

    // Reverse lookup: who imports this file
    const importedBy = graph.edges
      .filter((e) => e.to === relPath || e.to === relPath.replace(/\.js$/, ''))
      .map((e) => e.from);

    // Routes served by this file
    const routes = (fullRouter || router).routes
      .filter((r) => r.source === relPath)
      .map((r) => ({ method: r.method, pattern: r.pattern }));

    // External calls from wiring
    const externalCalls = [
      ...wiring.external.filter((w) => w.file === relPath),
      ...wiring.internal.filter((w) => w.file === relPath),
    ];

    sendJson(res, {
      path: relPath,
      service: file.service,
      header: file.header,
      size: file.size,
      lines: file.lines,
      functions: file.functions,
      imports: file.imports,
      importedBy,
      routes,
      externalCalls,
      gitHistory: file.gitHistory,
    });
  }, 'hub/src/nest.js');

  // 4. GET /nest/surface
  router.get('/nest/surface', (req, res) => {
    const bySource = {};
    for (const route of (fullRouter || router).routes) {
      const src = route.source || 'unknown';
      if (!bySource[src]) bySource[src] = [];
      bySource[src].push({ method: route.method, pattern: route.pattern });
    }

    // WebSocket endpoints
    const websockets = [
      { path: '/ws/agent', handler: 'ws/agentHandler.js' },
      { path: '/ws/client', handler: 'ws/agentHandler.js' },
      { path: '/ws/terminal', handler: 'ws/terminal.js' },
    ];

    sendJson(res, { routes: bySource, websockets });
  }, 'hub/src/nest.js');

  // 5. GET /nest/graph
  router.get('/nest/graph', (req, res) => {
    sendJson(res, { graph });
  }, 'hub/src/nest.js');

  // 6. GET /nest/health/conventions
  router.get('/nest/health/conventions', (req, res) => {
    sendJson(res, { conventions });
  }, 'hub/src/nest.js');

  // 7. GET /nest/wiring
  router.get('/nest/wiring', (req, res) => {
    sendJson(res, { wiring });
  }, 'hub/src/nest.js');

  // 8. GET /nest/state
  router.get('/nest/state', async (req, res) => {
    let agentData = [];
    try {
      const mod = await import('./ws/agentHandler.js');
      agentData = mod.getAgentData() || [];
    } catch {}

    const connectedAgents = Array.isArray(agentData) ? agentData.length : 0;
    const containers = Array.isArray(agentData)
      ? agentData.reduce((sum, a) => sum + (a.containers?.length || 0), 0)
      : 0;

    sendJson(res, {
      uptime: process.uptime(),
      routeCount: (fullRouter || router).routes.length,
      fileCount: files.size,
      serviceCount: services.length,
      conventionStatus: conventions.status,
      agents: { connected: connectedAgents, containers },
    });
  }, 'hub/src/nest.js');
}
