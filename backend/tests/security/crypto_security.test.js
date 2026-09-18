/**
 * Phase 22 (P1) Cryptographic Security & Algorithm Classification Tests (Node.js)
 *
 * Verifies:
 * - Approved algorithms
 * - Secure randomness
 * - Secure key generation
 * - Key separation (domain isolation)
 * - Authenticated encryption (AEAD)
 * - Secure hashing
 * - Password hashing (memory-hard scrypt)
 * - Constant-time comparisons (RangeError and length-leakage safe)
 * - Secure key storage
 * - Zeroization where practical
 * - No hardcoded production secrets
 *
 * Explicitly tests 4 canonical classes:
 * - quantum-vulnerable
 * - quantum-resistant
 * - hybrid
 * - unknown
 *
 * Explicitly verifies that PQC security is NOT inferred solely from algorithm names.
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const app = require("../../src/app");
const config = require("../../src/config");
const {
  CryptoClassifier,
  CLASS_QUANTUM_VULNERABLE,
  CLASS_QUANTUM_RESISTANT,
  CLASS_HYBRID,
  CLASS_UNKNOWN,
} = require("../../src/security/crypto_classifier");
const {
  timingSafeCompare,
  zeroize,
  withZeroizedBuffer,
  deriveDomainKey,
  KEY_DOMAINS,
  CryptoSecurityService,
} = require("../../src/security/crypto_security_service");
const { EncryptionAtRestService } = require("../../src/security/encryption_at_rest");

describe("Phase 22 / P1 — Cryptographic Security & Algorithm Classifier", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // -------------------------------------------------------------------------
  // 1. PQC Classification Tests (4 Canonical Classes)
  // -------------------------------------------------------------------------
  describe("PQC Algorithm Classification Engine", () => {
    test("1.1 Classifies Shor-vulnerable asymmetric algorithms as 'quantum-vulnerable'", () => {
      const shorAlgos = [
        ["RSA-2048", 2048],
        ["RSA-4096", 4096],
        ["ECDSA-P256", 256],
        ["ECDSA-P384", 384],
        ["ECDH-P256", 256],
        ["Ed25519", 256],
        ["X25519", 256],
        ["Diffie-Hellman", 2048],
        ["DSA", 2048],
      ];

      for (const [algo, ksize] of shorAlgos) {
        const res = CryptoClassifier.classify(algo, { keySize: ksize });
        assert.equal(
          res.classification,
          CLASS_QUANTUM_VULNERABLE,
          `Expected ${algo} to be classified as quantum-vulnerable`
        );
        assert.equal(res.threatModel, "Shor");
        assert.ok(res.justification.includes("Shor's algorithm"));
      }
    });

    test("1.2 Does NOT infer PQC solely from name: distinguishes AES-128 (vulnerable) from AES-256 (resistant)", () => {
      // AES-128 key length is reduced to 64-bit effective quantum search space by Grover
      const aes128Res = CryptoClassifier.classify("AES-128-GCM", { keySize: 128 });
      assert.equal(
        aes128Res.classification,
        CLASS_QUANTUM_VULNERABLE,
        "AES-128 must be classified as quantum-vulnerable under Grover's algorithm"
      );
      assert.equal(aes128Res.threatModel, "Grover");
      assert.ok(aes128Res.justification.includes("Grover's algorithm"));

      // AES-256 retains 128-bit quantum security margin under Grover
      const aes256Res = CryptoClassifier.classify("AES-256-GCM", { keySize: 256 });
      assert.equal(
        aes256Res.classification,
        CLASS_QUANTUM_RESISTANT,
        "AES-256 must be classified as quantum-resistant under Grover's algorithm"
      );
      assert.equal(aes256Res.threatModel, "Grover");
    });

    test("1.3 Classifies verified NIST standardized PQC algorithms as 'quantum-resistant'", () => {
      // FIPS 203 ML-KEM
      const mlkem512 = CryptoClassifier.classify("ML-KEM-512");
      assert.equal(mlkem512.classification, CLASS_QUANTUM_RESISTANT);
      assert.equal(mlkem512.nistPqcCategory, 1);

      const mlkem768 = CryptoClassifier.classify("ML-KEM-768");
      assert.equal(mlkem768.classification, CLASS_QUANTUM_RESISTANT);
      assert.equal(mlkem768.nistPqcCategory, 3);

      const mlkem1024 = CryptoClassifier.classify("ML-KEM-1024");
      assert.equal(mlkem1024.classification, CLASS_QUANTUM_RESISTANT);
      assert.equal(mlkem1024.nistPqcCategory, 5);

      // FIPS 204 ML-DSA
      const mldsa65 = CryptoClassifier.classify("ML-DSA-65");
      assert.equal(mldsa65.classification, CLASS_QUANTUM_RESISTANT);
      assert.equal(mldsa65.nistPqcCategory, 3);

      // FIPS 205 SLH-DSA
      const slhdsa = CryptoClassifier.classify("SLH-DSA-SHA2-128s");
      assert.equal(slhdsa.classification, CLASS_QUANTUM_RESISTANT);

      // Stateful Hash (LMS/XMSS)
      const lms = CryptoClassifier.classify("LMS_SHA256_M32_H10");
      assert.equal(lms.classification, CLASS_QUANTUM_RESISTANT);

      // Falcon
      const falcon = CryptoClassifier.classify("Falcon-512");
      assert.equal(falcon.classification, CLASS_QUANTUM_RESISTANT);
    });

    test("1.4 Does NOT infer PQC solely from name: invalid/unverified PQC parameters classified as 'unknown'", () => {
      // Has 'ML-KEM' in name but invalid parameter set (999 does not exist in FIPS 203)
      const fakeMlkem = CryptoClassifier.classify("ML-KEM-999");
      assert.equal(
        fakeMlkem.classification,
        CLASS_UNKNOWN,
        "ML-KEM with invalid parameter set must be classified as unknown"
      );
      assert.ok(fakeMlkem.justification.includes("lacks a standard parameter set"));

      // Has 'Kyber' in name but invalid parameter set
      const fakeKyber = CryptoClassifier.classify("Kyber-Invalid");
      assert.equal(fakeKyber.classification, CLASS_UNKNOWN);

      // Has 'ML-DSA' in name but invalid parameter set
      const fakeMldsa = CryptoClassifier.classify("ML-DSA-99");
      assert.equal(fakeMldsa.classification, CLASS_UNKNOWN);

      // Claims 'quantumsafe' in string but unstandardized
      const unverifiedClaim = CryptoClassifier.classify("MyCompanyQuantumSafeCipher-v1");
      assert.equal(unverifiedClaim.classification, CLASS_UNKNOWN);

      // AES without key size cannot infer Grover resistance -> unknown
      const bareAes = CryptoClassifier.classify("AES");
      assert.equal(bareAes.classification, CLASS_UNKNOWN);
    });

    test("1.5 Classifies valid hybrid combinations as 'hybrid'", () => {
      // Standard IETF hybrid key exchange group
      const x25519Mlkem = CryptoClassifier.classify("X25519MLKEM768");
      assert.equal(x25519Mlkem.classification, CLASS_HYBRID);
      assert.equal(x25519Mlkem.threatModel, "Validated_Hybrid");
      assert.equal(x25519Mlkem.hybridDetails.classical_component, "X25519");
      assert.equal(x25519Mlkem.hybridDetails.post_quantum_component, "ML-KEM-768");

      // SecP256r1MLKEM768
      const secp256Mlkem = CryptoClassifier.classify("SecP256r1MLKEM768");
      assert.equal(secp256Mlkem.classification, CLASS_HYBRID);

      // Explicit hybrid components object
      const customHybrid = CryptoClassifier.classify("CustomHybridGroup", {
        hybridComponents: {
          classical: "ECDH-P256",
          pqc: "ML-KEM-768",
          combiner: "IETF Dual-KEM HKDF",
        },
      });
      assert.equal(customHybrid.classification, CLASS_HYBRID);
    });

    test("1.6 Classifies unrecognized or synthetic algorithms as 'unknown'", () => {
      const unknownAlgo = CryptoClassifier.classify("X-Proprietary-Stream-Cipher-2026");
      assert.equal(unknownAlgo.classification, CLASS_UNKNOWN);
      assert.equal(unknownAlgo.isApproved, false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Safe Constant-Time Comparison Tests
  // -------------------------------------------------------------------------
  describe("Safe Constant-Time Comparison", () => {
    test("2.1 Returns true for matching inputs and false for differing inputs", () => {
      assert.equal(timingSafeCompare("my_secret_token", "my_secret_token"), true);
      assert.equal(timingSafeCompare("my_secret_token", "other_token_val"), false);
      assert.equal(
        timingSafeCompare(Buffer.from("hex_secret_key"), Buffer.from("hex_secret_key")),
        true
      );
      assert.equal(
        timingSafeCompare(Buffer.from("hex_secret_key"), Buffer.from("hex_secret_bad")),
        false
      );
    });

    test("2.2 Safely handles length mismatches without throwing RangeError", () => {
      // Native crypto.timingSafeEqual throws RangeError: Input buffers must have the same length.
      // timingSafeCompare must handle this safely in constant time!
      assert.doesNotThrow(() => {
        const result = timingSafeCompare("short", "much_longer_string_that_would_cause_range_error");
        assert.equal(result, false);
      });

      assert.doesNotThrow(() => {
        const result = timingSafeCompare("", "non_empty_token");
        assert.equal(result, false);
      });
    });

    test("2.3 Safely handles null and undefined inputs", () => {
      assert.equal(timingSafeCompare(null, "token"), false);
      assert.equal(timingSafeCompare("token", undefined), false);
      assert.equal(timingSafeCompare(null, null), false);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Zeroization Tests
  // -------------------------------------------------------------------------
  describe("In-Memory Zeroization Where Practical", () => {
    test("3.1 Explicitly zeroizes sensitive memory buffers with zeroes", () => {
      const secretBuf = Buffer.from("super_sensitive_plain_key_material_2026");
      assert.ok(secretBuf.some((b) => b !== 0));

      const zeroized = zeroize(secretBuf);
      assert.equal(zeroized, true);
      assert.ok(secretBuf.every((b) => b === 0), "All buffer bytes must be overwritten with 0");
    });

    test("3.2 withZeroizedBuffer automatically wipes buffer in finally block", () => {
      let leakedRef;
      withZeroizedBuffer(32, (buf) => {
        buf.fill(0xee);
        leakedRef = buf;
        assert.equal(buf[0], 0xee);
      });

      // After scope exit, buffer must be zeroized
      assert.ok(leakedRef.every((b) => b === 0), "Scoped buffer must be zeroized upon return");
    });

    test("3.3 EncryptionAtRestService zeroizes destroyed and cleared key buffers", () => {
      const service = new EncryptionAtRestService();
      const testKid = "key_to_destroy";
      service.addKey(testKid, Buffer.alloc(32, 0xbb), "retired");

      const keyBuf = service.getKey(testKid);
      assert.equal(keyBuf[0], 0xbb);

      service.destroyKey(testKid);
      assert.ok(keyBuf.every((b) => b === 0), "Destroyed key buffer must be wiped with zeroes");
      assert.throws(() => service.getKey(testKid), /No encryption key found/);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Key Separation via Domain Derivation
  // -------------------------------------------------------------------------
  describe("Cryptographic Key Separation", () => {
    test("4.1 Derives mathematically distinct subkeys for distinct operational domains", () => {
      const masterKey = "ecdat_enterprise_master_secret_key_2026";

      const jwtKey = deriveDomainKey(masterKey, "JWT_SIGNING");
      const encKey = deriveDomainKey(masterKey, "DATA_ENCRYPTION");
      const hmacKey = deriveDomainKey(masterKey, "AUDIT_HMAC");
      const csrfKey = deriveDomainKey(masterKey, "CSRF_PROTECTION");
      const artKey = deriveDomainKey(masterKey, "ARTIFACT_SIGNING");

      // Verify all keys are 32 bytes
      assert.equal(jwtKey.length, 32);
      assert.equal(encKey.length, 32);
      assert.equal(hmacKey.length, 32);

      // Verify all domain keys are pairwise distinct
      const keys = [jwtKey, encKey, hmacKey, csrfKey, artKey];
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          assert.equal(
            timingSafeCompare(keys[i], keys[j]),
            false,
            `Domain subkey collision between index ${i} and ${j}`
          );
        }
      }
    });

    test("4.2 Rejects invalid domain identifiers", () => {
      assert.throws(() => {
        deriveDomainKey("secret", "INVALID_DOMAIN_TYPE");
      }, /Invalid key domain/);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Full Cryptographic Security Audit Suite
  // -------------------------------------------------------------------------
  describe("Cryptographic Operations Audit Engine", () => {
    test("5.1 Runs complete 11-dimension cryptographic audit and passes all checks", () => {
      const audit = CryptoSecurityService.runCryptographicAudit();
      assert.equal(audit.all_passed, true, "All 11 cryptographic audit dimensions must pass");
      assert.equal(audit.summary.total, 11);
      assert.equal(audit.summary.passed, 11);
      assert.equal(audit.summary.failed, 0);

      const checkIds = audit.findings.map((f) => f.checkId);
      assert.ok(checkIds.includes("CRYPTO-AUDIT-001")); // Approved algorithms
      assert.ok(checkIds.includes("CRYPTO-AUDIT-002")); // Secure randomness
      assert.ok(checkIds.includes("CRYPTO-AUDIT-003")); // Secure key generation
      assert.ok(checkIds.includes("CRYPTO-AUDIT-004")); // Key separation
      assert.ok(checkIds.includes("CRYPTO-AUDIT-005")); // Authenticated encryption
      assert.ok(checkIds.includes("CRYPTO-AUDIT-006")); // Secure hashing
      assert.ok(checkIds.includes("CRYPTO-AUDIT-007")); // Password hashing
      assert.ok(checkIds.includes("CRYPTO-AUDIT-008")); // Constant-time comparisons
      assert.ok(checkIds.includes("CRYPTO-AUDIT-009")); // Secure key storage
      assert.ok(checkIds.includes("CRYPTO-AUDIT-010")); // Zeroization
      assert.ok(checkIds.includes("CRYPTO-AUDIT-011")); // No hardcoded secrets
    });
  });

  // -------------------------------------------------------------------------
  // 6. REST API Endpoints
  // -------------------------------------------------------------------------
  describe("REST API Endpoints (/api/v1/security/crypto)", () => {
    test("6.1 GET /api/v1/security/crypto/audit returns 11 passing verification checks", async () => {
      const res = await fetch(`${baseUrl}/api/v1/security/crypto/audit`, {
        headers: { "X-API-Key": config.ECDAT_API_KEY },
      });
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.all_passed, true);
      assert.equal(data.summary.total, 11);
      assert.equal(data.summary.passed, 11);
      assert.equal(data.findings.length, 11);
    });

    test("6.2 POST /api/v1/security/crypto/classify classifies quantum-vulnerable RSA", async () => {
      const res = await fetch(`${baseUrl}/api/v1/security/crypto/classify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.ECDAT_API_KEY,
        },
        body: JSON.stringify({ algorithm: "RSA", keySize: 2048 }),
      });
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.classification, "quantum-vulnerable");
      assert.equal(data.threat_model, "Shor");
    });

    test("6.3 POST /api/v1/security/crypto/classify classifies quantum-resistant ML-KEM-768", async () => {
      const res = await fetch(`${baseUrl}/api/v1/security/crypto/classify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.ECDAT_API_KEY,
        },
        body: JSON.stringify({ algorithm: "ML-KEM-768" }),
      });
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.classification, "quantum-resistant");
      assert.equal(data.nist_pqc_category, 3);
    });

    test("6.4 POST /api/v1/security/crypto/classify classifies hybrid X25519MLKEM768", async () => {
      const res = await fetch(`${baseUrl}/api/v1/security/crypto/classify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.ECDAT_API_KEY,
        },
        body: JSON.stringify({ algorithm: "X25519MLKEM768" }),
      });
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.classification, "hybrid");
      assert.equal(data.hybrid_details.classical_component, "X25519");
      assert.equal(data.hybrid_details.post_quantum_component, "ML-KEM-768");
    });

    test("6.5 POST /api/v1/security/crypto/classify classifies unverified parameter as 'unknown'", async () => {
      const res = await fetch(`${baseUrl}/api/v1/security/crypto/classify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": config.ECDAT_API_KEY,
        },
        body: JSON.stringify({ algorithm: "ML-KEM-FakeParam" }),
      });
      assert.equal(res.status, 200);

      const data = await res.json();
      assert.equal(data.classification, "unknown");
      assert.equal(data.is_approved, false);
    });
  });
});
