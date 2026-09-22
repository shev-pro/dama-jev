/**
 * The games in progress, and the authority over them.
 *
 * The browser never decides anything here. It sends a command - "start a game",
 * "play this path", "let Jev move" - and this module checks it against the
 * position it holds. A move that is not in the legal list is refused, whatever
 * the client believes. Without that, the leaderboard would be decoration.
 *
 * Sessions live in memory: restarting the server ends the games in progress.
 * Finished games are already in the leaderboard by then.
 */

import { randomUUID } from 'node:crypto';

import { initialPosition, legalMoves, applyMove, gameStatus } from './rules.js';
import { annotateMoves, heuristicBest } from './analysis.js';
import { buildRequest, askJev, interpret, JevError } from './jev.js';
import { moveNotation, piecesOf } from './notation.js';
import { variantOf, isKnownVariant, DEFAULT_VARIANT } from './variants.js';
import { Leaderboard } from './leaderboard.js';

export const HUMAN = 'white';
export const JEV = 'black';

/** A game left untouched this long is swept away. */
const IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;

/**
 * A ceiling on how many times one game may call TypeSafe. A draughts game takes
 * a few dozen moves; anything far past that is a loop or someone leaning on a
 * shared key, and either way it should stop.
 */
const MAX_JEV_REQUESTS_PER_GAME = 400;

export class GameError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'GameError';
    this.status = status;
  }
}

export class GameStore {
  /**
   * @param serverApiKey the key from the environment, or null when each player
   *   brings their own. When it is set, a client-supplied key is refused: the
   *   point of configuring one is that nobody has to hand a key to the page.
   */
  constructor({ serverApiKey = null, leaderboardFile = 'data/leaderboard.json' } = {}) {
    this.serverApiKey = serverApiKey;
    this.leaderboard = new Leaderboard(leaderboardFile);
    this.games = new Map();

    this.sweeper = setInterval(() => this.sweep(), SWEEP_EVERY_MS);
    this.sweeper.unref?.();
  }

  get needsClientKey() {
    return !this.serverApiKey;
  }

  sweep(now = Date.now()) {
    for (const [id, game] of this.games) {
      if (now - game.touchedAt > IDLE_TIMEOUT_MS) this.games.delete(id);
    }
  }

  create({ variant = DEFAULT_VARIANT, playerName, apiKey = null }) {
    if (!isKnownVariant(variant)) throw new GameError(`Variante sconosciuta: ${variant}`);

    if (this.serverApiKey && apiKey) {
      throw new GameError('Questo server usa la propria chiave API: non se ne accettano altre.', 403);
    }
    if (this.needsClientKey && !apiKey) {
      throw new GameError('Serve una chiave API per far giocare Jev.', 401);
    }

    const game = {
      id: randomUUID(),
      variant,
      playerName: Leaderboard.cleanName(playerName),
      // Held only for the lifetime of the game, in memory, never written down.
      apiKey: this.serverApiKey ?? apiKey,
      state: initialPosition(variant),
      history: [],
      jevRequests: 0,
      jevTokens: 0,
      recorded: false,
      touchedAt: Date.now(),
    };

    this.games.set(game.id, game);
    return game;
  }

  get(id) {
    const game = this.games.get(id);
    if (!game) throw new GameError('Partita sconosciuta o scaduta.', 404);
    game.touchedAt = Date.now();
    return game;
  }

  /** What the client is allowed to see. The API key is not part of it. */
  view(game) {
    const status = gameStatus(game.state);
    const variant = variantOf(game.variant);
    const yourTurn = status === 'playing' && game.state.turn === HUMAN;

    return {
      id: game.id,
      playerName: game.playerName,
      variant: {
        id: variant.id, name: variant.name, shortName: variant.shortName,
        size: variant.size, boardParity: variant.boardParity, description: variant.description,
      },
      board: game.state.board,
      turn: game.state.turn,
      status,
      humanColor: HUMAN,
      jevColor: JEV,
      // The legal moves are data from the server, not something the page works
      // out. When it is not the human's turn there is nothing to offer.
      legalMoves: yourTurn ? legalMoves(game.state) : [],
      material: { human: piecesOf(game.state, HUMAN), jev: piecesOf(game.state, JEV) },
      history: game.history,
      usage: { requests: game.jevRequests, tokens: game.jevTokens },
    };
  }

