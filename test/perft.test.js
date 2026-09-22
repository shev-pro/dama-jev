import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialPosition, positionFrom, legalMoves, applyMove } from '../server/rules.js';

/**
 * Counts the positions reachable in `depth` plies.
 *
 * It is the harshest check there is on a move generator: one wrong case - a
 * capture too many, a sequence that should not be maximal, a king jumping where
 * it may not - moves the total and the comparison fails.
 *
 * Every number below is published, and for the Italian game it was produced
 * independently by two engines (Rein Halbersma's dctl and Ed Gilbert's
 * Kingsrow Italian), which is what makes it worth asserting: it is not this
 * code checking itself.
 *
 * The depths asserted here are the ones printed in the README, so the table
 * cannot drift away from what is actually checked. The published sequences run
 * much further than this - English is known to depth 28 - but each extra ply
 * costs roughly five times the last, and this is already where the interesting
 * rules bite.
 */
function perft(state, depth) {
  const moves = legalMoves(state);
  if (depth === 1) return moves.length;

  let total = 0;
  for (const move of moves) total += perft(applyMove(state, move), depth - 1);
  return total;
}

const OPENING = {
  international: [9, 81, 658, 4265, 27117, 167140, 1049442],
  english: [7, 49, 302, 1469, 7361, 36768, 179740, 845931],
  italian: [7, 49, 302, 1469, 7361, 36473, 177532, 828783],
};

for (const [variant, expected] of Object.entries(OPENING)) {
  test(`${variant}: perft from the opening matches the published counts`, () => {
    for (const [index, count] of expected.entries()) {
      assert.equal(perft(initialPosition(variant), index + 1), count, `depth ${index + 1}`);
    }
  });
}

test('italian and english share an opening, then the majority rule splits them', () => {
  // Same board and same men, so the first plies coincide. They part company at
  // depth 6, where Italian must take the longest capture and English may not.
  for (let depth = 1; depth <= 5; depth++) {
    assert.equal(OPENING.italian[depth - 1], OPENING.english[depth - 1]);
  }
  assert.ok(OPENING.italian[5] < OPENING.english[5]);
});

/**
 * Ed Gilbert's Italian positions, via the World Draughts Forum thread and the
 * dctl regression suite. Unlike the opening, these have kings on the board from
 * the first ply, so they exercise the whole four-tier capture priority, the
 * short king, and the rule that a man may not take a king.
 */
const GILBERT = [
  {
    name: 'kings are still off the board, men only',
    turn: 'white',
    pieces: {
      30: 'w', 26: 'w', 27: 'w', 22: 'w', 23: 'w', 24: 'w', 17: 'w', 18: 'w', 20: 'w',
      14: 'b', 15: 'b', 16: 'b', 9: 'b', 11: 'b', 5: 'b', 6: 'b', 1: 'b', 3: 'b',
    },
    expected: [5, 13, 42, 107, 360, 1099, 3736, 12495],
  },
  {
    name: 'one white king against men',
    turn: 'black',
    pieces: {
      30: 'w', 21: 'w', 22: 'w', 17: 'w', 20: 'w', 6: 'W',
      25: 'b', 28: 'b', 9: 'b', 5: 'b', 1: 'b', 3: 'b',
    },
    expected: [6, 47, 271, 1916, 10810, 73137],
  },
  {
    name: 'kings on both sides, every priority tier in play',
    turn: 'white',
    pieces: {
      27: 'W', 28: 'W', 17: 'w', 20: 'w', 9: 'w', 12: 'W', 8: 'w',
      21: 'b', 24: 'b', 19: 'B', 13: 'B', 14: 'b', 11: 'B', 4: 'b',
    },
    expected: [13, 112, 828, 6756, 46241],
  },
];

for (const { name, turn, pieces, expected } of GILBERT) {
  test(`italian, ${name}: perft matches Gilbert's counts`, () => {
    for (const [index, count] of expected.entries()) {
      assert.equal(perft(positionFrom(pieces, turn, 'italian'), index + 1), count, `depth ${index + 1}`);
    }
  });
}
