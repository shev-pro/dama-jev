# Dama × Jev

[![CI](https://github.com/shev-pro/dama-jev/actions/workflows/ci.yml/badge.svg)](https://github.com/shev-pro/dama-jev/actions/workflows/ci.yml)

A 3D game of draughts where the opponent is **Jev**, the System One model from
[TypeSafe](https://docs.typesafe.ai). You play White. Three variants: international 10×10,
English draughts and Italian *dama*.

Jev does not generate text and does not reason out loud. It returns a *typed judgement* with a
probability distribution. Every turn the server hands it all the legal moves as the options of a
single **Choice**, and Jev picks one. The panel shows the full distribution, the exact JSON that
went to TypeSafe and the exact JSON that came back, so you watch the decision happen instead of
just receiving it.

<sub>The game interface is in Italian — *dama* is the Italian name for draughts.</sub>

---

## Run it

```bash
node server.js
```

Then open <http://localhost:5173>. Pick a name and a variant and play.

No `npm install`. The server uses nothing but the Node standard library (v20 or newer), and
Three.js is loaded from a CDN at runtime.

### With Docker

```bash
docker compose up --build
```

Or straight from the published image:

```bash
docker run --rm -p 127.0.0.1:5173:5173 -v "$PWD/data:/app/data" ghcr.io/shev-pro/dama-jev
```

### Configuration

| Variable | Default | What it does |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | unset | When set, the page never asks for a key **and refuses one** |
| `PORT` | `5173` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind (`0.0.0.0` inside the container) |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | Accepted `Host` and `Origin` names |
| `LEADERBOARD_FILE` | `data/leaderboard.json` | Where finished games are recorded |

---

## The server owns the game

The browser sends **commands**, never a ready-made request:

```
GET  /api/config                 what variants exist, and whether a key is needed
POST /api/games                  { variant, playerName, apiKey? }
POST /api/games/:id/move         { path: [21, 17] }
POST /api/games/:id/jev          { local?: true }
GET  /api/leaderboard?variant=…
```

That single decision buys three things at once.

**You cannot cheat the board.** The position lives on the server. A move is sent as the list of
squares it travels through, and if that path is not in the server's own legal-move list, it does
not happen — whatever the page believes. The legal moves arrive as data; the browser computes
none of them, and carries neither the rules nor the search engine.

**A configured key cannot be siphoned off.** There is no endpoint that forwards an arbitrary
payload to TypeSafe, so there is nothing to point at your key. A game is also capped at 400
TypeSafe calls, which is an order of magnitude more than a game of draughts needs.

**The leaderboard means something**, because the server is the one that decided the result.

### Why there is a server at all

Beyond that: `api.typesafe.ai` enforces a server-side origin allowlist, and a browser preflight is
rejected with `400 Disallowed CORS origin` — for every origin tried, including `localhost` and
`file://`, and before authentication even happens. The documentation says nothing about CORS; this
is measured behaviour. A page could not reach the API on its own even if we wanted it to.

### Your API key

If `TYPESAFE_API_KEY` is set, nobody is asked for a key and nobody may supply one.

Otherwise the page asks for it, holds it in a JavaScript variable, and sends it once when the game
is created. The server keeps it in memory for the length of that game and nothing more. It is
**never** written to localStorage, to disk, or to the leaderboard. The leaderboard file holds a
display name, a variant, a result and a few counters — nothing else.

### Behind a TLS-inspecting corporate proxy

If your network runs TLS inspection (Zscaler, Cato, Netskope and friends), the container will not
trust the certificate it is shown in place of TypeSafe's, and every call fails with
`SELF_SIGNED_CERT_IN_CHAIN`. Your Mac works because the corporate root CA is in its keychain; a
fresh Alpine container has never heard of it.

The fix is to give the container that CA — **not** to turn off certificate verification:

```bash
mkdir -p certs
security find-certificate -a -c "<your corporate root CA>" -p \
  /Library/Keychains/System.keychain > certs/corporate-ca.pem

docker run --rm -p 127.0.0.1:5173:5173 \
  -v "$PWD/certs:/certs:ro" -e NODE_EXTRA_CA_CERTS=/certs/corporate-ca.pem \
  ghcr.io/shev-pro/dama-jev
```

`docker-compose.yml` carries the same thing as a commented block. `certs/` is gitignored.

---

## The variants

Everything that differs between them is a field in `server/variants.js`. The engine is one piece of
code; a variant is data.

| | International | English | Italian |
| --- | --- | --- | --- |
| Board | 10×10, 20 pieces | 8×8, 12 pieces | 8×8, 12 pieces |
| Dark square at | near left | near left | near **right** |
| Opens | White | **Black** (squares 1–12) | White |
| Man captures backwards | yes | no | no |
| Man may capture a king | yes | yes | **no** |
| King | flying | one square | one square |
| Among captures | most pieces | **free choice** | four-tier priority |
| Crossing the last rank mid-chain | carries on as a man | crowned, turn ends | crowned, turn ends |

The Italian priority chain, in the order the regulation gives it (FID *Regolamento Tecnico* 2025,
art. 1.1.6.6–1.1.6.9): most pieces first, then capturing **with** a king rather than a man, then
the most kings captured, then the kings taken earliest.

The Italian board is mirrored — art. 1.1.2.3 puts a dark square at each player's bottom right. That
does not change how many moves exist, but it changes which square every number names, so getting it
wrong would print notation that means a different move than the official one. The landmarks in
art. 1.1.2.8 (left edge 1·9·17·25, right edge 8·16·24·32, main diagonal 1·5·10·14·19·23·28·32) are
asserted in the test suite.

Rules sourced from the [FID technical regulation](https://www.federdama.org/) and the
[WCDF rules](https://nccheckers.org/NCCA/WCDF%20Checker%20-%20Draughts%20-%20English%20Rules.htm).

---

## How the work is split

The TypeSafe documentation is explicit: `jev-1.13` **does not count reliably**, and the error grows
with the size of the thing being counted. That single fact shapes the whole design.

| The code does | Jev does |
| --- | --- |
| Generate legal moves under the variant's own rules | Pick which one to play |
| Count pieces, material, captures | Judge which stance to adopt |
| Work out the opponent's reply and where material lands after forced exchanges | Rate how dangerous the position is |

Every option reaches Jev already annotated with those numbers, in plain language, along with a
description of the variant's own capture rules. The model never has to count. It has to decide.

One turn is **one request** carrying three questions. Questions in a single request are evaluated in
parallel, so extra questions cost little latency. When only one move is legal, no request is sent at
all — there is nothing to choose. A typical mid-game turn is about 1,400 input tokens, roughly
$0.00006.

`posture` and `risk` are **independent** judgements about the position, not an explanation of the
chosen move, and the panel labels them as such. The docs warn that structural invariants across
separate questions are not guaranteed, and presenting them as a rationale would be a lie in the UI.

## When something goes wrong

- **API errors** (401, 422, 429, 529, timeout): the panel shows TypeSafe's actual message, with
  **Retry** and **Let the local engine move**. A local-engine move is always labelled as *not*
  Jev's. It is never passed off as the model's choice.
- **An answer that is not a legal move**: falls back to the most probable option that *is* legal,
  and says so.
- **Low confidence is not an error.** It usually means several moves look equally good to Jev.

---

## Layout

| | |
| --- | --- |
| `server/rules.js` | The engine, for every variant. Pure. |
| `server/variants.js` | What each variant changes. |
| `server/games.js` | The games in progress, and the authority over them. |
| `server/analysis.js` | Search and tactical annotation. Doubles as the fallback engine. |
| `server/jev.js` | Building the System One request, calling it, reading the answer. |
| `server/notation.js` | Notation, the text board, piece lists. |
| `server/leaderboard.js` | Finished games, in a JSON file. |
| `server.js` | HTTP: the command API and the static files. |
| `src/board.js` | Geometry and piece encoding. The only module both sides share. |
| `src/api.js` | The four commands the page may send. |
| `src/scene.js` | Three.js: board, pieces, lighting, animation, picking. |
| `src/selection.js` | The player's move selection, one hop at a time. Pure. |
| `src/app.js` | Turns, panel, error handling. |

## Tests

```bash
node --test
```

81 tests, zero dependencies. The engine is checked with **perft** against published counts — one
wrong capture anywhere and the totals stop matching:

| depth | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| international | 9 | 81 | 658 | 4,265 | 27,117 | 167,140 | 1,049,442 | |
| english | 7 | 49 | 302 | 1,469 | 7,361 | 36,768 | 179,740 | 845,931 |
| italian | 7 | 49 | 302 | 1,469 | 7,361 | 36,473 | 177,532 | 828,783 |

Every cell in that table is asserted by the test suite, so the numbers printed here cannot drift
away from the ones actually checked.

The Italian counts were produced independently by two engines — Rein Halbersma's `dctl` and Ed
Gilbert's Kingsrow Italian. The suite also runs three of Gilbert's mid-game positions, which have
kings on the board from the first ply and therefore exercise the whole four-tier priority chain,
the short king and the rule that a man may not take a king.

CI runs the suite and builds the image for `linux/amd64` and `linux/arm64` on every push.
