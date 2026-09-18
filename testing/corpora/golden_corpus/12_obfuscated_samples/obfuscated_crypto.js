// @ecdat-synthetic-corpus
/**
 * Golden Corpus Fixture: 12_obfuscated_samples/obfuscated_crypto.js
 * Category: 12_obfuscated_samples
 * Demonstrates obfuscated Node.js cryptographic invocations:
 * - eval() dynamic cipher invocation
 * - Array join algorithm reconstruction: ['m', 'd', '5'].join('')
 * - Hex-encoded algorithm name decoding
 */

const crypto = require('crypto');

// 1. Array join reconstruction
function computeObfuscatedMd5(data) {
    const parts = ['m', 'd', '5'];
    const algo = parts.join('');
    return crypto.createHash(algo).update(data).digest('hex');
}

// 2. Hex-decoded algorithm string ("73686131" -> "sha1")
function getHexDecodedSha1(payload) {
    const hex = '73686131';
    const algo = Buffer.from(hex, 'hex').toString('utf8');
    return crypto.createHash(algo).update(payload).digest('hex');
}

// 3. Eval dynamic cipher
function getEvalDesCipher(key, iv) {
    const expr = "crypto.createCipheriv('des-ecb', key, iv)";
    return eval(expr);
}

module.exports = { computeObfuscatedMd5, getHexDecodedSha1, getEvalDesCipher };
