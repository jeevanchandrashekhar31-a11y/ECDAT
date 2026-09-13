const express = require("express");
const multer = require("multer");
const { ingestSbom } = require("../services/sbom_ingestion");
const { validateSbomStructure } = require("../services/sbom_validation");
const config = require("../config");
const { createRateLimitMiddleware } = require("../middleware/rate_limit");

const router = express.Router();

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
 * Handles SBOM JSON upload or raw JSON body.
 */
async function handleSbomIngest(req, res, next) {
  try {
    let rawPayload;

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
    } else if (req.body && typeof req.body === "object") {
      rawPayload = req.body;
    } else {
      return res.status(400).json({
        error: "BadRequest",
        message: "Request must contain a JSON body or multipart file upload ('file')",
      });
    }

    const result = ingestSbom(rawPayload);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Validates SBOM without ingesting.
 */
function handleSbomValidate(req, res, next) {
  try {
    let rawPayload;

    if (req.file) {
      const fileContent = req.file.buffer.toString("utf8");
      try {
        rawPayload = JSON.parse(fileContent);
      } catch (parseErr) {
        return res.status(400).json({
          valid: false,
          errors: [`Malformed JSON: ${parseErr.message}`],
        });
      }
    } else {
      rawPayload = req.body;
    }

    const result = validateSbomStructure(rawPayload);
    return res.status(result.valid ? 200 : 400).json(result);
  } catch (err) {
    next(err);
  }
}

router.post("/ingest", uploadRateLimit, upload.single("file"), handleSbomIngest);
router.post("/validate", upload.single("file"), handleSbomValidate);
router.post("/", uploadRateLimit, upload.single("file"), handleSbomIngest);

module.exports = router;
