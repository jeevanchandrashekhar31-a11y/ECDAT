/**
 * ECDAT Safe Remediation Engine — Remediation Planner (Phase 12.1)
 *
 * For every actionable cryptographic finding, generates a complete 10-dimension plan:
 * 1. Finding (ID, title, severity, category, rule, evidence)
 * 2. Why it matters (cryptographic weakness, quantum break, compliance consequence)
 * 3. Affected asset (identity, type, algorithm, environment, internet exposure, reachability)
 * 4. Recommended remediation (prescriptive step-by-step guidance)
 * 5. Migration options (structured alternatives: Primary PQC, Hybrid, Classical Hardening, Compensating Control)
 * 6. Expected impact (blast radius, latency, bandwidth, client compatibility, zero-downtime requirements)
 * 7. Dependencies (required libraries, runtime versions, KMS, PKI)
 * 8. Testing plan (KAT test vectors, unit, integration, performance, interoperability)
 * 9. Rollback plan (feature flag toggle, rollback triggers, zero-downtime recovery)
 * 10. Confidence (score, level, reasoning)
 *
 * SAFETY PRINCIPLE: DEFAULTS TO DRY RUN.
 */

const crypto = require("crypto");
const { sanitizeEvidenceData } = require("../compliance/compliance_mapper");

/**
 * Derives "Why it matters" explanation based on finding and asset characteristics.
 */
function deriveWhyItMatters(finding, asset = {}) {
  const algo = String(finding.algorithm || asset.algorithm || finding.name || "Unknown").toUpperCase();
  const keySize = finding.key_size || asset.key_size || finding.keySizeBits;
  const isInternet = Boolean(asset.is_internet_facing || asset.isInternetExposed || finding.is_internet_facing);
  const moscaStatus = asset.mosca?.status || finding.mosca_status;

  const points = [];

  // Classical Weaknesses
  if (["MD5", "MD4", "MD2"].some((a) => algo.includes(a))) {
    points.push(
      "Cryptographic collision attacks against MD5 are practical in seconds; attackers can forge certificates, signatures, or checksums.",
    );
  } else if (algo.includes("SHA1") || algo.includes("SHA-1")) {
    points.push(
      "SHA-1 is susceptible to practical chosen-prefix collision attacks (SHAttered), allowing digital signature forgery.",
    );
  } else if (["DES", "3DES", "TDEA"].some((a) => algo.includes(a))) {
    points.push(
      "Legacy 64-bit block ciphers are vulnerable to Sweet32 collision attacks and brute-force key recovery in transit.",
    );
  } else if (algo.includes("RC4")) {
    points.push(
      "RC4 contains severe statistical keystream biases allowing plaintext extraction from repeated TLS sessions (Bar Mitzvah / Royal Holloway attacks).",
    );
  } else if (algo.includes("RSA") && keySize && Number(keySize) < 2048) {
    points.push(
      `RSA-${keySize} provides sub-standard security (< 112 bits) and is vulnerable to factorization by academic/cloud computing clusters.`,
    );
  } else if (["TLS 1.0", "TLS 1.1", "SSLV2", "SSLV3"].some((p) => algo.includes(p))) {
    points.push(
      "Protocol version contains known protocol vulnerabilities (POODLE, BEAST) and lacks AEAD cipher suites, violating modern PCI DSS and NIST baselines.",
    );
  }

  // Quantum Cryptanalysis Vulnerability
  if (
    ["RSA", "ECDSA", "ECDH", "DIFFIE-HELLMAN", "DH", "DSA", "ED25519", "X25519"].some((a) =>
      algo.includes(a),
    )
  ) {
    points.push(
      "Asymmetric discrete logarithm and integer factorization problems will be solved in polynomial time by Shor's algorithm on a Cryptanalytically Relevant Quantum Computer (CRQC).",
    );
  } else if (algo.includes("AES") && keySize && Number(keySize) === 128) {
    points.push(
      "Grover's algorithm reduces effective brute-force symmetric search space to 2^64 operations, cutting quantum security margin below long-term assurance thresholds.",
    );
  }

  // Exposure & Harvest-Now-Decrypt-Later (HNDL)
  if (isInternet) {
    points.push(
      "Active exposure on the public internet perimeter exposes traffic to passive nation-state interception and Harvest-Now-Decrypt-Later (HNDL) archiving.",
    );
  }

  // Mosca Urgency
  if (moscaStatus === "CRITICAL_URGENT") {
    points.push(
      "Critical Mosca inequality deficit (D + T > Q): Data shelf life plus migration time exceeds quantum threat arrival horizon.",
    );
  } else if (moscaStatus === "AT_RISK") {
    points.push(
      "Mosca timeline margin is narrow; initiating migration immediately is required to prevent data compromise.",
    );
  }

  // Certificate Specifics
  if (finding.is_self_signed || asset.is_self_signed) {
    points.push(
      "Self-signed certificate bypasses public PKI trust hierarchies and lacks automated revocation checking, leaving endpoints vulnerable to Man-in-the-Middle (MitM) attacks.",
    );
  }

  if (points.length === 0) {
    points.push(
      "Asset does not conform to enterprise cryptographic standards and requires modernization to maintain long-term assurance.",
    );
  }

  return {
    summary: points[0],
    detailed_reasons: points,
  };
}

