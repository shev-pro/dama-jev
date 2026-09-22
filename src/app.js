/**
 * Orchestration: holds the game, collects the human's clicks, asks Jev for its
 * move and keeps the panel up to date.
 *
 * The human plays White and moves first. Jev plays Black.
 *
 * Note: the strings shown on screen are Italian, because the game is.
 */

import { initialPosition, legalMoves, applyMove, gameStatus, EMPTY } from './rules.js';
import { moveNotation, piecesOf } from './notation.js';
import { annotateMoves, heuristicBest } from './analysis.js';
import { createSelection, selectionTargets, selectionHead, advanceSelection } from './selection.js';
import { buildRequest, askJev, interpret, JevError, RISK_LEVELS } from './jev.js';
import { createScene } from './scene.js';

const HUMAN = 'white';
const JEV = 'black';

const $ = (id) => document.getElementById(id);
const show = (el, visible) => el.classList.toggle('hidden', !visible);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The API key lives here and nowhere else: never written to disk, never stored.
let apiKey = null;

let state = initialPosition();
let humanMoves = [];
let selection = null;
let history = [];
let totalUsage = { requests: 0, tokens: 0 };
let busy = false;
let scene = null;
let lastTrail = [];
let currentAnnotations = null;

// ------------------------------------------------------------------- panel

function updateMaterial() {
  const human = piecesOf(state, HUMAN);
  const jev = piecesOf(state, JEV);
  const detail = (p) =>
    plural(p.men.length, 'pedina', 'pedine') +
    (p.kings.length ? `, ${plural(p.kings.length, 'dama', 'dame')}` : '');

  $('count-human').textContent = human.total;
  $('detail-human').textContent = detail(human);
  $('count-jev').textContent = jev.total;
  $('detail-jev').textContent = detail(jev);
}

function updateHistory() {
  $('history').innerHTML = history
    .map((entry, i) => `<div><span class="n">${i + 1}.</span><span class="${entry.color === HUMAN ? 'white' : 'black'}">${entry.notation}</span></div>`)
    .join('');
  $('history').scrollTop = $('history').scrollHeight;
}

function setStatus(text, mode = '') {
  $('status-text').textContent = text;
  $('status').className = mode;
}

let toastTimer = null;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}

function showError(title, text, { allowRetry = true } = {}) {
  $('error-title').textContent = title;
  $('error-text').textContent = text;
  $('retry').disabled = !allowRetry;
  show($('section-error'), true);
}

const hideError = () => show($('section-error'), false);

function renderCandidates(ranking, { note = null, showProbabilities = true } = {}) {
  show($('section-candidates'), true);
  show($('choice-note'), Boolean(note));
  if (note) $('choice-note').innerHTML = `<p class="caveat">${note}</p>`;

  $('candidates').innerHTML = ranking
    .map((row) => {
      const { facts, description } = row.entry;
      // The summary says the decisive thing: what it takes, and where material lands.
      const summary = [facts.captures > 0 ? description.prese : null, facts.balanceLabel]
        .filter(Boolean).join(' · ');
      const width = showProbabilities ? Math.max(row.probability * 100, 0.6) : 0;
      return `
        <div class="candidate ${row.chosen ? 'chosen' : ''}" data-notation="${row.notation}">
          <div class="bar" style="width:${width}%"></div>
          <div class="candidate-head">
            <span class="notation">${row.notation}</span>
            <span class="percent">${showProbabilities ? `${(row.probability * 100).toFixed(1)}%` : ''}</span>
          </div>
          <div class="summary">${summary}</div>
        </div>`;
    })
    .join('');

  // Hovering a candidate lights up its squares on the board.
  const byNotation = new Map(ranking.map((row) => [row.notation, row.entry.move]));
  for (const node of $('candidates').children) {
    const move = byNotation.get(node.dataset.notation);
    node.addEventListener('mouseenter', () => scene.setHighlights({ hint: [...move.path, ...move.captured] }));
    node.addEventListener('mouseleave', () => scene.setHighlights({ trail: lastTrail }));
  }
}

