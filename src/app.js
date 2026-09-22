/**
 * Orchestration: collects the player's clicks, sends commands to the server and
 * draws whatever comes back.
 *
 * The page holds no rules and no engine. The legal moves arrive as data, the
 * position lives on the server, and a move is sent as the list of squares it
 * travels through. If this file were rewritten by hand in the console, the
 * worst it could do is ask for a move the server will refuse.
 *
 * Note: the strings shown on screen are Italian, because the game is.
 */

import { createSelection, selectionTargets, selectionHead, advanceSelection } from './selection.js';
import { getConfig, createGame, sendMove, askJevToMove, getLeaderboard, ApiError } from './api.js';
import { createScene } from './scene.js';

const $ = (id) => document.getElementById(id);
const show = (element, visible) => element.classList.toggle('hidden', !visible);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g,
  (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

let config = null;
let scene = null;
let state = null;          // the server's view of the game
let selection = null;
let busy = false;
let lastTrail = [];

// ------------------------------------------------------------------- panel

function setStatus(text, mode = '') {
  $('status-text').textContent = text;
  $('status').className = mode;
}

let toastTimer = null;
function toast(text) {
  const element = $('toast');
  element.textContent = text;
  element.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('visible'), 2600);
}

function showError(title, text, { allowLocalEngine = true } = {}) {
  $('error-title').textContent = title;
  $('error-text').textContent = text;
  show($('local-engine'), allowLocalEngine);
  show($('section-error'), true);
}

const hideError = () => show($('section-error'), false);

function renderMaterial() {
  const detail = (side) =>
    plural(side.men.length, 'pedina', 'pedine') +
    (side.kings.length ? `, ${plural(side.kings.length, 'dama', 'dame')}` : '');

  $('label-human').textContent = state.playerName;
  $('count-human').textContent = state.material.human.total;
  $('detail-human').textContent = detail(state.material.human);
  $('count-jev').textContent = state.material.jev.total;
  $('detail-jev').textContent = detail(state.material.jev);
}

function renderHistory() {
  $('history').innerHTML = state.history
    .map((entry, index) =>
      `<div><span class="n">${index + 1}.</span>` +
      `<span class="${entry.color === state.humanColor ? 'white' : 'black'}">${escapeHtml(entry.notation)}</span></div>`)
    .join('');
  $('history').scrollTop = $('history').scrollHeight;
}

function renderCandidates(ranking, { note = null, showProbabilities = true } = {}) {
  show($('section-candidates'), true);
  show($('choice-note'), Boolean(note));
  if (note) $('choice-note').innerHTML = `<p class="caveat">${note}</p>`;

  $('candidates').innerHTML = ranking
    .map((row) => {
      // The summary says the decisive thing: what it takes, and how material ends up.
      const summary = [row.facts.captures > 0 ? row.description.prese : null, row.facts.balanceLabel]
        .filter(Boolean).join(' · ');
      const width = showProbabilities ? Math.max(row.probability * 100, 0.6) : 0;
      return `
        <div class="candidate ${row.chosen ? 'chosen' : ''}" data-notation="${escapeHtml(row.notation)}">
          <div class="bar" style="width:${width}%"></div>
          <div class="candidate-head">
            <span class="notation">${escapeHtml(row.notation)}</span>
            <span class="percent">${showProbabilities ? `${(row.probability * 100).toFixed(1)}%` : ''}</span>
          </div>
          <div class="summary">${escapeHtml(summary)}</div>
        </div>`;
    })
    .join('');

  // Hovering a candidate lights up its squares on the board.
  const moves = new Map(ranking.map((row) => [row.notation, row.move]));
  for (const node of $('candidates').children) {
    const move = moves.get(node.dataset.notation);
    if (!move) continue;
    node.addEventListener('mouseenter', () => scene.setHighlights({ hint: [...move.path, ...move.captured] }));
    node.addEventListener('mouseleave', () => scene.setHighlights({ trail: lastTrail }));
  }
}

