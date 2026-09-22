import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { GameStore, GameError, HUMAN, JEV } from '../server/games.js';
import { positionFrom } from '../server/rules.js';
import { Leaderboard } from '../server/leaderboard.js';

async function makeStore(options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'dama-test-'));
  const store = new GameStore({ leaderboardFile: path.join(directory, 'leaderboard.json'), ...options });
  return { store, file: store.leaderboard.file };
}

const KEY = 'ts-chiave-di-prova';

test('a game needs a key from somebody', async () => {
  const { store } = await makeStore();
  assert.equal(store.needsClientKey, true);

  assert.throws(() => store.create({ variant: 'italian', playerName: 'X' }), GameError);
  assert.ok(store.create({ variant: 'italian', playerName: 'X', apiKey: KEY }));
});

test('a server key is used and a client key is refused outright', async () => {
  const { store } = await makeStore({ serverApiKey: 'ts-del-server' });
  assert.equal(store.needsClientKey, false);

  // Nobody has to hand a key to the page, and nobody gets to substitute one.
  const game = store.create({ variant: 'english', playerName: 'X' });
  assert.equal(game.apiKey, 'ts-del-server');

  assert.throws(
    () => store.create({ variant: 'english', playerName: 'X', apiKey: 'ts-sua' }),
    (error) => error instanceof GameError && error.status === 403,
  );
});

test('an unknown variant is refused', async () => {
  const { store } = await makeStore();
  assert.throws(() => store.create({ variant: 'marziana', playerName: 'X', apiKey: KEY }), GameError);
});

test('the view never carries the API key', async () => {
  const { store } = await makeStore();
  const game = store.create({ variant: 'italian', playerName: 'Sergio', apiKey: KEY });

  assert.ok(!JSON.stringify(store.view(game)).includes(KEY));
});

test('the view offers legal moves only when it is the human\'s turn', async () => {
  const { store } = await makeStore();

  const italian = store.create({ variant: 'italian', playerName: 'X', apiKey: KEY });
  assert.equal(store.view(italian).turn, HUMAN);
  assert.equal(store.view(italian).legalMoves.length, 7);

  // English draughts opens with the side on squares 1-12, which here is Jev.
  const english = store.create({ variant: 'english', playerName: 'X', apiKey: KEY });
  assert.equal(store.view(english).turn, JEV);
  assert.deepEqual(store.view(english).legalMoves, []);
});

test('a move that is not in the legal list does not happen', async () => {
  const { store } = await makeStore();
  const game = store.create({ variant: 'italian', playerName: 'X', apiKey: KEY });

  // This is the whole reason the server holds the position.
  await assert.rejects(() => store.playHuman(game, [1, 99]), GameError);
  await assert.rejects(() => store.playHuman(game, [21, 25]), GameError, 'backwards is not legal');
  await assert.rejects(() => store.playHuman(game, 'ciao'), GameError);
  await assert.rejects(() => store.playHuman(game, [21]), GameError);

  assert.deepEqual(game.history, [], 'nothing was committed');
});

test('a move out of turn is refused', async () => {
  const { store } = await makeStore();
  const english = store.create({ variant: 'english', playerName: 'X', apiKey: KEY });

  await assert.rejects(
    () => store.playHuman(english, [21, 17]),
    (error) => error instanceof GameError && error.status === 409,
  );
});

test('a legal move is applied and recorded in the history', async () => {
  const { store } = await makeStore();
  const game = store.create({ variant: 'italian', playerName: 'X', apiKey: KEY });

  const move = await store.playHuman(game, [21, 17]);
  assert.equal(move.from, 21);
  assert.deepEqual(game.history, [{ color: HUMAN, notation: '21-17' }]);
  assert.equal(store.view(game).turn, JEV);
});

test('Jev may be asked to move only on its own turn', async () => {
  const { store } = await makeStore();
  const game = store.create({ variant: 'italian', playerName: 'X', apiKey: KEY });

  await assert.rejects(
    () => store.playJev(game),
    (error) => error instanceof GameError && error.status === 409,
  );
});

