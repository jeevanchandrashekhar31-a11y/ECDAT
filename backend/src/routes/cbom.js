const express = require("express");
const multer = require("multer");
const {
  ingestCbom,
  getAllScans,
  getScanById,
} = require("../services/cbom_ingestion");
const config = require("../config");
const { createRateLimitMiddleware } = require("../middleware/rate_limit");
const { requireObjectAuthorization, OBJECT_TYPES, defaultObjectStateRegistry } = require("../security/object_authorization");
const {
  validateFile,
  validateCbomContent,
  validateLength,
  paginationBoundsMiddleware,
} = require("../security/input_validation");
const { RATE_LIMITS, concurrencyQuotaMiddleware } = require("../security/resource_governance");

const router = express.Router();

// Configure Multer for bounded in-memory file uploads.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_UPLOAD_BYTES,
  },
});
// const uploadRateLimit = createRateLimitMiddleware({
//   max: config.UPLOAD_RATE_LIMIT,
// });

/**
 * Shared ingestion handler for JSON payloads and multipart file uploads.
 */
async function handleCbomUpload(req, res, next) {
  try {
    let rawPayload;
    let scannerType = req.body?.scanner_type || req.query?.scanner_type;
    let scanLabel =
      req.body?.scan_label ||
      req.body?.scan_name ||
      req.query?.scan_name ||
      req.query?.scanName;
    let projectName =
      req.body?.project_name ||
      req.body?.project_id ||
      req.query?.project_name ||
      req.query?.projectId;
    let policyProfile =
      req.body?.policy_profile ||
      req.body?.policyProfile ||
      req.query?.policy_profile ||
      req.query?.policyProfile;
    let scenario = req.body?.scenario || req.query?.scenario;
    const rejectPrivateKey =
      req.body?.reject_private_keys === "true" ||
      req.query?.reject_private_keys === "true";

    // Validate string parameters length limits
    if (scanLabel) {
      const check = validateLength(String(scanLabel), { max: 256, fieldName: "scanLabel" });
      if (!check.valid) return res.status(400).json({ error: "ValidationError", message: check.error });
    }
    if (projectName) {
      const check = validateLength(String(projectName), { max: 256, fieldName: "projectName" });
      if (!check.valid) return res.status(400).json({ error: "ValidationError", message: check.error });
    }
    if (scannerType) {
      const check = validateLength(String(scannerType), { max: 128, fieldName: "scannerType" });
      if (!check.valid) return res.status(400).json({ error: "ValidationError", message: check.error });
    }
    if (policyProfile) {
      const check = validateLength(String(policyProfile), { max: 128, fieldName: "policyProfile" });
      if (!check.valid) return res.status(400).json({ error: "ValidationError", message: check.error });
    }

    // 1. Check if multipart file upload
    if (req.file) {
      const fileValidation = validateFile(req.file, { maxSizeBytes: config.MAX_UPLOAD_BYTES });
      if (!fileValidation.valid) {
        return res.status(400).json({
          error: "ValidationError",
          code: "INVALID_FILE_UPLOAD",
          message: fileValidation.error,
        });
      }

      const contentValidation = validateCbomContent(req.file.buffer);
      if (!contentValidation.valid) {
        return res.status(400).json({
          error: "BadRequest",
          code: "INVALID_CBOM_CONTENT",
          message: `Uploaded file '${req.file.originalname}' failed content validation: ${contentValidation.error}`,
        });
      }

      rawPayload = contentValidation.parsed;
      if (!scanLabel) {
        scanLabel = `Upload: ${req.file.originalname}`;
      }
    } else {
      // 2. Direct JSON body
      rawPayload = req.body;
      if (
        !rawPayload ||
        (typeof rawPayload === "object" && Object.keys(rawPayload).length === 0)
      ) {
        return res.status(400).json({
          error: "BadRequest",
          message:
            "Request must contain a valid CycloneDX CBOM JSON body or a file upload (field: file/cbom).",
        });
      }
    }

    // Unwrap if payload is nested in { cbom: ... }
    const actualCbom = rawPayload.cbom || rawPayload;

    // 3. Process ingestion
    const scanRecord = await ingestCbom(actualCbom, {
      policyProfile,
      scenario,
      scanName: scanLabel,
      scannerType,
      projectName,
      rejectPrivateKey,
      tenantContext: req.tenantContext,
    });

    res.status(201).json({
      message: "CBOM successfully ingested and risk-annotated",
      scan_id: scanRecord.id,
      name: scanRecord.name,
      scanner_type: scanRecord.scanner_type,
      project_id: scanRecord.project_id,
      policy_profile: scanRecord.policy_profile,
      scenario: scanRecord.scenario,
      metrics: scanRecord.metrics,
      warnings_count: scanRecord.errors?.length || 0,
      links: {
        scan_details: `/api/v1/scans/${scanRecord.id}`,
        scan_errors: `/api/v1/scans/${scanRecord.id}/errors`,
        dashboard: `/api/v1/dashboard/summary?scanId=${scanRecord.id}`,
        annotated_cbom: `/api/v1/cboms/${scanRecord.id}`,
        findings: `/api/v1/findings?scanId=${scanRecord.id}`,
        assets: `/api/v1/assets?scanId=${scanRecord.id}`,
        html_report: `/api/v1/reports/${scanRecord.id}/html`,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/v1/cboms and /api/v1/cbom
 * Ingests a CycloneDX CBOM via JSON body or multipart file upload.
 */
router.post(
  "/",
  concurrencyQuotaMiddleware(),
  (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      return RATE_LIMITS.archiveUpload.middleware()(req, res, next);
    }
    return RATE_LIMITS.cbomGeneration.middleware()(req, res, next);
  },
  upload.single("file"),
  handleCbomUpload
);

/**
 * POST /api/v1/cbom/ingest (backwards-compatible alias)
 */
router.post(
  "/ingest",
  concurrencyQuotaMiddleware(),
  (req, res, next) => {
    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      return RATE_LIMITS.archiveUpload.middleware()(req, res, next);
    }
    return RATE_LIMITS.cbomGeneration.middleware()(req, res, next);
  },
  upload.single("file"),
  handleCbomUpload
);

/**
 * GET /api/v1/cboms or /api/v1/cbom
 * Lists all ingested scans scoped to caller's tenant.
 */
router.get("/", paginationBoundsMiddleware(), async (req, res, next) => {
  try {
    const scans = await getAllScans(req.tenantContext);
    res.status(200).json({ scans });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/cboms/projects/:projectId or /api/v1/cbom/projects/:projectId
 * Retrieves project CBOM metadata verifying server-side state and tenant boundaries.
 */
router.get(
  "/projects/:projectId",
  requireObjectAuthorization(OBJECT_TYPES.PROJECT, { idParam: "projectId" }),
  (req, res) => {
    const project = req.resolvedObject;
    return res.json({
      projectId: project.id,
      tenantId: project.tenantId,
      status: "active",
    });
  }
);

/**
 * GET /api/v1/cboms/:id or /api/v1/cbom/:id
 * Retrieves the annotated CycloneDX 1.6 CBOM document for a scan scoped to caller's tenant.
 */
router.get(
  "/:id",
  requireObjectAuthorization(OBJECT_TYPES.CBOM, { idParam: "id", hideCrossTenantExistence: true }),
  async (req, res, next) => {
    try {
      const scan = await getScanById(req.params.id, req.tenantContext);
      if (!scan) {
        return res.status(404).json({
          error: "NotFound",
          message: `Scan '${req.params.id}' not found`,
        });
      }

      res.status(200).json(scan.annotated_bom);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