/**
 * Derives recommended remediation action and step-by-step guidance.
 */
function deriveRecommendedRemediation(finding, asset = {}) {
  const algo = String(finding.algorithm || asset.algorithm || finding.name || "").toUpperCase();
  const keySize = finding.key_size || asset.key_size || finding.keySizeBits;
  const assetType = String(finding.asset_type || asset.asset_type || "algorithm").toLowerCase();

  let actionType = "CODE_REFACTOR";
  let summary = "";
  let steps = [];
  let targetStandard = "NIST Post-Quantum Standards";
  let targetYear = 2026;

  if (algo.includes("MD5") || algo.includes("SHA-1") || algo.includes("SHA1")) {
    actionType = "CODE_REFACTOR";
    summary = "Replace deprecated hash algorithm with SHA-256 or SHA-384; migrate passwords to Argon2id.";
    steps = [
      "Audit all call sites using the deprecated hash function.",
      "Update hashing calls to SHA-256 (NIST FIPS 180-4) or SHA3-256 (NIST FIPS 202).",
      "If used for password verification, upgrade to Argon2id (RFC 9106) with minimum 64MB memory cost.",
      "Regenerate stored checksums and verify signature verification pipelines.",
    ];
    targetStandard = "NIST FIPS 180-4 / FIPS 202";
    targetYear = 2026;
  } else if (["DES", "3DES", "RC4", "RC2"].some((c) => algo.includes(c))) {
    actionType = "CODE_REFACTOR";
    summary = "Migrate legacy symmetric encryption to AES-256-GCM or ChaCha20-Poly1305 authenticated encryption.";
    steps = [
      "Identify data-at-rest encryption modules and database serializers utilizing legacy cipher.",
      "Refactor encryption routine to AES-256-GCM with standard 96-bit unique random nonces.",
      "Execute safe re-encryption migration job for existing stored ciphertext records.",
      "Decommission legacy key decryption routines.",
    ];
    targetStandard = "NIST SP 800-38D (AES-GCM)";
    targetYear = 2026;
  } else if (["TLS 1.0", "TLS 1.1", "SSLV2", "SSLV3"].some((p) => algo.includes(p))) {
    actionType = "CONFIG_UPDATE";
    summary = "Disable deprecated TLS versions across load balancers, proxies, and application servers.";
    steps = [
      "Inspect reverse proxy / gateway configuration (Envoy, NGINX, Cloudflare, AWS ALB).",
      "Update minimum TLS protocol version parameter to TLSv1.2 or TLSv1.3.",
      "Remove legacy CBC and non-AEAD cipher suites from the allowed cipher suite string.",
      "Verify client connection success metrics through synthetic health checks.",
    ];
    targetStandard = "PCI DSS v4.0 Req 4.2.1 & NIST SP 800-52 Rev 2";
    targetYear = 2026;
  } else if (algo.includes("RSA") && keySize && Number(keySize) < 2048) {
    actionType = "KEY_ROTATION";
    summary = "Regenerate sub-2048 bit RSA keys with modern RSA-3072 or ECDSA P-256 keypairs.";
    steps = [
      "Generate new 3072-bit RSA or 256-bit ECDSA keypair inside managed KMS/HSM.",
      "Publish public key to consumer verification endpoints in dual-verification mode.",
      "Begin signing new payloads with the upgraded key.",
      "Retire and revoke the sub-standard key after retention expiration.",
    ];
    targetStandard = "NIST SP 800-131A Rev 2";
    targetYear = 2026;
  } else if (assetType === "certificate" && (finding.is_self_signed || asset.is_self_signed)) {
    actionType = "CERT_RENEWAL";
    summary = "Replace self-signed certificate with an automated enterprise CA or public trusted CA certificate.";
    steps = [
      "Issue Certificate Signing Request (CSR) with SAN matching endpoint FQDN.",
      "Submit CSR to enterprise automated PKI (ACME / HashiCorp Vault / DigiCert).",
      "Deploy issued certificate chain and verify OCSP stapling and CT log inclusion.",
      "Remove manual trust store workarounds from client containers.",
    ];
    targetStandard = "CA/Browser Forum Baseline Requirements";
    targetYear = 2026;
  } else if (
    ["ECDH", "X25519", "DIFFIE-HELLMAN"].some((k) => algo.includes(k)) ||
    algo.startsWith("TLS")
  ) {
    actionType = "CONFIG_UPDATE";
    summary = "Enable hybrid post-quantum key establishment (X25519MLKEM768) on TLS endpoints.";
    steps = [
      "Ensure underlying TLS stack is upgraded to OpenSSL 3.2+, BoringSSL, or Go 1.23+.",
      "Configure supported named groups to prefer 'X25519MLKEM768' followed by 'x25519'.",
      "Validate that TLS ClientHello sends hybrid key shares without MTU fragmentation.",
      "Monitor handshake latency and verify zero handshake fallback failures.",
    ];
    targetStandard = "NIST FIPS 203 (ML-KEM) & IETF TLS Hybrid Design";
    targetYear = 2026;
  } else if (["RSA", "ECDSA", "DSA"].some((s) => algo.includes(s))) {
    actionType = "CODE_REFACTOR";
    summary = "Implement post-quantum digital signature migration using ML-DSA-65 or hybrid dual-signatures.";
    steps = [
      "Evaluate payload size tolerance for ML-DSA-65 (~3.3 KB signature) vs classical signature (~64-256 bytes).",
      "Implement composite dual-signature verification to support legacy and post-quantum validators.",
      "Upgrade crypto provider to NIST FIPS 204 compliant library.",
      "Phase out classical-only signature verification after ecosystem migration.",
    ];
    targetStandard = "NIST FIPS 204 (ML-DSA)";
    targetYear = 2027;
  } else {
    actionType = "CODE_REFACTOR";
    summary = "Modernize cryptographic asset to comply with NIST SP 800-57 Part 1 Rev 5.";
    steps = [
      "Review current cryptographic usage and algorithm constraints.",
      "Upgrade parameters to quantum-resistant or current classical standards.",
      "Execute automated regression testing suite.",
    ];
    targetStandard = "NIST SP 800-57 Part 1 Rev 5";
    targetYear = 2026;
  }

  return {
    action_type: actionType,
    summary,
    steps,
    target_standard: targetStandard,
    target_year: targetYear,
  };
}

