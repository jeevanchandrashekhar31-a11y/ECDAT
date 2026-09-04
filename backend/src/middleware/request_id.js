const crypto = require("crypto");

/**
 * Middleware that assigns a unique request ID to each incoming request,
 * propagating client-provided X-Request-Id or generating a new UUIDv4.
 */
function requestIdMiddleware(req, res, next) {
  const existingId = req.headers["x-request-id"];
  const requestId =
    typeof existingId === "string" &&
    /^[A-Za-z0-9._-]{1,128}$/.test(existingId.trim())
      ? existingId.trim()
      : crypto.randomUUID();

  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

module.exports = requestIdMiddleware;
