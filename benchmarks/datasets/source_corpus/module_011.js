// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_0(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_0 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_1(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_1 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_2(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_2 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_3(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_3 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_4(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_4 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_5(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_5 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_6(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_6 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_7(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_7 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_8(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_8 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_11_9(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_11_9 };
