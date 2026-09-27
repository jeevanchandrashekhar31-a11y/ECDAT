/**
 * PQC Processing Pipeline — ECDAT Risk Engine Module
 *
 * Implements the 4 mandatory per-asset processing modules:
 *  1. ENVIRONMENT & CONTEXT FILTERING
 *  2. CONTEXT-AWARE REMEDIATION MAPPING (Algorithm → Target PQC)
 *  3. ADVANCED ARCHITECTURAL RISK PARSING
 *  4. DYNAMIC MOSCA MARGIN MATH
 *
 * Every function operates on a single asset/finding node to ensure
 * zero generalized noise and full per-asset context accuracy.
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// MODULE 1: ENVIRONMENT & CONTEXT FILTERING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * TEST / FIXTURE path patterns.
 * If a file path matches any of these, the asset is in a test boundary.
 */
const TEST_PATH_PATTERNS = [
  /[/\\]test[/\\]/i,
  /[/\\]tests[/\\]/i,
  /[/\\]spec[/\\]/i,
  /[/\\]__tests__[/\\]/i,
  /[/\\]fixtures[/\\]/i,
  /[/\\]mocks[/\\]/i,
  /[/\\]stubs[/\\]/i,
  /[/\\]bench[/\\]/i,
  /[/\\]benchmark[/\\]/i,
  /_test\.(go|ts|js|py|java|rs|cpp|c)$/i,
  /\.test\.(ts|js|tsx|jsx)$/i,
  /\.spec\.(ts|js|tsx|jsx)$/i,
  /\.quick\.js$/i,
  /testdata[/\\]/i,
  /test_fixtures[/\\]/i,
];

/**
 * Determines if a file path is inside a test or fixture boundary.
 * @param {string} filePath
 * @returns {boolean}
 */
