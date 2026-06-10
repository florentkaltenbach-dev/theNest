// hub/src/appendageProxy.js
//
// Authenticated reverse proxies for installed appendages' `routes`, behind Nest
// login (like /claw, /hermes) — resolved per-request from a live cache that a
// directory watcher refreshes, so adding an appendage needs no hub restart.
// Exports: watchAppendages, refreshAppendageRoutes, handleAppendageHttp, handleAppendageUpgrade, isAppendageProxyUrl, getAppendageRoutes.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { watch } from 'node:fs';
import { sendError } from './server.js';
import { loadAppendages, APPENDAGES_DIR } from './appendages.js';

const UPSTREAM_HOST = '127.0.0.1';
const PUBLIC_ORIGIN = process.env.HUB_PUBLIC_ORIGIN || process.env.NEST_PUBLIC_ORIGIN || '';

// Live cache of proxy targets, kept fresh by watchAppendages(). The request
// dispatcher and the WS/body-skip helpers all read this, so a definition added
// to APPENDAGES_DIR becomes reachable without a restart.
let proxyRoutes = [];

/**
 * Read every appendage definition's `routes` into proxy targets. A route is
 * { path: "/portainer", port: 9443, tls?: true } → /portainer →
 * https://127.0.0.1:9443. Root ("/") mounts are skipped: they'd shadow the
 * Nest dashboard — such an appendage belongs on its own domain via Caddy.
 * @returns {{ name: string, prefix: string, port: number, tls: boolean }[]}
 */
export function getAppendageRoutes() {
  const { definitions } = loadAppendages();
  const routes = [];
  for (const def of definitions) {
    for (const r of def.routes || []) {
      const prefix = r.path.replace(/\/+$/, '');
      if (prefix === '') {
        console.warn(`Appendage "${def.name}" route "/" skipped: root mount would shadow the Nest UI; serve it on its own domain via Caddy.`);
        continue;
      }
      routes.push({ name: def.name, prefix, port: r.port, tls: !!r.tls });
    }
  }
  return routes;
}

/** Rebuild the proxy-route cache from disk. Logs only when the set changes. */
export function refreshAppendageRoutes() {
  const next = getAppendageRoutes();
  const before = proxyRoutes.map((t) => t.prefix).sort().join(',');
  const after = next.map((t) => t.prefix).sort().join(',');
  proxyRoutes = next;
  if (before !== after) {
    console.log(`Appendage proxy routes: ${next.length ? next.map((t) => t.prefix).join(', ') : '(none)'}`);
  }
  return proxyRoutes;
}

/**
 * Prime the cache and watch APPENDAGES_DIR so added/changed/removed definitions
 * take effect live. fs.watch can fire bursts, so refreshes are debounced.
 */
export function watchAppendages() {
  refreshAppendageRoutes();
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; refreshAppendageRoutes(); }, 300);
    timer.unref?.();
  };
  try {
    const w = watch(APPENDAGES_DIR, { persistent: false }, schedule);
    w.on('error', (err) => console.warn('Appendage dir watch error:', err.message));
  } catch (err) {
    console.warn(`Could not watch ${APPENDAGES_DIR}:`, err.message);
  }
}

function matchTarget(url = '') {
  const path = url.split('?')[0];
  return proxyRoutes.find((t) => path === t.prefix || path.startsWith(`${t.prefix}/`)) || null;
}

/** True if `url` (path only) is served by an appendage proxy. */
export function isAppendageProxyUrl(url = '') {
  return matchTarget(url) !== null;
}

function upstreamPath(url, prefix) {
  const suffix = url.slice(prefix.length) || '/';
  return suffix.startsWith('/') ? suffix : `/${suffix}`;
}

function copyHeaders(req, target) {
  const headers = { ...req.headers };
  headers.host = `${UPSTREAM_HOST}:${target.port}`;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https';
  headers['x-forwarded-prefix'] = target.prefix;
  return headers;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (PUBLIC_ORIGIN) return origin === PUBLIC_ORIGIN;
  const host = req.headers.host;
  if (!host) return false;
  return new Set([`https://${host}`, `http://${host}`]).has(origin);
}

function rejectUpgrade(socket, status, message) {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}

/**
 * Dispatch an HTTP request to its appendage upstream. Call only when
 * isAppendageProxyUrl(req.url) is true (the caller checks after a router miss).
 */
export function handleAppendageHttp(req, res) {
  const target = matchTarget(req.url);
  if (!target) return sendError(res, 404, 'Not found');

  if (!req.user) {
    const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
    if (wantsHtml) {
      res.writeHead(302, { Location: `/login?next=${encodeURIComponent(req.url || `${target.prefix}/`)}` });
      return res.end();
    }
    return sendError(res, 401, 'Unauthorized');
  }
  // Redirect the bare prefix to prefix/ so the upstream's relative asset URLs
  // resolve under our path. Skip for WS upgrades (handled separately).
  if (req.url?.split('?')[0] === target.prefix
      && !req.headers.connection?.toLowerCase().includes('upgrade')) {
    res.writeHead(308, { Location: `${target.prefix}/` });
    return res.end();
  }

  const requestFn = target.tls ? httpsRequest : httpRequest;
  const upstreamReq = requestFn({
    host: UPSTREAM_HOST,
    port: target.port,
    method: req.method,
    path: upstreamPath(req.url, target.prefix),
    headers: copyHeaders(req, target),
    ...(target.tls ? { rejectUnauthorized: false } : {}),
  }, (upstreamRes) => {
    const headers = { ...upstreamRes.headers };
    // Re-prefix absolute redirect targets so the browser stays under our path.
    if (typeof headers.location === 'string' && headers.location.startsWith('/')) {
      headers.location = `${target.prefix}${headers.location}`;
    }
    res.writeHead(upstreamRes.statusCode || 502, headers);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    console.error(`Appendage proxy error (${target.name}):`, err.message);
    if (!res.writableEnded) sendError(res, 502, `${target.name} upstream unavailable`);
  });

  req.pipe(upstreamReq);
}

/** Handle WebSocket upgrades for any appendage route with Nest auth. */
export async function handleAppendageUpgrade(req, socket, head, authenticate) {
  const target = matchTarget(req.url);
  if (!target) return false;

  if (!sameOrigin(req)) {
    rejectUpgrade(socket, 403, 'Forbidden');
    return true;
  }
  const ok = await authenticate(req);
  if (!ok) {
    rejectUpgrade(socket, 401, 'Unauthorized');
    return true;
  }

  const upstream = target.tls
    ? tlsConnect({ host: UPSTREAM_HOST, port: target.port, rejectUnauthorized: false })
    : netConnect(target.port, UPSTREAM_HOST);
  upstream.on(target.tls ? 'secureConnect' : 'connect', () => {
    const headers = copyHeaders(req, target);
    const lines = [
      `${req.method} ${upstreamPath(req.url, target.prefix)} HTTP/${req.httpVersion}`,
      ...Object.entries(headers)
        .filter(([, value]) => value !== undefined)
        .flatMap(([key, value]) => Array.isArray(value)
          ? value.map((v) => `${key}: ${v}`)
          : [`${key}: ${value}`]),
      '',
      '',
    ];
    upstream.write(lines.join('\r\n'));
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });

  upstream.on('error', (err) => {
    console.error(`Appendage WS proxy error (${target.name}):`, err.message);
    rejectUpgrade(socket, 502, 'Bad Gateway');
  });
  socket.on('error', () => upstream.destroy());
  return true;
}
