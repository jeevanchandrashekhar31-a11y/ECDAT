// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_0(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_0 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_1(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_1 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_2(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_2 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_3(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_3 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_4(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_4 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_5(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_5 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_6(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_6 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_7(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_7 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_8(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_8 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_44_9(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_44_9 };