function isTestEnvironment(filePath) {
  if (!filePath) return false;
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * MODULE 1: Applies environment & context filtering to a finding node.
 *
 * If the asset is inside a test boundary:
 *  - Severity is overridden to "Informational (Test Environment)"
 *  - "TEST_FIXTURE" tag is appended to usage_types
 *  - engineering_alert is suppressed
 *
 * @param {Object} finding - Enriched finding/asset node
 * @param {Object} [options]
 * @param {string} [options.filePath] - Override file path (falls back to finding.location)
 * @returns {{ finding: Object, isTestEnv: boolean, reason: string }}
 */
function applyEnvironmentFilter(finding, options = {}) {
  const filePath = options.filePath || finding.location || finding.file_path || finding.evidenceContext || '';
  const inTestEnv = isTestEnvironment(filePath);

  if (!inTestEnv) {
    return { finding, isTestEnv: false, reason: null };
  }

  // Clone to avoid mutating caller's object
  const enriched = { ...finding };
  enriched.severity = 'Informational (Test Environment)';
  enriched.original_severity = finding.severity;

  // Append TEST_FIXTURE tag
  if (Array.isArray(enriched.usage_types)) {
    if (!enriched.usage_types.includes('TEST_FIXTURE')) {
      enriched.usage_types = [...enriched.usage_types, 'TEST_FIXTURE'];
    }
  } else {
    enriched.usage_types = ['TEST_FIXTURE'];
  }

  // Suppress engineering alerts for predictable test behavior
  enriched.engineering_alert = null;
  enriched.cicd_pass = true; // Test fixtures must never fail CI/CD gates
  enriched.test_environment_override = true;
  enriched.test_environment_note =
    `Finding is localized inside a test/fixture boundary (path: ${filePath}). ` +
    `Severity downgraded from '${finding.severity}' to 'Informational (Test Environment)'. ` +
    `Predictable behaviors (static keys, overridden PRNGs) are expected in this context.`;

  const reason = `Test environment detected via path: ${filePath}`;
  return { finding: enriched, isTestEnv: true, reason };
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 2: CONTEXT-AWARE REMEDIATION MAPPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Algorithm family classification tags.
 */
const ALGO_FAMILIES = {
  ASYMMETRIC_SIGNATURE: new Set([
    'ED25519', 'ED448', 'ECDSA', 'DSA', 'RSA', 'RSA-PSS', 'RSA-PKCS1',
    'SPHINCS', 'SLH-DSA', 'ML-DSA', 'DILITHIUM', 'FALCON', 'RAINBOW',
    'XMSS', 'LMS',
  ]),
  KEY_EXCHANGE_KEM: new Set([
    'X25519', 'X448', 'ECDH', 'DH', 'DIFFIE-HELLMAN', 'RSA-OAEP',
    'RSA-PKCS1-KEM', 'ML-KEM', 'KYBER', 'NTRU', 'SABER', 'FRODO',
    'HQCKEM', 'BIKE', 'CLASSIC-MCELIECE',
  ]),
  NETWORK_LAYER: new Set([
    'TLS', 'TLS1.0', 'TLS1.1', 'TLS1.2', 'TLS1.3',
    'DTLS', 'SSL', 'SSH', 'IPSEC', 'IKEV2', 'QUIC',
  ]),
  SYMMETRIC: new Set([
    'AES', 'AES-128', 'AES-192', 'AES-256', 'CHACHA20', 'CHACHA20-POLY1305',
    'XCHACHA20', 'SALSA20', 'XSALSA20', 'BLOWFISH', 'DES', '3DES',
    'RC2', 'RC4', 'CAST5', 'TWOFISH',
  ]),
  HASH: new Set([
    'SHA-2', 'SHA-256', 'SHA-384', 'SHA-512', 'SHA3-256', 'SHA3-384',
    'SHA3-512', 'BLAKE2', 'BLAKE3', 'MD5', 'SHA-1', 'SHA-224',
    'HMAC-SHA256', 'HMAC-SHA512', 'POLY1305',
  ]),
};

const ASSET_TYPE_NETWORK = new Set([
  'network_session', 'tls_endpoint', 'ssh_endpoint', 'ipsec_endpoint',
  'protocol', 'openssl_tls', 'ssl_context', 'network_endpoint',
]);

/**
 * Resolves the algorithm family for a given algorithm name.
 * Network asset types take precedence over algorithm-based classification.
 */
function resolveAlgoFamily(algoName, assetType) {
  const upper = (algoName || '').toUpperCase().replace(/[-_\s]/g, '');
  const assetUpper = (assetType || '').toLowerCase();

  if (ASSET_TYPE_NETWORK.has(assetUpper) || upper.startsWith('TLS') || upper === 'SSL' || upper === 'SSH' || upper === 'IPSEC') {
    return 'NETWORK_LAYER';
  }
  if (ALGO_FAMILIES.NETWORK_LAYER.has(upper)) return 'NETWORK_LAYER';
  if (ALGO_FAMILIES.KEY_EXCHANGE_KEM.has(upper)) return 'KEY_EXCHANGE_KEM';
  if (ALGO_FAMILIES.ASYMMETRIC_SIGNATURE.has(upper)) return 'ASYMMETRIC_SIGNATURE';
  if (ALGO_FAMILIES.HASH.has(upper)) return 'HASH';
  if (ALGO_FAMILIES.SYMMETRIC.has(upper)) return 'SYMMETRIC';

  // Partial prefix matching fallbacks
  if (upper.startsWith('ECDSA') || upper.startsWith('RSASIG') || upper.startsWith('ED2') || upper.startsWith('ED4')) {
    return 'ASYMMETRIC_SIGNATURE';
  }
  if (upper.startsWith('ECDH') || upper.startsWith('X25') || upper.startsWith('X44') || upper.startsWith('DH')) {
    return 'KEY_EXCHANGE_KEM';
  }
  if (upper.startsWith('AES') || upper.startsWith('CHACHA') || upper.startsWith('SALSA')) {
    return 'SYMMETRIC';
  }
  if (upper.startsWith('SHA') || upper.startsWith('BLAKE') || upper.startsWith('HMAC')) {
    return 'HASH';
  }

  return 'UNKNOWN';
}

/**
 * MODULE 2: Produces context-aware PQC remediation mapping for a finding.
 *
 * Never recommends TLS changes for application-level primitives.
 * Explicitly maps algorithm family → NIST PQC target.
 *
 * @param {Object} finding
 * @returns {{
 *   family: string,
 *   recommended_target: string,
 *   technical_rationale: string,
 *   hybrid_transition_recommended: boolean,
 *   nist_standard: string,
 *   migration_complexity: string,
 * }}
 */
function applyContextAwareRemediation(finding) {
  const algo = finding.algorithm || finding.canonicalAlgorithm || finding.canonicalAlgo || 'Unknown';
  const assetType = finding.asset_type || finding.assetType || 'unknown';
  const keySize = finding.key_size || finding.keySize || null;
  const family = resolveAlgoFamily(algo, assetType);

  switch (family) {
    case 'ASYMMETRIC_SIGNATURE':
      return {
        family,
        recommended_target: 'Migrate to ML-DSA (FIPS 204) for quantum-resistant digital signatures.',
        technical_rationale:
          'ML-DSA provides lattice-based digital signature security under Module-LWE assumptions, ' +
          'neutralizing Shor\'s algorithm threat vectors against public-key signing verification architectures. ' +
          `Current algorithm '${algo}' is vulnerable to polynomial-time quantum period-finding attacks.`,
        hybrid_transition_recommended: true,
        hybrid_note: 'During transition period, deploy dual-signature schemes (e.g., Ed25519 + ML-DSA-65) for backward compatibility.',
        nist_standard: 'NIST FIPS 204 (ML-DSA) — Module-Lattice-Based Digital Signature Standard',
        migration_complexity: algo.toUpperCase() === 'RSA' && keySize && keySize >= 4096 ? 'high' : 'medium',
      };

    case 'KEY_EXCHANGE_KEM':
      return {
        family,
        recommended_target: 'Migrate to ML-KEM (FIPS 203) or deploy a hybrid combiner (e.g., X25519 + ML-KEM-768).',
        technical_rationale:
          'ML-KEM secures key distribution frameworks against Harvest Now, Decrypt Later (HNDL) attacks by ' +
          'leveraging Module Learning with Errors (Module-LWE). Classical KEM algorithms including ' +
          `'${algo}' are vulnerable to Shor\'s algorithm which can derive private keys from public keys in polynomial time on a CRQC.`,
        hybrid_transition_recommended: true,
        hybrid_note: 'Hybrid X25519+ML-KEM-768 (IETF draft-tls-kem-combiners) provides strong classical + PQC security during transition.',
        nist_standard: 'NIST FIPS 203 (ML-KEM) — Module-Lattice-Based Key-Encapsulation Mechanism Standard',
        migration_complexity: 'medium',
      };

    case 'NETWORK_LAYER':
      return {
        family,
        recommended_target:
          'Enable TLS 1.3 with X25519MLKEM768 (or SecP256r1MLKEM768) hybrid key exchange group; ' +
          'deploy PQC-capable cipher suite negotiation at the transport layer.',
        technical_rationale:
          `Network layer asset '${algo}' exposes session keys to Harvest Now, Decrypt Later (HNDL) attacks. ` +
          'Upgrading to TLS 1.3 with hybrid key exchange eliminates retrospective decryption exposure for recorded ciphertext. ' +
          'IANA-registered group X25519MLKEM768 (TLS code point 0x11EC) provides hybrid PQC KEM with classical fallback.',
        hybrid_transition_recommended: true,
        hybrid_note: 'X25519MLKEM768 is available in OpenSSL 3.2+, BoringSSL, Go 1.23+, and libsodium-based stacks.',
        nist_standard: 'NIST FIPS 203 (ML-KEM) + RFC 8446 (TLS 1.3) + IETF draft-connolly-tls-mlkem-key-agreement',
        migration_complexity: 'low',
      };

    case 'SYMMETRIC':
    case 'HASH': {
      const isWeak = ['MD5', 'SHA-1', 'DES', '3DES', 'RC2', 'RC4'].includes((algo || '').toUpperCase());
      if (isWeak) {
        return {
          family,
          recommended_target: `Immediately replace ${algo} — this algorithm has known classical vulnerabilities independent of quantum threat.`,
          technical_rationale:
            `'${algo}' is classically broken or deprecated (e.g., MD5/SHA-1 collision attacks, DES exhaustive search). ` +
            'Upgrade to SHA-256/SHA-3 for hashes, or AES-256-GCM for symmetric encryption. ' +
            'Post-quantum, AES-256 retains approximately 128 bits of security against Grover\'s algorithm.',
          hybrid_transition_recommended: false,
          nist_standard: 'NIST SP 800-131A Rev 2 + NIST FIPS 197 (AES) + NIST FIPS 202 (SHA-3)',
          migration_complexity: 'low',
        };
      }
      const effectiveBits = family === 'HASH' ? (keySize || 256) : (keySize || 256);
      const groverReduction = Math.floor(effectiveBits / 2);
      return {
        family,
        recommended_target:
          `Maintain current implementation; verify key/hash sizes remain ≥ 256 bits (≥ ${groverReduction} bits post-Grover) to remain structurally secure against Grover's algorithm quantum speedups.`,
        technical_rationale:
          `Symmetric and hash primitives are not vulnerable to Shor's algorithm. Grover's algorithm provides only a quadratic speedup (square-root reduction in effective key space). ` +
          `'${algo}' with ${effectiveBits}-bit keys retains ~${groverReduction} bits of post-quantum security. ` +
          'No structural migration required at current key sizes ≥ 256 bits.',
        hybrid_transition_recommended: false,
        nist_standard: 'NIST SP 800-57 Part 1 Rev 5 — Post-quantum symmetric key guidance',
        migration_complexity: 'none',
      };
    }

    default:
      return {
        family: 'UNKNOWN',
        recommended_target: 'Evaluate NIST FIPS 203 (ML-KEM) and FIPS 204 (ML-DSA) migration roadmaps based on algorithm role.',
        technical_rationale: `Algorithm '${algo}' could not be classified into a known PQC migration family. Manual cryptographic review required.`,
        hybrid_transition_recommended: false,
        nist_standard: 'NIST Post-Quantum Cryptography Standardization',
        migration_complexity: 'unknown',
      };
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3: ADVANCED ARCHITECTURAL RISK PARSING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known algorithm-specific implementation vulnerabilities database.
 * Covers signature malleability, commitment failures, length-extension attacks, etc.
 */
const ARCHITECTURAL_FLAW_DB = {
  'ED25519': [
    {
      flaw_id: 'ARCH-ED25519-MALLEABLE',
      title: 'Signature Malleability (Cofactor Non-Canonicality)',
      severity: 'medium',
      description:
        'Ed25519 is vulnerable to signature malleability in implementations that do not enforce strict ' +
        'point canonicalization (RFC 8032 §5.1). Non-canonical encodings of valid signatures can be ' +
        'forged to produce a different but valid signature byte-string, breaking uniqueness assumptions in ' +
        'systems that use signature bytes as idempotency keys or deduplication tokens.',
      affected_contexts: ['blockchain_transactions', 'idempotency_systems', 'api_replay_protection'],
      mitigation: 'Enforce cofactor-aware verification (verify8 / libsodium strict-mode). Do not use raw Ed25519 signature bytes as unique identifiers.',
      references: ['RFC 8032', 'CVE-2022-21449 (Java/Impl)', 'https://hdevalence.ca/blog/2020-10-05-view-types'],
    },
  ],
  'XSALSA20-POLY1305': [
    {
      flaw_id: 'ARCH-XSALSA20-COMMITMENT',
      title: 'Lack of Commitment in XSalsa20-Poly1305 AEAD',
      severity: 'high',
      description:
        'XSalsa20-Poly1305 (libsodium secretbox) does not provide key commitment. An adversary can ' +
        'craft a ciphertext that successfully authenticates under two different keys simultaneously. ' +
        'This breaks security assumptions in key-wrapping, multi-recipient encrypted messages, and ' +
        'commit-then-encrypt protocols (e.g., encrypted OPAQUE password protocols).',
      affected_contexts: ['multi_recipient_encryption', 'key_wrapping', 'commit_reveal_protocols'],
      mitigation: 'Use a committing AEAD such as AES-256-GCM-SIV (RFC 8452), AEGIS-256, or prepend a key commitment hash (e.g., HKDF-SHA256(key, "commit")) before authentication.',
      references: ['https://eprint.iacr.org/2020/1491', 'Rae et al. "Partitioning Oracle Attacks"'],
    },
  ],
  'SHA-512': [
    {
      flaw_id: 'ARCH-SHA512-LENGTHEXT',
      title: 'Length Extension Vulnerability (Merkle-Damgård Construction)',
      severity: 'medium',
      description:
        'SHA-512, like all Merkle-Damgård hash functions, is vulnerable to length-extension attacks. ' +
        'An attacker who knows H(message) and the length of "message" can compute H(message || padding || suffix) ' +
        'without knowing "message". This breaks naive HMAC-style MAC constructions built as H(key || message).',
      affected_contexts: ['naive_hmac', 'api_signature_verification', 'message_authentication_codes'],
      mitigation: 'Use HMAC-SHA-512 (RFC 2104) or switch to SHA-3 / BLAKE3 which are immune to length-extension attacks by design.',
      references: ['NIST SP 800-107', 'RFC 2104 §2'],
    },
  ],
  'SHA-256': [
    {
      flaw_id: 'ARCH-SHA256-LENGTHEXT',
      title: 'Length Extension Vulnerability (Merkle-Damgård Construction)',
      severity: 'medium',
      description:
        'SHA-256 is vulnerable to length-extension attacks due to its Merkle-Damgård construction. ' +
        'If H(key || message) is used as a MAC without HMAC padding, an attacker can extend authenticated messages.',
      affected_contexts: ['naive_hmac', 'web_api_signatures'],
      mitigation: 'Use HMAC-SHA-256 or switch to SHA-3/BLAKE2b which are inherently resistant.',
      references: ['NIST SP 800-107', 'RFC 2104'],
    },
  ],
  'RSA': [
    {
      flaw_id: 'ARCH-RSA-PKCS1-PADDING',
      title: 'PKCS#1 v1.5 Bleichenbacher Oracle (RSA Padding)',
      severity: 'critical',
      description:
        'RSA encryption with PKCS#1 v1.5 padding is vulnerable to Bleichenbacher\'s chosen-ciphertext attack (1998). ' +
        'An oracle can be exploited to decrypt ciphertexts or forge signatures across millions of adaptive queries. ' +
        'Widely exploited (ROBOT attack, 2017 — affected F5, Citrix, Cisco, Radware).',
      affected_contexts: ['tls_key_exchange', 'api_token_encryption', 'session_key_distribution'],
      mitigation: 'Migrate to RSA-OAEP (RFC 8017) for encryption, RSA-PSS for signatures. Prefer ECDH/X25519 for key exchange entirely.',
      references: ['RFC 8017', 'CVE-2017-17382 (ROBOT)', 'Bleichenbacher 1998'],
    },
    {
      flaw_id: 'ARCH-RSA-TIMING',
      title: 'Timing Side-Channel in RSA CRT Implementations',
      severity: 'high',
      description:
        'RSA implementations using Chinese Remainder Theorem optimization are vulnerable to timing attacks ' +
        'if Montgomery multiplication is not constant-time. Hardware and software faults can also leak private key bits.',
      affected_contexts: ['software_tls', 'hsm_without_blinding'],
      mitigation: 'Verify constant-time implementation (e.g., OpenSSL BN_BLINDING is enabled). Prefer elliptic curve cryptography (P-256 / X25519) over RSA where possible.',
      references: ['Kocher 1996', 'NIST SP 800-131A Rev 2'],
    },
  ],
  'ECDSA': [
    {
      flaw_id: 'ARCH-ECDSA-NONCE-REUSE',
      title: 'Catastrophic Nonce Reuse in ECDSA (k-reuse)',
      severity: 'critical',
      description:
        'ECDSA requires a uniformly random per-signature nonce (k). If the same nonce is used for two different ' +
        'messages, the private key can be recovered with simple algebra. This has caused multiple high-profile ' +
        'key compromises (PS3 master key, Bitcoin wallet attacks).',
      affected_contexts: ['firmware_signing', 'blockchain_wallets', 'jwt_signing'],
      mitigation: 'Use deterministic ECDSA (RFC 6979) which derives k from the key and message hash, eliminating PRNG dependency entirely. Or migrate to Ed25519 / ML-DSA.',
      references: ['RFC 6979', 'PS3 ECDSA break (fail0verflow 2010)', 'Bitcoin address reuse attacks'],
    },
  ],
  'AES-GCM': [
    {
      flaw_id: 'ARCH-AESGCM-NONCE-REUSE',
      title: 'Authentication Key Recovery on Nonce Reuse in AES-GCM',
      severity: 'critical',
      description:
        'AES-GCM is catastrophically vulnerable to nonce reuse. If the same (key, nonce) pair is used to encrypt ' +
        'two different plaintexts, both messages are revealed via XOR, and the authentication key (H) can be ' +
        'recovered, allowing the attacker to forge arbitrary authenticated ciphertexts for any future messages.',
      affected_contexts: ['bulk_encryption', 'database_encryption', 'file_encryption'],
      mitigation: 'Use AES-256-GCM-SIV (RFC 8452) which is nonce-misuse resistant, or AEGIS-256. If standard GCM is kept, enforce strict random 96-bit nonce generation per message with collision probability monitoring.',
      references: ['RFC 8452', 'Joux 2006', 'NIST SP 800-38D'],
    },
  ],
};

/**
 * MODULE 3: Parses architectural implementation-specific vulnerabilities for an asset.
 *
 * @param {Object} finding
 * @returns {Array<Object>} architectural_flaws array (empty if none known)
 */
function applyArchitecturalRiskParsing(finding) {
  const algo = (finding.algorithm || finding.canonicalAlgorithm || '').toUpperCase().replace(/\s/g, '-');
  const flaws = [];

  // Exact match
  for (const [key, knownFlaws] of Object.entries(ARCHITECTURAL_FLAW_DB)) {
    const keyUpper = key.toUpperCase().replace(/\s/g, '-');
    if (algo === keyUpper || algo.startsWith(keyUpper) || keyUpper.startsWith(algo)) {
      flaws.push(...knownFlaws);
    }
  }

  // Partial match fallback (e.g., "AES-256-GCM" → "AES-GCM" flaws)
  if (flaws.length === 0) {
    for (const [key, knownFlaws] of Object.entries(ARCHITECTURAL_FLAW_DB)) {
      const keyUpper = key.toUpperCase().replace(/\s/g, '-');
      if (algo.includes(keyUpper) || keyUpper.includes(algo)) {
        flaws.push(...knownFlaws);
      }
    }
  }

  return flaws;
}


// ─────────────────────────────────────────────────────────────────────────────
// MODULE 4: DYNAMIC MOSCA MARGIN MATH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Data sensitivity → shelf life (X) in years.
 * How long the data must remain confidential.
 */
const SENSITIVITY_SHELF_LIFE = {
  public: 0,
  internal: 3,
  confidential: 7,
  restricted: 15,
  top_secret: 25,
};

/**
 * Asset type → migration engineering time (Y) in years.
 * How long it takes to fully migrate this type of system.
 */
const ASSET_MIGRATION_TIME = {
  network_session: 1.0,
  tls_endpoint: 1.0,
  library_presence: 0.5,
  signing_key: 2.0,
  certificate: 1.5,
  stored_encrypted_data: 3.0,
  hardcoded_private_key: 0.5,
  firmware: 4.0,
  hardware_security_module: 5.0,
  protocol: 1.5,
  default: 2.0,
};

/**
 * Threat horizon scenarios → Z (estimated years until CRQC).
 */
const THREAT_HORIZONS = {
  optimistic: 15,
  baseline: 9,
  baseline_2033: 9,
  conservative: 6,
  aggressive: 4,
};

/**
 * MODULE 4: Computes dynamic per-asset Mosca Margin Math.
 *
 * X (Data Shelf Life) + Y (Migration Engineering Time) vs Z (Quantum Threat Horizon)
 * If (X + Y) >= Z → escalate urgency to Critical/Urgent.
 *
 * @param {Object} finding
 * @param {Object} [options]
 * @param {string} [options.threatHorizon] - Override scenario key
 * @param {number} [options.customX] - Override X in years
 * @param {number} [options.customY] - Override Y in years
 * @param {number} [options.customZ] - Override Z in years
 * @returns {{
 *   x_shelf_life_years: number,
 *   y_migration_years: number,
 *   z_threat_horizon_years: number,
 *   mosca_total: number,
 *   mosca_margin: number,
 *   urgency: string,
 *   why_now: string,
 *   severity_escalated: boolean,
 *   escalated_to: string | null,
 * }}
 */
function applyDynamicMoscaMath(finding, options = {}) {
  const dataSensitivity = (finding.data_sensitivity || finding.dataSensitivity || 'internal').toLowerCase();
  const assetType = (finding.asset_type || finding.assetType || 'default').toLowerCase();
  const threatHorizonKey = options.threatHorizon || finding.threat_horizon || finding.threatHorizon || 'baseline';
  const algoFamily = resolveAlgoFamily(finding.algorithm || finding.canonicalAlgorithm || '', assetType);

  // Non-quantum-vulnerable assets (symmetric, hash) → X = 0, no urgency escalation
  const isQuantumVulnerable = algoFamily === 'ASYMMETRIC_SIGNATURE' || algoFamily === 'KEY_EXCHANGE_KEM' || algoFamily === 'NETWORK_LAYER';
  
  // X: Data shelf life
  let X;
  if (options.customX !== undefined && options.customX !== null) {
    X = Number(options.customX);
  } else if (!isQuantumVulnerable) {
    X = 0; // Symmetric/hash algorithms are not subject to HNDL
  } else {
    X = SENSITIVITY_SHELF_LIFE[dataSensitivity] ?? SENSITIVITY_SHELF_LIFE.internal;
  }

  // Y: Migration time
  let Y;
  if (options.customY !== undefined && options.customY !== null) {
    Y = Number(options.customY);
  } else {
    const normalizedType = Object.keys(ASSET_MIGRATION_TIME).find((k) => assetType.includes(k)) || 'default';
    Y = ASSET_MIGRATION_TIME[normalizedType];
  }

  // Z: Quantum threat horizon
  let Z;
  if (options.customZ !== undefined && options.customZ !== null) {
    Z = Number(options.customZ);
  } else {
    const horizonNorm = threatHorizonKey.toLowerCase().replace(/[_\s]/g, '');
    Z = THREAT_HORIZONS[horizonNorm] ?? THREAT_HORIZONS.baseline;
  }

  const moscaTotal = parseFloat((X + Y).toFixed(2));
  const moscaMargin = parseFloat((moscaTotal - Z).toFixed(2));

  // Determine urgency based on margin
  let urgency;
  let why_now;
  let severity_escalated = false;
  let escalated_to = null;

  if (!isQuantumVulnerable) {
    urgency = 'SAFE';
    why_now =
      `Algorithm family (${algoFamily}) is not vulnerable to Shor's algorithm. ` +
      'Grover speedup applies only quadratically; no urgent migration required at current key sizes.';
  } else if (moscaMargin > 2.5) {
    urgency = 'CRITICAL_URGENT';
    severity_escalated = true;
    escalated_to = 'Critical';
    why_now =
      `CRITICAL: (X + Y = ${moscaTotal} yrs) exceeds quantum threat horizon Z = ${Z} yrs by ${moscaMargin} yrs. ` +
      `Data classified '${dataSensitivity}' must remain protected for ${X} years, but migration will take ${Y} years — ` +
      `the combined window has already surpassed CRQC arrival estimates. Immediate migration required.`;
  } else if (moscaMargin > 0) {
    urgency = 'AT_RISK';
    severity_escalated = true;
    escalated_to = 'High';
    why_now =
      `AT RISK: Combined shelf-life and migration duration (${moscaTotal} yrs) exceeds quantum threat horizon Z (${Z} yrs) ` +
      `by ${moscaMargin} yrs. Migration must begin within the next 6-12 months to avoid falling behind CRQC timeline.`;
  } else if (moscaMargin > -2.0) {
    urgency = 'WATCH';
    why_now =
      `WATCH: Mosca margin (${Math.abs(moscaMargin)} yrs buffer) is within the 2-year policy warning zone. ` +
      `Migration planning and vendor evaluation should begin now before the window closes.`;
  } else {
    urgency = 'SAFE';
    why_now =
      `SAFE: ${Math.abs(moscaMargin)} years of quantum safety margin remaining. ` +
      `Schedule migration within the next 3-5 years as part of standard cryptographic agility programme.`;
  }

  return {
    x_shelf_life_years: X,
    y_migration_years: Y,
    z_threat_horizon_years: Z,
    mosca_total: moscaTotal,
    mosca_margin: moscaMargin,
    urgency,
    why_now,
    severity_escalated,
    escalated_to,
    is_quantum_vulnerable: isQuantumVulnerable,
    algo_family: algoFamily,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// MASTER PIPELINE: Run all 4 modules and enrich a finding node
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the full 4-module PQC Processing Pipeline on a single finding/asset node.
 *
 * Returns a fully enriched finding with:
 *  - Environment classification + TEST_FIXTURE tagging
 *  - Precise PQC remediation recommendation (never cross-layer)
 *  - Architectural flaw catalogue
 *  - Per-asset Mosca margin with dynamic urgency escalation
 *
 * @param {Object} finding - Raw or partially enriched finding/asset node
 * @param {Object} [options]
 * @param {string} [options.threatHorizon]
 * @param {number} [options.customX]
 * @param {number} [options.customY]
 * @param {number} [options.customZ]
 * @returns {Object} Fully enriched finding with pqc_pipeline attribute
 */
function runPqcPipeline(finding, options = {}) {
  // Module 1: Environment & Context Filtering
  const { finding: envFiltered, isTestEnv, reason: envReason } = applyEnvironmentFilter(finding, options);

  // Module 2: Context-Aware Remediation Mapping
  const remediation = applyContextAwareRemediation(envFiltered);

  // Module 3: Architectural Risk Parsing
  const architecturalFlaws = applyArchitecturalRiskParsing(envFiltered);

  // Module 4: Dynamic Mosca Margin Math
  // Skip Mosca escalation for test environment assets
  const moscaMath = isTestEnv
    ? { urgency: 'INFORMATIONAL', why_now: 'Test environment — Mosca escalation suppressed.', severity_escalated: false, escalated_to: null }
    : applyDynamicMoscaMath(envFiltered, options);

  // Apply Mosca-driven severity escalation (only if not already critical from classifier)
  let finalSeverity = envFiltered.severity;
  if (
    !isTestEnv &&
    moscaMath.severity_escalated &&
    moscaMath.escalated_to &&
    !['Critical', 'Informational (Test Environment)'].includes(finalSeverity)
  ) {
    if (moscaMath.escalated_to === 'Critical' && finalSeverity !== 'Critical') {
      finalSeverity = 'Critical';
    } else if (moscaMath.escalated_to === 'High' && !['Critical', 'High'].includes(finalSeverity)) {
      finalSeverity = 'High';
    }
  }

  // Build enriched node
  const enriched = {
    ...envFiltered,
    severity: finalSeverity,
    pqc_pipeline: {
      pipeline_version: '2026.1',
      processed_at: new Date().toISOString(),
      modules_applied: ['ENV_FILTER', 'REMEDIATION_MAP', 'ARCH_RISK_PARSE', 'MOSCA_MARGIN'],

      // Module 1 output
      environment: {
        is_test_environment: isTestEnv,
        detection_reason: envReason || null,
        test_environment_note: envFiltered.test_environment_note || null,
      },

      // Module 2 output
      remediation: {
        algo_family: remediation.family,
        recommended_target: remediation.recommended_target,
        technical_rationale: remediation.technical_rationale,
        hybrid_transition_recommended: remediation.hybrid_transition_recommended,
        hybrid_note: remediation.hybrid_note || null,
        nist_standard: remediation.nist_standard,
        migration_complexity: remediation.migration_complexity,
      },

      // Module 3 output
      architectural_flaws: architecturalFlaws,
      has_architectural_flaws: architecturalFlaws.length > 0,
      architectural_flaw_count: architecturalFlaws.length,

      // Module 4 output
      mosca_dynamic: {
        x_shelf_life_years: moscaMath.x_shelf_life_years,
        y_migration_years: moscaMath.y_migration_years,
        z_threat_horizon_years: moscaMath.z_threat_horizon_years,
        mosca_total: moscaMath.mosca_total,
        mosca_margin: moscaMath.mosca_margin,
        urgency: moscaMath.urgency,
        why_now: moscaMath.why_now,
        severity_escalated: moscaMath.severity_escalated,
        escalated_to: moscaMath.escalated_to,
        is_quantum_vulnerable: moscaMath.is_quantum_vulnerable,
        algo_family: moscaMath.algo_family,
      },
    },
  };

  return enriched;
}

/**
 * Runs the PQC pipeline across an array of finding/asset nodes.
 * Safe to use on top_risky_assets arrays from the dashboard views service.
 *
 * @param {Array<Object>} findings
 * @param {Object} [options]
 * @returns {Array<Object>} Enriched array
 */
function runPqcPipelineOnArray(findings, options = {}) {
  if (!Array.isArray(findings)) return [];
  return findings.map((f) => {
    try {
      return runPqcPipeline(f, options);
    } catch (_err) {
      // Never crash the pipeline — return original finding with error annotation
      return { ...f, pqc_pipeline: { error: _err.message, pipeline_version: '2026.1' } };
    }
  });
}

module.exports = {
  runPqcPipeline,
  runPqcPipelineOnArray,
  // Expose individual modules for unit testing
  applyEnvironmentFilter,
  applyContextAwareRemediation,
  applyArchitecturalRiskParsing,
  applyDynamicMoscaMath,
  isTestEnvironment,
  resolveAlgoFamily,
  ARCHITECTURAL_FLAW_DB,
  THREAT_HORIZONS,
};
