/**
 * Security Hardening REST API Routes — Phase 15.1
 *
 * Exposes endpoints for validating OWASP API security defenses:
 * - SSRF detection & URL safe-checking
 * - Path traversal validation
 * - Injection detection (SQL, NoSQL, command, prototype pollution)
 * - Mass assignment & property-level authorization (BOPLA)
 * - Object-level authorization (BOLA / IDOR)
 * - Strict schema validation with allowlists
 */

const express = require("express");
const router = express.Router();
const {
  validateSafeUrl,
  validateSafePath,
  inspectForInjection,
  massAssignmentProtectionMiddleware,
  objectLevelAuthMiddleware,
  validateSchema,
  validateSafeUrlAsync,
  validateSafeGitUrlAsync,
} = require("../middleware/api_hardening");
const { CryptoClassifier, CryptoSecurityService } = require("../security");

/**
 * POST /api/v1/security/validate-url
 * Validates whether a URL is safe against SSRF (rejects private IPs, cloud metadata, invalid schemes).
 * Supports optional DNS destination resolution via resolveDns: true.
 */
router.post("/validate-url", async (req, res) => {
  const { url, allowLocalhost = false, resolveDns = false } = req.body || {};
  if (resolveDns) {
    const result = await validateSafeUrlAsync(url, { allowLocalhost });
    return res.json(result);
  }
  const result = validateSafeUrl(url, { allowLocalhost });
  res.json(result);
});

/**
 * POST /api/v1/security/validate-git-url
 * Validates whether a Git repository URL is safe against SSRF and command/option injection.
 */
router.post("/validate-git-url", async (req, res) => {
  const { url, allowPrivate = false } = req.body || {};
  const result = await validateSafeGitUrlAsync(url, { allowPrivate });
  res.json(result);
});

/**
 * POST /api/v1/security/validate-path
 * Validates whether a file path is safe against path traversal.
 */
router.post("/validate-path", (req, res) => {
  const { path: inputPath, baseDir = process.cwd() } = req.body || {};
  const result = validateSafePath(inputPath, baseDir);
  res.json(result);
});

/**
 * POST /api/v1/security/inspect-injection
 * Directly tests an input payload for injection patterns.
 */
router.post("/inspect-injection", (req, res) => {
  const violation = inspectForInjection(req.body, "body", false);
  res.json({
    safe: !violation,
    violation: violation || null,
  });
});

/**
 * POST /api/v1/security/protected-user-profile
 * Endpoint demonstrating BOPLA / Mass Assignment protection.
 * Non-admins cannot mutate 'role', 'isAdmin', or 'tenantId'.
 */
router.post(
  "/protected-user-profile",
  massAssignmentProtectionMiddleware({
    blockedProperties: ["role", "isAdmin", "tenantId", "permissions"],
  }),
  (req, res) => {
    res.json({
      message: "Profile updated successfully without mass-assignment violation.",
      updatedFields: Object.keys(req.body || {}),
    });
  }
);

/**
 * GET /api/v1/security/tenants/:tenantId/assets/:assetId
 * Endpoint demonstrating Object-Level Authorization (BOLA / IDOR).
 */
router.get(
  "/tenants/:tenantId/assets/:assetId",
  objectLevelAuthMiddleware({
    getResourceOwner: async (assetId, req) => {
      // Mock resource resolver for testing
      return {
        id: assetId,
        tenantId: req.params.tenantId,
        ownerId: req.params.tenantId === "tenant-alpha" ? "user-alpha-1" : "user-beta-1",
      };
    },
    idParam: "assetId",
  }),
  (req, res) => {
    res.json({
      message: "Object access granted.",
      assetId: req.params.assetId,
      tenantId: req.params.tenantId,
    });
  }
);

/**
 * Sample Strict Schema for Schema Validation Testing
 */
const strictAssetSchema = {
  type: "object",
  required: ["name", "assetType"],
  additionalProperties: false, // Strict allowlist mode
  properties: {
    name: { type: "string", minLength: 2, maxLength: 100 },
    assetType: { type: "string", enum: ["service", "database", "endpoint", "library"] },
    environment: { type: "string", enum: ["production", "staging", "development"] },
  },
};

