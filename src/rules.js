/**
 * International draughts engine (10x10, FMJD rules).
 *
 * A pure module: no DOM, no network, no mutable global state. Everything the
 * rest of the application knows about the game comes from here.
 *
 * The 50 playable squares are the dark ones, numbered 1-50 left to right and
 * top to bottom. Black starts on 1-20, White on 31-50, and White moves first.
 */

export const EMPTY = 0;
export const WHITE_MAN = 1;
export const WHITE_KING = 2;
export const BLACK_MAN = -1;
export const BLACK_KING = -2;

/** 25 moves per side without a capture or a man move, counted in plies. */
export const DRAW_PLY_LIMIT = 50;

// Diagonal directions in the order [up-left, up-right, down-left, down-right].
// White advances upwards (indices 0 and 1), Black downwards (2 and 3).
const DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const WHITE_FORWARD = [0, 1];
const BLACK_FORWARD = [2, 3];

export function squareToRC(square) {
  const index = square - 1;
  const row = Math.floor(index / 5);
  const offset = index % 5;
  return [row, row % 2 === 0 ? offset * 2 + 1 : offset * 2];
}

export function rcToSquare(row, col) {
  if (row < 0 || row > 9 || col < 0 || col > 9) return 0;
  if ((row + col) % 2 === 0) return 0; // light square, not playable
  const offset = row % 2 === 0 ? (col - 1) / 2 : col / 2;
  return row * 5 + offset + 1;
}

/**
 * RAYS[square][direction] lists the squares met while moving away in that
 * direction, nearest first. Precomputing them keeps the coordinate arithmetic
 * out of the capture recursion.
 */
const RAYS = (() => {
  const rays = [];
  for (let square = 0; square <= 50; square++) rays.push([[], [], [], []]);

  for (let square = 1; square <= 50; square++) {
    const [row, col] = squareToRC(square);
    DIRECTIONS.forEach(([dr, dc], direction) => {
      let r = row + dr;
      let c = col + dc;
      for (let next = rcToSquare(r, c); next; next = rcToSquare(r, c)) {
        rays[square][direction].push(next);
        r += dr;
        c += dc;
      }
    });
  }
  return rays;
})();

export const colorOf = (piece) => (piece > 0 ? 'white' : piece < 0 ? 'black' : null);
export const isKing = (piece) => Math.abs(piece) === 2;
export const isMan = (piece) => Math.abs(piece) === 1;
const opponent = (turn) => (turn === 'white' ? 'black' : 'white');

const positionKey = (state) => `${state.board.join(',')}|${state.turn}`;

function withHistory(state) {
  state.history = [positionKey(state)];
  return state;
}

export function initialPosition() {
  const board = new Array(51).fill(EMPTY);
  for (let square = 1; square <= 20; square++) board[square] = BLACK_MAN;
  for (let square = 31; square <= 50; square++) board[square] = WHITE_MAN;
  return withHistory({ board, turn: 'white', halfmoveClock: 0, history: [] });
}

/**
 * Builds an arbitrary position from a square -> piece map, with 'w'/'b' for men
 * and 'W'/'B' for kings. Used by tests and study positions; a real game starts
 * from initialPosition().
 */
export function positionFrom(pieces, turn = 'white') {
  const codes = { w: WHITE_MAN, W: WHITE_KING, b: BLACK_MAN, B: BLACK_KING };
  const board = new Array(51).fill(EMPTY);

  for (const [key, code] of Object.entries(pieces)) {
    const square = Number(key);
    if (!Number.isInteger(square) || square < 1 || square > 50) {
      throw new Error(`square off the board: ${key}`);
    }
    if (!(code in codes)) throw new Error(`unknown piece: ${code}`);
    board[square] = codes[code];
  }
  if (turn !== 'white' && turn !== 'black') throw new Error(`unknown turn: ${turn}`);

  return withHistory({ board, turn, halfmoveClock: 0, history: [] });
}

/**
 * Every capture sequence starting at `from`, already complete: each one stops
 * only where nothing more can be taken.
 *
 * The two fiddly rules live here. Captured pieces stay on the board until the
 * move ends, so they keep blocking the way; and none of them may be jumped a
 * second time. That is why `work` never removes them and `taken` tracks
 * separately which ones are already spoken for.
 */
