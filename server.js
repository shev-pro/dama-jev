/**
 * Server locale: serve la pagina e fa da ponte verso TypeSafe.
 *
 * Il ponte non e un vezzo. api.typesafe.ai tiene un allowlist di origin lato
 * server e il preflight CORS di un browser viene rifiutato con
 * "Disallowed CORS origin" prima ancora dell'autenticazione, quindi la pagina
 * da sola non puo parlare con l'API. Questo processo fa da tramite e basta.
 *
 * La chiave API non viene mai letta, registrata o scritta: arriva
 * nell'header Authorization della richiesta del browser e viene ricopiata
 * tale e quale verso l'alto. Se un giorno TypeSafe mettesse in allowlist
 * l'origin, questo file diventerebbe superfluo.
 *
 *   node server.js     ->  http://localhost:5173
 *
 * Variabili d'ambiente: PORT, HOST, ALLOWED_HOSTS (elenco separato da virgole).
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);

// Fuori da un container si ascolta solo su loopback. Dentro serve 0.0.0.0,
// altrimenti la mappatura delle porte non arriva al processo: in quel caso e
// il binding della porta sull'host a limitare chi puo raggiungerci.
const HOST = process.env.HOST ?? '127.0.0.1';

// Il processo maneggia una chiave API altrui a ogni richiesta, quindi risponde
// solo a nomi host attesi. Aggiungerne va fatto apposta, non per sbaglio.
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
 * Accetta solo quello che puo arrivare davvero dalla pagina servita qui: un
 * Host atteso (contro il DNS rebinding) e nessun Origin di terzi.
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
        reject(new Error('richiesta troppo grande'));
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
    return sendJson(res, 401, { detail: { error_type: 'authentication_error', message: 'Chiave API mancante nella richiesta del browser.' } });
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 413, { detail: { error_type: 'invalid_request', message: 'Richiesta troppo grande.' } });
  }

  try {
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    // Status e corpo passano cosi come sono, errori compresi: il pannello
    // deve poter mostrare il messaggio vero di TypeSafe, non una parafrasi.
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

  // Si servono solo la pagina e i moduli in src/: niente altro esce da qui.
  if (relative !== 'index.html' && !relative.startsWith('src/')) {
    return sendJson(res, 404, { error: 'non trovato' });
  }

  const file = path.resolve(ROOT, relative);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
    return sendJson(res, 403, { error: 'percorso non consentito' });
  }

  const type = MIME[path.extname(file)];
  if (!type) return sendJson(res, 404, { error: 'non trovato' });

  try {
    const content = await readFile(file);
    // no-store, cosi Cmd+Shift+R ricarica davvero il gioco e non una copia.
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'non trovato' });
  }
}

const server = http.createServer(async (req, res) => {
  if (!isAllowedRequest(req)) return sendJson(res, 403, { error: 'host non consentito' });

  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  if (pathname === '/api/systemone') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'usa POST' });
    return proxyToTypeSafe(req, res);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'usa GET' });
  return serveStatic(pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Dama contro Jev  ->  http://localhost:${PORT}  (in ascolto su ${HOST}:${PORT})`);
  console.log('La chiave API la chiede la pagina e resta nel browser: qui passa e basta.');
});
