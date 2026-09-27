###############################################
# ECDAT Frontend — Production Dockerfile
# Pinned to immutable @sha256 digests for reproducible builds
###############################################
# node:20.19.4-alpine3.21
FROM node:20-alpine@sha256:e0a9acb63210b4a1027e9eb534fd26e3a059d025e95f4d8e4038b2c3b46ce87a AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .

# Build with production API URL
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

###############################################
# Nginx — serve built assets + proxy API
# nginx:1.27.5-alpine3.21 pinned digest
###############################################
FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f8a4f7c076e83a2f81f0de AS runner

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Non-root: nginx official image uses 'nginx' user (uid 101)
USER nginx

# Read-only filesystem compatibility: tmpfs mount point for nginx cache/pid
ENV TMPDIR=/tmp

# Copy nginx config
COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/ecdat.conf

# Copy built files
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost/health-check || exit 1

CMD ["nginx", "-g", "daemon off;"]
