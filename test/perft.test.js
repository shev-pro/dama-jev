import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialPosition, legalMoves, applyMove } from '../src/rules.js';

/**
 * Conta le posizioni raggiungibili in `depth` mezze mosse.
 *
 * E la verifica piu severa che si possa fare su un generatore di mosse: un
 * solo caso sbagliato — una cattura di troppo, una sequenza non massimale, una
 * dama che scavalca dove non deve — sposta il totale e il confronto salta.
 * I valori attesi sono quelli pubblicati per la dama internazionale 10x10.
 */
function perft(state, depth) {
  const moves = legalMoves(state);
  if (depth === 1) return moves.length;

  let totale = 0;
  for (const move of moves) totale += perft(applyMove(state, move), depth - 1);
  return totale;
}

const ATTESI = [9, 81, 658, 4265, 27117, 167140, 1049442];

for (const [i, atteso] of ATTESI.entries()) {
  const depth = i + 1;
  test(`perft(${depth}) dalla posizione iniziale = ${atteso}`, () => {
    assert.equal(perft(initialPosition(), depth), atteso);
  });
}
