/**
 * Annotazione tattica delle mosse candidate.
 *
 * Qui vive tutta l'aritmetica: quanti pezzi si mangiano, cosa risponde
 * l'avversario, come finisce il materiale dopo gli scambi forzati. La
 * documentazione di TypeSafe e esplicita sul fatto che jev-1.13 non conta in
 * modo affidabile e che l'errore cresce con la dimensione di cio che va
 * contato, quindi al modello non si chiede mai un numero: gli si consegna il
 * numero gia fatto, e gli si chiede il giudizio.
 *
 * La stessa ricerca serve due scopi: annotare le candidate per Jev, e fare da
 * motore locale di ripiego quando l'API non risponde.
 */

import { EMPTY, isKing, isMan, legalMoves, applyMove, squareToRC, rcToSquare } from './rules.js';
import { moveNotation, squareRow, isEdgeSquare, rowsToPromotion, zoneOf } from './notation.js';

const MAN_VALUE = 1;
const KING_VALUE = 3;
const MATE = 1000;

/** Profondita e tetto di nodi: tengono il turno di Jev sotto la decina di ms. */
const SEARCH_DEPTH = 4;
const QUIESCENCE_PLIES = 6;
const NODE_BUDGET = 300_000;

const other = (color) => (color === 'white' ? 'black' : 'white');

function material(state, color) {
  let total = 0;
  for (let square = 1; square <= 50; square++) {
    const piece = state.board[square];
    if (piece === EMPTY) continue;
    if ((piece > 0 ? 'white' : 'black') !== color) continue;
    total += isKing(piece) ? KING_VALUE : MAN_VALUE;
  }
  return total;
}

/**
 * Valutazione statica dal punto di vista di `color`: materiale, piu una spinta
 * modesta verso la promozione che rompe le parita senza distorcere il conto.
 */
function evaluate(state, color) {
  let score = material(state, color) - material(state, other(color));

  for (let square = 1; square <= 50; square++) {
    const piece = state.board[square];
    if (piece === EMPTY || isKing(piece)) continue;
    const owner = piece > 0 ? 'white' : 'black';
    const advance = (9 - rowsToPromotion(square, owner)) * 0.02;
    score += owner === color ? advance : -advance;
  }
  return score;
}

