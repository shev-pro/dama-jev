/**
 * The draughts engine, one implementation for every variant.
 *
 * A pure module: no DOM, no network, no mutable global state. It lives on the
 * server because the server is the authority on what is legal - the browser
 * receives the legal moves as data and never computes them.
 *
 * Everything that differs between variants is a field in `variants.js`. If a
 * rule needs a branch here, it belongs in the variant table instead.
 */

import {
  EMPTY, WHITE_MAN, WHITE_KING, BLACK_MAN, BLACK_KING,
  colorOf, isKing, isMan, opponent,
  WHITE_FORWARD, BLACK_FORWARD,
} from '../src/board.js';
import { variantOf, geometryOf, DEFAULT_VARIANT } from './variants.js';

export { EMPTY, WHITE_MAN, WHITE_KING, BLACK_MAN, BLACK_KING, colorOf, isKing, isMan };
export { geometryOf, variantOf };

/** The rank a man of that colour has to reach to be crowned. */
const promotionRow = (color, size) => (color === 'white' ? 0 : size - 1);

const positionKey = (state) => `${state.board.join(',')}|${state.turn}`;

function withHistory(state) {
  state.history = [positionKey(state)];
  return state;
}

export function initialPosition(variantId = DEFAULT_VARIANT) {
  const variant = variantOf(variantId);
  const { total, perRow } = geometryOf(variant);
  const perSide = variant.pieceRows * perRow;

  const board = new Array(total + 1).fill(EMPTY);
  for (let square = 1; square <= perSide; square++) board[square] = BLACK_MAN;
  for (let square = total - perSide + 1; square <= total; square++) board[square] = WHITE_MAN;

  return withHistory({
    variant: variant.id,
    board,
    turn: variant.firstPlayer,
    halfmoveClock: 0,
    history: [],
  });
}

/**
 * Builds an arbitrary position from a square -> piece map, with 'w'/'b' for men
 * and 'W'/'B' for kings. Used by tests and study positions; a real game starts
 * from initialPosition().
 */
export function positionFrom(pieces, turn = 'white', variantId = DEFAULT_VARIANT) {
  const variant = variantOf(variantId);
  const { total } = geometryOf(variant);
  const codes = { w: WHITE_MAN, W: WHITE_KING, b: BLACK_MAN, B: BLACK_KING };
  const board = new Array(total + 1).fill(EMPTY);

  for (const [key, code] of Object.entries(pieces)) {
    const square = Number(key);
    if (!Number.isInteger(square) || square < 1 || square > total) {
      throw new Error(`square off the ${variant.size}x${variant.size} board: ${key}`);
    }
    if (!(code in codes)) throw new Error(`unknown piece: ${code}`);
    board[square] = codes[code];
  }
  if (turn !== 'white' && turn !== 'black') throw new Error(`unknown turn: ${turn}`);

  return withHistory({ variant: variant.id, board, turn, halfmoveClock: 0, history: [] });
}

/**
 * Every capture sequence starting at `from`, already complete: each one stops
 * only where nothing more can be taken.
 *
 * The two rules generators usually get wrong are both here. Captured pieces
 * stay on the board until the move ends, so they keep blocking the way; and
 * none of them may be jumped a second time. That is why `work` never removes
 * them and `taken` tracks separately which ones are already spoken for.
 */
function captureSequences(board, from, piece, variant) {
  const sequences = [];
  const geometry = geometryOf(variant);
  const table = geometry.rays;
  const work = board.slice();
  work[from] = EMPTY; // the piece is in flight, so its origin is free
  const taken = new Set();

  const mover = colorOf(piece);
  const enemy = opponent(mover);
  const flying = isKing(piece) && variant.flyingKings;
  const crownRow = promotionRow(mover, variant.size);

  // A man may be barred from capturing backwards, and in some variants from
  // capturing a king at all.
  const directions = isKing(piece) || variant.menCaptureBackwards
    ? [0, 1, 2, 3]
    : mover === 'white' ? WHITE_FORWARD : BLACK_FORWARD;
  const canTakeKings = isKing(piece) || variant.menCanCaptureKings;

  const walk = (at, path, captured) => {
    // Where crowning ends the turn, a man that lands on the last rank stops
    // there even with captures still available.
    const crowned = isMan(piece) && variant.promotionEndsMove
      && geometry.squareToRC(at)[0] === crownRow && path.length > 1;

    let continued = false;

    if (!crowned) {
      for (const direction of directions) {
        const ray = table[at][direction];

        // A flying king glides over empty squares up to the first piece; anything
        // else only looks at the adjacent square.
        let i = 0;
        if (flying) while (i < ray.length && work[ray[i]] === EMPTY) i++;
        if (i >= ray.length) continue;

        const victim = ray[i];
        if (work[victim] === EMPTY) continue;          // adjacent square empty
        if (colorOf(work[victim]) !== enemy) continue; // own piece
        if (taken.has(victim)) continue;               // already captured: blocks, cannot be retaken
        if (!canTakeKings && isKing(work[victim])) continue;

        const landings = [];
        for (let j = i + 1; j < ray.length && work[ray[j]] === EMPTY; j++) {
          landings.push(ray[j]);
          if (!flying) break; // a short-range piece lands immediately behind its prey
        }
        if (landings.length === 0) continue;

        taken.add(victim);
        for (const landing of landings) {
          continued = true;
          walk(landing, [...path, landing], [...captured, victim]);
        }
        taken.delete(victim);
      }
    }

    // A sequence only counts once it has run out: while a capture is available,
    // it must be taken.
    if (!continued && captured.length > 0) sequences.push({ path, captured });
  };

  walk(from, [from], []);
  return sequences;
}

