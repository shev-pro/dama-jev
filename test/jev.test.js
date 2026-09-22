import { test } from 'node:test';
import assert from 'node:assert/strict';

import { initialPosition, positionFrom, applyMove, legalMoves } from '../src/rules.js';
import { annotateMoves } from '../src/analysis.js';
import { buildRequest, interpret, askJev, JevError, MODEL, MAX_OPTIONS } from '../src/jev.js';

/** Una posizione con il nero (Jev) al tratto e piu di una mossa possibile. */
function jevToMove() {
  const start = initialPosition();
  const state = applyMove(start, legalMoves(start).find((m) => m.from === 32 && m.to === 28));
  return { state, annotated: annotateMoves(state) };
}

test('la richiesta ha la forma che vuole il contratto System One', () => {
  const { state, annotated } = jevToMove();
  const { request, candidates } = buildRequest({ state, annotated, jevColor: 'black', lastOpponentMove: '32-28' });

  assert.equal(request.model, MODEL);
  assert.deepEqual(Object.keys(request.questions).sort(), ['mossa', 'postura', 'rischio']);
  assert.equal(request.questions.mossa.type, 'choice');
  assert.equal(request.questions.postura.type, 'choice');
  assert.equal(request.questions.rischio.type, 'score');

  // Score vuole un array ordinato di livelli, fra 2 e 10.
  assert.ok(Array.isArray(request.questions.rischio.criteria));
  assert.ok(request.questions.rischio.criteria.length >= 2 && request.questions.rischio.criteria.length <= 10);

  // Choice vuole una mappa opzione -> descrizione, al massimo 255 voci.
  const criteria = request.questions.mossa.criteria;
  assert.equal(typeof criteria, 'object');
  assert.ok(!Array.isArray(criteria));
  assert.ok(Object.keys(criteria).length <= 255);
  assert.equal(Object.keys(criteria).length, candidates.length);
  assert.ok(MAX_OPTIONS <= 255);
});

test('le chiavi della Choice sono esattamente le mosse legali di Jev', () => {
  const { state, annotated } = jevToMove();
  const { request } = buildRequest({ state, annotated, jevColor: 'black' });

  assert.deepEqual(
    Object.keys(request.questions.mossa.criteria).sort(),
    annotated.map((entry) => entry.notation).sort(),
  );
});

test('lo stato consegna i conteggi gia fatti, perche Jev non conta', () => {
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

test('interpret rimappa la scelta di Jev sulla mossa vera', () => {
  const { state, annotated } = jevToMove();
  const { candidates } = buildRequest({ state, annotated, jevColor: 'black' });
  const target = candidates[2];

  const probabilities = Object.fromEntries(candidates.map((c) => [c.notation, 0]));
  probabilities[target.notation] = 1;

  const result = interpret({
    model: 'jev-1.13.0',
    answers: {
      mossa: { type: 'choice', choice: target.notation, probabilities, confidence: 0.77 },
      postura: { type: 'choice', choice: 'consolidamento', probabilities: { consolidamento: 0.6 }, confidence: 0.4 },
      rischio: { type: 'score', score: 1.2, legend: { 0: 'x' }, probabilities: { 0: 0.4 }, confidence: 0.3 },
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

  // Il ranking copre ogni candidata, ordinato dal piu probabile.
  assert.equal(result.ranking.length, candidates.length);
  assert.equal(result.ranking[0].notation, target.notation);
  assert.equal(result.ranking[0].chosen, true);
  assert.ok(result.ranking.every((row, i, all) => i === 0 || all[i - 1].probability >= row.probability));
});

test('se Jev risponde una mossa inesistente si ripiega sulla piu probabile valida, dicendolo', () => {
  const { state, annotated } = jevToMove();
  const { candidates } = buildRequest({ state, annotated, jevColor: 'black' });

  const probabilities = Object.fromEntries(candidates.map((c) => [c.notation, 0.01]));
  probabilities[candidates[1].notation] = 0.9;

  const result = interpret({
    answers: { mossa: { type: 'choice', choice: '99-99', probabilities, confidence: 0.5 } },
  }, candidates);

  assert.equal(result.entry.notation, candidates[1].notation);
  assert.match(result.note, /non e fra le mosse legali/);
});

test('se non si recupera nessuna mossa valida si alza un errore invece di inventare', () => {
  const { state, annotated } = jevToMove();
  const { candidates } = buildRequest({ state, annotated, jevColor: 'black' });

  assert.throws(
    () => interpret({ answers: { mossa: { type: 'choice', choice: '99-99', probabilities: { '98-98': 1 } } } }, candidates),
    JevError,
  );
  assert.throws(() => interpret({ answers: {} }, candidates), JevError);
});

test('askJev manda la chiave nellheader e misura la latenza', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return { ok: true, status: 200, text: async () => JSON.stringify({ model: 'jev-1.13.0', answers: {}, usage: {} }) };
  };

  const { body, latencyMs } = await askJev({ apiKey: 'chiave-di-prova', request: { model: MODEL }, fetchImpl });

  assert.equal(seen.url, '/api/systemone');
  assert.equal(seen.init.headers.Authorization, 'Bearer chiave-di-prova');
  assert.equal(JSON.parse(seen.init.body).model, MODEL);
  assert.equal(body.model, 'jev-1.13.0');
  assert.ok(Number.isFinite(latencyMs));
});

test('askJev riporta il messaggio vero di TypeSafe sugli errori', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ detail: { error_type: 'authentication_error', message: 'Must supply an API key!' } }),
  });

  await assert.rejects(
    () => askJev({ apiKey: 'sbagliata', request: {}, fetchImpl }),
    (error) => {
      assert.ok(error instanceof JevError);
      assert.equal(error.status, 401);
      assert.equal(error.type, 'authentication_error');
      assert.equal(error.message, 'Must supply an API key!');
      return true;
    },
  );
});

test('una posizione con una sola mossa legale non ha bisogno di Jev', () => {
  // Presa obbligatoria unica: non c e niente da scegliere, e la chiamata si evita.
  const state = positionFrom({ 32: 'w', 28: 'b', 1: 'b' }, 'white');
  assert.equal(annotateMoves(state).length, 1);
});
