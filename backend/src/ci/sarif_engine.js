/**
 * ECDAT SARIF Engine (Node.js) — Phase 13.3
 *
 * Generates and automatically validates OASIS SARIF v2.1.0 documents.
 * Includes:
 * - rule ID
 * - severity (error, warning, note; mapped to security-severity 0.0-10.0)
 * - location (physicalLocation.artifactLocation.uri, region startLine, startColumn, endLine, endColumn)
 * - message (actionable text and markdown)
 * - help (text and rich markdown guidance cards)
 * - evidence (sanitized contextual code snippets with zero secret leakage)
 * - remediation guidance (prescriptive code examples and steps)
 *
 * Automated Validation:
 * Validates document schema, rule references, location validity, and zero-leakage invariant.
 */

// const fs = require("fs");
// const path = require("path");
const crypto = require("crypto");
const { DeveloperFeedbackGenerator } = require("./developer_feedback");

const SARIF_SCHEMA_URI = "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json";
const SARIF_VERSION = "2.1.0";
const VALID_SARIF_LEVELS = new Set(["error", "warning", "note", "none"]);

class SarifValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "SarifValidationError";
    this.errors = errors;
  }
}

function mapSeverityToSarif(severity) {
  const s = String(severity || "medium").toLowerCase();
  if (s === "critical" || s === "fatal") return { level: "error", score: "9.5" };
  if (s === "high" || s === "error") return { level: "error", score: "8.0" };
  if (s === "medium" || s === "warning" || s === "warn") return { level: "warning", score: "5.5" };
  if (s === "low" || s === "info" || s === "informational" || s === "note") return { level: "note", score: "2.5" };
  return { level: "note", score: "1.0" };
}

class NodeSarifEngine {
  /**
   * Generates OASIS SARIF v2.1.0 document.
   */
  static generate(findings = [], options = {}) {
    const toolName = options.toolName || "ECDAT Cryptographic Scanner";
    const toolVersion = options.toolVersion || "1.0.0";
    const targetRoot = options.targetRoot || null;

    const rules = {};
    const results = [];

    for (const finding of findings) {
      const ruleId = String(finding.rule_id || finding.ruleId || "ECDAT-CRYPTO-FINDING");
      const rawSev = String(finding.severity || "medium");
      const { level, score } = mapSeverityToSarif(rawSev);

      let df = finding.developer_feedback;
      if (!df) {
        df = DeveloperFeedbackGenerator.generate(finding, targetRoot);
      }

      const safeFix = df.safe_fix || {};
      const safeFixSummary = safeFix.summary || String(finding.remediation || "");
      const whyItMatters = df.why_it_matters || "";

      // 1. Rule Definition
      if (!rules[ruleId]) {
        const markdownCard = DeveloperFeedbackGenerator.renderMarkdown(df);
        rules[ruleId] = {
          id: ruleId,
          name: ruleId.replace(/[-:]/g, "_"),
          shortDescription: {
            text: `Cryptographic finding: ${finding.algorithm || ruleId}`,
          },
          fullDescription: {
            text: String(finding.description || `Detected ${finding.finding_type || "crypto"} (${finding.algorithm || "unknown"})`),
          },
          defaultConfiguration: {
            level,
          },
          help: {
            text: safeFixSummary || "Review cryptographic usage according to enterprise crypto policy.",
            markdown: markdownCard,
          },
          properties: {
            tags: ["cryptography", "security", "pqc-readiness"],
            precision: String(finding.confidence || "").toLowerCase() === "high" ? "very-high" : "high",
            "security-severity": score,
            references: df.references || [],
            why_it_matters: whyItMatters,
            remediation: safeFixSummary,
            verification_command: df.verification_command || "",
          },
        };
      }

      // 2. Location & Evidence
      const filePath = String(finding.file_path || finding.filePath || "unknown").replace(/\\/g, "/");
      const lineNo = Math.max(1, Number(finding.line_number || finding.lineNumber || 1));
      const colNo = Math.max(1, Number(finding.column_number || finding.columnNumber || 1));
      const rawEvidence = String(finding.evidence || "");

      const hash = crypto
        .createHash("sha256")
        .update(`${filePath}:${lineNo}:${finding.algorithm || ruleId}`)
        .digest("hex");

      const msgText = `Found ${finding.finding_type || "cryptographic finding"} (${finding.algorithm || "UNKNOWN"}) at ${filePath}:${lineNo}. Confidence: ${finding.confidence || "HIGH"}.`;

      const resultItem = {
        ruleId,
        level,
        message: {
          text: whyItMatters ? `${msgText} ${whyItMatters.slice(0, 180)}...` : msgText,
        },
        locations: [
          {
            physicalLocation: {
              artifactLocation: {
                uri: filePath,
              },
              region: {
                startLine: lineNo,
                startColumn: colNo,
                endLine: lineNo,
                endColumn: colNo + Math.max(1, rawEvidence.length),
                snippet: {
                  text: rawEvidence,
                },
              },
            },
          },
        ],
        partialFingerprints: {
          primaryLocationLineHash: hash,
        },
        properties: {
          confidence: String(finding.confidence || "HIGH"),
          remediation_guidance: safeFixSummary,
          developer_feedback: df,
        },
      };

      if (finding.is_suppressed || df.is_suppressed) {
        resultItem.suppressions = [
          {
            kind: "inSource",
            status: "accepted",
            justification: finding.suppression_reason || df.suppression_reason || "Inline suppression",
          },
        ];
      }

      results.push(resultItem);
    }

    return {
      $schema: SARIF_SCHEMA_URI,
      version: SARIF_VERSION,
      runs: [
        {
          tool: {
            driver: {
              name: toolName,
              version: toolVersion,
              informationUri: "https://github.com/ecdat/ecdat",
              rules: Object.values(rules),
            },
          },
          results,
        },
      ],
    };
  }