/**
 * POST /api/v1/security/validate-asset
 * Demonstrates strict schema validation with allowlist and rejection of unexpected properties.
 */
router.post("/validate-asset", validateSchema(strictAssetSchema, "body"), (req, res) => {
  res.json({
    valid: true,
    data: req.body,
  });
});

// ============================================================================
// PHASE 16.1 DATA PROTECTION ENDPOINTS
// ============================================================================

const {
  getClassificationTaxonomy,
  classifyField,
  getDomainProtectionPolicy,
  assertStorageAllowed,
  getDocumentedExceptions,
  defaultEncryptionAtRest,
  getTransitSecurityStatus,
} = require("../security");

/**
 * GET /api/v1/security/data-classification
 * Returns ECDAT enterprise data classification taxonomy and protected domain policies.
 */
router.get("/data-classification", (req, res) => {
  res.json(getClassificationTaxonomy());
});

/**
 * POST /api/v1/security/data-classification/classify
 * Classifies a specific entity and field name.
 */
router.post("/data-classification/classify", (req, res) => {
  const { entityType = "generic", fieldName } = req.body || {};
  if (!fieldName) {
    return res.status(400).json({ error: "Field 'fieldName' is required" });
  }
  const result = classifyField(entityType, fieldName);
  res.json(result);
});

/**
 * GET /api/v1/security/data-classification/domain/:domain
 * Returns protection policy for a specific data domain.
 */
router.get("/data-classification/domain/:domain", (req, res) => {
  const result = getDomainProtectionPolicy(req.params.domain);
  res.json(result);
});

/**
 * GET /api/v1/security/documented-secret-exceptions
 * Lists documented unavoidable requirements for secret storage.
 */
router.get("/documented-secret-exceptions", (req, res) => {
  res.json({
    total: getDocumentedExceptions().length,
    exceptions: getDocumentedExceptions(),
  });
});

/**
 * POST /api/v1/security/validate-secret-storage
 * Validates payload against the Zero-Secret-Storage Invariant.
 */
router.post("/validate-secret-storage", (req, res) => {
  const { entityType = "generic", data, exceptionId = null } = req.body || {};
  const validation = assertStorageAllowed(entityType, data, {
    exceptionId,
    throwOnViolation: false,
  });

  if (!validation.valid) {
    return res.status(400).json({
      allowed: false,
      code: "ERR_PROHIBITED_SECRET_STORAGE",
      message: "Data contains prohibited secret/key contents or lacks documented exception.",
      violations: validation.violations,
    });
  }

  res.json({
    allowed: true,
    entityType,
    exceptionApplied: validation.allowedException ? validation.allowedException.id : null,
  });
});

/**
 * POST /api/v1/security/encrypt-at-rest
 * Encrypts sensitive plaintext using AES-256-GCM authenticated encryption.
 */
