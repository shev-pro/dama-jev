import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY, WHITE_MAN, WHITE_KING, BLACK_MAN, BLACK_KING,
  initialPosition, positionFrom, legalMoves, applyMove, gameStatus,
  squareToRC, rcToSquare,
} from '../src/rules.js';

const asPaths = (moves) => moves.map((m) => m.path.join('-')).sort();
const findMove = (moves, path) => moves.find((m) => m.path.join('-') === path);

test('the 1-50 numbering covers only dark squares and round-trips', () => {
  assert.deepEqual(squareToRC(1), [0, 1]);
  assert.deepEqual(squareToRC(5), [0, 9]);
  assert.deepEqual(squareToRC(6), [1, 0]);
  assert.deepEqual(squareToRC(50), [9, 8]);

  for (let sq = 1; sq <= 50; sq++) {
    const [r, c] = squareToRC(sq);
    assert.equal((r + c) % 2, 1, `square ${sq} must sit on a dark square`);
    assert.equal(rcToSquare(r, c), sq);
  }

  assert.equal(rcToSquare(0, 0), 0, 'light squares are not playable');
  assert.equal(rcToSquare(-1, 2), 0);
  assert.equal(rcToSquare(10, 3), 0);
});

test('the opening position has 20 pieces a side and White to move', () => {
  const s = initialPosition();

  for (let sq = 1; sq <= 20; sq++) assert.equal(s.board[sq], BLACK_MAN, `square ${sq}`);
  for (let sq = 21; sq <= 30; sq++) assert.equal(s.board[sq], EMPTY, `square ${sq}`);
  for (let sq = 31; sq <= 50; sq++) assert.equal(s.board[sq], WHITE_MAN, `square ${sq}`);

  assert.equal(s.turn, 'white');
  assert.equal(gameStatus(s), 'playing');
});

test('White has exactly 9 opening moves', () => {
  const moves = legalMoves(initialPosition());
  assert.equal(moves.length, 9);
  assert.deepEqual(asPaths(moves), [
    '31-26', '31-27', '32-27', '32-28', '33-28', '33-29', '34-29', '34-30', '35-30',
  ].sort());
  assert.ok(moves.every((m) => m.captured.length === 0));
});

