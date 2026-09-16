/**
 * ECDAT Operational Metrics — Phase 18.3 Prometheus Exporter
 *
 * Serializes the 11 operational metrics into standard Prometheus exposition format.
 * Strictly guarantees that no sensitive tenant data or proprietary secrets leak into labels.
 */

const { defaultMetricsCollector } = require("./metrics_collector");
const { sanitizeMetricLabels } = require("./sanitizer");

/**
 * Generates standard Prometheus exposition text representation.
 *
 * @param {MetricsCollector} [collector=defaultMetricsCollector]
 * @returns {string} Prometheus exposition text
 */
function exportPrometheusMetrics(collector = defaultMetricsCollector) {
  const m = collector.getOperationalMetrics();
  const lines = [];

  const addHeader = (name, help, type) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
  };

  const addMetric = (name, labels, value) => {
    const cleanLabels = sanitizeMetricLabels(labels);
    const labelEntries = Object.entries(cleanLabels);
    let labelStr = "";
    if (labelEntries.length > 0) {
      labelStr = "{" + labelEntries.map(([k, v]) => `${k}="${v}"`).join(",") + "}";
    }
    lines.push(`${name}${labelStr} ${value}`);
  };

  // 1. Scan Duration Metrics
  addHeader("ecdat_scan_duration_seconds_count", "Total number of completed scans by scanner type", "counter");
  addHeader("ecdat_scan_duration_seconds_sum", "Sum of scan duration in seconds by scanner type", "counter");
  addHeader("ecdat_scan_duration_seconds_max", "Max scan duration in seconds by scanner type", "gauge");

  for (const [type, data] of Object.entries(m.scan_duration)) {
    addMetric("ecdat_scan_duration_seconds_count", { scanner_type: type }, data.count);
    addMetric("ecdat_scan_duration_seconds_sum", { scanner_type: type }, Number((data.totalMs / 1000).toFixed(3)));
    if (data.maxMs !== null) {
      addMetric("ecdat_scan_duration_seconds_max", { scanner_type: type }, Number((data.maxMs / 1000).toFixed(3)));
    }
  }

  // 2. Queue Depth
  addHeader("ecdat_queue_depth", "Current queue depth of asynchronous pipeline tasks", "gauge");
  for (const [queueName, depth] of Object.entries(m.queue_depth)) {
    addMetric("ecdat_queue_depth", { queue_name: queueName }, depth);
  }

  // 3. CPU and Memory
  addHeader("ecdat_process_memory_bytes", "Node.js process memory metrics in bytes", "gauge");
  addMetric("ecdat_process_memory_bytes", { type: "rss" }, m.cpu_memory.memory_rss_mb * 1024 * 1024);
  addMetric("ecdat_process_memory_bytes", { type: "heap_total" }, m.cpu_memory.heap_total_mb * 1024 * 1024);
  addMetric("ecdat_process_memory_bytes", { type: "heap_used" }, m.cpu_memory.heap_used_mb * 1024 * 1024);

  addHeader("ecdat_process_cpu_seconds_total", "Total CPU seconds consumed by process", "counter");
  addMetric("ecdat_process_cpu_seconds_total", { mode: "user" }, Number((m.cpu_memory.cpu_user_ms / 1000).toFixed(3)));
  addMetric("ecdat_process_cpu_seconds_total", { mode: "system" }, Number((m.cpu_memory.cpu_system_ms / 1000).toFixed(3)));

  addHeader("ecdat_process_uptime_seconds", "Total runtime in seconds since server boot", "counter");
  addMetric("ecdat_process_uptime_seconds", {}, m.cpu_memory.uptime_seconds);

  // 4. Findings
  addHeader("ecdat_findings_total", "Total findings discovered by severity level", "gauge");
  for (const [sev, count] of Object.entries(m.findings.by_severity)) {
    addMetric("ecdat_findings_total", { severity: sev }, count);
  }

  addHeader("ecdat_findings_quantum_risk_total", "Findings grouped by quantum threat readiness", "gauge");
  addMetric("ecdat_findings_quantum_risk_total", { status: "quantum_vulnerable" }, m.findings.quantum_vulnerable);
  addMetric("ecdat_findings_quantum_risk_total", { status: "quantum_safe" }, m.findings.quantum_safe);
  addMetric("ecdat_findings_quantum_risk_total", { status: "transitional" }, m.findings.transitional);

  // 5. Detection Coverage
  addHeader("ecdat_detection_coverage_percent", "Percentage of standard cryptographic algorithms detected", "gauge");
  addMetric("ecdat_detection_coverage_percent", {}, m.detection_coverage.coverage_percentage);

  addHeader("ecdat_discovered_assets_total", "Total cryptographic assets identified", "gauge");
  addMetric("ecdat_discovered_assets_total", {}, m.detection_coverage.total_assets_discovered);

  // 6. Parser Failures
  addHeader("ecdat_parser_failures_total", "Total parser failures by parser component", "counter");
  for (const [parser, count] of Object.entries(m.parser_failures)) {
    if (parser !== "total") {
      addMetric("ecdat_parser_failures_total", { parser }, count);
    }
  }

  // 7. False Positives
  addHeader("ecdat_false_positives_total", "Total suppressed or user-marked false positives", "counter");
  addMetric("ecdat_false_positives_total", { type: "rule_suppression" }, m.false_positives.explainability_rule_suppressions);
  addMetric("ecdat_false_positives_total", { type: "user_verified" }, m.false_positives.user_verified_false_positives);

  addHeader("ecdat_false_positive_rate_percent", "Percentage of findings suppressed as false positives", "gauge");
  addMetric("ecdat_false_positive_rate_percent", {}, m.false_positives.false_positive_rate_percent);

  // 8. Risk Distribution
  addHeader("ecdat_risk_score_distribution", "Count of assets in each risk score bracket", "gauge");
  for (const [bucket, count] of Object.entries(m.risk_distribution.score_buckets)) {
    addMetric("ecdat_risk_score_distribution", { bracket: bucket }, count);
  }

  addHeader("ecdat_mosca_timeline_distribution", "Count of assets in each Mosca quantum migration timeline bucket", "gauge");
  for (const [bucket, count] of Object.entries(m.risk_distribution.mosca_timeline)) {
    addMetric("ecdat_mosca_timeline_distribution", { horizon: bucket }, count);
  }

  // 9. Remediation Success
  addHeader("ecdat_remediation_actions_total", "Count of remediation actions by stage", "counter");
  for (const [stage, count] of Object.entries(m.remediation)) {
    if (stage !== "success_rate_percent") {
      addMetric("ecdat_remediation_actions_total", { stage }, count);
    }
  }

  addHeader("ecdat_remediation_success_rate_percent", "Percentage of applied remediations that verified successfully", "gauge");
  addMetric("ecdat_remediation_success_rate_percent", {}, m.remediation.success_rate_percent);

  // 10. API Latency
  addHeader("ecdat_http_request_duration_ms", "HTTP request latency in milliseconds by route", "gauge");
  for (const [routeKey, stats] of Object.entries(m.api_latency)) {
    const [method, route] = routeKey.split(" ");
    addMetric("ecdat_http_request_duration_ms", { method, route, quantile: "p50" }, stats.p50_ms);
    addMetric("ecdat_http_request_duration_ms", { method, route, quantile: "p90" }, stats.p90_ms);
    addMetric("ecdat_http_request_duration_ms", { method, route, quantile: "p95" }, stats.p95_ms);
    addMetric("ecdat_http_request_duration_ms", { method, route, quantile: "avg" }, stats.avg_ms);
  }

  // 11. Error Rates
  addHeader("ecdat_http_requests_total", "Total HTTP requests by response status family", "counter");
  addMetric("ecdat_http_requests_total", { status_family: "2xx" }, m.error_rates["2xx"]);
  addMetric("ecdat_http_requests_total", { status_family: "3xx" }, m.error_rates["3xx"]);
  addMetric("ecdat_http_requests_total", { status_family: "4xx" }, m.error_rates["4xx"]);
  addMetric("ecdat_http_requests_total", { status_family: "5xx" }, m.error_rates["5xx"]);

  addHeader("ecdat_http_error_rate_percent", "Percentage of HTTP requests that resulted in 4xx/5xx errors", "gauge");
  addMetric("ecdat_http_error_rate_percent", {}, m.error_rates.error_rate_percent);

  return lines.join("\n") + "\n";
}

module.exports = {
  exportPrometheusMetrics,
};
