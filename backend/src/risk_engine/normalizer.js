const { getRules } = require("./rules_loader");
const { AssetType, DataSensitivity, BusinessCriticality } = require("./types");

/**
 * Maps raw algorithm names or aliases to their canonical ruleset entries.
 */
function normalizeAlgorithm(rawName, explicitKeySize = null) {
  if (!rawName || typeof rawName !== "string") {
    return {
      canonicalName: "Unknown",
      matchedRule: null,
      keySize: explicitKeySize,
    };
  }

  const rules = getRules();
  const algos = rules.algorithm_risk?.algorithms || [];
  const clean = rawName.trim().toLowerCase();

  // 1. Try to extract key size if embedded, e.g. "rsa-2048", "aes-256", "sha-256"
  let parsedKeySize = explicitKeySize;
  const keySizeMatch = clean.match(/[-_](\d{3,4})\b/);
  if (!parsedKeySize && keySizeMatch) {
    const size = parseInt(keySizeMatch[1], 10);
    // Don't mistake sha-256 / sha-384 / sha-512 for a key size
    if (!clean.startsWith("sha")) {
      parsedKeySize = size;
    }
  }

  // 2. Direct exact alias match
  for (const algo of algos) {
    if (algo.canonical_name.toLowerCase() === clean || algo.id === clean) {
      return {
        canonicalName: algo.canonical_name,
        matchedRule: algo,
        keySize: parsedKeySize,
      };
    }
    if (algo.aliases && algo.aliases.some((a) => a.toLowerCase() === clean)) {
      return {
        canonicalName: algo.canonical_name,
        matchedRule: algo,
        keySize: parsedKeySize,
      };
    }
  }

  // 3. Substring / Prefix / Variant matching
  // Protocol versions
  if (clean.includes("tls") || clean.includes("ssl")) {
    if (
      clean.includes("1.0") ||
      clean.includes("1_0") ||
      clean.includes("v1.0") ||
      clean.includes("v1_0")
    ) {
      const rule = algos.find((a) => a.id === "tls10");
      return { canonicalName: "TLS 1.0", matchedRule: rule, keySize: null };
    }
    if (
      clean.includes("1.1") ||
      clean.includes("1_1") ||
      clean.includes("v1.1") ||
      clean.includes("v1_1")
    ) {
      const rule = algos.find((a) => a.id === "tls11");
      return { canonicalName: "TLS 1.1", matchedRule: rule, keySize: null };
    }
    if (
      clean.includes("1.2") ||
      clean.includes("1_2") ||
      clean.includes("v1.2") ||
      clean.includes("v1_2")
    ) {
      const rule = algos.find((a) => a.id === "tls12");
      return { canonicalName: "TLS 1.2", matchedRule: rule, keySize: null };
    }
    if (
      clean.includes("1.3") ||
      clean.includes("1_3") ||
      clean.includes("v1.3") ||
      clean.includes("v1_3")
    ) {
      const rule = algos.find((a) => a.id === "tls13");
      return { canonicalName: "TLS 1.3", matchedRule: rule, keySize: null };
    }
  }

  // Common cipher & hash variants
  if (clean.includes("sha-1") || clean.includes("sha1")) {
    return {
      canonicalName: "SHA-1",
      matchedRule: algos.find((a) => a.id === "sha1"),
      keySize: null,
    };
  }
  if (clean.includes("md5")) {
    return {
      canonicalName: "MD5",
      matchedRule: algos.find((a) => a.id === "md5"),
      keySize: null,
    };
  }
  if (clean.includes("sha256") || clean.includes("sha-256")) {
    return {
      canonicalName: "SHA-256",
      matchedRule: algos.find((a) => a.id === "sha256"),
      keySize: null,
    };
  }
  if (clean.includes("sha384") || clean.includes("sha-384")) {
    return {
      canonicalName: "SHA-384",
      matchedRule: algos.find((a) => a.id === "sha384"),
      keySize: null,
    };
  }
  if (clean.includes("sha512") || clean.includes("sha-512")) {
    return {
      canonicalName: "SHA-512",
      matchedRule: algos.find((a) => a.id === "sha512"),
      keySize: null,
    };
  }
  if (clean.includes("sha-3") || clean.includes("sha3")) {
    return {
      canonicalName: "SHA-3",
      matchedRule: algos.find((a) => a.id === "sha3"),
      keySize: null,
    };
  }
  if (clean.includes("rsa")) {
    return {
      canonicalName: "RSA",
      matchedRule: algos.find((a) => a.id === "rsa"),
      keySize: parsedKeySize,
    };
  }
  if (clean.includes("ecdsa")) {
    return {
      canonicalName: "ECDSA",
      matchedRule: algos.find((a) => a.id === "ecdsa"),
      keySize: parsedKeySize,
    };
  }
  if (
    clean.includes("ecdh") ||
    clean.includes("secp256r1") ||
    clean.includes("prime256v1")
  ) {
    return {
      canonicalName: "ECDH",
      matchedRule: algos.find((a) => a.id === "ecdh"),
      keySize: parsedKeySize,
    };
  }
  if (
    clean.startsWith("ec-") ||
    clean.startsWith("ecc-") ||
    clean === "ec" ||
    clean === "ecc"
  ) {
    return {
      canonicalName: "ECDSA",
      matchedRule: algos.find((a) => a.id === "ecdsa"),
      keySize: parsedKeySize || 256,
    };
  }
  if (clean.includes("x25519") || clean.includes("curve25519")) {
    return {
      canonicalName: "X25519",
      matchedRule: algos.find((a) => a.id === "x25519"),
      keySize: 256,
    };
  }
  if (clean.includes("aes")) {
    if (clean.includes("128")) parsedKeySize = 128;
    else if (clean.includes("192")) parsedKeySize = 192;
    else if (clean.includes("256")) parsedKeySize = 256;
    return {
      canonicalName: "AES",
      matchedRule: algos.find((a) => a.id === "aes"),
      keySize: parsedKeySize,
    };
  }
  if (
    clean.includes("3des") ||
    clean.includes("triple-des") ||
    clean.includes("des-ede3")
  ) {
    return {
      canonicalName: "3DES",
      matchedRule: algos.find((a) => a.id === "3des"),
      keySize: 168,
    };
  }
  if (clean.includes("des") && !clean.includes("3des")) {
    return {
      canonicalName: "DES",
      matchedRule: algos.find((a) => a.id === "des"),
      keySize: 56,
    };
  }
  if (clean.includes("rc4") || clean.includes("arcfour")) {
    return {
      canonicalName: "RC4",
      matchedRule: algos.find((a) => a.id === "rc4"),
      keySize: null,
    };
  }
  if (clean.includes("chacha20")) {
    return {
      canonicalName: "ChaCha20-Poly1305",
      matchedRule: algos.find((a) => a.id === "chacha20_poly1305"),
      keySize: 256,
    };
  }
  if (clean.includes("dh") || clean.includes("diffie-hellman")) {
    return {
      canonicalName: "Diffie-Hellman",
      matchedRule: algos.find((a) => a.id === "dh"),
      keySize: parsedKeySize,
    };
  }

  // 4. Crypto library catalog lookup
  const libraryCatalog = rules.crypto_library_catalog;
  if (Array.isArray(libraryCatalog)) {
    for (const lib of libraryCatalog) {
      const canon = (lib.canonical_name || "").toLowerCase();
      const matched =
        clean === canon ||
        clean.includes(canon) ||
        (lib.aliases &&
          lib.aliases.some((a) => {
            const al = a.toLowerCase();
            return clean === al || (al.length >= 6 && clean.includes(al));
          }));
      if (matched) {
        return {
          canonicalName: lib.canonical_name,
          matchedRule: {
            id: lib.canonical_name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
            canonical_name: lib.canonical_name,
            category: "crypto_library",
            classical_risk_level: "none",
            quantum_relevance: "shor_vulnerable",
            pqc_support: lib.pqc_support,
            typical_capabilities: lib.typical_capabilities,
          },
          keySize: parsedKeySize,
        };
      }
    }
  }

  return {
    canonicalName: rawName,
    matchedRule: null,
    keySize: parsedKeySize,
  };
}

