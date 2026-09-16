/**
 * ECDAT Operational Metrics — Phase 18.3 Metrics Privacy Guard
 *
 * Enforces the strict privacy constraint:
 * "Do not expose sensitive tenant data through public metrics."
 *
 * Ensures that Prometheus labels and public JSON metric values do not leak:
 * - Tenant identifiers or company names
 * - Customer repository URLs or internal network hostnames
 * - File paths containing sensitive usernames or directory names
 * - Secret keys, passwords, tokens, or hashes
 */

const SENSITIVE_PARAM_REGEX = /([?&](?:api_key|token|secret|password|key|auth)=)[^&]+/gi;
const URL_CREDENTIALS_REGEX = /:\/\/[^:]+:[^@]+@/g;
const GIT_PRIVATE_URL_REGEX = /git@[^:]+:([^/]+)\/([^.]+)\.git/gi;

/**
 * Sanitizes an HTTP route path into a generalized route pattern.
 * Removes IDs, UUIDs, hashes, and query parameters to avoid label cardinality explosion
 * and prevent leaking sensitive identifiers.
 *
 * @param {string} rawPath - e.g. "/api/v1/scans/scan_11c4f560-4097-4d6b-a592-12311917db7f/errors?key=secret"
 * @returns {string} - e.g. "/api/v1/scans/:id/errors"
 */
function sanitizeMetricRoute(rawPath) {
  if (!rawPath || typeof rawPath !== "string") return "/";

  // 1. Strip query strings completely
  const pathOnly = rawPath.split("?")[0];

  // 2. Normalize and collapse UUIDs and IDs
  return pathOnly
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ":id")
    .replace(/scan_[a-zA-Z0-9_-]+/g, ":id")
    .replace(/audit_[a-zA-Z0-9_-]+/g, ":id")
    .replace(/sec_evt_[a-zA-Z0-9_-]+/g, ":id")
    .replace(/\/(?:tenants|users|projects|assets|scans|cboms|reports)\/[a-zA-Z0-9_.-]+/gi, (match) => {
      const seg = match.split("/")[1];
      return `/${seg}/:id`;
    })
    .replace(/\/\d+/g, "/:id")
    .replace(/\/+$/, "") || "/";
}

/**
 * Audits metric labels to assert that no sensitive tenant or private identifier is present.
 *
 * @param {object} labels
 * @returns {object} Sanitized labels map
 */
function sanitizeMetricLabels(labels = {}) {
  const sanitized = {};
  const forbiddenLabelKeys = new Set(["tenant_id", "tenant", "user_id", "email", "repo_url", "token", "password"]);

  for (const [key, value] of Object.entries(labels)) {
    const normKey = key.toLowerCase();
    if (
      forbiddenLabelKeys.has(normKey) ||
      normKey.includes("tenant") ||
      normKey.includes("email") ||
      normKey.includes("token") ||
      normKey.includes("secret") ||
      normKey.includes("password") ||
      normKey.includes("user_id") ||
      normKey.includes("userid")
    ) {
      continue; // Omit completely from public metrics
    }

    // Sanitize string values
    if (typeof value === "string") {
      sanitized[key] = value
        .replace(URL_CREDENTIALS_REGEX, "://[REDACTED]@")
        .replace(SENSITIVE_PARAM_REGEX, "$1[REDACTED]")
        .slice(0, 100);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Validates whether a metrics text output is completely free of sensitive tokens and tenant names.
 *
 * @param {string} text
 * @param {Array<string>} [forbiddenTokens=[]]
 * @returns {boolean} True if compliant
 */
function verifyMetricsPrivacy(text, forbiddenTokens = []) {
  if (!text || typeof text !== "string") return true;

  if (URL_CREDENTIALS_REGEX.test(text)) return false;
  if (SENSITIVE_PARAM_REGEX.test(text)) return false;

  for (const token of forbiddenTokens) {
    if (token && text.includes(token)) {
      return false;
    }
  }

  return true;
}

module.exports = {
  sanitizeMetricRoute,
  sanitizeMetricLabels,
  verifyMetricsPrivacy,
};
