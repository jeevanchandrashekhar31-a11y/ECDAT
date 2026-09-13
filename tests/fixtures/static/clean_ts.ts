// Secure / Compliant TypeScript Test Fixture (Phase 2.4)
import { createHash, generateKeyPairSync, createCipheriv } from 'crypto';
import * as https from 'https';
import * as jwt from 'jsonwebtoken';

export function secureHash(data: string): string {
    return createHash('sha256').update(data).digest('hex');
}

export function secureCipher(key: Buffer, iv: Buffer, data: Buffer): Buffer {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    return Buffer.concat([cipher.update(data), cipher.final()]);
}

export function secureKeys() {
    return generateKeyPairSync('rsa', {
        modulusLength: 3072,
    });
}

export const secureAgent = new https.Agent({
    rejectUnauthorized: true,
    minVersion: 'TLSv1.3'
});

export function verifyJwt(token: string, key: string) {
    return jwt.verify(token, key, { algorithms: ['RS256'] });
}
