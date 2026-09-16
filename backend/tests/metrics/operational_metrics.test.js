const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  MetricsCollector,
  defaultMetricsCollector,
  exportPrometheusMetrics,
  sanitizeMetricRoute,
  sanitizeMetricLabels,
} = require("../../src/metrics");

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-API-Key": config.ECDAT_API_KEY,
};

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

test("Phase 18.3 — Privacy Guard & Label Sanitizer prevents tenant/secret leakage in metrics", () => {
  // 1. Route normalization strips UUIDs, Hex IDs, and tenant paths
  assert.equal(
    sanitizeMetricRoute("/api/v1/scans/550e8400-e29b-41d4-a716-446655440000"),
    "/api/v1/scans/:id"
  );
  assert.equal(
    sanitizeMetricRoute("/api/v1/tenants/cust-998822/assets"),
    "/api/v1/tenants/:id/assets"
  );
  assert.equal(
    sanitizeMetricRoute("/api/v1/reports/scan_abcdef1234567890/html"),
    "/api/v1/reports/:id/html"
  );

  // 2. Sensitive label pruning removes tenant, customer names, emails, and secrets
  const rawLabels = {
    method: "POST",
    route: "/api/v1/scans/:id",
    tenant_id: "tenant-sensitive-bank-1",
    customer_email: "ceo@privatebank.com",
    api_token: "secret-bearer-token",
    status_family: "2xx",
  };

  const cleanLabels = sanitizeMetricLabels(rawLabels);
  assert.equal(cleanLabels.method, "POST");
  assert.equal(cleanLabels.route, "/api/v1/scans/:id");
  assert.equal(cleanLabels.status_family, "2xx");
  assert.equal(cleanLabels.tenant_id, undefined, "Tenant ID must NOT appear in public metrics");
  assert.equal(cleanLabels.customer_email, undefined, "Email must NOT appear in public metrics");
  assert.equal(cleanLabels.api_token, undefined, "API tokens must NOT appear in public metrics");
});

test("Phase 18.3 — Collector tracks all 11 required operational dimensions", () => {
  const collector = new MetricsCollector();

  // 1. Scan duration
  collector.recordScanDuration("static_scanner", 1250);
  collector.recordScanDuration("static_scanner", 750);
  collector.recordScanDuration("network_scanner", 3000);

  // 2. Queue depth
  collector.setQueueDepth("analysis_jobs", 14);
  collector.setQueueDepth("cbom_exports", 2);

  // 3. Findings
  collector.recordFinding({
    severity: "CRITICAL",
    quantumRisk: "quantum_vulnerable",
    riskScore: 95,
    moscaHorizon: "Y2K_IMMEDIATE",
    algorithmId: "RSA-1024",
  });
  collector.recordFinding({
    severity: "HIGH",
    quantumRisk: "quantum_vulnerable",
    riskScore: 70,
    moscaHorizon: "NEAR_TERM",
    algorithmId: "ECC-P256",
  });
  collector.recordFinding({
    severity: "LOW",
    quantumRisk: "quantum_safe",
    riskScore: 25,
    moscaHorizon: "SAFE_LONG_TERM",
    algorithmId: "ML-KEM-768",
  });

  // 4. Detection coverage
  collector.recordDetectionCoverage({
    totalDiscovered: 50,
    knownAlgorithmsCount: 35,
    totalKnownAlgorithms: 40,
  });

  // 5. Parser failures
  collector.recordParserFailure("python_ast");
  collector.recordParserFailure("java_javaparser");

  // 6. False positives
  collector.recordFalsePositive(true);  // rule suppression
  collector.recordFalsePositive(false); // user-verified

  // 7. Remediation
  collector.recordRemediation("proposed");
  collector.recordRemediation("approved");
  collector.recordRemediation("applied");
  collector.recordRemediation("verified");

  // 8. API latency & Error rates
  collector.recordApiLatency("GET", "/api/v1/cboms/:id", 45, 200);
  collector.recordApiLatency("POST", "/api/v1/scans", 120, 201);
  collector.recordApiLatency("GET", "/api/v1/assets", 500, 500);

  const metrics = collector.getOperationalMetrics();

  // Verify all 11 dimensions exist and are populated
  assert.ok(metrics.scan_duration.static_scanner.count === 2);
  assert.ok(metrics.scan_duration.static_scanner.maxMs === 1250);
  assert.ok(metrics.queue_depth.analysis_jobs === 14);
  assert.ok(metrics.cpu_memory.memory_rss_mb > 0);
  assert.ok(metrics.findings.by_severity.critical === 1);
  assert.ok(metrics.findings.quantum_vulnerable === 2);
  assert.ok(metrics.findings.quantum_safe === 1);
  assert.ok(metrics.detection_coverage.total_assets_discovered === 50);
  assert.ok(metrics.parser_failures.total === 2);
  assert.ok(metrics.false_positives.explainability_rule_suppressions === 1);
  assert.ok(metrics.risk_distribution.score_buckets["80_100"] === 1);
  assert.ok(metrics.remediation.verified === 1);
  assert.ok(metrics.remediation.success_rate_percent === 100);
  assert.ok(metrics.api_latency["GET /api/v1/cboms/:id"].p50_ms === 45);
  assert.ok(metrics.error_rates["2xx"] === 2);
  assert.ok(metrics.error_rates["5xx"] === 1);
});

