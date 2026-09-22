/**
 * Il client di Jev: costruisce la richiesta System One, la manda attraverso il
 * proxy locale e rimappa la risposta sulle mosse vere.
 *
 * Il modello non genera testo e non ragiona ad alta voce: restituisce un
 * giudizio tipizzato con la distribuzione di probabilita. Il compito di questo
 * modulo e presentargli una domanda onesta, con le opzioni gia annotate dei
 * fatti che lui non saprebbe calcolare, e riportare indietro la sua risposta
 * senza abbellirla.
 */

import { renderBoard, BOARD_LEGEND, piecesOf } from './notation.js';

export const MODEL = 'jev-latest';
export const ENDPOINT = '/api/systemone';

/** L'API ne accetta 255; restiamo sotto, e comunque ordinate per qualita. */
export const MAX_OPTIONS = 200;

const POSTURE_OPTIONS = {
  attacco: 'Cerchi lo scontro: punti a mangiare, a forzare l avversario e a togliergli pezzi.',
  scambio: 'Punti ad alleggerire la posizione con cambi alla pari, per semplificare.',
  difesa: 'Sei sotto pressione: tieni compatta la struttura e non concedi prese.',
  corsa_alla_dama: 'Il tuo piano e portare una pedina in fondo e farla dama.',
  consolidamento: 'Nessuna urgenza: sistemi i pezzi e migliori la posizione senza forzare.',
};

const RISK_LEVELS = [
  'Posizione tranquilla: nessuna minaccia concreta contro di te.',
  'Qualche tensione, ma niente che ti costi materiale subito.',
  'L avversario ha una minaccia seria che devi tenere d occhio.',
  'Sei in pericolo: rischi di perdere materiale a breve.',
  'Posizione compromessa: stai per subire un danno grave o decisivo.',
];

const phaseOf = (total) => (total > 30 ? 'apertura' : total > 14 ? 'mediogioco' : 'finale');

/**
 * Le candidate da mandare al modello. In dama i numeri sono piccoli, ma se una
 * posizione di dame volanti ne producesse troppe si tagliano le peggiori, mai
 * le migliori: l'ordine viene dalla ricerca locale.
 */
function selectCandidates(annotated) {
  if (annotated.length <= MAX_OPTIONS) return { candidates: annotated, dropped: 0 };
  const ordered = [...annotated].sort((a, b) => b.score - a.score);
  return { candidates: ordered.slice(0, MAX_OPTIONS), dropped: annotated.length - MAX_OPTIONS };
}

export function buildRequest({ state, annotated, jevColor, lastOpponentMove = null, recentMoves = [] }) {
  const foeColor = jevColor === 'white' ? 'black' : 'white';
  const mine = piecesOf(state, jevColor);
  const theirs = piecesOf(state, foeColor);
  const { candidates, dropped } = selectCandidates(annotated);

  const criteria = {};
  for (const entry of candidates) criteria[entry.notation] = entry.descrizione;

  const request = {
    model: MODEL,
    state: {
      scacchiera: renderBoard(state, jevColor),
      legenda: BOARD_LEGEND,
      tu_giochi: jevColor === 'black'
        ? 'il nero, che parte in alto e avanza verso il basso'
        : 'il bianco, che parte in basso e avanza verso l alto',
      tuoi_pezzi: { pedine: mine.men, dame: mine.kings, totale: mine.total },
      pezzi_avversario: { pedine: theirs.men, dame: theirs.kings, totale: theirs.total },
      materiale: {
        tuo: mine.total,
        avversario: theirs.total,
        differenza: mine.total - theirs.total,
        nota: 'Questi conteggi sono gia calcolati: usali cosi come sono.',
      },
      fase: phaseOf(mine.total + theirs.total),
      ultima_mossa_avversario: lastOpponentMove ?? 'nessuna, e la prima mossa della partita',
      mosse_recenti: recentMoves,
    },
    questions: {
      mossa: {
        type: 'choice',
        instructions: {
          situazione: 'Stai giocando una partita di dama internazionale 10x10 contro un avversario umano. Tocca a te.',
          domanda: 'Quale di queste mosse giochi?',
          come_leggere_le_opzioni:
            'Ogni opzione e una mossa gia verificata come legale. I campi prese, ' +
            'risposta_avversaria e bilancio_dopo_gli_scambi contengono conteggi gia fatti ' +
            'per te: prendili per buoni invece di ricontarli sulla scacchiera.',
          cosa_premiare:
            'Preferisci le mosse che ti lasciano piu materiale dopo gli scambi forzati, ' +
            'che portano le pedine verso la promozione e che non regalano prese all avversario.',
          nota_sulle_prese:
            'Nella dama internazionale la presa e obbligatoria e si deve sempre mangiare il ' +
            'massimo numero di pezzi possibile, quindi tutte le opzioni qui sotto rispettano ' +
            'gia quel vincolo: non devi verificarlo.',
        },
        criteria,
      },
      postura: {
        type: 'choice',
        instructions: {
          domanda: 'Guardando la posizione nel suo insieme, quale atteggiamento ti conviene adesso?',
          nota: 'Valuta la posizione in generale, indipendentemente dalla singola mossa che sceglierai.',
        },
        criteria: POSTURE_OPTIONS,
      },
      rischio: {
        type: 'score',
        instructions: {
          domanda: 'Quanto e pericolosa per te la posizione in questo momento?',
          nota: 'Guarda le minacce dell avversario contro di te, non le tue possibilita.',
        },
        criteria: RISK_LEVELS,
      },
    },
  };

  return { request, candidates, dropped };
}

