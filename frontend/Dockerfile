# Stage 1: Build Frontend Assets with pinned builder digest
FROM node:20-alpine@sha256:20a068eb0d0891d1e43e263c9db862ecbe6ff4ad599f6aa6a188be2849896796 AS builder

WORKDIR /app
ENV SOURCE_DATE_EPOCH=0

# Copy dependency specifications
COPY package.json package-lock.json* ./

# Install dependencies deterministically without executing arbitrary scripts
RUN npm ci --ignore-scripts

# Copy application source
COPY . .

# Build production bundle
RUN npm run build

# Stage 2: Serve with Nginx with pinned runner digest
FROM nginx:alpine@sha256:28929e7c5b6b19a0a2df3324c43ee7d76ee676b744d0c1154c1ff06a13241b44

# Remove default static files and configurations
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# Copy built distribution from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy hardened unprivileged Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Configure ownership for unprivileged nginx user (UID 101)
RUN chown -R nginx:nginx /usr/share/nginx/html /etc/nginx \
    && chmod -R 0555 /usr/share/nginx/html /etc/nginx \
    && touch /tmp/nginx.pid \
    && chown nginx:nginx /tmp/nginx.pid

# Drop root privileges completely
USER nginx
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
