/**
 * Local server: serves the page, owns the games, and talks to TypeSafe.
 *
 * It accepts commands - start a game, play this path, let Jev move - and never
 * a ready-made request. That is deliberate. The browser cannot ask this process
 * to forward an arbitrary payload to TypeSafe, so a key configured here cannot
 * be turned into a free pass to the API; and since the position lives here, a
 * client cannot play a move that is not legal.
 *
 *   node server.js     ->  http://localhost:5173
 *
 * Environment:
 *   PORT              default 5173
 *   HOST              default 127.0.0.1 (0.0.0.0 inside the container)
 *   ALLOWED_HOSTS     comma-separated, default localhost,127.0.0.1,[::1]
 *   TYPESAFE_API_KEY  when set, the page never asks for a key and refuses to
 *                     accept one; every game plays on this key
 *   LEADERBOARD_FILE  default data/leaderboard.json
 *
 * Note: the messages that can surface in the game's panel are Italian, because
 * the game is. The rest is English.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { GameStore, GameError } from './server/games.js';
import { JevError } from './server/jev.js';
import { variantSummaries, DEFAULT_VARIANT } from './server/variants.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);

// Outside a container we listen on loopback only. Inside one we need 0.0.0.0,
// or the port mapping never reaches the process; there it is the host-side port
// binding that limits who can get to us.
const HOST = process.env.HOST ?? '127.0.0.1';

// The process may be holding an API key, so it answers only to expected host
// names. Adding one has to be deliberate.
const ALLOWED_HOSTS = new Set(
  (process.env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]')
    .split(',').map((host) => host.trim()).filter(Boolean),
);

const MAX_BODY_BYTES = 200_000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const store = new GameStore({
  serverApiKey: process.env.TYPESAFE_API_KEY?.trim() || null,
  leaderboardFile: process.env.LEADERBOARD_FILE ?? path.join(ROOT, 'data', 'leaderboard.json'),
});

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
        reject(new GameError('Richiesta troppo grande.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new GameError('Corpo della richiesta non e JSON valido.'));
      }
    });
    req.on('error', reject);
  });
}

async function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);

  // Only the page and the client modules are served. Everything under server/
  // stays here, which is the point of the split.
  if (relative !== 'index.html' && !relative.startsWith('src/')) {
    return sendJson(res, 404, { error: 'not found' });
  }

  const file = path.resolve(ROOT, relative);
  if (!file.startsWith(ROOT + path.sep)) return sendJson(res, 403, { error: 'path not allowed' });

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

async function handleApi(req, res, pathname, url) {
  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, {
      // The page uses this to decide whether to ask for a key at all.
      needsApiKey: store.needsClientKey,
      variants: variantSummaries(),
      defaultVariant: DEFAULT_VARIANT,
    });
  }

  if (req.method === 'GET' && pathname === '/api/leaderboard') {
    const variant = url.searchParams.get('variant') || null;
    const [standings, totals] = await Promise.all([
      store.leaderboard.standings(variant),
      store.leaderboard.totals(variant),
    ]);
    return sendJson(res, 200, { variant, standings, totals });
  }

  if (req.method === 'POST' && pathname === '/api/games') {
    const body = await readBody(req);
    const game = store.create({
      variant: body.variant,
      playerName: body.playerName,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : null,
    });
    return sendJson(res, 201, { state: store.view(game) });
  }

  const match = pathname.match(/^\/api\/games\/([0-9a-f-]{36})\/(move|jev)$/);
  if (match && req.method === 'POST') {
    const [, id, action] = match;
    const game = store.get(id);
    const body = await readBody(req);

    if (action === 'move') {
      const move = await store.playHuman(game, body.path);
      return sendJson(res, 200, { move, state: store.view(game) });
    }

    const jev = await store.playJev(game, { useLocalEngine: body.local === true });
    return sendJson(res, 200, { jev, state: store.view(game) });
  }

  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  if (!isAllowedRequest(req)) return sendJson(res, 403, { error: 'host not allowed' });

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  if (pathname.startsWith('/api/')) {
    try {
      return await handleApi(req, res, pathname, url);
    } catch (error) {
      // Jev's own failures reach the panel verbatim: the player should read
      // TypeSafe's message, not a paraphrase of it.
      if (error instanceof JevError) {
        return sendJson(res, error.status && error.status >= 400 ? error.status : 502, {
          detail: { error_type: error.type, message: error.message },
        });
      }
      if (error instanceof GameError) {
        return sendJson(res, error.status, { detail: { error_type: 'game_error', message: error.message } });
      }
      console.error('errore non gestito:', error);
      return sendJson(res, 500, { detail: { error_type: 'internal_error', message: 'Errore interno del server.' } });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'use GET' });
  return serveStatic(pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Dama x Jev  ->  http://localhost:${PORT}  (listening on ${HOST}:${PORT})`);
  console.log(store.needsClientKey
    ? 'No TYPESAFE_API_KEY set: the page will ask each player for their own, and it stays in the browser.'
    : 'Using TYPESAFE_API_KEY from the environment: the page will not ask for a key, and will not accept one.');
});
