// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_0(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_0 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_1(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_1 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_2(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_2 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_3(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_3 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_4(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_4 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_5(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_5 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_6(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_6 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_7(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_7 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_8(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_8 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_143_9(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_143_9 };