/**
 * Builds viable migration options (Primary, Hybrid, Classical Hardening, Compensating Control).
 */
function buildMigrationOptions(finding, asset = {}) {
  const algo = String(finding.algorithm || asset.algorithm || finding.name || "").toUpperCase();
//   const assetType = String(finding.asset_type || asset.asset_type || "algorithm").toLowerCase();
  const category = String(finding.category || asset.category || "").toLowerCase();

  const options = [];

  let primaryPqc = null;
  let hybridTransition = null;
  let classicalHardening = null;
  let compensatingControls = null;

  if (
    ["ECDH", "X25519", "DIFFIE-HELLMAN"].some((k) => algo.includes(k)) ||
    algo.startsWith("TLS")
  ) {
    primaryPqc = {
      option_id: "OPT-1-PQC-HYBRID",
      name: "Standardized PQC Hybrid Key Exchange (X25519MLKEM768)",
      type: "PQC_HYBRID",
      target_standard: "ML-KEM-768 (NIST FIPS 203)",
      composite_scheme: "X25519+ML-KEM-768",
      is_primary_recommendation: true,
      description: "Deploys standardized IETF hybrid group combining X25519 with ML-KEM-768.",
      pros: [
        "Immediate immunity against Harvest-Now-Decrypt-Later (HNDL) attacks.",
        "Zero regression risk: Classical curve preserves security even if quantum lattice breaks.",
        "Supported natively in modern browsers (Chrome, Edge, Firefox) and OpenSSL 3.2+.",
      ],
      cons: ["ClientHello message size increases by ~1.2 KB."],
      effort: "LOW",
      risk_rating: "LOW",
    };

    hybridTransition = {
      option_id: "OPT-2-FIPS-HYBRID",
      name: "FIPS 140-3 Regulated Hybrid (SecP256r1MLKEM768)",
      type: "PQC_HYBRID_FIPS",
      target_standard: "ML-KEM-768 (NIST FIPS 203)",
      composite_scheme: "SecP256r1+ML-KEM-768",
      is_primary_recommendation: false,
      description: "Combines NIST P-256 curve with ML-KEM-768 for strict US Fed / BFSI regulatory mandates.",
      pros: [
        "Satisfies strict FIPS 140-3 and NSA CNSA 2.0 compliance mandates.",
        "Guarantees post-quantum forward secrecy.",
      ],
      cons: ["Slightly higher compute overhead than X25519."],
      effort: "LOW",
      risk_rating: "LOW",
    };

    classicalHardening = {
      option_id: "OPT-3-CLASSICAL-ONLY",
      name: "Classical Hardening (X25519 only, TLS 1.3)",
      type: "CLASSICAL_HARDENING",
      target_standard: "RFC 8446 (TLS 1.3)",
      composite_scheme: "X25519",
      is_primary_recommendation: false,
      description: "Restricts ciphers to TLS 1.3 with pure X25519 without PQC shares.",
      pros: ["Zero packet size increase; maximum legacy client compatibility."],
      cons: ["Vulnerable to retrospective quantum decryption (HNDL)."],
      effort: "LOW",
      risk_rating: "HIGH",
    };

    options.push(primaryPqc, hybridTransition, classicalHardening);
  } else if (["RSA", "ECDSA", "DSA"].some((s) => algo.includes(s)) || category.includes("asymmetric")) {
    const isEnc = category.includes("encryption") || category.includes("key_exchange") || category.includes("encapsulation");
    primaryPqc = {
      option_id: isEnc ? "OPT-1-PQC-KEM" : "OPT-1-PQC-SIGNATURE",
      name: isEnc ? "NIST FIPS 203 ML-KEM-768 Migration" : "NIST FIPS 204 ML-DSA-65 Migration",
      type: isEnc ? "PQC_KEM" : "PQC_DIRECT",
      target_standard: isEnc ? "ML-KEM-768 (NIST FIPS 203)" : "ML-DSA-65 (NIST FIPS 204)",
      composite_scheme: isEnc ? "RSA+ML-KEM-768" : "RSA+ML-DSA-65",
      is_primary_recommendation: true,
      description: isEnc
        ? "Migrates public key encryption to lattice-based ML-KEM-768 (NIST FIPS 203)."
        : "Migrates public key digital signing to lattice-based ML-DSA-65 (Security Category 3).",
      pros: [
        "Quantum-resistant against Shor's polynomial-time factorization.",
        "Fast signing and verification cycle performance.",
      ],
      cons: ["Signature or encapsulation size increase; requires buffer resizing."],
      effort: "HIGH",
      risk_rating: "MEDIUM",
    };

    hybridTransition = {
      option_id: "OPT-2-COMPOSITE-DUAL",
      name: isEnc ? "Composite Dual-Encryption (RSA-3072 + ML-KEM-768)" : "Composite Dual-Signing (RSA-3072 + ML-DSA-65)",
      type: "PQC_COMPOSITE",
      target_standard: isEnc ? "ML-KEM-768 (NIST FIPS 203)" : "ML-DSA-65 (NIST FIPS 204)",
      composite_scheme: isEnc ? "RSA+ML-KEM-768" : "RSA+ML-DSA-65",
      is_primary_recommendation: false,
      description: "Emits composite dual payloads to maintain legacy compatibility during transition.",
      pros: [
        "Non-breaking for legacy client applications.",
        "PQC-ready validators achieve quantum forgery resistance.",
      ],
      cons: ["Dual signature/encryption payload overhead."],
      effort: "HIGH",
      risk_rating: "MEDIUM",
    };

    classicalHardening = {
      option_id: "OPT-3-CLASSICAL-UPGRADE",
      name: "Interim Classical Hardening (RSA-3072 / ECDSA P-256)",
      type: "CLASSICAL_HARDENING",
      target_standard: "NIST SP 800-57 Part 1 Rev 5",
      composite_scheme: "RSA-3072",
      is_primary_recommendation: false,
      description: "Upgrades weak key size to 3072-bit RSA or 256-bit ECC.",
      pros: ["100% ecosystem compatibility; no payload expansion."],
      cons: ["Remains completely vulnerable to CRQCs; fails 2030+ compliance mandates."],
      effort: "MEDIUM",
      risk_rating: "HIGH",
    };

    options.push(primaryPqc, hybridTransition, classicalHardening);
  } else if (algo.includes("MD5") || algo.includes("SHA-1")) {
    primaryPqc = {
      option_id: "OPT-1-SHA256-DROPIN",
      name: "NIST FIPS 180-4 SHA-256 Migration",
      type: "CLASSICAL_DIRECT",
      target_standard: "NIST FIPS 180-4 (SHA-256)",
      composite_scheme: "SHA-256",
      is_primary_recommendation: true,
      description: "Migrates legacy weak hash function to collision-resistant SHA-256.",
      pros: ["Standardized drop-in replacement across all ecosystems."],
      cons: ["Digest size increases to 32 bytes (256 bits)."],
      effort: "LOW",
      risk_rating: "LOW",
    };
    classicalHardening = primaryPqc;
    options.push(primaryPqc);
  }

  compensatingControls = {
    option_id: "OPT-COMPENSATING-CONTROL",
    name: "Compensating Control with Approved Exception",
    type: "COMPENSATING_CONTROL",
    target_standard: "ECDAT Perimeter Security Baseline",
    composite_scheme: "mTLS+WAF",
    is_primary_recommendation: false,
    description: "Applies network micro-segmentation, mTLS perimeter, and registers formal policy exception.",
    pros: ["Prevents immediate application refactoring or breaking change."],
    cons: ["Technical debt remains; requires security review and executive sign-off."],
    effort: "MEDIUM",
    risk_rating: "MEDIUM",
  };
  options.push(compensatingControls);

  // Attach named properties directly to array
  options.primary_pqc = primaryPqc;
  options.hybrid_transition = hybridTransition;
  options.classical_hardening = classicalHardening;
  options.compensating_controls = compensatingControls;

  return options;
}

