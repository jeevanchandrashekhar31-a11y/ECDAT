/**
 * Audit Logging REST API Router — Phase 18.1
 *
 * Exposes endpoints for:
 * - Querying tamper-resistant audit events with bounded pagination
 * - Cryptographic chain integrity verification
 * - Operational audit summary telemetry
 * - Verifiable signed audit trail export
 * - Manual authenticated audit event logging
 */

const express = require("express");
const router = express.Router();
const { defaultAuditService, AUDIT_CATEGORIES, AUDIT_ACTIONS, AUDIT_STATUSES } = require("../audit");
const { paginationBoundsMiddleware } = require("../security/input_validation");

/**
 * GET /api/v1/audit/events
 * Query audit ledger records with parameterized filters.
 */
router.get("/events", paginationBoundsMiddleware(), (req, res) => {
  try {
    const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
    if (isAnonymous) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required to query audit records",
      });
    }

    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId;

    if (req.query.tenantId && !isPlatformAdmin) {
      if (String(req.query.tenantId).trim().toLowerCase() !== callerTenant) {
        return res.status(403).json({
          error: "HorizontalTenantViolation",
          code: "HORIZONTAL_TENANT_VIOLATION",
          message: `Cannot query audit records for foreign tenant '${req.query.tenantId}'`,
        });
      }
    }

    const filter = {
      category: req.query.category,
      action: req.query.action,
      actor: req.query.actor,
      tenantId: isPlatformAdmin ? (req.query.tenantId || null) : callerTenant,
      status: req.query.status,
      startTime: req.query.startTime || req.query.start_time,
      endTime: req.query.endTime || req.query.end_time,
    };

    const options = {
      limit: req.query.limit || 50,
      offset: req.query.offset || 0,
      sortOrder: req.query.sortOrder || req.query.sort_order || "desc",
    };

    const result = defaultAuditService.getEvents(filter, options);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: "AuditQueryError",
      message: err.message,
    });
  }
});

/**
 * GET /api/v1/audit/verify
 * Runs full cryptographic hash-chain verification and returns tamper detection results.
 */
router.get("/verify", (req, res) => {
  try {
    const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
    if (isAnonymous) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required to verify audit integrity",
      });
    }

    const isPlatformAdmin = Boolean(
      req.tenantContext?.isPlatformAdmin ||
      req.auth?.role === "admin" ||
      (req.auth?.roles && req.auth.roles.includes("admin"))
    );
    const callerTenant = req.tenantContext?.tenantId;

    if (req.query.tenantId && !isPlatformAdmin) {
      if (String(req.query.tenantId).trim().toLowerCase() !== callerTenant) {
        return res.status(403).json({
          error: "HorizontalTenantViolation",
          code: "HORIZONTAL_TENANT_VIOLATION",
          message: `Cannot verify audit records for foreign tenant '${req.query.tenantId}'`,
        });
      }
    }

    const tenantId = isPlatformAdmin ? (req.query.tenantId || null) : callerTenant;
    const result = defaultAuditService.verifyIntegrity(tenantId);

    const statusCode = result.valid ? 200 : 409;
    return res.status(statusCode).json({
      chainIntegrity: result.valid ? "VERIFIED_INTACT" : "TAMPER_DETECTED",
      ...result,
      verifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: "AuditVerificationError",
      message: err.message,
    });
  }
});

/**
 * GET /api/v1/audit/summary
 * Returns category distribution and recent audit event stats.
 */
router.get("/summary", (req, res) => {
  try {
    const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
    if (isAnonymous) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required to view audit summary",
      });
    }

    const summary = defaultAuditService.getSummaryStats();
    return res.status(200).json(summary);
  } catch (err) {
    return res.status(500).json({
      error: "AuditSummaryError",
      message: err.message,
    });
  }
});

/**
 * GET /api/v1/audit/export
 * Downloads verifiable, signed JSON audit package.
 */
router.get("/export", (req, res) => {
  try {
    const isAnonymous = !req.user && (!req.auth || !req.auth.authenticated);
    if (isAnonymous) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required to export audit ledger",
      });
    }

    const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
    const callerTenant = req.tenantContext?.tenantId;

    if (req.query.tenantId && !isPlatformAdmin) {
      if (String(req.query.tenantId).trim().toLowerCase() !== callerTenant) {
        return res.status(403).json({
          error: "HorizontalTenantViolation",
          code: "HORIZONTAL_TENANT_VIOLATION",
          message: `Cannot export audit records for foreign tenant '${req.query.tenantId}'`,
        });
      }
    }

    const filter = {
      category: req.query.category,
      tenantId: isPlatformAdmin ? (req.query.tenantId || null) : callerTenant,
    };

    const auditTrail = defaultAuditService.exportAuditTrail(filter);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ecdat_audit_ledger_${Date.now()}.json"`
    );
    return res.status(200).send(JSON.stringify(auditTrail, null, 2));
  } catch (err) {
    return res.status(500).json({
      error: "AuditExportError",
      message: err.message,
    });
  }
});

/**
 * POST /api/v1/audit/events
 * Records a manual or custom audit event into the ledger.
 */
router.post("/events", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.action) {
      return res.status(400).json({
        error: "ValidationError",
        message: "Missing required 'action' field for audit event.",
      });
    }

    const event = await defaultAuditService.logEvent({
      category: body.category,
      action: body.action,
      actor: {
        id: req.auth?.userId || req.headers["x-actor-id"] || body.actor?.id || "system",
        username: req.auth?.username || body.actor?.username || "system",
        role: req.user?.role || req.auth?.role || req.tenantContext?.roles?.[0] || null,
        ipAddress: req.ip || req.connection?.remoteAddress,
        userAgent: req.headers["user-agent"],
      },
      tenantId: req.tenantContext?.tenantId || body.tenantId || "default",
      target: body.target,
      status: body.status || AUDIT_STATUSES.SUCCESS,
      details: body.details || {},
      ipAddress: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers["user-agent"],
    });

    return res.status(201).json({
      success: true,
      eventId: event.eventId,
      sequenceNumber: event.sequenceNumber,
      hash: event.hash,
      signature: event.signature,
      timestamp: event.timestamp,
    });
  } catch (err) {
    return res.status(500).json({
      error: "AuditRecordError",
      message: err.message,
    });
  }
});

module.exports = router;