function renderEvaluation({ posture, risk, confidence }) {
  show($('section-evaluation'), true);

  if (posture?.choice) {
    const label = posture.choice.replace(/_/g, ' ');
    const p = posture.probabilities?.[posture.choice] ?? 0;
    $('posture').textContent = `${label.charAt(0).toUpperCase()}${label.slice(1)} — ${(p * 100).toFixed(0)}%`;
    $('meter-posture').style.width = `${p * 100}%`;
  } else {
    $('posture').textContent = '—';
    $('meter-posture').style.width = '0%';
  }

  if (risk && typeof risk.score === 'number') {
    const top = RISK_LEVELS.length - 1;
    const level = Math.min(top, Math.round(risk.score));
    $('risk').textContent = `${risk.score.toFixed(2)} / ${top}`;
    $('risk').title = RISK_LEVELS[level];
    $('meter-risk').style.width = `${(risk.score / top) * 100}%`;
  } else {
    $('risk').textContent = '—';
    $('meter-risk').style.width = '0%';
  }

  if (typeof confidence === 'number') {
    $('confidence').textContent = confidence.toFixed(2);
    $('confidence-note').textContent = confidence < 0.4
      ? 'Confidence bassa: la probabilità è distribuita fra più mosse. Vuol dire che per Jev valgono quasi uguale, non che stia giocando a caso.'
      : 'Confidence alta: la probabilità è concentrata su una mossa sola.';
  } else {
    $('confidence').textContent = '—';
    $('confidence-note').textContent = '';
  }
}

function renderUsage({ usage, latencyMs, model }) {
  show($('section-usage'), true);
  totalUsage.requests += 1;
  totalUsage.tokens += usage?.input_tokens ?? 0;

  $('usage-turn').textContent = `${usage?.input_tokens ?? '—'} token in · ${latencyMs} ms`;
  $('usage-total').textContent = `${totalUsage.requests} richieste · ${totalUsage.tokens} token`;
  $('usage-model').textContent = model ?? '—';
}

// -------------------------------------------------------------------- game

async function perform(move, color) {
  const notation = moveNotation(move);
  await scene.playMove(move);

  state = applyMove(state, move);
  history.push({ color, notation });
  lastTrail = [move.from, move.to];

  scene.setHighlights({ trail: lastTrail });
  updateMaterial();
  updateHistory();
}

function gameOver() {
  const outcome = gameStatus(state);
  if (outcome === 'playing') return false;

  setStatus({
    white_wins: 'Hai vinto.',
    black_wins: 'Ha vinto Jev.',
    draw: 'Patta.',
  }[outcome], 'over');

  scene.setHighlights({});
  selection = null;
  humanMoves = [];
  return true;
}

function startHumanTurn() {
  if (gameOver()) return;
  humanMoves = legalMoves(state);
  selection = null;
  scene.setHighlights({ trail: lastTrail });

  const forced = humanMoves.length > 0 && humanMoves[0].captured.length > 0;
  setStatus(forced
    ? `Tocca a te — presa obbligatoria: ${plural(humanMoves[0].captured.length, 'pezzo', 'pezzi')}.`
    : 'Tocca a te.');
}

function highlightSelection() {
  scene.setHighlights({
    selected: selectionHead(selection),
    targets: selectionTargets(selection),
    trail: lastTrail,
  });
}

function pick(square) {
  if (busy || state.turn !== HUMAN || gameOver()) return;

  // With a selection under way, a click first tries to extend the chain.
  if (selection) {
    const next = advanceSelection(selection, square);
    if (next.move) {
      selection = null;
      playHumanMove(next.move);
      return;
    }
    if (next.selection !== selection) {
      selection = next.selection;
      highlightSelection();
      toast('Prosegui la catena: scegli il salto successivo.');
      return;
    }
    // Click off target: fall through and try selecting another piece.
  }

  const started = createSelection(humanMoves, square);
  if (!started) {
    const piece = state.board[square];
    const captureForced = humanMoves.length > 0 && humanMoves[0].captured.length > 0;
    if (piece !== EMPTY && piece > 0 && captureForced) {
      toast('La presa è obbligatoria: puoi muovere solo i pezzi che mangiano.');
    }
    selection = null;
    scene.setHighlights({ trail: lastTrail });
    return;
  }

  selection = started;
  highlightSelection();
}

