/** A small dependency-free fixed-window limiter for authenticated upload routes. */
function createRateLimitMiddleware({ windowMs = 60_000, max = 60 } = {}) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket?.remoteAddress || "unknown";
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
        message: "Upload rate limit exceeded. Retry later.",
        requestId: req.id,
      });
    }

    // Bound memory even on a spray of unique source addresses.
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (now >= value.resetAt) buckets.delete(bucketKey);
      }
    }
    return next();
  };
}

module.exports = { createRateLimitMiddleware };
