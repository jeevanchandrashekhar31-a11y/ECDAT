const express = require("express");
const { buildCryptoRelationshipGraph } = require("../services/crypto_graph_service");

const router = express.Router();

/**
 * GET /api/v1/graph
 * Returns correlated crypto relationship graph:
 * Application -> Service -> Certificate -> Protocol -> Algorithm -> Data
 * Supports filtering by severity, owner, environment, algorithm, pqcReadiness, exposure, and search.
 */
router.get("/", async (req, res, next) => {
  try {
    const filters = {
      scanId: req.query.scanId || req.query.scan_id,
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
