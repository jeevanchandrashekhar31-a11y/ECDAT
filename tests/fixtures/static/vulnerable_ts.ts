// Vulnerable TypeScript Test Fixture (Phase 2.4)
import { createHash, generateKeyPairSync, createCipheriv } from 'crypto';
import * as https from 'https';
import * as jwt from 'jsonwebtoken';

// 1. Weak Hash via destructured import
const weakHashVal: string = createHash('md5').update('data').digest('hex');

// 2. Insecure Cipher & ECB mode
const cipher = createCipheriv('des-ecb', Buffer.alloc(8), Buffer.alloc(0));

// 3. Weak RSA Key Size via constant
const SMALL_KEY: number = 1024;
const keys = generateKeyPairSync('rsa', {
    modulusLength: SMALL_KEY,
});

// 4. Insecure TLS Agent
const agent = new https.Agent({
    rejectUnauthorized: false,
    minVersion: 'TLSv1'
});

// 5. JWT Algorithm None
function decodeUntrusted(token: string, secret: string) {
    return jwt.verify(token, secret, { algorithms: ['none'] });
}
