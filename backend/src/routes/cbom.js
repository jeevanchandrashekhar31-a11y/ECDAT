const express = require("express");
const multer = require("multer");
const {
  ingestCbom,
  getAllScans,
  getScanById,
} = require("../services/cbom_ingestion");
const config = require("../config");
const { createRateLimitMiddleware } = require("../middleware/rate_limit");

const router = express.Router();

// Configure Multer for bounded in-memory file uploads.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.MAX_UPLOAD_BYTES,
  },
});
const uploadRateLimit = createRateLimitMiddleware({
  max: config.UPLOAD_RATE_LIMIT,
});

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

    // 1. Check if multipart file upload
    if (req.file) {
      const fileContent = req.file.buffer.toString("utf8");
      try {
        rawPayload = JSON.parse(fileContent);
      } catch (parseErr) {
        return res.status(400).json({
          error: "BadRequest",
          message: `Uploaded file '${req.file.originalname}' is not valid JSON: ${parseErr.message}`,
        });
      }
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
router.post("/", uploadRateLimit, upload.single("file"), handleCbomUpload);

/**
 * POST /api/v1/cbom/ingest (backwards-compatible alias)
 */
router.post(
  "/ingest",
  uploadRateLimit,
  upload.single("file"),
  handleCbomUpload,
);

/**
 * GET /api/v1/cboms or /api/v1/cbom
 * Lists all ingested scans.
 */
router.get("/", async (req, res, next) => {
  try {
    const scans = await getAllScans();
    res.status(200).json({ scans });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/cboms/:id or /api/v1/cbom/:id
 * Retrieves the annotated CycloneDX 1.6 CBOM document for a scan.
 */
router.get("/:id", async (req, res, next) => {
  try {
    const scan = await getScanById(req.params.id);
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
});

module.exports = router;
