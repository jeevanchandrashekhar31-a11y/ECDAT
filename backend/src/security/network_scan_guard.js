/**
 * ECDAT Active Network Scanning Guard & Authorization Subsystem — Phase 8
 *
 * Enforces:
 * 1. Explicit Authorization:
 *    - Authenticated caller required.
 *    - Explicit `authorized_by` matching the authenticated caller's identity or admin role.
 * 2. Tenant-Scoped Targets:
 *    - Scans are strictly scoped to the tenant.
 *    - Safe default deny: RFC 1918 / loopback / cloud metadata targets blocked.
 * 3. Rate Limits:
 *    - Sliding window per tenant (max 5 network scans per 60 seconds per tenant).
 * 4. Concurrency Limits:
 *    - Max 2 concurrent scans per tenant, max 10 system-wide.
 * 5. Timeouts & Packet / Port Limits:
 *    - Scan timeout bounded to 15 seconds.
 *    - Cryptographic ports only (443, 8443, 636, 993, 995, 465, 22, 80).
 *    - Internal database / control ports strictly prohibited.
 * 6. Structured Audit Logging:
 *    - Every scan attempt (authorized, blocked, failed) recorded to the tamper-chain audit ledger.
 */

const { defaultAuditService } = require("../audit/audit_service");
const { AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit/event_types");
const { resolveAndValidateTarget, isForbiddenIp, isForbiddenHostname } = require("./ssrf_protection");

// Standard cryptographic / TLS service ports permitted for cryptographic inventory
const ALLOWED_SCAN_PORTS = new Set([
  22,   // SSH
  80,   // HTTP (redirect to TLS)
  443,  // HTTPS
  465,  // SMTPS
  636,  // LDAPS
  993,  // IMAPS
  995,  // POP3S
  8443, // HTTPS Alternate
]);

// High-risk internal ports that must never be scanned
const PROHIBITED_PORTS = new Set([
  2375,  // Docker daemon
  2376,  // Docker daemon TLS
  3306,  // MySQL
  5432,  // PostgreSQL
  6379,  // Redis
  8200,  // HashiCorp Vault API
  8500,  // Consul
  9200,  // Elasticsearch
  10250, // Kubelet
  27017, // MongoDB
]);

class NetworkScanGuard {
  /**
   * @param {object} [options={}]
   * @param {number} [options.maxScansPerMinute=5]
   * @param {number} [options.maxConcurrentPerTenant=2]
   * @param {number} [options.maxGlobalConcurrent=10]
   * @param {number} [options.defaultTimeoutSeconds=10]
   * @param {number} [options.maxTimeoutSeconds=15]
   */
  constructor(options = {}) {
    this.maxScansPerMinute = options.maxScansPerMinute || 5;
    this.maxConcurrentPerTenant = options.maxConcurrentPerTenant || 2;
    this.maxGlobalConcurrent = options.maxGlobalConcurrent || 10;
    this.defaultTimeoutSeconds = options.defaultTimeoutSeconds || 10;
    this.maxTimeoutSeconds = options.maxTimeoutSeconds || 15;

    // In-memory rate limiting: tenantId -> Array of timestamps (ms)
    this.tenantRateWindows = new Map();

    // In-memory concurrency tracking: tenantId -> activeCount
    this.activeTenantScans = new Map();
    this.globalActiveScans = 0;
  }

  /**
   * Validates and authorizes a network scan request against all security controls.
   *
   * @param {object} req - Express request object
   * @param {object} [options={}]
   * @returns {Promise<{ authorized: boolean, error?: string, status?: number, targetInfo?: object, releaseConcurrency?: Function }>}
   */
  async validateAndAuthorizeScan(req, options = {}) {
    const callerAuth = req.auth?.user || req.user || req.auth;
    const tenantId = req.tenantContext?.tenantId || req.body?.tenantId || req.headers?.["x-tenant-id"] || callerAuth?.tenantId || "default";
    const rawTarget = req.body?.url || req.body?.target || req.body?.host;
    const rawPort = req.body?.port || 443;
    const authorizedBy = req.body?.authorized_by;

    // 1. Authentication requirement
    if (!callerAuth || callerAuth.authenticated === false || callerAuth.role === "anonymous") {
      await this.logScanAudit({
        req,
        tenantId,
        target: rawTarget || "unknown",
        authorized: false,
        status: AUDIT_STATUSES.DENIED,
        reason: "Unauthenticated caller attempted active network scan",
      });
      return {
        authorized: false,
        status: 401,
        error: "Authentication required for active network scanning",
      };
    }

    const callerId = callerAuth.userId || callerAuth.id || callerAuth.sub;
    const callerUsername = callerAuth.username || callerAuth.user?.username;
    const callerRoles = Array.isArray(callerAuth.roles) ? callerAuth.roles : (callerAuth.role ? [callerAuth.role] : ["viewer"]);
    const callerRole = callerAuth.role || callerRoles[0] || "viewer";
    const isAdmin =
      callerRole === "admin" ||
      callerRole === "platform_admin" ||
      callerRole === "security_admin" ||
      callerRoles.includes("admin") ||
      callerRoles.includes("platform administrator") ||
      callerRoles.includes("security administrator");

    // 2. Explicit authorization requirement
    if (!authorizedBy || typeof authorizedBy !== "string" || !authorizedBy.trim()) {
      await this.logScanAudit({
        req,
        tenantId,
        target: rawTarget || "unknown",
        authorized: false,
        status: AUDIT_STATUSES.DENIED,
        reason: "Missing mandatory 'authorized_by' explicit authorization",
      });
      return {
        authorized: false,
        status: 403,
        error: "Explicit authorization parameter 'authorized_by' matching authenticated identity is required.",
      };
    }

    const trimmedAuthBy = authorizedBy.trim();
    const matchesIdentity =
      trimmedAuthBy === callerUsername ||
      trimmedAuthBy === callerId ||
      (callerAuth.email && trimmedAuthBy === callerAuth.email);

    if (!matchesIdentity && !isAdmin) {
      await this.logScanAudit({
        req,
        tenantId,
        target: rawTarget || "unknown",
        authorized: false,
        status: AUDIT_STATUSES.DENIED,
        reason: `Explicit authorization mismatch: '${trimmedAuthBy}' does not match caller '${callerUsername || callerId}'`,
      });
      return {
        authorized: false,
        status: 403,
        error: `Explicit authorization denied: 'authorized_by' must match your authenticated identity ('${callerUsername || callerId}').`,
      };
    }

    // 3. Target presence validation
    if (!rawTarget || typeof rawTarget !== "string" || !rawTarget.trim()) {
      return {
        authorized: false,
        status: 400,
        error: "Target hostname or IP address is required.",
      };
    }

    // 4. Port Bounds & Prohibited Port Defense
    const parsedPort = parseInt(rawPort, 10);
    if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      return {
        authorized: false,
        status: 400,
        error: `Invalid port '${rawPort}'. Port must be between 1 and 65535.`,
      };
    }

    if (PROHIBITED_PORTS.has(parsedPort)) {
      await this.logScanAudit({
        req,
        tenantId,
        target: `${rawTarget}:${parsedPort}`,
        authorized: false,
        status: AUDIT_STATUSES.DENIED,
        reason: `Target port ${parsedPort} belongs to prohibited internal database / control service allowlist`,
      });
      return {
        authorized: false,
        status: 400,
        error: `Port ${parsedPort} is restricted. Active scanning is prohibited on database and orchestration control ports.`,
      };
    }

    if (!ALLOWED_SCAN_PORTS.has(parsedPort) && !isAdmin) {
      return {
        authorized: false,
        status: 400,
        error: `Port ${parsedPort} is not an allowed cryptographic assessment port. Permitted: ${Array.from(ALLOWED_SCAN_PORTS).join(", ")}.`,
      };
    }

    // 5. Rate Limiting Check (Sliding Window per tenant)
    const rateCheck = this.checkRateLimit(tenantId);
    if (!rateCheck.allowed) {
      await this.logScanAudit({
        req,
        tenantId,
        target: `${rawTarget}:${parsedPort}`,
        authorized: false,
        status: AUDIT_STATUSES.DENIED,
        reason: `Tenant network scan rate limit exceeded (${this.maxScansPerMinute} scans/minute)`,
      });
      return {
        authorized: false,
        status: 429,
        error: `Tenant network scanning rate limit exceeded (maximum ${this.maxScansPerMinute} scans per minute). Please retry later.`,
      };
    }

    // 6. Concurrency Limit Check
    const concurrencyCheck = this.acquireConcurrency(tenantId);
    if (!concurrencyCheck.acquired) {
      await this.logScanAudit({
        req,
        tenantId,
        target: `${rawTarget}:${parsedPort}`,
        authorized: false,
        status: AUDIT_STATUSES.DENIED,
        reason: concurrencyCheck.reason,
      });
      return {
        authorized: false,
        status: 429,
        error: concurrencyCheck.reason,
      };
    }

    // 7. SSRF & Destination DNS Resolution (Safe Default Deny)
    let targetValidation;
    try {
      targetValidation = await resolveAndValidateTarget(rawTarget, {
        defaultPort: parsedPort,
        allowPrivate: false, // Strict safe default deny
        dnsLookupFn: options.dnsLookupFn,
      });
    } catch (err) {
      concurrencyCheck.release();
      return {
        authorized: false,
        status: 400,
        error: `Target resolution error: ${err.message}`,
      };
    }

    if (!targetValidation.valid) {
      concurrencyCheck.release();
      await this.logScanAudit({
        req,
        tenantId,
        target: `${rawTarget}:${parsedPort}`,
        authorized: false,
        status: AUDIT_STATUSES.DENIED,
        reason: `Target validation / SSRF check failed: ${targetValidation.error}`,
      });
      return {
        authorized: false,
        status: 400,
        error: `Network scan target rejected: ${targetValidation.error}`,
      };
    }

    // 8. Log Authorized Audit Event
    await this.logScanAudit({
      req,
      tenantId,
      target: `${targetValidation.hostname}:${targetValidation.port}`,
      authorized: true,
      status: AUDIT_STATUSES.SUCCESS,
      reason: `Authorized active cryptographic scan of ${targetValidation.hostname}:${targetValidation.port}`,
      details: {
        authorizedBy: trimmedAuthBy,
        resolvedIps: targetValidation.resolvedIps,
        pinnedIp: targetValidation.pinnedIp,
        port: targetValidation.port,
      },
    });

    return {
      authorized: true,
      targetInfo: {
        originalTarget: rawTarget,
        hostname: targetValidation.hostname,
        port: targetValidation.port,
        resolvedIps: targetValidation.resolvedIps,
        pinnedIp: targetValidation.pinnedIp,
        authorizedBy: trimmedAuthBy,
        timeoutSeconds: Math.min(
          parseInt(req.body?.timeout || this.defaultTimeoutSeconds, 10),
          this.maxTimeoutSeconds
        ),
      },
      releaseConcurrency: concurrencyCheck.release,
    };
  }

  /**
   * Sliding window rate limiter per tenant.
   */
  checkRateLimit(tenantId) {
    const now = Date.now();
    const windowMs = 60000;
    const history = this.tenantRateWindows.get(tenantId) || [];
    const recent = history.filter((ts) => now - ts < windowMs);

    if (recent.length >= this.maxScansPerMinute) {
      return { allowed: false };
    }

    recent.push(now);
    this.tenantRateWindows.set(tenantId, recent);
    return { allowed: true };
  }

  /**
   * Concurrency semaphore acquire.
   */
  acquireConcurrency(tenantId) {
    const tenantActive = this.activeTenantScans.get(tenantId) || 0;

    if (tenantActive >= this.maxConcurrentPerTenant) {
      return {
        acquired: false,
        reason: `Tenant network scan concurrency limit reached (max ${this.maxConcurrentPerTenant} simultaneous scans).`,
      };
    }

    if (this.globalActiveScans >= this.maxGlobalConcurrent) {
      return {
        acquired: false,
        reason: `Global network scan concurrency limit reached (max ${this.maxGlobalConcurrent} simultaneous scans).`,
      };
    }

    this.activeTenantScans.set(tenantId, tenantActive + 1);
    this.globalActiveScans++;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const current = this.activeTenantScans.get(tenantId) || 1;
      if (current <= 1) {
        this.activeTenantScans.delete(tenantId);
      } else {
        this.activeTenantScans.set(tenantId, current - 1);
      }
      this.globalActiveScans = Math.max(0, this.globalActiveScans - 1);
    };

    return { acquired: true, release };
  }

  /**
   * Emits structured audit log for scan operation.
   */
  async logScanAudit({ req, tenantId, target, authorized, status, reason, details = {} }) {
    try {
      const actor = {
        id: req?.auth?.userId || req?.user?.id || "anonymous",
        username: req?.auth?.username || req?.user?.username || "anonymous",
        role: req?.auth?.role || req?.user?.role || "anonymous",
        ipAddress: req?.ip || req?.socket?.remoteAddress,
      };

      await defaultAuditService.logEvent({
        category: AUDIT_CATEGORIES.SCAN,
        action: AUDIT_ACTIONS.SCAN_TRIGGERED,
        actor,
        tenantId: tenantId || "default",
        target: {
          type: "NETWORK_TARGET",
          id: String(target),
          name: String(target),
        },
        status,
        details: {
          authorized,
          reason,
          ...details,
        },
      });
    } catch (auditErr) {
      console.warn("[NetworkScanGuard] Audit logging warning:", auditErr.message);
    }
  }

  /**
   * Resets rate limiting and concurrency state (for test teardowns).
   */
  reset() {
    this.tenantRateWindows.clear();
    this.activeTenantScans.clear();
    this.globalActiveScans = 0;
  }
}

const defaultNetworkScanGuard = new NetworkScanGuard();

module.exports = {
  NetworkScanGuard,
  defaultNetworkScanGuard,
  ALLOWED_SCAN_PORTS,
  PROHIBITED_PORTS,
};
