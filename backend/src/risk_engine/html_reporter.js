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
      /-----BEGIN [A-Z ]+PRIVATE KEY-----[a-zA-Z0-9\/\+=\r\n]+-----END [A-Z ]+PRIVATE KEY-----/g,
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
    report_metadata: meta,
    metrics,
    top_risky_assets: topAssets = [],
    mosca_analysis_table: moscaTable = [],
    recommendations = [],
    assumptions = [],
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
      --bg-main: #0f172a;
      --bg-card: #1e293b;
      --bg-card-header: #334155;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --border-color: #334155;
      --color-critical: #ef4444;
      --color-high: #f97316;
      --color-medium: #eab308;
      --color-low: #3b82f6;
      --color-info: #10b981;
      --color-pass: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-main);
      color: var(--text-main);
      line-height: 1.5;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--border-color);
      padding-bottom: 1.5rem;
      margin-bottom: 2rem;
    }
    h1 { font-size: 1.75rem; font-weight: 700; }
    .subtitle { color: var(--text-muted); font-size: 0.875rem; margin-top: 0.25rem; }
    .meta-tags { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.5rem; }
    .meta-tag {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      padding: 0.2rem 0.6rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-weight: 700;
      font-size: 0.75rem;
      text-transform: uppercase;
    }
    .badge-pass { background-color: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid #10b981; }
    .badge-fail { background-color: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid #ef4444; }
    .badge-critical { background-color: var(--color-critical); color: #fff; }
    .badge-high { background-color: var(--color-high); color: #fff; }
    .badge-medium { background-color: var(--color-medium); color: #000; }
    .badge-low { background-color: var(--color-low); color: #fff; }
    .badge-info { background-color: var(--color-info); color: #fff; }
    .badge-watch { background-color: #f59e0b; color: #000; }
    .badge-safe { background-color: #10b981; color: #fff; }
    .badge-urgent { background-color: #b91c1c; color: #fff; }

    .grid-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .metric-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1.25rem;
    }
    .metric-title { font-size: 0.8rem; color: var(--text-muted); text-transform: uppercase; font-weight: 600; }
    .metric-value { font-size: 2rem; font-weight: 700; margin-top: 0.25rem; }

    .section {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
    }
    .section-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; }

    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 0.875rem; }
    th { background-color: var(--bg-card-header); padding: 0.75rem 1rem; font-weight: 600; color: var(--text-main); }
    td { padding: 0.75rem 1rem; border-top: 1px solid var(--border-color); vertical-align: top; }
    tr:hover { background-color: rgba(255, 255, 255, 0.02); }

    .rec-card {
      background: rgba(15, 23, 42, 0.6);
      border-left: 4px solid #3b82f6;
      border-radius: 4px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .rec-card.rec-critical { border-left-color: var(--color-critical); }
    .rec-card.rec-high { border-left-color: var(--color-high); }
    .rec-card.rec-medium { border-left-color: var(--color-medium); }
    .rec-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
    .rec-target { font-weight: 600; font-size: 1rem; }
    .rec-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem; margin-top: 0.75rem; font-size: 0.8rem; color: var(--text-muted); }
    .rec-details strong { color: var(--text-main); }

    ul.assumptions-list { list-style-position: inside; color: var(--text-muted); font-size: 0.875rem; }
    ul.assumptions-list li { margin-bottom: 0.25rem; }

    @media print {
      body { background: #ffffff !important; color: #0f172a !important; padding: 0.5cm !important; }
      .container { max-width: 100% !important; }
      header { border-bottom: 2px solid #0f172a !important; }
      .section, .metric-card { background: #ffffff !important; border: 1px solid #cbd5e1 !important; color: #0f172a !important; page-break-inside: avoid; }
      .rec-card { background: #f8fafc !important; border: 1px solid #cbd5e1 !important; border-left-width: 4px !important; page-break-inside: avoid; }
      th { background-color: #f1f5f9 !important; color: #0f172a !important; }
      td { border-top: 1px solid #cbd5e1 !important; color: #0f172a !important; }
      .meta-tag { background: #f1f5f9 !important; border-color: #cbd5e1 !important; color: #334155 !important; }
      .badge-pass { background-color: #d1fae5 !important; color: #065f46 !important; border: 1px solid #059669 !important; }
      .badge-fail { background-color: #fee2e2 !important; color: #991b1b !important; border: 1px solid #dc2626 !important; }
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
          <span class="meta-tag">Profile: <strong>${escapeHtml(meta.policy_profile)}</strong></span>
          <span class="meta-tag">Timeline: <strong>${escapeHtml(meta.scenario)}</strong></span>
          <span class="meta-tag">Rules: <strong>v${escapeHtml(meta.rule_version)}</strong></span>
          <span class="meta-tag">Generated: <strong>${escapeHtml(meta.generated_at)}</strong></span>
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
        <div class="metric-value">${metrics.total_assets}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title">Total Findings</div>
        <div class="metric-value">${metrics.total_findings}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title" style="color: var(--color-critical);">Critical Findings</div>
        <div class="metric-value" style="color: var(--color-critical);">${metrics.severity_counts.critical}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title" style="color: var(--color-high);">High Findings</div>
        <div class="metric-value" style="color: var(--color-high);">${metrics.severity_counts.high}</div>
      </div>
      <div class="metric-card">
        <div class="metric-title" style="color: #f59e0b;">At Quantum Risk</div>
        <div class="metric-value" style="color: #f59e0b;">${metrics.assets_at_quantum_risk}</div>
      </div>
    </div>

    <!-- Top Risky Assets -->
    <div class="section">
      <div class="section-title">Top Risky Assets</div>
      <table>
        <thead>
          <tr>
            <th>Asset / BOM Reference</th>
            <th>Algorithm</th>
            <th>Asset Type</th>
            <th>Severity</th>
            <th>Mosca Status</th>
            <th>Risk Summary</th>
          </tr>
        </thead>
        <tbody>
          ${
            topAssets.length === 0
              ? '<tr><td colspan="6">No risky assets identified.</td></tr>'
              : topAssets
                  .map(
                    (a) => `
            <tr>
              <td><code>${escapeHtml(sanitizeReportText(a.asset_id))}</code></td>
              <td><strong>${escapeHtml(a.algorithm)}</strong> ${a.key_size ? `<small>(${a.key_size}b)</small>` : ""}</td>
              <td>${escapeHtml(a.asset_type)}</td>
              <td><span class="badge badge-${escapeHtml(a.severity.toLowerCase())}">${escapeHtml(a.severity)}</span></td>
              <td><span class="badge badge-${escapeHtml(a.mosca_status.toLowerCase())}">${escapeHtml(a.mosca_status)}</span></td>
              <td><small>${escapeHtml(sanitizeReportText(a.explanation))}</small></td>
            </tr>
          `,
                  )
                  .join("")
          }
        </tbody>
      </table>
    </div>

    <!-- Mosca Analysis Table (X + Y > Z) -->
    <div class="section">
      <div class="section-title">Mosca Theorem Quantum Exposure Table (X + Y &gt; Z)</div>
      <div class="subtitle" style="margin-bottom: 1rem;">
        Formula: <strong>Margin = (X Shelf-Life + Y Migration) - Z Threat Horizon</strong>. Positive margins indicate compromise before migration completes.
      </div>
      <table>
        <thead>
          <tr>
            <th>Asset</th>
            <th>Algorithm</th>
            <th>Sensitivity</th>
            <th>X (Shelf-Life)</th>
            <th>Y (Migration)</th>
            <th>Z (CRQC Threat)</th>
            <th>Total (X+Y)</th>
            <th>Margin</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${
            moscaTable.length === 0
              ? '<tr><td colspan="9">No cryptographic assets required Mosca calculation.</td></tr>'
              : moscaTable
                  .map(
                    (m) => `
            <tr>
              <td><code>${escapeHtml(sanitizeReportText(m.asset_id))}</code></td>
              <td>${escapeHtml(m.algorithm)}</td>
              <td>${escapeHtml(m.data_sensitivity)}</td>
              <td>${m.X_shelf_life_years} yrs</td>
              <td>${m.Y_migration_years} yrs</td>
              <td>${m.Z_threat_years} yrs</td>
              <td><strong>${m.mosca_total_years} yrs</strong></td>
              <td style="font-weight: 700; color: ${m.mosca_margin_years > 0 ? "var(--color-critical)" : "var(--color-pass)"}">
                ${m.mosca_margin_years > 0 ? "+" : ""}${m.mosca_margin_years} yrs
              </td>
              <td><span class="badge badge-${escapeHtml(m.status.toLowerCase())}">${escapeHtml(m.status)}</span></td>
            </tr>
          `,
                  )
                  .join("")
          }
        </tbody>
      </table>
    </div>

    <!-- Context-Aware Recommendations -->
    <div class="section">
      <div class="section-title">Post-Quantum &amp; Classical Migration Recommendations</div>
      ${
        recommendations.length === 0
          ? "<p>No migration actions required.</p>"
          : recommendations
              .map(
                (r) => `
        <div class="rec-card rec-${escapeHtml(r.priority.toLowerCase())}">
          <div class="rec-header">
            <span class="rec-target">${escapeHtml(r.recommended_target)}</span>
            <span class="badge badge-${escapeHtml(r.priority.toLowerCase())}">${escapeHtml(r.priority)} Priority</span>
          </div>
          <div style="font-size: 0.875rem; margin-bottom: 0.5rem;">
            <strong>Context:</strong> ${escapeHtml(r.current_state)}
          </div>
          <div style="font-size: 0.875rem; margin-bottom: 0.5rem; color: #cbd5e1;">
            <strong>Classical Remediation:</strong> ${escapeHtml(r.classical_remediation)}
          </div>
          <div style="font-size: 0.875rem; margin-bottom: 0.5rem; color: #93c5fd;">
            <strong>PQC Migration:</strong> ${escapeHtml(r.pqc_migration)}
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
      <ol style="padding-left: 1.5rem; font-size: 0.875rem; line-height: 1.8; color: var(--text-main);">
        <li style="margin-bottom: 0.5rem;">
          <strong>1. Remove classically broken crypto:</strong> Deprecate and eradicate MD5, SHA-1, DES, 3DES, RC4, sub-2048 RSA, and exposed secrets.
        </li>
        <li style="margin-bottom: 0.5rem;">
          <strong>2. Upgrade legacy transport:</strong> Decommission TLS 1.0/1.1; mandate TLS 1.2+ / TLS 1.3 with AEAD suites and modern SSH key exchange.
        </li>
        <li style="margin-bottom: 0.5rem;">
          <strong>3. Identify long-lived confidentiality assets:</strong> Prioritize stored database ciphertext, backups, and archives with shelf-life X &ge; 7 years vulnerable to SNDL.
        </li>
        <li style="margin-bottom: 0.5rem;">
          <strong>4. Pilot hybrid PQC:</strong> Deploy composite/hybrid key encapsulation (e.g. X25519MLKEM768) on perimeter traffic and hybrid DEK envelopes.
        </li>
        <li style="margin-bottom: 0.5rem;">
          <strong>5. Measure and deploy:</strong> Profile latency and MTU overhead; benchmark client compatibility; deploy full NIST FIPS 203/204 post-quantum standards.
        </li>
      </ol>
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
