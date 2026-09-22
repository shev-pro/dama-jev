/**
 * La selezione della mossa da parte dell'umano, percorsa un salto alla volta.
 *
 * Non basta scegliere partenza e arrivo: due catene di cattura diverse possono
 * partire dalla stessa casella e finire sulla stessa casella mangiando pezzi
 * diversi, e con le dame volanti succede davvero. Facendo cliccare ogni salto
 * della catena l'ambiguita non si pone, e nel frattempo si vede la mossa
 * prendere forma.
 *
 * Modulo puro: non tocca il DOM e non conosce la scena.
 */

/** Avvia una selezione dalla casella `from`, o null se da li non parte niente. */
export function createSelection(moves, from) {
  const candidates = moves.filter((move) => move.from === from);
  return candidates.length > 0 ? { from, steps: [], candidates } : null;
}

/** Le caselle su cui si puo cliccare adesso: il salto successivo della catena. */
export function selectionTargets(selection) {
  if (!selection) return [];
  const next = selection.steps.length + 1;
  const squares = selection.candidates.map((move) => move.path[next]).filter((s) => s !== undefined);
  return [...new Set(squares)];
}

/** La casella attualmente "in mano": la partenza, o l'ultimo salto fatto. */
export const selectionHead = (selection) => (selection ? selection.steps.at(-1) ?? selection.from : null);

/**
 * Aggiunge un salto. Torna la mossa completa quando la catena e finita,
 * altrimenti la selezione ristretta ai candidati ancora compatibili.
 * Un click fuori bersaglio non cambia niente.
 */
export function advanceSelection(selection, square) {
  if (!selectionTargets(selection).includes(square)) return { selection, move: null };

  const steps = [...selection.steps, square];
  const candidates = selection.candidates.filter((move) => move.path[steps.length] === square);
  const completa = candidates.find((move) => move.path.length === steps.length + 1);

  if (completa) return { selection: null, move: completa };
  return { selection: { ...selection, steps, candidates }, move: null };
}
