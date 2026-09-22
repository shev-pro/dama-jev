/**
 * Motore della dama internazionale 10x10 (regole FMJD).
 *
 * Modulo puro: nessun DOM, nessuna rete, nessuno stato globale mutabile.
 * Tutto quello che il resto dell'applicazione sa del gioco passa da qui.
 *
 * Le caselle giocabili sono le 50 scure, numerate 1-50 da sinistra a destra
 * e dall'alto in basso. Il nero parte dalle caselle 1-20, il bianco dalle 31-50,
 * e muove per primo il bianco.
 */

export const EMPTY = 0;
export const WHITE_MAN = 1;
export const WHITE_KING = 2;
export const BLACK_MAN = -1;
export const BLACK_KING = -2;

/** Le 25 mosse per parte senza catture ne mosse di pedina, contate in mezze mosse. */
export const DRAW_PLY_LIMIT = 50;

// Direzioni diagonali nell'ordine [su-sinistra, su-destra, giu-sinistra, giu-destra].
// Il bianco avanza verso l'alto (indici 0 e 1), il nero verso il basso (2 e 3).
const DIRECTIONS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const WHITE_FORWARD = [0, 1];
const BLACK_FORWARD = [2, 3];

export function squareToRC(square) {
  const index = square - 1;
  const row = Math.floor(index / 5);
  const offset = index % 5;
  return [row, row % 2 === 0 ? offset * 2 + 1 : offset * 2];
}

export function rcToSquare(row, col) {
  if (row < 0 || row > 9 || col < 0 || col > 9) return 0;
  if ((row + col) % 2 === 0) return 0; // casella chiara, non si gioca
  const offset = row % 2 === 0 ? (col - 1) / 2 : col / 2;
  return row * 5 + offset + 1;
}

/**
 * RAYS[casella][direzione] = le caselle incontrate allontanandosi in quella
 * direzione, dalla piu vicina alla piu lontana. Precalcolarle evita di rifare
 * l'aritmetica delle coordinate dentro la ricorsione delle catture.
 */
const RAYS = (() => {
  const rays = [];
  for (let square = 0; square <= 50; square++) rays.push([[], [], [], []]);

  for (let square = 1; square <= 50; square++) {
    const [row, col] = squareToRC(square);
    DIRECTIONS.forEach(([dr, dc], direction) => {
      let r = row + dr;
      let c = col + dc;
      for (let next = rcToSquare(r, c); next; next = rcToSquare(r, c)) {
        rays[square][direction].push(next);
        r += dr;
        c += dc;
      }
    });
  }
  return rays;
})();

export const colorOf = (piece) => (piece > 0 ? 'white' : piece < 0 ? 'black' : null);
export const isKing = (piece) => Math.abs(piece) === 2;
export const isMan = (piece) => Math.abs(piece) === 1;
const opponent = (turn) => (turn === 'white' ? 'black' : 'white');

const positionKey = (state) => `${state.board.join(',')}|${state.turn}`;

function withHistory(state) {
  state.history = [positionKey(state)];
  return state;
}

export function initialPosition() {
  const board = new Array(51).fill(EMPTY);
  for (let square = 1; square <= 20; square++) board[square] = BLACK_MAN;
  for (let square = 31; square <= 50; square++) board[square] = WHITE_MAN;
  return withHistory({ board, turn: 'white', halfmoveClock: 0, history: [] });
}

/**
 * Costruisce una posizione arbitraria da una mappa casella -> pezzo,
 * con 'w'/'b' per le pedine e 'W'/'B' per le dame. Serve ai test e alle
 * posizioni di studio; il gioco normale parte da initialPosition().
 */
export function positionFrom(pieces, turn = 'white') {
  const codes = { w: WHITE_MAN, W: WHITE_KING, b: BLACK_MAN, B: BLACK_KING };
  const board = new Array(51).fill(EMPTY);

  for (const [key, code] of Object.entries(pieces)) {
    const square = Number(key);
    if (!Number.isInteger(square) || square < 1 || square > 50) {
      throw new Error(`casella fuori scacchiera: ${key}`);
    }
    if (!(code in codes)) throw new Error(`pezzo sconosciuto: ${code}`);
    board[square] = codes[code];
  }
  if (turn !== 'white' && turn !== 'black') throw new Error(`tratto sconosciuto: ${turn}`);

  return withHistory({ board, turn, halfmoveClock: 0, history: [] });
}

/**
 * Tutte le sequenze di cattura che partono da `from`, gia complete: si fermano
 * solo dove non si puo piu mangiare.
 *
 * I due punti delicati del regolamento vivono qui. I pezzi catturati restano
 * sulla scacchiera fino alla fine della mossa, quindi continuano a bloccare il
 * passaggio; e nessuno di loro puo essere scavalcato una seconda volta.
 * Per questo `work` non li rimuove mai e `taken` tiene separato chi e gia preso.
 */