async function playHumanMove(move) {
  busy = true;
  scene.setHighlights({});
  await perform(move, HUMAN);
  busy = false;

  if (gameOver()) return;
  jevTurn();
}

// --------------------------------------------------------------------- Jev

async function jevTurn() {
  if (gameOver()) return;
  busy = true;
  hideError();
  setStatus('Jev sta valutando…', 'thinking');

  const annotated = annotateMoves(state);
  currentAnnotations = annotated;

  // With a single legal move there is nothing to choose, so no request is sent.
  if (annotated.length === 1) {
    show($('section-candidates'), true);
    show($('choice-note'), true);
    $('choice-note').innerHTML =
      '<p class="caveat">Una sola mossa legale: non c\'è niente da scegliere, ' +
      'quindi questo turno non è stato chiesto nulla a Jev.</p>';
    $('candidates').innerHTML = '';
    await finishJevTurn(annotated[0].move);
    return;
  }

  const lastOpponentMove = history.filter((h) => h.color === HUMAN).at(-1)?.notation ?? null;
  const { request, candidates, dropped } = buildRequest({
    state,
    annotated,
    jevColor: JEV,
    lastOpponentMove,
    recentMoves: history.slice(-6).map((h) => `${h.color === HUMAN ? 'avversario' : 'tu'}: ${h.notation}`),
  });

  setStatus(`Jev sta valutando ${candidates.length} mosse…`, 'thinking');

  try {
    const { body, latencyMs } = await askJev({ apiKey, request });
    const result = interpret(body, candidates);

    const note = [
      result.note,
      dropped > 0 ? `${dropped} mosse poco promettenti non sono state mandate a Jev, per restare sotto il limite di opzioni.` : null,
    ].filter(Boolean).join(' ');

    renderCandidates(result.ranking, { note: note || null });
    renderEvaluation(result);
    renderUsage({ usage: result.usage, latencyMs, model: result.model });

    await finishJevTurn(result.entry.move);
  } catch (error) {
    busy = false;
    setStatus('Jev non ha risposto.', 'over');
    showError('Jev non ha risposto', error instanceof JevError
      ? error.message
      : `Non sono riuscito a interrogare Jev: ${error?.message ?? error}`);
  }
}

async function finishJevTurn(move) {
  await perform(move, JEV);
  busy = false;
  startHumanTurn();
}

// ------------------------------------------------------------------- start

function newGame() {
  state = initialPosition();
  history = [];
  lastTrail = [];
  selection = null;
  busy = false;
  totalUsage = { requests: 0, tokens: 0 };

  hideError();
  show($('section-candidates'), false);
  show($('section-evaluation'), false);
  show($('section-usage'), false);

  scene.syncBoard(state);
  updateMaterial();
  updateHistory();
  startHumanTurn();
}

function start() {
  scene = createScene($('scene'), { onPick: pick });
  scene.syncBoard(state);
  updateMaterial();
  startHumanTurn();

  $('new-game').addEventListener('click', newGame);
  $('retry').addEventListener('click', () => { hideError(); jevTurn(); });

  $('local-engine').addEventListener('click', async () => {
    if (!currentAnnotations?.length) return;
    hideError();
    const chosen = heuristicBest(currentAnnotations);
    renderCandidates(
      currentAnnotations.map((entry) => ({
        entry, notation: entry.notation, probability: 0, chosen: entry === chosen,
      })),
      {
        note: 'Questa mossa <strong>non</strong> è di Jev: l\'ha scelta il motore di ricerca locale, ' +
          'perché l\'API non ha risposto. Non ci sono probabilità da mostrare.',
        showProbabilities: false,
      },
    );
    busy = true;
    await finishJevTurn(chosen.move);
  });
}

// The key is asked for straight away and kept in memory: no key, no dialog exit.
$('key-form').addEventListener('submit', (event) => {
  const value = $('key-input').value.trim();
  if (!value) {
    event.preventDefault();
    $('key-error').textContent = 'Serve una chiave per far giocare Jev.';
    show($('key-error'), true);
    return;
  }
  apiKey = value;
  $('key-input').value = '';
  start();
});

$('key-dialog').showModal();
