import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY, WHITE_MAN, WHITE_KING, BLACK_MAN, BLACK_KING,
  initialPosition, positionFrom, legalMoves, applyMove, gameStatus,
  squareToRC, rcToSquare,
} from '../src/rules.js';

const asPaths = (moves) => moves.map((m) => m.path.join('-')).sort();
const findMove = (moves, path) => moves.find((m) => m.path.join('-') === path);

test('la numerazione 1-50 copre solo le caselle scure e va avanti e indietro', () => {
  assert.deepEqual(squareToRC(1), [0, 1]);
  assert.deepEqual(squareToRC(5), [0, 9]);
  assert.deepEqual(squareToRC(6), [1, 0]);
  assert.deepEqual(squareToRC(50), [9, 8]);

  for (let sq = 1; sq <= 50; sq++) {
    const [r, c] = squareToRC(sq);
    assert.equal((r + c) % 2, 1, `la casella ${sq} deve stare su una casella scura`);
    assert.equal(rcToSquare(r, c), sq);
  }

  assert.equal(rcToSquare(0, 0), 0, 'le caselle chiare non sono giocabili');
  assert.equal(rcToSquare(-1, 2), 0);
  assert.equal(rcToSquare(10, 3), 0);
});

test('la posizione iniziale ha 20 pezzi per parte e muove il bianco', () => {
  const s = initialPosition();

  for (let sq = 1; sq <= 20; sq++) assert.equal(s.board[sq], BLACK_MAN, `casella ${sq}`);
  for (let sq = 21; sq <= 30; sq++) assert.equal(s.board[sq], EMPTY, `casella ${sq}`);
  for (let sq = 31; sq <= 50; sq++) assert.equal(s.board[sq], WHITE_MAN, `casella ${sq}`);

  assert.equal(s.turn, 'white');
  assert.equal(gameStatus(s), 'playing');
});

test('dalla posizione iniziale il bianco ha esattamente 9 mosse', () => {
  const moves = legalMoves(initialPosition());
  assert.equal(moves.length, 9);
  assert.deepEqual(asPaths(moves), [
    '31-26', '31-27', '32-27', '32-28', '33-28', '33-29', '34-29', '34-30', '35-30',
  ].sort());
  assert.ok(moves.every((m) => m.captured.length === 0));
});

