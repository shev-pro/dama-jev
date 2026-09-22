# Orientation

Draughts in 3D against Jev, the System One model from TypeSafe. Three variants: international
10×10, English and Italian.

**Read [README.md](README.md) first**: it covers the command API, why the server owns the game, the
variant table with its sources, how the work is split between code and model, and the file map.

## Before touching the code

- **The server is the authority.** `server/` holds the rules, the search and the TypeSafe client;
  `src/` holds a renderer. The page sends commands and receives state. Do not move rules or search
  into `src/`: it would hand every player an engine and make the leaderboard meaningless.
- **There is no forwarding endpoint, and there must never be one.** The browser cannot ask the
  server to send an arbitrary payload to TypeSafe. That is what stops a configured
  `TYPESAFE_API_KEY` from becoming a free pass to the API.
- **`server/rules.js` is the source of truth on the rules, and a variant is data.** Everything that
  differs lives in `server/variants.js`. If a new rule needs a branch inside the move generator,
  it belongs in the variant table instead.
- **Perft is the regression test that matters.** If you change the generator, `node --test` must
  stay green: the published counts for all three variants and Gilbert's Italian positions are in
  `test/perft.test.js`. A change that moves those numbers is a bug until proven otherwise.
- **Never ask the model for a number.** `jev-1.13` does not count reliably. Everything that gets
  counted — pieces, captures, material, consequences a few moves out — is computed in
  `server/analysis.js` and handed over already done.
- **The prompt must describe the variant being played.** `promptRules` in `server/variants.js` is
  part of the request. Adding a variant without writing one means telling the model the rules of a
  different game.
- **No API key is ever written anywhere.** It lives in memory for the length of a game. The
  leaderboard file holds a name, a variant, a result and counters, and the tests assert that.
- **API errors are shown as they are.** A move chosen by anything other than Jev is never presented
  as Jev's choice.

## Language

Code, comments and tests are English. Two things stay Italian on purpose, and should stay that way:

- **The game interface** — the whole thing is an Italian game of *dama*.
- **Everything sent to Jev**, in `server/jev.js` and the descriptions built in
  `server/analysis.js`. That is prompt content. Translating it changes what the model reads, and
  would invalidate the behaviour that was verified against it.

## Commands

```bash
node --test        # the tests
node server.js     # the game on http://localhost:5173
docker compose up --build
```

The API contract is documented live at <https://docs.typesafe.ai>. Pages are also served as
markdown by appending `.md` to the path.
