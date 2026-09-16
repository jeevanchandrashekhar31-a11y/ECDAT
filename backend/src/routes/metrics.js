/**
 * Operational Metrics REST & Prometheus Exporter Router — Phase 18.3
 *
 * Exposes endpoints for:
 * - GET / (or /metrics) (Standard Prometheus text exposition format)
 * - GET /operational (JSON snapshot of all 11 operational dimensions)
 * - GET /operational/:dimension (Specific operational dimension)
 * - POST /record (Ingestion endpoint for scan workers/agents/pipeline)
 *
 * Privacy Guarantee:
 * Strictly prevents exposure of sensitive tenant IDs, customer repository URLs,
 * or proprietary algorithm keys via the public metrics endpoints.
 */

const express = require("express");
const router = express.Router();
const { defaultMetricsCollector, exportPrometheusMetrics } = require("../metrics");

/**
 * Handler for standard Prometheus exposition text format.
 */
function prometheusHandler(_req, res) {
  try {
    const text = exportPrometheusMetrics(defaultMetricsCollector);
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return res.status(200).send(text);
  } catch (err) {
    return res.status(500).send(`# Error generating metrics: ${err.message}\n`);
  }
}

/**
 * GET / or GET /metrics (when mounted at /metrics or /api/v1/metrics)
 */
router.get("/", prometheusHandler);
router.get("/prometheus", prometheusHandler);

/**
 * GET /operational
 * Serves comprehensive JSON snapshot across all 11 operational dimensions:
 * 1. scan_duration
 * 2. queue_depth
 * 3. cpu_memory
 * 4. findings
 * 5. detection_coverage
 * 6. parser_failures
 * 7. false_positives
 * 8. risk_distribution
 * 9. remediation
 * 10. api_latency
 * 11. error_rates
 */
router.get("/operational", (_req, res) => {
  try {
    const snapshot = defaultMetricsCollector.getOperationalMetrics();
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(snapshot);
  } catch (err) {
    return res.status(500).json({
      error: "MetricsCollectionError",
      message: err.message,
    });
  }
});

/**
 * GET /operational/:dimension
 * Serves a single operational dimension (e.g. scan_duration, findings, cpu_memory).
 */
router.get("/operational/:dimension", (req, res) => {
  try {
    const dimension = req.params.dimension;
    const snapshot = defaultMetricsCollector.getOperationalMetrics();

    if (!snapshot[dimension]) {
      return res.status(404).json({
        error: "DimensionNotFound",
        message: `Metric dimension '${dimension}' does not exist. Valid dimensions: ${Object.keys(snapshot).join(", ")}`,
      });
    }

    return res.status(200).json({
      dimension,
      timestamp: snapshot.timestamp,
      data: snapshot[dimension],
    });
  } catch (err) {
    return res.status(500).json({
      error: "MetricsCollectionError",
      message: err.message,
    });
  }
});

/**
 * POST /record
 * Allows internal services, workers, or scanners to record operational telemetry.
 */
router.post("/record", (req, res) => {
  try {
    const { type, payload } = req.body || {};

    if (!type || !payload) {
      return res.status(400).json({
        error: "ValidationError",
        message: "Missing 'type' or 'payload' in metric recording request.",
      });
    }

    switch (type) {
      case "scan_duration":
        defaultMetricsCollector.recordScanDuration(payload.scannerType, payload.durationMs);
        break;
      case "queue_depth":
        defaultMetricsCollector.setQueueDepth(payload.queueName, payload.depth);
        break;
      case "finding":
        defaultMetricsCollector.recordFinding({
          severity: payload.severity,
          quantumRisk: payload.quantumRisk,
          riskScore: payload.riskScore,
          moscaHorizon: payload.moscaHorizon,
          algorithmId: payload.algorithmId,
        });
        break;
      case "parser_failure":
        defaultMetricsCollector.recordParserFailure(payload.parserName);
        break;
      case "false_positive":
        defaultMetricsCollector.recordFalsePositive(payload.isExplainabilityRule);
        break;
      case "remediation":
        defaultMetricsCollector.recordRemediation(payload.stage);
        break;
      default:
        return res.status(400).json({
          error: "UnknownMetricType",
          message: `Unknown metric type '${type}'.`,
        });
    }

    return res.status(200).json({ success: true, type });
  } catch (err) {
    return res.status(500).json({
      error: "MetricRecordError",
      message: err.message,
    });
  }
});

module.exports = router;
