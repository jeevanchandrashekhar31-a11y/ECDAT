const express = require("express");
const { buildCryptoRelationshipGraph } = require("../services/crypto_graph_service");
const { db, isDbConnected } = require("../db/connection");

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
      const connected = await isDbConnected();
      if (!connected) return res.status(503).json({ error: "Database unavailable" });

      const isPlatformAdmin = Boolean(req.tenantContext?.isPlatformAdmin);
      const callerTenant = req.tenantContext?.tenantId || req.auth?.user?.tenantId || req.auth?.tenantId;

      let scanQuery = db("scans").where("id", scanId);
      
      if (!isPlatformAdmin) {
        if (callerTenant) {
          scanQuery = scanQuery.andWhere("tenant_id", callerTenant);
        } else {
          scanQuery = scanQuery.whereRaw("1 = 0");
        }
      }

      const scanRow = await scanQuery.select("id", "tenant_id").first();

      if (!scanRow) {
        return res.status(404).json({
          error: "NotFound",
          message: `Scan '${scanId}' not found or access denied`,
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
