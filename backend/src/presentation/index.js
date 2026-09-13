/**
 * Presentation Subsystem Boundary
 * Responsible for rendering human-readable HTML reports, dashboard metrics,
 * and executive summary schemas.
 */

const { generateHtmlReport } = require("../risk_engine/html_reporter");
const { generateSummary } = require("../risk_engine/summary_generator");

/**
 * Renders an executive static HTML cryptographic risk report.
 * @param {object} scanRecordOrSummary
 * @returns {string} HTML string
 */
function renderHtmlReport(scanRecordOrSummary) {
  const summary =
    scanRecordOrSummary && scanRecordOrSummary.metrics
      ? scanRecordOrSummary
      : generateSummary(scanRecordOrSummary);
  return generateHtmlReport(summary);
}

/**
 * Generates frontend-ready executive summary metrics.
 * @param {object} scanRecord
 * @returns {object} Summary schema
 */
function renderExecutiveSummary(scanRecord) {
  const summary = generateSummary(scanRecord);
  if (scanRecord && (scanRecord.id || scanRecord.scan_id)) {
    summary.scan_id = scanRecord.id || scanRecord.scan_id;
  }
  return summary;
}

module.exports = {
  renderHtmlReport,
  renderExecutiveSummary,
  generateHtmlReport,
  generateSummary,
};
