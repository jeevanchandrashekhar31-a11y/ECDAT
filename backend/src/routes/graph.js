const express = require("express");
const { buildCryptoRelationshipGraph } = require("../services/crypto_graph_service");
const { getScanById } = require("../services/cbom_ingestion");

const router = express.Router();

/**
 * GET /api/v1/graph
 * Returns correlated crypto relationship graph:
 * Application -> Service -> Certificate -> Protocol -> Algorithm -> Data
 * Supports filtering by severity, owner, environment, algorithm, pqcReadiness, exposure, and search.
 */
router.get("/", async (req, res, next) => {
  try {
    const scanId = req.query.scanId || req.query.scan_id;

    if (scanId && scanId !== "all") {
      const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
      const callerTenant = req.tenantContext?.tenantId || req.auth?.user?.tenantId || req.auth?.tenantId;

      const scan = await getScanById(scanId, { isPlatformAdmin: true });
      if (!scan) {
        return res.status(404).json({
          error: "NotFound",
          message: `Scan '${scanId}' not found`,
        });
      }

      if (!isPlatformAdmin && scan.tenantId && callerTenant && scan.tenantId !== callerTenant) {
        return res.status(403).json({
          error: "TenantBoundaryViolation",
          code: "HORIZONTAL_TENANT_VIOLATION",
          message: `Cannot access scan belonging to foreign tenant '${scan.tenantId}'`,
        });
      }
    }

    const filters = {
      scanId,
      severity: req.query.severity,
      owner: req.query.owner,
      environment: req.query.environment,
      algorithm: req.query.algorithm,
      pqcReadiness: req.query.pqcReadiness || req.query.pqc_readiness,
      exposure: req.query.exposure,
      search: req.query.search || req.query.q,
    };

    const graphData = await buildCryptoRelationshipGraph(filters, req.tenantContext);
    res.status(200).json(graphData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
