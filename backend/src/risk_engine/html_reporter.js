/**
 * Escapes HTML characters to prevent XSS.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Strips secret-like material from string output for safety.
 */
function sanitizeReportText(str) {
  if (!str) return "";
  return str
    .replace(
      /(?:-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----|-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----|-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----)/gi,
      "[REDACTED_PRIVATE_KEY]",
    )
    .replace(/bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, "bearer [REDACTED_TOKEN]");
}

/**
 * Generates a self-contained, beautifully styled static HTML report from the ECDAT summary.
 *
 * @param {Object} summary - Executive summary object from generateSummary
 * @returns {string} HTML string
 */
function generateHtmlReport(summary) {
  const {
    report_metadata: meta = {},
    metrics = {},
    top_risky_assets: topAssets = [],
    mosca_analysis_table: moscaTable = [],
    recommendations = [],
    assumptions = [],
    prioritization = {},
  } = summary;

  const cicdBadge = metrics.overall_cicd_pass
    ? '<span class="badge badge-pass">CI/CD PASS</span>'
    : '<span class="badge badge-fail">CI/CD FAIL</span>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ECDAT Cryptographic Risk Assessment Report</title>
  <style>
    :root {
      --bg-main: #0a0f1d;
      --bg-card: #0f172a;
      --bg-card-header: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: #1e293b;
      --color-critical: #ef4444;
      --color-high: #f97316;
      --color-medium: #eab308;
      --color-low: #38bdf8;
      --color-info: #06b6d4;
      --color-pass: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg-main);
      color: var(--text-main);
      line-height: 1.5;
      padding: 2rem 1.5rem;
      -webkit-font-smoothing: antialiased;
    }
    .container {
      max-width: 1320px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 1.5rem;
      margin-bottom: 2rem;
      gap: 1.5rem;
      flex-wrap: wrap;
    }
    h1 {
      font-size: 1.85rem;
      font-weight: 800;
      color: #f8fafc;
      letter-spacing: -0.025em;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 0.875rem;
      margin-top: 0.25rem;
    }
    .meta-tags {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      margin-top: 0.75rem;
    }
    .meta-tag {
      background: #131d31;
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 6px;
      padding: 0.25rem 0.65rem;
      font-size: 0.75rem;
      color: #94a3b8;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .meta-tag strong {
      color: #38bdf8;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
    }
    .badge-pass { background-color: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-fail { background-color: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .badge-critical { background-color: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid #ef4444; }
    .badge-high { background-color: rgba(249, 115, 22, 0.2); color: #fdba74; border: 1px solid #f97316; }
    .badge-medium { background-color: rgba(234, 179, 8, 0.2); color: #fde047; border: 1px solid #eab308; }
    .badge-low { background-color: rgba(56, 189, 248, 0.15); color: #7dd3fc; border: 1px solid #38bdf8; }
    .badge-info { background-color: rgba(6, 182, 212, 0.15); color: #67e8f9; border: 1px solid #06b6d4; }
    .badge-safe { background-color: rgba(16, 185, 129, 0.2); color: #6ee7b7; border: 1px solid #10b981; }
    .badge-urgent { background-color: rgba(185, 28, 28, 0.25); color: #fca5a5; border: 1px solid #b91c1c; }
    .badge-confirmed { background-color: rgba(5, 150, 105, 0.2); color: #6ee7b7; border: 1px solid #059669; }
    .badge-heuristic { background-color: rgba(100, 116, 139, 0.2); color: #cbd5e1; border: 1px solid #64748b; }
    .badge-composite { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }

    .grid-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      position: relative;
      overflow: hidden;
    }
    .metric-title {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      font-weight: 700;
      letter-spacing: 0.05em;
    }
    .metric-value {
      font-size: 2.25rem;
      font-weight: 800;
      margin-top: 0.35rem;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }

    .section {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.75rem;
      margin-bottom: 2rem;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.3);
    }
    .section-title {
      font-size: 1.25rem;
      font-weight: 700;
      margin-bottom: 0.5rem;
      color: #f8fafc;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Table Container Styling */
    .table-wrapper {
      width: 100%;
      overflow-x: auto;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      background: #090e1a;
      margin-top: 1rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 0.8125rem;
      table-layout: fixed;
    }
    th {
      background-color: #131c2e;
      padding: 0.85rem 1rem;
      font-weight: 700;
      font-size: 0.725rem;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      border-bottom: 1px solid var(--border-color);
      white-space: nowrap;
    }
    td {
      padding: 0.85rem 1rem;
      border-top: 1px solid #172338;
      vertical-align: middle;
      color: #e2e8f0;
    }
    tr:hover td {
      background-color: rgba(56, 189, 248, 0.02);
    }

    /* Column Width Classes for Top Risky Assets */
    .col-asset { width: 28%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.75rem; word-break: break-all; color: #38bdf8; }
    .col-algo { width: 12%; white-space: nowrap; }
    .col-type { width: 11%; font-size: 0.75rem; color: #94a3b8; word-break: break-word; }
    .col-sev { width: 9%; text-align: center; }
    .col-conf { width: 9%; text-align: center; }
    .col-mosca { width: 11%; text-align: center; }
    .col-summary { width: 20%; font-size: 0.75rem; line-height: 1.45; color: #cbd5e1; word-break: break-word; }

    /* Mosca Table Column Widths */
    .mosca-asset { width: 26%; font-family: ui-monospace, Menlo, monospace; font-size: 0.75rem; word-break: break-all; color: #38bdf8; }
    .mosca-algo { width: 10%; white-space: nowrap; }
    .mosca-sens { width: 10%; text-align: center; font-size: 0.75rem; text-transform: uppercase; color: #94a3b8; }
    .mosca-metric { width: 9%; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; font-family: ui-monospace, monospace; }
    .mosca-margin { width: 9%; text-align: right; white-space: nowrap; font-weight: 700; font-variant-numeric: tabular-nums; font-family: ui-monospace, monospace; }
    .mosca-status { width: 9%; text-align: center; white-space: nowrap; }

    /* Business Unit Columns */
    .bu-name { width: 20%; font-weight: 600; }
    .bu-score { width: 12%; text-align: center; }
    .bu-num { width: 9%; text-align: right; font-family: ui-monospace, monospace; }
    .bu-why { width: 41%; font-size: 0.75rem; line-height: 1.45; color: #cbd5e1; }

    /* Recommendation Cards */
    .rec-card {
      background: #0d1527;
      border: 1px solid var(--border-color);
      border-left: 4px solid #38bdf8;
      border-radius: 8px;
      padding: 1.25rem;
      margin-bottom: 1.25rem;
    }
    .rec-card.rec-critical { border-left-color: var(--color-critical); }
    .rec-card.rec-high { border-left-color: var(--color-high); }
    .rec-card.rec-medium { border-left-color: var(--color-medium); }
    .rec-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .rec-target { font-weight: 700; font-size: 1.05rem; color: #f8fafc; }
    .rec-block {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(51, 65, 85, 0.4);
      border-radius: 6px;
      padding: 0.65rem 0.85rem;
      margin-bottom: 0.5rem;
      font-size: 0.8125rem;
    }
    .rec-block strong { color: #38bdf8; }
    .rec-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.75rem;
      margin-top: 0.85rem;
      padding-top: 0.75rem;
      border-top: 1px solid rgba(51, 65, 85, 0.4);
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .rec-details strong { color: #f8fafc; }

    /* Strategic Migration Sequence Cards */
    .phase-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 1rem;
    }
    .phase-card {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      background: #090e1a;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.85rem 1.15rem;
    }
    .phase-badge {
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      border-radius: 6px;
      padding: 0.2rem 0.6rem;
      font-size: 0.7rem;
      font-weight: 800;
      font-family: ui-monospace, monospace;
      letter-spacing: 0.05em;
      white-space: nowrap;
      margin-top: 0.15rem;
    }
    .phase-content {
      font-size: 0.8125rem;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .phase-content strong {
      color: #f8fafc;
      font-size: 0.875rem;
      display: block;
      margin-bottom: 0.15rem;
    }

    ul.assumptions-list {
      list-style-type: none;
      padding: 0;
      margin-top: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    ul.assumptions-list li {
      font-size: 0.8125rem;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    ul.assumptions-list li::before {
      content: "•";
      color: #38bdf8;
      font-size: 1.25rem;
      line-height: 1;
    }

    @media print {
      body { background: #ffffff !important; color: #0f172a !important; padding: 0.5cm !important; }
      .container { max-width: 100% !important; }
      header { border-bottom: 2px solid #0f172a !important; }
      .section, .metric-card { background: #ffffff !important; border: 1px solid #cbd5e1 !important; color: #0f172a !important; page-break-inside: avoid; box-shadow: none !important; }
      .rec-card { background: #f8fafc !important; border: 1px solid #cbd5e1 !important; border-left-width: 4px !important; page-break-inside: avoid; }
      .table-wrapper { border: 1px solid #cbd5e1 !important; background: #ffffff !important; }
      th { background-color: #f1f5f9 !important; color: #0f172a !important; border-bottom: 1px solid #cbd5e1 !important; }
      td { border-top: 1px solid #cbd5e1 !important; color: #0f172a !important; }
      .meta-tag { background: #f1f5f9 !important; border-color: #cbd5e1 !important; color: #334155 !important; }
      .badge-pass { background-color: #d1fae5 !important; color: #065f46 !important; border: 1px solid #059669 !important; }
      .badge-fail { background-color: #fee2e2 !important; color: #991b1b !important; border: 1px solid #dc2626 !important; }
      .col-asset, .mosca-asset { color: #0284c7 !important; }
      .phase-card { background: #f8fafc !important; border-color: #cbd5e1 !important; }
      .phase-badge { background: #e0f2fe !important; color: #0369a1 !important; border-color: #bae6fd !important; }
      .phase-content strong { color: #0f172a !important; }
      .phase-content { color: #334155 !important; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>ECDAT Cryptographic Risk Assessment</h1>
        <div class="subtitle">Enterprise Cryptographic Discovery and Assessment Tool &bull; Explainable PQC Evaluation</div>
        <div class="meta-tags">
          <span class="meta-tag">Profile: <strong>${escapeHtml(meta.policy_profile || "regulated_bfsi")}</strong></span>
          <span class="meta-tag">Timeline: <strong>${escapeHtml(meta.scenario || "baseline")}</strong></span>
          <span class="meta-tag">Rules: <strong>v${escapeHtml(meta.rule_version || "1.0.0")}</strong></span>
          <span class="meta-tag">Generated: <strong>${escapeHtml(meta.generated_at || new Date().toISOString())}</strong></span>
        </div>
      </div>
      <div>
        ${cicdBadge}
      </div>
    </header>

    <!-- Metrics Grid -->
    <div class="grid-metrics">
      <div class="metric-card">
        <div class="metric-title">Total Assets</div>
        <div class="metric-value">${metrics?.total_assets || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Total Findings</div>
        <div class="metric-value">${metrics?.total_findings || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title" style="color: var(--color-critical);">Critical Findings</div>
        <div class="metric-value" style="color: var(--color-critical);">${metrics?.severity_counts?.critical || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title" style="color: var(--color-high);">High Findings</div>
        <div class="metric-value" style="color: var(--color-high);">${metrics?.severity_counts?.high || 0}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title" style="color: #f59e0b;">At Quantum Risk</div>
        <div class="metric-value" style="color: #f59e0b;">${metrics?.assets_at_quantum_risk || 0}</div>
      </div>
    </div>

    <!-- Top Risky Assets -->
    <div class="section">
      <div class="section-title">Top Risky Assets</div>
      <div class="subtitle" style="margin-bottom: 0.75rem;">Cryptographic components requiring immediate remediation or PQC modernization.</div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th class="col-asset">Asset / BOM Reference</th>
              <th class="col-algo">Algorithm</th>
              <th class="col-type">Asset Type</th>
              <th class="col-sev">Severity</th>
              <th class="col-conf">Confidence</th>
              <th class="col-mosca">Mosca Status</th>
              <th class="col-summary">Risk Summary</th>
            </tr>
          </thead>
          <tbody>
            ${
              topAssets.length === 0
                ? '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--text-muted);">No risky assets identified. Database cryptographic posture is clean.</td></tr>'
                : topAssets
                    .map(
                      (a) => `
              <tr>
                <td class="col-asset"><code>${escapeHtml(sanitizeReportText(a.asset_id))}</code></td>
                <td class="col-algo"><strong>${escapeHtml(sanitizeReportText(a.algorithm))}</strong> ${a.key_size ? `<small style="color: var(--text-muted); font-family: ui-monospace, monospace;">(${a.key_size}b)</small>` : ""}</td>
                <td class="col-type">${escapeHtml(sanitizeReportText(a.asset_type))}</td>
                <td class="col-sev"><span class="badge badge-${escapeHtml((a.risk_severity || a.severity || "info").toLowerCase())}">${escapeHtml(a.risk_severity || a.severity || "Info")}</span></td>
                <td class="col-conf"><span class="badge badge-${escapeHtml((a.risk_confidence || "high").toLowerCase())}">${escapeHtml(a.risk_confidence || "HIGH")}</span>${a.is_uncertain_detection ? ' <small style="color:#f87171;font-weight:600;display:block;margin-top:2px;">(Uncertain)</small>' : ''}</td>
                <td class="col-mosca"><span class="badge badge-${escapeHtml((a.mosca_status || "safe").toLowerCase())}">${escapeHtml(a.mosca_status || "Safe")}</span></td>
                <td class="col-summary">${escapeHtml(sanitizeReportText(a.explanation || ""))}</td>
              </tr>
            `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Enterprise Prioritization & "Why Now?" Action Strategy -->
    ${
      prioritization.business_unit_risk?.length > 0 || prioritization.remediation_effort?.quick_wins?.length > 0
        ? `
    <div class="section">
      <div class="section-title">Enterprise Prioritization &amp; &ldquo;Why Now?&rdquo; Action Strategy</div>
      <div class="subtitle" style="margin-bottom: 1.25rem;">
        Actionable risk prioritization across Business Units, Internet Perimeter, PQC Exposure, and High-Leverage Quick Wins.
      </div>

      <!-- Quick Wins Banner if present -->
      ${
        prioritization.remediation_effort?.quick_wins?.length > 0
          ? `
      <div style="background: rgba(16, 185, 129, 0.1); border-left: 4px solid #10b981; border-radius: 8px; padding: 1.15rem; margin-bottom: 1.5rem;">
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
          <strong style="color: #34d399; font-size: 0.95rem;">&#x2714; ${prioritization.remediation_effort.quick_wins.length} High-Leverage Quick Win(s) Identified</strong>
          <span class="badge badge-safe">IMMEDIATE ROI</span>
        </div>
        <div style="font-size: 0.8125rem; color: var(--text-muted); margin-top: 0.35rem; line-height: 1.45;">
          ${escapeHtml(prioritization.remediation_effort.why_now)}
        </div>
      </div>
      `
          : ""
      }

      <!-- Business Unit Prioritization Table -->
      ${
        prioritization.business_unit_risk?.length > 0
          ? `
      <h3 style="font-size: 0.95rem; font-weight: 700; margin-bottom: 0.5rem; color: var(--text-main);">Business-Unit Risk &amp; "Why Now?" Reasoning</h3>
      <div class="table-wrapper" style="margin-bottom: 1.5rem;">
        <table>
          <thead>
            <tr>
              <th class="bu-name">Business Unit</th>
              <th class="bu-score">Composite Score</th>
              <th class="bu-num">Assets</th>
              <th class="bu-num">Criticals</th>
              <th class="bu-num">Internet Exposed</th>
              <th class="bu-num">PQC Urgent</th>
              <th class="bu-why">"Why Now?" Rationale</th>
            </tr>
          </thead>
          <tbody>
            ${prioritization.business_unit_risk
              .map(
                (bu) => `
              <tr>
                <td class="bu-name"><strong>${escapeHtml(bu.business_unit)}</strong></td>
                <td class="bu-score"><span class="badge ${bu.composite_risk_score >= 70 ? "badge-critical" : bu.composite_risk_score >= 40 ? "badge-medium" : "badge-safe"}">${bu.composite_risk_score}/100</span></td>
                <td class="bu-num">${bu.total_assets}</td>
                <td class="bu-num" style="${bu.critical_count > 0 ? "color: var(--color-critical); font-weight: 700;" : ""}">${bu.critical_count}</td>
                <td class="bu-num" style="${bu.internet_facing_count > 0 ? "color: var(--color-high); font-weight: 700;" : ""}">${bu.internet_facing_count}</td>
                <td class="bu-num" style="${bu.pqc_urgent_count > 0 ? "color: #f59e0b; font-weight: 700;" : ""}">${bu.pqc_urgent_count}</td>
                <td class="bu-why">${escapeHtml(bu.why_now)}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
      `
          : ""
      }
    </div>
    `
        : ""
    }

    <!-- Mosca Analysis Table (X + Y > Z) -->
    <div class="section">
      <div class="section-title">Mosca Theorem Quantum Exposure Table (X + Y &gt; Z)</div>
      <div class="subtitle" style="margin-bottom: 0.75rem;">
        Formula: <strong>Margin = (X Shelf-Life + Y Migration) - Z Threat Horizon</strong>. Positive margins indicate compromise before migration completes.
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th class="mosca-asset">Asset</th>
              <th class="mosca-algo">Algorithm</th>
              <th class="mosca-sens">Sensitivity</th>
              <th class="mosca-metric">X (Shelf-Life)</th>
              <th class="mosca-metric">Y (Migration)</th>
              <th class="mosca-metric">Z (CRQC Threat)</th>
              <th class="mosca-metric">Total (X+Y)</th>
              <th class="mosca-margin">Margin</th>
              <th class="mosca-status">Status</th>
            </tr>
          </thead>
          <tbody>
            ${
              moscaTable.length === 0
                ? '<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--text-muted);">No cryptographic assets required Mosca calculation.</td></tr>'
                : moscaTable
                    .map(
                      (m) => `
              <tr>
                <td class="mosca-asset"><code>${escapeHtml(sanitizeReportText(m.asset_id))}</code></td>
                <td class="mosca-algo"><strong>${escapeHtml(m.algorithm)}</strong></td>
                <td class="mosca-sens">${escapeHtml(m.data_sensitivity)}</td>
                <td class="mosca-metric">${m.X_shelf_life_years} yrs</td>
                <td class="mosca-metric">${m.Y_migration_years} yrs</td>
                <td class="mosca-metric">${m.Z_threat_years} yrs</td>
                <td class="mosca-metric"><strong>${m.mosca_total_years} yrs</strong></td>
                <td class="mosca-margin" style="color: ${m.mosca_margin_years > 0 ? "var(--color-critical)" : "var(--color-pass)"}">
                  ${m.mosca_margin_years > 0 ? "+" : ""}${m.mosca_margin_years} yrs
                </td>
                <td class="mosca-status"><span class="badge badge-${escapeHtml(m.status.toLowerCase())}">${escapeHtml(m.status)}</span></td>
              </tr>
            `,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>

    <!-- Context-Aware Recommendations -->
    <div class="section">
      <div class="section-title">Post-Quantum &amp; Classical Migration Recommendations</div>
      <div class="subtitle" style="margin-bottom: 1rem;">Target architectural modernizations and cryptographic agility guidance.</div>
      ${
        recommendations.length === 0
          ? '<p style="color: var(--text-muted); font-size: 0.875rem;">No migration actions required.</p>'
          : recommendations
              .map(
                (r) => `
        <div class="rec-card rec-${escapeHtml(r.priority.toLowerCase())}">
          <div class="rec-header">
            <span class="rec-target">${escapeHtml(r.recommended_target)}</span>
            <span class="badge badge-${escapeHtml(r.priority.toLowerCase())}">${escapeHtml(r.priority)} Priority</span>
          </div>
          <div class="rec-block">
            <strong>Context:</strong> ${escapeHtml(r.current_state)}
          </div>
          <div class="rec-block" style="border-left: 3px solid #f97316;">
            <strong style="color: #fdba74;">Classical Remediation:</strong> ${escapeHtml(r.classical_remediation)}
          </div>
          <div class="rec-block" style="border-left: 3px solid #38bdf8;">
            <strong style="color: #7dd3fc;">PQC Migration:</strong> ${escapeHtml(r.pqc_migration)}
          </div>
          <div class="rec-details">
            <div><strong>Hybrid Transition:</strong> ${r.hybrid_transition_recommended ? "Recommended (Dual/Composite)" : "Direct Cutover"}</div>
            <div><strong>Migration Complexity:</strong> ${escapeHtml(r.migration_complexity)}</div>
            <div><strong>Estimated Latency Impact:</strong> ${escapeHtml(r.latency_impact)}</div>
            <div><strong>Cost Band:</strong> ${escapeHtml(r.cost_category)}</div>
            <div><strong>Standards Reference:</strong> ${escapeHtml((r.references || []).join(", "))}</div>
          </div>
        </div>
      `,
              )
              .join("")
      }
    </div>

    <!-- Suggested Migration Sequence -->
    <div class="section">
      <div class="section-title">Suggested Strategic Migration Sequence</div>
      <div class="subtitle" style="margin-bottom: 1rem;">
        Recommended 5-phase execution sequence aligned with NIST PQC, NSA CNSA 2.0, and BSI TR-02102:
      </div>
      <div class="phase-list">
        <div class="phase-card">
          <div class="phase-badge">PHASE 1</div>
          <div class="phase-content">
            <strong>Remove classically broken crypto</strong>
            Deprecate and eradicate MD5, SHA-1, DES, 3DES, RC4, sub-2048 RSA, and exposed secrets.
          </div>
        </div>
        <div class="phase-card">
          <div class="phase-badge">PHASE 2</div>
          <div class="phase-content">
            <strong>Upgrade legacy transport</strong>
            Decommission TLS 1.0/1.1; mandate TLS 1.2+ / TLS 1.3 with AEAD suites and modern SSH key exchange.
          </div>
        </div>
        <div class="phase-card">
          <div class="phase-badge">PHASE 3</div>
          <div class="phase-content">
            <strong>Identify long-lived confidentiality assets</strong>
            Prioritize stored database ciphertext, backups, and archives with shelf-life X &ge; 7 years vulnerable to SNDL.
          </div>
        </div>
        <div class="phase-card">
          <div class="phase-badge">PHASE 4</div>
          <div class="phase-content">
            <strong>Pilot hybrid PQC</strong>
            Deploy composite/hybrid key encapsulation (e.g. X25519MLKEM768) on perimeter traffic and hybrid DEK envelopes.
          </div>
        </div>
        <div class="phase-card">
          <div class="phase-badge">PHASE 5</div>
          <div class="phase-content">
            <strong>Measure and deploy</strong>
            Profile latency and MTU overhead; benchmark client compatibility; deploy full NIST FIPS 203/204 post-quantum standards.
          </div>
        </div>
      </div>
    </div>

    <!-- Assumptions & Environment Policy -->
    <div class="section">
      <div class="section-title">Evaluation Assumptions &amp; Scope</div>
      <ul class="assumptions-list">
        ${assumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}
      </ul>
    </div>
  </div>
</body>
</html>
`;
}

module.exports = {
  generateHtmlReport,
  escapeHtml,
  sanitizeReportText,
};
