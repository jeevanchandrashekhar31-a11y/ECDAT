# Build from the repository root: docker build -f backend/Dockerfile .
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/src ./src
COPY backend/knexfile.js ./knexfile.js
COPY rules /rules
COPY docker/backend-entrypoint.sh /usr/local/bin/ecdat-backend

RUN chmod 0555 /usr/local/bin/ecdat-backend \
    && chown -R node:node /app /rules

USER node
EXPOSE 5000

ENTRYPOINT ["/usr/local/bin/ecdat-backend"]
