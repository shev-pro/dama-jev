import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialPosition, positionFrom, legalMoves } from '../src/rules.js';
import { moveNotation, renderBoard, piecesOf, isEdgeSquare, rowsToPromotion } from '../src/notation.js';
import { annotateMoves, heuristicBest, scoreMoves } from '../src/analysis.js';

const byNotation = (annotated, notation) => annotated.find((entry) => entry.notation === notation);

test('notation tells quiet moves and capture chains apart', () => {
  const quiet = legalMoves(initialPosition()).find((m) => m.from === 32 && m.to === 28);
  assert.equal(moveNotation(quiet), '32-28');

  const [chain] = legalMoves(positionFrom({ 33: 'w', 29: 'b', 19: 'b' }, 'white'));
  assert.equal(moveNotation(chain), '33x24x13');
});

test('two landing squares for the same king stay distinct moves', () => {
  // If notation collapsed to "46x5" the two moves would be indistinguishable,
  // and Jev's answer could no longer be mapped back.
  const moves = legalMoves(positionFrom({ 46: 'W', 23: 'b', 10: 'b' }, 'white'));
  const notations = moves.map(moveNotation);

  assert.equal(new Set(notations).size, notations.length);
  assert.deepEqual(notations.sort(), ['46x14x5', '46x19x5']);
});

test('edge squares and distance to promotion', () => {
  assert.equal(isEdgeSquare(46), true);  // file 0
  assert.equal(isEdgeSquare(5), true);   // file 9
  assert.equal(isEdgeSquare(33), false);

  assert.equal(rowsToPromotion(46, 'white'), 9);
  assert.equal(rowsToPromotion(6, 'white'), 1);
  assert.equal(rowsToPromotion(45, 'black'), 1);
});

test('the text board is rendered from Jev\'s point of view', () => {
  const lines = renderBoard(initialPosition(), 'black').split('\n');

  assert.equal(lines.length, 10);
  assert.ok(lines[0].includes(' 1o'), 'Black is Jev, so its men are "o"');
  assert.ok(lines[6].includes('31x'), 'White is the opponent, so "x"');
  assert.ok(/^\s*21\.\s+22\./.test(lines[4]), 'rank 5 is empty');
});

test('piecesOf keeps men and kings apart', () => {
  const s = positionFrom({ 46: 'W', 33: 'w', 1: 'b', 2: 'B' }, 'white');

  assert.deepEqual(piecesOf(s, 'white'), { men: [33], kings: [46], total: 2 });
  assert.deepEqual(piecesOf(s, 'black'), { men: [1], kings: [2], total: 2 });
});

test('every legal move gets an annotation, with all-distinct keys', () => {
  const annotated = annotateMoves(initialPosition());
  const notations = annotated.map((entry) => entry.notation);

  assert.equal(annotated.length, 9);
  assert.equal(new Set(notations).size, 9, 'Choice option keys must be unique');
  for (const entry of annotated) {
    assert.equal(entry.facts.captures, 0);
    assert.equal(typeof entry.description.mossa, 'string');
    assert.match(entry.description.bilancio_dopo_gli_scambi, /materiale|vantaggio|perdita|guadagno/);
  }
});

test('a free capture comes out ahead, and the facts say so', () => {
  const s = positionFrom({ 32: 'w', 28: 'b', 1: 'b' }, 'white');
  const [entry] = annotateMoves(s);

  assert.equal(entry.notation, '32x23');
  assert.equal(entry.facts.captures, 1);
  assert.equal(entry.facts.opponentReply, 0);
  assert.ok(entry.facts.balance >= 1, `expected at least +1, got ${entry.facts.balance}`);
  assert.match(entry.description.prese, /mangia 1 pezzo \(caselle 28\)/);
});

test('the search tells an even trade from a piece given away', () => {
  // The black man on 22 is forced to capture whatever White does.
  // After 32-27 Black takes on 31 and White retakes with 36x27: an even trade.
  // After 32-28 Black takes on 33, where no white piece reaches: a piece lost
  // for nothing. The black man on 1 is out of play and only keeps the game alive.
  const s = positionFrom({ 32: 'w', 36: 'w', 22: 'b', 1: 'b' }, 'white');
  const annotated = annotateMoves(s);

  assert.deepEqual(annotated.map((e) => e.notation).sort(), ['32-27', '32-28', '36-31']);

  const trade = byNotation(annotated, '32-27');
  const giveaway = byNotation(annotated, '32-28');

  assert.equal(trade.facts.opponentReply, 1);
  assert.equal(giveaway.facts.opponentReply, 1);
  assert.ok(giveaway.facts.balance < trade.facts.balance,
    `giving a piece away (${giveaway.facts.balance}) must be worth less than a trade (${trade.facts.balance})`);

  assert.notEqual(heuristicBest(annotated).notation, '32-28',
    'the local engine must not pick the move that loses a piece');
});

test('a move that leaves the opponent with no reply is flagged', () => {
  // Black has only the man on 5, in the corner. 15-10 plugs its one exit, and
  // the man left on 14 also stops it from capturing its way out.
  const s = positionFrom({ 14: 'w', 15: 'w', 5: 'b' }, 'white');
  const annotated = annotateMoves(s);

  assert.deepEqual(annotated.map((e) => e.notation).sort(), ['14-10', '14-9', '15-10'].sort());

  const finisher = byNotation(annotated, '15-10');
  assert.equal(finisher.facts.opponentHasNoMove, true);
  assert.match(finisher.description.risposta_avversaria, /senza mosse legali/);

  // 14-10 looks the same but frees 14: Black captures and survives.
  assert.equal(byNotation(annotated, '14-10').facts.opponentHasNoMove, false);
  assert.equal(byNotation(annotated, '14-10').facts.opponentReply, 1);

  assert.equal(heuristicBest(annotated).notation, '15-10', 'the engine must see the shut-out');
});

test('scoreMoves scores every move and loses none', () => {
  const s = initialPosition();
  const scored = scoreMoves(s, 3);

  assert.equal(scored.length, legalMoves(s).length);
  assert.ok(scored.every((entry) => Number.isFinite(entry.score)));
});