  /** Applies a human move given as the exact sequence of squares it travels. */
  async playHuman(game, path) {
    const status = gameStatus(game.state);
    if (status !== 'playing') throw new GameError('La partita e finita.', 409);
    if (game.state.turn !== HUMAN) throw new GameError('Non e il tuo turno.', 409);

    if (!Array.isArray(path) || path.length < 2 || !path.every(Number.isInteger)) {
      throw new GameError('Percorso della mossa malformato.');
    }

    const wanted = path.join('-');
    const move = legalMoves(game.state).find((candidate) => candidate.path.join('-') === wanted);
    // This is the whole point of the server holding the game: a move that is
    // not in the legal list does not happen, whatever the client sent.
    if (!move) throw new GameError('Mossa non legale in questa posizione.');

    this.#commit(game, move, HUMAN);
    await this.#recordIfFinished(game);
    return move;
  }

  /**
   * Jev's turn. Returns the exact request sent and the exact answer received,
   * so the page can show both without ever having built either.
   */
  async playJev(game, { useLocalEngine = false } = {}) {
    const status = gameStatus(game.state);
    if (status !== 'playing') throw new GameError('La partita e finita.', 409);
    if (game.state.turn !== JEV) throw new GameError('Non e il turno di Jev.', 409);

    const annotated = annotateMoves(game.state);
    if (annotated.length === 0) throw new GameError('Jev non ha mosse legali.', 409);

    const lastOpponentMove = game.history.filter((entry) => entry.color === HUMAN).at(-1)?.notation ?? null;
    const recentMoves = game.history.slice(-6)
      .map((entry) => `${entry.color === HUMAN ? 'avversario' : 'tu'}: ${entry.notation}`);

    // With a single legal move there is nothing to choose, so no request is sent.
    if (annotated.length === 1 && !useLocalEngine) {
      const [only] = annotated;
      this.#commit(game, only.move, JEV);
      await this.#recordIfFinished(game);
      return { source: 'forced', move: only.move, notation: only.notation, ranking: [], request: null, response: null };
    }

    if (useLocalEngine) {
      const chosen = heuristicBest(annotated);
      this.#commit(game, chosen.move, JEV);
      await this.#recordIfFinished(game);
      return {
        source: 'local',
        move: chosen.move,
        notation: chosen.notation,
        request: null,
        response: null,
        ranking: annotated.map((entry) => ({
          notation: entry.notation, probability: 0, chosen: entry === chosen,
          facts: entry.facts, description: entry.description, move: entry.move,
        })),
      };
    }

    if (game.jevRequests >= MAX_JEV_REQUESTS_PER_GAME) {
      throw new JevError(
        `Questa partita ha gia fatto ${MAX_JEV_REQUESTS_PER_GAME} richieste a TypeSafe: il limite serve a non bruciare la chiave.`,
        { type: 'rate_limited', status: 429 },
      );
    }

    const { request, candidates, dropped } = buildRequest({
      state: game.state,
      annotated,
      jevColor: JEV,
      lastOpponentMove,
      recentMoves,
    });

    const { body, latencyMs } = await askJev({ apiKey: game.apiKey, request });
    const result = interpret(body, candidates);

    game.jevRequests++;
    game.jevTokens += body?.usage?.input_tokens ?? 0;

    this.#commit(game, result.entry.move, JEV);
    await this.#recordIfFinished(game);

    return {
      source: 'jev',
      move: result.entry.move,
      notation: result.entry.notation,
      ranking: result.ranking,
      confidence: result.confidence,
      posture: result.posture,
      risk: result.risk,
      usage: result.usage,
      model: result.model,
      note: result.note,
      dropped,
      latencyMs,
      // The raw exchange, so the panel can show what actually went over the wire.
      request,
      response: body,
    };
  }

  #commit(game, move, color) {
    game.state = applyMove(game.state, move);
    game.history.push({ color, notation: moveNotation(move) });
    game.touchedAt = Date.now();
  }

  async #recordIfFinished(game) {
    if (game.recorded) return;
    const status = gameStatus(game.state);
    if (status === 'playing') return;

    game.recorded = true;
    const result = status === 'draw' ? 'draw' : status === 'white_wins' ? 'win' : 'loss';

    await this.leaderboard.record({
      name: game.playerName,
      variant: game.variant,
      result,
      moves: game.history.length,
      jevRequests: game.jevRequests,
      jevTokens: game.jevTokens,
    });
  }
}
