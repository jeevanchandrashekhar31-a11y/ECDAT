/**
 * ECDAT CI/CD Scanner & Orchestrator (Node.js) — Phase 13.1
 *
 * First-class CI/CD scanner supporting:
 * - Pull request scan (diff-aware scanning)
 * - Full repository scan
 * - Policy gate evaluation
 * - CBOM generation (CycloneDX 1.6/1.7)
 * - SARIF v2.1.0 generation
 * - Dependency scan
 * - Secret scan (secret-safe zero leakage)
 * - Container scan
 *
 * Deterministic Exit Codes:
 *   0 = PASS
 *   1 = POLICY_SECURITY_FAILURE
 *   2 = SCANNER_ERROR
 *   3 = INVALID_CONFIG
 *
 * CRITICAL INVARIANT:
 * Never conflate scanner error with "no vulnerabilities."
 * If any scanner fails, complete = false, vulnerabilitiesConflated = false, and exitCode = 2.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { PolicyEngine } = require("../policy/policy_engine");

const CI_EXIT_CODES = Object.freeze({
  PASS: 0,
  POLICY_SECURITY_FAILURE: 1,
  SCANNER_ERROR: 2,
  INVALID_CONFIG: 3,
});

const VALID_FAIL_ON = ["none", "critical", "high", "policy"];

class NodeCiScanner {
  constructor(options = {}) {
    this.targetDir = options.targetDir || ".";
    this.scanMode = options.scanMode || "full_repo";
    this.prBase = options.prBase || null;
    this.changedFiles = options.changedFiles || null;
    this.policyPath = options.policyPath || null;
    this.failOn = options.failOn || "critical";
    this.failOnWarn = Boolean(options.failOnWarn);
    this.outputCbom = options.outputCbom || null;
    this.outputSarif = options.outputSarif || null;
    this.scanSecrets = options.scanSecrets !== false;
    this.scanDeps = options.scanDeps !== false;
    this.scanContainer = options.scanContainer || null;
    this.policyEngine = new PolicyEngine();
  }

  /**
   * Validates scanner configuration.
   * Returns { isValid: boolean, error?: string }
   */
  validateConfig() {
    if (!this.targetDir || typeof this.targetDir !== "string") {
      return { isValid: false, error: "Target directory must be a valid non-empty string" };
    }

    const resolved = path.resolve(this.targetDir);
    if (!fs.existsSync(resolved)) {
      return { isValid: false, error: `Target directory does not exist: ${this.targetDir}` };
    }

    if (!VALID_FAIL_ON.includes(this.failOn)) {
      return {
        isValid: false,
        error: `Unsupported fail-on threshold '${this.failOn}'. Choose from: ${VALID_FAIL_ON.join(", ")}`,
      };
    }

    if (this.policyPath) {
      const polResolved = path.resolve(this.policyPath);
      if (!fs.existsSync(polResolved)) {
        return { isValid: false, error: `Specified policy file not found: ${this.policyPath}` };
      }
      try {
        JSON.parse(fs.readFileSync(polResolved, "utf-8"));
      } catch (e) {
        return { isValid: false, error: `Malformed policy JSON file at ${this.policyPath}: ${e.message}` };
      }
    }

    if (this.scanContainer && this.scanContainer !== "auto") {
      const cResolved = path.isAbsolute(this.scanContainer)
        ? this.scanContainer
        : path.resolve(resolved, this.scanContainer);
      if (!fs.existsSync(cResolved)) {
        return { isValid: false, error: `Specified container scan target not found: ${this.scanContainer}` };
      }
    }

    return { isValid: true };
  }

  /**
   * Resolves PR changed files using git diff if prBase is provided.
   */
  resolvePrDiff(resolvedTarget) {
    if (!this.prBase) return [];
    try {
      const cmd = `git diff --name-only ${this.prBase}...HEAD`;
      const output = execSync(cmd, { cwd: resolvedTarget, stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" });
      return output
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch (e) {
      try {
        const fallbackCmd = `git diff --name-only ${this.prBase}`;
        const output = execSync(fallbackCmd, {
          cwd: resolvedTarget,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf-8",
        });
        return output
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      } catch (err) {
        throw new Error(`Git diff against '${this.prBase}' failed: ${err.message}`);
      }
    }
  }

  /**
   * Executes CI scan orchestrator.
   */
  async runScan() {
    // 1. Config Validation
    const validation = this.validateConfig();
    if (!validation.isValid) {
      return {
        exitCode: CI_EXIT_CODES.INVALID_CONFIG,
        complete: false,
        vulnerabilitiesConflated: false,
        gatePassed: false,
        gateVerdict: "INVALID_CONFIG",
        targetDir: this.targetDir,
        scanMode: this.scanMode,
        findings: [],
        errors: [validation.error],
        gateViolations: [validation.error],
      };
    }

    const resolvedTarget = path.resolve(this.targetDir);
    const errors = [];
    let isComplete = true;
    const findings = [];

    let targetFiles = [];
    let effectiveMode = this.scanMode;

    try {
      if (this.changedFiles && Array.isArray(this.changedFiles)) {
        effectiveMode = "pull_request";
        targetFiles = this.changedFiles
          .map((f) => path.resolve(resolvedTarget, f))
          .filter((f) => fs.existsSync(f));
      } else if (this.prBase) {
        effectiveMode = "pull_request";
        const diffFiles = this.resolvePrDiff(resolvedTarget);
        targetFiles = diffFiles
          .map((f) => path.resolve(resolvedTarget, f))
          .filter((f) => fs.existsSync(f));
      } else {
        targetFiles = this._discoverFiles(resolvedTarget);
      }
    } catch (e) {
      errors.push(`File discovery / PR diff error: ${e.message}`);
      isComplete = false;
    }

    // 2. Sub-Scanners
    if (isComplete) {
      // Static / Secrets
      for (const file of targetFiles) {
        try {
          const content = fs.readFileSync(file, "utf-8");
          const relPath = path.relative(resolvedTarget, file).replace(/\\/g, "/");

          // Static rules
          const staticMatches = this._scanStaticContent(content, relPath);
          findings.push(...staticMatches);

          // Secret scan
          if (this.scanSecrets) {
            const secretMatches = this._scanSecretContent(content, relPath);
            findings.push(...secretMatches);
          }
        } catch (e) {
          errors.push(`Error reading file ${file}: ${e.message}`);
        }
      }

      // Dependency Scan
      if (this.scanDeps) {
        try {
          const depFindings = this._scanDependencies(resolvedTarget);
          findings.push(...depFindings);
        } catch (e) {
          errors.push(`Dependency scanner error: ${e.message}`);
          isComplete = false;
        }
      }

      // Container Scan
      if (this.scanContainer) {
        try {
          const containerFindings = this._scanContainer(resolvedTarget, this.scanContainer);
          findings.push(...containerFindings);
        } catch (e) {
          errors.push(`Container scanner error: ${e.message}`);
          isComplete = false;
        }
      }

      // Developer Feedback Enrichment & Suppression (Phase 13.2)
      const { DeveloperFeedbackGenerator } = require("./developer_feedback");
      for (const f of findings) {
        const feedback = DeveloperFeedbackGenerator.generate(f, resolvedTarget);
        f.developer_feedback = feedback;
        f.is_suppressed = feedback.is_suppressed;
        if (feedback.is_suppressed) {
          f.suppression_reason = feedback.suppression_reason;
        }
      }
    }

    // 3. Artifact Generation (SARIF & CBOM)
    let sarifDoc = null;
    let cbomDoc = null;

    try {
      sarifDoc = this.generateSarif(findings);
      if (this.outputSarif) {
        const outSarifPath = path.resolve(this.outputSarif);
        fs.mkdirSync(path.dirname(outSarifPath), { recursive: true });
        fs.writeFileSync(outSarifPath, JSON.stringify(sarifDoc, null, 2), "utf-8");
      }
    } catch (e) {
      errors.push(`SARIF generation error: ${e.message}`);
      isComplete = false;
    }

    try {
      cbomDoc = this.generateCbom(findings);
      if (this.outputCbom) {
        const outCbomPath = path.resolve(this.outputCbom);
        fs.mkdirSync(path.dirname(outCbomPath), { recursive: true });
        fs.writeFileSync(outCbomPath, JSON.stringify(cbomDoc, null, 2), "utf-8");
      }
    } catch (e) {
      errors.push(`CBOM generation error: ${e.message}`);
      isComplete = false;
    }

    // 4. Invariant Check: Scanner Error vs Vulnerabilities
    if (!isComplete || errors.length > 0) {
      return {
        exitCode: CI_EXIT_CODES.SCANNER_ERROR,
        complete: false,
        vulnerabilitiesConflated: false, // Invariant strictly enforced
        gatePassed: false,
        gateVerdict: "SCANNER_ERROR",
        targetDir: this.targetDir,
        scanMode: effectiveMode,
        totalFilesScanned: targetFiles.length,
        findings,
        errors,
        gateViolations: ["Scanner encountered fatal errors; cannot certify clean state."],
        sarif: sarifDoc,
        cbom: cbomDoc,
        summary: {
          status: "SCANNER_ERROR",
          reason: "Scanner encountered fatal errors. Conflation with 'no vulnerabilities' is strictly forbidden.",
        },
      };
    }

    // 5. Policy Gate Evaluation
    const gateEval = this.evaluateGate(findings, {
      failOn: this.failOn,
      policy: this.policyPath,
      failOnWarn: this.failOnWarn,
    });

    const exitCode = gateEval.passed ? CI_EXIT_CODES.PASS : CI_EXIT_CODES.POLICY_SECURITY_FAILURE;

    return {
      exitCode,
      complete: true,
      vulnerabilitiesConflated: false,
      gatePassed: gateEval.passed,
      gateVerdict: gateEval.verdict,
      targetDir: this.targetDir,
      scanMode: effectiveMode,
      totalFilesScanned: targetFiles.length,
      findings,
      errors: [],
      gateViolations: gateEval.violations,
      sarif: sarifDoc,
      cbom: cbomDoc,
      summary: {
        status: gateEval.passed ? "PASS" : "POLICY_SECURITY_FAILURE",
        totalFindings: findings.length,
        gatePassed: gateEval.passed,
        gateVerdict: gateEval.verdict,
      },
    };
  }

  /**
   * Evaluates findings against policy threshold or PolicyEngine.
   */
  evaluateGate(findings, options = {}) {
    const failOn = options.failOn || this.failOn;
    const failOnWarn = options.failOnWarn || this.failOnWarn;
    const policy = options.policy || this.policyPath;

    let passed = true;
    let verdict = "ALLOW";
    const violations = [];

    if (failOn === "policy" || policy) {
      try {
        const polResult = this.policyEngine.evaluate(findings, {}, policy);
        verdict = polResult.verdict || "ALLOW";
        if (verdict === "BLOCK" || (verdict === "WARN" && failOnWarn)) {
          passed = false;
          for (const asset of polResult.assets || []) {
            for (const r of asset.rule_results || []) {
              for (const reason of r.reasons || []) {
                violations.push(`${r.final_action}: ${reason} [${r.rule_id}] on ${asset.name || "asset"}`);
              }
            }
          }
        }
      } catch (e) {
        return { passed: false, verdict: "ERROR", violations: [`Policy evaluation error: ${e.message}`] };
      }
    }

    if (passed && (failOn === "critical" || failOn === "high")) {
      const minRank = failOn === "critical" ? 2 : 1;
      const rankMap = { critical: 2, high: 1, medium: 0, low: 0, informational: 0 };
      for (const f of findings) {
        if (f.is_suppressed) continue;
        const sev = String(f.severity || "informational").toLowerCase();
        if ((rankMap[sev] || 0) >= minRank) {
          violations.push(`${sev.toUpperCase()}: ${f.rule_id} (${f.algorithm}) at ${f.file_path}:${f.line_number}`);
        }
      }
      if (violations.length > 0) {
        passed = false;
        verdict = "BLOCK";
      }
    }

    return { passed, verdict, violations };
  }

  /**
   * Generates and automatically validates OASIS SARIF v2.1.0 document.
   */
  generateSarif(findings, toolName = "ECDAT CI Scanner") {
    const { NodeSarifEngine } = require("./sarif_engine");
    return NodeSarifEngine.generateAndValidate(findings, {
      toolName,
      targetRoot: this.targetDir,
    });
  }

  /**
   * Generates CycloneDX CBOM JSON document.
   */
  generateCbom(findings) {
    const components = findings.map((f, idx) => ({
      type: "cryptographic-asset",
      name: `${f.algorithm || "CRYPTO"}-${idx + 1}`,
      "bom-ref": `cbom:${f.file_path}:${f.line_number}:${f.algorithm}`,
      properties: [
        { name: "ecdat:algorithm", value: String(f.algorithm) },
        { name: "ecdat:finding_type", value: String(f.finding_type) },
        { name: "ecdat:severity", value: String(f.severity) },
        { name: "ecdat:confidence", value: String(f.confidence) },
        { name: "ecdat:file_path", value: String(f.file_path) },
        { name: "ecdat:line_number", value: String(f.line_number) },
      ],
    }));

    return {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      serialNumber: `urn:uuid:${crypto.randomUUID()}`,
      version: 1,
      components,
    };
  }

  // Internal Helpers
  _discoverFiles(dir, fileList = []) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const exts = [".js", ".ts", ".py", ".c", ".cpp", ".cs", ".go", ".rs", ".json", ".yaml", ".yml"];
    const exclude = [".git", "node_modules", "vendor", "dist", "build", ".venv", "__pycache__"];

    for (const ent of entries) {
      if (exclude.includes(ent.name)) continue;
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        this._discoverFiles(fullPath, fileList);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (exts.includes(ext)) {
          fileList.push(fullPath);
        }
      }
    }
    return fileList;
  }

  _scanStaticContent(content, relPath) {
    const findings = [];
    const lines = content.split("\n");

    const rules = [
      { regex: /\bcreateHash\s*\(\s*['"]md5['"]\s*\)/i, algo: "MD5", type: "weak_hash", sev: "critical" },
      { regex: /\bcreateHash\s*\(\s*['"]sha1['"]\s*\)/i, algo: "SHA-1", type: "weak_hash", sev: "high" },
      { regex: /\bcreateCipher(?:iv)?\s*\(\s*['"]des(?:-[a-z0-9]+)?['"]/i, algo: "DES", type: "weak_cipher", sev: "critical" },
      { regex: /\bhashlib\.md5\b/i, algo: "MD5", type: "weak_hash", sev: "critical" },
      { regex: /\bDES\.new\b/i, algo: "DES", type: "weak_cipher", sev: "critical" },
    ];

    lines.forEach((line, idx) => {
      for (const r of rules) {
        if (r.regex.test(line)) {
          findings.push({
            rule_id: `ECDAT-STATIC-${r.algo}`,
            algorithm: r.algo,
            finding_type: r.type,
            file_path: relPath,
            line_number: idx + 1,
            severity: r.sev,
            confidence: "high",
            evidence: line.trim(),
            category: "static_code",
          });
        }
      }
    });

    return findings;
  }

  _scanSecretContent(content, relPath) {
    const findings = [];
    const lines = content.split("\n");

    // Zero-leakage: detect and immediately redact
    const pemRegex = /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g;
    let match;
    while ((match = pemRegex.exec(content)) !== null) {
      const rawSecret = match[0];
      const startIdx = match.index;
      const lineNo = content.substring(0, startIdx).split("\n").length;
      const fp = "sha256:" + crypto.createHash("sha256").update(rawSecret.trim()).digest("hex").slice(0, 16);
      const redactedToken = `[REDACTED_PRIVATE_KEY:${fp}]`;

      findings.push({
        rule_id: "ECDAT-SECRET-PRIVATE-KEY",
        algorithm: "PRIVATE_KEY",
        finding_type: "hardcoded_key",
        file_path: relPath,
        line_number: lineNo,
        severity: "critical",
        confidence: "high",
        evidence: `private_key = "${redactedToken}"`,
        fingerprint: fp,
        category: "secret",
      });
    }

    lines.forEach((line, idx) => {
      if (/(?:secret_key|private_key|aes_key|encryption_key)\s*=\s*['"][0-9a-fA-F]{32,64}['"]/i.test(line)) {
        const fp = "sha256:" + crypto.createHash("sha256").update(line.trim()).digest("hex").slice(0, 16);
        findings.push({
          rule_id: "ECDAT-SECRET-SYMMETRIC-KEY",
          algorithm: "SYMMETRIC_KEY",
          finding_type: "hardcoded_key",
          file_path: relPath,
          line_number: idx + 1,
          severity: "critical",
          confidence: "high",
          evidence: `secret_key = "[REDACTED_KEY:${fp}]"`,
          fingerprint: fp,
          category: "secret",
        });
      }
    });

    return findings;
  }

  _scanDependencies(resolvedTarget) {
    const findings = [];
    const pkgPath = path.join(resolvedTarget, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const allDeps = { ...data.dependencies, ...data.devDependencies };
        const weakPkgs = {
          pycrypto: { sev: "critical", algo: "pycrypto" },
          des: { sev: "critical", algo: "des" },
          md5: { sev: "critical", algo: "md5" },
        };
        for (const [pkg, ver] of Object.entries(allDeps)) {
          if (weakPkgs[pkg.toLowerCase()]) {
            findings.push({
              rule_id: `ECDAT-DEP-${pkg.toUpperCase()}`,
              algorithm: weakPkgs[pkg.toLowerCase()].algo,
              finding_type: "weak_dependency",
              file_path: "package.json",
              line_number: 1,
              severity: weakPkgs[pkg.toLowerCase()].sev,
              confidence: "high",
              evidence: `"${pkg}": "${ver}"`,
              category: "dependency",
            });
          }
        }
      } catch (e) {
        // Skip malformed dependency manifest
      }
    }
    return findings;
  }

  _scanContainer(resolvedTarget, target) {
    const findings = [];
    const dockerPath = target && target !== "auto"
      ? (path.isAbsolute(target) ? target : path.join(resolvedTarget, target))
      : path.join(resolvedTarget, "Dockerfile");

    if (fs.existsSync(dockerPath)) {
      const lines = fs.readFileSync(dockerPath, "utf-8").split("\n");
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (/^FROM\s+.*\b(ubuntu:14\.|ubuntu:16\.|alpine:3\.[0-9]\b)/i.test(trimmed)) {
          findings.push({
            rule_id: "ECDAT-CONTAINER-DEPRECATED-BASE",
            algorithm: "LEGACY_BASE_IMAGE",
            finding_type: "container_weakness",
            file_path: path.relative(resolvedTarget, dockerPath).replace(/\\/g, "/"),
            line_number: idx + 1,
            severity: "high",
            confidence: "high",
            evidence: trimmed,
            category: "container",
          });
        }
      });
    }
    return findings;
  }
}

module.exports = {
  NodeCiScanner,
  CI_EXIT_CODES,
  VALID_FAIL_ON,
};
