import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WHITE_MAN, WHITE_KING, BLACK_KING,
  initialPosition, positionFrom, legalMoves, applyMove, geometryOf, variantOf,
} from '../server/rules.js';
import { VARIANTS } from '../server/variants.js';

const notations = (moves) => moves.map((m) => m.path.join('-')).sort();

test('each variant sets up its own board and its own first player', () => {
  const international = initialPosition('international');
  assert.equal(international.board.length - 1, 50);
  assert.equal(international.turn, 'white');

  const english = initialPosition('english');
  assert.equal(english.board.length - 1, 32);
  // WCDF rule 1.13: the player with the Red men moves first, and they are the
  // ones on squares 1-12, which here is Jev's side.
  assert.equal(english.turn, 'black');

  const italian = initialPosition('italian');
  assert.equal(italian.board.length - 1, 32);
  // FID art. 1.1.3.4: White moves first.
  assert.equal(italian.turn, 'white');
});

test('the italian board is mirrored, as the regulation requires', () => {
  // FID art. 1.1.2.3 puts a dark square at each player's bottom right, which
  // mirrors the whole numbering against the English board. Art. 1.1.2.8 names
  // the landmarks that pin it down, and they are the check.
  const italian = geometryOf(variantOf('italian'));

  for (const square of [1, 9, 17, 25]) {
    assert.equal(italian.squareToRC(square)[1], 0, `square ${square} is on the left edge`);
  }
  for (const square of [8, 16, 24, 32]) {
    assert.equal(italian.squareToRC(square)[1], 7, `square ${square} is on the right edge`);
  }
  for (const square of [1, 5, 10, 14, 19, 23, 28, 32]) {
    const [row, col] = italian.squareToRC(square);
    assert.equal(row, col, `square ${square} is on the main diagonal`);
  }
  assert.deepEqual(italian.squareToRC(32), [7, 7], 'square 32 is the bottom-right corner');

  // The English board is the other way round: bottom left is dark.
  const english = geometryOf(variantOf('english'));
  assert.deepEqual(english.squareToRC(29), [7, 0]);
});

test('the mirrored board changes which moves exist from a given square', () => {
  // Square 21 is one file in on the Italian board and hard against the edge on
  // the English one, so it has two ways forward in one game and one in the
  // other. Same numbering rule, different board.
  const italian = legalMoves(positionFrom({ 21: 'w', 1: 'b' }, 'white', 'italian'));
  assert.deepEqual(notations(italian), ['21-17', '21-18']);

  const english = legalMoves(positionFrom({ 21: 'w', 1: 'b' }, 'white', 'english'));
  assert.deepEqual(notations(english), ['21-17']);
});

test('english: capture is compulsory but never forced to be the longest', () => {
  // WCDF 1.20: "If there are two or more ways to jump, a player may select any
  // one that they wish, not necessarily that which gains the most pieces."
  // From 22 White can take one piece, or two by the other diagonal.
  const state = positionFrom({ 22: 'w', 18: 'b', 17: 'b', 10: 'b' }, 'white', 'english');
  const moves = legalMoves(state);

  assert.ok(moves.every((move) => move.captured.length > 0), 'quiet moves are gone');
  assert.ok(moves.some((move) => move.captured.length === 1), 'the short capture stays legal');
  assert.ok(moves.some((move) => move.captured.length === 2), 'the long one is available too');
});

test('italian: the longest capture is compulsory', () => {
  // The same shape of position under FID art. 1.1.6.6 leaves only the longest.
  const state = positionFrom({ 23: 'w', 18: 'b', 19: 'b', 11: 'b' }, 'white', 'italian');
  const moves = legalMoves(state);

  const longest = Math.max(...moves.map((move) => move.captured.length));
  assert.ok(longest >= 2, 'the position must actually offer a double capture');
  assert.ok(moves.every((move) => move.captured.length === longest), 'shorter captures are illegal');
});

test('italian: a man may not capture a king, an english man may', () => {
  // FID art. 1.1.5.3 b): "una pedina prende solo pedine e non dame".
  const pieces = { 22: 'w', 18: 'B', 30: 'b' };

  const italian = legalMoves(positionFrom(pieces, 'white', 'italian'));
  assert.ok(italian.every((move) => move.captured.length === 0),
    'the white man must not be allowed to jump the black king');

  // WCDF 1.18 lets an English man jump "an opponent's piece (man or king)".
  const english = legalMoves(positionFrom(pieces, 'white', 'english'));
  assert.ok(english.some((move) => move.captured.includes(18)),
    'the english man must be able to jump the king');
});