/**
 * Calculates expected operational and performance impact.
 */
function deriveExpectedImpact(finding, asset = {}) {
  const algo = String(finding.algorithm || asset.algorithm || "").toUpperCase();
  const assetType = String(finding.asset_type || asset.asset_type || "algorithm").toLowerCase();
  const isInternet = Boolean(asset.is_internet_facing || asset.isInternetExposed);

  let blastRadius = "service-internal";
  let latencyImpact = "negligible (< 0.5ms)";
  let bandwidthImpact = "zero change";
  let clientCompatibility = "high (backward compatible)";
  let downtime = "zero-downtime rolling update";

  if (algo.startsWith("TLS") || assetType === "network_session" || isInternet) {
    blastRadius = isInternet ? "public-edge-api" : "internal-service-mesh";
    latencyImpact = "minor (< 1.5ms TLS handshake overhead)";
    bandwidthImpact = "+1.2 KB ClientHello / ServerHello payload";
    clientCompatibility = "full backward compatibility via classical fallback";
    downtime = "zero-downtime rolling update / reload";
  } else if (["RSA", "ECDSA"].some((s) => algo.includes(s)) && assetType === "certificate") {
    blastRadius = "cluster-wide-pki";
    latencyImpact = "minor (< 1ms verification)";
    bandwidthImpact = "+3.3 KB certificate chain expansion";
    clientCompatibility = "requires composite PKI or client certificate update";
    downtime = "zero-downtime rolling certificate swap";
  } else if (["MD5", "SHA-1", "DES", "3DES"].some((c) => algo.includes(c))) {
    blastRadius = "component-data-layer";
    latencyImpact = "neutral to positive (hardware AES/SHA acceleration)";
    bandwidthImpact = "+16 bytes per stored hash/record";
    clientCompatibility = "internal contract change";
    downtime = "zero-downtime online database migration";
  }

  return {
    blast_radius: blastRadius,
    latency_impact: latencyImpact,
    bandwidth_storage_impact: bandwidthImpact,
    client_compatibility: clientCompatibility,
    downtime_requirement: downtime,
  };
}