function captureSequences(board, from, piece) {
  const sequences = [];
  const work = board.slice();
  work[from] = EMPTY; // il pezzo e in volo: la casella di partenza e libera
  const taken = new Set();

  const enemy = opponent(colorOf(piece));
  const flying = isKing(piece);

  const walk = (at, path, captured) => {
    let continued = false;

    for (let direction = 0; direction < 4; direction++) {
      const ray = RAYS[at][direction];

      // La dama plana sulle caselle vuote fino al primo pezzo; la pedina
      // guarda solo la casella adiacente.
      let i = 0;
      if (flying) while (i < ray.length && work[ray[i]] === EMPTY) i++;
      if (i >= ray.length) continue;

      const victim = ray[i];
      if (work[victim] === EMPTY) continue;             // pedina: adiacente vuota
      if (colorOf(work[victim]) !== enemy) continue;    // pezzo proprio
      if (taken.has(victim)) continue;                  // gia mangiato: blocca e non si rimangia

      const landings = [];
      for (let j = i + 1; j < ray.length && work[ray[j]] === EMPTY; j++) {
        landings.push(ray[j]);
        if (!flying) break; // la pedina atterra solo subito dietro la preda
      }
      if (landings.length === 0) continue;

      taken.add(victim);
      for (const landing of landings) {
        continued = true;
        walk(landing, [...path, landing], [...captured, victim]);
      }
      taken.delete(victim);
    }

    // Una sequenza vale solo se e arrivata in fondo: finche si puo mangiare, si deve.
    if (!continued && captured.length > 0) sequences.push({ path, captured });
  };

  walk(from, [from], []);
  return sequences;
}

function quietDestinations(board, from, piece) {
  const destinations = [];
  const flying = isKing(piece);
  const directions = flying ? [0, 1, 2, 3] : piece > 0 ? WHITE_FORWARD : BLACK_FORWARD;

  for (const direction of directions) {
    for (const square of RAYS[from][direction]) {
      if (board[square] !== EMPTY) break;
      destinations.push(square);
      if (!flying) break; // la pedina avanza di una casella sola
    }
  }
  return destinations;
}

function buildMove(from, path, captured, piece) {
  const to = path[path.length - 1];
  const [row] = squareToRC(to);
  // La promozione guarda solo la casella di arrivo: una pedina che attraversa
  // l'ultima traversa durante una catena e prosegue resta pedina.
  const promotes = isMan(piece) && ((piece > 0 && row === 0) || (piece < 0 && row === 9));
  return { from, to, path, captured, promotes, piece };
}

/**
 * Le mosse legali per chi ha il tratto, gia filtrate dalla presa obbligatoria
 * e dalla regola della maggioranza: se esiste una cattura si deve catturare, e
 * fra le catture restano solo quelle che portano via piu pezzi.
 */
export function legalMoves(state) {
  const { board, turn } = state;
  const mine = turn === 'white' ? 1 : -1;
  const captures = [];

  for (let square = 1; square <= 50; square++) {
    const piece = board[square];
    if (piece === EMPTY || Math.sign(piece) !== mine) continue;
    for (const { path, captured } of captureSequences(board, square, piece)) {
      captures.push(buildMove(square, path, captured, piece));
    }
  }

  if (captures.length > 0) {
    const best = Math.max(...captures.map((move) => move.captured.length));
    return captures.filter((move) => move.captured.length === best);
  }

  const quiet = [];
  for (let square = 1; square <= 50; square++) {
    const piece = board[square];
    if (piece === EMPTY || Math.sign(piece) !== mine) continue;
    for (const to of quietDestinations(board, square, piece)) {
      quiet.push(buildMove(square, [square, to], [], piece));
    }
  }
  return quiet;
}

export function applyMove(state, move) {
  const board = state.board.slice();
  board[move.from] = EMPTY;
  for (const square of move.captured) board[square] = EMPTY;
  board[move.to] = move.promotes ? (move.piece > 0 ? WHITE_KING : BLACK_KING) : move.piece;

  // Il contatore della patta riparte da zero appena qualcosa diventa irreversibile.
  const irreversible = move.captured.length > 0 || isMan(move.piece);

  const next = {
    board,
    turn: opponent(state.turn),
    halfmoveClock: irreversible ? 0 : state.halfmoveClock + 1,
    history: state.history,
  };
  next.history = [...state.history, positionKey(next)];
  return next;
}

export function countPieces(state) {
  let white = 0;
  let black = 0;
  for (let square = 1; square <= 50; square++) {
    const piece = state.board[square];
    if (piece > 0) white++;
    else if (piece < 0) black++;
  }
  return { white, black };
}

function repetitions(state) {
  const key = positionKey(state);
  return state.history.reduce((count, seen) => count + (seen === key ? 1 : 0), 0);
}

export function gameStatus(state) {
  const { white, black } = countPieces(state);
  if (white === 0) return 'black_wins';
  if (black === 0) return 'white_wins';

  if (state.halfmoveClock >= DRAW_PLY_LIMIT) return 'draw';
  if (repetitions(state) >= 3) return 'draw';

  // Chi ha il tratto e non ha mosse legali ha perso: e murato.
  if (legalMoves(state).length === 0) return state.turn === 'white' ? 'black_wins' : 'white_wins';

  return 'playing';
}