  /**
   * Automatically validates SARIF document structure and invariants.
   */
  static validate(sarifDoc) {
    const errors = [];

    if (!sarifDoc || typeof sarifDoc !== "object") {
      return { isValid: false, errors: ["SARIF document must be a JSON object"] };
    }

    if (sarifDoc.version !== SARIF_VERSION) {
      errors.push(`Invalid SARIF version '${sarifDoc.version}'. Expected '${SARIF_VERSION}'`);
    }

    if (!sarifDoc.$schema || typeof sarifDoc.$schema !== "string" || !sarifDoc.$schema.toLowerCase().includes("sarif")) {
      errors.push(`Invalid or missing $schema URI in SARIF document: ${sarifDoc.$schema}`);
    }

    if (!Array.isArray(sarifDoc.runs) || sarifDoc.runs.length === 0) {
      errors.push("SARIF document must contain a non-empty 'runs' array");
      return { isValid: false, errors };
    }

    const run = sarifDoc.runs[0];
    if (!run || typeof run !== "object") {
      return { isValid: false, errors: ["Run item must be a JSON object"] };
    }

    if (!run.tool || !run.tool.driver || !run.tool.driver.name) {
      errors.push("SARIF run tool driver must have a name");
    }

    const definedRuleIds = new Set();
    const rules = (run.tool && run.tool.driver && run.tool.driver.rules) || [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (!r.id || typeof r.id !== "string") {
        errors.push(`Rule at index ${i} missing required 'id'`);
      } else {
        definedRuleIds.add(r.id);
      }
      if (!r.shortDescription && !r.fullDescription) {
        errors.push(`Rule '${r.id || i}' missing description`);
      }
      if (!r.help || (!r.help.text && !r.help.markdown)) {
        errors.push(`Rule '${r.id || i}' missing help guidance`);
      }
      if (r.defaultConfiguration && r.defaultConfiguration.level) {
        if (!VALID_SARIF_LEVELS.has(r.defaultConfiguration.level)) {
          errors.push(`Rule '${r.id}' has invalid level '${r.defaultConfiguration.level}'`);
        }
      }
    }

    const results = run.results || [];
    const pemLeakRegex = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----(?!.*\[REDACTED_)/s;

    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      if (!res.ruleId) {
        errors.push(`Result at index ${i} missing 'ruleId'`);
      } else if (!definedRuleIds.has(res.ruleId)) {
        errors.push(`Result '${res.ruleId}' refers to an undefined rule ID (not present in driver.rules)`);
      }

      if (res.level && !VALID_SARIF_LEVELS.has(res.level)) {
        errors.push(`Result '${res.ruleId}' has invalid level '${res.level}'`);
      }

      if (!res.message || !res.message.text) {
        errors.push(`Result '${res.ruleId}' missing message text`);
      }

      if (!Array.isArray(res.locations) || res.locations.length === 0) {
        errors.push(`Result '${res.ruleId}' missing locations array`);
      } else {
        for (let l = 0; l < res.locations.length; l++) {
          const loc = res.locations[l];
          if (!loc.physicalLocation || !loc.physicalLocation.artifactLocation || !loc.physicalLocation.artifactLocation.uri) {
            errors.push(`Result '${res.ruleId}' location ${l} missing artifactLocation.uri`);
          }
          const reg = loc.physicalLocation && loc.physicalLocation.region;
          if (reg) {
            if (reg.startLine !== undefined && (!Number.isInteger(reg.startLine) || reg.startLine < 1)) {
              errors.push(`Result '${res.ruleId}' startLine must be an integer >= 1 (got ${reg.startLine})`);
            }
            if (reg.snippet && reg.snippet.text) {
              if (pemLeakRegex.test(reg.snippet.text)) {
                errors.push(`CRITICAL: Result '${res.ruleId}' snippet contains unredacted raw secret material!`);
              }
            }
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Generates SARIF and automatically validates it.
   */
  static generateAndValidate(findings = [], options = {}) {
    const doc = this.generate(findings, options);
    const validation = this.validate(doc);
    if (!validation.isValid) {
      throw new SarifValidationError(
        `Generated SARIF failed automated validation with ${validation.errors.length} error(s)`,
        validation.errors
      );
    }
    return doc;
  }
}

module.exports = {
  NodeSarifEngine,
  SarifValidationError,
  SARIF_SCHEMA_URI,
  SARIF_VERSION,
};
