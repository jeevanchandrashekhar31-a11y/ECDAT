/**
 * Category: Weak Algorithms (Phase 22.3 Golden Corpus)
 * Node.js calls to legacy algorithms:
 * - MD5
 * - SHA-1
 * - DES / 3DES
 * - RC4
 */

const crypto = require('crypto');

function computeWeakHashes(data) {
  const md5 = crypto.createHash('md5').update(data).digest('hex');
  const sha1 = crypto.createHash('sha1').update(data).digest('hex');
  return { md5, sha1 };
}

function createWeakCiphers(key, iv) {
  const des = crypto.createCipheriv('des-cbc', key.slice(0, 8), iv.slice(0, 8));
  const desEde3 = crypto.createCipheriv('des-ede3-cbc', key.slice(0, 24), iv.slice(0, 8));
  const rc4 = crypto.createCipheriv('rc4', key.slice(0, 16), '');
  return { des, desEde3, rc4 };
}

module.exports = {
  computeWeakHashes,
  createWeakCiphers,
};
