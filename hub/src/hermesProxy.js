// hub/src/hermesProxy.js
//
// Authenticated reverse proxy for the Hermes dashboard under /hermes.
// Exports: registerHermesProxy, handleHermesUpgrade, isHermesProxyUrl

import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { sendError } from './server.js';

const UPSTREAM_HOST = process.env.HUB_HERMES_UPSTREAM_HOST || '127.0.0.1';
const UPSTREAM_PORT = parseInt(process.env.HUB_HERMES_UPSTREAM_PORT || '9119', 10);
const PUBLIC_ORIGIN = process.env.HUB_PUBLIC_ORIGIN || process.env.NEST_PUBLIC_ORIGIN || '';

export function isHermesProxyUrl(url = '') {
  const path = url.split('?')[0];
  return path === '/hermes' || path.startsWith('/hermes/');
}

function upstreamPath(url = '/') {
  const suffix = url.slice('/hermes'.length) || '/';
  return suffix.startsWith('/') ? suffix : `/${suffix}`;
}

function redirectToHermesSlash(req, res) {
  if (req.url?.split('?')[0] !== '/hermes') return false;
  if (req.headers.connection?.toLowerCase().includes('upgrade')) return false;
  res.writeHead(308, { Location: '/hermes/' });
  res.end();
  return true;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;

  if (PUBLIC_ORIGIN) return origin === PUBLIC_ORIGIN;

  const host = req.headers.host;
  if (!host) return false;
  return new Set([`https://${host}`, `http://${host}`]).has(origin);
}

function copyHeaders(req) {
  const headers = { ...req.headers };
  headers.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] || 'https';
  headers['x-forwarded-prefix'] = '/hermes';
  return headers;
}

function rewriteHtml(body) {
  const shim = `<script>
(() => {
  const prefix = '/hermes';
  window.__HERMES_BASE_PATH__ = prefix;
  const rewritePath = (value) => typeof value === 'string' && (value.startsWith('/api/') || value.startsWith('/dashboard-plugins/'))
    ? prefix + value
    : value;
  const rewriteWs = (value) => {
    if (typeof value !== 'string') return value;
    try {
      const parsed = new URL(value, window.location.href);
      if (parsed.host === window.location.host && parsed.pathname.startsWith('/api/')) {
        parsed.pathname = prefix + parsed.pathname;
        return parsed.toString();
      }
    } catch {}
    return value;
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string') return realFetch(rewritePath(input), init);
    if (input instanceof Request && input.url.startsWith(window.location.origin + '/api/')) {
      input = new Request(prefix + new URL(input.url).pathname + new URL(input.url).search, input);
    }
    return realFetch(input, init);
  };
  const RealWebSocket = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    return protocols === undefined ? new RealWebSocket(rewriteWs(url)) : new RealWebSocket(rewriteWs(url), protocols);
  };
  window.WebSocket.prototype = RealWebSocket.prototype;
})();
</script>`;
  return body
    .replaceAll('href="/', 'href="/hermes/')
    .replaceAll('src="/', 'src="/hermes/')
    .replace('</head>', `${shim}</head>`);
}

function rewriteLocation(headers) {
  if (typeof headers.location === 'string' && headers.location.startsWith('/')) {
    headers.location = `/hermes${headers.location}`;
  }
}

/** Register /hermes routes on the Hub router. */
export function registerHermesProxy(router) {
  router.all('/hermes', proxyHermesHttp, 'hermesProxy');
  router.all('/hermes/*', proxyHermesHttp, 'hermesProxy');
}

async function proxyHermesHttp(req, res) {
  if (!req.user) {
    const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
    if (wantsHtml) {
      res.writeHead(302, { Location: `/login?next=${encodeURIComponent(req.url || '/hermes/')}` });
      res.end();
      return;
    }
    return sendError(res, 401, 'Unauthorized');
  }
  if (redirectToHermesSlash(req, res)) return;

  const upstreamReq = httpRequest({
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    method: req.method,
    path: upstreamPath(req.url),
    headers: copyHeaders(req),
  }, (upstreamRes) => {
    const headers = { ...upstreamRes.headers };
    rewriteLocation(headers);
    const contentType = String(headers['content-type'] || '');
    if (!contentType.includes('text/html')) {
      res.writeHead(upstreamRes.statusCode || 502, headers);
      upstreamRes.pipe(res);
      return;
    }

    const chunks = [];
    upstreamRes.on('data', (chunk) => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const html = rewriteHtml(Buffer.concat(chunks).toString('utf8'));
      delete headers['content-length'];
      res.writeHead(upstreamRes.statusCode || 502, headers);
      res.end(html);
    });
  });

  upstreamReq.on('error', (err) => {
    console.error('Hermes HTTP proxy error:', err.message);
    if (!res.writableEnded) sendError(res, 502, 'Hermes upstream unavailable');
  });

  req.pipe(upstreamReq);
}

function rejectUpgrade(socket, status, message) {
  try {
    socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } finally {
    socket.destroy();
  }
}

/** Handle /hermes WebSocket upgrades with Nest auth and same-origin checks. */
export async function handleHermesUpgrade(req, socket, head, authenticate) {
  if (!isHermesProxyUrl(req.url || '')) return false;

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
    console.error('Hermes WS proxy error:', err.message);
    rejectUpgrade(socket, 502, 'Bad Gateway');
  });

  socket.on('error', () => upstream.destroy());
  return true;
}
