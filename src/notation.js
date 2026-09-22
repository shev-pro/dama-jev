/**
 * Notazione e rappresentazioni testuali della posizione.
 *
 * Un solo posto decide come una mossa si chiama: la stessa stringa finisce
 * nella cronologia a schermo, nel pannello e come chiave di opzione nella
 * Choice mandata a Jev. Se divergessero, la risposta del modello non
 * sarebbe piu rimappabile sulla mossa.
 */

import { EMPTY, isKing, squareToRC } from './rules.js';

/** "32-28" per una mossa tranquilla, "33x24x13" per una catena di prese. */
export function moveNotation(move) {
  return move.captured.length > 0 ? move.path.join('x') : `${move.from}-${move.to}`;
}

/** La traversa 1-10 come la conta un giocatore, dall'alto. */
export const squareRow = (square) => squareToRC(square)[0] + 1;

/** La colonna 0-9 della casella, da sinistra a destra. */
export const squareCol = (square) => squareToRC(square)[1];

/** In che parte della scacchiera cade la casella: serve a distinguere le mosse fra loro. */
export function zoneOf(square) {
  const col = squareCol(square);
  if (col <= 2) return 'sull ala sinistra';
  if (col >= 7) return 'sull ala destra';
  return 'al centro';
}

/** Le colonne 0 e 9 sono le sponde: un pezzo appoggiato li non puo essere scavalcato di lato. */
export const isEdgeSquare = (square) => {
  const col = squareToRC(square)[1];
  return col === 0 || col === 9;
};

/** Quante traverse mancano alla promozione per una pedina di quel colore. */
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
 * La scacchiera come griglia di testo: dieci righe da cinque caselle, ciascuna
 * "numero + occupante", con le righe dispari rientrate per rendere visibile
 * l'andamento diagonale. Le caselle chiare non esistono e non compaiono.
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

/** Le caselle occupate da un colore, separate fra pedine e dame. */
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
