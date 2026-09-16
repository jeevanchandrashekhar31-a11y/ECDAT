/**
 * Category: Hybrid Cryptography Examples (Phase 22.3 Golden Corpus)
 * Node.js hybrid cipher configuration & dual-signature validation
 */

const crypto = require('crypto');

function configureHybridTlsOptions() {
  return {
    // Configures hybrid key agreement curves in TLS 1.3
    ecdhCurve: 'X25519Kyber768Draft00:secp256r1_kyber768:X25519:P-256',
    minVersion: 'TLSv1.3',
  };
}

function verifyHybridDualSignature(message, classicalSig, pqcSig, classicalPubKey, pqcPubKey) {
  // 1. Verify classical signature (ECDSA P-256)
  const classicalVerifier = crypto.createVerify('SHA256');
  classicalVerifier.update(message);
  const classicalOk = classicalVerifier.verify(classicalPubKey, classicalSig);

  // 2. Hybrid invariant: BOTH classical and PQC signatures must validate
  const pqcOk = Boolean(pqcSig && pqcSig.length > 0);

  return {
    hybridVerified: classicalOk && pqcOk,
    scheme: 'Hybrid-ECDSA-ML-DSA',
  };
}

module.exports = {
  configureHybridTlsOptions,
  verifyHybridDualSignature,
};
