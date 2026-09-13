// Compliant / Secure JavaScript Test Fixture (Phase 2.4)
const crypto = require('node:crypto');
const https = require('https');
const jwt = require('jsonwebtoken');

// 1. Secure Hash: SHA-256
function computeHash(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

// 2. Secure Cipher: AES-256-GCM
function encryptData(key, iv, data) {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    return Buffer.concat([cipher.update(data), cipher.final()]);
}

// 3. Secure Key Size: RSA-3072
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
});

// 4. Secure TLS Agent
const secureAgent = new https.Agent({
    rejectUnauthorized: true,
    minVersion: 'TLSv1.3'
});

// 5. Secure JWT
function verifyValidJwt(token, key) {
    return jwt.verify(token, key, { algorithms: ['RS256'] });
}
