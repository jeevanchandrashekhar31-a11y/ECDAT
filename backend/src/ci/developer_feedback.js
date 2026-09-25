/**
 * ECDAT Developer Feedback Engine (Node.js) — Phase 13.2
 *
 * Makes findings developer-actionable by providing 9 essential dimensions:
 * 1. Exact location (file_path, line_number, column_number, formatted)
 * 2. Evidence (sanitized snippet, zero secret leakage)
 * 3. Confidence (CONFIRMED, HIGH, MEDIUM, LOW)
 * 4. Severity (CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL)
 * 5. Why it matters (deep cryptographic rationale, avoiding generic messages)
 * 6. Safe fix (concrete code example and migration steps)
 * 7. References (NIST, RFC, FIPS, CWE citations)
 * 8. Suppression/exception workflow (inline comment syntax & API exception)
 * 9. Verification command (exact local CLI command to test fix)
 */

const fs = require("fs");
const path = require("path");

const KNOWLEDGE_CATALOG = {
  MD5: {
    whyItMatters:
      "MD5 is vulnerable to practical collision attacks (Wang et al., 2004) where two different inputs produce the identical 128-bit digest in under a second. In digital signatures, token generation, or file integrity checks, attackers can forge valid signatures or substitute malicious payloads without altering the hash.",
    safeFix: {
      summary: "Replace MD5 with SHA-256 (for general security) or SHA-3 / BLAKE3.",
      codeExample:
        "// Node.js:\n- const hash = crypto.createHash('md5').update(data).digest('hex');\n+ const hash = crypto.createHash('sha256').update(data).digest('hex');",
      migrationSteps: [
        "Verify database column and buffer allocations for 256-bit (32-byte) digest output.",
        "Replace 'md5' with 'sha256'.",
        "If computing HMACs, update the HMAC digest algorithm to SHA-256.",
      ],
    },
    references: [
      "NIST SP 800-131A Rev. 2 (Transitioning Cryptographic Algorithms)",
      "CWE-328: Use of Weak Hash",
      "RFC 6151: Security Considerations for MD5 and HMAC-MD5",
    ],
  },
  "SHA-1": {
    whyItMatters:
      "SHA-1 has broken collision resistance (SHAttered attack, 2017; Shambles chosen-prefix attack, 2020) with attack complexity reduced to 2^63 operations. Attackers can forge X.509 TLS certificates, PGP keys, or signatures by producing identical SHA-1 hashes for different contents.",
    safeFix: {
      summary: "Upgrade SHA-1 to SHA-256 or SHA-384.",
      codeExample:
        "- crypto.createHash('sha1').update(payload).digest('hex')\n+ crypto.createHash('sha256').update(payload).digest('hex')",
      migrationSteps: [
        "Widen digest storage fields to 64 hexadecimal characters.",
        "Migrate hashing calls to SHA-256.",
        "Rotate legacy HMAC keys derived with SHA-1.",
      ],
    },
    references: [
      "NIST Policy on SHA-1 Deprecation (December 2022)",
      "CWE-328: Use of Weak Hash",
      "FIPS 180-4: Secure Hash Standard",
    ],
  },
  DES: {
    whyItMatters:
      "DES uses a 56-bit key length susceptible to exhaustive brute-force key recovery in minutes (2^56 operations). Its 64-bit block size also suffers from Sweet32 collision attacks after encrypting 32 GB of data under the same key.",
    safeFix: {
      summary: "Migrate to AES-256-GCM (Galois/Counter Mode) with an authenticated 96-bit nonce.",
      codeExample:
        "- const cipher = crypto.createCipheriv('des-cbc', key, iv);\n+ const cipher = crypto.createCipheriv('aes-256-gcm', key256, iv96);",
      migrationSteps: [
        "Generate a 256-bit symmetric key using a CSPRNG.",
        "Replace DES with AES-GCM or ChaCha20-Poly1305.",
        "Ensure fresh 96-bit IVs for every encryption call.",
      ],
    },
    references: [
      "NIST SP 800-131A Rev. 2 (Disallowing DES/3DES)",
      "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
      "CVE-2016-2183 (Sweet32 attack on 64-bit block ciphers)",
    ],
  },
  "3DES": {
    whyItMatters:
      "Triple DES (3DES) relies on a small 64-bit block size vulnerable to Sweet32 birthday collision attacks (CVE-2016-2183). NIST has officially disallowed 3DES for all applications after 2023.",
    safeFix: {
      summary: "Upgrade 3DES to AES-GCM (AES-128 or AES-256).",
      codeExample:
        "- const cipher = crypto.createCipheriv('des-ede3-cbc', key, iv);\n+ const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);",
      migrationSteps: [
        "Replace 3DES ciphers with AES-256-GCM.",
        "Re-encrypt legacy stored data with AES keys.",
      ],
    },
    references: [
      "NIST SP 800-131A Rev. 2",
      "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
    ],
  },
  RC4: {
    whyItMatters:
      "RC4 contains severe statistical keystream biases that allow passive eavesdroppers to recover plaintexts from repeated encrypted sessions. IETF RFC 7465 explicitly prohibits the use of RC4 in all TLS configurations.",
    safeFix: {
      summary: "Replace RC4 with ChaCha20-Poly1305 or AES-GCM.",
      codeExample:
        "- const cipher = crypto.createCipheriv('rc4', key, '');\n+ const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });",
      migrationSteps: [
        "Disable RC4 in TLS configurations.",
        "Replace RC4 instances with ChaCha20-Poly1305.",
      ],
    },
    references: [
      "RFC 7465: Prohibiting RC4 Cipher Suites",
      "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
    ],
  },
  ECB: {
    whyItMatters:
      "Electronic Codebook (ECB) mode encrypts identical plaintext blocks into identical ciphertext blocks without an IV. This leaks structural patterns (the ECB penguin effect), allowing attackers to deduce confidential message contents without the key.",
    safeFix: {
      summary: "Replace ECB with an authenticated AEAD mode such as GCM (Galois/Counter Mode).",
      codeExample:
        "- const cipher = crypto.createCipheriv('aes-128-ecb', key, null);\n+ const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);",
      migrationSteps: [
        "Eliminate ECB mode from all symmetric cipher instantiations.",
        "Implement AES-GCM to ensure confidentiality and integrity.",
        "Generate a fresh random 96-bit IV for every encryption call.",
      ],
    },
    references: [
      "NIST SP 800-38D (Galois/Counter Mode)",
      "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
    ],
  },
  RSA_KEY_SIZE: {
    whyItMatters:
      "RSA keys under 2048 bits (such as RSA-1024) provide less than 80 bits of security strength and are factorable using the General Number Field Sieve (GNFS) on distributed computing resources.",
    safeFix: {
      summary: "Generate RSA keys with at least 2048 bits (3072 bits recommended), or adopt ML-KEM / ML-DSA for PQC.",
      codeExample:
        "- crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });\n+ crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });",
      migrationSteps: [
        "Update key generation routines to set modulusLength to 2048 or 3072 bits.",
        "Rotate all existing sub-2048 bit certificates and keys.",
      ],
    },
    references: [
      "NIST SP 800-57 Part 1 Rev. 5 (Recommendation for Key Management)",
      "CWE-326: Inadequate Encryption Strength",
    ],
  },
  HARDCODED_KEY: {
    whyItMatters:
      "Hardcoding cryptographic keys, secrets, or tokens in source code exposes credentials to all repository viewers, build logs, and container images, bypassing identity and access boundaries.",
    safeFix: {
      summary: "Extract secrets into a secure Secret Manager (AWS Secrets Manager, Vault) or environment variables.",
      codeExample:
        "- const KEY = '0123456789abcdef0123456789abcdef';\n+ const KEY = process.env.ENCRYPTION_KEY || await vault.getSecret('enc_key');",
      migrationSteps: [
        "Immediately revoke and rotate the exposed secret.",
        "Inject secrets at runtime via environment variables or secret store.",
        "Purge exposed commit history if the repository is public.",
      ],
    },
    references: [
      "CWE-798: Use of Hard-coded Credentials",
      "NIST SP 800-57 Part 1 (Key Storage and Protection)",
    ],
  },
  TLS_VERSION: {
    whyItMatters:
      "TLS 1.0/1.1 protocols lack modern AEAD ciphers, suffer from CBC padding oracles, and have been deprecated by RFC 8996, NIST SP 800-52r2, and PCI DSS.",
    safeFix: {
      summary: "Enforce TLS 1.2 minimum version, preferably TLS 1.3.",
      codeExample:
        "- const options = { secureProtocol: 'TLSv1_method' };\n+ const options = { minVersion: 'TLSv1.2' };",
      migrationSteps: [
        "Set minVersion to 'TLSv1.2' or 'TLSv1.3' across TLS endpoints.",
      ],
    },
    references: [
      "RFC 8996: Deprecating TLS 1.0 and TLS 1.1",
      "NIST SP 800-52 Rev. 2",
    ],
  },
};