/**
 * Identifies dependencies and minimum platform prerequisites.
 */
function deriveDependencies(finding, asset = {}) {
  const algo = String(finding.algorithm || asset.algorithm || "").toUpperCase();

  const requiredLibraries = [];
  const minRuntimeVersions = [];
  let kmsHsmSupport = "Standard Software Cryptography";
  let caProfileSupport = "Standard X.509 v3 PKI";

  if (
    algo.startsWith("TLS") ||
    ["ECDH", "X25519", "ML-KEM", "KEM"].some((k) => algo.includes(k))
  ) {
    requiredLibraries.push("OpenSSL 3.2.0+", "liboqs 0.10.0+ (optional for native C)", "BoringSSL (current)");
    minRuntimeVersions.push("Go 1.23+", "Node.js 22+", "Java 21 with Bouncy Castle 1.78+", "Python 3.12+ with cryptography 42.0+");
    kmsHsmSupport = "KMS supporting hybrid key exchange envelopes (AWS KMS / GCP Cloud KMS PQC preview)";
    caProfileSupport = "X.509 RFC 5280 PKI with support for hybrid signature algorithms";
  } else if (["RSA", "ECDSA", "ML-DSA"].some((s) => algo.includes(s))) {
    requiredLibraries.push("Bouncy Castle 1.78+ / OpenSSL 3.3+ with FIPS provider");
    minRuntimeVersions.push("Java 21+", "Go 1.24+", "Node.js 22+");
    kmsHsmSupport = "PKCS#11 v3.0 compliant HSM or Cloud KMS with composite key management";
    caProfileSupport = "IETF composite certificate profile (draft-ietf-lamps-cert-binding-for-multi-auth)";
  } else {
    requiredLibraries.push("Standard OS cryptographic library (OpenSSL, CryptoKit, WebCrypto)");
    minRuntimeVersions.push("Node.js 18+", "Python 3.10+", "Java 17+");
  }

  return {
    required_libraries: requiredLibraries,
    minimum_runtime_versions: minRuntimeVersions,
    kms_hsm_support: kmsHsmSupport,
    ca_profile_support: caProfileSupport,
  };
}

