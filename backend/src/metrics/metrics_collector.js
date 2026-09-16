/**
 * ECDAT Operational Metrics — Phase 18.3 Metrics Collector
 *
 * Tracks the 11 required enterprise operational metrics dimensions:
 * 1. scan duration
 * 2. queue depth
 * 3. CPU/memory
 * 4. findings
 * 5. detection coverage
 * 6. parser failures
 * 7. false positives
 * 8. risk distribution
 * 9. remediation success
 * 10. API latency
 * 11. error rates
 *
 * Guarantees zero sensitive tenant data in metrics outputs.
 */

const { sanitizeMetricRoute, sanitizeMetricLabels } = require("./sanitizer");

class MetricsCollector {
  constructor() {
    this.startTime = Date.now();
    this.reset();
  }

  reset() {
    // 1. Scan Duration Metrics by scanner type
    this.scanDurations = {
      static: { count: 0, totalMs: 0, minMs: null, maxMs: null, buckets: { "lt_5s": 0, "5_to_15s": 0, "15_to_30s": 0, "gt_30s": 0 } },
      network: { count: 0, totalMs: 0, minMs: null, maxMs: null, buckets: { "lt_5s": 0, "5_to_15s": 0, "15_to_30s": 0, "gt_30s": 0 } },
      binary: { count: 0, totalMs: 0, minMs: null, maxMs: null, buckets: { "lt_5s": 0, "5_to_15s": 0, "15_to_30s": 0, "gt_30s": 0 } },
      pipeline: { count: 0, totalMs: 0, minMs: null, maxMs: null, buckets: { "lt_5s": 0, "5_to_15s": 0, "15_to_30s": 0, "gt_30s": 0 } },
    };

    // 2. Queue Depth
    this.queues = {
      scans_pending: 0,
      scans_active: 0,
      scans_completed: 0,
      scans_failed: 0,
      ingestions_pending: 0,
      remediations_pending: 0,
    };

    // 4. Findings
    this.findings = {
      total: 0,
      by_severity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        informational: 0,
      },
      quantum_vulnerable: 0,
      quantum_safe: 0,
      transitional: 0,
    };

    // 5. Detection Coverage
    this.detectionCoverage = {
      total_assets_discovered: 0,
      unique_algorithms_detected: 0,
      known_standard_algorithms_total: 45, // CNSA 2.0 / NIST / BSI reference catalog
      coverage_percentage: 0.0,
      library_fingerprints_matched: 0,
    };

    // 6. Parser Failures by parser type
    this.parserFailures = {
      ast_c: 0,
      ast_cpp: 0,
      ast_go: 0,
      ast_js: 0,
      regex: 0,
      x509_certificate: 0,
      syft_binary: 0,
      cyclonedx_json: 0,
      total: 0,
    };

    // 7. False Positives
    this.falsePositives = {
      total_suppressed: 0,
      explainability_rule_suppressions: 0,
      user_verified_false_positives: 0,
      false_positive_rate_percent: 0.0,
    };

    // 8. Risk Distribution
    this.riskDistribution = {
      score_buckets: {
        "0_to_20": 0,
        "21_to_40": 0,
        "41_to_60": 0,
        "61_to_80": 0,
        "81_to_100": 0,
        "80_100": 0,
        "60_79": 0,
        "40_59": 0,
        "20_39": 0,
        "0_19": 0,
      },
      mosca_timeline: {
        collapse_within_1yr: 0,
        collapse_1_to_3yr: 0,
        collapse_3_to_5yr: 0,
        safe_beyond_5yr: 0,
      },
    };

    // 9. Remediation Success
    this.remediation = {
      proposed: 0,
      approved: 0,
      rejected: 0,
      applied: 0,
      verified: 0,
      verified_success: 0,
      failed: 0,
      rolled_back: 0,
      success_rate_percent: 100.0,
    };

    // 10. API Latency tracking
    this.apiLatencySamples = new Map(); // route -> Array<number>

