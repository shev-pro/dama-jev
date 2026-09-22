import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialPosition, positionFrom, legalMoves } from '../src/rules.js';
import { createSelection, selectionTargets, selectionHead, advanceSelection } from '../src/selection.js';

test('selecting an empty or blocked square opens nothing', () => {
  const moves = legalMoves(initialPosition());
  assert.equal(createSelection(moves, 23), null, 'empty square');
  assert.equal(createSelection(moves, 40), null, 'man walled in behind its own');
  assert.equal(selectionTargets(null).length, 0);
});

test('a quiet move closes on the first click on its destination', () => {
  const moves = legalMoves(initialPosition());
  const selection = createSelection(moves, 32);

  assert.equal(selectionHead(selection), 32);
  assert.deepEqual(selectionTargets(selection).sort(), [27, 28]);

  const next = advanceSelection(selection, 28);
  assert.equal(next.selection, null, 'the selection closes');
  assert.equal(next.move.from, 32);
  assert.equal(next.move.to, 28);
});

test('a click off target changes nothing', () => {
  const selection = createSelection(legalMoves(initialPosition()), 32);
  const result = advanceSelection(selection, 19);

  assert.equal(result.move, null);
  assert.equal(result.selection, selection, 'the selection is left as it was');
});

test('a chain is walked one hop at a time', () => {
  // 33x24x13: two hops, so two clicks after picking the piece up.
  const moves = legalMoves(positionFrom({ 33: 'w', 29: 'b', 19: 'b' }, 'white'));
  let selection = createSelection(moves, 33);

  assert.deepEqual(selectionTargets(selection), [24]);

  let step = advanceSelection(selection, 24);
  assert.equal(step.move, null, 'the chain is not over yet');
  selection = step.selection;

  assert.equal(selectionHead(selection), 24);
  assert.deepEqual(selectionTargets(selection), [13]);

  step = advanceSelection(selection, 13);
  assert.equal(step.selection, null);
  assert.deepEqual(step.move.captured, [29, 19]);
});

test('two chains sharing origin and destination are told apart by the middle hop', () => {
  // 46x19x5 and 46x14x5 take the same pieces and end on the same square:
  // picking an origin and a destination could not distinguish them.
  const moves = legalMoves(positionFrom({ 46: 'W', 23: 'b', 10: 'b' }, 'white'));
  const selection = createSelection(moves, 46);

  assert.equal(moves.length, 2);
  assert.deepEqual(selectionTargets(selection).sort((a, b) => a - b), [14, 19]);

  const viaFourteen = advanceSelection(selection, 14);
  assert.deepEqual(selectionTargets(viaFourteen.selection), [5]);
  assert.deepEqual(advanceSelection(viaFourteen.selection, 5).move.path, [46, 14, 5]);

  const viaNineteen = advanceSelection(selection, 19);
  assert.deepEqual(advanceSelection(viaNineteen.selection, 5).move.path, [46, 19, 5]);
});

test('with capture compulsory, pieces that cannot take are not selectable', () => {
  const moves = legalMoves(positionFrom({ 32: 'w', 35: 'w', 28: 'b' }, 'white'));

  assert.ok(createSelection(moves, 32), 'the piece that captures is selectable');
  assert.equal(createSelection(moves, 35), null, 'the one that does not is not');
});