/**
 * Normalizes an asset type into recognized categories.
 */
function normalizeAssetType(rawType) {
  if (!rawType) return AssetType.NETWORK_SESSION;
  const clean = String(rawType).toLowerCase().trim();
  if (
    clean.includes("session") ||
    clean.includes("net") ||
    clean.includes("tls") ||
    clean.includes("protocol")
  ) {
    return AssetType.NETWORK_SESSION;
  }
  if (clean.includes("cert") || clean.includes("x509")) {
    return AssetType.CERTIFICATE;
  }
  if (
    clean.includes("hardcoded") ||
    clean.includes("private_key") ||
    clean.includes("key_material")
  ) {
    return AssetType.HARDCODED_PRIVATE_KEY;
  }
  if (
    clean.includes("stored") ||
    clean.includes("database") ||
    clean.includes("vault") ||
    clean.includes("data")
  ) {
    return AssetType.STORED_ENCRYPTED_DATA;
  }
  if (clean.includes("signing") || clean.includes("signature")) {
    return AssetType.SIGNING_KEY;
  }
  if (
    clean.includes("lib") ||
    clean.includes("package") ||
    clean.includes("binary")
  ) {
    return AssetType.LIBRARY_PRESENCE;
  }
  return AssetType.FILE;
}

/**
 * Normalizes data sensitivity string.
 */
function normalizeDataSensitivity(
  rawSensitivity,
  defaultVal = DataSensitivity.INTERNAL,
) {
  if (!rawSensitivity) return defaultVal;
  const clean = String(rawSensitivity).toLowerCase().trim();
  if (Object.values(DataSensitivity).includes(clean)) {
    return clean;
  }
  return defaultVal;
}

/**
 * Normalizes business criticality string.
 */
function normalizeBusinessCriticality(
  rawCriticality,
  defaultVal = BusinessCriticality.MEDIUM,
) {
  if (!rawCriticality) return defaultVal;
  const clean = String(rawCriticality).toLowerCase().trim();
  if (Object.values(BusinessCriticality).includes(clean)) {
    return clean;
  }
  return defaultVal;
}

module.exports = {
  normalizeAlgorithm,
  normalizeAssetType,
  normalizeDataSensitivity,
  normalizeBusinessCriticality,
};
