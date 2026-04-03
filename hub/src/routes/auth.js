// hub/src/routes/auth.js
//
// Authentication: login, users, invites, API tokens.
// Exports: authRoutes(router, jwt), loadTokens, saveTokens, hashToken, ensureJwtSecret
// Depends: NEST_JWT_SECRET env var (auto-generated if missing)

import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { sendJson, sendError, requireAdmin } from '../server.js';

const USERS_FILE = process.env.NEST_USERS_FILE || '/opt/nest/users.json';
const TOKENS_FILE = process.env.NEST_TOKENS_FILE || '/opt/nest/tokens.json';
const CONFIG_PATH = process.env.NEST_CONFIG_PATH || '/opt/nest/config.env';

// ── Password hashing (scrypt) ───────────────────────────

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored.includes(':')) {
    // Legacy SHA256 hash — verify with old method
    const legacy = createHash('sha256').update(password).digest('hex');
    return legacy === stored;
  }
  const [salt, hash] = stored.split(':');
  const test = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

function needsMigration(stored) {
  return !stored.includes(':');
}

// ── API token hashing (SHA256 — fine for high-entropy random tokens) ──

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// ── JWT secret persistence ──────────────────────────────

export function ensureJwtSecret() {
  if (process.env.NEST_JWT_SECRET) return process.env.NEST_JWT_SECRET;

  // Check config.env directly (Hub may not have been started via the shell wrapper)
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, 'utf-8');
      const match = content.match(/^NEST_JWT_SECRET=(.+)$/m);
      if (match) {
        process.env.NEST_JWT_SECRET = match[1].trim();
        return process.env.NEST_JWT_SECRET;
      }
    }
  } catch {}

  const secret = randomBytes(32).toString('hex');
  try {
    appendFileSync(CONFIG_PATH, `\nNEST_JWT_SECRET=${secret}\n`);
  } catch (e) {
    console.warn('Could not persist JWT secret to config.env:', e.message);
  }
  process.env.NEST_JWT_SECRET = secret;
  console.log('Generated and persisted NEST_JWT_SECRET');
  return secret;
}

// ── Cookie helper ───────────────────────────────────────