router.post("/encrypt-at-rest", (req, res) => {
  const { plaintext, aad = null, kid = null } = req.body || {};
  if (plaintext === undefined || plaintext === null) {
    return res.status(400).json({ error: "Field 'plaintext' is required" });
  }

  try {
    const ciphertext = defaultEncryptionAtRest.encrypt(plaintext, { aad, kid });
    res.json({
      encrypted: true,
      ciphertext,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/security/decrypt-at-rest
 * Decrypts AES-256-GCM encrypted ciphertext with authentication tag verification.
 */
router.post("/decrypt-at-rest", (req, res) => {
  const { ciphertext, aad = null, parseJson = false } = req.body || {};
  if (!ciphertext) {
    return res.status(400).json({ error: "Field 'ciphertext' is required" });
  }

  try {
    const decrypted = defaultEncryptionAtRest.decrypt(ciphertext, { aad, parseJson });
    res.json({
      decrypted: true,
      plaintext: decrypted,
    });
  } catch (err) {
    res.status(400).json({
      error: "DecryptionFailed",
      code: err.code || "ERR_AUTH_FAILED",
      message: err.message,
    });
  }
});

/**
 * GET /api/v1/security/transit-status
 * Returns TLS in-transit encryption status across DB, API, and outbound integrations.
 */
router.get("/transit-status", (req, res) => {
  res.json(getTransitSecurityStatus());
});

// ============================================================================
// PHASE 16.2 DATABASE SECURITY ENDPOINTS
// ============================================================================

const {
  db,
  ROLE_DEFINITIONS,
  generateLeastPrivilegeSql,
  getDbAuditLogs,
  getRetentionPolicy,
  pruneExpiredData,
  createEncryptedBackup,
  verifyBackupIntegrity,
  listBackups,
  detectSqlInjection,
  applyQueryBounds,
  safeRaw,
} = require("../db");

/**
 * GET /api/v1/security/database/least-privilege-roles
 * Returns role specifications and PostgreSQL provisioning script for least-privilege DB access.
 */
router.get("/database/least-privilege-roles", (req, res) => {
  res.json({
    roles: ROLE_DEFINITIONS,
    provisioningScript: generateLeastPrivilegeSql(),
  });
});

/**
 * GET /api/v1/security/database/audit-logs
 * Returns database audit events with bounded pagination.
 */
router.get("/database/audit-logs", async (req, res) => {
  try {
    const filter = {
      eventType: req.query.eventType,
      actor: req.query.actor,
      tenantId: req.query.tenantId,
      tableName: req.query.tableName,
    };
    const options = {
      limit: req.query.limit,
      offset: req.query.offset,
    };
    const result = await getDbAuditLogs(db, filter, options);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/security/database/retention-policy
 * Returns configured data retention windows and pruning policies.
 */
router.get("/database/retention-policy", (req, res) => {
  res.json(getRetentionPolicy());
});

/**
 * POST /api/v1/security/database/prune
 * Executes or estimates (dryRun) data retention pruning.
 */
router.post("/database/prune", async (req, res) => {
  try {
    const { entityType = "all", retentionDays, batchSize = 500, dryRun = true } = req.body || {};
    const actor = req.auth?.user?.sub || req.auth?.userId || "system";

    const summary = await pruneExpiredData(db, {
      entityType,
      retentionDays,
      batchSize,
      dryRun,
      actor,
    });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/security/database/backups
 * Generates an encrypted AES-256-GCM database backup snapshot.
 */
router.post("/database/backups", async (req, res) => {
  try {
    const actor = req.auth?.user?.sub || req.auth?.userId || "system";
    const manifest = await createEncryptedBackup(db, { actor });
    res.status(201).json({
      message: "Encrypted database backup created successfully",
      backup: manifest,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/security/database/backups
 * Lists all available backup manifests.
 */
router.get("/database/backups", (req, res) => {
  res.json({
    total: listBackups().length,
    backups: listBackups(),
  });
});

/**
 * POST /api/v1/security/database/backups/:id/verify
 * Verifies backup archive SHA-256 checksum and AES-256-GCM authentication tag.
 */
router.post("/database/backups/:id/verify", (req, res) => {
  try {
    const result = verifyBackupIntegrity(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

/**
 * POST /api/v1/security/database/test-query
 * Tests parameterized query execution and injection defense.
 */
router.post("/database/test-query", async (req, res) => {
  const { targetName } = req.body || {};

  // Check SQL injection detection
  const injectionCheck = detectSqlInjection(targetName);

  try {
    // Execute safely parameterized query via Knex
    const rows = await applyQueryBounds(
      db("scans").where({ target_name: targetName }).select("id", "target_name", "status"),
      { limit: 10 }
    );

    res.json({
      safe: true,
      injectionDetected: injectionCheck.detected,
      resultsCount: rows.length,
      records: rows,
    });
  } catch (err) {
    res.status(500).json({
      error: "QueryExecutionError",
      message: err.message,
    });
  }
});

/**
 * GET /api/v1/security/crypto/audit
 * Runs comprehensive audit of platform cryptographic operations across all 11 dimensions.
 */
router.get("/crypto/audit", (req, res) => {
  const auditReport = CryptoSecurityService.runCryptographicAudit();
  res.json(auditReport);
});

/**
 * POST /api/v1/security/crypto/classify
 * Classifies an algorithm into: quantum-vulnerable, quantum-resistant, hybrid, or unknown.
 * Deeply validates key sizes, parameter sets, and combiner structures.
 */
router.post("/crypto/classify", (req, res) => {
  const { algorithm, keySize, parameters, mode, hybridComponents } = req.body || {};
  if (!algorithm || typeof algorithm !== "string") {
    return res.status(400).json({
      error: "InvalidAlgorithm",
      message: "Field 'algorithm' is required and must be a non-empty string.",
    });
  }

  const result = CryptoClassifier.classify(algorithm, {
    keySize: typeof keySize === "number" ? keySize : undefined,
    parameters,
    mode,
    hybridComponents,
  });

  res.json(result.toJSON());
});

// ============================================================================
// PHASE 24 SCANNER RESULT INTEGRITY & PROVENANCE ENDPOINTS
// ============================================================================

const {
  RESULT_STATES,
  CANONICAL_STATES,
  ABSENCE_DISCLAIMER,
  assertNoIllegalCollapse,
  verifyFindingProvenance,
  ResultIntegrityTracker,
} = require("../security");

/**
 * GET /api/v1/security/scanners/result-states
 * Returns the 6 canonical scanner outcome states and integrity policy rules.
 */
router.get("/scanners/result-states", (req, res) => {
  res.json({
    canonicalStates: Object.values(RESULT_STATES),
    antiCollapseRules: [
      "Never collapse NOT_SCANNED into NOT_FOUND",
      "Never collapse ERROR / SCAN_ERROR into CLEAN",
      "Never collapse UNSUPPORTED into NOT_FOUND",
    ],
    absenceDisclaimer: ABSENCE_DISCLAIMER,
    provenanceRequirements: [
      "location (file:line or host:port)",
      "detectionMethod (ast, regex, runtime_hook, network_handshake)",
      "ruleId (specific identifier)",
      "toolName",
      "confidence",
      "timestamp",
    ],
  });
});

/**
 * POST /api/v1/security/scanners/validate-integrity
 * Evaluates item-level scan outcomes and verifies zero anti-collapse violations.
 */
router.post("/scanners/validate-integrity", (req, res) => {
  const { scannerName, items } = req.body || {};

  if (!Array.isArray(items)) {
    return res.status(400).json({
      error: "InvalidPayload",
      message: "Field 'items' must be an array of item scan outcome records.",
    });
  }

  const tracker = new ResultIntegrityTracker(scannerName || "ECDAT Scanner");
  const violations = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const itemId = it.itemId || it.id || `item-${i + 1}`;
    const target = it.target || itemId;
    const status = String(it.status || "").trim().toUpperCase();

    if (!CANONICAL_STATES.has(status)) {
      violations.push(`Item '${itemId}': Invalid state '${status}'. Must be one of: ${Array.from(CANONICAL_STATES).join(", ")}`);
      continue;
    }

    try {
      if (status === RESULT_STATES.FOUND) {
        tracker.recordFound(itemId, target, it.findings || [{ id: "fnd-1" }], it.provenance || [], it.reasons);
      } else if (status === RESULT_STATES.NOT_FOUND) {
        tracker.recordNotFound(itemId, target, it.reasons);
      } else if (status === RESULT_STATES.NOT_SCANNED) {
        tracker.recordNotScanned(itemId, target, it.reason || "Skipped by policy", it.details);
      } else if (status === RESULT_STATES.SCAN_ERROR) {
        tracker.recordScanError(itemId, target, it.error || "Execution error", it.details);
      } else if (status === RESULT_STATES.UNSUPPORTED) {
        tracker.recordUnsupported(itemId, target, it.reason || "Unsupported format", it.details);
      } else if (status === RESULT_STATES.UNKNOWN) {
        tracker.recordUnknown(itemId, target, it.reason || "Indeterminate analysis", it.details);
      }
    } catch (err) {
      violations.push(err.message);
    }
  }

  if (violations.length > 0) {
    return res.status(422).json({
      error: "ResultIntegrityViolation",
      violations,
    });
  }

  res.json(tracker.getSummary());
});

module.exports = router;



