/**
 * ECDAT SIEM Integration Subsystem — Phase 18.2 Event Builder
 *
 * Constructs structured, schema-compliant security events for SIEM ingestion:
 * - timestamp
 * - actor
 * - tenant
 * - action
 * - resource
 * - result
 * - request ID
 * - risk context (quantum threat status, cvss, severity, mosca deadline)
 * - zero sensitive payloads (automated secret scrubbing)
 */

const crypto = require("crypto");
const { scrubSecrets } = require("../audit/scrubber");

const SCHEMA_VERSION = "1.0.0";
const DEFAULT_SIGNING_KEY = process.env.SIEM_HMAC_SECRET || "ecdat-siem-signing-key-2026";

/**
 * Builds a structured, schema-validated SIEM security event.
 *
 * @param {object} input
 * @param {string} [input.eventId]
 * @param {string} [input.timestamp]
 * @param {object} [input.actor] - { id, username, role, ipAddress, userAgent }
 * @param {object|string} [input.tenant] - { id, name } or tenantId string
 * @param {string} input.action - e.g. AUTHENTICATION_ATTEMPT, CRYPTOGRAPHIC_SCAN, POLICY_MUTATION
 * @param {object} input.resource - { type, id, name, classification }
 * @param {object} [input.result] - { status: 'SUCCESS'|'FAILURE'|'DENIED'|'LOCKED'|'ERROR', code, message }
 * @param {string} [input.requestId] - Correlation request ID
 * @param {object} [input.riskContext] - { severity, quantumRiskLevel, cvssScore, moscaDeadlineYear, threatCategory, policyViolated, confidence }
 * @param {object} [input.metadata={}] - Arbitrary details (strictly scrubbed of any secrets)
 * @param {string} [signingKey=DEFAULT_SIGNING_KEY]
 * @returns {object} Validated SIEM security event object
 */
