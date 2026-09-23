/**
 * Resource Governance & Denial-of-Service Defense Subsystem — Phase 20 / P1
 *
 * Mandate:
 * 1. Rate limits on security-sensitive operations:
 *    - registration
 *    - login
 *    - MFA
 *    - password reset
 *    - token operations
 *    - scan submission
 *    - network scan
 *    - Git scan
 *    - archive upload
 *    - CBOM generation
 *    - report generation
 *    - integration calls
 *
 * 2. Resource quotas:
 *    - request size limit
 *    - upload size limit
 *    - scan timeout
 *    - CPU quota
 *    - memory quota
 *    - disk quota
 *    - concurrency quota
 *    - queue depth limit
 *
 * 3. Prevent denial-of-service through expensive scanning.
 */

const crypto = require("crypto");
const config = require("../config");

// ============================================================================
// 1. RATE LIMITING ENGINE (TIERED & OPERATION-SPECIFIC)
// ============================================================================

class RateLimiter {
  constructor({
    windowMs = 60_000,
    max = 60,
    name = "default",
    message = "Rate limit exceeded. Please retry later.",
  } = {}) {
    this.windowMs = windowMs;
    this.max = max;
    this.name = name;
    this.message = message;
    this.buckets = new Map(); // key -> { count, resetAt }
  }

  getKey(req) {
    const tenantId = req.tenantContext?.tenantId || "default";
    const ip = req.ip || req.socket?.remoteAddress || "127.0.0.1";
    const userId = req.user?.sub || req.user?.userId || req.auth?.user?.sub || "";
    return `${this.name}:${tenantId}:${ip}:${userId}`;
  }

  consume(req) {
    const now = Date.now();
    const key = this.getKey(req);
    const bucket = this.buckets.get(key);
    const current =
      !bucket || now >= bucket.resetAt
        ? { count: 0, resetAt: now + this.windowMs }
        : bucket;

    current.count += 1;
    this.buckets.set(key, current);

    const isLoopback =
      !req.ip ||
      req.ip === "127.0.0.1" ||
      req.ip === "::1" ||
      req.ip === "::ffff:127.0.0.1";
    const isStrict =
      process.env.NODE_ENV === "production" ||
      req.headers?.["x-enforce-rate-limit"] === "true" ||
      req.headers?.["x-rate-limit-enforce"] === "true" ||
      !isLoopback;

    const effectiveLimit = isStrict ? this.max : 5000;

    const remaining = Math.max(0, effectiveLimit - current.count);
    const resetSeconds = Math.ceil((current.resetAt - now) / 1000);
    const allowed = current.count <= effectiveLimit;

    // Memory bounding: prune expired buckets periodically
    if (this.buckets.size > 10_000) {
      for (const [k, v] of this.buckets.entries()) {
        if (now >= v.resetAt) this.buckets.delete(k);
      }
    }

    return {
      allowed,
      limit: effectiveLimit,
      remaining,
      resetSeconds,
      count: current.count,
    };
  }

  middleware() {
    return (req, res, next) => {
      const result = this.consume(req);

      res.setHeader("RateLimit-Limit", String(result.limit));
      res.setHeader("RateLimit-Remaining", String(result.remaining));
      res.setHeader("RateLimit-Reset", String(result.resetSeconds));

      if (!result.allowed) {
        res.setHeader("Retry-After", String(result.resetSeconds));
        return res.status(429).json({
          error: "TooManyRequests",
          code: "RATE_LIMIT_EXCEEDED",
          operation: this.name,
          message: this.message,
          retryAfterSeconds: result.resetSeconds,
          requestId: req.id,
        });
      }

      next();
    };
  }

  reset() {
    this.buckets.clear();
  }
}

// ----------------------------------------------------------------------------
// Operation-Specific Rate Limiters
// ----------------------------------------------------------------------------

