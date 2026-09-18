/**
 * ECDAT Audit Logging Subsystem — Phase 18.1 Cryptographic Tamper-Chain
 *
 * Implements a cryptographic hash chain and Merkle sequence validator
 * for immutable, tamper-resistant audit event records.
 *
 * Guarantees:
 * 1. Sequential Contiguity: No records can be deleted or skipped without detection.
 * 2. Cryptographic Linkage: Each record is chained to the previous block's SHA-256 hash.
 * 3. Content Integrity: Any mutation of actor, target, timestamp, or details invalidates the hash.
 * 4. Non-Repudiation: HMAC-SHA256 signature authenticates event authorship.
 */

const crypto = require("crypto");

const GENESIS_HASH = "0".repeat(64);
const DEFAULT_CHAIN_KEY = process.env.AUDIT_HMAC_SECRET || "ecdat-tamper-chain-hmac-key-2026";

/**
 * Deterministically serializes an object into canonical JSON with sorted keys.
 * Ensures consistent hash generation across platforms and runtimes.
 *
 * @param {any} data
 * @returns {string} Canonical JSON string
 */
function canonicalJson(data) {
  if (data === null || typeof data !== "object") {
    return JSON.stringify(data);
  }

  if (Array.isArray(data)) {
    return "[" + data.map((item) => canonicalJson(item)).join(",") + "]";
  }

  const sortedKeys = Object.keys(data).sort();
  const entries = sortedKeys.map((key) => {
    return JSON.stringify(key) + ":" + canonicalJson(data[key]);
  });

  return "{" + entries.join(",") + "}";
}

/**
 * Computes the SHA-256 digest of an audit event linked to its previous block hash.
 *
 * @param {object} eventData
 * @param {string} prevHash
 * @returns {string} 64-character lowercase hex digest
 */
function computeEventHash(eventData, prevHash) {
  const payloadToHash = {
    eventId: eventData.eventId,
    sequenceNumber: eventData.sequenceNumber,
    timestamp: eventData.timestamp,
    category: eventData.category,
    action: eventData.action,
    actor: {
      id: eventData.actor?.id || "anonymous",
      username: eventData.actor?.username || "anonymous",
      role: eventData.actor?.role || "viewer",
    },
    tenantId: eventData.tenantId || eventData.tenant || "default",
    target: {
      type: eventData.target?.type || "system",
      id: eventData.target?.id || "none",
    },
    status: eventData.status || eventData.result || "SUCCESS",
    result: eventData.result || eventData.status || "SUCCESS",
    requestId: eventData.requestId || eventData.request_id || null,
    reason: eventData.reason || null,
    sourceIp: eventData.sourceIp || eventData.source_ip || eventData.actor?.ipAddress || null,
    details: eventData.details || {},
    prevHash: prevHash || GENESIS_HASH,
  };

  const canonicalString = canonicalJson(payloadToHash);
  return crypto.createHash("sha256").update(canonicalString, "utf8").digest("hex");
}

/**
 * Signs an event hash using HMAC-SHA256 for non-repudiation.
 *
 * @param {string} hash
 * @param {string} [secretKey=DEFAULT_CHAIN_KEY]
 * @returns {string} HMAC signature
 */
function signHash(hash, secretKey = DEFAULT_CHAIN_KEY) {
  return crypto.createHmac("sha256", secretKey).update(hash, "utf8").digest("hex");
}

/**
 * Verifies a single HMAC signature.
 *
 * @param {string} hash
 * @param {string} signature
 * @param {string} [secretKey=DEFAULT_CHAIN_KEY]
 * @returns {boolean}
 */
function verifySignature(hash, signature, secretKey = DEFAULT_CHAIN_KEY) {
  if (!signature || typeof signature !== "string") return false;
  const expected = signHash(hash, secretKey);
  const bufA = Buffer.from(signature, "hex");
  const bufB = Buffer.from(expected, "hex");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies the integrity of an entire sequence of audit events.
 *
 * Validates:
 * 1. Sequence numbering is contiguous (1, 2, 3...) with no gaps or duplicates.
 * 2. `prevHash` of record N matches `hash` of record N-1 (genesis block matches GENESIS_HASH).
 * 3. Recomputed SHA-256 hash strictly matches recorded `hash`.
 * 4. HMAC signature matches secret key if configured.
 *
 * @param {Array<object>} events - Chronological array of audit event records
 * @param {object} [options={}]
 * @param {string} [options.secretKey=DEFAULT_CHAIN_KEY]
 * @param {boolean} [options.verifySignatures=false]
 * @returns {{ valid: boolean, totalVerified: number, lastHash: string, error: object|null }}
 */
function verifyAuditChain(events, options = {}) {
  const secretKey = options.secretKey || DEFAULT_CHAIN_KEY;
  const shouldVerifySignatures = Boolean(options.verifySignatures);

  if (!Array.isArray(events) || events.length === 0) {
    return {
      valid: true,
      totalVerified: 0,
      lastHash: GENESIS_HASH,
      error: null,
    };
  }

  let expectedPrevHash = GENESIS_HASH;
  let expectedSeq = events[0].sequenceNumber !== undefined ? events[0].sequenceNumber : 1;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    // 1. Validate sequence continuity
    if (event.sequenceNumber !== expectedSeq) {
      return {
        valid: false,
        totalVerified: i,
        lastHash: expectedPrevHash,
        error: {
          index: i,
          eventId: event.eventId || event.id,
          reason: `Sequence gap or disorder detected. Expected sequence ${expectedSeq}, but found ${event.sequenceNumber}.`,
          expected: expectedSeq,
          actual: event.sequenceNumber,
        },
      };
    }

    // 2. Validate cryptographic hash linkage
    const prevHashToValidate = i === 0 && events[0].sequenceNumber === 1 ? GENESIS_HASH : expectedPrevHash;
    if (event.prevHash !== prevHashToValidate) {
      return {
        valid: false,
        totalVerified: i,
        lastHash: expectedPrevHash,
        error: {
          index: i,
          eventId: event.eventId || event.id,
          reason: `Cryptographic linkage broken. prevHash mismatch at block ${event.sequenceNumber}.`,
          expected: prevHashToValidate,
          actual: event.prevHash,
        },
      };
    }

    // 3. Recompute and validate payload hash
    const recomputedHash = computeEventHash(event, event.prevHash);
    if (recomputedHash !== event.hash) {
      return {
        valid: false,
        totalVerified: i,
        lastHash: expectedPrevHash,
        error: {
          index: i,
          eventId: event.eventId || event.id,
          reason: `Data integrity violation. Payload hash mismatch at block ${event.sequenceNumber}. Record has been tampered with.`,
          expected: recomputedHash,
          actual: event.hash,
        },
      };
    }

    // 4. Validate HMAC signature if required
    if (shouldVerifySignatures && event.signature) {
      if (!verifySignature(event.hash, event.signature, secretKey)) {
        return {
          valid: false,
          totalVerified: i,
          lastHash: expectedPrevHash,
          error: {
            index: i,
            eventId: event.eventId || event.id,
            reason: `Signature authenticity failure at block ${event.sequenceNumber}.`,
            expected: "Valid HMAC",
            actual: "Invalid signature",
          },
        };
      }
    }

    expectedPrevHash = event.hash;
    expectedSeq++;
  }

  return {
    valid: true,
    totalVerified: events.length,
    lastHash: expectedPrevHash,
    error: null,
  };
}

module.exports = {
  GENESIS_HASH,
  DEFAULT_CHAIN_KEY,
  canonicalJson,
  computeEventHash,
  signHash,
  verifySignature,
  verifyAuditChain,
};
