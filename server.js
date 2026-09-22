/**
 * Local server: serves the page and bridges to TypeSafe.
 *
 * The bridge is not a flourish. api.typesafe.ai enforces a server-side origin
 * allowlist, and a browser's CORS preflight is refused with
 * "Disallowed CORS origin" before authentication even happens, so the page
 * cannot talk to the API on its own. This process is the go-between, nothing
 * more.
 *
 * The API key is never read, logged or written: it arrives in the browser's
 * Authorization header and is copied upstream verbatim. If TypeSafe ever
 * allowlisted the origin, this file would become unnecessary.
 *
 *   node server.js     ->  http://localhost:5173
 *
 * Environment: PORT, HOST, ALLOWED_HOSTS (comma-separated).
 *
 * Note: the messages that can surface in the game's panel are Italian, because
 * the game is. The rest is English.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);

// Outside a container we listen on loopback only. Inside one we need 0.0.0.0,
// or the port mapping never reaches the process; there it is the host-side port
// binding that limits who can get to us.
const HOST = process.env.HOST ?? '127.0.0.1';

// The process handles someone else's API key on every request, so it answers
// only to expected host names. Adding one has to be deliberate.
const ALLOWED_HOSTS = new Set(
  (process.env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]')
    .split(',').map((h) => h.trim()).filter(Boolean),
);

const UPSTREAM = 'https://api.typesafe.ai/v1/systemone';
const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 1_000_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const sendJson = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
};

/**
 * Accepts only what could genuinely come from the page served here: an expected
 * Host (against DNS rebinding) and no third-party Origin.
 */
function isAllowedRequest(req) {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (!ALLOWED_HOSTS.has(host)) return false;

  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!ALLOWED_HOSTS.has(new URL(origin).hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function proxyToTypeSafe(req, res) {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return sendJson(res, 401, {
      detail: { error_type: 'authentication_error', message: 'Chiave API mancante nella richiesta del browser.' },
    });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 413, {
      detail: { error_type: 'invalid_request', message: 'Richiesta troppo grande.' },
    });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    // Status and body pass through untouched, errors included: the panel has to
    // be able to show TypeSafe's real message, not a paraphrase of it.
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(text);
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    sendJson(res, 504, {
      detail: {
        error_type: timedOut ? 'timeout' : 'network_error',
        message: timedOut
          ? `TypeSafe non ha risposto entro ${UPSTREAM_TIMEOUT_MS / 1000} secondi.`
          : `Non riesco a raggiungere ${UPSTREAM}: ${error?.message ?? 'errore di rete'}.`,
      },
    });
  }
}

async function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);

  // Only the page and the modules under src/ are served: nothing else leaves here.
  if (relative !== 'index.html' && !relative.startsWith('src/')) {
    return sendJson(res, 404, { error: 'not found' });
  }

  const file = path.resolve(ROOT, relative);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    return sendJson(res, 403, { error: 'path not allowed' });
  }

  const type = MIME[path.extname(file)];
  if (!type) return sendJson(res, 404, { error: 'not found' });

  try {
    const content = await readFile(file);
    // no-store, so that Cmd+Shift+R really reloads the game and not a copy of it.
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

const server = http.createServer(async (req, res) => {
  if (!isAllowedRequest(req)) return sendJson(res, 403, { error: 'host not allowed' });

  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  if (pathname === '/api/systemone') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'use POST' });
    return proxyToTypeSafe(req, res);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'use GET' });
  return serveStatic(pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Dama x Jev  ->  http://localhost:${PORT}  (listening on ${HOST}:${PORT})`);
  console.log('The API key is asked for by the page and stays in the browser: here it only passes through.');
});