const DEFAULT_KNOWLEDGE = {
  whyItMatters:
    "Cryptographic primitive deviates from NIST and enterprise approved cryptographic standards. Non-standard or legacy algorithms introduce operational risk, reduce security margins, and fail compliance audits.",
  safeFix: {
    summary: "Migrate primitive to a modern NIST-approved standard algorithm.",
    codeExample: "// Adopt AES-256-GCM, SHA-256, or PQC standards (FIPS 203/204).",
    migrationSteps: [
      "Review cryptographic inventory against enterprise cryptographic baseline.",
      "Select an approved replacement from NIST SP 800-131A.",
    ],
  },
  references: [
    "NIST SP 800-131A Rev. 2",
    "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
  ],
};

class DeveloperFeedbackGenerator {
  static resolveKnowledge(algo = "", findingType = "") {
    const a = String(algo).toUpperCase();
    const ft = String(findingType).toUpperCase();

    if (a.includes("MD5") || ft.includes("MD5")) return KNOWLEDGE_CATALOG.MD5;
    if (a.includes("SHA1") || a.includes("SHA-1") || ft.includes("SHA1") || ft.includes("SHA-1")) return KNOWLEDGE_CATALOG["SHA-1"];
    if (a.includes("3DES") || a.includes("TRIPLE") || ft.includes("3DES")) return KNOWLEDGE_CATALOG["3DES"];
    if (a.includes("DES") || ft.includes("DES")) return KNOWLEDGE_CATALOG.DES;
    if (a.includes("RC4") || ft.includes("RC4")) return KNOWLEDGE_CATALOG.RC4;
    if (a.includes("ECB") || ft.includes("ECB")) return KNOWLEDGE_CATALOG.ECB;
    if (a.includes("RSA") && (a.includes("1024") || a.includes("512") || ft.includes("KEY_SIZE"))) {
      return KNOWLEDGE_CATALOG.RSA_KEY_SIZE;
    }
    if (ft.includes("HARDCODED") || ft.includes("SECRET") || a.includes("PRIVATE_KEY") || a.includes("SYMMETRIC_KEY")) {
      return KNOWLEDGE_CATALOG.HARDCODED_KEY;
    }
    if (a.includes("TLS") || a.includes("SSL") || ft.includes("TLS")) {
      return KNOWLEDGE_CATALOG.TLS_VERSION;
    }

    return DEFAULT_KNOWLEDGE;
  }

