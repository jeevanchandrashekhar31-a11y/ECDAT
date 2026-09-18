// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_0(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_0 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_1(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_1 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_2(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_2 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_3(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_3 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_4(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_4 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_5(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_5 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_6(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_6 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_7(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_7 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_8(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_8 };

// @ecdat-synthetic-corpus
const crypto = require('crypto');

function encryptPayload_119_9(text, masterKey) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), enc };
}

module.exports = { encryptPayload_119_9 };
