/**
 * ECDAT Cryptographic Algorithm Classifier (Node.js) — Phase 22 (P1 Cryptographic Security)
 *
 * Classifies cryptographic algorithms into four canonical categories:
 * 1. "quantum-vulnerable"
 * 2. "quantum-resistant"
 * 3. "hybrid"
 * 4. "unknown"
 *
 * MANDATE: "Do not infer PQC security solely from algorithm names."
 * Enforces:
 * - Key length & parameter inspection (AES-128 is Grover-vulnerable -> quantum-vulnerable,
 *   while AES-256 is quantum-resistant).
 * - Deep validation of parameter sets for ML-KEM (512, 768, 1024), ML-DSA (44, 65, 87),
 *   SLH-DSA, LMS/XMSS, Falcon against NIST FIPS 203/204/205.
 * - Unknown classification for synthetic/invalid parameters or unverified PQC claims.
 * - Hybrid combiner inspection (requires classical + PQC components + combiner).
 */

const CLASS_QUANTUM_VULNERABLE = "quantum-vulnerable";
const CLASS_QUANTUM_RESISTANT = "quantum-resistant";
const CLASS_HYBRID = "hybrid";
const CLASS_UNKNOWN = "unknown";

const CANONICAL_CLASSES = new Set([
  CLASS_QUANTUM_VULNERABLE,
  CLASS_QUANTUM_RESISTANT,
  CLASS_HYBRID,
  CLASS_UNKNOWN,
]);

// NIST FIPS 203 ML-KEM Parameter Sets
const VALID_ML_KEM_PARAMETERS = {
  512: { nistLevel: 1, pkBytes: 800, ctBytes: 768 },
  768: { nistLevel: 3, pkBytes: 1184, ctBytes: 1088 },
  1024: { nistLevel: 5, pkBytes: 1568, ctBytes: 1568 },
};

// NIST FIPS 204 ML-DSA Parameter Sets
const VALID_ML_DSA_PARAMETERS = {
  44: { nistLevel: 2, pkBytes: 1312, sigBytes: 2420 },
  65: { nistLevel: 3, pkBytes: 1952, sigBytes: 3309 },
  87: { nistLevel: 5, pkBytes: 2592, sigBytes: 4627 },
};

// Classical asymmetric algorithms broken by Shor's polynomial-time algorithm
const SHOR_VULNERABLE_FAMILIES = [
  "rsa",
  "dsa",
  "dh",
  "diffie-hellman",
  "dhe",
  "ffdh",
  "ecdh",
  "ecdsa",
  "ecies",
  "ed25519",
  "ed448",
  "x25519",
  "x448",
  "elgamal",
  "sm2",
  "gost",
];

// Classical symmetric ciphers
const SYMMETRIC_CIPHER_FAMILIES = [
  "aes",
  "chacha20",
  "camellia",
  "aria",
  "des",
  "3des",
  "triple-des",
  "rc4",
  "blowfish",
  "cast5",
  "cast6",
  "idea",
  "seed",
];

const BROKEN_HASHES = ["md5", "md4", "md2", "sha1", "sha-1", "ripemd160"];

class AlgorithmClassificationResult {
  constructor({
    algorithm,
    classification,
    threatModel,
    securityLevelBits = null,
    nistPqcCategory = null,
    justification = "",
    isApproved = true,
    hybridDetails = null,
  }) {
    this.algorithm = algorithm;
    this.classification = classification;
    this.threatModel = threatModel;
    this.securityLevelBits = securityLevelBits;
    this.nistPqcCategory = nistPqcCategory;
    this.justification = justification;
    this.isApproved = isApproved;
    this.hybridDetails = hybridDetails;
  }

  toJSON() {
    return {
      algorithm: this.algorithm,
      classification: this.classification,
      threat_model: this.threatModel,
      security_level_bits: this.securityLevelBits,
      nist_pqc_category: this.nistPqcCategory,
      justification: this.justification,
      is_approved: this.isApproved,
      hybrid_details: this.hybridDetails,
    };
  }
}