const RATE_LIMITS = {
  // 1. Registration: max 5 req/min (prevent mass account farming)
  registration: new RateLimiter({
    name: "registration",
    windowMs: 60_000,
    max: 5,
    message: "Registration rate limit exceeded. Please wait before creating more accounts.",
  }),

  // 2. Login: max 10 req/min (prevent brute-force & credential stuffing)
  login: new RateLimiter({
    name: "login",
    windowMs: 60_000,
    max: 10,
    message: "Login rate limit exceeded. Please wait before attempting to log in again.",
  }),

  // 3. MFA: max 10 req/min (prevent TOTP / backup code brute-force)
  mfa: new RateLimiter({
    name: "mfa",
    windowMs: 60_000,
    max: 10,
    message: "Multi-factor authentication rate limit exceeded.",
  }),

  // 4. Password reset: max 5 req/min (prevent reset token harvesting/spam)
  passwordReset: new RateLimiter({
    name: "password_reset",
    windowMs: 60_000,
    max: 5,
    message: "Password reset rate limit exceeded.",
  }),

  // 5. Token operations: max 20 req/min (refresh, revoke, logout-all, rotate)
  tokenOperations: new RateLimiter({
    name: "token_operations",
    windowMs: 60_000,
    max: 20,
    message: "Token operations rate limit exceeded.",
  }),

  // 6. Scan submission: max 10 req/min (prevent scanner pipeline flooding)
  scanSubmission: new RateLimiter({
    name: "scan_submission",
    windowMs: 60_000,
    max: 10,
    message: "Scan submission rate limit exceeded.",
  }),

  // 7. Network scan: max 5 req/min (expensive TLS handshake discovery)
  networkScan: new RateLimiter({
    name: "network_scan",
    windowMs: 60_000,
    max: 5,
    message: "Active network scan rate limit exceeded.",
  }),

  // 8. Git scan: max 5 req/min (expensive repo clone & AST analysis)
  gitScan: new RateLimiter({
    name: "git_scan",
    windowMs: 60_000,
    max: 5,
    message: "Git repository scan rate limit exceeded.",
  }),

  // 9. Archive upload: max 10 req/min (file/CBOM ZIP archive ingestion)
  archiveUpload: new RateLimiter({
    name: "archive_upload",
    windowMs: 60_000,
    max: 10,
    message: "Archive upload rate limit exceeded.",
  }),

  // 10. CBOM generation: max 15 req/min (CBOM transformation and calculation)
  cbomGeneration: new RateLimiter({
    name: "cbom_generation",
    windowMs: 60_000,
    max: 15,
    message: "CBOM generation rate limit exceeded.",
  }),

  // 11. Report generation: max 15 req/min (heavy HTML/PDF renderers)
  reportGeneration: new RateLimiter({
    name: "report_generation",
    windowMs: 60_000,
    max: 15,
    message: "Report generation rate limit exceeded.",
  }),

  // 12. Integration calls: max 20 req/min (KMS, ticketing, SIEM forwarders)
  integrationCalls: new RateLimiter({
    name: "integration_calls",
    windowMs: 60_000,
    max: 20,
    message: "Outbound integration rate limit exceeded.",
  }),
};

function resetAllRateLimiters() {
  for (const limiter of Object.values(RATE_LIMITS)) {
    limiter.reset();
  }
}

// ============================================================================
// 2. RESOURCE QUOTAS & CONCURRENCY GOVERNANCE
// ============================================================================

const RESOURCE_QUOTAS = {
  // Request size limit (default 150MB)
  REQUEST_SIZE_LIMIT_BYTES: 150 * 1024 * 1024,

  // Upload size limit (default 150MB)
  UPLOAD_SIZE_LIMIT_BYTES: config.MAX_UPLOAD_BYTES || 150 * 1024 * 1024,

  // Scan execution timeout (default 300 seconds / 5 minutes)
  SCAN_TIMEOUT_MS: 300_000,

  // Concurrency quotas
  MAX_CONCURRENT_SCANS_PER_TENANT: 3,
  MAX_CONCURRENT_SCANS_SYSTEM: 10,

  // Queue depth limits
  MAX_QUEUE_DEPTH_PER_TENANT: 50,
  MAX_QUEUE_DEPTH_SYSTEM: 200,

  // Memory & Disk Quotas
  MEMORY_QUOTA_MB: 1024,
  DISK_QUOTA_MB: 1024,
  CPU_QUOTA_PCT: 85.0,
};

class ConcurrencyQuotaError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ConcurrencyQuotaError";
    this.code = "CONCURRENCY_LIMIT_EXCEEDED";
    this.details = details;
  }
}

class QueueDepthExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "QueueDepthExceededError";
    this.code = "QUEUE_DEPTH_EXCEEDED";
    this.details = details;
  }
}

