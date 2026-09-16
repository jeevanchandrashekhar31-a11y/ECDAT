/**
 * Category: TLS Misconfigurations (Phase 22.3 Golden Corpus)
 * Node.js HTTPS / TLS client disabling verification
 */

const https = require('https');
const tls = require('tls');

function createInsecureAgent() {
  return new https.Agent({
    // Dangerous: Disables all certificate trust and CA verification
    rejectUnauthorized: false,
    // Dangerous: Permitting obsolete TLS 1.0
    minVersion: 'TLSv1',
    maxVersion: 'TLSv1.1',
    ciphers: 'DEFAULT:@SECLEVEL=0',
  });
}

function connectRawTlsInsecure(host, port) {
  return tls.connect({
    host,
    port,
    rejectUnauthorized: false,
    checkServerIdentity: () => undefined, // Bypass hostname checking
  });
}

module.exports = {
  createInsecureAgent,
  connectRawTlsInsecure,
};
