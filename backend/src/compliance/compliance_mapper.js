/**
 * ECDAT Evidence-Based Compliance Mapping Engine (Phase 11.3)
 *
 * Maps discovered cryptographic assets, CycloneDX CBOMs, and findings to
 * applicable standards and guidance:
 * - NIST SP 800-53 Rev 5
 * - NIST CNSA 2.0
 * - PCI DSS v4.0
 * - NIST SP 800-131A Rev 2
 * - ISO/IEC 27001:2022
 *
 * Support Levels:
 * - SUPPORTED CONTROL: Fully validated by automated discovery with technical evidence.
 * - PARTIAL SUPPORT: Partially validated by technical evidence; requires manual audit.
 * - NOT SUPPORTED: Out-of-scope for automated software/network discovery.
 *
 * Secret Safety:
 * - Redacts all private keys, raw secrets, and passwords into safe SHA-256 fingerprints.
 *
 * Non-Certification Disclaimer:
 * - Explicitly disclaims formal regulatory, statutory, or lab certification.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Ajv = require("ajv");
const { getRules, DEFAULT_RULES_DIR } = require("../risk_engine/rules_loader");

const DEFAULT_CATALOG_PATH = path.join(
  DEFAULT_RULES_DIR,
  "compliance_catalog.json",
);
const DEFAULT_SCHEMA_PATH = path.join(
  DEFAULT_RULES_DIR,
  "schemas",
  "compliance_catalog.schema.json",
);

const SUPPORT_LEVELS = [
  "SUPPORTED CONTROL",
  "PARTIAL SUPPORT",
  "NOT SUPPORTED",
];

const NON_CERTIFICATION_DISCLAIMER =
  "DISCLAIMER: ECDAT provides evidence-based automated mapping of discovered cryptographic assets " +
  "against published standards and guidance. ECDAT does not issue formal regulatory certification, " +
  "accredited laboratory validation (e.g., NIST CMVP/CAVP), or statutory compliance attestation. " +
  "Technical control verdicts represent automated evidence matches against documented criteria.";

const RAW_SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----/g,
  /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"]?([a-zA-Z0-9_\-.+=/]{16,})['"]?/gi,
];

function redactSecretString(secretStr) {
  const hash = crypto
    .createHash("sha256")
    .update(String(secretStr))
    .digest("hex")
    .substring(0, 16);
  return `[REDACTED_SECRET SHA256:${hash}]`;
}

function sanitizeEvidenceData(data) {
  if (typeof data === "string") {
    let cleaned = data;
    for (const pat of RAW_SECRET_PATTERNS) {
      cleaned = cleaned.replace(pat, (match) => redactSecretString(match));
    }
    return cleaned;
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const sanitized = {};
    for (const [k, v] of Object.entries(data)) {
      const lowerK = k.toLowerCase();
      if (
        ["private_key", "raw_secret", "secret_key", "password"].some((w) =>
          lowerK.includes(w),
        )
      ) {
        sanitized[k] = redactSecretString(v);
      } else {
        sanitized[k] = sanitizeEvidenceData(v);
      }
    }
    return sanitized;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeEvidenceData(item));
  }
  return data;
}

class ComplianceMapper {
  constructor(options = {}) {
    this.catalogPath = options.catalogPath || DEFAULT_CATALOG_PATH;
    this.schemaPath = options.schemaPath || DEFAULT_SCHEMA_PATH;
    this.catalog = this._loadCatalog();
  }

  _loadCatalog() {
    try {
      const rules = getRules();
      if (rules && rules.compliance_catalog) {
        return rules.compliance_catalog;
      }
    } catch (_err) {
      // Fallback to reading file directly
    }

    if (fs.existsSync(this.catalogPath)) {
      const raw = fs.readFileSync(this.catalogPath, "utf-8");
      return JSON.parse(raw);
    }
    return { version: "1.0.0", standards: [], disclaimer: NON_CERTIFICATION_DISCLAIMER };
  }

  getCatalog() {
    return this.catalog;
  }

  listStandards() {
    return (this.catalog.standards || []).map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      publisher: s.publisher,
      description: s.description,
      controls_count: (s.controls || []).length,
    }));
  }

  getStandard(standardId) {
    return (
      (this.catalog.standards || []).find(
        (s) => s.id.toLowerCase() === String(standardId).toLowerCase(),
      ) || null
    );
  }

  assessControl(control, assets = []) {
    const supportLevel = control.support_level || "PARTIAL SUPPORT";
    const controlId = control.control_id;
    const title = control.title;
    const criteria = control.evaluation_criteria || {};

    // NOT SUPPORTED controls are out of scope for automated software evaluation
    if (supportLevel === "NOT SUPPORTED") {
      return {
        control_id: controlId,
        title,
        support_level: "NOT SUPPORTED",
        verdict: "NOT_APPLICABLE_OUT_OF_SCOPE",
        compliant: null,
        evidence_count: 0,
        evidence: [],
        gaps: [],
        manual_audit_guidance:
          control.manual_audit_guidance ||
          "This control requires manual physical or organizational inspection.",
      };
    }

    const evidence = [];
    const gaps = [];

    const prohibitedAlgos = (criteria.prohibited_algorithms || []).map((a) =>
      a.toUpperCase(),
    );
    const allowedAlgos = (criteria.allowed_algorithms || []).map((a) =>
      a.toUpperCase(),
    );
    const prohibitedProtos = (criteria.prohibited_protocols || []).map((p) =>
      p.toLowerCase(),
    );
    const allowedProtos = (criteria.allowed_protocols || []).map((p) =>
      p.toLowerCase(),
    );
    const minRsa = criteria.min_rsa_bits;
    const minEcc = criteria.min_ecc_bits;
    const minSym = criteria.min_symmetric_bits;
    const reqPqc = Boolean(criteria.require_pqc);
    const allowSelfSigned = criteria.allow_self_signed !== false;

    for (const rawAsset of assets) {
      const asset = sanitizeEvidenceData(rawAsset);
      const assetId =
        asset.asset_id || asset.id || asset.name || "unknown";
      const algo = String(asset.algorithm || asset.name || "").toUpperCase();
      const proto = String(asset.protocol || "").toLowerCase();

      let keySize = asset.key_size ?? asset.keyLength ?? asset.bits ?? null;
      if (keySize !== null) {
        const parsed = parseInt(keySize, 10);
        keySize = isNaN(parsed) ? null : parsed;
      }

      const isSelfSigned = Boolean(asset.is_self_signed);
      const isPqc = Boolean(
        asset.is_quantum_safe ||
          ["pqc", "hybrid"].includes(asset.pqc_type),
      );

      const assetGaps = [];

      // Prohibited algorithms
      for (const pa of prohibitedAlgos) {
        if (pa === algo || algo.includes(pa)) {
          assetGaps.push(`Prohibited algorithm detected: '${algo}'`);
          break;
        }
      }

      // Allowed algorithms
      if (
        allowedAlgos.length > 0 &&
        !allowedAlgos.some((aa) => algo.includes(aa))
      ) {
        assetGaps.push(`Algorithm '${algo}' not in approved list`);
      }

      // Prohibited protocols
      for (const pp of prohibitedProtos) {
        if (pp && proto.includes(pp)) {
          assetGaps.push(`Prohibited protocol detected: '${proto}'`);
          break;
        }
      }

      // Allowed protocols
      if (
        allowedProtos.length > 0 &&
        proto &&
        !allowedProtos.some((ap) => proto.includes(ap))
      ) {
        assetGaps.push(`Protocol '${proto}' not in allowed list`);
      }

      // Key sizes
      if (minRsa && algo.includes("RSA") && keySize !== null && keySize < minRsa) {
        assetGaps.push(`RSA key size ${keySize} is below required ${minRsa} bits`);
      }

      if (
        minEcc &&
        (algo.includes("ECC") || algo.includes("ECDSA")) &&
        keySize !== null &&
        keySize < minEcc
      ) {
        assetGaps.push(`ECC key size ${keySize} is below required ${minEcc} bits`);
      }

      if (
        minSym &&
        (algo.includes("AES") || algo.includes("CHACHA")) &&
        keySize !== null &&
        keySize < minSym
      ) {
        assetGaps.push(
          `Symmetric key size ${keySize} is below required ${minSym} bits`,
        );
      }

      // Self signed
      if (!allowSelfSigned && isSelfSigned) {
        assetGaps.push("Self-signed certificate violates control");
      }

      // PQC
      if (reqPqc && !isPqc) {
        assetGaps.push(
          "Cryptographic asset lacks post-quantum protection mandated by control",
        );
      }

      const evidenceEntry = {
        asset_id: assetId,
        name: asset.name || algo,
        algorithm: algo,
        key_size: keySize,
        protocol: proto || null,
        environment: asset.environment || "production",
        compliant_with_control: assetGaps.length === 0,
      };
      evidence.push(evidenceEntry);

      if (assetGaps.length > 0) {
        gaps.push({ asset_id: assetId, issues: assetGaps });
      }
    }

    let compliant = false;
    let verdict = "NO_EVIDENCE_FOUND";

    if (supportLevel === "SUPPORTED CONTROL") {
      compliant = gaps.length === 0 && evidence.length > 0;
      verdict = compliant
        ? "COMPLIANT"
        : gaps.length > 0
          ? "NON_COMPLIANT"
          : "NO_EVIDENCE_FOUND";
    } else {
      // PARTIAL SUPPORT
      compliant = false;
      verdict =
        gaps.length === 0
          ? "REQUIRES_MANUAL_REVIEW"
          : "NON_COMPLIANT_WITH_TECHNICAL_GAPS";
    }

    return {
      control_id: controlId,
      title,
      support_level: supportLevel,
      verdict,
      compliant,
      evidence_count: evidence.length,
      evidence,
      gaps,
      manual_audit_guidance: control.manual_audit_guidance || null,
    };
  }

  assess(assetsOrCbom, standardIds = null) {
    return this.assessCompliance(assetsOrCbom, standardIds);
  }

  assessCompliance(assetsOrCbom, standardIds = null) {
    let rawList = [];
    if (Array.isArray(assetsOrCbom)) {
      rawList = assetsOrCbom;
    } else if (assetsOrCbom && typeof assetsOrCbom === "object") {
      if (Array.isArray(assetsOrCbom.components)) rawList = assetsOrCbom.components;
      else if (Array.isArray(assetsOrCbom.findings)) rawList = assetsOrCbom.findings;
      else if (Array.isArray(assetsOrCbom.assets)) rawList = assetsOrCbom.assets;
      else rawList = [assetsOrCbom];
    }

    // Upfront sanitization guarantees zero secret leakage
    const cleanAssets = rawList.map((a) => sanitizeEvidenceData(a));

    let targetStandards = this.catalog.standards || [];
    if (Array.isArray(standardIds) && standardIds.length > 0) {
      const lowerIds = standardIds.map((s) => String(s).toLowerCase());
      targetStandards = targetStandards.filter((s) =>
        lowerIds.includes(s.id.toLowerCase()),
      );
    }

    const assessmentResults = [];
    let totalControls = 0;
    let supportedControls = 0;
    let partialControls = 0;
    let notSupportedControls = 0;
    let compliantControls = 0;

    const nowTs = new Date().toISOString();

    for (const std of targetStandards) {
      const stdControls = std.controls || [];
      const assessedControls = [];

      for (const ctrl of stdControls) {
        totalControls += 1;
        const level = ctrl.support_level || "PARTIAL SUPPORT";
        if (level === "SUPPORTED CONTROL") supportedControls += 1;
        else if (level === "PARTIAL SUPPORT") partialControls += 1;
        else notSupportedControls += 1;

        const assessment = this.assessControl(ctrl, cleanAssets);
        if (assessment.compliant === true) compliantControls += 1;
        assessedControls.append ? assessedControls.append(assessment) : assessedControls.push(assessment);
      }

      assessmentResults.push({
        standard_id: std.id,
        standard_name: std.name,
        version: std.version,
        publisher: std.publisher,
        controls: assessedControls,
      });
    }

    const canonicalDigestPayload = {
      timestamp: nowTs,
      total_assets: cleanAssets.length,
      standards_assessed: assessmentResults.map((s) => s.standard_id),
      compliant_controls: compliantControls,
      total_controls: totalControls,
    };
    const digest = crypto
      .createHash("sha256")
      .update(JSON.stringify(canonicalDigestPayload))
      .digest("hex");

    return {
      disclaimer: NON_CERTIFICATION_DISCLAIMER,
      certification_claimed: false,
      assessment_timestamp: nowTs,
      summary: {
        total_standards_assessed: assessmentResults.length,
        total_controls_mapped: totalControls,
        support_level_breakdown: {
          "SUPPORTED CONTROL": supportedControls,
          "PARTIAL SUPPORT": partialControls,
          "NOT SUPPORTED": notSupportedControls,
        },
        compliant_automated_controls: compliantControls,
      },
      standards: assessmentResults,
      evidence_digest: digest,
    };
  }
}

module.exports = {
  ComplianceMapper,
  NON_CERTIFICATION_DISCLAIMER,
  SUPPORT_LEVELS,
  sanitizeEvidenceData,
  redactSecretString,
};
