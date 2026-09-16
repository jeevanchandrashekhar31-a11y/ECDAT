/**
 * Compliance Mapping REST API Router (Phase 11.3)
 */

const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const {
  getDefaultComplianceMapper,
  NON_CERTIFICATION_DISCLAIMER,
  SUPPORT_LEVELS,
  sanitizeEvidenceData,
} = require("../compliance");

/**
 * GET /api/v1/compliance/standards
 * Returns available compliance standards and metadata.
 */
router.get("/standards", (req, res) => {
  try {
    const mapper = getDefaultComplianceMapper();
    const catalog = mapper.getCatalog();

    const standardsSummary = (catalog.standards || []).map((s) => {
      const breakdown = {
        "SUPPORTED CONTROL": 0,
        "PARTIAL SUPPORT": 0,
        "NOT SUPPORTED": 0,
      };
      for (const c of s.controls || []) {
        if (breakdown[c.support_level] !== undefined) {
          breakdown[c.support_level]++;
        }
      }

      return {
        id: s.id,
        name: s.name,
        publisher: s.publisher,
        version: s.version,
        publication_year: s.publication_year,
        total_controls: (s.controls || []).length,
        support_level_breakdown: breakdown,
      };
    });

    return res.status(200).json({
      disclaimer: NON_CERTIFICATION_DISCLAIMER,
      certification_claimed: false,
      total_standards: standardsSummary.length,
      supported_levels: SUPPORT_LEVELS,
      standards: standardsSummary,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Compliance Standards Retrieval Failed",
      message: err.message,
    });
  }
});

/**
 * GET /api/v1/compliance/standards/:standardId
 * Returns full control specification for a specific standard.
 */
router.get("/standards/:standardId", (req, res) => {
  try {
    const mapper = getDefaultComplianceMapper();
    const catalog = mapper.getCatalog();
    const targetId = req.params.standardId.toLowerCase();

    const standard = (catalog.standards || []).find(
      (s) => s.id.toLowerCase() === targetId,
    );
    if (!standard) {
      return res.status(404).json({
        error: "Standard Not Found",
        message: `Standard '${req.params.standardId}' does not exist in compliance catalog`,
      });
    }

    return res.status(200).json({
      disclaimer: NON_CERTIFICATION_DISCLAIMER,
      certification_claimed: false,
      standard,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Compliance Standard Retrieval Failed",
      message: err.message,
    });
  }
});

/**
 * POST /api/v1/compliance/assess
 * Evaluates assets, findings, or CBOM against compliance standards.
 */
router.post("/assess", (req, res) => {
  try {
    const mapper = getDefaultComplianceMapper();
    const assetsOrCbom =
      req.body.assets ||
      req.body.components ||
      req.body.findings ||
      req.body.cbom ||
      req.body;
    const standardIds = req.body.standard_ids || req.body.standards || null;

    const assessment = mapper.assess(assetsOrCbom, standardIds);

    return res.status(200).json({
      success: true,
      ...assessment,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Compliance Assessment Failed",
      message: err.message,
    });
  }
});

/**
 * POST /api/v1/compliance/evidence-bundle
 * Generates an immutable, secret-redacted compliance audit evidence bundle.
 */
router.post("/evidence-bundle", (req, res) => {
  try {
    const mapper = getDefaultComplianceMapper();
    const assetsOrCbom =
      req.body.assets ||
      req.body.components ||
      req.body.findings ||
      req.body.cbom ||
      req.body;
    const standardIds = req.body.standard_ids || req.body.standards || null;
    const organization = req.body.organization || "Enterprise Organization";
    const environment = req.body.environment || "production";

    const assessment = mapper.assess(assetsOrCbom, standardIds);

    // Sanitize any auxiliary metadata inputs
    const sanitizedMetadata = sanitizeEvidenceData({
      organization,
      environment,
      assessed_at: new Date().toISOString(),
      auditor_notes: req.body.auditor_notes || "Automated ECDAT discovery audit evidence",
    });

    const bundlePayload = {
      bundle_version: "1.0",
      disclaimer: NON_CERTIFICATION_DISCLAIMER,
      certification_claimed: false,
      metadata: sanitizedMetadata,
      assessment_summary: assessment.summary,
      standards_evaluated: assessment.standards,
      raw_evidence_digest: assessment.evidence_digest,
    };

    const bundleHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(bundlePayload))
      .digest("hex");

    return res.status(200).json({
      success: true,
      bundle_seal: `ECDAT-EVIDENCE-${bundleHash.substring(0, 16).toUpperCase()}`,
      bundle_sha256: bundleHash,
      bundle: bundlePayload,
    });
  } catch (err) {
    return res.status(500).json({
      error: "Evidence Bundle Generation Failed",
      message: err.message,
    });
  }
});

module.exports = router;