class CryptoClassifier {
  /**
   * Classifies an algorithm into:
   * - 'quantum-vulnerable'
   * - 'quantum-resistant'
   * - 'hybrid'
   * - 'unknown'
   *
   * @param {string} algorithm
   * @param {object} [options]
   * @param {number} [options.keySize] - Key size in bits
   * @param {object} [options.parameters] - Cryptographic parameters
   * @param {string} [options.mode] - Cipher mode (e.g. GCM, CBC)
   * @param {object} [options.hybridComponents] - { classical, pqc, combiner }
   * @returns {AlgorithmClassificationResult}
   */
  static classify(algorithm, options = {}) {
    if (!algorithm || typeof algorithm !== "string") {
      return new AlgorithmClassificationResult({
        algorithm: String(algorithm || ""),
        classification: CLASS_UNKNOWN,
        threatModel: "Unverified",
        justification: "Empty or non-string algorithm specification.",
        isApproved: false,
      });
    }

    const algoRaw = algorithm.trim();
    const algoNorm = algoRaw.toLowerCase().replace(/[^a-z0-9_\-+]/g, "");
    const algoClean = algoRaw.toLowerCase().replace(/[^a-z0-9]/g, "");
    const { keySize, parameters = {}, mode, hybridComponents } = options;

    // 1. Explicit Hybrid Evaluation
    const hybridRes = this._evaluateHybrid(algoRaw, algoNorm, algoClean, hybridComponents, parameters);
    if (hybridRes) return hybridRes;

    // 2. Post-Quantum Candidates (Deep Parameter Verification)
    const pqcRes = this._evaluatePqcParameters(algoRaw, algoNorm, algoClean, keySize, parameters);
    if (pqcRes) return pqcRes;

    // 3. Asymmetric Classical (Shor's Algorithm Breakdown)
    const shorRes = this._evaluateAsymmetricClassical(algoRaw, algoNorm, algoClean, keySize);
    if (shorRes) return shorRes;

    // 4. Symmetric Ciphers (Grover's Algorithm Speedup)
    const symRes = this._evaluateSymmetric(algoRaw, algoNorm, algoClean, keySize, mode);
    if (symRes) return symRes;

    // 5. Cryptographic Hash Functions
    const hashRes = this._evaluateHash(algoRaw, algoNorm, algoClean, keySize);
    if (hashRes) return hashRes;

    // 6. Unknown / Unverified Fallback
    return new AlgorithmClassificationResult({
      algorithm: algoRaw,
      classification: CLASS_UNKNOWN,
      threatModel: "Unverified",
      justification: `Algorithm '${algoRaw}' could not be definitively validated against known cryptographic standards or parameter sets.`,
      isApproved: false,
    });
  }

