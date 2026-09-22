# A minimal image: the game has no npm dependencies, so there is nothing to
# install and nothing to build. Copy the files and start the stdlib server.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY server.js index.html ./
COPY server ./server
COPY src ./src

# The leaderboard is written here. Mount a volume over it to keep it across
# rebuilds; without one it lives and dies with the container.
RUN mkdir -p /app/data && chown -R node:node /app

# Inside a container we must listen on every interface, or the port mapping
# never reaches the process. Who can actually get here is limited by the
# host-side port binding instead (see docker-compose.yml).
ENV HOST=0.0.0.0 \
    PORT=5173 \
    LEADERBOARD_FILE=/app/data/leaderboard.json \
    NODE_ENV=production

EXPOSE 5173
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=3s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node

CMD ["node", "server.js"]
