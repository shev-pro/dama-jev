/**
 * Orchestrazione: tiene la partita, raccoglie i click dell'umano, chiede la
 * mossa a Jev e aggiorna il pannello.
 *
 * L'umano gioca il bianco e muove per primo. Jev gioca il nero.
 */

import { initialPosition, legalMoves, applyMove, gameStatus, EMPTY } from './rules.js';
import { moveNotation, piecesOf } from './notation.js';
import { annotateMoves, heuristicBest } from './analysis.js';
import { createSelection, selectionTargets, selectionHead, advanceSelection } from './selection.js';
import { buildRequest, askJev, interpret, JevError, RISK_LEVELS } from './jev.js';
import { createScene } from './scene.js';

const UMANO = 'white';
const JEV = 'black';

const $ = (id) => document.getElementById(id);
const mostra = (el, visibile) => el.classList.toggle('nascosto', !visibile);
const plurale = (n, singolare, plurale_) => `${n} ${n === 1 ? singolare : plurale_}`;

// La chiave vive qui e solo qui: nessuna scrittura su disco, nessuno storage.
let chiaveApi = null;

let stato = initialPosition();
let mosseUmano = [];
let selezione = null;
let cronologia = [];
let costoTotale = { richieste: 0, token: 0 };
let occupato = false;
let scena = null;

// ------------------------------------------------------------------ pannello

function aggiornaMateriale() {
  const umano = piecesOf(stato, UMANO);
  const jev = piecesOf(stato, JEV);
  const dettaglio = (p) =>
    plurale(p.men.length, 'pedina', 'pedine') +
    (p.kings.length ? `, ${plurale(p.kings.length, 'dama', 'dame')}` : '');

  $('conta-umano').textContent = umano.total;
  $('dettaglio-umano').textContent = dettaglio(umano);
  $('conta-jev').textContent = jev.total;
  $('dettaglio-jev').textContent = dettaglio(jev);
}

function aggiornaCronologia() {
  $('cronologia').innerHTML = cronologia
    .map((voce, i) => `<div><span class="n">${i + 1}.</span><span class="${voce.colore === UMANO ? 'bianco' : 'nero'}">${voce.notazione}</span></div>`)
    .join('');
  $('cronologia').scrollTop = $('cronologia').scrollHeight;
}

function statoTesto(testo, modo = '') {
  $('stato-testo').textContent = testo;
  $('stato').className = modo;
}

let timerAvviso = null;
function avvisa(testo) {
  const el = $('avviso');
  el.textContent = testo;
  el.classList.add('visibile');
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => el.classList.remove('visibile'), 2600);
}

function mostraErrore(titolo, testo, { consentiRiprova = true } = {}) {
  $('errore-titolo').textContent = titolo;
  $('errore-testo').textContent = testo;
  $('riprova').disabled = !consentiRiprova;
  mostra($('sezione-errore'), true);
}

const nascondiErrore = () => mostra($('sezione-errore'), false);

function disegnaCandidate(ranking, { nota = null, mostraProbabilita = true } = {}) {
  mostra($('sezione-candidate'), true);
  mostra($('nota-scelta'), Boolean(nota));
  if (nota) $('nota-scelta').innerHTML = `<p class="avviso-lettura">${nota}</p>`;

  $('candidate').innerHTML = ranking
    .map((riga) => {
      const { facts, descrizione } = riga.entry;
      // La sintesi dice la cosa decisiva: cosa mangia, e come finisce il materiale.
      const sintesi = [facts.catture > 0 ? descrizione.prese : null, facts.etichettaBilancio]
        .filter(Boolean).join(' · ');
      const larghezza = mostraProbabilita ? Math.max(riga.probability * 100, 0.6) : 0;
      return `
        <div class="candidata ${riga.chosen ? 'scelta' : ''}" data-notazione="${riga.notation}">
          <div class="barra" style="width:${larghezza}%"></div>
          <div class="riga-testa">
            <span class="notazione">${riga.notation}</span>
            <span class="percento">${mostraProbabilita ? `${(riga.probability * 100).toFixed(1)}%` : ''}</span>
          </div>
          <div class="sintesi">${sintesi}</div>
        </div>`;
    })
    .join('');

  // Passando sopra una candidata si accendono le sue caselle sulla scacchiera.
  const perNotazione = new Map(ranking.map((riga) => [riga.notation, riga.entry.move]));
  for (const nodo of $('candidate').children) {
    const mossa = perNotazione.get(nodo.dataset.notazione);
    nodo.addEventListener('mouseenter', () => scena.setHighlights({ hint: [...mossa.path, ...mossa.captured] }));
    nodo.addEventListener('mouseleave', () => scena.setHighlights({ trail: ultimaScia }));
  }
}

