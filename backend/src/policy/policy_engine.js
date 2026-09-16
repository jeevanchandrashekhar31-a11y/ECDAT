/**
 * ECDAT Enterprise Policy-as-Code Engine (Phase 11.1)
 *
 * Implements deterministic, schema-validated cryptographic policy evaluation supporting:
 * - algorithms
 * - key sizes
 * - protocols
 * - certificates
 * - PQC requirements
 * - environments
 * - applications
 * - business units
 * - exceptions
 * - deadlines
 *
 * Enforces defined precedence:
 * BLOCK > WARN > EXCEPTION > ALLOW
 *
 * Zero arbitrary code execution: Declarative evaluation only.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Ajv = require("ajv");
const { getRules, DEFAULT_RULES_DIR } = require("../risk_engine/rules_loader");

const DEFAULT_SCHEMA_PATH = path.join(
  DEFAULT_RULES_DIR,
  "schemas",
  "policy_as_code.schema.json",
);
const DEFAULT_POLICY_PATH = path.join(DEFAULT_RULES_DIR, "policy_as_code.json");

const PRECEDENCE_ORDER = Object.freeze({
  BLOCK: 1,
  WARN: 2,
  EXCEPTION: 3,
  ALLOW: 4,
});

class PolicyValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = "PolicyValidationError";
    this.errors = errors;
  }
}

/**
 * Normalizes ISO date strings into Date objects.
 */
function normalizeDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  try {
    let clean = String(val).trim();
    if (clean.length === 10) clean += "T00:00:00Z";
    const d = new Date(clean);
    return isNaN(d.getTime()) ? null : d;
  } catch (_e) {
    return null;
  }
}

/**
 * Checks if a string value matches any wildcard, regex, or exact match pattern.
 */
