/**
 * Category: Dynamically Selected Algorithms (Phase 22.3 Golden Corpus)
 * Node.js dynamically resolved algorithm selection
 */

const crypto = require('crypto');

function getHashForPayload(data, runtimeConfig) {
  // Dynamically resolved from configuration object or default
  const chosenAlgorithm = (runtimeConfig && runtimeConfig.algorithm) ? runtimeConfig.algorithm : 'sha256';
  return crypto.createHash(chosenAlgorithm).update(data).digest('hex');
}

function resolveCipherFromLevel(tier) {
  const cipherMap = {
    legacy: 'des-cbc',
    standard: 'aes-128-cbc',
    enterprise: 'aes-256-gcm',
  };
  return cipherMap[tier] || 'aes-256-gcm';
}

module.exports = {
  getHashForPayload,
  resolveCipherFromLevel,
};
