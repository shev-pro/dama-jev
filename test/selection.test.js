import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialPosition, positionFrom, legalMoves } from '../src/rules.js';
import { createSelection, selectionTargets, selectionHead, advanceSelection } from '../src/selection.js';

test('selezionare una casella vuota o bloccata non apre niente', () => {
  const moves = legalMoves(initialPosition());
  assert.equal(createSelection(moves, 23), null, 'casella vuota');
  assert.equal(createSelection(moves, 40), null, 'pedina murata dietro le proprie');
  assert.equal(selectionTargets(null).length, 0);
});

test('una mossa tranquilla si chiude al primo click sulla destinazione', () => {
  const moves = legalMoves(initialPosition());
  const selezione = createSelection(moves, 32);

  assert.equal(selectionHead(selezione), 32);
  assert.deepEqual(selectionTargets(selezione).sort(), [27, 28]);

  const { selection, move } = advanceSelection(selezione, 28);
  assert.equal(selection, null, 'la selezione si chiude');
  assert.equal(move.from, 32);
  assert.equal(move.to, 28);
});

test('un click fuori bersaglio non fa niente', () => {
  const selezione = createSelection(legalMoves(initialPosition()), 32);
  const risultato = advanceSelection(selezione, 19);

  assert.equal(risultato.move, null);
  assert.equal(risultato.selection, selezione, 'la selezione resta quella di prima');
});

test('la catena si percorre un salto alla volta', () => {
  // 33x24x13: due salti, quindi due click dopo la selezione del pezzo.
  const moves = legalMoves(positionFrom({ 33: 'w', 29: 'b', 19: 'b' }, 'white'));
  let selezione = createSelection(moves, 33);

  assert.deepEqual(selectionTargets(selezione), [24]);

  let passo = advanceSelection(selezione, 24);
  assert.equal(passo.move, null, 'la catena non e ancora finita');
  selezione = passo.selection;

  assert.equal(selectionHead(selezione), 24);
  assert.deepEqual(selectionTargets(selezione), [13]);

  passo = advanceSelection(selezione, 13);
  assert.equal(passo.selection, null);
  assert.deepEqual(passo.move.captured, [29, 19]);
});

test('due catene con la stessa partenza e lo stesso arrivo si distinguono dal salto di mezzo', () => {
  // 46x19x5 e 46x14x5 mangiano gli stessi pezzi e finiscono sulla stessa casella:
  // scegliendo partenza e arrivo sarebbero indistinguibili.
  const moves = legalMoves(positionFrom({ 46: 'W', 23: 'b', 10: 'b' }, 'white'));
  const selezione = createSelection(moves, 46);

  assert.equal(moves.length, 2);
  assert.deepEqual(selectionTargets(selezione).sort((a, b) => a - b), [14, 19]);

  const viaQuattordici = advanceSelection(selezione, 14);
  assert.deepEqual(selectionTargets(viaQuattordici.selection), [5]);
  assert.deepEqual(advanceSelection(viaQuattordici.selection, 5).move.path, [46, 14, 5]);

  const viaDiciannove = advanceSelection(selezione, 19);
  assert.deepEqual(advanceSelection(viaDiciannove.selection, 5).move.path, [46, 19, 5]);
});

test('con la presa obbligatoria i pezzi che non mangiano non si selezionano', () => {
  const moves = legalMoves(positionFrom({ 32: 'w', 35: 'w', 28: 'b' }, 'white'));

  assert.ok(createSelection(moves, 32), 'il pezzo che mangia si seleziona');
  assert.equal(createSelection(moves, 35), null, 'il pezzo che non mangia no');
});