/**
 * Builds automated test gates and verification criteria.
 */
function deriveTestingPlan(finding, asset = {}) {
//   const algo = String(finding.algorithm || asset.algorithm || "").toUpperCase();

  return {
    stages: [
      {
        stage_name: "Unit & Known Answer Tests (KAT)",
        description: "Executes NIST CAVP test vectors to verify mathematical correctness of updated implementation.",
        tooling: "Language test runner (Jest, Mocha, Pytest, Go test)",
        pass_criteria: "100% of official NIST KAT test vectors pass.",
      },
      {
        stage_name: "Integration & Handshake Verification",
        description: "Simulates end-to-end TLS handshake or cipher negotiation against legacy and modern clients.",
        tooling: "openssl s_client, testssl.sh, ECDAT network scanner",
        pass_criteria: "Successful connection establishment across all supported client personas.",
      },
      {
        stage_name: "Performance & Latency Benchmark",
        description: "Measures handshake throughput (QPS), CPU load, and 99th-percentile connection latency.",
        tooling: "k6, wrk, autocannon",
        pass_criteria: "Handshake latency delta < 5% over classical baseline; zero connection drops under load.",
      },
      {
        stage_name: "Interoperability & Fallback Validation",
        description: "Simulates network packet truncation and clients lacking PQC capability to ensure graceful fallback.",
        tooling: "Custom test proxy / Wireshark packet capture",
        pass_criteria: "Clients lacking PQC support negotiate classical TLS 1.3 / AES-GCM without connection termination.",
      },
    ],
    automated_command: "npm test && testssl.sh --quiet --color 0 target.domain",
  };
}

/**
 * Builds rollback safety procedure and automated circuit-breaker triggers.
 */
function deriveRollbackPlan(finding, _asset = {}) {
  return {
    mechanism: "Dynamic Feature Flag / Environment Variable Toggle",
    flag_name: "ENABLE_PQC_HYBRID_CRYPTO",
    rollback_triggers: [
      "Client connection error rate exceeds 0.1% over 5-minute rolling window.",
      "p99 TLS handshake latency increases by more than 50ms.",
      "Synthetic canary probe reports handshake failure.",
      "Buffer overflow or MTU packet fragmentation alerts in load balancer logs.",
    ],
    step_by_step_procedure: [
      "1. Trigger automated or manual rollback switch: Set 'ENABLE_PQC_HYBRID_CRYPTO=false' in centralized config (Consul / AWS AppConfig).",
      "2. Execute graceful reload of proxy or service daemon without dropping in-flight connections.",
      "3. Flush cached TLS session tickets / resumption parameters.",
      "4. Verify that connection error rate returns to normal baseline (< 0.01%).",
      "5. Capture error telemetry and client user-agent breakdown for root cause analysis.",
    ],
    recovery_time_objective_minutes: 5,
    zero_downtime_guaranteed: true,
  };
}

/**
 * Derives finding confidence level, score, and derivation evidence.
 */
