# Dama × Jev

[![CI](https://github.com/shev-pro/dama-jev/actions/workflows/ci.yml/badge.svg)](https://github.com/shev-pro/dama-jev/actions/workflows/ci.yml)

A 3D game of **international draughts** (10×10) where the opponent is **Jev**, the System One
model from [TypeSafe](https://docs.typesafe.ai). You play White and move first.

Jev does not generate text and does not reason out loud. It returns a *typed judgement* with a
probability distribution. So every turn, the code hands it all the legal moves as the options of a
single **Choice**, and Jev picks one. The side panel shows the full distribution, which means you
watch the decision happen instead of just receiving it.

<sub>The game interface is in Italian — *dama* is the Italian name for draughts.</sub>

---

## Run it

```bash
node server.js
```

Then open <http://localhost:5173>. The page asks for your TypeSafe API key and you play.

No `npm install`. The server uses nothing but the Node standard library (v20 or newer), and
Three.js is loaded from a CDN at runtime.

### With Docker

```bash
docker compose up --build
```

Or straight from the published image:

```bash
docker run --rm -p 127.0.0.1:5173:5173 ghcr.io/shev-pro/dama-jev
```

The container is bound to loopback on purpose — see [Your API key](#your-api-key).

---

## Why there is a server at all

The original idea was a single HTML file you could open by double-clicking. That is not possible:
`api.typesafe.ai` enforces a server-side origin allowlist, and a browser preflight is rejected with
`400 Disallowed CORS origin` — for every origin tried, including `localhost` and `file://`, and
before authentication even happens. The documentation says nothing about CORS; this is measured
behaviour.

So `server.js` does exactly two things: it serves the page, and it forwards `POST /api/systemone`
to TypeSafe, copying the `Authorization` header through. If TypeSafe ever allowlists an origin, the
server becomes unnecessary.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `5173` | Port to listen on |
| `HOST` | `127.0.0.1` | Interface to bind (`0.0.0.0` inside the container) |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,[::1]` | Accepted `Host` and `Origin` names |

### Your API key

The page asks for it and keeps it in a JavaScript variable. It is **never** written to
localStorage, never written to disk, and the server forwards it without reading or logging it.
Reloading the page (Cmd+Shift+R) asks for it again.

Because the process handles someone's API key on every request, it binds to loopback and rejects
any `Host` or `Origin` it does not expect — a guard against DNS rebinding. Exposing it on a network
means deliberately adding that hostname to `ALLOWED_HOSTS`.

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
  -v "$PWD/certs:/certs:ro" \
  -e NODE_EXTRA_CA_CERTS=/certs/corporate-ca.pem \
  ghcr.io/shev-pro/dama-jev
```

`docker-compose.yml` carries the same thing as a commented block. `certs/` is gitignored.

---

## How the work is split

The TypeSafe documentation is explicit: `jev-1.13` **does not count reliably**, and the error grows
with the size of the thing being counted. That single fact shapes the whole design.

| The code does | Jev does |
| --- | --- |
| Generate legal moves, including forced capture and the majority rule | Pick which one to play |
| Count pieces, material, captures | Judge which stance to adopt |
| Work out the opponent's reply and where material lands after forced exchanges | Rate how dangerous the position is |

Every option reaches Jev already annotated with those numbers, in plain language. The model never
has to count. It has to decide.

One turn is **one request** carrying three questions (`mossa`, `postura`, `rischio`). Questions in
a single request are evaluated in parallel, so extra questions cost little latency. When only one
move is legal, no request is sent at all — there is nothing to choose.

`postura` and `rischio` are **independent** judgements about the position, not an explanation of
the chosen move, and the panel labels them as such. The docs warn that structural invariants across
separate questions are not guaranteed, and presenting them as a rationale would be a lie in the UI.

A typical mid-game turn is about 1,400 input tokens — roughly $0.00006.

## When something goes wrong

- **API errors** (401, 422, 429, 529, timeout): the panel shows TypeSafe's actual message, with
  **Retry** and **Let the local engine move**. A local-engine move is always labelled as *not*
  Jev's. It is never passed off as the model's choice.
- **An answer that is not a legal move**: falls back to the most probable option that *is* legal,
  and says so in the panel.
- **Low confidence is not an error.** It usually means several moves look equally good to Jev. It
  is displayed, but no behaviour depends on it.

---

## The rules

International draughts (FMJD): 10×10 board, 20 pieces each, men capture backwards as well as
forwards, kings are flying, capture is compulsory and subject to the **majority rule** — you must
play the sequence that takes the most pieces.

The two rules that move generators usually get wrong are both implemented: captured pieces stay on
the board until the move ends, so they keep blocking; and no piece may be jumped twice. Promotion
happens only if the move *ends* on the far rank — a man that passes through and carries on
capturing stays a man.

Draws are simplified to 25 moves per side without a capture or a man move, plus threefold
repetition. The FMJD endgame rules for king-only positions are not implemented.

## Layout

| File | Responsibility |
| --- | --- |
| `src/rules.js` | The engine: legal moves, captures, promotion, game end. Pure. |
| `src/notation.js` | Notation `32-28` / `33x24x13`, 1–50 numbering, text board. |
| `src/analysis.js` | Search and tactical annotation of candidates. Doubles as the fallback engine. |
| `src/selection.js` | The human's move selection, one hop at a time. Pure. |
| `src/jev.js` | Building the System One request, calling it, interpreting the answer. |
| `src/scene.js` | Three.js: board, pieces, lighting, animation, picking. |
| `src/app.js` | Turns, panel, error handling. |
| `server.js` | Static server and bridge to TypeSafe. |

## Tests

```bash
node --test
```

53 tests, zero dependencies. The engine is also checked with **perft** from the opening position
against the published values for international draughts — one wrong capture anywhere and the totals
stop matching:

| depth | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nodes | 9 | 81 | 658 | 4,265 | 27,117 | 167,140 | 1,049,442 |

CI runs the suite and builds the image for `linux/amd64` and `linux/arm64` on every push.
