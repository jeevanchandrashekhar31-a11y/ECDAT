/**
 * PM2 Ecosystem Configuration — ECDAT Production Cluster
 *
 * Enables multi-process Node.js clustering for horizontal scaling.
 * Run: pm2 start ecosystem.config.js
 * Monitor: pm2 monit
 * Logs: pm2 logs ecdat-backend
 */

module.exports = {
  apps: [
    {
      // ── Backend API (clustered) ────────────────────────────────────────────
      name: "ecdat-backend",
      script: "src/server.js",
      cwd: "./backend",

      // Cluster mode — spawns one worker per CPU core
      instances: "max",
      exec_mode: "cluster",

      // Graceful restart on OOM or unhandled exception
      max_memory_restart: "512M",
      restart_delay: 2000,
      max_restarts: 10,

      // Environment
      env: {
        NODE_ENV: "production",
        AUTH_MODE: "demo",
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: "production",
        AUTH_MODE: "production",
        PORT: 3001,
      },
      env_demo: {
        NODE_ENV: "production",
        AUTH_MODE: "demo",
        PORT: 3001,
      },

      // Logs
      out_file: "./logs/backend-out.log",
      error_file: "./logs/backend-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,

      // Zero-downtime reload
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,

      // Source maps for cleaner stack traces
      source_map_support: true,

      // Watch (dev only — disabled in prod)
      watch: false,
      ignore_watch: ["node_modules", "logs", "dist", "coverage"],

      // PM2+ metrics
      pmx: true,
    },

    {
      // ── Frontend static server (single instance via serve) ───────────────
      // Only needed if you're NOT using Nginx/Caddy to serve the dist/ folder.
      name: "ecdat-frontend",
      script: "npx",
      args: "serve -s frontend/dist -l 5173 --no-clipboard",
      interpreter: "none",

      instances: 1,
      exec_mode: "fork",

      env: {
        NODE_ENV: "production",
      },

      out_file: "./logs/frontend-out.log",
      error_file: "./logs/frontend-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      autorestart: true,
      watch: false,
    },
  ],
};