function setTokenCookie(req, res, token) {
  const host = req.headers.host?.split(':')[0] || '';
  const secure = !['localhost', '127.0.0.1'].includes(host);
  const parts = [
    `nest_token=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=604800',
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// ── User storage ────────────────────────────────────────

async function loadUsers() {
  try {
    if (existsSync(USERS_FILE)) {
      return JSON.parse(await readFile(USERS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

async function saveUsers(users) {
  await writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// ── Token storage ───────────────────────────────────────

export async function loadTokens() {
  try {
    if (existsSync(TOKENS_FILE)) {
      return JSON.parse(await readFile(TOKENS_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

export async function saveTokens(tokens) {
  await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2), 'utf-8');
}

// ── Bootstrap ───────────────────────────────────────────

async function ensureAdminExists() {
  const users = await loadUsers();
  if (users.some((u) => u.role === 'admin')) return;

  // Use NEST_ADMIN_PASSWORD for initial admin creation only
  const adminPassword = process.env.NEST_ADMIN_PASSWORD;
  if (!adminPassword) return;

  users.push({
    id: 'admin',
    name: 'Admin',
    role: 'admin',
    passwordHash: hashPassword(adminPassword),
    createdAt: Date.now(),
  });
  await saveUsers(users);
  console.log('Created admin user from NEST_ADMIN_PASSWORD');
}

// ── Routes ──────────────────────────────────────────────

export function authRoutes(router, jwt) {
  ensureAdminExists();

  // Direct login fallback (inline HTML)
  router.get('/direct-login', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nest Direct Login</title>
<style>
:root{color-scheme:light;--bg:#171c2b;--card:#fff;--ink:#161a28;--muted:#6b7280;--line:#d7dce5;--accent:#1a1a2e;--error:#b91c1c;--ok:#166534}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#27324a 0%,var(--bg) 55%);font:16px/1.45 system-ui,sans-serif;color:var(--ink);padding:24px}
.card{width:100%;max-width:440px;background:var(--card);border-radius:18px;padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.35)}
h1{margin:0 0 6px;font-size:32px;text-align:center}p{margin:0 0 18px;color:var(--muted);text-align:center}
input{width:100%;padding:14px 16px;border:1px solid var(--line);border-radius:10px;font:inherit;margin-bottom:12px}
button{border:0;border-radius:10px;padding:12px 14px;font:inherit;cursor:pointer}
.primary{width:100%;background:var(--accent);color:#fff;font-weight:700;margin-top:4px}
.status{min-height:22px;margin:8px 0 0;font-size:14px;text-align:center}.error{color:var(--error)}.ok{color:var(--ok)}
</style></head><body><div class="card"><h1>Nest</h1><p>Direct login</p>
<input id="pw" type="password" placeholder="Admin password" autofocus>
<button class="primary" id="go">Sign in</button>
<div class="status" id="st"></div></div>
<script>
const pw=document.getElementById("pw"),st=document.getElementById("st"),go=document.getElementById("go");
go.onclick=async()=>{st.textContent="";try{const r=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({password:pw.value.trim()})});const d=await r.json();if(!r.ok)throw new Error(d.error);localStorage.setItem("nest_token",d.token);st.className="status ok";st.textContent="OK";location.href="/"}catch(e){st.className="status error";st.textContent=e.message}};
pw.onkeydown=e=>{if(e.key==="Enter")go.click()};
</script></body></html>`);
  });

  // Login — requires { name, password }
  router.post('/auth/login', async (req, res) => {
    const { password, name } = req.body || {};
    if (!name || !password) return sendError(res, 400, 'Name and password required');

    const users = await loadUsers();
    const user = users.find((u) => u.name.toLowerCase() === name.toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendError(res, 401, 'Invalid credentials');
    }

    // Migrate legacy SHA256 hash to scrypt
    if (needsMigration(user.passwordHash)) {
      user.passwordHash = hashPassword(password);
      await saveUsers(users);
    }

    const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, '7d');
    setTokenCookie(req, res, token);
    sendJson(res, { token, role: user.role, name: user.name });
  });

  // Verify current token
  router.get('/auth/me', (req, res) => {
    if (!req.user) return sendError(res, 401, 'Unauthorized');
    sendJson(res, { id: req.user.id, role: req.user.role, name: req.user.name });
  });

  // Create user (admin only)
  router.post('/auth/invite', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const { name, password } = req.body || {};
    if (!name || !password) return sendError(res, 400, 'name and password required');

    const users = await loadUsers();
    const id = `user-${randomBytes(4).toString('hex')}`;

    users.push({
      id,
      name,
      role: 'user',
      passwordHash: hashPassword(password),
      createdAt: Date.now(),
      createdBy: req.user.id,
    });
    await saveUsers(users);

    const inviteToken = jwt.sign({ inviteFor: id, name }, '7d');
    sendJson(res, { id, name, role: 'user', inviteToken });
  });

  // Accept invitation
  router.post('/auth/accept-invite', async (req, res) => {
    const { token, password } = req.body || {};
    if (!token || !password) return sendError(res, 400, 'token and password required');

    try {
      const decoded = jwt.verify(token);
      if (!decoded.inviteFor) return sendError(res, 400, 'Invalid invite token');

      const users = await loadUsers();
      const user = users.find((u) => u.id === decoded.inviteFor);
      if (!user) return sendError(res, 404, 'User not found');

      user.passwordHash = hashPassword(password);
      await saveUsers(users);

      const loginToken = jwt.sign({ id: user.id, role: user.role, name: user.name }, '7d');
      setTokenCookie(req, res, loginToken);
      sendJson(res, { token: loginToken, role: user.role, name: user.name });
    } catch {
      sendError(res, 400, 'Invalid or expired invite token');
    }
  });

  // List users (admin only)
  router.get('/auth/users', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = await loadUsers();
    sendJson(res, { users: users.map(({ passwordHash, ...rest }) => rest) });
  });

  // Delete user (admin only)
  router.delete('/auth/users/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (req.params.id === 'admin') return sendError(res, 400, 'Cannot delete admin');

    const users = await loadUsers();
    const idx = users.findIndex((u) => u.id === req.params.id);
    if (idx === -1) return sendError(res, 404, 'User not found');
    users.splice(idx, 1);
    await saveUsers(users);
    sendJson(res, { success: true });
  });

  // Create API token (admin only)
  router.post('/auth/tokens', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const { name } = req.body || {};
    if (!name) return sendError(res, 400, 'name required');

    const rawToken = `nest_${randomBytes(32).toString('hex')}`;
    const id = `tok-${randomBytes(4).toString('hex')}`;

    const tokens = await loadTokens();
    tokens.push({
      id,
      name,
      tokenHash: hashToken(rawToken),
      role: 'admin',
      createdAt: Date.now(),
    });
    await saveTokens(tokens);

    sendJson(res, { id, name, token: rawToken });
  });

  // List API tokens (admin only)
  router.get('/auth/tokens', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const tokens = await loadTokens();
    sendJson(res, { tokens: tokens.map(({ tokenHash, ...rest }) => rest) });
  });

  // Delete API token (admin only)
  router.delete('/auth/tokens/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const tokens = await loadTokens();
    const idx = tokens.findIndex((t) => t.id === req.params.id);
    if (idx === -1) return sendError(res, 404, 'Token not found');
    tokens.splice(idx, 1);
    await saveTokens(tokens);
    sendJson(res, { success: true });
  });
}
