/**
 * Board geometry and piece encoding, shared by the engine and the renderer.
 *
 * This is the one module both sides of the wire are allowed to hold: the server
 * needs it to reason about the game, the browser needs it to draw one. It
 * contains no rules and decides nothing.
 *
 * Two things vary between variants and both are captured by a geometry object:
 * the side of the board, and which diagonal the playable squares sit on.
 * International and English draughts put a dark square at the player's near
 * LEFT; the Italian regulation (FID art. 1.1.2.3) puts it at the near RIGHT,
 * which mirrors the whole numbering. Getting that wrong would not change how
 * many moves exist - the opening is symmetric - but every square number the
 * panel prints would name a different square than the official notation does.
 */

export const EMPTY = 0;
export const WHITE_MAN = 1;
export const WHITE_KING = 2;
export const BLACK_MAN = -1;
export const BLACK_KING = -2;

export const colorOf = (piece) => (piece > 0 ? 'white' : piece < 0 ? 'black' : null);
export const isKing = (piece) => Math.abs(piece) === 2;
export const isMan = (piece) => Math.abs(piece) === 1;
export const opponent = (color) => (color === 'white' ? 'black' : 'white');

// Diagonal directions in the order [up-left, up-right, down-left, down-right].
// White advances upwards (indices 0 and 1), Black downwards (2 and 3).
export const DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
export const WHITE_FORWARD = [0, 1];
export const BLACK_FORWARD = [2, 3];

/**
 * A board's coordinate system.
 *
 * `parity` says which squares are playable: 1 when (row + col) is odd - a dark
 * square at the player's near left - and 0 when it is even, the mirrored
 * Italian board. Squares are numbered from 1, left to right and top to bottom,
 * over the playable squares only.
 */
function createGeometry(size, parity) {
  const perRow = size / 2;
  const total = size * perRow;

  // The first playable column of a row, which alternates down the board.
  const firstCol = (row) => (parity === 1 ? (row + 1) % 2 : row % 2);

  const squareToRC = (square) => {
    const index = square - 1;
    const row = Math.floor(index / perRow);
    return [row, firstCol(row) + (index % perRow) * 2];
  };

  const rcToSquare = (row, col) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return 0;
    if ((row + col) % 2 !== parity) return 0; // not a playable square
    return row * perRow + (col - firstCol(row)) / 2 + 1;
  };

  // rays[square][direction] lists the squares met while moving away in that
  // direction, nearest first. Precomputing them keeps the coordinate arithmetic
  // out of the capture recursion.
  const rays = [];
  for (let square = 0; square <= total; square++) rays.push([[], [], [], []]);

  for (let square = 1; square <= total; square++) {
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

  return { size, parity, perRow, total, squareToRC, rcToSquare, rays };
}

const cache = new Map();

/** The geometry for a board size and parity, built once and reused. */
export function geometryFor(size, parity = 1) {
  const key = `${size}:${parity}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const geometry = createGeometry(size, parity);
  cache.set(key, geometry);
  return geometry;
}
