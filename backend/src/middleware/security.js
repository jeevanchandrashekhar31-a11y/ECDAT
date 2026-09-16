const helmet = require("helmet");
const cors = require("cors");
const config = require("../config");

/**
 * Redacts potential sensitive data (keys, passwords, tokens) from logged objects.
 */
function redactSecrets(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const clone = Array.isArray(obj) ? [...obj] : { ...obj };
  const sensitiveKeys = [
    "password",
    "secret",
    "token",
    "authorization",
    "api_key",
    "apikey",
    "x-api-key",
    "private_key",
  ];

  for (const key of Object.keys(clone)) {
    const keyLower = key.toLowerCase();
    if (sensitiveKeys.some((s) => keyLower.includes(s))) {
      clone[key] = "[REDACTED]";
    } else if (typeof clone[key] === "object") {
      clone[key] = redactSecrets(clone[key]);
    }
  }
  return clone;
}

/**
 * Configures CORS with strict origin validation from the allowlist.
 */
function createCorsMiddleware() {
  const allowedOrigins = config.CORS_ORIGIN || [];

  return cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow any local development origin (localhost, 127.0.0.1, [::1] on any dev port)
      try {
        const parsed = new URL(origin);
        if (
          parsed.hostname === "localhost" ||
          parsed.hostname === "127.0.0.1" ||
          parsed.hostname === "[::1]" ||
          parsed.hostname === "0.0.0.0"
        ) {
          return callback(null, true);
        }
      } catch {}

      return callback(new Error("CORS Error: origin is not in the allowlist."));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-API-Key",
      "X-CSRF-Token",
      "X-Tenant-Id",
    ],
  });
}

/**
 * Structured request logging with request ID and secret redaction.
 */
function requestLoggerMiddleware(req, res, next) {
  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const rawPath = req.originalUrl || req.url || "";
    // Strip any sensitive query parameters from log paths
    const sanitizedPath = rawPath.replace(
      /([?&](?:api_key|apiKey|key|token)=)[^&]+/gi,
      "$1[REDACTED]",
    );

    const logEntry = {
      timestamp: new Date().toISOString(),
      requestId: req.id,
      method: req.method,
      path: sanitizedPath,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip || req.connection?.remoteAddress,
    };

    // Keep log output clean and structured
    if (config.NODE_ENV !== "test") {
      const level =
        res.statusCode >= 500
          ? "ERROR"
          : res.statusCode >= 400
            ? "WARN"
            : "INFO";
      console.log(
        `[${logEntry.timestamp}] [${level}] [${logEntry.requestId}] ${logEntry.method} ${logEntry.path} ${logEntry.statusCode} ${logEntry.durationMs}ms`,
      );
    }
  });

  next();
}

module.exports = {
  helmetMiddleware: helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        formAction: ["'self'"],
        frameAncestors: ["'self'", ...config.CORS_ORIGIN],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        upgradeInsecureRequests: [],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  }),
  corsMiddleware: createCorsMiddleware(),
  requestLoggerMiddleware,
  redactSecrets,
};
