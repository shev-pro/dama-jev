# Immagine minima: il gioco non ha dipendenze npm, quindi niente install e
# niente build. Si copiano i file e si avvia il server della libreria standard.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.js index.html ./
COPY src ./src

# Dentro un container serve ascoltare su tutte le interfacce, altrimenti la
# mappatura delle porte non raggiunge il processo. A limitare chi puo arrivare
# ci pensa il binding sull'host (vedi docker-compose.yml).
ENV HOST=0.0.0.0 \
    PORT=5173 \
    NODE_ENV=production

EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=3s --start-period=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "server.js"]
