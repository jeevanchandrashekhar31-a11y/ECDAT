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
} = require("../middleware/api_hardening");

/**
 * POST /api/v1/security/validate-url
 * Validates whether a URL is safe against SSRF (rejects private IPs, cloud metadata, invalid schemes).
 */
router.post("/validate-url", (req, res) => {
  const { url, allowLocalhost = false } = req.body || {};
  const result = validateSafeUrl(url, { allowLocalhost });
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

module.exports = router;