test('the local engine plays without calling TypeSafe at all', async () => {
  const { store } = await makeStore();
  const game = store.create({ variant: 'italian', playerName: 'X', apiKey: KEY });
  await store.playHuman(game, [21, 17]);

  const result = await store.playJev(game, { useLocalEngine: true });

  assert.equal(result.source, 'local');
  assert.equal(result.request, null, 'nothing was built for TypeSafe');
  assert.equal(result.response, null);
  assert.equal(game.jevRequests, 0, 'and nothing was spent');
  assert.ok(result.ranking.length > 0);
});

test('a single legal move is played without asking Jev anything', async () => {
  const { store } = await makeStore();
  const game = store.create({ variant: 'italian', playerName: 'X', apiKey: KEY });

  // Black has exactly one capture available, so there is nothing to choose.
  game.state = positionFrom({ 18: 'b', 22: 'w', 30: 'w' }, 'black', 'italian');

  const result = await store.playJev(game);
  assert.equal(result.source, 'forced');
  assert.equal(result.request, null);
  assert.equal(game.jevRequests, 0);
});

test('a finished game reaches the leaderboard, exactly once', async () => {
  const { store, file } = await makeStore();
  const game = store.create({ variant: 'italian', playerName: '  Sergio  ', apiKey: KEY });

  // One white man, one black man, and a capture that clears the board.
  game.state = positionFrom({ 22: 'w', 18: 'b' }, 'white', 'italian');
  await store.playHuman(game, [22, 13]);

  assert.equal(store.view(game).status, 'white_wins');
  await store.leaderboard.writing;

  const standings = await store.leaderboard.standings('italian');
  assert.equal(standings.length, 1);
  assert.deepEqual(
    { name: standings[0].name, wins: standings[0].wins, played: standings[0].played },
    { name: 'Sergio', wins: 1, played: 1 },
  );

  // Playing on is refused, so the result cannot be written twice.
  await assert.rejects(() => store.playHuman(game, [13, 9]), GameError);
  assert.equal((await store.leaderboard.standings('italian')).length, 1);

  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.games.length, 1);
  assert.ok(!JSON.stringify(saved).includes(KEY), 'the key is not in the file either');
});

test('an abandoned game leaves no trace', async () => {
  const { store } = await makeStore();
  const game = store.create({ variant: 'italian', playerName: 'Fantasma', apiKey: KEY });
  await store.playHuman(game, [21, 17]);

  assert.deepEqual(await store.leaderboard.standings('italian'), []);
  assert.equal(game.recorded, false);
});

test('idle games are swept away, and an unknown id is refused', async () => {
  const { store } = await makeStore();
  const game = store.create({ variant: 'italian', playerName: 'X', apiKey: KEY });

  assert.equal(store.get(game.id).id, game.id);

  store.sweep(Date.now() + 3 * 60 * 60 * 1000);
  assert.throws(() => store.get(game.id), (error) => error instanceof GameError && error.status === 404);
});

test('standings rank by wins, then win rate, then the quickest win', async () => {
  const { store } = await makeStore();
  const record = (name, result, moves) =>
    store.leaderboard.record({ name, variant: 'italian', result, moves });

  await record('Due vittorie', 'win', 60);
  await record('Due vittorie', 'win', 58);
  await record('Una vittoria netta', 'win', 40);
  await record('Una vittoria lenta', 'win', 90);
  await record('Una vittoria lenta', 'loss', 30);

  const standings = await store.leaderboard.standings('italian');
  assert.deepEqual(standings.map((row) => row.name), [
    'Due vittorie',        // 2 wins
    'Una vittoria netta',  // 1 win, 100% rate
    'Una vittoria lenta',  // 1 win, 50% rate
  ]);
  assert.equal(standings[0].bestWinMoves, 58);
});

test('display names are trimmed to something printable', () => {
  assert.equal(Leaderboard.cleanName('   '), 'Anonimo');
  assert.equal(Leaderboard.cleanName(null), 'Anonimo');
  assert.equal(Leaderboard.cleanName('  Sergio   Rossi  '), 'Sergio Rossi');
  assert.equal(Leaderboard.cleanName('x'.repeat(50)).length, 24);
  assert.equal(Leaderboard.cleanName(`a${String.fromCharCode(7)}b`), 'a b');
});