function buildSiemSecurityEvent(input = {}, signingKey = DEFAULT_SIGNING_KEY) {
  const eventId = input.eventId || `sec_evt_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const timestamp = input.timestamp || new Date().toISOString();

  // 1. Actor format
  const rawActor = input.actor || {};
  const actor = {
    id: String(rawActor.id || rawActor.userId || "anonymous").slice(0, 128),
    username: String(rawActor.username || rawActor.name || "anonymous").slice(0, 128),
    role: String(rawActor.role || "viewer").slice(0, 64),
    ip: rawActor.ip || rawActor.ip_address || rawActor.ipAddress || null,
    ip_address: rawActor.ip_address || rawActor.ip || rawActor.ipAddress || null,
    user_agent: rawActor.user_agent || rawActor.userAgent || null,
  };

  // 2. Tenant format
  let tenant = { id: "default", name: null };
  if (typeof input.tenant === "string") {
    tenant = { id: input.tenant.slice(0, 128), name: null };
  } else if (input.tenant && typeof input.tenant === "object") {
    tenant = {
      id: String(input.tenant.id || "default").slice(0, 128),
      name: input.tenant.name ? String(input.tenant.name).slice(0, 128) : null,
    };
  }

  // 3. Action
  const action = String(input.action || "SYSTEM_EVENT").toUpperCase().slice(0, 128);

  // 4. Resource
  const rawResource = input.resource || {};
  const resource = {
    type: String(rawResource.type || "system").slice(0, 64),
    id: String(rawResource.id || "general").slice(0, 256),
    name: rawResource.name ? String(rawResource.name).slice(0, 256) : null,
    classification: rawResource.classification || null,
  };

  // 5. Result
  const rawResult = input.result || {};
  const result = {
    status: (rawResult.status || "SUCCESS").toUpperCase(),
    code: rawResult.code !== undefined ? rawResult.code : null,
    message: rawResult.message ? String(rawResult.message).slice(0, 1024) : null,
  };

  // 6. Request ID
  const requestId = String(input.requestId || input.request_id || `req_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`).slice(0, 128);

  // 7. Risk Context
  const rawRisk = input.riskContext || input.risk_context || {};
  const rawCvss = rawRisk.cvss_score !== undefined ? rawRisk.cvss_score : rawRisk.cvssScore;
  const numCvss = rawCvss !== undefined && rawCvss !== null ? Number(rawCvss) : null;
  const cvss_score = typeof numCvss === "number" && !isNaN(numCvss) ? numCvss : null;

  const rawScore = rawRisk.risk_score !== undefined ? rawRisk.risk_score : rawRisk.riskScore;
  const numScore = rawScore !== undefined && rawScore !== null ? Number(rawScore) : null;
  const risk_score = typeof numScore === "number" && !isNaN(numScore) ? numScore : null;

  const rawYear = rawRisk.mosca_deadline_year !== undefined ? rawRisk.mosca_deadline_year : rawRisk.moscaDeadlineYear;
  const intYear = rawYear !== undefined && rawYear !== null ? parseInt(rawYear, 10) : null;
  const mosca_deadline_year = Number.isInteger(intYear) ? intYear : null;

  const riskContext = {
    severity: String(rawRisk.severity || "INFORMATIONAL").toUpperCase(),
    quantum_risk_level: rawRisk.quantum_risk_level || rawRisk.quantumRiskLevel || (rawRisk.quantum_risk || rawRisk.quantumRisk ? "IMMEDIATE_HARVEST_NOW_DECRYPT_LATER" : "NOT_APPLICABLE"),
    quantum_risk: rawRisk.quantum_risk !== undefined ? Boolean(rawRisk.quantum_risk) : (rawRisk.quantumRisk !== undefined ? Boolean(rawRisk.quantumRisk) : null),
    cvss_score,
    risk_score,
    mosca_deadline_year,
    threat_category: rawRisk.threat_category || rawRisk.threatCategory || null,
    compliance_impact: Array.isArray(rawRisk.compliance_impact || rawRisk.complianceImpact) ? (rawRisk.compliance_impact || rawRisk.complianceImpact) : null,
    policy_violated: rawRisk.policy_violated !== undefined ? Boolean(rawRisk.policy_violated) : (rawRisk.policyViolated !== undefined ? Boolean(rawRisk.policyViolated) : null),
    confidence: rawRisk.confidence !== undefined ? Number(rawRisk.confidence) : 1.0,
  };

  // 8. Mandatory Zero-Secret Payload Scrubbing
  const rawMetadata = input.metadata || input.details || {};
  const { sanitized: scrubbedMetadata } = scrubSecrets(rawMetadata);

  // 9. Base event payload
  const siemEvent = {
    version: SCHEMA_VERSION,
    event_id: eventId,
    event_type: input.event_type || input.eventType || "SECURITY_AUDIT",
    timestamp,
    actor,
    tenant,
    action,
    resource,
    result,
    request_id: requestId,
    risk_context: riskContext,
    metadata: scrubbedMetadata,
  };

  // 10. Cryptographic HMAC Signature
  const stringToSign = `${siemEvent.event_id}:${siemEvent.timestamp}:${siemEvent.action}:${siemEvent.actor.id}:${siemEvent.tenant.id}:${siemEvent.result.status}:${siemEvent.risk_context.severity}`;
  siemEvent.signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return siemEvent;
}

/**
 * Bridges an Audit record (Phase 18.1) into a standard SIEM Security Event (Phase 18.2).
 *
 * @param {object} auditRecord
 * @param {object} [riskOverrides={}]
 * @returns {object} Standardized SIEM event
 */
function createSiemEventFromAudit(auditRecord, riskOverrides = {}) {
  // Infer risk severity from audit category and status
  let severity = "INFORMATIONAL";
  if (auditRecord.status === "DENIED" || auditRecord.status === "LOCKED") {
    severity = "HIGH";
  } else if (auditRecord.status === "FAILURE" || auditRecord.status === "ERROR") {
    severity = "MEDIUM";
  } else if (auditRecord.category === "SECRET_OPERATION" || auditRecord.category === "PERMISSION_CHANGE") {
    severity = "MEDIUM";
  }

  // Detect quantum risk context if present in details
  let quantumRiskLevel = "NOT_APPLICABLE";
  if (auditRecord.details?.assets_at_quantum_risk > 0 || auditRecord.details?.quantum_risk_level) {
    quantumRiskLevel = auditRecord.details.quantum_risk_level || "IMMEDIATE_HARVEST_NOW_DECRYPT_LATER";
    severity = "HIGH";
  }

  return buildSiemSecurityEvent({
    eventId: `siem_${auditRecord.eventId || auditRecord.id}`,
    timestamp: auditRecord.timestamp || auditRecord.createdAt,
    actor: auditRecord.actor,
    tenant: auditRecord.tenantId,
    action: auditRecord.action,
    resource: auditRecord.target || { type: "audit_ledger", id: auditRecord.eventId },
    result: {
      status: auditRecord.status || "SUCCESS",
      code: auditRecord.details?.status_code || null,
      message: auditRecord.details?.message || null,
    },
    requestId: auditRecord.details?.requestId || auditRecord.details?.request_id,
    riskContext: {
      severity: riskOverrides.severity || severity,
      quantum_risk_level: riskOverrides.quantum_risk_level || quantumRiskLevel,
      cvss_score: riskOverrides.cvss_score || auditRecord.details?.cvss || null,
      mosca_deadline_year: riskOverrides.mosca_deadline_year || auditRecord.details?.mosca_deadline || null,
      threat_category: riskOverrides.threat_category || auditRecord.category,
      policy_violated: auditRecord.details?.policy_pass === false || auditRecord.details?.cicd_pass === false,
      confidence: riskOverrides.confidence || 1.0,
    },
    metadata: auditRecord.details || {},
  });
}

module.exports = {
  SCHEMA_VERSION,
  buildSiemSecurityEvent,
  createSiemEvent: buildSiemSecurityEvent,
  createSiemEventFromAudit,
};
