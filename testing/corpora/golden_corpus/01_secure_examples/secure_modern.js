/**
 * Category: Secure Examples (Phase 22.3 Golden Corpus)
 * Modern Node.js crypto primitives:
 * - AES-256-GCM
 * - SHA-512
 * - Ed25519
 */

const crypto = require('crypto');

function encryptAesGcm(plaintext, key, iv) {
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { encrypted, tag };
}

function computeSha512(data) {
  return crypto.createHash('sha512').update(data).digest('hex');
}

function generateEd25519KeyPair() {
  return crypto.generateKeyPairSync('ed25519');
}

module.exports = {
  encryptAesGcm,
  computeSha512,
  generateEd25519KeyPair,
};
