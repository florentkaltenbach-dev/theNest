// hub/src/appendageProxy.js
//
// Authenticated reverse proxies for installed appendages' `routes`, behind Nest
// login (like /claw, /hermes) — one per route, to 127.0.0.1:<port> (http/https).
// Exports: registerAppendageProxies, handleAppendageUpgrade, isAppendageProxyUrl.

import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as netConnect } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { sendError } from './server.js';
import { loadAppendages } from './appendages.js';

const UPSTREAM_HOST = '127.0.0.1';
const PUBLIC_ORIGIN = process.env.HUB_PUBLIC_ORIGIN || process.env.NEST_PUBLIC_ORIGIN || '';

// Computed once at registration; the upgrade + body-skip helpers reuse it so
// they don't re-read the filesystem per request. New appendage JSON needs a
// hub restart to register — consistent with HUB.md page loading.
let proxyRoutes = [];

/**
 * Flatten every appendage definition's `routes` into proxy targets. A route is
 * { path: "/portainer", port: 9443, tls?: true } → proxy /portainer →
 * https://127.0.0.1:9443. Trailing slash on the path is normalised off.
 * @returns {{ name: string, prefix: string, port: number, tls: boolean }[]}
 */
export function getAppendageRoutes() {
  const { definitions } = loadAppendages();
  const routes = [];
  for (const def of definitions) {
    for (const r of def.routes || []) {
      const prefix = r.path.replace(/\/+$/, '');
      // A root mount ("/") would shadow the entire Nest dashboard. Such an
      // appendage (e.g. a public website) belongs on its own domain via Caddy,
      // not as a hub subpath — skip it here rather than hijack "/".
      if (prefix === '') {
        console.warn(`Appendage "${def.name}" route "/" skipped: root mount would shadow the Nest UI; serve it on its own domain via Caddy.`);
        continue;
      }
      routes.push({ name: def.name, prefix, port: r.port, tls: !!r.tls });
    }
  }
  return routes;
}

/** True if `url` (path only) is served by an appendage proxy. */
export function isAppendageProxyUrl(url = '') {
  const path = url.split('?')[0];
  return proxyRoutes.some((t) => path === t.prefix || path.startsWith(`${t.prefix}/`));
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

/** Build the per-route HTTP handler. */
function makeHttpHandler(target) {
  return function proxyAppendageHttp(req, res) {
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
  };
}

/** Register an auth-gated proxy for every appendage route on the Hub router. */
export function registerAppendageProxies(router) {
  proxyRoutes = getAppendageRoutes();
  for (const target of proxyRoutes) {
    const handler = makeHttpHandler(target);
    router.all(target.prefix, handler, 'appendageProxy');
    router.all(`${target.prefix}/*`, handler, 'appendageProxy');
  }
  if (proxyRoutes.length) {
    console.log(`Registered ${proxyRoutes.length} appendage proxy route(s): ${proxyRoutes.map((t) => t.prefix).join(', ')}`);
  }
  return proxyRoutes;
}

/** Handle WebSocket upgrades for any appendage route with Nest auth. */
export async function handleAppendageUpgrade(req, socket, head, authenticate) {
  const path = req.url?.split('?')[0] || '';
  const target = proxyRoutes.find((t) => path === t.prefix || path.startsWith(`${t.prefix}/`));
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
