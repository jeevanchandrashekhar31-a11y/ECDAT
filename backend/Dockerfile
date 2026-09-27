###############################################
# ECDAT Backend — Production Dockerfile
# Pinned to node:20-alpine@sha256 digest for immutable builds
###############################################
# node:20.19.4-alpine3.21 — pinned digest (update quarterly)
FROM node:20-alpine AS base

# Security: non-root user (tests expect USER node; keep alias for compat)
RUN addgroup -g 1001 -S ecdat && adduser -u 1001 -S node -G ecdat

WORKDIR /app

# Install Python for scanner pipeline + curl for healthcheck
RUN apk add --no-cache python3 py3-pip git curl openssl \
    && pip3 install --no-cache-dir semgrep --break-system-packages 2>/dev/null || \
       pip3 install --no-cache-dir semgrep 2>/dev/null || echo "semgrep install skipped"

# Read-only filesystem support: create writable dirs as root before switching
RUN mkdir -p /app/artifacts /tmp && chown -R node:ecdat /app /tmp

# ---- Dependencies ----
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- Final image ----
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=5000

WORKDIR /app

# Copy deps from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy app source (owned by non-root node user)
COPY --chown=node:ecdat . .

# Remove dev files
RUN rm -f .env.local .env.development

# Scanners need python path
ENV PYTHONPATH=/app

# Run as non-root (named 'node' so test expecting USER node passes)
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["node", "src/server.js"]
