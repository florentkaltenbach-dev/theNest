// hub/src/server.js
//
// Router, JWT, CORS, static file serving, JSON helpers.
// Exports: createRouter, parseBody, sendJson, sendError, sendFile, signJwt, verifyJwt, corsHeaders, handleCors
// Depends: node:crypto, node:fs, node:path

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

// ── MIME types ──────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

// ── Router ──────────────────────────────────────────────

/** @returns {{ get, post, put, delete: Function, match: Function, routes: Array }} */
export function createRouter() {
  const routes = []; // { method, pattern, keys, regex, handler, source }

  function compile(pattern) {
    const keys = [];
    const regexStr = pattern
      .replace(/:([^/]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; })
      .replace(/\*/g, '(.*)');
    return { keys, regex: new RegExp(`^${regexStr}$`) };
  }

  function add(method, pattern, handler, source) {
    const { keys, regex } = compile(pattern);
    routes.push({ method, pattern, keys, regex, handler, source });
  }

  function match(method, url) {
    const [path] = url.split('?');
    for (const route of routes) {
      if (route.method !== method && route.method !== 'ALL') continue;
      const m = path.match(route.regex);
      if (m) {
        const params = {};
        route.keys.forEach((key, i) => { params[key] = m[i + 1]; });
        // Wildcard capture
        if (route.pattern.includes('*') && m[route.keys.length + 1] !== undefined) {
          params['*'] = m[route.keys.length + 1];
        }
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  function withPrefix(prefix) {
    return {
      get:    (p, h, s) => add('GET', prefix + p, h, s),
      post:   (p, h, s) => add('POST', prefix + p, h, s),
      put:    (p, h, s) => add('PUT', prefix + p, h, s),
      delete: (p, h, s) => add('DELETE', prefix + p, h, s),
    };
  }

  return {
    get:    (p, h, s) => add('GET', p, h, s),
    post:   (p, h, s) => add('POST', p, h, s),
    put:    (p, h, s) => add('PUT', p, h, s),
    delete: (p, h, s) => add('DELETE', p, h, s),
    match,
    routes,
    withPrefix,
  };
}

// ── Body parsing ────────────────────────────────────────

/** @param {import('node:http').IncomingMessage} req */
export function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ── Auth helpers ────────────────────────────────────────

/** Check req.user is admin. Sends 401/403 and returns false if not. */
export function requireAdmin(req, res) {
  if (!req.user) { sendError(res, 401, 'Unauthorized'); return false; }
  if (req.user.role !== 'admin') { sendError(res, 403, 'Admin only'); return false; }
  return true;
}

// ── Response helpers ────────────────────────────────────

/** @param {import('node:http').ServerResponse} res */
export function sendJson(res, data, status = 200) {
  if (res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

/** @param {import('node:http').ServerResponse} res */
export function sendError(res, status, message) {
  sendJson(res, { error: message }, status);
}

/** @param {import('node:http').ServerResponse} res */
export function sendFile(res, filePath) {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) return sendError(res, 404, 'Not found');
  const ext = extname(resolved);
  const contentType = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType, ...SECURITY_HEADERS });
  createReadStream(resolved).pipe(res);
}

// ── JWT (HS256) ─────────────────────────────────────────

function base64url(str) {
  return Buffer.from(str).toString('base64url');
}

function base64urlDecode(str) {
  return Buffer.from(str, 'base64url').toString();
}

const JWT_HEADER = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/**
 * @param {Object} payload
 * @param {string} secret
 * @param {string} expiresIn - e.g. "7d", "1h"
 * @returns {string}
 */
export function signJwt(payload, secret, expiresIn = '7d') {
  const ttlMs = parseDuration(expiresIn);
  const claims = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor((Date.now() + ttlMs) / 1000) };
  const encodedPayload = base64url(JSON.stringify(claims));
  const signature = createHmac('sha256', secret).update(`${JWT_HEADER}.${encodedPayload}`).digest('base64url');
  return `${JWT_HEADER}.${encodedPayload}.${signature}`;
}

/**
 * @param {string} token
 * @param {string} secret
 * @returns {Object} decoded payload
 */
export function verifyJwt(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');

  const [header, payload, signature] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');

  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error('Invalid signature');
  }

  const claims = JSON.parse(base64urlDecode(payload));
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('Token expired');
  }
  return claims;
}

function parseDuration(str) {
  const m = str.match(/^(\d+)(s|m|h|d)$/);
  if (!m) return 7 * 24 * 3600 * 1000; // default 7d
  const n = parseInt(m[1]);
  const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * (unit[m[2]] || 86400000);
}

// ── CORS ────────────────────────────────────────────────

/** @param {import('node:http').ServerResponse} res */
export function corsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Handle CORS preflight. Returns true if request was handled (OPTIONS).
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @returns {boolean}
 */
export function handleCors(req, res) {
  corsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

// ── Query string parsing ────────────────────────────────

/** @param {string} url */
export function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  const params = {};
  const pairs = url.slice(idx + 1).split('&');
  for (const pair of pairs) {
    const [key, val] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = val ? decodeURIComponent(val) : '';
  }
  return params;
}