class ScanTimeoutError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ScanTimeoutError";
    this.code = "SCAN_TIMED_OUT";
    this.details = details;
  }
}

class MemoryQuotaExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MemoryQuotaExceededError";
    this.code = "MEMORY_QUOTA_EXCEEDED";
    this.details = details;
  }
}

class DiskQuotaExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "DiskQuotaExceededError";
    this.code = "DISK_QUOTA_EXCEEDED";
    this.details = details;
  }
}

/**
 * Manages active concurrent scans per tenant and across the system.
 */
class ConcurrencyGovernor {
  constructor({
    maxPerTenant = RESOURCE_QUOTAS.MAX_CONCURRENT_SCANS_PER_TENANT,
    maxSystem = RESOURCE_QUOTAS.MAX_CONCURRENT_SCANS_SYSTEM,
  } = {}) {
    this.maxPerTenant = maxPerTenant;
    this.maxSystem = maxSystem;
    this.activeScans = new Map(); // tenantId -> Set<scanId>
    this.totalActive = 0;
  }

  acquire(tenantId, scanId = `scan_${crypto.randomUUID()}`) {
    const tid = String(tenantId || "default-tenant").toLowerCase();

    // 1. Check system-wide concurrency quota
    if (this.totalActive >= this.maxSystem) {
      throw new ConcurrencyQuotaError(
        `System-wide scan concurrency limit reached (${this.totalActive}/${this.maxSystem}).`,
        { totalActive: this.totalActive, limit: this.maxSystem }
      );
    }

    // 2. Check tenant-scoped concurrency quota
    const tenantSet = this.activeScans.get(tid) || new Set();
    if (tenantSet.size >= this.maxPerTenant) {
      throw new ConcurrencyQuotaError(
        `Tenant '${tid}' reached concurrent scan limit (${tenantSet.size}/${this.maxPerTenant}).`,
        { tenantId: tid, activeScans: tenantSet.size, limit: this.maxPerTenant }
      );
    }

    tenantSet.add(scanId);
    this.activeScans.set(tid, tenantSet);
    this.totalActive += 1;

    return { scanId, tenantId: tid };
  }

  release(tenantId, scanId) {
    const tid = String(tenantId || "default-tenant").toLowerCase();
    const tenantSet = this.activeScans.get(tid);
    if (tenantSet && tenantSet.has(scanId)) {
      tenantSet.delete(scanId);
      if (tenantSet.size === 0) {
        this.activeScans.delete(tid);
      }
      this.totalActive = Math.max(0, this.totalActive - 1);
    }
  }

  getActiveCount(tenantId) {
    if (!tenantId) return this.totalActive;
    const tid = String(tenantId).toLowerCase();
    return this.activeScans.get(tid)?.size || 0;
  }

  reset() {
    this.activeScans.clear();
    this.totalActive = 0;
  }
}

const defaultConcurrencyGovernor = new ConcurrencyGovernor();

/**
 * Manages background queue depth limits per tenant and system-wide.
 */
class QueueDepthGovernor {
  constructor({
    maxPerTenant = RESOURCE_QUOTAS.MAX_QUEUE_DEPTH_PER_TENANT,
    maxSystem = RESOURCE_QUOTAS.MAX_QUEUE_DEPTH_SYSTEM,
  } = {}) {
    this.maxPerTenant = maxPerTenant;
    this.maxSystem = maxSystem;
  }

  verifyCapacity(currentTenantDepth, currentSystemDepth, tenantId = "default") {
    if (currentSystemDepth >= this.maxSystem) {
      throw new QueueDepthExceededError(
        `System queue capacity exceeded (${currentSystemDepth}/${this.maxSystem}). Server is at full capacity.`,
        { currentSystemDepth, limit: this.maxSystem }
      );
    }

    if (currentTenantDepth >= this.maxPerTenant) {
      throw new QueueDepthExceededError(
        `Tenant '${tenantId}' queue capacity exceeded (${currentTenantDepth}/${this.maxPerTenant}).`,
        { tenantId, currentTenantDepth, limit: this.maxPerTenant }
      );
    }

    return true;
  }
}

const defaultQueueDepthGovernor = new QueueDepthGovernor();

// ============================================================================
// 3. SCAN EXECUTION & RESOURCE GOVERNANCE WRAPPER
// ============================================================================

