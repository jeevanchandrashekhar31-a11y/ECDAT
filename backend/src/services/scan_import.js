const fs = require("fs");
const { ingestCbom } = require("./cbom_ingestion");

/**
 * Imports a CBOM scan from a local JSON file path.
 */
function importScanFromFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    const err = new Error(
      `Scan import failed: File '${filePath}' does not exist.`,
    );
    err.statusCode = 404;
    throw err;
  }

  let parsedData;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    parsedData = JSON.parse(content);
  } catch (e) {
    const err = new Error(
      `Scan import failed: Unable to parse JSON from '${filePath}': ${e.message}`,
    );
    err.statusCode = 400;
    throw err;
  }

  const scanName = options.scanName || `Imported File (${filePath})`;
  return ingestCbom(parsedData, { ...options, scanName });
}

/**
 * Imports a CBOM scan from raw JSON data payload.
 */
function importScanFromJson(payload, options = {}) {
  let data = payload;
  if (typeof payload === "string") {
    try {
      data = JSON.parse(payload);
    } catch (e) {
      const err = new Error(
        `Scan import failed: Invalid JSON string: ${e.message}`,
      );
      err.statusCode = 400;
      throw err;
    }
  }

  return ingestCbom(data, options);
}

module.exports = {
  importScanFromFile,
  importScanFromJson,
};
