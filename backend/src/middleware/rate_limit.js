/**
 * Tiered Rate Limiting Middleware — Phase 15.1
 *
 * Implements defenses against rate abuse, credential stuffing, and resource exhaustion.
 * - Global rate limiter (general API endpoints)
 * - Sensitive Auth rate limiter (login, refresh, token generation)
 * - Upload rate limiter (file/CBOM uploads)
 */

function createRateLimitMiddleware({
  windowMs = 60_000,
  max = 60,
  message = "Rate limit exceeded. Please retry later.",
  keyGenerator = (req) => req.ip || req.socket?.remoteAddress || "unknown",
} = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator(req);
    const bucket = buckets.get(key);
    const current =
      !bucket || now >= bucket.resetAt
        ? { count: 0, resetAt: now + windowMs }
        : bucket;

    current.count += 1;
    buckets.set(key, current);

    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader(
      "RateLimit-Remaining",
      String(Math.max(0, max - current.count)),
    );
    res.setHeader("RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));

    if (current.count > max) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((current.resetAt - now) / 1000)),
      );
      return res.status(429).json({
        error: "TooManyRequests",
        message,
        requestId: req.id,
      });
    }

    // Bound memory on a spray of unique addresses
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (now >= value.resetAt) buckets.delete(bucketKey);
      }
    }
    return next();
  };
}

// Global API rate limiter: 300 req/min
const globalRateLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  max: 300,
  message: "Global API rate limit exceeded.",
});

// Sensitive Auth rate limiter: 15 req/min (prevent brute-force & credential stuffing)
const authRateLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  max: 15,
  message: "Authentication rate limit exceeded. Please wait before retrying.",
});

// Upload rate limiter
const uploadRateLimiter = createRateLimitMiddleware({
  windowMs: 60_000,
  max: 60,
  message: "Upload rate limit exceeded. Retry later.",
});

module.exports = {
  createRateLimitMiddleware,
  globalRateLimiter,
  authRateLimiter,
  uploadRateLimiter,
};