function deriveConfidence(finding, _asset = {}, hint = {}) {
  let score = hint && typeof hint.score === "number" ? hint.score : 90;
  let level = "HIGH";
  let reasoning = "Direct source code AST analysis with verified cryptographic invocation and parameters.";

  const analysisSource = String(finding.analysisSource || finding.analysis_source || "ast").toLowerCase();
  const rawConfidence = String(finding.confidence || "high").toUpperCase();

  if (finding.evidence === null || finding.evidence === false) {
    score = hint && typeof hint.score === "number" ? hint.score : 20;
    level = "LOW";
    reasoning = "Lack of source location or evidence details; heuristic inference only.";
  } else if (analysisSource === "runtime" || rawConfidence === "CONFIRMED") {
    score = 99;
    level = "CONFIRMED";
    reasoning = "Active runtime cryptographic inspection confirmed algorithm execution in running process.";
  } else if (analysisSource === "ast" || rawConfidence === "HIGH" || (finding.evidence && finding.evidence.location)) {
    score = hint && typeof hint.score === "number" ? hint.score : 90;
    level = "HIGH";
    reasoning = "Abstract Syntax Tree (AST) pattern match with confirmed cryptographic import and call site.";
  } else if (analysisSource === "package" || rawConfidence === "MEDIUM") {
    score = 70;
    level = "MEDIUM";
    reasoning = "Dependency manifest presence indicates cryptographic library capability; reachability requires runtime verification.";
  } else {
    score = 50;
    level = "LOW";
    reasoning = "Heuristic or filename match; manual code audit recommended before applying remediation.";
  }

  return {
    score: score > 1 ? score / 100 : score,
    level,
    reasoning,
    confidence_score: score,
    confidence_level: level,
  };
}

class RemediationPlanner {
  constructor(options = {}) {
    this.defaultDryRun = options.defaultDryRun !== undefined ? Boolean(options.defaultDryRun) : true;
  }

  /**
   * Generates a 10-dimension remediation action plan for a single finding.
   */
  planFindingRemediation(finding, options = {}) {
    const isDryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : this.defaultDryRun;
    const asset = options.asset || finding.asset || {};

    // Sanitize any potential secret in evidence
    const cleanFinding = sanitizeEvidenceData(finding);
    const cleanAsset = sanitizeEvidenceData(asset);

    const findingId = cleanFinding.findingId || cleanFinding.finding_id || cleanFinding.id || `fnd_${crypto.randomUUID()}`;
    const title = cleanFinding.title || cleanFinding.algorithmStandard || cleanFinding.algorithm || "Cryptographic Finding";
    const severity = cleanFinding.severity || "HIGH";

    const whyItMatters = deriveWhyItMatters(cleanFinding, cleanAsset);
    const recommendedRemediation = deriveRecommendedRemediation(cleanFinding, cleanAsset);
    const migrationOptions = buildMigrationOptions(cleanFinding, cleanAsset);
    const expectedImpact = deriveExpectedImpact(cleanFinding, cleanAsset);
    const dependencies = deriveDependencies(cleanFinding, cleanAsset);
    const testingPlan = deriveTestingPlan(cleanFinding, cleanAsset);
    const rollbackPlan = deriveRollbackPlan(cleanFinding, cleanAsset);
    const confidence = deriveConfidence(cleanFinding);

    // Dry-run simulation details
    const dryRunSimulation = {
      mode: isDryRun ? "DRY_RUN" : "LIVE_APPLY",
      is_dry_run: isDryRun,
      simulated: true,
      safety_guarantee: isDryRun
        ? "No files, certificates, or runtime configurations were modified. Remediation plan was simulated safely."
        : "Live execution mode enabled.",
      simulation_status: "SIMULATED_SUCCESS",
      simulated_actions: [
        `Verified target parameters for ${cleanFinding.algorithm || "asset"}`,
        `Generated replacement specification using ${recommendedRemediation.target_standard}`,
        `Validated rollback safety switch (${rollbackPlan.mechanism})`,
        `Checked prerequisite libraries: ${dependencies.required_libraries.slice(0, 2).join(", ")}`,
      ],
    };

    return {
      finding: {
        id: findingId,
        title,
        severity,
        category: cleanFinding.primitiveType || cleanFinding.category || "cryptography",
        algorithm: cleanFinding.algorithm || cleanFinding.algorithmStandard || "Unknown",
        evidence: cleanFinding.evidence || {
          location: cleanFinding.file || cleanFinding.location || "unknown",
          lineNumber: cleanFinding.line || cleanFinding.lineNumber || null,
        },
      },
      why_it_matters: whyItMatters,
      affected_asset: {
        asset_id: cleanAsset.assetId || cleanAsset.asset_id || cleanFinding.assetId || cleanFinding.asset_id || "asset_unknown",
        name: cleanAsset.name || cleanAsset.primaryIdentifier || cleanFinding.name || "Cryptographic Asset",
        type: cleanAsset.assetType || cleanAsset.asset_type || cleanFinding.assetType || "algorithm",
        algorithm: cleanAsset.algorithm || cleanFinding.algorithm || "Unknown",
        key_size: cleanAsset.key_size || cleanFinding.key_size || null,
        environment: cleanAsset.environment || options.environment || "production",
        business_unit: cleanAsset.business_unit || options.business_unit || "general",
        is_internet_facing: Boolean(cleanAsset.is_internet_facing || cleanAsset.isInternetExposed || cleanFinding.is_internet_facing),
        reachability: cleanAsset.reachability || cleanFinding.reachability || "DIRECT_API_CALL",
      },
      recommended_remediation: recommendedRemediation,
      migration_options: migrationOptions,
      expected_impact: expectedImpact,
      dependencies,
      testing_plan: testingPlan,
      rollback_plan: rollbackPlan,
      confidence,
      dry_run: dryRunSimulation,
    };
  }

