import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialPosition, positionFrom, applyMove, legalMoves } from '../server/rules.js';
import { annotateMoves } from '../server/analysis.js';
import { buildRequest, interpret, askJev, JevError, MODEL, MAX_OPTIONS, UPSTREAM } from '../server/jev.js';

/** A position with Black (Jev) to move and more than one option. */
function jevToMove() {
  const start = initialPosition();
  const state = applyMove(start, legalMoves(start).find((m) => m.from === 32 && m.to === 28));
  return { state, annotated: annotateMoves(state) };
}

test('the request has the shape the System One contract asks for', () => {
  const { state, annotated } = jevToMove();
  const { request, candidates } = buildRequest({ state, annotated, jevColor: 'black', lastOpponentMove: '32-28' });

  assert.equal(request.model, MODEL);
  assert.deepEqual(Object.keys(request.questions).sort(), ['move', 'posture', 'risk']);
  assert.equal(request.questions.move.type, 'choice');
  assert.equal(request.questions.posture.type, 'choice');
  assert.equal(request.questions.risk.type, 'score');

  // Score wants an ordered array of levels, between 2 and 10 of them.
  assert.ok(Array.isArray(request.questions.risk.criteria));
  assert.ok(request.questions.risk.criteria.length >= 2 && request.questions.risk.criteria.length <= 10);

  // Choice wants a map of option -> description, at most 255 entries.
  const criteria = request.questions.move.criteria;
  assert.equal(typeof criteria, 'object');
  assert.ok(!Array.isArray(criteria));
  assert.ok(Object.keys(criteria).length <= 255);
  assert.equal(Object.keys(criteria).length, candidates.length);
  assert.ok(MAX_OPTIONS <= 255);
});

test('the Choice keys are exactly Jev\'s legal moves', () => {
  const { state, annotated } = jevToMove();
  const { request } = buildRequest({ state, annotated, jevColor: 'black' });

  assert.deepEqual(
    Object.keys(request.questions.move.criteria).sort(),
    annotated.map((entry) => entry.notation).sort(),
  );
});

test('the state hands over the counts already done, because Jev does not count', () => {
  const { state, annotated } = jevToMove();
  const { request } = buildRequest({ state, annotated, jevColor: 'black', lastOpponentMove: '32-28' });

  assert.equal(request.state.materiale.tuo, 20);
  assert.equal(request.state.materiale.avversario, 20);
  assert.equal(request.state.materiale.differenza, 0);
  assert.equal(request.state.tuoi_pezzi.totale, 20);
  assert.equal(request.state.fase, 'apertura');
  assert.equal(request.state.ultima_mossa_avversario, '32-28');
  assert.equal(request.state.scacchiera.split('\n').length, 10);
});

test('interpret maps Jev\'s choice back onto the real move', () => {
  const { state, annotated } = jevToMove();
  const { candidates } = buildRequest({ state, annotated, jevColor: 'black' });
  const target = candidates[2];

  const probabilities = Object.fromEntries(candidates.map((c) => [c.notation, 0]));
  probabilities[target.notation] = 1;

  const result = interpret({
    model: 'jev-1.13.0',
    answers: {
      move: { type: 'choice', choice: target.notation, probabilities, confidence: 0.77 },
      posture: { type: 'choice', choice: 'consolidamento', probabilities: { consolidamento: 0.6 }, confidence: 0.4 },
      risk: { type: 'score', score: 1.2, legend: { 0: 'x' }, probabilities: { 0: 0.4 }, confidence: 0.3 },
    },
    usage: { input_tokens: 900, output_tokens: 12 },
  }, candidates);

  assert.equal(result.entry.notation, target.notation);
  assert.equal(result.entry.move, target.move);
  assert.equal(result.confidence, 0.77);
  assert.equal(result.posture.choice, 'consolidamento');
  assert.equal(result.risk.score, 1.2);
  assert.equal(result.usage.input_tokens, 900);
  assert.equal(result.note, null);

  // The ranking covers every candidate, most probable first.
  assert.equal(result.ranking.length, candidates.length);
  assert.equal(result.ranking[0].notation, target.notation);
  assert.equal(result.ranking[0].chosen, true);
  assert.ok(result.ranking.every((row, i, all) => i === 0 || all[i - 1].probability >= row.probability));
});

test('an answer naming no legal move falls back to the most probable valid one, and says so', () => {
  const { state, annotated } = jevToMove();
  const { candidates } = buildRequest({ state, annotated, jevColor: 'black' });

  const probabilities = Object.fromEntries(candidates.map((c) => [c.notation, 0.01]));
  probabilities[candidates[1].notation] = 0.9;

  const result = interpret({
    answers: { move: { type: 'choice', choice: '99-99', probabilities, confidence: 0.5 } },
  }, candidates);

  assert.equal(result.entry.notation, candidates[1].notation);
  assert.match(result.note, /non e fra le mosse legali/);
});

test('when no valid move can be recovered it raises instead of inventing one', () => {
  const { state, annotated } = jevToMove();
  const { candidates } = buildRequest({ state, annotated, jevColor: 'black' });

  assert.throws(
    () => interpret({ answers: { move: { type: 'choice', choice: '99-99', probabilities: { '98-98': 1 } } } }, candidates),
    JevError,
  );
  assert.throws(() => interpret({ answers: {} }, candidates), JevError);
});

test('askJev sends the key in the header and measures latency', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'jev-1.13.0', answers: {}, usage: {} }) };
  };

  const { body, latencyMs } = await askJev({ apiKey: 'test-key', request: { model: MODEL }, fetchImpl });

  assert.equal(seen.url, UPSTREAM, 'the server calls TypeSafe directly; there is no forwarding endpoint any more');
  assert.equal(seen.init.headers.Authorization, 'Bearer test-key');
  assert.equal(JSON.parse(seen.init.body).model, MODEL);
  assert.equal(body.model, 'jev-1.13.0');
  assert.ok(Number.isFinite(latencyMs));
});

test('askJev reports TypeSafe\'s real message on errors', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ detail: { error_type: 'authentication_error', message: 'Must supply an API key!' } }),
  });

  await assert.rejects(
    () => askJev({ apiKey: 'wrong', request: {}, fetchImpl }),
    (error) => {
      assert.ok(error instanceof JevError);
      assert.equal(error.status, 401);
      assert.equal(error.type, 'authentication_error');
      assert.equal(error.message, 'Must supply an API key!');
      return true;
    },
  );
});

test('a position with a single legal move needs no call to Jev', () => {
  // One compulsory capture: there is nothing to choose, so the call is skipped.
  const state = positionFrom({ 32: 'w', 28: 'b', 1: 'b' }, 'white');
  assert.equal(annotateMoves(state).length, 1);
});
