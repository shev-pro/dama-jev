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

import { EMPTY, isKing } from '../src/board.js';
import { variantOf, geometryOf } from './variants.js';

/** The geometry a state is played on. */
export const geometryOfState = (state) => geometryOf(variantOf(state.variant));

/** "32-28" for a quiet move, "33x24x13" for a capture chain. */
export function moveNotation(move) {
  return move.captured.length > 0 ? move.path.join('x') : `${move.from}-${move.to}`;
}

/** The rank, as a player counts it, from the top. */
export const squareRow = (square, geometry) => geometry.squareToRC(square)[0] + 1;

/** The file 0..size-1 of a square, left to right. */
export const squareCol = (square, geometry) => geometry.squareToRC(square)[1];

/** Which part of the board a square falls in: it helps tell moves apart. */
export function zoneOf(square, geometry) {
  const col = squareCol(square, geometry);
  if (col < geometry.size * 0.3) return 'sull ala sinistra';
  if (col >= geometry.size * 0.7) return 'sull ala destra';
  return 'al centro';
}

/** The outer files are the edges: a piece resting there cannot be jumped sideways. */
export const isEdgeSquare = (square, geometry) => {
  const col = squareCol(square, geometry);
  return col === 0 || col === geometry.size - 1;
};

/** How many ranks a man of that colour still needs to promote. */
export const rowsToPromotion = (square, color, geometry) => {
  const [row] = geometry.squareToRC(square);
  return color === 'white' ? row : geometry.size - 1 - row;
};

const GLYPHS = { jevMan: 'o', jevKing: 'O', foeMan: 'x', foeKing: 'X', empty: '.' };

function glyph(piece, jevColor) {
  if (piece === EMPTY) return GLYPHS.empty;
  const mine = (piece > 0 ? 'white' : 'black') === jevColor;
  if (mine) return isKing(piece) ? GLYPHS.jevKing : GLYPHS.jevMan;
  return isKing(piece) ? GLYPHS.foeKing : GLYPHS.foeMan;
}

/**
 * The board as a text grid, one line per rank, each cell "number plus
 * occupant", with alternating lines indented so the diagonal structure shows.
 * Light squares do not exist and do not appear.
 */
export function renderBoard(state, jevColor) {
  const geometry = geometryOfState(state);
  const lines = [];

  for (let row = 0; row < geometry.size; row++) {
    const cells = [];
    for (let i = 0; i < geometry.perRow; i++) {
      const square = row * geometry.perRow + i + 1;
      cells.push(`${String(square).padStart(2)}${glyph(state.board[square], jevColor)}`);
    }
    // Indent the rows whose playable squares start one file in, so the diagram
    // keeps the diagonal shape of the real board - either way round.
    const indented = geometry.squareToRC(row * geometry.perRow + 1)[1] === 1;
    lines.push(`${indented ? '  ' : ''}${cells.join('  ')}`);
  }
  return lines.join('\n');
}

export const boardLegend = (size) =>
  `${GLYPHS.jevMan} = tua pedina, ${GLYPHS.jevKing} = tua dama, ` +
  `${GLYPHS.foeMan} = pedina avversaria, ${GLYPHS.foeKing} = dama avversaria, ` +
  `${GLYPHS.empty} = casella vuota. ` +
  `Le righe vanno dalla 1 in alto alla ${size} in basso.`;

/** The squares held by one colour, men and kings kept apart. */
export function piecesOf(state, color) {
  const { total } = geometryOfState(state);
  const men = [];
  const kings = [];
  for (let square = 1; square <= total; square++) {
    const piece = state.board[square];
    if (piece === EMPTY) continue;
    if ((piece > 0 ? 'white' : 'black') !== color) continue;
    (isKing(piece) ? kings : men).push(square);
  }
  return { men, kings, total: men.length + kings.length };
}
