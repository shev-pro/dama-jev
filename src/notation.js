/**
 * Notation and textual renderings of a position.
 *
 * One place decides what a move is called: the same string ends up in the move
 * list on screen, in the panel, and as an option key in the Choice sent to Jev.
 * If those ever diverged, the model's answer could no longer be mapped back
 * onto a real move.
 *
 * Note: the strings that travel to Jev are Italian on purpose. They are prompt
 * content, and the whole request is written in Italian so the model reads one
 * coherent piece of language.
 */

import { EMPTY, isKing, squareToRC } from './rules.js';

/** "32-28" for a quiet move, "33x24x13" for a capture chain. */
export function moveNotation(move) {
  return move.captured.length > 0 ? move.path.join('x') : `${move.from}-${move.to}`;
}

/** The rank 1-10 as a player counts it, from the top. */
export const squareRow = (square) => squareToRC(square)[0] + 1;

/** The file 0-9 of a square, left to right. */
export const squareCol = (square) => squareToRC(square)[1];

/** Which part of the board a square falls in: it helps tell moves apart. */
export function zoneOf(square) {
  const col = squareCol(square);
  if (col <= 2) return 'sull ala sinistra';
  if (col >= 7) return 'sull ala destra';
  return 'al centro';
}

/** Files 0 and 9 are the edges: a piece resting there cannot be jumped sideways. */
export const isEdgeSquare = (square) => {
  const col = squareCol(square);
  return col === 0 || col === 9;
};

/** How many ranks a man of that colour still needs to promote. */
export const rowsToPromotion = (square, color) =>
  color === 'white' ? squareToRC(square)[0] : 9 - squareToRC(square)[0];

const GLYPHS = {
  jevMan: 'o',
  jevKing: 'O',
  foeMan: 'x',
  foeKing: 'X',
  empty: '.',
};

function glyph(piece, jevColor) {
  if (piece === EMPTY) return GLYPHS.empty;
  const mine = (piece > 0 ? 'white' : 'black') === jevColor;
  if (mine) return isKing(piece) ? GLYPHS.jevKing : GLYPHS.jevMan;
  return isKing(piece) ? GLYPHS.foeKing : GLYPHS.foeMan;
}

/**
 * The board as a text grid: ten rows of five squares, each one "number plus
 * occupant", with alternating rows indented so the diagonal structure shows.
 * Light squares do not exist and do not appear.
 */
export function renderBoard(state, jevColor) {
  const lines = [];
  for (let row = 0; row < 10; row++) {
    const cells = [];
    for (let i = 0; i < 5; i++) {
      const square = row * 5 + i + 1;
      cells.push(`${String(square).padStart(2)}${glyph(state.board[square], jevColor)}`);
    }
    lines.push(`${row % 2 === 0 ? '  ' : ''}${cells.join('  ')}`);
  }
  return lines.join('\n');
}

export const BOARD_LEGEND =
  `${GLYPHS.jevMan} = tua pedina, ${GLYPHS.jevKing} = tua dama, ` +
  `${GLYPHS.foeMan} = pedina avversaria, ${GLYPHS.foeKing} = dama avversaria, ` +
  `${GLYPHS.empty} = casella vuota. ` +
  'Le righe vanno dalla 1 in alto alla 10 in basso.';

/** The squares held by one colour, men and kings kept apart. */
export function piecesOf(state, color) {
  const men = [];
  const kings = [];
  for (let square = 1; square <= 50; square++) {
    const piece = state.board[square];
    if (piece === EMPTY) continue;
    if ((piece > 0 ? 'white' : 'black') !== color) continue;
    (isKing(piece) ? kings : men).push(square);
  }
  return { men, kings, total: men.length + kings.length };
}
