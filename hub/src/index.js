// hub/src/index.js
//
// Main entry point. Wires router, auth middleware, WebSocket upgrade, page serving.
// Exports: nothing (entry point)
// Depends: node:http, ws, server.js, all route modules, HUB.md page table

import { createServer } from 'node:http';
import { existsSync, readFileSync, appendFileSync, statSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import {
  createRouter, parseBody, sendJson, sendError, sendFile,
  signJwt, verifyJwt, handleCors, corsHeaders, parseQuery,
} from './server.js';

import { healthRoutes } from './routes/health.js';
import { serverRoutes } from './routes/servers.js';
import { authRoutes, loadTokens, hashToken, ensureJwtSecret } from './routes/auth.js';
import { scriptRoutes } from './routes/scripts.js';
import { chatRoutes } from './routes/chat.js';
import { secretRoutes } from './routes/secrets.js';
import { appendageRoutes } from './routes/appendages.js';
import { setupRoutes } from './routes/setup.js';
import { roadmapRoutes } from './routes/roadmap.js';
import { enhanceRoutes } from './routes/enhance.js';
import { sessionRoutes } from './routes/sessions.js';
import { projectRoutes } from './routes/projects.js';
import { tokenRoutes } from './routes/tokens.js';
import { artifactRoutes } from './routes/artifacts.js';
import { canvasRoutes } from './routes/canvas.js';
import { handleAgentWs, handleClientWs, getAgentData } from './ws/agentHandler.js';
import { createTerminalHandler } from './ws/terminal.js';
import { scanNest, nestRoutes } from './nest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(__dirname, '../static');
const NEST_ROOT = join(__dirname, '../..');

// ── JWT secret ──────────────────────────────────────────

const jwtSecret = ensureJwtSecret();
const jwt = {
  sign: (payload, expiresIn = '7d') => signJwt(payload, jwtSecret, expiresIn),
  verify: (token) => verifyJwt(token, jwtSecret),
};

// ── Parse HUB.md page table ─────────────────────────────

function parsePageTable() {
  const hubMdPath = join(NEST_ROOT, 'HUB.md');
  if (!existsSync(hubMdPath)) {
    console.warn('HUB.md not found — using fallback page table');
    return defaultPageTable();
  }

  try {
    const content = readFileSync(hubMdPath, 'utf-8');
    const pages = [];
    const lines = content.split('\n');
    let inPageTable = false;

    for (const line of lines) {
      // Detect start of page table (after "## 2. Pages" heading, look for table rows)
      if (line.startsWith('## 2.')) { inPageTable = true; continue; }
      if (inPageTable && line.startsWith('## ')) break; // next section

      if (!inPageTable) continue;
      // Parse markdown table row: | /path | file.html | Title | yes/no |
      const m = line.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|\s*([^|]+)\|\s*(yes|no)\s*\|/);
      if (m) {
        pages.push({ path: m[1], file: m[2], title: m[3].trim(), auth: m[4] === 'yes' });
      }
    }

    if (pages.length > 0) {
      console.log(`Loaded ${pages.length} pages from HUB.md`);
      return pages;
    }
  } catch (e) {
    console.warn('Failed to parse HUB.md:', e.message);
  }

  return defaultPageTable();
}