function disegnaValutazione({ posture, risk, confidence }) {
  mostra($('sezione-valutazione'), true);

  if (posture?.choice) {
    const etichetta = posture.choice.replace(/_/g, ' ');
    const p = posture.probabilities?.[posture.choice] ?? 0;
    $('postura').textContent = `${etichetta.charAt(0).toUpperCase()}${etichetta.slice(1)} — ${(p * 100).toFixed(0)}%`;
    $('metro-postura').style.width = `${p * 100}%`;
  } else {
    $('postura').textContent = '—';
    $('metro-postura').style.width = '0%';
  }

  if (risk && typeof risk.score === 'number') {
    const massimo = RISK_LEVELS.length - 1;
    const livello = Math.min(massimo, Math.round(risk.score));
    $('rischio').textContent = `${risk.score.toFixed(2)} / ${massimo}`;
    $('metro-rischio').style.width = `${(risk.score / massimo) * 100}%`;
    $('rischio').title = RISK_LEVELS[livello];
  } else {
    $('rischio').textContent = '—';
    $('metro-rischio').style.width = '0%';
  }

  if (typeof confidence === 'number') {
    $('confidence').textContent = confidence.toFixed(2);
    $('nota-confidence').textContent = confidence < 0.4
      ? 'Confidence bassa: la probabilità è distribuita fra più mosse. Vuol dire che per Jev valgono quasi uguale, non che stia giocando a caso.'
      : 'Confidence alta: la probabilità è concentrata su una mossa sola.';
  } else {
    $('confidence').textContent = '—';
    $('nota-confidence').textContent = '';
  }
}

function disegnaCosti({ usage, latencyMs, model }) {
  mostra($('sezione-costi'), true);
  costoTotale.richieste += 1;
  costoTotale.token += usage?.input_tokens ?? 0;

  $('costo-turno').textContent = `${usage?.input_tokens ?? '—'} token in · ${latencyMs} ms`;
  $('costo-totale').textContent = `${costoTotale.richieste} richieste · ${costoTotale.token} token`;
  $('modello').textContent = model ?? '—';
}

// ------------------------------------------------------------------ partita

let ultimaScia = [];

async function esegui(move, colore) {
  const notazione = moveNotation(move);
  await scena.playMove(move);

  stato = applyMove(stato, move);
  cronologia.push({ colore, notazione });
  ultimaScia = [move.from, move.to];

  scena.setHighlights({ trail: ultimaScia });
  aggiornaMateriale();
  aggiornaCronologia();
}

function finePartita() {
  const esito = gameStatus(stato);
  if (esito === 'playing') return false;

  const testo = {
    white_wins: 'Hai vinto.',
    black_wins: 'Ha vinto Jev.',
    draw: 'Patta.',
  }[esito];

  statoTesto(testo, 'finita');
  scena.setHighlights({});
  selezione = null;
  mosseUmano = [];
  return true;
}

function iniziaTurnoUmano() {
  if (finePartita()) return;
  mosseUmano = legalMoves(stato);
  selezione = null;
  scena.setHighlights({ trail: ultimaScia });

  const obbligo = mosseUmano.length > 0 && mosseUmano[0].captured.length > 0;
  statoTesto(obbligo
    ? `Tocca a te — presa obbligatoria: ${plurale(mosseUmano[0].captured.length, 'pezzo', 'pezzi')}.`
    : 'Tocca a te.');
}

function evidenziaSelezione() {
  scena.setHighlights({
    selected: selectionHead(selezione),
    targets: selectionTargets(selezione),
    trail: ultimaScia,
  });
}

function click(square) {
  if (occupato || stato.turn !== UMANO || finePartita()) return;

  // Se c'e una selezione in corso, il click prova prima ad avanzare la catena.
  if (selezione) {
    const { selection, move } = advanceSelection(selezione, square);
    if (move) {
      selezione = null;
      giocaMossaUmana(move);
      return;
    }
    if (selection !== selezione) {
      selezione = selection;
      evidenziaSelezione();
      avvisa('Prosegui la catena: scegli il salto successivo.');
      return;
    }
    // Click fuori bersaglio: si prova a selezionare un altro pezzo, qui sotto.
  }

  const nuova = createSelection(mosseUmano, square);
  if (!nuova) {
    const pezzo = stato.board[square];
    const presaObbligatoria = mosseUmano.length > 0 && mosseUmano[0].captured.length > 0;
    if (pezzo !== EMPTY && pezzo > 0 && presaObbligatoria) {
      avvisa('La presa è obbligatoria: puoi muovere solo i pezzi che mangiano.');
    }
    selezione = null;
    scena.setHighlights({ trail: ultimaScia });
    return;
  }

  selezione = nuova;
  evidenziaSelezione();
}

