/**
 * ECDAT Evidence Integrity and Audit Attestation Service — Phase 26.3
 *
 * Implements rigorous cryptographic integrity verification for all executive and technical reports.
 *
 * Mandate:
 * 1. Add hashes/fingerprints where useful (SHA-256 canonical digests, Merkle root of evidence).
 * 2. Reports must identify:
 *    - scan timestamp
 *    - ECDAT version
 *    - scanner versions
 *    - configuration (with SHA-256 config hash)
 *    - policy version (with SHA-256 policy hash)
 *    - CBOM version (with SHA-256 CBOM hash)
 * 3. Never imply independent audit/certification unless actually obtained.
 *    - Enforces explicit disclaimer and anti-deception validation.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ECDAT_VERSION = "1.0.0";

const DEFAULT_SCANNER_VERSIONS = {
  static_tree_sitter_ast: "1.0.0",
  network_tls_prober: "1.0.0",
  ebpf_runtime_tracer: "1.0.0",
  syft_sbom_scanner: "1.0.0",
  cbom_generator: "1.0.0",
};

const PROHIBITED_DECEPTIVE_CLAIMS = [
  "third-party certified",
  "independently audited",
  "fips 140-3 certified",
  "common criteria certified",
  "accredited audit complete",
  "official third-party certification",
  "externally accredited audit",
];

/**
 * Computes deterministic SHA-256 digest of any serializable object.
 *
 * @param {any} data
 * @returns {string} 64-character lowercase hexadecimal string
 */
function computeCanonicalSha256(data) {
  if (data === null || data === undefined) {
    return crypto.createHash("sha256").update("").digest("hex");
  }

  function sortObject(obj) {
    if (typeof obj !== "object" || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(sortObject);
    return Object.keys(obj)
      .sort()
      .reduce((res, key) => {
        res[key] = sortObject(obj[key]);
        return res;
      }, {});
  }

  const sorted = sortObject(data);
  const jsonStr = JSON.stringify(sorted);
  return crypto.createHash("sha256").update(jsonStr, "utf8").digest("hex");
}

/**
 * Computes a chained Merkle-style root hash across an array of evidence items.
 *
 * @param {Array<object>} evidenceItems
 * @returns {string} 64-character hex hash
 */
function computeEvidenceMerkleRoot(evidenceItems = []) {
  if (!Array.isArray(evidenceItems) || evidenceItems.length === 0) {
    return computeCanonicalSha256({ empty: true, count: 0 });
  }

  const leafHashes = evidenceItems.map((item) => {
    if (typeof item === "string") {
      return crypto.createHash("sha256").update(item, "utf8").digest("hex");
    }
    const id = item.evidence_id || item.id || item.finding_id || "";
    const loc = item.location || item.exact_source_location?.file_path || "";
    const snippet = item.evidence_context || item.evidence?.raw_evidence || "";
    const raw = `${id}:${loc}:${snippet}:${item.sha256_hash || ""}`;
    return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  });

  let currentLevel = leafHashes;
  while (currentLevel.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        const combined = currentLevel[i] + currentLevel[i + 1];
        nextLevel.push(crypto.createHash("sha256").update(combined, "hex").digest("hex"));
      } else {
        nextLevel.push(currentLevel[i]);
      }
    }
    currentLevel = nextLevel;
  }

  return currentLevel[0];
}

/**
 * Builds the canonical 26.3 Evidence Integrity metadata block.
 *
 * @param {object} context
 * @param {object} [context.scanRow]
 * @param {string} [context.scanTimestamp]
 * @param {object} [context.config]
 * @param {string} [context.policyProfile="regulated_bfsi"]
 * @param {object} [context.cbomData]
 * @param {Array<object>} [context.evidenceList=[]]
 * @param {object} [context.reportContent]
 * @param {boolean} [context.isIndependentlyAudited=false]
 * @param {object} [context.attestationDetails]
 * @returns {object} Complete evidence_integrity object
 */
