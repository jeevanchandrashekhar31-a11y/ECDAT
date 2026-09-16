/**
 * Multi-Factor Authentication (MFA) TOTP Engine — Phase 15.2
 *
 * Implements:
 * - RFC 6238 Time-based One-Time Password (TOTP)
 * - RFC 4226 HMAC-based One-Time Password (HOTP)
 * - RFC 4648 Base32 Secret Encoding / Decoding
 * - Google Authenticator / Authy / YubiKey compatible otpauth:// URI generator
 * - Emergency backup / recovery codes with secure hash storage
 */

const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encodes a buffer to RFC 4648 Base32 string.
 */
function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

/**
 * Decodes an RFC 4648 Base32 string into a buffer.
 */
function base32Decode(base32String) {
  const clean = base32String.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) {
      throw new Error(`Invalid base32 character '${clean[i]}'`);
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

class MfaTotpEngine {
  constructor({
    stepSeconds = 30,
    digits = 6,
    algorithm = "sha1",
    issuer = "ECDAT",
  } = {}) {
    this.stepSeconds = stepSeconds;
    this.digits = digits;
    this.algorithm = algorithm.toLowerCase();
    this.issuer = issuer;
  }

  /**
   * Generates a new TOTP secret and provisioning URI for enrollment.
   */
  generateSecret({ accountName = "user@enterprise.internal" } = {}) {
    const secretBytes = crypto.randomBytes(20); // 160-bit recommended
    const secretBase32 = base32Encode(secretBytes);

    const encodedIssuer = encodeURIComponent(this.issuer);
    const encodedAccount = encodeURIComponent(accountName);
    const otpAuthUri = `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secretBase32}&issuer=${encodedIssuer}&algorithm=${this.algorithm.toUpperCase()}&digits=${this.digits}&period=${this.stepSeconds}`;

    return {
      secret: secretBase32,
      otpAuthUri,
      issuer: this.issuer,
      accountName,
      digits: this.digits,
      period: this.stepSeconds,
    };
  }

  /**
   * Generates TOTP code for a given timestamp.
   */
  generateCode(secretBase32, timestamp = Date.now()) {
    const key = base32Decode(secretBase32);
    const counter = Math.floor(timestamp / 1000 / this.stepSeconds);

    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigInt64BE(BigInt(counter));

    const hmac = crypto.createHmac(this.algorithm, key).update(counterBuffer).digest();

    // Dynamic truncation (RFC 4226 Section 5.4)
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    const codeInt = binary % Math.pow(10, this.digits);
    return String(codeInt).padStart(this.digits, "0");
  }

  /**
   * Verifies TOTP code against secret allowing a clock-drift window.
   */
  verifyCode(secretBase32, userCode, { window = 1, timestamp = Date.now() } = {}) {
    if (!secretBase32 || !userCode) return false;
    const cleanUserCode = String(userCode).trim();
    if (cleanUserCode.length !== this.digits) return false;

    const currentCounter = Math.floor(timestamp / 1000 / this.stepSeconds);

    for (let offset = -window; offset <= window; offset++) {
      const stepTime = (currentCounter + offset) * this.stepSeconds * 1000;
      const expectedCode = this.generateCode(secretBase32, stepTime);

      if (crypto.timingSafeEqual(Buffer.from(cleanUserCode), Buffer.from(expectedCode))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Generates single-use backup/recovery codes.
   */
  generateBackupCodes(count = 8) {
    const plainCodes = [];
    const hashedCodes = [];

    for (let i = 0; i < count; i++) {
      const p1 = crypto.randomBytes(2).toString("hex").toUpperCase();
      const p2 = crypto.randomBytes(2).toString("hex").toUpperCase();
      const p3 = crypto.randomBytes(2).toString("hex").toUpperCase();
      const code = `${p1}-${p2}-${p3}`;

      const hash = crypto.createHash("sha256").update(code).digest("hex");
      plainCodes.push(code);
      hashedCodes.push(hash);
    }

    return {
      plainCodes,
      hashedCodes,
    };
  }

  /**
   * Validates and consumes a single-use backup code.
   */
  verifyAndConsumeBackupCode(candidateCode, storedHashes = []) {
    if (!candidateCode || !Array.isArray(storedHashes)) return { valid: false, remainingHashes: storedHashes };

    const clean = candidateCode.trim().toUpperCase();
    const candidateHash = crypto.createHash("sha256").update(clean).digest("hex");

    const matchIndex = storedHashes.findIndex((h) => crypto.timingSafeEqual(Buffer.from(h), Buffer.from(candidateHash)));

    if (matchIndex === -1) {
      return { valid: false, remainingHashes: storedHashes };
    }

    // Single use: remove the consumed hash
    const remaining = [...storedHashes];
    remaining.splice(matchIndex, 1);

    return {
      valid: true,
      remainingHashes: remaining,
    };
  }
}

const defaultMfaEngine = new MfaTotpEngine();

module.exports = {
  MfaTotpEngine,
  defaultMfaEngine,
  base32Encode,
  base32Decode,
};
