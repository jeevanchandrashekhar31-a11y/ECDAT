// Comprehensive Insecure JavaScript Test Fixture (Phase 2.4)
const crypto = require('crypto');
const { createHash, createCipheriv } = require('crypto');
const { createHash: makeHash } = require('node:crypto');
const CryptoJS = require('crypto-js');
const jwt = require('jsonwebtoken');

// 1. Destructured imports and dynamic constant strings
const WEAK_HASH_ALGO = 'md5';
const dynamicDigest = makeHash(WEAK_HASH_ALGO).update('data').digest('hex');

// 2. Insecure Ciphers and ECB mode
const desCipher = createCipheriv('des-ecb', Buffer.alloc(8), Buffer.alloc(0));
const aesEcb = createCipheriv('aes-128-ecb', Buffer.alloc(16), Buffer.alloc(0));

// 3. Wrapper functions calling weak algorithms
function hashData(data) {
    const hash = createHash('md5');
    hash.update(data);
    return hash.digest('hex');
}

// 4. Weak Key Sizes (modulusLength < 2048) & Diffie-Hellman
const WEAK_KEY_SIZE = 1024;
const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: WEAK_KEY_SIZE,
});
const dh = crypto.createDiffieHellman(1024);

// 5. TLS Configuration: disabled verification & insecure version
const tlsConfig = {
    rejectUnauthorized: false,
    minVersion: 'TLSv1'
};
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// 6. JWT None Algorithm
function verifyUser(token, secret) {
    return jwt.verify(token, secret, { algorithms: ['none'] });
}

// 7. CryptoJS Usage
const cjsMd5 = CryptoJS.MD5('message');