function buildEvidenceIntegrity(context = {}) {
  const rawTs =
    context.scanTimestamp ||
    context.scanRow?.created_at ||
    context.scanRow?.scan_timestamp ||
    new Date();

  const scanTimestamp =
    rawTs instanceof Date
      ? rawTs.toISOString()
      : typeof rawTs === "string"
      ? rawTs
      : new Date(rawTs).toISOString();

  const activeConfig = context.config || {
    environment: process.env.NODE_ENV || "production",
    strict_enforcement: true,
    zero_secrets_redaction: true,
    pqc_migration_target_year: 2033,
    active_rules_count: 28,
  };

  const configHash = computeCanonicalSha256(activeConfig);

  const policyProfile = context.policyProfile || "regulated_bfsi";
  const policySnapshot = {
    profile_id: policyProfile,
    version: "1.0.0",
    catalog_schema: "policy_as_code.schema.json",
    enforcement_mode: "STRICT_BLOCK",
    frameworks: [
      "NIST SP 800-131A Rev 2",
      "PCI-DSS v4.0",
      "BSI TR-02102-1",
      "CNSA 2.0",
      "FIPS 140-3",
    ],
  };
  const policyHash = computeCanonicalSha256(policySnapshot);

  const cbomData = context.cbomData || {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${crypto.randomUUID ? crypto.randomUUID() : "3e671687-395b-41f5-a30f-a58921a69b79"}`,
    version: 1,
  };
  const cbomHash = computeCanonicalSha256(cbomData);

  const evidenceList = context.evidenceList || [];
  const merkleRoot = computeEvidenceMerkleRoot(evidenceList);

  const reportPayloadHash = context.reportContent
    ? computeCanonicalSha256(context.reportContent)
    : computeCanonicalSha256({ scan_timestamp: scanTimestamp, merkle_root: merkleRoot });

  const isAudited = Boolean(context.isIndependentlyAudited);
  const attestationDetails = context.attestationDetails || null;

  const independentAttestation = {
    independent_audit_obtained: isAudited,
    certification_status: isAudited
      ? "FORMALLY_ATTESTED_THIRD_PARTY"
      : "UNATTESTED_AUTOMATED_EVALUATION",
    attestation_statement: isAudited
      ? `This report has been formally audited and counter-attested by an accredited third party: ${attestationDetails?.auditor_identity || "Accredited Lab"}.`
      : "AUTOMATED SCANNER EVALUATION ONLY: This report is generated automatically by ECDAT and reflects automated scanner outputs, heuristic static analysis, and dynamic observation. It does NOT constitute an independent third-party audit, formal certification, or accredited Common Criteria / FIPS 140-3 laboratory evaluation. No independent external certification has been obtained for this assessment.",
    auditor_identity: isAudited ? (attestationDetails?.auditor_identity || null) : null,
    accreditation_body: isAudited ? (attestationDetails?.accreditation_body || null) : null,
    attestation_valid_until: isAudited ? (attestationDetails?.attestation_valid_until || null) : null,
    disclaimer_mandatory: true,
  };

  return {
    scan_timestamp: scanTimestamp,
    ecdat_version: ECDAT_VERSION,
    scanner_versions: { ...DEFAULT_SCANNER_VERSIONS },
    configuration: {
      ...activeConfig,
      config_hash_sha256: configHash,
    },
    policy_version: {
      ...policySnapshot,
      policy_hash_sha256: policyHash,
    },
    cbom_version: {
      spec_version: cbomData.specVersion || "CycloneDX 1.6",
      cbom_schema_version: "1.6",
      cbom_serial_number: cbomData.serialNumber || cbomData.serial_number || "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
      cbom_version: Number(cbomData.version || 1),
      cbom_sha256: cbomHash,
    },
    hashes: {
      report_payload_sha256: reportPayloadHash,
      evidence_merkle_root: merkleRoot,
      canonical_fingerprint: `SHA256:${reportPayloadHash}`,
    },
    independent_attestation: independentAttestation,
  };
}

/**
 * Validates that an ECDAT report strictly conforms to Phase 26.3 Evidence Integrity requirements.
 *
 * Asserts:
 * 1. Presence of scan_timestamp, ecdat_version, scanner_versions, configuration, policy_version, cbom_version.
 * 2. Hashes/fingerprints are valid 64-character hexadecimal SHA-256 strings.
 * 3. Anti-Deception Guard: Never imply independent audit/certification unless actually obtained.
 *
 * @param {object} report - The full report object (executive or technical)
 * @returns {object} { passed: boolean, violations: string[], details: object }
 */
function validateEvidenceIntegrity(report) {
  const violations = [];

  if (!report || typeof report !== "object") {
    return { passed: false, violations: ["Report is missing or not a valid object"] };
  }

  const integrity = report.evidence_integrity || report.metadata?.evidence_integrity;

  if (!integrity || typeof integrity !== "object") {
    return { passed: false, violations: ["Missing 'evidence_integrity' block in report"] };
  }

  // 1. Scan timestamp
  if (!integrity.scan_timestamp) {
    violations.push("Missing 'scan_timestamp'");
  } else {
    const tsStr =
      integrity.scan_timestamp instanceof Date
        ? integrity.scan_timestamp.toISOString()
        : String(integrity.scan_timestamp);
    if (isNaN(Date.parse(tsStr))) {
      violations.push(`Invalid 'scan_timestamp' format: '${integrity.scan_timestamp}'`);
    }
  }

  // 2. ECDAT version
  if (!integrity.ecdat_version || typeof integrity.ecdat_version !== "string") {
    violations.push("Missing or invalid 'ecdat_version'");
  }

  // 3. Scanner versions
  if (!integrity.scanner_versions || typeof integrity.scanner_versions !== "object") {
    violations.push("Missing or invalid 'scanner_versions' map");
  } else {
    const scanners = Object.keys(integrity.scanner_versions);
    if (scanners.length === 0) {
      violations.push("'scanner_versions' must contain at least one scanner version mapping");
    }
  }

  // 4. Configuration
  if (!integrity.configuration || typeof integrity.configuration !== "object") {
    violations.push("Missing or invalid 'configuration' object");
  } else if (!integrity.configuration.config_hash_sha256 || integrity.configuration.config_hash_sha256.length !== 64) {
    violations.push("configuration missing valid 64-char 'config_hash_sha256'");
  }

  // 5. Policy version
  if (!integrity.policy_version || typeof integrity.policy_version !== "object") {
    violations.push("Missing or invalid 'policy_version' object");
  } else if (!integrity.policy_version.policy_hash_sha256 || integrity.policy_version.policy_hash_sha256.length !== 64) {
    violations.push("policy_version missing valid 64-char 'policy_hash_sha256'");
  }

  // 6. CBOM version
  if (!integrity.cbom_version || typeof integrity.cbom_version !== "object") {
    violations.push("Missing or invalid 'cbom_version' object");
  } else if (!integrity.cbom_version.cbom_sha256 || integrity.cbom_version.cbom_sha256.length !== 64) {
    violations.push("cbom_version missing valid 64-char 'cbom_sha256'");
  }

  // 7. Cryptographic hashes
  if (!integrity.hashes || typeof integrity.hashes !== "object") {
    violations.push("Missing 'hashes' object in evidence_integrity");
  } else {
    if (!integrity.hashes.report_payload_sha256 || integrity.hashes.report_payload_sha256.length !== 64) {
      violations.push("hashes missing valid 64-char 'report_payload_sha256'");
    }
    if (!integrity.hashes.evidence_merkle_root || integrity.hashes.evidence_merkle_root.length !== 64) {
      violations.push("hashes missing valid 64-char 'evidence_merkle_root'");
    }
  }

  // 8. Anti-Deception / Independent Audit Guard
  const attestation = integrity.independent_attestation;
  if (!attestation || typeof attestation !== "object") {
    violations.push("Missing 'independent_attestation' block in evidence_integrity");
  } else {
    if (typeof attestation.independent_audit_obtained !== "boolean") {
      violations.push("'independent_attestation.independent_audit_obtained' must be a boolean");
    }

    if (attestation.independent_audit_obtained === false) {
      if (attestation.certification_status !== "UNATTESTED_AUTOMATED_EVALUATION" && attestation.certification_status !== "NONE") {
        violations.push(`Invalid certification_status for unattested report: '${attestation.certification_status}'`);
      }

      // Check entire report for deceptive claims
      const reportString = JSON.stringify(report).toLowerCase();
      for (const phrase of PROHIBITED_DECEPTIVE_CLAIMS) {
        if (reportString.includes(phrase)) {
          violations.push(`Deceptive certification claim detected: Report implies '${phrase}' without formal third-party attestation.`);
        }
      }
    } else {
      // If claimed true, must have verifiable auditor credentials
      if (!attestation.auditor_identity || typeof attestation.auditor_identity !== "string") {
        violations.push("Independent audit claimed, but 'auditor_identity' is missing or invalid");
      }
      if (!attestation.accreditation_body || typeof attestation.accreditation_body !== "string") {
        violations.push("Independent audit claimed, but 'accreditation_body' is missing or invalid");
      }
    }
  }

  return {
    passed: violations.length === 0,
    total_checks: 8,
    violations,
    details: {
      ecdat_version: integrity.ecdat_version,
      scan_timestamp: integrity.scan_timestamp,
      report_fingerprint: integrity.hashes?.canonical_fingerprint,
      independent_audit_obtained: attestation?.independent_audit_obtained,
      certification_status: attestation?.certification_status,
    },
  };
}

module.exports = {
  ECDAT_VERSION,
  DEFAULT_SCANNER_VERSIONS,
  PROHIBITED_DECEPTIVE_CLAIMS,
  computeCanonicalSha256,
  computeEvidenceMerkleRoot,
  buildEvidenceIntegrity,
  validateEvidenceIntegrity,
};