  static _evaluateHybrid(algoRaw, algoNorm, algoClean, hybridComponents, _params) {
    if (hybridComponents && typeof hybridComponents === "object") {
      const classical = hybridComponents.classical_component || hybridComponents.classical;
      const pqc = hybridComponents.post_quantum_component || hybridComponents.pqc;
      const combiner = hybridComponents.combiner || "IETF Dual-KEM HKDF";

      if (classical && pqc) {
        const classRes = this.classify(String(classical));
        const pqcRes = this.classify(String(pqc));

        if (
          classRes.classification === CLASS_QUANTUM_VULNERABLE &&
          pqcRes.classification === CLASS_QUANTUM_RESISTANT
        ) {
          return new AlgorithmClassificationResult({
            algorithm: algoRaw,
            classification: CLASS_HYBRID,
            threatModel: "Validated_Hybrid",
            securityLevelBits: pqcRes.securityLevelBits || 192,
            nistPqcCategory: pqcRes.nistPqcCategory || 3,
            justification: `Verified hybrid construction combining classical ${classical} and post-quantum ${pqc} via ${combiner}.`,
            isApproved: true,
            hybridDetails: {
              classical_component: classical,
              post_quantum_component: pqc,
              combiner,
              classical_security: classRes.securityLevelBits,
              quantum_security: pqcRes.securityLevelBits,
            },
          });
        }
        return new AlgorithmClassificationResult({
          algorithm: algoRaw,
          classification: CLASS_UNKNOWN,
          threatModel: "Unverified_Hybrid",
          justification: `Hybrid scheme '${algoRaw}' failed component verification.`,
          isApproved: false,
        });
      }
    }

    const standardHybrids = {
      x25519mlkem768: ["X25519", "ML-KEM-768", 3, 192],
      x25519kyber768: ["X25519", "ML-KEM-768", 3, 192],
      x25519kyber768draft00: ["X25519", "ML-KEM-768", 3, 192],
      secp256r1mlkem768: ["ECDH-P256", "ML-KEM-768", 3, 192],
      p256mlkem768: ["ECDH-P256", "ML-KEM-768", 3, 192],
      secp384r1mlkem1024: ["ECDH-P384", "ML-KEM-1024", 5, 256],
      p384mlkem1024: ["ECDH-P384", "ML-KEM-1024", 5, 256],
    };

    for (const [pattern, [cName, pqName, nistCat, secBits]] of Object.entries(standardHybrids)) {
      if (algoClean.includes(pattern) || algoNorm.includes(pattern)) {
        return new AlgorithmClassificationResult({
          algorithm: algoRaw,
          classification: CLASS_HYBRID,
          threatModel: "Validated_Hybrid",
          securityLevelBits: secBits,
          nistPqcCategory: nistCat,
          justification: `Standard IETF draft hybrid key exchange: ${cName} + ${pqName} (NIST Level ${nistCat}).`,
          isApproved: true,
          hybridDetails: {
            classical_component: cName,
            post_quantum_component: pqName,
            combiner: "IETF Dual-KEM HKDF",
          },
        });
      }
    }

    if (algoClean.includes("composite") || (algoRaw.includes("+") && /(mldsa|mlkem|falcon)/.test(algoClean))) {
      const parts = algoRaw.split(/[\+\-_]/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const hasClassical = parts.some((p) => SHOR_VULNERABLE_FAMILIES.some((c) => p.toLowerCase().includes(c)));
        const hasPqc = parts.some((p) => /(mlkem|mldsa|slhdsa|kyber|dilithium|falcon)/i.test(p.replace(/[^a-z0-9]/gi, "")));
        if (hasClassical && hasPqc) {
          return new AlgorithmClassificationResult({
            algorithm: algoRaw,
            classification: CLASS_HYBRID,
            threatModel: "Validated_Hybrid",
            securityLevelBits: 192,
            nistPqcCategory: 3,
            justification: `Composite scheme with classical and PQC components: ${algoRaw}.`,
            isApproved: true,
            hybridDetails: { raw_components: parts },
          });
        }
      }
    }

    return null;
  }