function quietDestinations(board, from, piece, variant) {
  const table = geometryOf(variant).rays;
  const destinations = [];
  const flying = isKing(piece) && variant.flyingKings;
  const directions = isKing(piece)
    ? [0, 1, 2, 3]
    : piece > 0 ? WHITE_FORWARD : BLACK_FORWARD;

  for (const direction of directions) {
    for (const square of table[from][direction]) {
      if (board[square] !== EMPTY) break;
      destinations.push(square);
      if (!flying) break; // a short-range piece advances a single square
    }
  }
  return destinations;
}

function buildMove(from, path, captured, piece, variant) {
  const to = path[path.length - 1];
  const [row] = geometryOf(variant).squareToRC(to);
  // Promotion looks only at the landing square. Where a sequence may continue
  // past the last rank, a man that crosses it and carries on stays a man.
  const promotes = isMan(piece) && row === promotionRow(colorOf(piece), variant.size);
  return { from, to, path, captured, promotes, piece };
}

const countKings = (board, squares) => squares.filter((square) => isKing(board[square])).length;

/** The index of the first king taken, or Infinity when none is. */
function firstKingAt(board, captured) {
  const index = captured.findIndex((square) => isKing(board[square]));
  return index === -1 ? Infinity : index;
}

/** Keeps only the entries scoring best on `score`, leaving the rest untouched. */
function keepBest(moves, score, better = (a, b) => a > b) {
  let best = null;
  for (const move of moves) {
    const value = score(move);
    if (best === null || better(value, best)) best = value;
  }
  return moves.filter((move) => score(move) === best);
}

/**
 * Which capture sequences survive when several are available.
 *
 * International keeps the longest. English keeps them all and lets the player
 * choose. Italian applies a chain of tie-breaks, each one only among the
 * sequences that survived the previous.
 */
function applyCaptureChoice(captures, board, variant) {
  if (captures.length <= 1) return captures;

  switch (variant.captureChoice) {
    case 'free':
      return captures;

    case 'italian': {
      // 1. the greatest number of pieces
      let best = keepBest(captures, (move) => move.captured.length);
      // 2. capturing with a king rather than with a man
      best = keepBest(best, (move) => (isKing(move.piece) ? 1 : 0));
      // 3. the greatest number of kings taken
      best = keepBest(best, (move) => countKings(board, move.captured));
      // 4. taking the king earliest in the sequence
      return keepBest(best, (move) => firstKingAt(board, move.captured), (a, b) => a < b);
    }

    case 'maximum':
    default:
      return keepBest(captures, (move) => move.captured.length);
  }
}

/**
 * The legal moves for the side to move, already filtered by compulsory capture
 * and by whatever the variant says to prefer among the captures available.
 */
export function legalMoves(state) {
  const variant = variantOf(state.variant);
  const { board, turn } = state;
  const { total } = geometryOf(variant);
  const mine = turn === 'white' ? 1 : -1;
  const captures = [];

  for (let square = 1; square <= total; square++) {
    const piece = board[square];
    if (piece === EMPTY || Math.sign(piece) !== mine) continue;
    for (const { path, captured } of captureSequences(board, square, piece, variant)) {
      captures.push(buildMove(square, path, captured, piece, variant));
    }
  }

  if (captures.length > 0) return applyCaptureChoice(captures, board, variant);

  const quiet = [];
  for (let square = 1; square <= total; square++) {
    const piece = board[square];
    if (piece === EMPTY || Math.sign(piece) !== mine) continue;
    for (const to of quietDestinations(board, square, piece, variant)) {
      quiet.push(buildMove(square, [square, to], [], piece, variant));
    }
  }
  return quiet;
}

export function applyMove(state, move) {
  const board = state.board.slice();
  board[move.from] = EMPTY;
  for (const square of move.captured) board[square] = EMPTY;
  board[move.to] = move.promotes ? (move.piece > 0 ? WHITE_KING : BLACK_KING) : move.piece;

  // The draw counter restarts as soon as something becomes irreversible.
  const irreversible = move.captured.length > 0 || isMan(move.piece);

  const next = {
    variant: state.variant,
    board,
    turn: opponent(state.turn),
    halfmoveClock: irreversible ? 0 : state.halfmoveClock + 1,
    history: state.history,
  };
  next.history = [...state.history, positionKey(next)];
  return next;
}

export function countPieces(state) {
  const { total } = geometryOf(variantOf(state.variant));
  let white = 0;
  let black = 0;
  for (let square = 1; square <= total; square++) {
    const piece = state.board[square];
    if (piece > 0) white++;
    else if (piece < 0) black++;
  }
  return { white, black };
}

function repetitions(state) {
  const key = positionKey(state);
  return state.history.reduce((count, seen) => count + (seen === key ? 1 : 0), 0);
}

export function gameStatus(state) {
  const variant = variantOf(state.variant);
  const { white, black } = countPieces(state);
  if (white === 0) return 'black_wins';
  if (black === 0) return 'white_wins';

  if (state.halfmoveClock >= variant.drawPlyLimit) return 'draw';
  if (repetitions(state) >= 3) return 'draw';

  // Whoever is to move with no legal move has lost: they are walled in.
  if (legalMoves(state).length === 0) return state.turn === 'white' ? 'black_wins' : 'white_wins';

  return 'playing';
}
