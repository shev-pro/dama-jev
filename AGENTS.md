# Orientamento

Dama internazionale 10x10 in 3D contro Jev, il System One model di TypeSafe.

**Leggi prima [README.md](README.md)**: contiene l'architettura, il motivo per cui esiste un server
locale (il CORS di `api.typesafe.ai`), la divisione del lavoro fra codice e modello, e la mappa dei
file.

## Prima di toccare il codice

- **`src/rules.js` è la fonte di verità sulle regole.** Nessun altro modulo decide cosa è legale. È
  coperto dai test e dal perft: se lo modifichi, `node --test` deve restare verde e il perft deve
  continuare a coincidere con i valori pubblicati (tabella in fondo al README).
- **Al modello non si chiedono numeri.** `jev-1.13` non conta in modo affidabile. Tutto ciò che si
  conta — pezzi, catture, materiale, conseguenze a poche mosse — si calcola in `src/analysis.js` e
  gli si consegna già fatto. Vale anche per le funzionalità nuove.
- **La chiave API non si scrive da nessuna parte.** Vive in una variabile di `src/app.js` e transita
  dal proxy. Niente localStorage, niente log, niente file.
- **Gli errori dell'API si mostrano come sono.** Nessuna mossa scelta da altri viene presentata come
  una scelta di Jev.

## Comandi

```bash
node --test        # i test
node server.js     # il gioco su http://localhost:5173
```

Il contratto dell'API è documentato dal vivo su <https://docs.typesafe.ai>. Le pagine sono servite
anche in markdown aggiungendo `.md` al percorso.
