const config = require("../config");

/**
 * 404 Route Not Found Handler.
 */
function notFoundHandler(req, res, _next) {
  res.status(404).json({
    error: "NotFound",
    message: `Resource '${req.method} ${req.originalUrl}' not found`,
    requestId: req.id,
  });
}

/**
 * Centralized Application Error Handler.
 * Catches invalid JSON, CORS violations, and unexpected internal errors.
 */
function errorHandler(err, req, res, _next) {
  const requestId = req.id || "unknown";

  // 1. JSON Body Parser Syntax Error (Bad JSON)
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      error: "BadRequest",
      message:
        "Invalid JSON payload. Please verify JSON formatting and syntax.",
      requestId,
    });
  }

  if (
    err.type === "entity.too.large" ||
    err.status === 413 ||
    err.code === "LIMIT_FILE_SIZE"
  ) {
    return res.status(413).json({
      error: "PayloadTooLarge",
      message: "Payload exceeds the configured upload size limit.",
      requestId,
    });
  }

  // 2. CORS Violation
  if (err.message && err.message.startsWith("CORS Error:")) {
    return res.status(403).json({
      error: "Forbidden",
      message: "Origin is not permitted.",
      requestId,
    });
  }

  // 3. Known Client-side Validation Errors
  if (err.statusCode || err.status) {
    const status = err.statusCode || err.status;
    return res.status(status).json({
      error: err.name || "ClientError",
      message: err.message,
      requestId,
    });
  }

  // 4. Internal Server Error (500)
  if (config.NODE_ENV !== "test") {
    console.error(
      `[ERROR] [${requestId}] Unhandled Server Error: ${err.message || err.name || "Error"}\n`,
      err.stack || err
    );
  }

  return res.status(500).json({
    error: "InternalServerError",
    message: "An unexpected internal server error occurred.",
    requestId,
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