async function giocaMossaUmana(move) {
  occupato = true;
  scena.setHighlights({});
  await esegui(move, UMANO);
  occupato = false;

  if (finePartita()) return;
  turnoJev();
}

// ------------------------------------------------------------------ Jev

let annotateCorrenti = null;

async function turnoJev() {
  if (finePartita()) return;
  occupato = true;
  nascondiErrore();
  statoTesto('Jev sta valutando…', 'pensa');

  const annotated = annotateMoves(stato);
  annotateCorrenti = annotated;

  // Con una sola mossa legale non c'è niente da scegliere: la chiamata si evita.
  if (annotated.length === 1) {
    mostra($('sezione-candidate'), true);
    mostra($('nota-scelta'), true);
    $('nota-scelta').innerHTML =
      '<p class="avviso-lettura">Una sola mossa legale: non c\'è niente da scegliere, ' +
      'quindi questo turno non è stato chiesto nulla a Jev.</p>';
    $('candidate').innerHTML = '';
    await concludiTurnoJev(annotated[0].move);
    return;
  }

  const ultimaAvversaria = cronologia.filter((v) => v.colore === UMANO).at(-1)?.notazione ?? null;
  const { request, candidates, dropped } = buildRequest({
    state: stato,
    annotated,
    jevColor: JEV,
    lastOpponentMove: ultimaAvversaria,
    recentMoves: cronologia.slice(-6).map((v) => `${v.colore === UMANO ? 'avversario' : 'tu'}: ${v.notazione}`),
  });

  statoTesto(`Jev sta valutando ${candidates.length} mosse…`, 'pensa');

  try {
    const { body, latencyMs } = await askJev({ apiKey: chiaveApi, request });
    const risultato = interpret(body, candidates);

    const note = [
      risultato.note,
      dropped > 0 ? `${dropped} mosse poco promettenti non sono state mandate a Jev, per restare sotto il limite di opzioni.` : null,
    ].filter(Boolean).join(' ');

    disegnaCandidate(risultato.ranking, { nota: note || null });
    disegnaValutazione(risultato);
    disegnaCosti({ usage: risultato.usage, latencyMs, model: risultato.model });

    await concludiTurnoJev(risultato.entry.move);
  } catch (errore) {
    occupato = false;
    const messaggio = errore instanceof JevError
      ? errore.message
      : `Non sono riuscito a interrogare Jev: ${errore?.message ?? errore}`;

    statoTesto('Jev non ha risposto.', 'finita');
    mostraErrore('Jev non ha risposto', messaggio);
  }
}

async function concludiTurnoJev(move) {
  await esegui(move, JEV);
  occupato = false;
  iniziaTurnoUmano();
}

// ------------------------------------------------------------------ avvio

function nuovaPartita() {
  stato = initialPosition();
  cronologia = [];
  ultimaScia = [];
  selezione = null;
  occupato = false;
  costoTotale = { richieste: 0, token: 0 };

  nascondiErrore();
  mostra($('sezione-candidate'), false);
  mostra($('sezione-valutazione'), false);
  mostra($('sezione-costi'), false);

  scena.syncBoard(stato);
  aggiornaMateriale();
  aggiornaCronologia();
  iniziaTurnoUmano();
}

function avvia() {
  scena = createScene($('scena'), { onPick: click });
  scena.syncBoard(stato);
  aggiornaMateriale();
  iniziaTurnoUmano();

  $('nuova-partita').addEventListener('click', nuovaPartita);
  $('riprova').addEventListener('click', () => { nascondiErrore(); turnoJev(); });

  $('motore-locale').addEventListener('click', async () => {
    if (!annotateCorrenti?.length) return;
    nascondiErrore();
    const scelta = heuristicBest(annotateCorrenti);
    disegnaCandidate(
      annotateCorrenti.map((entry) => ({
        entry, notation: entry.notation, probability: 0, chosen: entry === scelta,
      })),
      {
        nota: 'Questa mossa <strong>non</strong> è di Jev: l\'ha scelta il motore di ricerca locale, ' +
          'perché l\'API non ha risposto. Non ci sono probabilità da mostrare.',
        mostraProbabilita: false,
      },
    );
    occupato = true;
    await concludiTurnoJev(scelta.move);
  });
}

// La chiave si chiede subito e resta in memoria: il dialog non si chiude senza.
const dialog = $('dialog-chiave');
$('form-chiave').addEventListener('submit', (event) => {
  const valore = $('input-chiave').value.trim();
  if (!valore) {
    event.preventDefault();
    $('errore-chiave').textContent = 'Serve una chiave per far giocare Jev.';
    mostra($('errore-chiave'), true);
    return;
  }
  chiaveApi = valore;
  $('input-chiave').value = '';
  avvia();
});

dialog.showModal();
