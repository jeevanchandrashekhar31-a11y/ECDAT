/**
 * SIEM Integration REST API Router — Phase 18.2
 *
 * Exposes endpoints for:
 * - Querying structured SIEM events in JSON, CEF, or Syslog format
 * - Manually triggering outbound SIEM queue dispatch
 * - Inspecting & updating SIEM outbound destination configurations
 * - Inspecting the canonical JSON schema for security events
 */

const express = require("express");
const router = express.Router();
const {
  defaultSiemDispatcher,
  getSiemSchema,
  createSiemEvent,
  formatEvent,
  SUPPORTED_FORMATS,
} = require("../siem");
const { validateSafeUrlAsync } = require("../security/ssrf_protection");
const {
  paginationBoundsMiddleware,
  validateEnum,
  ALLOWED_SEVERITIES,
} = require("../security/input_validation");
const { RATE_LIMITS } = require("../security/resource_governance");

/**
 * GET /api/v1/siem/events
 * Query structured security events suitable for SIEM ingestion.
 * Supports format=json|cef|syslog and filtering by severity, action, actor, tenant, status.
 */
router.get("/events", paginationBoundsMiddleware(), (req, res) => {
  try {
    const requestedFormat = (req.query.format || "json").toLowerCase();
    if (!["json", "cef", "syslog"].includes(requestedFormat)) {
      return res.status(400).json({
        error: "ValidationError",
        message: `Unsupported SIEM export format '${requestedFormat}'. Allowed: json, cef, syslog`,
      });
    }

    if (req.query.severity) {
      const sevCheck = validateEnum(req.query.severity, ALLOWED_SEVERITIES, "severity");
      if (!sevCheck.valid) {
        return res.status(400).json({ error: "ValidationError", message: sevCheck.error });
      }
    }

    const filter = {
      severity: req.query.severity,
      action: req.query.action,
      tenantId: req.tenantContext?.tenantId || req.query.tenantId,
      actor: req.query.actor,
      status: req.query.status,
    };

    const options = {
      limit: req.pagination ? req.pagination.limit : (req.query.limit || 50),
      offset: req.pagination ? req.pagination.offset : (req.query.offset || 0),
      format: requestedFormat,
    };

    const result = defaultSiemDispatcher.getEvents(filter, options);

    if (requestedFormat === "cef" || requestedFormat === "syslog") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(result.events.join("\n"));
    }

    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({
      error: "SiemQueryError",
      message: err.message,
    });
  }
});

/**
 * POST /api/v1/siem/forward
 * Manually flushes the queued SIEM events or ingests and dispatches an ad-hoc event.
 */
router.post("/forward", RATE_LIMITS.integrationCalls.middleware(), async (req, res) => {
  try {
    const body = req.body;
    let ingestedEventId = null;

    // If a custom event payload is provided, ingest it first
    if (body && body.action && body.resource) {
      const event = createSiemEvent({
        actor: {
          id: req.user?.sub || req.user?.userId || req.auth?.user?.sub || req.auth?.userId || "system",
          username: req.user?.username || req.auth?.user?.username || req.auth?.username || "system",
          role: req.user?.role || req.auth?.role || req.tenantContext?.roles?.[0] || null,
          ip: req.ip || req.connection?.remoteAddress || "127.0.0.1",
        },
        tenant: {
          id: req.tenantContext?.tenantId || body.tenant?.id || "default",
          name: req.tenantContext?.tenantName || body.tenant?.name || "Default Organization",
        },
        action: body.action,
        resource: body.resource,
        result: body.result || { status: "SUCCESS" },
        riskContext: body.riskContext || body.risk_context,
        requestId: req.headers["x-request-id"] || body.requestId || body.request_id,
        metadata: body.metadata,
      });

      const ingestRes = defaultSiemDispatcher.ingestEvent(event);
      if (!ingestRes.success) {
        return res.status(400).json({
          error: "ValidationError",
          message: ingestRes.error,
        });
      }
      ingestedEventId = ingestRes.eventId;
    }

    const flushResult = await defaultSiemDispatcher.flushQueue();
    return res.status(200).json({
      success: true,
      ingestedEventId,
      dispatchedCount: flushResult.dispatched,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      error: "SiemForwardError",
      message: err.message,
    });
  }
});

/**
 * GET /api/v1/siem/config
 * Retrieves the current forwarder configuration and status telemetry (no secrets).
 */
router.get("/config", (_req, res) => {
  try {
    const config = defaultSiemDispatcher.getConfig();
    return res.status(200).json(config);
  } catch (err) {
    return res.status(500).json({
      error: "SiemConfigError",
      message: err.message,
    });
  }
});

/**
 * PUT /api/v1/siem/config
 * Updates destinations, batching, or forwarder parameters.
 */
router.put("/config", async (req, res) => {
  try {
    const { endpoints, batchSize, flushIntervalMs } = req.body || {};

    if (Array.isArray(endpoints)) {
      for (const ep of endpoints) {
        if (ep && ep.url) {
          const check = await validateSafeUrlAsync(ep.url);
          if (!check.safe) {
            return res.status(400).json({
              error: "SSRFViolation",
              message: `SIEM endpoint '${ep.url}' rejected: ${check.error}`,
            });
          }
        }
      }
      defaultSiemDispatcher.setEndpoints(endpoints);
    }
    if (typeof batchSize === "number" && batchSize > 0) {
      defaultSiemDispatcher.batchSize = batchSize;
    }
    if (typeof flushIntervalMs === "number" && flushIntervalMs >= 0) {
      defaultSiemDispatcher.flushIntervalMs = flushIntervalMs;
      defaultSiemDispatcher.startTimer();
    }

    return res.status(200).json({
      success: true,
      config: defaultSiemDispatcher.getConfig(),
    });
  } catch (err) {
    return res.status(500).json({
      error: "SiemConfigUpdateError",
      message: err.message,
    });
  }
});

/**
 * GET /api/v1/siem/schema
 * Returns the canonical JSON Schema for ECDAT SIEM security events.
 */
router.get("/schema", (_req, res) => {
  try {
    const schema = getSiemSchema();
    res.setHeader("Content-Type", "application/schema+json");
    return res.status(200).json(schema);
  } catch (err) {
    return res.status(500).json({
      error: "SiemSchemaError",
      message: err.message,
    });
  }
});

module.exports = router;