test("Phase 18.3 — Prometheus text exporter produces standard exposition format", () => {
  const collector = new MetricsCollector();
  collector.recordScanDuration("combined_pipeline", 2400);
  collector.setQueueDepth("ingestion_queue", 5);
  collector.recordFinding({ severity: "HIGH", quantumRisk: "quantum_vulnerable", riskScore: 82 });
  collector.recordRemediation("applied");
  collector.recordRemediation("verified");

  const promText = exportPrometheusMetrics(collector);

  assert.ok(promText.includes("# HELP ecdat_scan_duration_seconds_count"));
  assert.ok(promText.includes("# TYPE ecdat_scan_duration_seconds_count counter"));
  assert.ok(promText.includes("ecdat_queue_depth{queue_name=\"ingestion_queue\"} 5"));
  assert.ok(promText.includes("# HELP ecdat_remediation_success_rate_percent"));
  assert.ok(promText.includes("ecdat_remediation_success_rate_percent 100"));
  assert.ok(promText.includes("ecdat_process_memory_bytes"));
  assert.ok(promText.endsWith("\n"));
});

test("Phase 18.3 — REST and Prometheus Endpoints", async () => {
  await withServer(async (baseUrl) => {
    // 1. GET /metrics (Prometheus standard exposition text)
    const metricsRes = await fetch(`${baseUrl}/metrics`);
    assert.equal(metricsRes.status, 200);
    assert.match(metricsRes.headers.get("content-type"), /text\/plain/);
    const metricsText = await metricsRes.text();
    assert.ok(metricsText.includes("ecdat_http_requests_total"));
    assert.ok(metricsText.includes("ecdat_process_uptime_seconds"));

    // 2. GET /api/v1/metrics/operational (Full 11-dimension JSON snapshot)
    const opRes = await fetch(`${baseUrl}/api/v1/metrics/operational`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(opRes.status, 200);
    const opData = await opRes.json();
    assert.ok(opData.scan_duration);
    assert.ok(opData.queue_depth);
    assert.ok(opData.cpu_memory);
    assert.ok(opData.findings);
    assert.ok(opData.detection_coverage);
    assert.ok(opData.parser_failures);
    assert.ok(opData.false_positives);
    assert.ok(opData.risk_distribution);
    assert.ok(opData.remediation);
    assert.ok(opData.api_latency);
    assert.ok(opData.error_rates);

    // 3. GET /api/v1/metrics/operational/:dimension
    const dimRes = await fetch(`${baseUrl}/api/v1/metrics/operational/cpu_memory`, {
      headers: AUTH_HEADERS,
    });
    assert.equal(dimRes.status, 200);
    const dimData = await dimRes.json();
    assert.equal(dimData.dimension, "cpu_memory");
    assert.ok(dimData.data.memory_rss_mb);

    // 4. POST /api/v1/metrics/record (Live metric ingestion)
    const recordRes = await fetch(`${baseUrl}/api/v1/metrics/record`, {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        type: "scan_duration",
        payload: { scannerType: "live_test_scanner", durationMs: 888 },
      }),
    });
    assert.equal(recordRes.status, 200);
    const recordData = await recordRes.json();
    assert.equal(recordData.success, true);
    assert.equal(recordData.type, "scan_duration");
  });
});