export class JevError extends Error {
  constructor(message, { status = 0, type = 'error', body = null } = {}) {
    super(message);
    this.name = 'JevError';
    this.status = status;
    this.type = type;
    this.body = body;
  }
}

function errorMessage(status, body) {
  const detail = body?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.message) return detail.message;

  if (status === 401) return 'Chiave API rifiutata da TypeSafe.';
  if (status === 422) return 'TypeSafe ha rifiutato la richiesta come malformata.';
  if (status === 429) return 'Hai superato il limite di richieste: aspetta qualche secondo.';
  if (status === 529) return 'TypeSafe e sovraccarico in questo momento.';
  return `TypeSafe ha risposto ${status}.`;
}

export async function askJev({ apiKey, request, signal, fetchImpl = globalThis.fetch }) {
  const startedAt = performance.now();

  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(request),
    signal,
  });

  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (!response.ok) {
    throw new JevError(errorMessage(response.status, body), {
      status: response.status,
      type: body?.detail?.error_type ?? 'http_error',
      body,
    });
  }
  if (!body) throw new JevError('TypeSafe ha risposto con qualcosa che non e JSON.', { status: response.status });

  return { body, latencyMs: Math.round(performance.now() - startedAt) };
}

/**
 * Rimappa la risposta sulle mosse vere.
 *
 * `choice` e per definizione l'opzione con la probabilita piu alta, ma se per
 * qualsiasi motivo tornasse una stringa che non corrisponde a nessuna candidata
 * si ripiega sulla piu probabile fra quelle valide, dicendolo. Non si gioca mai
 * una mossa inventata spacciandola per una scelta di Jev.
 */
export function interpret(body, candidates) {
  const answer = body?.answers?.mossa;
  if (!answer || answer.type !== 'choice') {
    throw new JevError('La risposta di TypeSafe non contiene la scelta della mossa.', { body });
  }

  const index = new Map(candidates.map((entry) => [entry.notation, entry]));
  const probabilities = answer.probabilities ?? {};

  let entry = index.get(answer.choice);
  let note = null;

  if (!entry) {
    const valid = Object.entries(probabilities)
      .filter(([notation]) => index.has(notation))
      .sort((a, b) => b[1] - a[1]);

    if (valid.length === 0) {
      throw new JevError(`Jev ha risposto "${answer.choice}", che non corrisponde a nessuna mossa legale.`, { body });
    }
    entry = index.get(valid[0][0]);
    note = `Jev ha risposto "${answer.choice}", che non e fra le mosse legali. ` +
      `Ho giocato ${entry.notation}, la piu probabile fra quelle valide.`;
  }

  // La distribuzione completa, ordinata, con l'annotazione di ogni mossa a fianco.
  const ranking = candidates
    .map((candidate) => ({
      entry: candidate,
      notation: candidate.notation,
      probability: probabilities[candidate.notation] ?? 0,
      chosen: candidate.notation === entry.notation,
    }))
    .sort((a, b) => b.probability - a.probability);

  const posture = body?.answers?.postura ?? null;
  const risk = body?.answers?.rischio ?? null;

  return {
    entry,
    ranking,
    confidence: typeof answer.confidence === 'number' ? answer.confidence : null,
    posture: posture && {
      choice: posture.choice,
      confidence: posture.confidence ?? null,
      probabilities: posture.probabilities ?? {},
    },
    risk: risk && {
      score: risk.score,
      levels: RISK_LEVELS.length,
      legend: risk.legend ?? {},
      confidence: risk.confidence ?? null,
    },
    usage: body?.usage ?? null,
    model: body?.model ?? null,
    note,
  };
}

export { POSTURE_OPTIONS, RISK_LEVELS };
