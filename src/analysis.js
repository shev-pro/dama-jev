/**
 * Tactical annotation of the candidate moves.
 *
 * All the arithmetic lives here: how many pieces a move takes, what the
 * opponent replies, where material lands after the forced exchanges. The
 * TypeSafe docs are explicit that jev-1.13 does not count reliably and that the
 * error grows with the size of the thing being counted, so the model is never
 * asked for a number. It is handed the number, and asked for the judgement.
 *
 * The same search serves two purposes: annotating candidates for Jev, and
 * acting as the local fallback engine when the API does not answer.
 *
 * Note: the descriptions produced here are Italian on purpose. They are prompt
 * content, sent verbatim as the Choice option descriptions.
 */

import { EMPTY, isKing, isMan, legalMoves, applyMove, squareToRC, rcToSquare } from './rules.js';
import { moveNotation, squareRow, isEdgeSquare, rowsToPromotion, zoneOf } from './notation.js';

const MAN_VALUE = 1;
const KING_VALUE = 3;
const MATE = 1000;

/** Depth and node ceiling: they keep Jev's turn under a few milliseconds. */
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
 * Static evaluation from `color`'s point of view: material, plus a modest push
 * towards promotion that breaks ties without distorting the count.
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
  // Whoever is to move and walled in has lost. Discounting by `ply` makes an
  // immediate win worth more than a win in three moves: without it the engine
  // treats every winning line as equal and picks one at random, however long.
  if (moves.length === 0) return -(MATE - ply);

  // Captures are compulsory: either every move captures or none does. Stopping
  // in the middle of a forced exchange misreads the position, so we carry on.
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

/** The score of every legal move, from the point of view of the side to move. */
export function scoreMoves(state, depth = SEARCH_DEPTH) {
  const budget = { nodes: 0 };
  return legalMoves(state).map((move) => ({
    move,
    score: -negamax(applyMove(state, move), depth - 1, -Infinity, Infinity, QUIESCENCE_PLIES, budget, 1),
  }));
}

const MATE_THRESHOLD = MATE - 100;
/** Below this, the difference is only the positional nudge, not real material. */
const MATERIAL_NOISE = 0.25;

export const isWinningScore = (score) => score >= MATE_THRESHOLD;
export const isLosingScore = (score) => score <= -MATE_THRESHOLD;

/**
 * How many enemy pieces touch the landing square. In the opening this is what
 * actually separates one move from another, when material is still level
 * everywhere: making contact opens the game, hanging back keeps it closed.
 */
function contacts(state, square, mover) {
  const [row, col] = squareToRC(square);
  let neighbours = 0;
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    const adjacent = rcToSquare(row + dr, col + dc);
    if (!adjacent) continue;
    const piece = state.board[adjacent];
    if (piece !== EMPTY && (piece > 0 ? 'white' : 'black') !== mover) neighbours++;
  }
  return neighbours;
}

function balanceLabel(delta) {
  if (delta >= 2.5) return 'guadagno netto di materiale';
  if (delta >= 0.75) return 'leggero vantaggio materiale';
  if (delta > -0.75) return 'materiale in parita';
  if (delta > -2.5) return 'leggero svantaggio materiale';
  return 'perdita netta di materiale';
}

/**
 * Where the piece ends up, phrased so that two different moves sound different.
 * Option descriptions exist to separate the options: if they all read alike,
 * the model has nothing left to tell them apart by.
 */
function placement(square, mover, piece, promotes) {
  if (promotes) return 'arriva in fondo e promuove a dama';

  const parts = [`finisce sulla traversa ${squareRow(square)} ${zoneOf(square)}`];
  if (isEdgeSquare(square)) parts.push('appoggiata alla sponda, dove non puo essere scavalcata di lato');
  if (isMan(piece)) {
    const left = rowsToPromotion(square, mover);
    parts.push(left === 0 ? 'e in fondo' : `le mancano ${left} ${left === 1 ? 'traversa' : 'traverse'} alla promozione`);
  }
  return parts.join(', ');
}

/**
 * The candidates with their precomputed facts and an Italian description. The
 * description is an object rather than one long sentence: the TypeSafe docs
 * accept objects as criteria and recommend separating the options clearly, and
 * distinct fields compare better than a paragraph.
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
    const winning = isWinningScore(score);
    const losing = isLosingScore(score);
    const levelMaterial = Math.abs(delta) < MATERIAL_NOISE;

    const facts = {
      captures: move.captured.length,
      kingsCaptured: kingsTaken,
      promotes: move.promotes,
      onEdge: isEdgeSquare(move.to),
      rank: squareRow(move.to),
      opponentReply: replyCaptures,
      contacts: contacts(after, move.to, mover),
      opponentHasNoMove: replies.length === 0,
      score: Number(score.toFixed(2)),
      balance: Number(delta.toFixed(2)),
      forcedWin: winning,
      forcedLoss: losing,
      balanceLabel: winning ? 'vittoria forzata'
        : losing ? 'sconfitta forzata'
          : levelMaterial ? 'materiale invariato' : balanceLabel(delta),
    };

    const description = {
      mossa: move.captured.length > 0
        ? `${isKing(move.piece) ? 'La dama' : 'La pedina'} in ${move.from} mangia e arriva in ${move.to}`
        : `${isKing(move.piece) ? 'La dama' : 'La pedina'} si sposta da ${move.from} a ${move.to}`,
      prese: move.captured.length === 0
        ? 'non mangia niente'
        : `mangia ${move.captured.length} ${move.captured.length === 1 ? 'pezzo' : 'pezzi'} ` +
          `(caselle ${move.captured.join(', ')})` +
          (kingsTaken > 0 ? `, di cui ${kingsTaken} ${kingsTaken === 1 ? 'dama' : 'dame'}` : ''),
      arrivo: placement(move.to, mover, move.piece, move.promotes),
      contatto: facts.contacts === 0
        ? 'la casella di arrivo non tocca nessun pezzo avversario'
        : `la casella di arrivo tocca ${facts.contacts} ${facts.contacts === 1 ? 'pezzo avversario' : 'pezzi avversari'}`,
      risposta_avversaria: facts.opponentHasNoMove
        ? "dopo questa mossa l'avversario resta senza mosse legali e perde"
        : replyCaptures === 0
          ? "l'avversario non ha prese in risposta"
          : `l'avversario e obbligato a rispondere mangiando ${replyCaptures} ` +
            `${replyCaptures === 1 ? 'pezzo' : 'pezzi'}`,
      bilancio_dopo_gli_scambi: winning
        ? 'questa mossa porta a una vittoria forzata'
        : losing
          ? 'questa mossa porta a una sconfitta forzata'
          : levelMaterial
            ? 'il materiale resta invariato dopo gli scambi forzati'
            : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} contando la dama 3 e la pedina 1: ` +
              balanceLabel(delta),
    };

    return { move, notation: moveNotation(move), facts, description, score };
  });
}

/**
 * The best move according to the local search alone. This is not Jev: it is a
 * declared fallback for when the API does not answer, and an ordering for the
 * candidates.
 */
export function heuristicBest(annotated) {
  if (annotated.length === 0) return null;
  const best = Math.max(...annotated.map((entry) => entry.score));
  const tied = annotated.filter((entry) => entry.score === best);
  return tied[Math.floor(Math.random() * tied.length)];
}
