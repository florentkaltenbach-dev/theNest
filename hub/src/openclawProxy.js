// hub/src/openclawProxy.js
//
// Authenticated reverse proxy for the OpenClaw WebChat surface under /claw.
// Exports: registerOpenClawProxy, handleOpenClawUpgrade

import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { sendError } from './server.js';

const UPSTREAM_HOST = process.env.HUB_OPENCLAW_UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_PORT = parseInt(process.env.HUB_OPENCLAW_UPSTREAM_PORT || '18789', 10);
const UPSTREAM_PASSWORD = process.env.HUB_OPENCLAW_UPSTREAM_PASSWORD || '';
const PUBLIC_ORIGIN = process.env.HUB_PUBLIC_ORIGIN || process.env.NEST_PUBLIC_ORIGIN || '';

function upstreamPath(url = '/') {
  const suffix = url.slice('/claw'.length) || '/';
  return suffix.startsWith('/') ? suffix : `/${suffix}`;
}

function redirectToClawSlash(req, res) {
  if (req.url?.split('?')[0] !== '/claw') return false;
  if (req.headers.connection?.toLowerCase().includes('upgrade')) return false;
  res.writeHead(308, { Location: '/claw/' });
  res.end();
  return true;
}

function copyHeaders(req) {
  const headers = { ...req.headers };
  headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https';
  headers['x-forwarded-prefix'] = '/claw';
  if (UPSTREAM_PASSWORD) headers.authorization = `Bearer ${UPSTREAM_PASSWORD}`;
  return headers;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;

  if (PUBLIC_ORIGIN) return origin === PUBLIC_ORIGIN;

  const host = req.headers.host;
  if (!host) return false;
  const expected = new Set([
    `https://${host}`,
    `http://${host}`,
  ]);
  return expected.has(origin);
}

function rejectUpgrade(socket, status, message) {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}

/** Register /claw routes on the Hub router. */
export function registerOpenClawProxy(router) {
  router.all('/claw', proxyOpenClawHttp, 'openclawProxy');
  router.all('/claw/*', proxyOpenClawHttp, 'openclawProxy');
}

async function proxyOpenClawHttp(req, res) {
  if (!req.user) {
    const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
    if (wantsHtml) {
      res.writeHead(302, { Location: `/login?next=${encodeURIComponent(req.url || '/claw/')}` });
      res.end();
      return;
    }
    return sendError(res, 401, 'Unauthorized');
  }
  if (redirectToClawSlash(req, res)) return;

  const upstreamReq = httpRequest({
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    method: req.method,
    path: upstreamPath(req.url),
    headers: copyHeaders(req),
  }, (upstreamRes) => {
    const headers = { ...upstreamRes.headers };
    if (typeof headers.location === 'string' && headers.location.startsWith('/')) {
      headers.location = `/claw${headers.location}`;
    }
    res.writeHead(upstreamRes.statusCode || 502, headers);
    upstreamRes.pipe(res);
  });

  upstreamReq.on('error', (err) => {
    console.error('OpenClaw HTTP proxy error:', err.message);
    if (!res.writableEnded) sendError(res, 502, 'OpenClaw upstream unavailable');
  });

  req.pipe(upstreamReq);
}

/** Handle /claw WebSocket upgrades with Nest auth and same-origin checks. */
export async function handleOpenClawUpgrade(req, socket, head, authenticate) {
  if (!req.url?.split('?')[0].startsWith('/claw')) return false;

  if (!sameOrigin(req)) {
    rejectUpgrade(socket, 403, 'Forbidden');
    return true;
  }

  const ok = await authenticate(req);
  if (!ok) {
    rejectUpgrade(socket, 401, 'Unauthorized');
    return true;
  }

  const upstream = netConnect(UPSTREAM_PORT, UPSTREAM_HOST);
  upstream.on('connect', () => {
    const headers = copyHeaders(req);
    const lines = [
      `${req.method} ${upstreamPath(req.url)} HTTP/${req.httpVersion}`,
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
    console.error('OpenClaw WS proxy error:', err.message);
    rejectUpgrade(socket, 502, 'Bad Gateway');
  });

  socket.on('error', () => upstream.destroy());
  return true;
}