  static checkInlineSuppression(fileContent, lineNumber, ruleId, algorithm = "", findingType = "") {
    if (!fileContent || lineNumber <= 0) return { isSuppressed: false, reason: null };

    const lines = fileContent.split("\n");
    const targetIdx = lineNumber - 1;
    const candidates = [];

    if (targetIdx < lines.length) candidates.push(lines[targetIdx]);
    if (targetIdx > 0 && targetIdx - 1 < lines.length) candidates.push(lines[targetIdx - 1]);

    const cleanRule = String(ruleId).trim().toUpperCase();
    const cleanAlgo = String(algorithm).trim().toUpperCase();
    const cleanFt = String(findingType).trim().toUpperCase();

    const pattern = /(?:#|\/\/|\/\*)\s*ecdat:(?:suppress|ignore)\s+([A-Za-z0-9_-]+)(?:\s+reason=["']([^"']+)["'])?/i;

    for (const line of candidates) {
      const match = pattern.exec(line);
      if (match) {
        const suppTarget = match[1].trim().toUpperCase();
        const reason = match[2] || "Suppressed via developer inline comment";
        if (
          suppTarget === "ALL" ||
          suppTarget === cleanRule ||
          cleanRule.includes(suppTarget) ||
          suppTarget.includes(cleanRule) ||
          (cleanAlgo && (cleanAlgo === suppTarget || cleanAlgo.includes(suppTarget) || suppTarget.includes(cleanAlgo))) ||
          (cleanFt && (cleanFt === suppTarget || cleanFt.includes(suppTarget) || suppTarget.includes(cleanFt)))
        ) {
          return { isSuppressed: true, reason };
        }
      }
    }

    return { isSuppressed: false, reason: null };
  }

  static generate(finding, targetRoot = null) {
    const filePath = String(finding.file_path || "unknown").replace(/\\/g, "/");
    const lineNum = Number(finding.line_number) || 1;
    const colNum = Number(finding.column_number) || 1;

    const formattedLocation = `${filePath}:${lineNum}:${colNum}`;
    const exactLocation = {
      file_path: filePath,
      line_number: lineNum,
      column_number: colNum,
      formatted: formattedLocation,
    };

    const algo = finding.algorithm || "UNKNOWN";
    const findingType = finding.finding_type || "weak_crypto";
    const ruleId = finding.rule_id || "ECDAT-CRYPTO";
    const confidence = String(finding.confidence || "HIGH").toUpperCase();
    const severity = String(finding.severity || "MEDIUM").toUpperCase();

    const knowledge = this.resolveKnowledge(algo, findingType);
    const evidence = String(finding.evidence || "");

    let isSuppressed = false;
    let suppressionReason = null;

    if (targetRoot) {
      const fullTarget = path.resolve(targetRoot, filePath);
      if (fs.existsSync(fullTarget)) {
        try {
          const content = fs.readFileSync(fullTarget, "utf-8");
          const suppCheck = this.checkInlineSuppression(content, lineNum, ruleId, algo, findingType);
          isSuppressed = suppCheck.isSuppressed;
          suppressionReason = suppCheck.reason;
        } catch (_e) {
          // Ignore read error
        }
      }
    }

    const commentPrefix = filePath.endsWith(".py") || filePath.endsWith(".yaml") || filePath.endsWith(".yml") ? "#" : "//";
    const inlineExample = `${commentPrefix} ecdat:suppress ${ruleId} reason="Explain why this cryptographic usage is safe or non-security"`;

    const suppressionWorkflow = {
      inline_comment_syntax: `${commentPrefix} ecdat:suppress ${ruleId} reason="<justification>"`,
      inline_example: inlineExample,
      policy_exception_api: "POST /api/v1/policy/exceptions",
      cli_exception_command: `python -m scanners.policy_security exception request --rule ${ruleId} --reason "<justification>"`,
    };

    const verificationCommand = `python -m scanners.ci_scanner . --changed-files ${filePath} --fail-on critical`;

    return {
      exact_location: exactLocation,
      evidence,
      confidence,
      severity,
      why_it_matters: knowledge.whyItMatters,
      safe_fix: knowledge.safeFix,
      references: knowledge.references,
      suppression_workflow: suppressionWorkflow,
      verification_command: verificationCommand,
      is_suppressed: isSuppressed,
      suppression_reason: suppressionReason,
    };
  }

  static renderTerminalCard(feedback) {
    const sep = "-".repeat(72);
    let statusLine = `[${feedback.severity}] ${feedback.exact_location.formatted}`;
    if (feedback.is_suppressed) {
      statusLine += ` (SUPPRESSED: ${feedback.suppression_reason})`;
    }

    const stepsStr = feedback.safe_fix.migrationSteps.map((s, i) => `    ${i + 1}. ${s}`).join("\n");
    const refsStr = feedback.references.map((r) => `    * ${r}`).join("\n");

    return (
      `\n${sep}\n` +
      `  ${statusLine}\n` +
      `${sep}\n` +
      `  Location:     ${feedback.exact_location.formatted}\n` +
      `  Severity:     ${feedback.severity} | Confidence: ${feedback.confidence}\n\n` +
      `  Evidence:\n` +
      `    ${feedback.exact_location.line_number} | ${feedback.evidence}\n\n` +
      `  Why It Matters (Cryptographic Weakness):\n` +
      `    ${feedback.why_it_matters}\n\n` +
      `  Safe Fix:\n` +
      `    ${feedback.safe_fix.summary}\n\n` +
      `  Migration Steps:\n` +
      `${stepsStr}\n\n` +
      `  Code Remediation Example:\n` +
      `${feedback.safe_fix.codeExample}\n\n` +
      `  Standards & References:\n` +
      `${refsStr}\n\n` +
      `  Suppression / Policy Exception:\n` +
      `    In-Code:  ${feedback.suppression_workflow.inline_example}\n` +
      `    API:      ${feedback.suppression_workflow.policy_exception_api}\n\n` +
      `  Verify Locally:\n` +
      `    $ ${feedback.verification_command}\n` +
      `${sep}\n`
    );
  }

  static renderMarkdown(feedback) {
    const stepsMd = feedback.safe_fix.migrationSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");
    const refsMd = feedback.references.map((r) => `- ${r}`).join("\n");

    return (
      `### [${feedback.severity}] Cryptographic Finding: \`${feedback.exact_location.formatted}\`\n\n` +
      `**Location:** \`${feedback.exact_location.formatted}\`  \n` +
      `**Severity:** \`${feedback.severity}\` | **Confidence:** \`${feedback.confidence}\`\n\n` +
      `#### Evidence\n` +
      `\`\`\`text\n${feedback.exact_location.line_number} | ${feedback.evidence}\n\`\`\`\n\n` +
      `#### Why It Matters\n` +
      `${feedback.why_it_matters}\n\n` +
      `#### Safe Fix\n` +
      `${feedback.safe_fix.summary}\n\n` +
      `\`\`\`diff\n${feedback.safe_fix.codeExample}\n\`\`\`\n\n` +
      `**Migration Steps:**\n` +
      `${stepsMd}\n\n` +
      `#### Standards & References\n` +
      `${refsMd}\n\n` +
      `#### Suppression & Exception Workflow\n` +
      `- **In-Code Suppression:** Add \`${feedback.suppression_workflow.inline_example}\`\n` +
      `- **Enterprise Policy Exception:** \`${feedback.suppression_workflow.policy_exception_api}\`\n\n` +
      `#### Verification Command\n` +
      `\`\`\`bash\n${feedback.verification_command}\n\`\`\`\n`
    );
  }
}

module.exports = {
  DeveloperFeedbackGenerator,
  KNOWLEDGE_CATALOG,
};
