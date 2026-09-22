import { geometryFor } from '../src/board.js';

/**
 * The draughts variants the game can be played in.
 *
 * Every rule that differs between them is a field here, so the engine stays one
 * piece of code and a variant is data. Adding a variant must never mean adding
 * a branch inside the move generator.
 *
 * `captureChoice` picks which capture sequences survive when several exist:
 *   'maximum' - the ones taking the most pieces (international)
 *   'free'    - all of them; the player chooses (English draughts)
 *   'italian' - the Italian chain of tie-breaks, see rules.js
 */

export const VARIANTS = {
  international: {
    id: 'international',
    name: 'Dama internazionale',
    shortName: 'Internazionale',
    description: 'Scacchiera 10x10, 20 pezzi. La pedina cattura anche all\'indietro, la dama e volante, presa obbligatoria con la regola della maggioranza.',
    size: 10,
    pieceRows: 4,
    boardParity: 1,
    menCaptureBackwards: true,
    flyingKings: true,
    captureChoice: 'maximum',
    menCanCaptureKings: true,
    promotionEndsMove: false,
    firstPlayer: 'white',
    drawPlyLimit: 50,
    kingValue: 3,
    promptRules: 'Nella dama internazionale la presa e obbligatoria e si deve sempre mangiare il '
      + 'massimo numero di pezzi possibile. La pedina cattura in tutte le direzioni e la dama e '
      + 'volante. Una pedina che attraversa l ultima traversa durante una catena prosegue e resta pedina.',
  },

  english: {
    id: 'english',
    name: 'Dama inglese',
    shortName: 'Inglese',
    description: 'Scacchiera 8x8, 12 pezzi. La pedina cattura solo in avanti, la dama muove di una casella, presa obbligatoria ma senza regola della maggioranza. Muove per primo il nero.',
    size: 8,
    pieceRows: 3,
    boardParity: 1,
    menCaptureBackwards: false,
    flyingKings: false,
    captureChoice: 'free',
    menCanCaptureKings: true,
    promotionEndsMove: true,
    firstPlayer: 'black',
    drawPlyLimit: 80,
    kingValue: 1.6,
    promptRules: 'Nella dama inglese la presa e obbligatoria ma NON esiste la regola della '
      + 'maggioranza: fra le catture possibili puoi scegliere liberamente, anche una corta. '
      + 'La pedina cattura solo in avanti e la dama muove di una casella per volta. Una pedina '
      + 'che arriva sull ultima traversa promuove e il turno finisce subito.',
  },

  italian: {
    id: 'italian',
    name: 'Dama italiana',
    shortName: 'Italiana',
    description: 'Scacchiera 8x8, 12 pezzi. La pedina cattura solo in avanti e non puo prendere una dama, la dama muove di una casella. Presa obbligatoria con la catena di priorita italiana.',
    size: 8,
    pieceRows: 3,
    boardParity: 0,
    menCaptureBackwards: false,
    flyingKings: false,
    captureChoice: 'italian',
    menCanCaptureKings: false,
    promotionEndsMove: true,
    firstPlayer: 'white',
    drawPlyLimit: 80,
    kingValue: 1.6,
    promptRules: 'Nella dama italiana la presa e obbligatoria e vale una catena di priorita: si '
      + 'mangia il maggior numero di pezzi, poi si deve mangiare con la dama anziche con la pedina, '
      + 'poi il maggior numero di dame, poi le dame il prima possibile. La pedina cattura solo in '
      + 'avanti e non puo mai prendere una dama. La dama muove di una casella per volta. Una pedina '
      + 'che arriva sull ultima traversa promuove e il turno finisce subito.',
  },
};

export const DEFAULT_VARIANT = 'international';

export const variantOf = (id) => VARIANTS[id] ?? VARIANTS[DEFAULT_VARIANT];
export const isKnownVariant = (id) => Object.hasOwn(VARIANTS, id);

/** What the client needs to draw the picker, without leaking anything else. */
export const variantSummaries = () =>
  Object.values(VARIANTS).map(({ id, name, shortName, description, size, pieceRows, boardParity, firstPlayer }) =>
    ({ id, name, shortName, description, size, pieceRows, boardParity, firstPlayer }));

/** The coordinate system a variant plays on. */
export const geometryOf = (variant) => geometryFor(variant.size, variant.boardParity);
