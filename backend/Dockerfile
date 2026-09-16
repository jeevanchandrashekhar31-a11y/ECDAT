# Build from the repository root: docker build -f backend/Dockerfile .
# Pinned immutable minimal base image (Node 20 LTS Alpine)
FROM node:20-alpine@sha256:20a068eb0d0891d1e43e263c9db862ecbe6ff4ad599f6aa6a188be2849896796

WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000 \
    SOURCE_DATE_EPOCH=0 \
    NPM_CONFIG_CACHE=/tmp/.npm

# Install dependencies using deterministic lockfile without executing untrusted scripts
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY backend/src ./src
COPY backend/knexfile.js ./knexfile.js
COPY rules /rules
COPY docker/backend-entrypoint.sh /usr/local/bin/ecdat-backend

# Enforce least-privilege permissions and non-root ownership
RUN chmod 0555 /usr/local/bin/ecdat-backend \
    && chown -R node:node /app /rules \
    && chmod -R 0555 /app /rules

USER node
EXPOSE 5000

# Hardened health check executing node script against local loopback interface
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:5000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/ecdat-backend"]