function defaultPageTable() {
  return [
    { path: '/', file: 'index.html', title: 'Home', auth: true },
    { path: '/login', file: 'login.html', title: 'Login', auth: false },
    { path: '/terminal', file: 'terminal.html', title: 'Terminal', auth: true },
    { path: '/scripts', file: 'scripts.html', title: 'Scripts', auth: true },
    { path: '/secrets', file: 'secrets.html', title: 'Secrets', auth: true },
    { path: '/settings', file: 'settings.html', title: 'Settings', auth: true },
    { path: '/tokens', file: 'tokens.html', title: 'Tokens', auth: true },
    { path: '/projects', file: 'projects.html', title: 'Projects', auth: true },
    { path: '/artifacts', file: 'artifacts.html', title: 'Artifacts', auth: true },
    { path: '/claw', file: 'claw.html', title: 'OpenClaw', auth: true },
    { path: '/commands', file: 'commands.html', title: 'Commands', auth: true },
    { path: '/invite', file: 'invite.html', title: 'Invite', auth: false },
    { path: '/journeys', file: 'journeys.html', title: 'Journeys', auth: true },
    { path: '/onboarding', file: 'onboarding.html', title: 'Onboarding', auth: false },
    { path: '/roadmap', file: 'roadmap.html', title: 'Roadmap', auth: true },
    { path: '/routes', file: 'routes.html', title: 'API Surface', auth: true },
    { path: '/server/:id', file: 'server.html', title: 'Server Detail', auth: true },
    { path: '/tasks', file: 'tasks.html', title: 'Tasks', auth: true },
    { path: '/nest', file: 'nest.html', title: 'Nest Explorer', auth: true },
  ];
}

const pages = parsePageTable();

// ── Create router ───────────────────────────────────────

const router = createRouter();

// ── Public API routes ───────────────────────────────────

const PUBLIC_PREFIXES = ['/api/auth/', '/api/setup/', '/api/health', '/api/roadmap', '/api/routes', '/api/direct-login'];

function isPublicRoute(url) {
  return PUBLIC_PREFIXES.some((p) => url.startsWith(p));
}

// ── Auth middleware ─────────────────────────────────────

function parseCookie(header, name) {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function tryAuth(req, token) {
  if (!token) return false;
  // JWT
  if (!token.startsWith('nest_')) {
    try { req.user = jwt.verify(token); return true; } catch {}
    return false;
  }
  // API token
  const tokens = await loadTokens();
  const th = hashToken(token);
  const matched = tokens.find((t) => t.tokenHash === th);
  if (matched) {
    req.user = { id: matched.id, role: matched.role, name: matched.name };
    matched.lastUsed = Date.now();
    saveTokens(tokens).catch(() => {});
    return true;
  }
  return false;
}

async function authMiddleware(req, res) {
  const url = req.url.split('?')[0];

  // Extract token from: Bearer header > cookie
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const cookieToken = parseCookie(req.headers.cookie, 'nest_token');
  const token = bearerToken || cookieToken;

  // Non-API routes: try to set req.user but don't block
  if (!url.startsWith('/api/')) {
    if (token) await tryAuth(req, token);
    return true;
  }

  // Try to authenticate (sets req.user if valid token)
  if (token) await tryAuth(req, token);

  // Public API routes — let through even without auth
  if (isPublicRoute(url)) return true;

  // Protected routes — require auth
  if (req.user) return true;

  sendError(res, 401, 'Unauthorized');
  return false;
}

// ── Register API routes (all under /api prefix) ─────────

const api = router.withPrefix('/api');

authRoutes(api, jwt);
healthRoutes(api);
serverRoutes(api);
scriptRoutes(api);
chatRoutes(api);
secretRoutes(api);
appendageRoutes(api);
setupRoutes(api);
roadmapRoutes(api);
enhanceRoutes(api);
sessionRoutes(api);
projectRoutes(api);
tokenRoutes(api);
artifactRoutes(api);
canvasRoutes(api);

// Self-knowledge engine
const nestState = await scanNest(NEST_ROOT, { pages });
nestRoutes(api, nestState, router);

// Route introspection
api.get('/routes', (req, res) => {
  const sorted = router.routes
    .map((r) => ({ method: r.method, url: r.pattern }))
    .sort((a, b) => a.url.localeCompare(b.url) || a.method.localeCompare(b.method));
  sendJson(res, { routes: sorted });
});

// Agent data REST endpoints
api.get('/agents', (req, res) => {
  sendJson(res, { agents: getAgentData() });
});

api.get('/agents/:hostname', (req, res) => {
  const data = getAgentData(req.params.hostname);
  if (!data) return sendError(res, 404, 'Agent not found');
  sendJson(res, data);
});

// ── Register page routes from page table ────────────────

for (const page of pages) {
  router.get(page.path, (req, res) => {
    // Always serve the file — client-side JS handles auth via localStorage
    sendFile(res, join(STATIC_DIR, page.file));
  });
}

// Static assets (icons, manifest)
router.get('/icon-192.png', (req, res) => sendFile(res, join(STATIC_DIR, 'icon-192.png')));
router.get('/icon-512.png', (req, res) => sendFile(res, join(STATIC_DIR, 'icon-512.png')));
router.get('/manifest.webmanifest', (req, res) => sendFile(res, join(STATIC_DIR, 'manifest.webmanifest')));

// ── Request logging ─────────────────────────────────────

const LOG_FILE = '/opt/nest/data/requests.jsonl';
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5MB — oldest lines lost on rotation

function logRequest(req, res, startTime) {
  try {
    const dir = join(LOG_FILE, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      ts: Date.now(),
      method: req.method,
      path: req.url,
      status: res.statusCode,
      ms: Date.now() - startTime,
    }) + '\n';
    appendFileSync(LOG_FILE, line);
    // Rotate: when file exceeds max, keep the newest half
    try {
      const size = statSync(LOG_FILE).size;
      if (size > LOG_MAX_BYTES) {
        const content = readFileSync(LOG_FILE, 'utf-8');
        const lines = content.trim().split('\n');
        const keep = lines.slice(Math.floor(lines.length / 2));
        renameSync(LOG_FILE, LOG_FILE + '.old');
        appendFileSync(LOG_FILE, keep.join('\n') + '\n');
      }
    } catch {}
  } catch {}
}