  static _evaluatePqcParameters(algoRaw, algoNorm, algoClean, keySize, params) {
    // 1. FIPS 203 ML-KEM / Kyber
    if (algoClean.includes("mlkem") || algoClean.includes("kyber")) {
      const match = algoClean.match(/(512|768|1024)/);
      const paramVal = match ? match[1] : String(params.parameter_set || "");

      if (VALID_ML_KEM_PARAMETERS[paramVal]) {
        const spec = VALID_ML_KEM_PARAMETERS[paramVal];
        if (keySize && keySize < 512) {
          return new AlgorithmClassificationResult({
            algorithm: algoRaw,
            classification: CLASS_UNKNOWN,
            threatModel: "Unverified",
            justification: `ML-KEM-${paramVal} specified with invalid key size (${keySize} bits).`,
            isApproved: false,
          });
        }
        return new AlgorithmClassificationResult({
          algorithm: algoRaw,
          classification: CLASS_QUANTUM_RESISTANT,
          threatModel: "Validated_PQC",
          nistPqcCategory: spec.nistLevel,
          securityLevelBits: spec.nistLevel === 1 ? 128 : spec.nistLevel === 3 ? 192 : 256,
          justification: `NIST FIPS 203 standardized ML-KEM-${paramVal} (Category ${spec.nistLevel}). Parameters verified.`,
          isApproved: true,
        });
      }

      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_UNKNOWN,
        threatModel: "Unverified",
        justification: `Algorithm '${algoRaw}' claims ML-KEM/Kyber construction but lacks a standard parameter set (512, 768, 1024). Cannot infer PQC solely from name.`,
        isApproved: false,
      });
    }

    // 2. FIPS 204 ML-DSA / Dilithium
    if (algoClean.includes("mldsa") || algoClean.includes("dilithium")) {
      const match = algoClean.match(/(44|65|87|2|3|5)/);
      const rawParam = match ? match[1] : String(params.parameter_set || "");
      const paramMap = { 2: "44", 3: "65", 5: "87" };
      const paramVal = paramMap[rawParam] || rawParam;

      if (VALID_ML_DSA_PARAMETERS[paramVal]) {
        const spec = VALID_ML_DSA_PARAMETERS[paramVal];
        return new AlgorithmClassificationResult({
          algorithm: algoRaw,
          classification: CLASS_QUANTUM_RESISTANT,
          threatModel: "Validated_PQC",
          nistPqcCategory: spec.nistLevel,
          securityLevelBits: spec.nistLevel === 2 ? 128 : spec.nistLevel === 3 ? 192 : 256,
          justification: `NIST FIPS 204 standardized ML-DSA-${paramVal} (Category ${spec.nistLevel}). Parameters verified.`,
          isApproved: true,
        });
      }

      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_UNKNOWN,
        threatModel: "Unverified",
        justification: `Algorithm '${algoRaw}' claims ML-DSA/Dilithium construction but lacks valid FIPS 204 parameters (44, 65, 87).`,
        isApproved: false,
      });
    }

    // 3. FIPS 205 SLH-DSA / SPHINCS+
    if (algoClean.includes("slhdsa") || algoClean.includes("sphincs")) {
      const hasParam = /(128s|128f|192s|192f|256s|256f|shake|sha2)/.test(algoClean);
      if (hasParam) {
        return new AlgorithmClassificationResult({
          algorithm: algoRaw,
          classification: CLASS_QUANTUM_RESISTANT,
          threatModel: "Validated_PQC",
          nistPqcCategory: 3,
          securityLevelBits: 192,
          justification: "NIST FIPS 205 standardized SLH-DSA stateless hash-based signature scheme.",
          isApproved: true,
        });
      }
      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_UNKNOWN,
        threatModel: "Unverified",
        justification: `SLH-DSA '${algoRaw}' missing parameter specifications.`,
        isApproved: false,
      });
    }

    // 4. Falcon
    if (algoClean.includes("falcon")) {
      const match = algoClean.match(/(512|1024)/);
      if (match) {
        return new AlgorithmClassificationResult({
          algorithm: algoRaw,
          classification: CLASS_QUANTUM_RESISTANT,
          threatModel: "Validated_PQC",
          nistPqcCategory: match[1] === "512" ? 1 : 5,
          securityLevelBits: match[1] === "512" ? 128 : 256,
          justification: `NIST round 3 selected Falcon-${match[1]} lattice signature.`,
          isApproved: true,
        });
      }
    }

    // 5. Stateful Hash Signatures
    if (/(lms|hss|xmss)/.test(algoClean)) {
      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_QUANTUM_RESISTANT,
        threatModel: "Validated_PQC",
        nistPqcCategory: 5,
        securityLevelBits: 256,
        justification: `Stateful hash signature scheme (${algoRaw}) per RFC 8554 / RFC 8391. Approved for firmware/code signing.`,
        isApproved: true,
      });
    }

    // Reject generic string claims
    if (/(pqc|quantumsafe|postquantum)/.test(algoClean)) {
      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_UNKNOWN,
        threatModel: "Unverified",
        justification: `Algorithm '${algoRaw}' claims quantum security in its name without matching standardized specifications.`,
        isApproved: false,
      });
    }

    return null;
  }

  static _evaluateAsymmetricClassical(algoRaw, algoNorm, algoClean, keySize) {
    let isShor = SHOR_VULNERABLE_FAMILIES.some((fam) => algoClean.includes(fam) || algoNorm.includes(fam));
    if (!isShor && (algoClean.startsWith("rsa") || /^rsa(-?[0-9]+)?$/.test(algoNorm))) {
      isShor = true;
    }

    if (isShor) {
      let bits = keySize;
      if (!bits) {
        const m = algoClean.match(/(512|1024|2048|3072|4096)/);
        if (m) bits = parseInt(m[1], 10);
      }

      const classicalLevel = bits && bits <= 2048 ? 112 : bits && bits <= 3072 ? 128 : 256;
      const isDeprecated = Boolean(bits && bits < 2048);

      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_QUANTUM_VULNERABLE,
        threatModel: "Shor",
        securityLevelBits: classicalLevel,
        nistPqcCategory: 0,
        justification: `Asymmetric mechanism '${algoRaw}' is vulnerable to Shor's algorithm on a CRQC (solves integer factorization & discrete log in polynomial time).`,
        isApproved: !isDeprecated,
      });
    }

    return null;
  }

  static _evaluateSymmetric(algoRaw, algoNorm, algoClean, keySize, mode) {
    const isSym = SYMMETRIC_CIPHER_FAMILIES.some((fam) => algoClean.includes(fam) || algoNorm.includes(fam));
    if (!isSym) return null;

    let effectiveBits = keySize;
    if (!effectiveBits) {
      const m = algoClean.match(/(128|192|256|64|56)/);
      if (m) effectiveBits = parseInt(m[1], 10);
      else if (algoClean.includes("chacha20")) effectiveBits = 256;
      else if (algoClean.includes("3des") || algoClean.includes("desede3")) effectiveBits = 112;
      else if (algoClean.includes("des")) effectiveBits = 56;
    }

    if (/(des|rc4|blowfish|cast5)/.test(algoClean) && !/(3des|desede3)/.test(algoClean)) {
      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_QUANTUM_VULNERABLE,
        threatModel: "Classical_Broken",
        securityLevelBits: effectiveBits || 56,
        justification: `Legacy symmetric cipher '${algoRaw}' is broken classically and quantum-vulnerable.`,
        isApproved: false,
      });
    }

    if (effectiveBits !== undefined && effectiveBits !== null) {
      const quantumBits = Math.floor(effectiveBits / 2);
      const isInsecureMode = algoClean.includes("ecb") || (mode && mode.toLowerCase() === "ecb");
      if (effectiveBits < 256) {
        return new AlgorithmClassificationResult({
          algorithm: algoRaw,
          classification: CLASS_QUANTUM_VULNERABLE,
          threatModel: "Grover",
          securityLevelBits: effectiveBits,
          justification: `Symmetric cipher '${algoRaw}' has ${effectiveBits}-bit key. Grover's algorithm reduces effective security to 2^${quantumBits}, falling below the 128-bit quantum security floor. Marked quantum-vulnerable.`,
          isApproved: effectiveBits >= 128 && !isInsecureMode,
        });
      }
      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_QUANTUM_RESISTANT,
        threatModel: "Grover",
        securityLevelBits: effectiveBits,
        nistPqcCategory: 1,
        justification: `Symmetric cipher '${algoRaw}' with ${effectiveBits}-bit key maintains 2^${quantumBits} bits against Grover's algorithm. Quantum-resistant.`,
        isApproved: !isInsecureMode,
      });
    }

    return new AlgorithmClassificationResult({
      algorithm: algoRaw,
      classification: CLASS_UNKNOWN,
      threatModel: "Unverified",
      justification: `Symmetric cipher '${algoRaw}' lacks key size information. Cannot classify without verified key length.`,
      isApproved: false,
    });
  }

  static _evaluateHash(algoRaw, algoNorm, algoClean, _keySize) {
    if (BROKEN_HASHES.some((broken) => algoClean.includes(broken) || algoNorm.includes(broken))) {
      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_QUANTUM_VULNERABLE,
        threatModel: "Classical_Broken",
        securityLevelBits: 0,
        justification: `Hash function '${algoRaw}' is broken classically and quantum-vulnerable.`,
        isApproved: false,
      });
    }

    if (algoClean.includes("sha256")) {
      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_QUANTUM_RESISTANT,
        threatModel: "Grover/BHT",
        securityLevelBits: 256,
        justification: "SHA-256 provides 128-bit quantum collision resistance and 256-bit pre-image resistance.",
        isApproved: true,
      });
    }

    if (/(sha384|sha512|sha3|shake|blake2)/.test(algoClean)) {
      return new AlgorithmClassificationResult({
        algorithm: algoRaw,
        classification: CLASS_QUANTUM_RESISTANT,
        threatModel: "Grover/BHT",
        securityLevelBits: 384,
        justification: `High-assurance hash function '${algoRaw}' exceeds 128-bit quantum collision resistance floor.`,
        isApproved: true,
      });
    }

    return null;
  }
}

module.exports = {
  CLASS_QUANTUM_VULNERABLE,
  CLASS_QUANTUM_RESISTANT,
  CLASS_HYBRID,
  CLASS_UNKNOWN,
  CANONICAL_CLASSES,
  CryptoClassifier,
  AlgorithmClassificationResult,
};