function captureSequences(board, from, piece) {
  const sequences = [];
  const work = board.slice();
  work[from] = EMPTY; // the piece is in flight, so its origin is free
  const taken = new Set();

  const enemy = opponent(colorOf(piece));
  const flying = isKing(piece);

  const walk = (at, path, captured) => {
    let continued = false;

    for (let direction = 0; direction < 4; direction++) {
      const ray = RAYS[at][direction];

      // A king glides over empty squares up to the first piece; a man only
      // looks at the adjacent square.
      let i = 0;
      if (flying) while (i < ray.length && work[ray[i]] === EMPTY) i++;
      if (i >= ray.length) continue;

      const victim = ray[i];
      if (work[victim] === EMPTY) continue;          // man: adjacent square empty
      if (colorOf(work[victim]) !== enemy) continue; // own piece
      if (taken.has(victim)) continue;               // already captured: blocks, cannot be retaken

      const landings = [];
      for (let j = i + 1; j < ray.length && work[ray[j]] === EMPTY; j++) {
        landings.push(ray[j]);
        if (!flying) break; // a man lands immediately behind its prey
      }
      if (landings.length === 0) continue;

      taken.add(victim);
      for (const landing of landings) {
        continued = true;
        walk(landing, [...path, landing], [...captured, victim]);
      }
      taken.delete(victim);
    }

    // A sequence only counts once it has run out: while a capture is available,
    // it must be taken.
    if (!continued && captured.length > 0) sequences.push({ path, captured });
  };

  walk(from, [from], []);
  return sequences;
}

function quietDestinations(board, from, piece) {
  const destinations = [];
  const flying = isKing(piece);
  const directions = flying ? [0, 1, 2, 3] : piece > 0 ? WHITE_FORWARD : BLACK_FORWARD;

  for (const direction of directions) {
    for (const square of RAYS[from][direction]) {
      if (board[square] !== EMPTY) break;
      destinations.push(square);
      if (!flying) break; // a man advances a single square
    }
  }
  return destinations;
}

function buildMove(from, path, captured, piece) {
  const to = path[path.length - 1];
  const [row] = squareToRC(to);
  // Promotion looks only at the landing square: a man that crosses the far rank
  // mid-sequence and carries on stays a man.
  const promotes = isMan(piece) && ((piece > 0 && row === 0) || (piece < 0 && row === 9));
  return { from, to, path, captured, promotes, piece };
}

/**
 * The legal moves for the side to move, already filtered by compulsory capture
 * and the majority rule: if a capture exists it must be played, and among the
 * captures only those taking the most pieces survive.
 */
export function legalMoves(state) {
  const { board, turn } = state;
  const mine = turn === 'white' ? 1 : -1;
  const captures = [];

  for (let square = 1; square <= 50; square++) {
    const piece = board[square];
    if (piece === EMPTY || Math.sign(piece) !== mine) continue;
    for (const { path, captured } of captureSequences(board, square, piece)) {
      captures.push(buildMove(square, path, captured, piece));
    }
  }

  if (captures.length > 0) {
    const best = Math.max(...captures.map((move) => move.captured.length));
    return captures.filter((move) => move.captured.length === best);
  }

  const quiet = [];
  for (let square = 1; square <= 50; square++) {
    const piece = board[square];
    if (piece === EMPTY || Math.sign(piece) !== mine) continue;
    for (const to of quietDestinations(board, square, piece)) {
      quiet.push(buildMove(square, [square, to], [], piece));
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
    board,
    turn: opponent(state.turn),
    halfmoveClock: irreversible ? 0 : state.halfmoveClock + 1,
    history: state.history,
  };
  next.history = [...state.history, positionKey(next)];
  return next;
}

export function countPieces(state) {
  let white = 0;
  let black = 0;
  for (let square = 1; square <= 50; square++) {
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
  const { white, black } = countPieces(state);
  if (white === 0) return 'black_wins';
  if (black === 0) return 'white_wins';

  if (state.halfmoveClock >= DRAW_PLY_LIMIT) return 'draw';
  if (repetitions(state) >= 3) return 'draw';

  // Whoever is to move with no legal move has lost: they are walled in.
  if (legalMoves(state).length === 0) return state.turn === 'white' ? 'black_wins' : 'white_wins';

  return 'playing';
}
