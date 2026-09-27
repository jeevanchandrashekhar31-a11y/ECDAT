###############################################
# ECDAT Backend — Production Dockerfile
# Build context: repo root (so rules/ is accessible)
###############################################
FROM node:20-bookworm-slim AS base

WORKDIR /app

# Install Python for scanner pipeline + curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-venv git curl openssl build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create a proper virtual environment for Python packages (fixes PEP 668 and permissions)
RUN python3 -m venv /opt/venv && chown -R node:node /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install dependencies from requirements.txt
COPY backend/requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt
RUN pip3 install --no-cache-dir semgrep

# Read-only filesystem support: create writable dirs as root before switching
RUN mkdir -p /app/artifacts /tmp && chown -R node:node /app /tmp

# ---- Dependencies ----
FROM base AS deps

WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---- Final image ----
FROM base AS runner

ENV NODE_ENV=production
ENV PORT=5000

WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy backend source
COPY --chown=node:node backend/ ./

# Copy rules directory to /rules (where config.js resolves: /app/src/../../rules = /rules)
# Must run as root before USER node
COPY rules/ /rules/
RUN chown -R node:node /rules

# Remove dev files
RUN rm -f .env.local .env.development

# Scanners need python path
ENV PYTHONPATH=/app

# Run as non-root
USER node

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1

CMD ["node", "src/server.js"]
