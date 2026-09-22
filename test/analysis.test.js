import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialPosition, positionFrom, legalMoves } from '../src/rules.js';
import { moveNotation, renderBoard, piecesOf, isEdgeSquare, rowsToPromotion } from '../src/notation.js';
import { annotateMoves, heuristicBest, scoreMoves } from '../src/analysis.js';

const byNotation = (annotated, notation) => annotated.find((entry) => entry.notation === notation);

test('la notazione distingue mosse tranquille e catene di prese', () => {
  const quiet = legalMoves(initialPosition()).find((m) => m.from === 32 && m.to === 28);
  assert.equal(moveNotation(quiet), '32-28');

  const [chain] = legalMoves(positionFrom({ 33: 'w', 29: 'b', 19: 'b' }, 'white'));
  assert.equal(moveNotation(chain), '33x24x13');
});

test('due atterraggi diversi della stessa dama restano mosse distinte', () => {
  // Se la notazione collassasse su "46x5" le due mosse diventerebbero
  // indistinguibili, e la risposta di Jev non sarebbe piu rimappabile.
  const moves = legalMoves(positionFrom({ 46: 'W', 23: 'b', 10: 'b' }, 'white'));
  const notations = moves.map(moveNotation);

  assert.equal(new Set(notations).size, notations.length);
  assert.deepEqual(notations.sort(), ['46x14x5', '46x19x5']);
});

test('le caselle di sponda e la distanza dalla promozione', () => {
  assert.equal(isEdgeSquare(46), true);  // colonna 0
  assert.equal(isEdgeSquare(5), true);   // colonna 9
  assert.equal(isEdgeSquare(33), false);

  assert.equal(rowsToPromotion(46, 'white'), 9);
  assert.equal(rowsToPromotion(6, 'white'), 1);
  assert.equal(rowsToPromotion(45, 'black'), 1);
});

test('la scacchiera testuale mostra i pezzi dal punto di vista di Jev', () => {
  const lines = renderBoard(initialPosition(), 'black').split('\n');

  assert.equal(lines.length, 10);
  assert.ok(lines[0].includes(' 1o'), 'il nero e Jev, quindi le sue pedine sono "o"');
  assert.ok(lines[6].includes('31x'), 'il bianco e l avversario, quindi "x"');
  assert.ok(/^\s*21\.\s+22\./.test(lines[4]), 'la traversa 5 e vuota');
});

test('piecesOf separa pedine e dame', () => {
  const s = positionFrom({ 46: 'W', 33: 'w', 1: 'b', 2: 'B' }, 'white');

  assert.deepEqual(piecesOf(s, 'white'), { men: [33], kings: [46], total: 2 });
  assert.deepEqual(piecesOf(s, 'black'), { men: [1], kings: [2], total: 2 });
});

test('ogni mossa legale ha una annotazione, con chiavi tutte diverse', () => {
  const annotated = annotateMoves(initialPosition());
  const notations = annotated.map((entry) => entry.notation);

  assert.equal(annotated.length, 9);
  assert.equal(new Set(notations).size, 9, 'le chiavi della Choice devono essere univoche');
  for (const entry of annotated) {
    assert.equal(entry.facts.catture, 0);
    assert.equal(typeof entry.descrizione.mossa, 'string');
    assert.match(entry.descrizione.bilancio_dopo_gli_scambi, /materiale|vantaggio|perdita|guadagno/);
  }
});

test('una presa gratuita risulta in vantaggio, e i fatti la descrivono', () => {
  const s = positionFrom({ 32: 'w', 28: 'b', 1: 'b' }, 'white');
  const [entry] = annotateMoves(s);

  assert.equal(entry.notation, '32x23');
  assert.equal(entry.facts.catture, 1);
  assert.equal(entry.facts.rispostaAvversaria, 0);
  assert.ok(entry.facts.bilancio >= 1, `atteso almeno +1, ottenuto ${entry.facts.bilancio}`);
  assert.match(entry.descrizione.prese, /mangia 1 pezzo \(caselle 28\)/);
});

test('la ricerca vede la differenza fra uno scambio alla pari e un pezzo regalato', () => {
  // Il nero in 22 e comunque obbligato a mangiare, qualunque cosa faccia il bianco.
  // Dopo 32-27 il nero prende in 31 e il bianco riprende con 36x27: scambio alla pari.
  // Dopo 32-28 il nero prende in 33, dove nessun bianco arriva: pezzo perso per niente.
  // Il nero in 1 sta fuori dai giochi e serve solo a non far finire la partita.
  const s = positionFrom({ 32: 'w', 36: 'w', 22: 'b', 1: 'b' }, 'white');
  const annotated = annotateMoves(s);

  assert.deepEqual(annotated.map((e) => e.notation).sort(), ['32-27', '32-28', '36-31']);

  const pari = byNotation(annotated, '32-27');
  const regalo = byNotation(annotated, '32-28');

  assert.equal(pari.facts.rispostaAvversaria, 1);
  assert.equal(regalo.facts.rispostaAvversaria, 1);
  assert.ok(regalo.facts.bilancio < pari.facts.bilancio,
    `regalare un pezzo (${regalo.facts.bilancio}) deve valere meno di uno scambio (${pari.facts.bilancio})`);

  assert.notEqual(heuristicBest(annotated).notation, '32-28',
    'il motore locale non deve scegliere la mossa che perde un pezzo');
});

test('la mossa che lascia lavversario senza mosse viene segnalata', () => {
  // Il nero ha solo la pedina in 5, nell angolo. Con 15-10 il bianco le tappa
  // l unica uscita, e il 14 che resta fermo le impedisce anche di mangiare.
  const s = positionFrom({ 14: 'w', 15: 'w', 5: 'b' }, 'white');
  const annotated = annotateMoves(s);

  assert.deepEqual(annotated.map((e) => e.notation).sort(), ['14-10', '14-9', '15-10'].sort());

  const finisher = byNotation(annotated, '15-10');
  assert.equal(finisher.facts.avversarioSenzaMosse, true);
  assert.match(finisher.descrizione.risposta_avversaria, /senza mosse legali/);

  // 14-10 sembra uguale ma libera il 14: il nero mangia e sopravvive.
  assert.equal(byNotation(annotated, '14-10').facts.avversarioSenzaMosse, false);
  assert.equal(byNotation(annotated, '14-10').facts.rispostaAvversaria, 1);

  assert.equal(heuristicBest(annotated).notation, '15-10', 'il motore deve vedere la chiusura');
});

test('scoreMoves assegna un punteggio a ogni mossa e non ne perde nessuna', () => {
  const s = initialPosition();
  const scored = scoreMoves(s, 3);

  assert.equal(scored.length, legalMoves(s).length);
  assert.ok(scored.every((entry) => Number.isFinite(entry.score)));
});