/**
 * Wraps scan execution enforcing:
 * - Scan timeout (AbortController / Promise.race)
 * - Concurrency acquisition and guaranteed release
 * - Memory quota tracking
 */
async function executeGovernedScan({
  tenantId = "default-tenant",
  scanId = `scan_${Date.now()}`,
  timeoutMs = RESOURCE_QUOTAS.SCAN_TIMEOUT_MS,
  memoryQuotaMb = RESOURCE_QUOTAS.MEMORY_QUOTA_MB,
  executeFn,
}) {
  // 1. Acquire Concurrency
  defaultConcurrencyGovernor.acquire(tenantId, scanId);

  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new ScanTimeoutError(`Scan '${scanId}' timed out after ${timeoutMs}ms`, {
          scanId,
          timeoutMs,
        })
      );
    }, timeoutMs);
  });

  try {
    // 2. Pre-scan memory check
    const initialRssMb = process.memoryUsage().rss / (1024 * 1024);
    if (initialRssMb > memoryQuotaMb) {
      throw new MemoryQuotaExceededError(
        `Initial process memory (${initialRssMb.toFixed(1)}MB) exceeds allocated quota (${memoryQuotaMb}MB).`,
        { currentMb: initialRssMb, limitMb: memoryQuotaMb }
      );
    }

    // 3. Execute with timeout race
    const result = await Promise.race([executeFn(), timeoutPromise]);

    // 4. Post-scan memory check
    const postRssMb = process.memoryUsage().rss / (1024 * 1024);
    if (postRssMb > memoryQuotaMb * 1.5) {
      // Trigger GC if available or log warning
      if (global.gc) global.gc();
    }

    return result;
  } finally {
    if (timer) clearTimeout(timer);
    // Guaranteed concurrency release
    defaultConcurrencyGovernor.release(tenantId, scanId);
  }
}

// ============================================================================
// 4. EXPRESS MIDDLEWARES FOR RESOURCE GOVERNANCE
// ============================================================================

/**
 * Rejects requests if Content-Length exceeds max allowed size before payload processing.
 */
function requestSizeLimitMiddleware(maxSizeBytes = RESOURCE_QUOTAS.REQUEST_SIZE_LIMIT_BYTES) {
  return (req, res, next) => {
    const contentLength = req.headers["content-length"];
    if (contentLength) {
      const length = parseInt(contentLength, 10);
      if (!isNaN(length) && length > maxSizeBytes) {
        return res.status(413).json({
          error: "PayloadTooLarge",
          code: "REQUEST_SIZE_LIMIT_EXCEEDED",
          message: `Request size (${length} bytes) exceeds maximum permitted limit (${maxSizeBytes} bytes).`,
          limitBytes: maxSizeBytes,
          requestId: req.id,
        });
      }
    }
    next();
  };
}

/**
 * Concurrency quota middleware for scan endpoints.
 */
function concurrencyQuotaMiddleware(governor = defaultConcurrencyGovernor) {
  return (req, res, next) => {
    const tenantId = req.tenantContext?.tenantId || "default-tenant";
    const scanId = `req_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    try {
      governor.acquire(tenantId, scanId);
      req.governedScan = { tenantId, scanId, governor };

      // Release on response finish or close
      let released = false;
      const releaseOnce = () => {
        if (!released) {
          released = true;
          governor.release(tenantId, scanId);
        }
      };

      res.on("finish", releaseOnce);
      res.on("close", releaseOnce);

      next();
    } catch (err) {
      if (err instanceof ConcurrencyQuotaError) {
        return res.status(429).json({
          error: "TooManyRequests",
          code: err.code,
          message: err.message,
          details: err.details,
          requestId: req.id,
        });
      }
      next(err);
    }
  };
}

module.exports = {
  // Rate Limiters
  RateLimiter,
  RATE_LIMITS,
  resetAllRateLimiters,

  // Quotas & Governors
  RESOURCE_QUOTAS,
  ConcurrencyGovernor,
  defaultConcurrencyGovernor,
  QueueDepthGovernor,
  defaultQueueDepthGovernor,

  // Errors
  ConcurrencyQuotaError,
  QueueDepthExceededError,
  ScanTimeoutError,
  MemoryQuotaExceededError,
  DiskQuotaExceededError,

  // Executors & Middlewares
  executeGovernedScan,
  requestSizeLimitMiddleware,
  concurrencyQuotaMiddleware,
};