test('la presa e obbligatoria: le mosse tranquille spariscono', () => {
  // Il bianco in 32 mangia il nero in 28 e arriva in 23.
  // Il bianco in 35 avrebbe la mossa tranquilla 35-30, che non deve restare legale.
  const s = positionFrom({ 32: 'w', 35: 'w', 28: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['32-23']);
  assert.deepEqual(moves[0].captured, [28]);

  const after = applyMove(s, moves[0]);
  assert.equal(after.board[32], EMPTY);
  assert.equal(after.board[28], EMPTY, 'il pezzo catturato va rimosso');
  assert.equal(after.board[23], WHITE_MAN);
  assert.equal(after.turn, 'black');
});

test('la pedina cattura anche allindietro', () => {
  // Il bianco in 23 mangia verso il basso il nero in 29 e arriva in 34:
  // le pedine muovono solo in avanti ma catturano in tutte le direzioni.
  const s = positionFrom({ 23: 'w', 29: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['23-34']);
  assert.deepEqual(moves[0].captured, [29]);
});

test('regola della maggioranza: resta solo la sequenza che mangia di piu', () => {
  // Da 33 il bianco puo mangiare 28 (una presa sola) oppure 29 e poi 19 (due prese).
  // Solo 33x24x13 e legale.
  const s = positionFrom({ 33: 'w', 28: 'b', 29: 'b', 19: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.equal(moves.length, 1);
  assert.equal(moves[0].path.join('-'), '33-24-13');
  assert.deepEqual(moves[0].captured, [29, 19]);
});

test('non si puo saltare due volte lo stesso pezzo', () => {
  // Arrivata in 13, la diagonale verso il basso ripassa sopra il 19 gia catturato
  // con il 24 ormai libero: la catena deve fermarsi a due prese, non tre.
  const s = positionFrom({ 33: 'w', 28: 'b', 29: 'b', 19: 'b' }, 'white');
  const [move] = legalMoves(s);

  assert.equal(move.captured.length, 2);
  assert.equal(new Set(move.captured).size, move.captured.length, 'nessuna cattura ripetuta');

  const after = applyMove(s, move);
  assert.equal(after.board[13], WHITE_MAN);
  assert.equal(after.board[19], EMPTY);
  assert.equal(after.board[29], EMPTY);
  assert.equal(after.board[28], BLACK_MAN, 'il pezzo non toccato resta dov e');
});

test('la dama e volante: muove di quante caselle vuole sulla diagonale', () => {
  // Dama bianca in 46, angolo in basso a sinistra: una sola diagonale, tutta libera.
  const s = positionFrom({ 46: 'W', 1: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves),
    ['46-41', '46-37', '46-32', '46-28', '46-23', '46-19', '46-14', '46-10', '46-5'].sort());
  assert.ok(moves.every((m) => m.captured.length === 0));
});

test('la dama cattura a distanza e puo scegliere dove atterrare', () => {
  // Nero in 23 sulla diagonale di 46, con 19/14/10/5 liberi oltre di lui.
  const s = positionFrom({ 46: 'W', 23: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['46-19', '46-14', '46-10', '46-5'].sort());
  assert.ok(moves.every((m) => m.captured.length === 1 && m.captured[0] === 23));

  const after = applyMove(s, findMove(moves, '46-5'));
  assert.equal(after.board[5], WHITE_KING, 'la dama resta dama');
  assert.equal(after.board[23], EMPTY);
  assert.equal(after.board[46], EMPTY);
});

test('la dama non scavalca due pezzi consecutivi', () => {
  // 23 e 19 sono attaccati sulla stessa diagonale: nessuna cattura possibile,
  // restano solo le mosse tranquille fino a ridosso del 23.
  const s = positionFrom({ 46: 'W', 23: 'b', 19: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['46-41', '46-37', '46-32', '46-28'].sort());
  assert.ok(moves.every((m) => m.captured.length === 0));
});

test('il pezzo catturato resta sulla scacchiera e blocca il resto della mossa', () => {
  // 46 scavalca 23 e poi 10, arrivando in 5. Da 5 l unica diagonale torna indietro
  // sul 10 appena catturato, che e ancora li: blocca il passaggio e non si rimangia.
  const s = positionFrom({ 46: 'W', 23: 'b', 10: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['46-19-5', '46-14-5'].sort());
  for (const m of moves) {
    assert.deepEqual(m.captured, [23, 10]);
    assert.equal(m.to, 5);
  }
});

test('la pedina promuove se la mossa finisce sullultima traversa', () => {
  const s = positionFrom({ 6: 'w', 50: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['6-1']);
  assert.equal(moves[0].promotes, true);
  assert.equal(applyMove(s, moves[0]).board[1], WHITE_KING);
});

test('la pedina NON promuove se attraversa lultima traversa e prosegue', () => {
  // 13x2x11: tocca la casella 2 sull ultima traversa ma la catena continua,
  // quindi finisce in 11 ed e ancora una pedina.
  const s = positionFrom({ 13: 'w', 8: 'b', 7: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.equal(moves.length, 1);
  assert.equal(moves[0].path.join('-'), '13-2-11');
  assert.deepEqual(moves[0].captured, [8, 7]);
  assert.equal(moves[0].promotes, false);

  const after = applyMove(s, moves[0]);
  assert.equal(after.board[11], WHITE_MAN, 'resta pedina');
  assert.equal(after.board[2], EMPTY);
});

test('la pedina che chiude la catena in fondo diventa dama', () => {
  const s = positionFrom({ 12: 'w', 7: 'b', 50: 'b' }, 'white');
  const moves = legalMoves(s);

  assert.equal(moves.length, 1);
  assert.equal(moves[0].path.join('-'), '12-1');
  assert.equal(moves[0].promotes, true);
  assert.equal(applyMove(s, moves[0]).board[1], WHITE_KING);
});

test('chi non ha piu mosse ha perso', () => {
  // La pedina in 46 ha come unica uscita il 41, occupato da un nero, e dietro
  // al nero c e un altro nero in 37: non puo nemmeno mangiarlo.
  const s = positionFrom({ 46: 'w', 41: 'b', 37: 'b' }, 'white');

  assert.deepEqual(legalMoves(s), []);
  assert.equal(gameStatus(s), 'black_wins');
});

test('chi non ha piu pezzi ha perso', () => {
  assert.equal(gameStatus(positionFrom({ 20: 'b' }, 'white')), 'black_wins');
  assert.equal(gameStatus(positionFrom({ 20: 'w' }, 'black')), 'white_wins');
});

test('il nero muove verso il basso e promuove sulla traversa opposta', () => {
  const s = positionFrom({ 45: 'b', 1: 'w' }, 'black');
  const moves = legalMoves(s);

  assert.deepEqual(asPaths(moves), ['45-50']);
  assert.equal(moves[0].promotes, true);

  const after = applyMove(s, moves[0]);
  assert.equal(after.board[50], BLACK_KING);
  assert.equal(after.turn, 'white');
});

test('applyMove non modifica lo stato di partenza', () => {
  const s = initialPosition();
  const snapshot = s.board.join(',');
  applyMove(s, legalMoves(s)[0]);
  assert.equal(s.board.join(','), snapshot);
  assert.equal(s.turn, 'white');
});

test('patta per 25 mosse senza catture ne mosse di pedina', () => {
  let s = positionFrom({ 46: 'W', 1: 'B' }, 'white');
  assert.equal(s.halfmoveClock, 0);

  s = applyMove(s, findMove(legalMoves(s), '46-41'));
  assert.equal(s.halfmoveClock, 1, 'la mossa di dama non azzera il contatore');

  const forced = { ...s, halfmoveClock: 49 };
  const next = applyMove(forced, legalMoves(forced)[0]);
  assert.equal(next.halfmoveClock, 50);
  assert.equal(gameStatus(next), 'draw');
});

test('la cattura azzera il contatore della patta', () => {
  const s = { ...positionFrom({ 33: 'w', 29: 'b', 46: 'W' }, 'white'), halfmoveClock: 30 };
  const capture = legalMoves(s).find((m) => m.captured.length > 0);

  assert.ok(capture, 'la cattura deve esistere ed essere obbligatoria');
  assert.equal(applyMove(s, capture).halfmoveClock, 0);
});

test('patta per triplice ripetizione', () => {
  // Due dame su diagonali che non si incrociano: vanno avanti e indietro
  // e riportano tre volte la stessa posizione con lo stesso tratto.
  let s = positionFrom({ 46: 'W', 1: 'B' }, 'white');

  const play = (path) => {
    const move = findMove(legalMoves(s), path);
    assert.ok(move, `mossa ${path} non trovata`);
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
