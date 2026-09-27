/**
 * Tenant isolation helper for route handlers.
 * Converts SCAN_TENANT_FORBIDDEN sentinel returns into proper 404 HTTP responses,
 * keeping the API consistent with RFC 7231: "server SHOULD respond with 404"
 * when resource disclosure would itself be a privacy violation.
 */
const { SCAN_TENANT_FORBIDDEN } = require("../services/cbom_ingestion");

/**
 * Checks if a value returned from getScanById is the tenant-forbidden sentinel.
 * If so, sends a 404 response and returns true (caller must return early).
 * @param {*} scan   Return value from getScanById
 * @param {object} res  Express response object
 * @returns {boolean}   true if response was sent (caller must return)
 */
function rejectIfTenantForbidden(scan, res) {
  if (scan === SCAN_TENANT_FORBIDDEN) {
    res.status(404).json({
      error: "Not Found",
      message: "Scan not found.",
    });
    return true;
  }
  return false;
}

module.exports = { rejectIfTenantForbidden, SCAN_TENANT_FORBIDDEN };