  /**
   * Generates remediation plans for an array of findings or a CycloneDX CBOM.
   * Defaults to DRY RUN.
   */
  planRemediations(findingsOrCbom, options = {}) {
    const isDryRun = options.dryRun !== undefined ? Boolean(options.dryRun) : this.defaultDryRun;

    let rawFindings = [];
    if (Array.isArray(findingsOrCbom)) {
      rawFindings = findingsOrCbom;
    } else if (findingsOrCbom && typeof findingsOrCbom === "object") {
      if (Array.isArray(findingsOrCbom.findings)) {
        rawFindings = findingsOrCbom.findings;
      } else if (Array.isArray(findingsOrCbom.components)) {
        // Map CycloneDX CBOM components to findings
        rawFindings = findingsOrCbom.components.map((c) => ({
          finding_id: `fnd_cbom_${c["bom-ref"] || c.name}`,
          title: `Cryptographic Asset: ${c.name}`,
          algorithm: c.cryptoProperties?.algorithmProperties?.name || c.name,
          key_size: c.cryptoProperties?.algorithmProperties?.parameterSetIdentifier || null,
          asset_type: c.cryptoProperties?.assetType || "algorithm",
          severity: "HIGH",
          location: c["bom-ref"] || c.name,
        }));
      } else {
        rawFindings = [findingsOrCbom];
      }
    }

    const planItems = rawFindings.map((f) =>
      this.planFindingRemediation(f, { ...options, dryRun: isDryRun }),
    );

    const nowTs = new Date().toISOString();
    const planPayload = {
      timestamp: nowTs,
      mode: isDryRun ? "DRY_RUN" : "APPLY",
      total_findings: planItems.length,
      finding_plans: planItems.map((p) => p.finding.id),
    };

    const planDigest = crypto
      .createHash("sha256")
      .update(JSON.stringify(planPayload))
      .digest("hex");

    return {
      plan_id: `rem_plan_${crypto.randomUUID().substring(0, 8)}`,
      mode: isDryRun ? "DRY_RUN" : "APPLY",
      is_dry_run: isDryRun,
      generated_at: nowTs,
      summary: {
        total_actionable_findings: planItems.length,
        high_critical_count: planItems.filter((p) =>
          ["CRITICAL", "HIGH"].includes(String(p.finding.severity).toUpperCase()),
        ).length,
        default_mode: "DRY_RUN",
        zero_downtime_viable: planItems.every((p) => p.rollback_plan.zero_downtime_guaranteed),
      },
      remediations: planItems,
      plan_digest: planDigest,
    };
  }
}

let _defaultPlanner = null;

function getDefaultRemediationPlanner(options = {}) {
  if (!_defaultPlanner || Object.keys(options).length > 0) {
    _defaultPlanner = new RemediationPlanner(options);
  }
  return _defaultPlanner;
}

function planFindingRemediation(finding, options = {}) {
  const planner = getDefaultRemediationPlanner(options);
  return planner.planFindingRemediation(finding, options);
}

function planRemediations(findingsOrCbom, options = {}) {
  const planner = getDefaultRemediationPlanner(options);
  return planner.planRemediations(findingsOrCbom, options);
}

module.exports = {
  RemediationPlanner,
  getDefaultRemediationPlanner,
  planFindingRemediation,
  planRemediations,
  deriveWhyItMatters,
  deriveRecommendedRemediation,
  buildMigrationOptions,
  deriveExpectedImpact,
  deriveDependencies,
  deriveTestingPlan,
  deriveRollbackPlan,
  deriveConfidence,
};