function renderEvaluation({ posture, risk, confidence }) {
  show($('section-evaluation'), true);

  if (posture?.choice) {
    const label = posture.choice.replace(/_/g, ' ');
    const probability = posture.probabilities?.[posture.choice] ?? 0;
    $('posture').textContent = `${label.charAt(0).toUpperCase()}${label.slice(1)} — ${(probability * 100).toFixed(0)}%`;
    $('meter-posture').style.width = `${probability * 100}%`;
  } else {
    $('posture').textContent = '—';
    $('meter-posture').style.width = '0%';
  }

  if (risk && typeof risk.score === 'number') {
    const top = (risk.levels ?? 5) - 1;
    $('risk').textContent = `${risk.score.toFixed(2)} / ${top}`;
    $('risk').title = risk.legend?.[String(Math.min(top, Math.round(risk.score)))] ?? '';
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

/** The exact JSON that went to TypeSafe and the exact JSON that came back. */
function renderExchange(jev) {
  const hasExchange = Boolean(jev.request && jev.response);
  show($('section-exchange'), hasExchange);
  if (!hasExchange) return;

  const requestText = JSON.stringify(jev.request, null, 2);
  const responseText = JSON.stringify(jev.response, null, 2);

  $('request-json').textContent = requestText;
  $('response-json').textContent = responseText;
  $('request-size').textContent = `${(requestText.length / 1024).toFixed(1)} KB`;
  $('response-size').textContent = `${(responseText.length / 1024).toFixed(1)} KB`;

  $('usage-turn').textContent = `${jev.usage?.input_tokens ?? '—'} token in · ${jev.latencyMs} ms`;
  $('usage-total').textContent = `${state.usage.requests} richieste · ${state.usage.tokens} token`;
  $('usage-model').textContent = jev.model ?? '—';
}

function renderJev(jev) {
  if (jev.source === 'forced') {
    renderCandidates([], {
      note: 'Una sola mossa legale: non c\'è niente da scegliere, quindi questo turno non è stato chiesto nulla a Jev.',
    });
    show($('section-evaluation'), false);
    show($('section-exchange'), false);
    return;
  }

  if (jev.source === 'local') {
    renderCandidates(jev.ranking, {
      note: 'Questa mossa <strong>non</strong> è di Jev: l\'ha scelta il motore di ricerca locale, ' +
        'perché l\'API non ha risposto. Non ci sono probabilità da mostrare.',
      showProbabilities: false,
    });
    show($('section-evaluation'), false);
    show($('section-exchange'), false);
    return;
  }

  const note = [
    jev.note,
    jev.dropped > 0 ? `${jev.dropped} mosse poco promettenti non sono state mandate a Jev, per restare sotto il limite di opzioni.` : null,
  ].filter(Boolean).join(' ');

  renderCandidates(jev.ranking, { note: note || null });
  renderEvaluation(jev);
  renderExchange(jev);
}

async function refreshLeaderboard() {
  const variant = state?.variant.id ?? config.defaultVariant;
  const label = config.variants.find((item) => item.id === variant)?.shortName ?? '';
  $('leaderboard-variant').textContent = label ? `· ${label}` : '';

  let data;
  try {
    data = await getLeaderboard(variant);
  } catch {
    return; // A leaderboard that will not load must never break the game.
  }

  if (data.standings.length === 0) {
    $('leaderboard-body').innerHTML = '<p class="empty-note">Nessuna partita finita, per ora.</p>';
    return;
  }

  const rows = data.standings.map((row, index) => `
    <tr class="${state && row.name === state.playerName ? 'you' : ''}">
      <td class="rank">${index + 1}</td>
      <td>${escapeHtml(row.name)}</td>
      <td class="num">${row.wins}</td>
      <td class="num">${row.draws}</td>
      <td class="num">${row.losses}</td>
      <td class="num">${row.bestWinMoves ?? '—'}</td>
    </tr>`).join('');

  $('leaderboard-body').innerHTML = `
    <table class="board">
      <thead><tr>
        <th></th><th>Giocatore</th>
        <th class="num" title="Vittorie">V</th>
        <th class="num" title="Patte">P</th>
        <th class="num" title="Sconfitte">S</th>
        <th class="num" title="Mosse nella vittoria piu rapida">Record</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="caveat" style="margin:10px 0 0">
      Jev ha vinto ${data.totals.jevWins} partite su ${data.totals.games} in questa variante.
    </p>`;
}

// -------------------------------------------------------------------- game

function applyState(next, { resync = false } = {}) {
  state = next;
  if (resync) scene.syncBoard(state.board);

  renderMaterial();
  renderHistory();
  $('panel-subtitle').textContent =
    `${state.variant.name} ${state.variant.size}x${state.variant.size}. Tu il bianco, Jev il nero.`;
}

function gameOver() {
  if (state.status === 'playing') return false;

  setStatus({
    white_wins: 'Hai vinto.',
    black_wins: 'Ha vinto Jev.',
    draw: 'Patta.',
  }[state.status], 'over');

  scene.setHighlights({});
  selection = null;
  refreshLeaderboard();
  return true;
}

function startHumanTurn() {
  if (gameOver()) return;
  selection = null;
  scene.setHighlights({ trail: lastTrail });

  const forced = state.legalMoves.length > 0 && state.legalMoves[0].captured.length > 0;
  setStatus(forced
    ? `Tocca a te — presa obbligatoria: ${plural(state.legalMoves[0].captured.length, 'pezzo', 'pezzi')}.`
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
  if (busy || !state || state.status !== 'playing' || state.turn !== state.humanColor) return;

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

  const started = createSelection(state.legalMoves, square);
  if (!started) {
    const piece = state.board[square];
    const captureForced = state.legalMoves.length > 0 && state.legalMoves[0].captured.length > 0;
    if (piece > 0 && captureForced) toast('La presa è obbligatoria: puoi muovere solo i pezzi che mangiano.');
    selection = null;
    scene.setHighlights({ trail: lastTrail });
    return;
  }

  selection = started;
  highlightSelection();
}

async function playHumanMove(move) {
  busy = true;
  hideError();
  scene.setHighlights({});

  try {
    // The move came out of the server's own list, so it is safe to animate it
    // while the server confirms; the two run together to keep the board snappy.
    const [, result] = await Promise.all([scene.playMove(move), sendMove(state.id, move.path)]);
    lastTrail = [move.from, move.to];
    applyState(result.state);
  } catch (error) {
    // The server disagreed, so the board on screen is the one that is wrong.
    scene.syncBoard(state.board);
    scene.setHighlights({ trail: lastTrail });
    busy = false;
    setStatus('Mossa rifiutata.', 'over');
    showError('Il server ha rifiutato la mossa', error.message, { allowLocalEngine: false });
    return;
  }

  busy = false;
  if (gameOver()) return;
  if (state.turn === state.jevColor) jevTurn();
  else startHumanTurn();
}

async function jevTurn({ local = false } = {}) {
  busy = true;
  hideError();
  setStatus(local ? 'Muove il motore locale…' : 'Jev sta valutando…', 'thinking');

  let payload;
  try {
    payload = await askJevToMove(state.id, { local });
  } catch (error) {
    busy = false;
    setStatus('Jev non ha risposto.', 'over');
    showError('Jev non ha risposto', error instanceof ApiError
      ? error.message
      : `Non sono riuscito a interrogare Jev: ${error?.message ?? error}`);
    return;
  }

  const { jev } = payload;
  renderJev(jev);
  await scene.playMove(jev.move);
  lastTrail = [jev.move.from, jev.move.to];
  applyState(payload.state);

  busy = false;
  startHumanTurn();
}

// ------------------------------------------------------------------- start

async function beginGame({ variant, playerName, apiKey }) {
  const { state: fresh } = await createGame({ variant, playerName, apiKey });

  hideError();
  show($('section-candidates'), false);
  show($('section-evaluation'), false);
  show($('section-exchange'), false);
  lastTrail = [];
  selection = null;
  busy = false;

  // Both the size and the diagonal come from the server: the page does not
  // know which variant is mirrored, and does not need to.
  scene.buildBoard(fresh.variant);

  applyState(fresh, { resync: true });
  refreshLeaderboard();

  // In English draughts the side on squares 1-12 opens, and that is Jev.
  if (state.turn === state.jevColor && state.status === 'playing') jevTurn();
  else startHumanTurn();
}

function renderVariantPicker() {
  $('variant-list').innerHTML = config.variants.map((variant, index) => `
    <label class="variant">
      <input type="radio" name="variant" value="${escapeHtml(variant.id)}" ${index === 0 ? 'checked' : ''}>
      <span class="name">${escapeHtml(variant.name)}
        <span class="size">${variant.size}×${variant.size}</span></span>
      <span class="desc">${escapeHtml(variant.description)}</span>
    </label>`).join('');
}

function openStartDialog() {
  show($('form-error'), false);
  $('start-dialog').showModal();
}

// Escape would dismiss the dialog and leave the page with a board and no game.
// There is nothing to go back to, so the only way out is starting one.
$('start-dialog').addEventListener('cancel', (event) => event.preventDefault());

async function boot() {
  config = await getConfig();

  renderVariantPicker();
  show($('key-field'), config.needsApiKey);
  $('privacy-note').innerHTML = config.needsApiKey
    ? 'La chiave resta in questa pagina per la durata della partita e viene usata solo per far ' +
      'giocare Jev. <strong>Non viene salvata da nessuna parte</strong>: né in localStorage, né su ' +
      'disco, né in classifica. In classifica finiscono solo nome, variante e risultato.'
    : 'Questo server usa la propria chiave TypeSafe, quindi non devi inserirne una. ' +
      '<strong>Nessuna chiave viene mai salvata</strong>: in classifica finiscono solo nome, ' +
      'variante e risultato.';

  scene = createScene($('scene'), { onPick: pick });
  scene.buildBoard({ size: 10, boardParity: 1 });
  refreshLeaderboard();

  $('start-form').addEventListener('submit', async (event) => {
    const playerName = $('name-input').value.trim();
    const variant = $('start-form').querySelector('input[name="variant"]:checked')?.value;
    const apiKey = config.needsApiKey ? $('key-input').value.trim() : null;

    const problem = !playerName ? 'Serve un nome: è quello che finirà in classifica.'
      : config.needsApiKey && !apiKey ? 'Serve una chiave API per far giocare Jev.'
        : null;

    if (problem) {
      event.preventDefault();
      $('form-error').textContent = problem;
      show($('form-error'), true);
      return;
    }

    $('key-input').value = '';
    try {
      await beginGame({ variant, playerName, apiKey });
    } catch (error) {
      setStatus('Non sono riuscito a iniziare la partita.', 'over');
      showError('Partita non iniziata', error.message, { allowLocalEngine: false });
    }
  });

  $('new-game').addEventListener('click', openStartDialog);
  $('retry').addEventListener('click', () => jevTurn());
  $('local-engine').addEventListener('click', () => jevTurn({ local: true }));

  openStartDialog();
}

boot().catch((error) => {
  setStatus('Il server locale non risponde.', 'over');
  showError('Avvio fallito', error?.message ?? String(error), { allowLocalEngine: false });
});
