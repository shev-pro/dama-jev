/**
 * The thin client for the game API.
 *
 * Everything this page can ask the server to do is in this file, and it is four
 * commands. The page never builds a request for TypeSafe, never decides what is
 * legal, and never sees anybody's API key except the one the player just typed.
 */

export class ApiError extends Error {
  constructor(message, { status = 0, type = 'error' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
  }
}

async function call(method, path, body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    throw new ApiError(`Non riesco a raggiungere il server locale: ${error?.message ?? error}`, { type: 'network_error' });
  }

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    // The server passes TypeSafe's own message through, so this is the real one.
    throw new ApiError(
      payload?.detail?.message ?? payload?.error ?? `Il server ha risposto ${response.status}.`,
      { status: response.status, type: payload?.detail?.error_type ?? 'http_error' },
    );
  }
  if (!payload) throw new ApiError('Il server ha risposto con qualcosa che non e JSON.', { status: response.status });

  return payload;
}

export const getConfig = () => call('GET', '/api/config');

export const createGame = ({ variant, playerName, apiKey }) =>
  call('POST', '/api/games', { variant, playerName, ...(apiKey ? { apiKey } : {}) });

/** The only thing a move is, over the wire: the squares it travels through. */
export const sendMove = (gameId, path) => call('POST', `/api/games/${gameId}/move`, { path });

export const askJevToMove = (gameId, { local = false } = {}) =>
  call('POST', `/api/games/${gameId}/jev`, local ? { local: true } : {});

export const getLeaderboard = (variant) =>
  call('GET', `/api/leaderboard?variant=${encodeURIComponent(variant)}`);