// ── HTTP server ─────────────────────────────────────────

const server = createServer(async (req, res) => {
  const startTime = Date.now();
  res.on('finish', () => logRequest(req, res, startTime));

  // CORS
  if (handleCors(req, res)) return;
  corsHeaders(res);

  // Parse body for POST/PUT/DELETE
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    try {
      req.body = await parseBody(req);
    } catch {
      return sendError(res, 400, 'Invalid request body');
    }
  }

  // Auth middleware
  const allowed = await authMiddleware(req, res);
  if (!allowed) return;

  // Route matching
  const url = req.url.split('?')[0];
  const match = router.match(req.method, url);
  if (match) {
    req.params = match.params;
    req.query = parseQuery(req.url);
    try {
      await match.handler(req, res);
    } catch (err) {
      console.error(`Error handling ${req.method} ${req.url}:`, err);
      if (!res.writableEnded) sendError(res, 500, 'Internal server error');
    }
    return;
  }

  // 404
  if (url.startsWith('/api/') || url.startsWith('/ws/')) {
    sendError(res, 404, 'Not found');
  } else {
    sendError(res, 404, 'Page not found');
  }
});

// ── WebSocket upgrade ───────────────────────────────────

const wss = new WebSocketServer({ noServer: true });
const handleTerminalWs = createTerminalHandler(jwtSecret);

server.on('upgrade', (req, socket, head) => {
  const url = req.url.split('?')[0];

  if (url === '/ws/agent') {
    wss.handleUpgrade(req, socket, head, (ws) => handleAgentWs(ws));
    return;
  }

  if (url === '/ws/client') {
    wss.handleUpgrade(req, socket, head, (ws) => handleClientWs(ws));
    return;
  }

  if (url === '/ws/terminal') {
    wss.handleUpgrade(req, socket, head, (ws) => handleTerminalWs(ws, req));
    return;
  }

  socket.destroy();
});

// ── Listen ──────────────────────────────────────────────

const port = parseInt(process.env.PORT || '3000', 10);
const host = process.env.HOST || '0.0.0.0';

server.listen(port, host, () => {
  console.log(`Hub listening on ${host}:${port}`);
});
