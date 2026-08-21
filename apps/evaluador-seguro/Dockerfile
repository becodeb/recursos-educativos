# Node 24: trae node:sqlite estable, así que la app no necesita dependencias npm.
FROM node:24-alpine

WORKDIR /app
COPY server ./server
COPY public ./public

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/evaluador.db

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://localhost:8080/api/health || exit 1
CMD ["node", "server/server.js"]
