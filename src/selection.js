/**
 * The human's move selection, walked one hop at a time.
 *
 * Picking an origin and a destination is not enough: two different capture
 * sequences can start on the same square and end on the same square while
 * taking different pieces, and with flying kings that really happens. Clicking
 * each hop of the chain removes the ambiguity, and shows the move taking shape
 * along the way.
 *
 * A pure module: it touches neither the DOM nor the scene.
 */

/** Starts a selection at `from`, or null if nothing can move from there. */
export function createSelection(moves, from) {
  const candidates = moves.filter((move) => move.from === from);
  return candidates.length > 0 ? { from, steps: [], candidates } : null;
}

/** The squares that can be clicked right now: the next hop of the chain. */
export function selectionTargets(selection) {
  if (!selection) return [];
  const next = selection.steps.length + 1;
  const squares = selection.candidates.map((move) => move.path[next]).filter((s) => s !== undefined);
  return [...new Set(squares)];
}

/** The square currently "in hand": the origin, or the last hop taken. */
export const selectionHead = (selection) => (selection ? selection.steps.at(-1) ?? selection.from : null);

/**
 * Adds one hop. Returns the finished move once the chain is over, otherwise the
 * selection narrowed to the candidates still compatible with it. A click off
 * target changes nothing.
 */
export function advanceSelection(selection, square) {
  if (!selectionTargets(selection).includes(square)) return { selection, move: null };

  const steps = [...selection.steps, square];
  const candidates = selection.candidates.filter((move) => move.path[steps.length] === square);
  const finished = candidates.find((move) => move.path.length === steps.length + 1);

  if (finished) return { selection: null, move: finished };
  return { selection: { ...selection, steps, candidates }, move: null };
}