function matchesPatternOrSet(val, patterns) {
  if (!patterns || patterns.length === 0) return true;
  if (!val) return false;
  const valLower = String(val).trim().toLowerCase();

  for (const pat of patterns) {
    const patStr = String(pat).trim();
    if (patStr === "*") return true;
    if (patStr.toLowerCase() === valLower) return true;
    if (patStr.includes("*")) {
      const regexStr =
        "^" +
        patStr.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
        "$";
      if (new RegExp(regexStr, "i").test(valLower)) return true;
    } else if (valLower.includes(patStr.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function hasPrototypePollution(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(obj, "__proto__")) return true;
  if (
    Object.prototype.hasOwnProperty.call(obj, "constructor") &&
    typeof obj.constructor === "object"
  ) {
    return true;
  }
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (val && typeof val === "object") {
      if (hasPrototypePollution(val)) return true;
    }
  }
  return false;
}

class PolicyEngine {
  constructor(options = {}) {
    this.schemaPath = options.schemaPath || DEFAULT_SCHEMA_PATH;
    this.ajv = new Ajv({ allErrors: true, verbose: true });
    this._compiledValidator = this._compileSchema();
  }

  _compileSchema() {
    try {
      if (fs.existsSync(this.schemaPath)) {
        const schema = JSON.parse(fs.readFileSync(this.schemaPath, "utf-8"));
        return this.ajv.compile(schema);
      }
    } catch (_err) {
      // Fallback or schema compilation error handled during validate
    }
    return null;
  }

  /**
   * Validates a policy document against the JSON Schema.
   * Prevents arbitrary code injection & prototype pollution.
   */
  validatePolicy(policy) {
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      return { valid: false, errors: ["Policy must be a valid JSON object."] };
    }

    if (hasPrototypePollution(policy)) {
      return {
        valid: false,
        errors: ["Policy contains forbidden prototype properties."],
      };
    }

    if (this._compiledValidator) {
      const valid = this._compiledValidator(policy);
      if (!valid) {
        const errors = (this._compiledValidator.errors || []).map((e) => {
          const field = e.instancePath ? `Field '${e.instancePath}'` : "Root";
          return `${field} ${e.message}`;
        });
        return { valid: false, errors };
      }
    }

    const required = ["version", "id", "name", "rules"];
    const missing = required.filter((r) => !(r in policy));
    if (missing.length > 0) {
      return {
        valid: false,
        errors: [`Missing required policy fields: ${missing.join(", ")}`],
      };
    }

    return { valid: true, errors: [] };
  }

  /**
   * Loads and validates a policy from file path or object.
   */
  loadPolicy(policyOrPath) {
    let policy = policyOrPath;
    if (typeof policyOrPath === "string") {
      if (fs.existsSync(policyOrPath)) {
        policy = JSON.parse(fs.readFileSync(policyOrPath, "utf-8"));
      } else {
        try {
          policy = JSON.parse(policyOrPath);
        } catch (e) {
          throw new PolicyValidationError(
            `Failed to parse policy string or locate file: ${e.message}`,
          );
        }
      }
    } else if (!policyOrPath) {
      // Load from rules loader or default path
      try {
        const rules = getRules();
        if (rules && rules.policy_as_code) {
          policy = rules.policy_as_code;
        }
      } catch (_e) {
        if (fs.existsSync(DEFAULT_POLICY_PATH)) {
          policy = JSON.parse(fs.readFileSync(DEFAULT_POLICY_PATH, "utf-8"));
        }
      }
    }

    const validation = this.validatePolicy(policy);
    if (!validation.valid) {
      throw new PolicyValidationError(
        `Policy validation failed for '${policy?.id || "unknown"}': ${validation.errors.join("; ")}`,
        validation.errors,
      );
    }
    return policy;
  }

  /**
   * Normalizes findings, CBOM components, or raw asset records into a uniform representation.
   */
  normalizeAsset(rawAsset, defaultContext = {}) {
    const ctx = defaultContext || {};
    const assetId =
      rawAsset.asset_id ||
      rawAsset.id ||
      rawAsset["bom-ref"] ||
      rawAsset.name ||
      "asset-unknown";
    const assetName =
      rawAsset.name || rawAsset.algorithm || rawAsset.title || assetId;
    const assetType = (
      rawAsset.type ||
      rawAsset.asset_type ||
      "algorithm"
    ).toLowerCase();

    // Key size
    let keySize =
      rawAsset.key_size ?? rawAsset.keyLength ?? rawAsset.bits ?? null;
    if (keySize !== null) {
      const parsed = parseInt(keySize, 10);
      keySize = isNaN(parsed) ? null : parsed;
    }

    const curve =
      rawAsset.curve || rawAsset.elliptic_curve || rawAsset.curveName || null;

    // Protocols
    const protocol =
      rawAsset.protocol ||
      rawAsset.protocol_version ||
      rawAsset.tls_version ||
      null;
    const cipherSuite = rawAsset.cipher_suite || rawAsset.cipherSuite || null;

    // Certificates
    const certInfo =
      rawAsset.certificate || rawAsset.cryptoProperties?.certificate || {};
    const isSelfSigned = Boolean(
      rawAsset.is_self_signed ||
      certInfo.is_self_signed ||
      (rawAsset.issuer &&
        rawAsset.subject &&
        rawAsset.issuer === rawAsset.subject),
    );
    const validityDays =
      rawAsset.validity_days ?? certInfo.validity_days ?? null;
    const hasCtLogs = Boolean(
      rawAsset.has_ct_logs ?? certInfo.has_ct_logs ?? false,
    );
    const sigAlgo =
      rawAsset.signature_algorithm ||
      certInfo.signature_algorithm ||
      rawAsset.sig_algo ||
      null;

    // PQC & Quantum
    const pqcType = rawAsset.pqc_type || rawAsset.quantum_category;
    let isQuantumSafe = Boolean(
      rawAsset.is_quantum_safe ||
      rawAsset.quantum_safe ||
      ["pqc", "hybrid", "quantum_resistant"].includes(pqcType),
    );

    const algoUpper = String(rawAsset.algorithm || assetName).toUpperCase();
    if (!isQuantumSafe) {
      const qsPatterns = [
        "ML-KEM",
        "ML-DSA",
        "SLH-DSA",
        "FALCON",
        "SPHINCS",
        "KYBER",
        "DILITHIUM",
        "AES-256",
        "CHACHA20",
        "SHA-256",
        "SHA-384",
        "SHA-512",
        "SHA3",
      ];
      if (qsPatterns.some((p) => algoUpper.includes(p))) {
        isQuantumSafe = true;
      }
    }

    const isHybrid = Boolean(
      rawAsset.is_hybrid || pqcType === "hybrid" || false,
    );
    let moscaGap =
      rawAsset.mosca_gap_years ?? rawAsset.mosca?.gap_years ?? null;
    if (moscaGap !== null) {
      const parsedGap = parseFloat(moscaGap);
      moscaGap = isNaN(parsedGap) ? null : parsedGap;
    }

    // Scopes
    const env = (
      rawAsset.environment ||
      ctx.environment ||
      "production"
    ).toLowerCase();
    const app =
      rawAsset.application || rawAsset.app || ctx.application || "default-app";
    const bu =
      rawAsset.business_unit || rawAsset.bu || ctx.business_unit || "general";

    return {
      asset_id: String(assetId),
      name: String(assetName),
      asset_type: assetType,
      algorithm: algoUpper,
      key_size: keySize,
      curve: curve ? String(curve).toLowerCase() : null,
      protocol: protocol ? String(protocol) : null,
      cipher_suite: cipherSuite ? String(cipherSuite) : null,
      is_self_signed: isSelfSigned,
      validity_days: validityDays !== null ? parseInt(validityDays, 10) : null,
      has_ct_logs: hasCtLogs,
      signature_algorithm: sigAlgo ? String(sigAlgo) : null,
      is_quantum_safe: isQuantumSafe,
      is_hybrid: isHybrid,
      mosca_gap_years: moscaGap,
      environment: env,
      application: String(app),
      business_unit: String(bu),
      raw: rawAsset,
    };
  }

  _matchesScope(ruleOrExc, asset) {
    const scope = ruleOrExc.scope || ruleOrExc;

    // Environments
    let envs = scope.environments;
    if (!envs && scope.environment) envs = [scope.environment];
    if (envs && !matchesPatternOrSet(asset.environment, envs)) return false;

    // Applications
    let apps = scope.applications;
    if (!apps && scope.application) apps = [scope.application];
    if (apps && !matchesPatternOrSet(asset.application, apps)) return false;

    // Business units
    let bus = scope.business_units;
    if (!bus && scope.business_unit) bus = [scope.business_unit];
    if (bus && !matchesPatternOrSet(asset.business_unit, bus)) return false;

    // Asset types
    const types = scope.asset_types;
    if (types && !matchesPatternOrSet(asset.asset_type, types)) return false;

    return true;
  }

  _findMatchingException(rule, asset, exceptions, evalTime) {
    for (const exc of exceptions) {
      const ruleIdPat = exc.rule_id || "*";
      if (ruleIdPat !== "*" && ruleIdPat !== rule.id) continue;

      const assetIdPat = exc.asset_id || "*";
      if (
        assetIdPat !== "*" &&
        !matchesPatternOrSet(asset.asset_id, [assetIdPat])
      )
        continue;

      if (!this._matchesScope(exc, asset)) continue;

      const status = String(exc.status || "APPROVED").toUpperCase();
      if (status === "EXPIRED") {
        return {
          matchingExc: null,
          note: `Exception ${exc.id} has EXPIRED status`,
        };
      }
      if (status !== "APPROVED") continue;

      const validFrom = normalizeDate(exc.valid_from);
      const expiresAt = normalizeDate(exc.expires_at);

      if (validFrom && evalTime < validFrom) {
        return {
          matchingExc: null,
          note: `Exception ${exc.id} not yet valid (starts ${validFrom.toISOString()})`,
        };
      }

      if (expiresAt && evalTime > expiresAt) {
        return {
          matchingExc: null,
          note: `Exception ${exc.id} EXPIRED on ${expiresAt.toISOString()}`,
        };
      }

      return { matchingExc: exc, note: null };
    }
    return { matchingExc: null, note: null };
  }

  evaluateRuleOnAsset(rule, asset, evalTime) {
    if (!this._matchesScope(rule, asset)) return null;

    const violations = [];
    const algo = asset.algorithm;
    const keySize = asset.key_size;

    // 1. Algorithms
    if (rule.algorithms) {
      const algRule = rule.algorithms;
      const prohibited = (algRule.prohibited || []).map((p) => p.toUpperCase());
      for (const p of prohibited) {
        if (p === algo || algo.includes(p)) {
          violations.push(`Algorithm '${algo}' is prohibited by policy`);
          break;
        }
      }

      const allowed = (algRule.allowed || []).map((a) => a.toUpperCase());
      if (
        allowed.length > 0 &&
        !allowed.some((a) => a === algo || algo.includes(a))
      ) {
        violations.push(`Algorithm '${algo}' is not in allowed algorithm list`);
      }

      if (algRule.require_quantum_resistant && !asset.is_quantum_safe) {
        violations.push(
          `Algorithm '${algo}' is classical and policy requires quantum resistance`,
        );
      }
    }

    // 2. Key Sizes
    if (rule.key_sizes) {
      const ksRule = rule.key_sizes;
      if (
        (algo.includes("RSA") ||
          ["key", "asymmetric_key", "certificate"].includes(
            asset.asset_type,
          )) &&
        keySize !== null
      ) {
        const minRsa = ksRule.min_rsa_bits;
        if (minRsa && algo.includes("RSA") && keySize < minRsa) {
          violations.push(
            `RSA key size ${keySize} bits is below minimum required ${minRsa} bits`,
          );
        }
      }

      if (
        (algo.includes("ECC") ||
          algo.includes("ECDSA") ||
          algo.includes("ECDH")) &&
        keySize !== null
      ) {
        const minEcc = ksRule.min_ecc_bits;
        if (minEcc && keySize < minEcc) {
          violations.push(
            `ECC key size ${keySize} bits is below minimum required ${minEcc} bits`,
          );
        }
      }

      if (
        (algo.includes("DH") || algo.includes("DIFFIE")) &&
        keySize !== null
      ) {
        const minDh = ksRule.min_dh_bits;
        if (minDh && keySize < minDh) {
          violations.push(
            `Diffie-Hellman key size ${keySize} bits is below minimum required ${minDh} bits`,
          );
        }
      }

      if (
        (algo.includes("AES") || algo.includes("CHACHA")) &&
        keySize !== null
      ) {
        const minSym = ksRule.min_symmetric_bits;
        if (minSym && keySize < minSym) {
          violations.push(
            `Symmetric key size ${keySize} bits is below minimum required ${minSym} bits`,
          );
        }
      }

      if (asset.curve) {
        const allowedCurves = (ksRule.allowed_curves || []).map((c) =>
          c.toLowerCase(),
        );
        if (allowedCurves.length > 0 && !allowedCurves.includes(asset.curve)) {
          violations.push(
            `Curve '${asset.curve}' is not in approved curve list`,
          );
        }

        const prohibitedCurves = (ksRule.prohibited_curves || []).map((c) =>
          c.toLowerCase(),
        );
        if (
          prohibitedCurves.length > 0 &&
          prohibitedCurves.includes(asset.curve)
        ) {
          violations.push(`Curve '${asset.curve}' is prohibited by policy`);
        }
      }
    }

    // 3. Protocols
    if (rule.protocols) {
      const protoRule = rule.protocols;
      const proto = asset.protocol;
      if (proto) {
        const prohibitedVersions = protoRule.prohibited_versions || [];
        for (const pv of prohibitedVersions) {
          if (
            pv.toLowerCase() === proto.toLowerCase() ||
            proto.toLowerCase().includes(pv.toLowerCase())
          ) {
            violations.push(`Protocol '${proto}' is deprecated and prohibited`);
            break;
          }
        }

        const allowedVersions = protoRule.allowed_versions || [];
        if (
          allowedVersions.length > 0 &&
          !allowedVersions.some((av) =>
            proto.toLowerCase().includes(av.toLowerCase()),
          )
        ) {
          violations.push(`Protocol '${proto}' is not in allowed protocols`);
        }
      }

      const cipher = asset.cipher_suite;
      if (cipher) {
        const prohibitedCiphers = protoRule.prohibited_cipher_suites || [];
        for (const pc of prohibitedCiphers) {
          if (matchesPatternOrSet(cipher, [pc])) {
            violations.push(
              `Cipher suite '${cipher}' matches prohibited pattern '${pc}'`,
            );
            break;
          }
        }
      }
    }

    // 4. Certificates
    if (rule.certificates) {
      const certRule = rule.certificates;
      if (asset.is_self_signed && certRule.allow_self_signed === false) {
        violations.push(
          "Self-signed certificate is strictly prohibited in this environment",
        );
      }

      const maxDays = certRule.max_validity_days;
      if (maxDays && asset.validity_days && asset.validity_days > maxDays) {
        violations.push(
          `Certificate validity ${asset.validity_days} days exceeds maximum ${maxDays} days`,
        );
      }

      if (certRule.require_ct_logs && !asset.has_ct_logs) {
        violations.push(
          "Certificate Transparency (CT) logs are required but missing",
        );
      }

      const sig = asset.signature_algorithm;
      if (sig) {
        const prohSigs = (certRule.prohibited_signature_algorithms || []).map(
          (s) => s.toUpperCase(),
        );
        for (const ps of prohSigs) {
          if (sig.toUpperCase().includes(ps)) {
            violations.push(
              `Certificate signature algorithm '${sig}' is prohibited`,
            );
            break;
          }
        }
      }
    }

    // 5. PQC Requirements
    if (rule.pqc_requirements) {
      const pqcRule = rule.pqc_requirements;
      if (pqcRule.require_pqc && !asset.is_quantum_safe) {
        violations.push(
          "Asset lacks required Post-Quantum Cryptographic protection",
        );
      }

      if (
        pqcRule.require_hybrid &&
        !asset.is_hybrid &&
        ["key_exchange", "protocol", "kex", "key_establishment"].includes(
          asset.asset_type,
        )
      ) {
        violations.push(
          "Policy requires hybrid classical + post-quantum key exchange",
        );
      }

      const maxGap = pqcRule.max_mosca_gap_years;
      if (
        typeof maxGap === "number" &&
        typeof asset.mosca_gap_years === "number"
      ) {
        if (asset.mosca_gap_years > maxGap) {
          violations.push(
            `Mosca quantum deficit gap (${asset.mosca_gap_years.toFixed(1)} years) exceeds policy threshold (${maxGap.toFixed(1)} years)`,
          );
        }
      }
    }

    if (violations.length === 0) return null;

    let rawAction = (rule.action || "BLOCK").toUpperCase();
    if (rule.deadlines) {
      const depDate = normalizeDate(rule.deadlines.deprecation_date);
      const enfDate = normalizeDate(rule.deadlines.enforcement_date);

      if (depDate && evalTime < depDate) {
        rawAction = "WARN";
      } else if (enfDate && evalTime >= enfDate) {
        rawAction = "BLOCK";
      }
    }

    return {
      rule_id: rule.id,
      rule_name: rule.name,
      category: rule.category,
      action: rawAction,
      severity: rule.severity || "HIGH",
      remediation_guidance: rule.remediation_guidance || "",
      reasons: violations,
    };
  }

  /**
   * Deterministically evaluates assets or CBOM components against policy.
   */
  evaluate(assetsOrCbom, context = {}, policy = null) {
    const ctx = context || {};
    const evalTime = normalizeDate(ctx.evaluation_date) || new Date();
    const activePolicy = this.loadPolicy(policy);

    const rules = [...(activePolicy.rules || [])].sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    );
    const exceptions = [...(activePolicy.exceptions || [])].sort((a, b) =>
      String(a.id).localeCompare(String(b.id)),
    );

    // Extract list
    let rawList = [];
    if (Array.isArray(assetsOrCbom)) {
      rawList = assetsOrCbom;
    } else if (assetsOrCbom && typeof assetsOrCbom === "object") {
      if (Array.isArray(assetsOrCbom.components))
        rawList = assetsOrCbom.components;
      else if (Array.isArray(assetsOrCbom.findings))
        rawList = assetsOrCbom.findings;
      else if (Array.isArray(assetsOrCbom.assets))
        rawList = assetsOrCbom.assets;
      else rawList = [assetsOrCbom];
    }

    const normalizedAssets = rawList
      .map((a) => this.normalizeAsset(a, ctx))
      .sort((a, b) => String(a.asset_id).localeCompare(String(b.asset_id)));

    const evaluatedAssets = [];
    const ruleEvaluations = [];
    const appliedExceptions = [];
    const expiredExceptions = [];
    const overallVerdicts = [];

    for (const asset of normalizedAssets) {
      const assetRuleResults = [];

      for (const rule of rules) {
        const violation = this.evaluateRuleOnAsset(rule, asset, evalTime);
        if (!violation) continue;

        const rawAction = violation.action;
        const { matchingExc, note } = this._findMatchingException(
          rule,
          asset,
          exceptions,
          evalTime,
        );

        let finalAction = rawAction;
        if (matchingExc) {
          finalAction = "EXCEPTION";
          const excRecord = {
            exception_id: matchingExc.id,
            rule_id: rule.id,
            asset_id: asset.asset_id,
            reason: matchingExc.reason,
            approved_by: matchingExc.approved_by,
            expires_at: matchingExc.expires_at,
            compensating_controls: matchingExc.compensating_controls || [],
          };
          if (
            !appliedExceptions.some(
              (e) =>
                e.exception_id === excRecord.exception_id &&
                e.rule_id === excRecord.rule_id &&
                e.asset_id === excRecord.asset_id,
            )
          ) {
            appliedExceptions.push(excRecord);
          }
        } else if (note && note.includes("EXPIRED")) {
          expiredExceptions.push({
            rule_id: rule.id,
            asset_id: asset.asset_id,
            note,
          });
        }

        const ruleRecord = {
          rule_id: rule.id,
          rule_name: rule.name,
          category: rule.category,
          raw_action: rawAction,
          final_action: finalAction,
          severity: violation.severity,
          reasons: violation.reasons,
          remediation: violation.remediation_guidance,
          exception_applied: matchingExc ? matchingExc.id : null,
        };
        assetRuleResults.push(ruleRecord);
        ruleEvaluations.push({ asset_id: asset.asset_id, ...ruleRecord });
      }

      // Precedence: BLOCK > WARN > EXCEPTION > ALLOW
      let assetVerdict = "ALLOW";
      if (assetRuleResults.some((r) => r.final_action === "BLOCK")) {
        assetVerdict = "BLOCK";
      } else if (assetRuleResults.some((r) => r.final_action === "WARN")) {
        assetVerdict = "WARN";
      } else if (assetRuleResults.some((r) => r.final_action === "EXCEPTION")) {
        assetVerdict = "EXCEPTION";
      }

      overallVerdicts.push(assetVerdict);
      evaluatedAssets.push({
        asset_id: asset.asset_id,
        name: asset.name,
        verdict: assetVerdict,
        environment: asset.environment,
        application: asset.application,
        business_unit: asset.business_unit,
        violations_count: assetRuleResults.length,
        rule_results: assetRuleResults,
      });
    }

    // Evaluation-level precedence: BLOCK > WARN > EXCEPTION > ALLOW
    let policyVerdict = "ALLOW";
    if (overallVerdicts.includes("BLOCK")) {
      policyVerdict = "BLOCK";
    } else if (overallVerdicts.includes("WARN")) {
      policyVerdict = "WARN";
    } else if (overallVerdicts.includes("EXCEPTION")) {
      policyVerdict = "EXCEPTION";
    }

    let passed = policyVerdict !== "BLOCK";
    if (ctx.fail_on_warn && policyVerdict === "WARN") {
      passed = false;
    }

    const blockCount = overallVerdicts.filter((v) => v === "BLOCK").length;
    const warnCount = overallVerdicts.filter((v) => v === "WARN").length;
    const exceptionCount = overallVerdicts.filter(
      (v) => v === "EXCEPTION",
    ).length;
    const allowCount = overallVerdicts.filter((v) => v === "ALLOW").length;

    // Deterministic SHA-256 Audit Digest
    const canonicalSummary = {
      policy_id: activePolicy.id,
      policy_version: activePolicy.version,
      evaluation_time: evalTime.toISOString(),
      total_assets: evaluatedAssets.length,
      verdict: policyVerdict,
      block_count: blockCount,
      warn_count: warnCount,
      exception_count: exceptionCount,
      allow_count: allowCount,
      asset_verdicts: evaluatedAssets
        .map((a) => `${a.asset_id}=${a.verdict}`)
        .sort(),
    };
    const digest = crypto
      .createHash("sha256")
      .update(JSON.stringify(canonicalSummary))
      .digest("hex");

    return {
      policy_id: activePolicy.id,
      policy_name: activePolicy.name,
      policy_version: activePolicy.version,
      evaluation_timestamp: evalTime.toISOString(),
      verdict: policyVerdict,
      passed,
      metrics: {
        total_assets_evaluated: evaluatedAssets.length,
        total_rules_evaluated: rules.length,
        total_violations_found: ruleEvaluations.length,
        counts_by_verdict: {
          BLOCK: blockCount,
          WARN: warnCount,
          EXCEPTION: exceptionCount,
          ALLOW: allowCount,
        },
      },
      assets: evaluatedAssets,
      applied_exceptions: appliedExceptions,
      expired_exceptions: expiredExceptions,
      audit_digest: digest,
    };
  }
}

module.exports = {
  PolicyEngine,
  PolicyValidationError,
  DEFAULT_SCHEMA_PATH,
  DEFAULT_POLICY_PATH,
  PRECEDENCE_ORDER,
};