function negamax(state, depth, alpha, beta, quiescence, budget, ply) {
  if (budget.nodes++ > NODE_BUDGET) return evaluate(state, state.turn);

  const moves = legalMoves(state);
  // Chi ha il tratto ed e murato ha perso. Lo sconto per `ply` fa si che una
  // vittoria immediata valga piu di una vittoria fra tre mosse: senza, il
  // motore considera equivalenti tutte le strade che vincono e ne pesca una
  // a caso, anche la piu lunga.
  if (moves.length === 0) return -(MATE - ply);

  // Le catture sono obbligatorie: o tutte le mosse mangiano, o nessuna. Fermarsi
  // in mezzo a uno scambio forzato falsa la valutazione, quindi si prosegue.
  const forcedCapture = moves[0].captured.length > 0;
  if (depth <= 0 && (!forcedCapture || quiescence <= 0)) return evaluate(state, state.turn);

  const nextDepth = depth > 0 ? depth - 1 : 0;
  const nextQuiescence = depth > 0 ? quiescence : quiescence - 1;

  let best = -Infinity;
  for (const move of moves) {
    const score = -negamax(applyMove(state, move), nextDepth, -beta, -alpha, nextQuiescence, budget, ply + 1);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/** Il punteggio di ogni mossa legale, dal punto di vista di chi ha il tratto. */
export function scoreMoves(state, depth = SEARCH_DEPTH) {
  const budget = { nodes: 0 };
  return legalMoves(state).map((move) => ({
    move,
    score: -negamax(applyMove(state, move), depth - 1, -Infinity, Infinity, QUIESCENCE_PLIES, budget, 1),
  }));
}

const MATE_THRESHOLD = MATE - 100;
/** Sotto questa soglia la differenza e solo il bonus posizionale, non materiale vero. */
const MATERIAL_NOISE = 0.25;
export const isWinningScore = (score) => score >= MATE_THRESHOLD;
export const isLosingScore = (score) => score <= -MATE_THRESHOLD;

/**
 * Quanti pezzi avversari toccano la casella di arrivo. E il fatto che in
 * apertura distingue davvero una mossa dall'altra, quando il materiale e ancora
 * pari ovunque: andare a contatto apre il gioco, restare indietro lo tiene chiuso.
 */
function contacts(state, square, mover) {
  const [row, col] = squareToRC(square);
  let vicini = 0;
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const adiacente = rcToSquare(row + dr, col + dc);
    if (!adiacente) continue;
    const piece = state.board[adiacente];
    if (piece !== EMPTY && (piece > 0 ? 'white' : 'black') !== mover) vicini++;
  }
  return vicini;
}

function balanceLabel(delta) {
  if (delta >= 2.5) return 'guadagno netto di materiale';
  if (delta >= 0.75) return 'leggero vantaggio materiale';
  if (delta > -0.75) return 'materiale in parita';
  if (delta > -2.5) return 'leggero svantaggio materiale';
  return 'perdita netta di materiale';
}

/**
 * Dove finisce il pezzo, detto in modo che due mosse diverse suonino diverse.
 * Le descrizioni delle opzioni servono a separarle: se si somigliassero tutte,
 * al modello non resterebbe niente su cui distinguere.
 */
function placement(square, mover, piece, promotes) {
  if (promotes) return 'arriva in fondo e promuove a dama';

  const parti = [`finisce sulla traversa ${squareRow(square)} ${zoneOf(square)}`];
  if (isEdgeSquare(square)) parti.push('appoggiata alla sponda, dove non puo essere scavalcata di lato');
  if (isMan(piece)) {
    const mancanti = rowsToPromotion(square, mover);
    parti.push(mancanti === 0 ? 'e in fondo' : `le mancano ${mancanti} ${mancanti === 1 ? 'traversa' : 'traverse'} alla promozione`);
  }
  return parti.join(', ');
}

/**
 * Le candidate con il loro corredo di fatti gia calcolati e una descrizione
 * in italiano. La descrizione e un oggetto e non una frase unica: la
 * documentazione di TypeSafe accetta oggetti come criteri e raccomanda di
 * separare bene le opzioni, e campi distinti si confrontano meglio di una
 * prosa lunga.
 */
export function annotateMoves(state, options = {}) {
  const depth = options.depth ?? SEARCH_DEPTH;
  const mover = state.turn;
  const before = material(state, mover) - material(state, other(mover));
  const scored = scoreMoves(state, depth);

  return scored.map(({ move, score }) => {
    const after = applyMove(state, move);
    const replies = legalMoves(after);
    const replyCaptures = replies.length > 0 ? replies[0].captured.length : 0;
    const kingsTaken = move.captured.filter((square) => isKing(state.board[square])).length;
    const delta = score - before;

    const facts = {
      catture: move.captured.length,
      catturaDame: kingsTaken,
      promuove: move.promotes,
      sponda: isEdgeSquare(move.to),
      traversa: squareRow(move.to),
      rispostaAvversaria: replyCaptures,
      contatti: contacts(after, move.to, mover),
      avversarioSenzaMosse: replies.length === 0,
      punteggio: Number(score.toFixed(2)),
      bilancio: Number(delta.toFixed(2)),
      vittoriaForzata: isWinningScore(score),
      sconfittaForzata: isLosingScore(score),
      etichettaBilancio: isWinningScore(score)
        ? 'vittoria forzata'
        : isLosingScore(score)
          ? 'sconfitta forzata'
          : Math.abs(delta) < MATERIAL_NOISE ? 'materiale invariato' : balanceLabel(delta),
    };

    const descrizione = {
      mossa: move.captured.length > 0
        ? `${isKing(move.piece) ? 'La dama' : 'La pedina'} in ${move.from} mangia e arriva in ${move.to}`
        : `${isKing(move.piece) ? 'La dama' : 'La pedina'} si sposta da ${move.from} a ${move.to}`,
      prese: move.captured.length === 0
        ? 'non mangia niente'
        : `mangia ${move.captured.length} ${move.captured.length === 1 ? 'pezzo' : 'pezzi'} ` +
          `(caselle ${move.captured.join(', ')})` +
          (kingsTaken > 0 ? `, di cui ${kingsTaken} ${kingsTaken === 1 ? 'dama' : 'dame'}` : ''),
      arrivo: placement(move.to, mover, move.piece, move.promotes),
      contatto: facts.contatti === 0
        ? 'la casella di arrivo non tocca nessun pezzo avversario'
        : `la casella di arrivo tocca ${facts.contatti} ${facts.contatti === 1 ? 'pezzo avversario' : 'pezzi avversari'}`,
      risposta_avversaria: facts.avversarioSenzaMosse
        ? "dopo questa mossa l'avversario resta senza mosse legali e perde"
        : replyCaptures === 0
          ? "l'avversario non ha prese in risposta"
          : `l'avversario e obbligato a rispondere mangiando ${replyCaptures} ` +
            `${replyCaptures === 1 ? 'pezzo' : 'pezzi'}`,
      bilancio_dopo_gli_scambi: isWinningScore(score)
        ? 'questa mossa porta a una vittoria forzata'
        : isLosingScore(score)
          ? 'questa mossa porta a una sconfitta forzata'
          : Math.abs(delta) < MATERIAL_NOISE
            ? 'il materiale resta invariato dopo gli scambi forzati'
            : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} contando la dama 3 e la pedina 1: ` +
              balanceLabel(delta),
    };

    return { move, notation: moveNotation(move), facts, descrizione, score };
  });
}

/**
 * La mossa migliore secondo la sola ricerca locale. Non e Jev: serve come
 * ripiego dichiarato quando l'API non risponde, e a ordinare le candidate.
 */
export function heuristicBest(annotated) {
  if (annotated.length === 0) return null;
  const best = Math.max(...annotated.map((entry) => entry.score));
  const tied = annotated.filter((entry) => entry.score === best);
  return tied[Math.floor(Math.random() * tied.length)];
}
