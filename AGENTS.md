# Orientation

International draughts (10×10) in 3D against Jev, the System One model from TypeSafe.

**Read [README.md](README.md) first**: it covers the architecture, why a local server exists (the
CORS allowlist on `api.typesafe.ai`), how the work is split between code and model, and the file
map.

## Before touching the code

- **`src/rules.js` is the source of truth on the rules.** No other module decides what is legal. It
  is covered by the tests and by perft: if you change it, `node --test` must stay green and the
  perft totals must keep matching the published values (table at the end of the README).
- **Never ask the model for a number.** `jev-1.13` does not count reliably. Everything that gets
  counted — pieces, captures, material, consequences a few moves out — is computed in
  `src/analysis.js` and handed over already done. That holds for new features too.
- **The API key is never written anywhere.** It lives in a variable in `src/app.js` and passes
  through the proxy. No localStorage, no logs, no files.
- **API errors are shown as they are.** A move chosen by anything other than Jev is never presented
  as Jev's choice.

## Language

Code, comments and tests are English. Two things stay Italian on purpose, and should stay that way:

- **The game interface** — the whole thing is an Italian game of *dama*.
- **Everything sent to Jev**, in `src/jev.js` and the descriptions built in `src/analysis.js`. That
  is prompt content. Translating it changes what the model reads, and would invalidate the
  behaviour that was verified against it.

## Commands

```bash
node --test        # the tests
node server.js     # the game on http://localhost:5173
docker compose up --build
```

The API contract is documented live at <https://docs.typesafe.ai>. Pages are also served as
markdown by appending `.md` to the path.
