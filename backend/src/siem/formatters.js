/**
 * ECDAT SIEM Integration Subsystem — Phase 18.2 Multi-Format Serializers
 *
 * Implements standard serializations for SIEM platforms:
 * 1. JSON (ECS / Elastic / Splunk / CloudWatch standard)
 * 2. CEF (ArcSight / QRadar / AlienVault Common Event Format)
 * 3. Syslog (RFC 5424 structured syslog)
 */

const SEVERITY_TO_CEF_LEVEL = {
  CRITICAL: 10,
  HIGH: 8,
  MEDIUM: 5,
  LOW: 2,
  INFORMATIONAL: 1,
};

/**
 * Serializes a SIEM event to ECS-compatible standard JSON.
 *
 * @param {object} event
 * @returns {string} Formatted JSON string
 */
function formatJson(event) {
  return JSON.stringify({
    "@timestamp": event.timestamp,
    ecs: { version: "8.11.0" },
    event: {
      id: event.event_id,
      action: event.action,
      outcome: event.result?.status === "SUCCESS" ? "success" : "failure",
      severity: SEVERITY_TO_CEF_LEVEL[event.risk_context?.severity] || 1,
      risk_score: event.risk_context?.cvss_score || null,
    },
    user: {
      id: event.actor?.id,
      name: event.actor?.username,
      roles: [event.actor?.role],
    },
    client: {
      ip: event.actor?.ip_address,
      user_agent: { original: event.actor?.user_agent },
    },
    service: {
      name: "ecdat-discovery-engine",
      version: event.version,
    },
    tenant: {
      id: event.tenant?.id,
      name: event.tenant?.name,
    },
    trace: {
      id: event.request_id,
    },
    labels: {
      quantum_risk_level: event.risk_context?.quantum_risk_level,
      threat_category: event.risk_context?.threat_category,
      resource_type: event.resource?.type,
      resource_id: event.resource?.id,
    },
    ecdat: {
      result_code: event.result?.code,
      result_message: event.result?.message,
      quantum_deadline_year: event.risk_context?.mosca_deadline_year,
      policy_violated: event.risk_context?.policy_violated,
      confidence: event.risk_context?.confidence,
      signature: event.signature,
      metadata: event.metadata,
    },
  });
}

/**
 * Escapes characters for CEF headers and extension values.
 */
function escapeCefHeader(str) {
  if (!str) return "";
  return String(str).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function escapeCefValue(str) {
  if (!str) return "";
  return String(str).replace(/\\/g, "\\\\").replace(/=/g, "\\=").replace(/\n/g, "\\n");
}

/**
 * Serializes a SIEM event to ArcSight/QRadar Common Event Format (CEF:0).
 * Format:
 * CEF:Version|Device Vendor|Device Product|Device Version|Device Event Class ID|Name|Severity|[Extension]
 *
 * @param {object} event
 * @returns {string} CEF formatted line
 */
function formatCef(event) {
  const version = "0";
  const vendor = "ECDAT";
  const product = "CryptographicDiscovery";
  const devVersion = event.version || "1.0.0";
  const eventClassId = escapeCefHeader(event.action || "SECURITY_EVENT");
  const name = escapeCefHeader(event.result?.message || event.action);
  const severity = SEVERITY_TO_CEF_LEVEL[event.risk_context?.severity] || 1;

  // Build key-value extensions
  const extensions = [
    `externalId=${escapeCefValue(event.event_id)}`,
    `rt=${Date.parse(event.timestamp) || Date.now()}`,
    `suser=${escapeCefValue(event.actor?.username)}`,
    `cs1=${escapeCefValue(event.tenant?.id)}`,
    `cs1Label=TenantId`,
    `cs2=${escapeCefValue(event.resource?.type)}`,
    `cs2Label=ResourceType`,
    `cs3=${escapeCefValue(event.resource?.id)}`,
    `cs3Label=ResourceId`,
    `cs4=${escapeCefValue(event.risk_context?.quantum_risk_level)}`,
    `cs4Label=QuantumRiskLevel`,
    `cs5=${escapeCefValue(event.risk_context?.threat_category)}`,
    `cs5Label=ThreatCategory`,
    `outcome=${escapeCefValue(event.result?.status)}`,
    `request=${escapeCefValue(event.request_id)}`,
    `act=${escapeCefValue(event.action)}`,
  ];

  if (event.actor?.ip_address) {
    extensions.push(`src=${escapeCefValue(event.actor.ip_address)}`);
  }
  if (event.risk_context?.cvss_score !== null && event.risk_context?.cvss_score !== undefined) {
    extensions.push(`cn1=${event.risk_context.cvss_score}`);
    extensions.push(`cn1Label=CVSSScore`);
  }
  if (event.signature) {
    extensions.push(`cs6=${escapeCefValue(event.signature)}`);
    extensions.push(`cs6Label=Signature`);
  }

  return `CEF:${version}|${vendor}|${product}|${devVersion}|${eventClassId}|${name}|${severity}|${extensions.join(" ")}`;
}

/**
 * Serializes a SIEM event to RFC 5424 Structured Syslog format.
 * Format:
 * <PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [STRUCTURED-DATA] MSG
 *
 * @param {object} event
 * @param {string} [hostname="ecdat-server"]
 * @returns {string} Syslog line
 */
function formatSyslog(event, hostname = "ecdat-server") {
  // Facility: 10 (security/auth), Severity: 1-6
  const facility = 10;
  let syslogSeverity = 6; // info
  if (event.risk_context?.severity === "CRITICAL") syslogSeverity = 2; // crit
  else if (event.risk_context?.severity === "HIGH") syslogSeverity = 3; // err
  else if (event.risk_context?.severity === "MEDIUM") syslogSeverity = 4; // warning
  else if (event.risk_context?.severity === "LOW") syslogSeverity = 5; // notice

  const pri = facility * 8 + syslogSeverity;
  const timestamp = event.timestamp || new Date().toISOString();
  const appName = "ecdat-scanner";
  const procId = process.pid || "1";
  const msgId = event.action ? event.action.slice(0, 32) : "SEC_EVT";

  const structuredData = `[meta@54321 action="${event.action}" eventId="${event.event_id}" tenant="${event.tenant?.id}" actor="${event.actor?.username}" status="${event.result?.status}" severity="${event.risk_context?.severity}" requestId="${event.request_id}"]`;
  const message = event.result?.message ? event.result.message.replace(/[\r\n]+/g, " ") : event.action;

  return `<${pri}>1 ${timestamp} ${hostname} ${appName} ${procId} ${msgId} ${structuredData} ${message}`;
}

/**
 * Formats a SIEM event according to the requested format type.
 *
 * @param {object} event
 * @param {string} [format="json"] - "json" | "cef" | "syslog"
 * @returns {string}
 */
function formatEvent(event, format = "json") {
  const norm = String(format).toLowerCase().trim();
  switch (norm) {
    case "cef":
      return formatCef(event);
    case "syslog":
      return formatSyslog(event);
    case "json":
    default:
      return formatJson(event);
  }
}

module.exports = {
  formatJson,
  formatCef,
  formatSyslog,
  formatSyslogRfc5424: formatSyslog,
  formatEvent,
  SEVERITY_TO_CEF_LEVEL,
};