test('capture is compulsory: quiet moves disappear', () => {
  // White on 32 takes the black man on 28 and lands on 23.
  // White on 35 would have the quiet move 35-30, which must not stay legal.
  const s = positionFrom({ 32: 'w', 35: 'w', 28: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['32-23']);
  assert.deepEqual(moves[0].captured, [28]);

  const after = applyMove(s, moves[0]);
  assert.equal(after.board[32], EMPTY);
  assert.equal(after.board[28], EMPTY, 'the captured piece must be removed');
  assert.equal(after.board[23], WHITE_MAN);
  assert.equal(after.turn, 'black');
});

test('a man captures backwards too', () => {
  // White on 23 takes downwards the black man on 29 and lands on 34: men move
  // forwards only, but they capture in every direction.
  const s = positionFrom({ 23: 'w', 29: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['23-34']);
  assert.deepEqual(moves[0].captured, [29]);
});

test('majority rule: only the longest capture survives', () => {
  // From 33 White can take 28 (one piece) or 29 and then 19 (two pieces).
  // Only 33x24x13 is legal.
  const s = positionFrom({ 33: 'w', 28: 'b', 29: 'b', 19: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.equal(moves.length, 1);
  assert.equal(moves[0].path.join('-'), '33-24-13');
  assert.deepEqual(moves[0].captured, [29, 19]);
});

test('the same piece cannot be jumped twice', () => {
  // Having landed on 13, the diagonal downwards passes back over the already
  // captured 19 with 24 now free: the chain must stop at two, not three.
  const s = positionFrom({ 33: 'w', 28: 'b', 29: 'b', 19: 'b' }, 'white');
  const [move] = legalMoves(s);

  assert.equal(move.captured.length, 2);
  assert.equal(new Set(move.captured).size, move.captured.length, 'no repeated capture');

  const after = applyMove(s, move);
  assert.equal(after.board[13], WHITE_MAN);
  assert.equal(after.board[19], EMPTY);
  assert.equal(after.board[29], EMPTY);
  assert.equal(after.board[28], BLACK_MAN, 'the untouched piece stays put');
});

test('a king flies: it moves as far as it likes along the diagonal', () => {
  // White king on 46, bottom-left corner: a single diagonal, entirely free.
  const s = positionFrom({ 46: 'W', 1: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves),
    ['46-41', '46-37', '46-32', '46-28', '46-23', '46-19', '46-14', '46-10', '46-5'].sort());
  assert.ok(moves.every((m) => m.captured.length === 0));
});

test('a king captures at a distance and may choose where to land', () => {
  // Black on 23 sits on the diagonal of 46, with 19/14/10/5 free beyond it.
  const s = positionFrom({ 46: 'W', 23: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['46-19', '46-14', '46-10', '46-5'].sort());
  assert.ok(moves.every((m) => m.captured.length === 1 && m.captured[0] === 23));

  const after = applyMove(s, findMove(moves, '46-5'));
  assert.equal(after.board[5], WHITE_KING, 'a king stays a king');
  assert.equal(after.board[23], EMPTY);
  assert.equal(after.board[46], EMPTY);
});

test('a king cannot jump two pieces standing together', () => {
  // 23 and 19 are adjacent on the same diagonal: no capture is possible, only
  // the quiet moves up to just short of 23 remain.
  const s = positionFrom({ 46: 'W', 23: 'b', 19: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['46-41', '46-37', '46-32', '46-28'].sort());
  assert.ok(moves.every((m) => m.captured.length === 0));
});

test('a captured piece stays on the board and blocks the rest of the move', () => {
  // 46 jumps 23 and then 10, landing on 5. From 5 the only diagonal runs back
  // over the freshly captured 10, which is still there: it blocks the way and
  // cannot be taken again.
  const s = positionFrom({ 46: 'W', 23: 'b', 10: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['46-19-5', '46-14-5'].sort());
  for (const m of moves) {
    assert.deepEqual(m.captured, [23, 10]);
    assert.equal(m.to, 5);
  }
});

test('a man promotes if the move ends on the far rank', () => {
  const s = positionFrom({ 6: 'w', 50: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['6-1']);
  assert.equal(moves[0].promotes, true);
  assert.equal(applyMove(s, moves[0]).board[1], WHITE_KING);
});

test('a man does NOT promote when it crosses the far rank and carries on', () => {
  // 13x2x11 touches square 2 on the far rank but the chain continues, so it
  // ends on 11 and is still a man.
  const s = positionFrom({ 13: 'w', 8: 'b', 7: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.equal(moves.length, 1);
  assert.equal(moves[0].path.join('-'), '13-2-11');
  assert.deepEqual(moves[0].captured, [8, 7]);
  assert.equal(moves[0].promotes, false);

  const after = applyMove(s, moves[0]);
  assert.equal(after.board[11], WHITE_MAN, 'still a man');
  assert.equal(after.board[2], EMPTY);
});

test('a man that ends its chain on the far rank becomes a king', () => {
  const s = positionFrom({ 12: 'w', 7: 'b', 50: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.equal(moves.length, 1);
  assert.equal(moves[0].path.join('-'), '12-1');
  assert.equal(moves[0].promotes, true);
  assert.equal(applyMove(s, moves[0]).board[1], WHITE_KING);
});

test('running out of moves loses the game', () => {
  // The man on 46 has 41 as its only exit, occupied by a black man, and behind
  // that black man sits another on 37: it cannot even capture it.
  const s = positionFrom({ 46: 'w', 41: 'b', 37: 'b' }, 'white');

  assert.deepEqual(legalMoves(s), []);
  assert.equal(gameStatus(s), 'black_wins');
});

test('running out of pieces loses the game', () => {
  assert.equal(gameStatus(positionFrom({ 20: 'b' }, 'white')), 'black_wins');
  assert.equal(gameStatus(positionFrom({ 20: 'w' }, 'black')), 'white_wins');
});

test('Black moves downwards and promotes on the opposite rank', () => {
  const s = positionFrom({ 45: 'b', 1: 'w' }, 'black');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['45-50']);
  assert.equal(moves[0].promotes, true);

  const after = applyMove(s, moves[0]);
  assert.equal(after.board[50], BLACK_KING);
  assert.equal(after.turn, 'white');
});

test('applyMove does not mutate the state it was given', () => {
  const s = initialPosition();
  const snapshot = s.board.join(',');
  applyMove(s, legalMoves(s)[0]);
  assert.equal(s.board.join(','), snapshot);
  assert.equal(s.turn, 'white');
});

test('draw after 25 moves a side without a capture or a man move', () => {
  let s = positionFrom({ 46: 'W', 1: 'B' }, 'white');
  assert.equal(s.halfmoveClock, 0);

  s = applyMove(s, findMove(legalMoves(s), '46-41'));
  assert.equal(s.halfmoveClock, 1, 'a king move does not reset the counter');

  const forced = { ...s, halfmoveClock: 49 };
  const next = applyMove(forced, legalMoves(forced)[0]);
  assert.equal(next.halfmoveClock, 50);
  assert.equal(gameStatus(next), 'draw');
});

test('a capture resets the draw counter', () => {
  const s = { ...positionFrom({ 33: 'w', 29: 'b', 46: 'W' }, 'white'), halfmoveClock: 30 };
  const capture = legalMoves(s).find((m) => m.captured.length > 0);

  assert.ok(capture, 'the capture must exist and be compulsory');
  assert.equal(applyMove(s, capture).halfmoveClock, 0);
});

test('draw by threefold repetition', () => {
  // Two kings on diagonals that never cross: they shuffle back and forth and
  // bring the same position back three times with the same side to move.
  let s = positionFrom({ 46: 'W', 1: 'B' }, 'white');

  const play = (path) => {
    const move = findMove(legalMoves(s), path);
    assert.ok(move, `move ${path} not found`);
    s = applyMove(s, move);
  };

  for (let i = 0; i < 2; i++) {
    play('46-41');
    play('1-6');
    play('41-46');
    play('6-1');
  }

  assert.equal(gameStatus(s), 'draw');
});
