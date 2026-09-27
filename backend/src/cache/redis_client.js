/**
 * ECDAT Redis Client
 * Provides session store, rate limiting, and scan result caching.
 * Falls back gracefully to in-memory when Redis is not available.
 */

const Redis = require("ioredis");

let redisClient = null;
let isRedisAvailable = false;

/**
 * Initialize Redis connection from REDIS_URL env var.
 * Fails silently — app continues in degraded (in-memory) mode.
 */
function initRedis() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.log("[Redis] REDIS_URL not set — running in in-memory mode");
    return null;
  }

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 500, 2000);
      },
      enableOfflineQueue: false,
      lazyConnect: false,
      connectTimeout: 5000,
      tls: redisUrl.startsWith("rediss://") ? { rejectUnauthorized: false } : undefined,
    });

    client.on("connect", () => {
      isRedisAvailable = true;
      console.log("[Redis] ✓ Connected");
    });

    client.on("error", (err) => {
      if (isRedisAvailable) {
        console.warn("[Redis] Connection error — falling back to in-memory:", err.message);
      }
      isRedisAvailable = false;
    });

    client.on("close", () => {
      isRedisAvailable = false;
    });

    redisClient = client;
    return client;
  } catch (err) {
    console.warn("[Redis] Failed to initialize:", err.message);
    return null;
  }
}

function getRedisClient() {
  return redisClient;
}

function isRedisReady() {
  return isRedisAvailable && redisClient && redisClient.status === "ready";
}

/**
 * Redis-backed token blacklist (replaces in-memory Set).
 * Used for JWT revocation on logout/session invalidation.
 */
const tokenBlacklist = {
  async add(jti, ttlSeconds = 900) {
    if (isRedisReady()) {
      await redisClient.setex(`blacklist:${jti}`, ttlSeconds, "1");
    } else {
      inMemoryBlacklist.add(jti);
    }
  },

  async has(jti) {
    if (isRedisReady()) {
      const val = await redisClient.get(`blacklist:${jti}`);
      return val === "1";
    }
    return inMemoryBlacklist.has(jti);
  },
};

// In-memory fallback for blacklist
const inMemoryBlacklist = new Set();

/**
 * Redis-backed session cache.
 * Stores user session data with TTL.
 */
const sessionCache = {
  async set(sessionId, data, ttlSeconds = 900) {
    if (isRedisReady()) {
      await redisClient.setex(`session:${sessionId}`, ttlSeconds, JSON.stringify(data));
    }
  },

  async get(sessionId) {
    if (isRedisReady()) {
      const val = await redisClient.get(`session:${sessionId}`);
      return val ? JSON.parse(val) : null;
    }
    return null;
  },

  async del(sessionId) {
    if (isRedisReady()) {
      await redisClient.del(`session:${sessionId}`);
    }
  },
};

/**
 * Redis-backed scan result cache (5min TTL for expensive computations).
 */
const scanCache = {
  async set(key, data, ttlSeconds = 300) {
    if (isRedisReady()) {
      await redisClient.setex(`scan:${key}`, ttlSeconds, JSON.stringify(data));
    }
  },

  async get(key) {
    if (isRedisReady()) {
      const val = await redisClient.get(`scan:${key}`);
      return val ? JSON.parse(val) : null;
    }
    return null;
  },

  async invalidate(scanId) {
    if (isRedisReady()) {
      const keys = await redisClient.keys(`scan:*${scanId}*`);
      if (keys.length > 0) await redisClient.del(...keys);
    }
  },
};

/**
 * Sliding window rate limiter backed by Redis.
 * Falls back to in-memory Map when Redis unavailable.
 */
const inMemoryRateMap = new Map();

const rateLimiter = {
  async isAllowed(key, maxRequests, windowSeconds) {
    if (isRedisReady()) {
      const redisKey = `rl:${key}`;
      const now = Date.now();
      const windowStart = now - windowSeconds * 1000;

      const pipe = redisClient.pipeline();
      pipe.zremrangebyscore(redisKey, 0, windowStart);
      pipe.zadd(redisKey, now, `${now}-${Math.random()}`);
      pipe.zcard(redisKey);
      pipe.expire(redisKey, windowSeconds + 1);
      const results = await pipe.exec();

      const count = results[2][1];
      return count <= maxRequests;
    }

    // In-memory fallback
    const now = Date.now();
    const entry = inMemoryRateMap.get(key) || { count: 0, reset: now + windowSeconds * 1000 };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + windowSeconds * 1000; }
    entry.count++;
    inMemoryRateMap.set(key, entry);
    return entry.count <= maxRequests;
  },
};

module.exports = {
  initRedis,
  getRedisClient,
  isRedisReady,
  tokenBlacklist,
  sessionCache,
  scanCache,
  rateLimiter,
};