    // 11. Error Rates by status family
    this.httpStatusCounts = {
      "2xx": 0,
      "3xx": 0,
      "4xx": 0,
      "5xx": 0,
      total_requests: 0,
      total_errors: 0,
      error_rate_percent: 0.0,
    };
  }

  /**
   * Records execution duration for a scan.
   */
  recordScanDuration(scannerType, durationMs) {
    const normType = String(scannerType || "pipeline").toLowerCase();
    if (!this.scanDurations[normType]) {
      this.scanDurations[normType] = { count: 0, totalMs: 0, minMs: null, maxMs: null, buckets: { "lt_5s": 0, "5_to_15s": 0, "15_to_30s": 0, "gt_30s": 0 } };
    }
    const target = this.scanDurations[normType];

    target.count++;
    target.totalMs += durationMs;
    target.minMs = target.minMs === null ? durationMs : Math.min(target.minMs, durationMs);
    target.maxMs = target.maxMs === null ? durationMs : Math.max(target.maxMs, durationMs);

    if (durationMs < 5000) target.buckets["lt_5s"]++;
    else if (durationMs <= 15000) target.buckets["5_to_15s"]++;
    else if (durationMs <= 30000) target.buckets["15_to_30s"]++;
    else target.buckets["gt_30s"]++;
  }

  /**
   * Sets depth for a specific queue by name.
   */
  setQueueDepth(queueName, depth) {
    if (typeof queueName === "string") {
      this.queues[queueName] = Math.max(0, depth || 0);
    }
  }

  /**
   * Updates current queue depths.
   */
  updateQueueDepth(depths = {}) {
    for (const [key, val] of Object.entries(depths)) {
      if (this.queues[key] !== undefined && typeof val === "number") {
        this.queues[key] = Math.max(0, val);
      }
    }
  }

  /**
   * Updates findings telemetry.
   */
  recordFindings(findingsSummary = {}) {
    if (typeof findingsSummary.total === "number") {
      this.findings.total = findingsSummary.total;
    }
    if (findingsSummary.by_severity) {
      this.findings.by_severity = { ...this.findings.by_severity, ...findingsSummary.by_severity };
    }
    if (typeof findingsSummary.quantum_vulnerable === "number") {
      this.findings.quantum_vulnerable = findingsSummary.quantum_vulnerable;
    }
    if (typeof findingsSummary.quantum_safe === "number") {
      this.findings.quantum_safe = findingsSummary.quantum_safe;
    }
    if (typeof findingsSummary.transitional === "number") {
      this.findings.transitional = findingsSummary.transitional;
    }
  }

  /**
   * Records a single finding occurrence.
   */
  recordFinding(finding = {}) {
    const sev = String(finding.severity || "informational").toLowerCase();
    if (this.findings.by_severity[sev] !== undefined) {
      this.findings.by_severity[sev]++;
    }
    this.findings.total++;

    const qRisk = finding.quantumRisk || finding.quantum_risk;
    if (qRisk === "quantum_vulnerable" || qRisk === true) {
      this.findings.quantum_vulnerable++;
    } else if (qRisk === "quantum_safe" || qRisk === false) {
      this.findings.quantum_safe++;
    } else if (qRisk === "transitional") {
      this.findings.transitional++;
    }

    const score = finding.riskScore !== undefined ? finding.riskScore : finding.risk_score;
    if (typeof score === "number") {
      if (score >= 80) this.riskDistribution.score_buckets["80_100"]++;
      else if (score >= 60) this.riskDistribution.score_buckets["60_79"]++;
      else if (score >= 40) this.riskDistribution.score_buckets["40_59"]++;
      else if (score >= 20) this.riskDistribution.score_buckets["20_39"]++;
      else this.riskDistribution.score_buckets["0_19"]++;
    }

    const h = finding.moscaHorizon || finding.mosca_horizon;
    if (h && this.riskDistribution.mosca_timeline[h] !== undefined) {
      this.riskDistribution.mosca_timeline[h]++;
    }
  }

  /**
   * Updates detection coverage metrics.
   */
  recordDetectionCoverage(data = {}) {
    if (typeof data.totalDiscovered === "number") {
      this.detectionCoverage.total_assets_discovered = data.totalDiscovered;
    }
    if (typeof data.knownAlgorithmsCount === "number" && data.totalKnownAlgorithms) {
      this.detectionCoverage.coverage_percentage = Number(
        ((data.knownAlgorithmsCount / data.totalKnownAlgorithms) * 100).toFixed(1)
      );
    }
  }

  /**
   * Updates detection coverage metrics.
   */
  updateDetectionCoverage(coverage = {}) {
    if (typeof coverage.total_assets_discovered === "number") {
      this.detectionCoverage.total_assets_discovered = coverage.total_assets_discovered;
    }
    if (typeof coverage.unique_algorithms_detected === "number") {
      this.detectionCoverage.unique_algorithms_detected = coverage.unique_algorithms_detected;
    }
    if (typeof coverage.library_fingerprints_matched === "number") {
      this.detectionCoverage.library_fingerprints_matched = coverage.library_fingerprints_matched;
    }
    const totalKnown = this.detectionCoverage.known_standard_algorithms_total || 45;
    this.detectionCoverage.coverage_percentage = Number(
      Math.min(100.0, ((this.detectionCoverage.unique_algorithms_detected / totalKnown) * 100)).toFixed(2)
    );
  }

  /**
   * Increments parser failure counter.
   */
  recordParserFailure(parserType) {
    const key = String(parserType || "regex").toLowerCase();
    if (this.parserFailures[key] !== undefined) {
      this.parserFailures[key]++;
    } else {
      this.parserFailures.regex++;
    }
    this.parserFailures.total++;
  }

  /**
   * Records false positive / suppression occurrence.
   */
  recordFalsePositive(type = "explainability") {
    if (type === "user" || type === false) {
      this.falsePositives.user_verified_false_positives++;
    } else {
      this.falsePositives.explainability_rule_suppressions++;
    }
    this.falsePositives.total_suppressed++;

    const totalFindings = this.findings.total + this.falsePositives.total_suppressed;
    if (totalFindings > 0) {
      this.falsePositives.false_positive_rate_percent = Number(
        ((this.falsePositives.total_suppressed / totalFindings) * 100).toFixed(2)
      );
    }
  }

  /**
   * Records risk score distribution.
   */
  recordRiskDistribution(distribution = {}) {
    if (distribution.score_buckets) {
      this.riskDistribution.score_buckets = { ...this.riskDistribution.score_buckets, ...distribution.score_buckets };
    }
    if (distribution.mosca_timeline) {
      this.riskDistribution.mosca_timeline = { ...this.riskDistribution.mosca_timeline, ...distribution.mosca_timeline };
    }
  }

  /**
   * Records a remediation lifecycle event.
   */
  recordRemediation(stage, success = true) {
    this.recordRemediationEvent(stage, success);
  }

  recordRemediationEvent(stage, success = true) {
    if (stage === "proposed") this.remediation.proposed++;
    else if (stage === "approved") this.remediation.approved++;
    else if (stage === "rejected") this.remediation.rejected++;
    else if (stage === "applied") {
      this.remediation.applied++;
      if (success) this.remediation.verified_success++;
      else this.remediation.failed++;
    } else if (stage === "verified") {
      this.remediation.verified++;
      this.remediation.verified_success++;
    } else if (stage === "rollback" || stage === "rolled_back") {
      this.remediation.rolled_back++;
    }

    const completed = this.remediation.verified_success + this.remediation.failed;
    if (completed > 0) {
      this.remediation.success_rate_percent = Number(
        ((this.remediation.verified_success / completed) * 100).toFixed(2)
      );
    }
  }

  recordApiLatency(method, route, durationMs, statusCode = 200) {
    this.recordHttpRequest(route, method, statusCode, durationMs);
  }

  /**
   * Records HTTP request latency and outcome.
   */
  recordHttpRequest(rawRoute, method, statusCode, durationMs) {
    const route = sanitizeMetricRoute(rawRoute);
    const key = `${method.toUpperCase()} ${route}`;

    if (!this.apiLatencySamples.has(key)) {
      this.apiLatencySamples.set(key, []);
    }
    const samples = this.apiLatencySamples.get(key);
    samples.push(durationMs);
    // Keep max 200 samples per route to bound memory
    if (samples.length > 200) samples.shift();

    // Tally HTTP status
    this.httpStatusCounts.total_requests++;
    if (statusCode >= 200 && statusCode < 300) this.httpStatusCounts["2xx"]++;
    else if (statusCode >= 300 && statusCode < 400) this.httpStatusCounts["3xx"]++;
    else if (statusCode >= 400 && statusCode < 500) {
      this.httpStatusCounts["4xx"]++;
      this.httpStatusCounts.total_errors++;
    } else if (statusCode >= 500) {
      this.httpStatusCounts["5xx"]++;
      this.httpStatusCounts.total_errors++;
    }

    if (this.httpStatusCounts.total_requests > 0) {
      this.httpStatusCounts.error_rate_percent = Number(
        ((this.httpStatusCounts.total_errors / this.httpStatusCounts.total_requests) * 100).toFixed(2)
      );
    }
  }

  /**
   * Gathers live CPU and memory telemetry.
   */
  getCpuMemoryMetrics() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const uptimeSec = Math.floor(process.uptime());

    return {
      memory_rss_mb: Number((mem.rss / (1024 * 1024)).toFixed(2)),
      heap_total_mb: Number((mem.heapTotal / (1024 * 1024)).toFixed(2)),
      heap_used_mb: Number((mem.heapUsed / (1024 * 1024)).toFixed(2)),
      external_mb: Number((mem.external / (1024 * 1024)).toFixed(2)),
      cpu_user_ms: Number((cpu.user / 1000).toFixed(2)),
      cpu_system_ms: Number((cpu.system / 1000).toFixed(2)),
      uptime_seconds: uptimeSec,
    };
  }

  /**
   * Computes latency quantiles (p50, p90, p95, p99, avg).
   */
  getApiLatencyMetrics() {
    const results = {};

    for (const [route, samples] of this.apiLatencySamples.entries()) {
      if (samples.length === 0) continue;
      const sorted = [...samples].sort((a, b) => a - b);
      const count = sorted.length;
      const sum = sorted.reduce((acc, v) => acc + v, 0);

      const p50 = sorted[Math.floor(count * 0.5)];
      const p90 = sorted[Math.floor(count * 0.9)] || sorted[count - 1];
      const p95 = sorted[Math.floor(count * 0.95)] || sorted[count - 1];
      const p99 = sorted[Math.floor(count * 0.99)] || sorted[count - 1];

      results[route] = {
        request_count: count,
        avg_ms: Number((sum / count).toFixed(2)),
        p50_ms: Number(p50.toFixed(2)),
        p90_ms: Number(p90.toFixed(2)),
        p95_ms: Number(p95.toFixed(2)),
        p99_ms: Number(p99.toFixed(2)),
      };
    }

    return results;
  }

  /**
   * Returns a complete JSON snapshot of all 11 operational metric dimensions.
   */
  getOperationalMetrics() {
    return {
      timestamp: new Date().toISOString(),
      service: "ecdat-discovery-engine",
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),

      // 1. Scan Duration
      scan_duration: this.scanDurations,

      // 2. Queue Depth
      queue_depth: this.queues,

      // 3. CPU / Memory
      cpu_memory: this.getCpuMemoryMetrics(),

      // 4. Findings
      findings: this.findings,

      // 5. Detection Coverage
      detection_coverage: this.detectionCoverage,

      // 6. Parser Failures
      parser_failures: this.parserFailures,

      // 7. False Positives
      false_positives: this.falsePositives,

      // 8. Risk Distribution
      risk_distribution: this.riskDistribution,

      // 9. Remediation Success
      remediation: this.remediation,
      remediation_success: this.remediation,

      // 10. API Latency
      api_latency: this.getApiLatencyMetrics(),

      // 11. Error Rates
      error_rates: this.httpStatusCounts,
    };
  }
}

const defaultMetricsCollector = new MetricsCollector();

module.exports = {
  MetricsCollector,
  defaultMetricsCollector,
};