test('italian: a king capturing outranks a man capturing', () => {
  // FID art. 1.1.6.7: at equal numbers, you must capture with the piece of
  // greater value. Here the man on 24 can take the man on 20, and the king on
  // 25 can take the man on 21 - one piece each, so the king must be the one to
  // do it. The lone black man on 1 only keeps the game alive.
  const state = positionFrom({ 24: 'w', 25: 'W', 20: 'b', 21: 'b', 1: 'b' }, 'white', 'italian');
  const moves = legalMoves(state);

  assert.ok(moves.length > 0, 'the position must offer a capture at all');
  assert.ok(moves.every((move) => move.captured.length === 1), 'both captures take one piece');
  assert.ok(moves.every((move) => move.piece === WHITE_KING),
    'only the king may do the capturing when both could take the same number');
  assert.ok(moves.every((move) => move.captured.includes(21)));

  // Without the priority rule the man's capture would be legal too: English
  // draughts, which has no such rule, keeps both.
  const english = legalMoves(positionFrom({ 24: 'w', 25: 'W', 20: 'b', 21: 'b', 1: 'b' }, 'white', 'english'));
  assert.ok(english.some((move) => move.piece === WHITE_MAN),
    'the english game lets the man capture instead');
});

test('short kings do not fly in the 8x8 variants', () => {
  for (const variant of ['english', 'italian']) {
    const moves = legalMoves(positionFrom({ 15: 'W', 1: 'b' }, 'white', variant));
    assert.ok(moves.length > 0, `${variant}: the king must have moves`);
    assert.ok(moves.every((move) => move.path.length === 2), `${variant}: one hop only`);

    // Every destination is a direct neighbour of the origin.
    const geometry = geometryOf(variantOf(variant));
    const [row, col] = geometry.squareToRC(15);
    const neighbours = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
      .map(([dr, dc]) => geometry.rcToSquare(row + dr, col + dc))
      .filter(Boolean);
    assert.deepEqual(moves.map((m) => m.to).sort(), neighbours.sort());
  }

  // The international king still flies.
  const flying = legalMoves(positionFrom({ 46: 'W', 1: 'b' }, 'white', 'international'));
  assert.ok(flying.length > 4, 'a flying king reaches far more than its neighbours');
});

test('a man that reaches the last rank by capturing is crowned there and stops', () => {
  for (const variant of ['english', 'italian']) {
    const geometry = geometryOf(variantOf(variant));
    const moves = legalMoves(positionFrom({ 10: 'w', 6: 'b', 32: 'B' }, 'white', variant));
    const crowning = moves.filter((move) => move.promotes);

    assert.ok(crowning.length > 0, `${variant}: the position must offer a promoting capture`);
    for (const move of crowning) {
      assert.equal(geometry.squareToRC(move.to)[0], 0, `${variant}: it ends on the last rank`);
      assert.equal(move.captured.length, 1, `${variant}: the chain stops at the crown`);
      assert.equal(applyMove(positionFrom({ 10: 'w', 6: 'b', 32: 'B' }, 'white', variant), move).board[move.to],
        WHITE_KING, `${variant}: and it really becomes a king`);
    }
  }
});

test('international: a man crosses the last rank mid-chain without promoting', () => {
  // The rule the 8x8 variants reverse. 13x2x11 touches the far rank and carries
  // on, so it ends as a man.
  const [move] = legalMoves(positionFrom({ 13: 'w', 8: 'b', 7: 'b' }, 'white', 'international'));
  assert.equal(move.path.join('-'), '13-2-11');
  assert.equal(move.promotes, false);
  assert.equal(applyMove(positionFrom({ 13: 'w', 8: 'b', 7: 'b' }, 'white'), move).board[11], WHITE_MAN);
});

test('every variant declares the fields the engine reads', () => {
  for (const variant of Object.values(VARIANTS)) {
    for (const field of [
      'id', 'name', 'size', 'pieceRows', 'boardParity', 'menCaptureBackwards', 'flyingKings',
      'captureChoice', 'menCanCaptureKings', 'promotionEndsMove', 'firstPlayer',
      'drawPlyLimit', 'kingValue', 'promptRules',
    ]) {
      assert.ok(variant[field] !== undefined, `${variant.id} is missing ${field}`);
    }
    assert.ok(['maximum', 'free', 'italian'].includes(variant.captureChoice));
    // The prompt has to describe the variant actually being played, or the
    // model is being told the rules of a different game.
    assert.ok(variant.promptRules.length > 80, `${variant.id} needs a real rules note for the prompt`);
  }
});

test('black kings are recognised on both board parities', () => {
  for (const variant of ['english', 'italian', 'international']) {
    const state = positionFrom({ 5: 'B' }, 'black', variant);
    assert.equal(state.board[5], BLACK_KING);
    assert.ok(legalMoves(state).length > 0);
  }
});
