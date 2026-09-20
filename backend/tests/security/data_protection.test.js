// @ecdat-synthetic-corpus
/**
 * Test Suite: ECDAT Database and Data Security — Phase 16.1 Data Protection
 *
 * Tests:
 * 1. Data Classification Taxonomy & Domain Protection Policies
 * 2. Zero-Secret-Storage Invariant Enforcement & Documented Exception Registry
 * 3. AES-256-GCM Encryption at Rest with Key Rotation & AAD
 * 4. Data in Transit TLS Enforcement (Database SSL, HSTS, Outbound HTTPS)
 * 5. Security REST API Endpoints for Data Protection
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const {
  CLASSIFICATION_TIERS,
  TIER_METADATA,
  classifyField,
  getDomainProtectionPolicy,
  getClassificationTaxonomy,
  detectSecrets,
  scrubSecrets,
  assertStorageAllowed,
  getDocumentedExceptions,
  ProhibitedSecretStorageError,
  EncryptionAtRestService,
  defaultEncryptionAtRest,
  configureDbTls,
  tlsEnforcementMiddleware,
  validateOutboundTlsUrl,
  getTransitSecurityStatus,
  InsecureTransitError,
} = require("../../src/security");

const app = require("../../src/app");
const config = require("../../src/config");
if (!config.ECDAT_API_KEY) {
  config.ECDAT_API_KEY = "test-dataprotect-key-32-chars-long-entropy!!";
}

// Synthetic test dummy keys (NOT real credentials)
const FAKE_RSA_PRIVATE_KEY = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y3wZ8u+fF9Qx...SYNTHETIC_TEST_KEY...
-----END RSA PRIVATE KEY-----`;

const FAKE_EC_PRIVATE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEI...SYNTHETIC_TEST_EC_KEY...
-----END EC PRIVATE KEY-----`;

describe("Phase 16.1 — Data Classification & Protection Architecture", () => {
  it("defines all four required classification tiers with accurate security controls", () => {
    assert.strictEqual(CLASSIFICATION_TIERS.RESTRICTED, "RESTRICTED");
    assert.strictEqual(CLASSIFICATION_TIERS.CONFIDENTIAL, "CONFIDENTIAL");
    assert.strictEqual(CLASSIFICATION_TIERS.INTERNAL, "INTERNAL");
    assert.strictEqual(CLASSIFICATION_TIERS.PUBLIC, "PUBLIC");

    const restricted = TIER_METADATA[CLASSIFICATION_TIERS.RESTRICTED];
    assert.strictEqual(restricted.level, 4);
    assert.strictEqual(restricted.atRestEncryption, "REQUIRED");
    assert.strictEqual(restricted.maskInLogs, true);
    assert.strictEqual(restricted.maskInApiResponses, true);
    assert.strictEqual(restricted.allowPlaintextStorage, false);
    assert.strictEqual(restricted.zeroSecretStorageApplies, true);

    const confidential = TIER_METADATA[CLASSIFICATION_TIERS.CONFIDENTIAL];
    assert.strictEqual(confidential.level, 3);
    assert.strictEqual(confidential.zeroSecretStorageApplies, true);

    const internal = TIER_METADATA[CLASSIFICATION_TIERS.INTERNAL];
    assert.strictEqual(internal.level, 2);

    const pub = TIER_METADATA[CLASSIFICATION_TIERS.PUBLIC];
    assert.strictEqual(pub.level, 1);
  });

  it("classifies all 7 required data domains correctly", () => {
    // 1. Credentials
    const pwd = classifyField("identity", "password_hash");
    assert.strictEqual(pwd.tier, CLASSIFICATION_TIERS.RESTRICTED);
    assert.strictEqual(pwd.domain, "credentials");
    assert.strictEqual(pwd.atRestEncryption, "REQUIRED");
    assert.strictEqual(pwd.maskInLogs, true);

    const mfa = classifyField("identity", "mfa_totp_secret");
    assert.strictEqual(mfa.tier, CLASSIFICATION_TIERS.RESTRICTED);
    assert.strictEqual(mfa.domain, "credentials");
    assert.strictEqual(mfa.documentedException, "MFA_TOTP_SECRET_STORAGE");

    // 2. Integration Tokens
    const kms = classifyField("integrations", "kms_credentials");
    assert.strictEqual(kms.tier, CLASSIFICATION_TIERS.RESTRICTED);
    assert.strictEqual(kms.domain, "integration_tokens");
    assert.strictEqual(kms.atRestEncryption, "REQUIRED");
    assert.strictEqual(kms.documentedException, "INTEGRATION_CREDENTIAL_STORAGE");

    const ticketing = classifyField("integrations", "ticketing_token");
    assert.strictEqual(ticketing.tier, CLASSIFICATION_TIERS.RESTRICTED);
    assert.strictEqual(ticketing.domain, "integration_tokens");

    // 3. Scan Metadata
    const target = classifyField("scans", "target_name");
    assert.strictEqual(target.tier, CLASSIFICATION_TIERS.CONFIDENTIAL);
    assert.strictEqual(target.domain, "scan_metadata");

    // 4. Asset Ownership
    const owner = classifyField("assets", "owner_id");
    assert.strictEqual(owner.tier, CLASSIFICATION_TIERS.CONFIDENTIAL);
    assert.strictEqual(owner.domain, "asset_ownership");

    const tenant = classifyField("assets", "tenant_id");
    assert.strictEqual(tenant.tier, CLASSIFICATION_TIERS.CONFIDENTIAL);
    assert.strictEqual(tenant.domain, "asset_ownership");

    // 5. Security Findings
    const algo = classifyField("findings", "algorithm");
    assert.strictEqual(algo.tier, CLASSIFICATION_TIERS.CONFIDENTIAL);
    assert.strictEqual(algo.domain, "security_findings");

    const evidence = classifyField("findings", "evidence_context");
    assert.strictEqual(evidence.tier, CLASSIFICATION_TIERS.CONFIDENTIAL);
    assert.strictEqual(evidence.domain, "security_findings");

    // 6. Certificates
    const cert = classifyField("certificates", "public_cert");
    assert.strictEqual(cert.tier, CLASSIFICATION_TIERS.INTERNAL);
    assert.strictEqual(cert.domain, "certificates");

    // 7. Fingerprints
    const fp = classifyField("certificates", "fingerprint_sha256");
    assert.strictEqual(fp.tier, CLASSIFICATION_TIERS.INTERNAL);
    assert.strictEqual(fp.domain, "fingerprints");

    const spki = classifyField("components", "spki_fingerprint");
    assert.strictEqual(spki.tier, CLASSIFICATION_TIERS.INTERNAL);
    assert.strictEqual(spki.domain, "fingerprints");
  });

  it("classifies secret key material as strictly prohibited from storage", () => {
    const privKey = classifyField("crypto", "private_key");
    assert.strictEqual(privKey.tier, CLASSIFICATION_TIERS.RESTRICTED);
    assert.strictEqual(privKey.domain, "secret_key_material");
    assert.strictEqual(privKey.storageAllowed, false);

    const symKey = classifyField("crypto", "symmetric_key");
    assert.strictEqual(symKey.tier, CLASSIFICATION_TIERS.RESTRICTED);
    assert.strictEqual(symKey.domain, "secret_key_material");
    assert.strictEqual(symKey.storageAllowed, false);
  });

  it("provides comprehensive domain protection policies and taxonomy", () => {
    const policy = getDomainProtectionPolicy("credentials");
    assert.strictEqual(policy.domain, "credentials");
    assert.strictEqual(policy.tier, CLASSIFICATION_TIERS.RESTRICTED);
    assert.strictEqual(policy.atRestEncryption, "REQUIRED");

    const taxonomy = getClassificationTaxonomy();
    assert.ok(taxonomy.domains.length >= 7);
    assert.ok(taxonomy.catalogCount >= 15);
  });
});

describe("Phase 16.1 — Zero-Secret-Storage Policy & Documented Exceptions", () => {
  it("detects private key PEM headers and forbidden secret fields in payloads", () => {
    const testPayload = {
      scanId: "scan-100",
      findings: [
        {
          algorithm: "RSA",
          keySize: 2048,
          rawKeyData: FAKE_RSA_PRIVATE_KEY,
        },
      ],
      metadata: {
        embeddedKey: FAKE_EC_PRIVATE_KEY,
        private_key: "dummy-raw-bytes",
      },
    };

    const violations = detectSecrets(testPayload);
    assert.ok(violations.length >= 3);
    assert.ok(violations.some((v) => v.type === "PRIVATE_KEY_PEM"));
    assert.ok(violations.some((v) => v.type === "FORBIDDEN_KEY_FIELD"));
  });

  it("assertStorageAllowed rejects private key persistence with ProhibitedSecretStorageError", () => {
    const maliciousPayload = {
      assetId: "asset-web-1",
      privateKey: FAKE_RSA_PRIVATE_KEY,
    };

    assert.throws(
      () => {
        assertStorageAllowed("assets", maliciousPayload);
      },
      (err) => {
        assert.ok(err instanceof ProhibitedSecretStorageError);
        assert.ok(err.message.includes("Zero-Secret-Storage policy"));
        return true;
      }
    );
  });

  it("scrubSecrets sanitizes private keys without mutating legitimate non-secret fields", () => {
    const payload = {
      assetId: "asset-server-01",
      host: "api.enterprise.com",
      port: 443,
      detectedCert: "CN=api.enterprise.com",
      leakedKey: FAKE_RSA_PRIVATE_KEY,
      nested: {
        private_key: "raw-private-scalar",
      },
    };

    const { sanitized, scrubbedCount, scrubbedPaths } = scrubSecrets(payload);
    assert.strictEqual(scrubbedCount, 2);
    assert.ok(scrubbedPaths.length === 2);
    assert.strictEqual(sanitized.assetId, "asset-server-01");
    assert.strictEqual(sanitized.host, "api.enterprise.com");
    assert.strictEqual(sanitized.leakedKey, "[REDACTED_PROHIBITED_PRIVATE_KEY]");
    assert.strictEqual(sanitized.nested.private_key, "[REDACTED_PROHIBITED_KEY_FIELD]");
  });

  it("verifies documented unavoidable requirements for integration tokens and MFA", () => {
    const exceptions = getDocumentedExceptions();
    assert.ok(exceptions.length >= 3);

    const integrationException = exceptions.find((e) => e.id === "INTEGRATION_CREDENTIAL_STORAGE");
    assert.ok(integrationException);
    assert.ok(integrationException.mandatoryControls.some((c) => c.includes("AES-256-GCM")));

    // Integration token storage with valid documented exception succeeds
    const integrationPayload = {
      connectorName: "prod-aws-kms",
      region: "us-east-1",
    };
    const result = assertStorageAllowed("integrations.kms", integrationPayload, {
      exceptionId: "INTEGRATION_CREDENTIAL_STORAGE",
    });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.allowedException.id, "INTEGRATION_CREDENTIAL_STORAGE");

    // Attempting an invalid/undocumented exception ID fails
    assert.throws(
      () => {
        assertStorageAllowed("integrations.kms", integrationPayload, {
          exceptionId: "UNAPPROVED_CUSTOM_BACKDOOR",
        });
      },
      (err) => {
        assert.ok(err instanceof ProhibitedSecretStorageError);
        assert.ok(err.message.includes("not a recognized documented"));
        return true;
      }
    );

    // Documented exception cannot be abused to persist private keys
    const invalidAbusePayload = {
      connectorName: "prod-kms",
      privateKey: FAKE_RSA_PRIVATE_KEY,
    };
    assert.throws(
      () => {
        assertStorageAllowed("integrations.kms", invalidAbusePayload, {
          exceptionId: "INTEGRATION_CREDENTIAL_STORAGE",
        });
      },
      (err) => {
        assert.ok(err instanceof ProhibitedSecretStorageError);
        assert.ok(err.message.includes("Zero-Secret-Storage policy"));
        return true;
      }
    );
  });
});

describe("Phase 16.1 — AES-256-GCM Encryption at Rest", () => {
  it("encrypts and decrypts strings using AES-256-GCM with authentication tag", () => {
    const encryption = new EncryptionAtRestService({
      masterKey: crypto.randomBytes(32),
      masterKid: "test_key_v1",
    });

    const plaintext = "super-secret-integration-token-ghp_1234567890abcdef";
    const ciphertext = encryption.encrypt(plaintext);

    assert.ok(encryption.isEncrypted(ciphertext));
    assert.ok(ciphertext.startsWith("enc:v1:test_key_v1:"));

    const decrypted = encryption.decrypt(ciphertext);
    assert.strictEqual(decrypted, plaintext);
  });

  it("generates unique 96-bit IVs for repeated encryptions of identical plaintext", () => {
    const encryption = new EncryptionAtRestService({
      masterKey: crypto.randomBytes(32),
    });

    const plaintext = "identical-plaintext-string";
    const enc1 = encryption.encrypt(plaintext);
    const enc2 = encryption.encrypt(plaintext);

    assert.notStrictEqual(enc1, enc2);

    const parts1 = enc1.split(":");
    const parts2 = enc2.split(":");
    assert.notStrictEqual(parts1[3], parts2[3]); // IVs are distinct
  });

  it("detects tampering and bit-flipping attacks via authentication tag verification", () => {
    const encryption = new EncryptionAtRestService({
      masterKey: crypto.randomBytes(32),
    });

    const ciphertext = encryption.encrypt("confidential-vulnerability-data");
    const parts = ciphertext.split(":");
    // Tamper with ciphertext payload
    const rawCiphertext = Buffer.from(parts[5], "base64");
    rawCiphertext[0] ^= 0xff; // flip bits
    parts[5] = rawCiphertext.toString("base64");
    const tampered = parts.join(":");

    assert.throws(
      () => {
        encryption.decrypt(tampered);
      },
      (err) => {
        assert.strictEqual(err.code, "ERR_AUTH_FAILED");
        return true;
      }
    );
  });

  it("binds ciphertext to context via Additional Authenticated Data (AAD)", () => {
    const encryption = new EncryptionAtRestService({
      masterKey: crypto.randomBytes(32),
    });

    const secretData = "tenant-specific-database-secret";
    const tenantA = { tenantId: "tenant-alpha" };
    const tenantB = { tenantId: "tenant-beta" };

    const ciphertext = encryption.encrypt(secretData, { aad: tenantA });

    // Decrypting with correct AAD succeeds
    const decrypted = encryption.decrypt(ciphertext, { aad: tenantA });
    assert.strictEqual(decrypted, secretData);

    // Decrypting with wrong AAD fails authentication
    assert.throws(
      () => {
        encryption.decrypt(ciphertext, { aad: tenantB });
      },
      (err) => {
        assert.strictEqual(err.code, "ERR_AUTH_FAILED");
        return true;
      }
    );
  });

  it("supports seamless master key rotation and multi-key decryption", () => {
    const key1 = crypto.randomBytes(32);
    const key2 = crypto.randomBytes(32);

    const encryption = new EncryptionAtRestService({
      masterKey: key1,
      masterKid: "key_2026_01",
    });

    const secretOld = "data-encrypted-under-key1";
    const ciphertextOld = encryption.encrypt(secretOld);
    assert.ok(ciphertextOld.includes("key_2026_01"));

    // Rotate to key2
    encryption.rotateKey(key2, "key_2026_02");

    // Old ciphertext can still be decrypted by keyring
    const decryptedOld = encryption.decrypt(ciphertextOld);
    assert.strictEqual(decryptedOld, secretOld);

    // New encryption uses active key2
    const secretNew = "data-encrypted-under-key2";
    const ciphertextNew = encryption.encrypt(secretNew);
    assert.ok(ciphertextNew.includes("key_2026_02"));
    assert.strictEqual(encryption.decrypt(ciphertextNew), secretNew);

    // Re-encrypt old record with active key
    const reencrypted = encryption.reencrypt(ciphertextOld);
    assert.ok(reencrypted.includes("key_2026_02"));
    assert.strictEqual(encryption.decrypt(reencrypted), secretOld);
  });

  it("performs automated entity field-level encryption based on data classification", () => {
    const encryption = new EncryptionAtRestService({
      masterKey: crypto.randomBytes(32),
    });

    const integrationRecord = {
      id: "conn-jira-01",
      name: "Corporate Jira",
      provider: "jira",
      kms_credentials: "super-secret-kms-token",
      ticketing_token: "jira-pat-token-secret",
      status: "active",
    };

    const encryptedRecord = encryption.encryptEntityFields("integrations", integrationRecord);
    assert.strictEqual(encryptedRecord.name, "Corporate Jira");
    assert.ok(encryption.isEncrypted(encryptedRecord.kms_credentials));
    assert.ok(encryption.isEncrypted(encryptedRecord.ticketing_token));

    const decryptedRecord = encryption.decryptEntityFields("integrations", encryptedRecord);
    assert.strictEqual(decryptedRecord.kms_credentials, "super-secret-kms-token");
    assert.strictEqual(decryptedRecord.ticketing_token, "jira-pat-token-secret");
  });
});

describe("Phase 16.1 — Data in Transit TLS Enforcement", () => {
  it("configures PostgreSQL database TLS and enforces TLS in production", () => {
    // Development default without env returns false or dev config
    const devSsl = configureDbTls({ nodeEnv: "development", sslEnabled: false });
    assert.strictEqual(devSsl, false);

    // Explicit SSL enabled
    const explicitSsl = configureDbTls({
      nodeEnv: "development",
      sslEnabled: true,
      rejectUnauthorized: true,
    });
    assert.deepStrictEqual(explicitSsl, { rejectUnauthorized: true });

    // Production without SSL throws InsecureTransitError unless explicitly bypassed
    assert.throws(
      () => {
        configureDbTls({ nodeEnv: "production", sslEnabled: false });
      },
      (err) => {
        assert.ok(err instanceof InsecureTransitError);
        assert.ok(err.message.includes("cleartext database connections are prohibited"));
        return true;
      }
    );
  });

  it("sets Strict-Transport-Security (HSTS) headers via middleware", () => {
    const middleware = tlsEnforcementMiddleware({ hstsMaxAge: 31536000 });
    const headers = {};
    const req = {
      secure: true,
      headers: {},
      socket: { encrypted: true },
      method: "GET",
    };
    const res = {
      setHeader: (name, val) => {
        headers[name] = val;
      },
    };
    let nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, true);
    assert.ok(headers["Strict-Transport-Security"].includes("max-age=31536000"));
    assert.ok(headers["Strict-Transport-Security"].includes("includeSubDomains"));
    assert.ok(headers["Strict-Transport-Security"].includes("preload"));
  });

  it("rejects cleartext HTTP mutation requests when TLS is enforced", () => {
    const middleware = tlsEnforcementMiddleware({ enforceInDev: true });
    let statusCode = 200;
    let jsonBody = null;
    const req = {
      secure: false,
      headers: { host: "api.ecdat.io" },
      socket: { encrypted: false },
      method: "POST",
      url: "/api/v1/scans",
    };
    const res = {
      setHeader: () => {},
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => {
            jsonBody = body;
          },
        };
      },
    };

    middleware(req, res, () => {});
    assert.strictEqual(statusCode, 426);
    assert.strictEqual(jsonBody.code, "ERR_TLS_REQUIRED");
  });

  it("validates that outbound integration endpoints strictly use TLS (HTTPS)", () => {
    const validHttps = validateOutboundTlsUrl("https://kms.us-east-1.amazonaws.com");
    assert.strictEqual(validHttps.valid, true);

    const validJira = validateOutboundTlsUrl("https://jira.enterprise.com/rest/api/2");
    assert.strictEqual(validJira.valid, true);

    const invalidHttp = validateOutboundTlsUrl("http://insecure-kms.external.net/keys", {
      allowLocalhostInDev: false,
    });
    assert.strictEqual(invalidHttp.valid, false);
    assert.ok(invalidHttp.error.includes("must use TLS ('https://')"));
  });

  it("reports transit security posture status", () => {
    const status = getTransitSecurityStatus();
    assert.strictEqual(status.databaseTls.enforcedInProduction, true);
    assert.strictEqual(status.inboundApiTls.enforceHttpsInProduction, true);
    assert.strictEqual(status.inboundApiTls.hstsEnabled, true);
    assert.strictEqual(status.outboundIntegrationsTls.enforceHttpsForIntegrations, true);
  });
});

function withServer(callback) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const baseUrl = `http://127.0.0.1:${port}`;
      try {
        await callback(baseUrl);
        server.close(resolve);
      } catch (err) {
        server.close(() => reject(err));
      }
    });
  });
}

describe("Phase 16.1 — Security REST API Endpoints", () => {
  it("GET /api/v1/security/data-classification returns taxonomy and matrix", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/security/data-classification`, {
        method: "GET",
        headers: { "x-api-key": config.ECDAT_API_KEY },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.tiers);
      assert.ok(body.domains.length >= 7);
    });
  });

  it("POST /api/v1/security/data-classification/classify returns field tier", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/security/data-classification/classify`, {
        method: "POST",
        headers: {
          "x-api-key": config.ECDAT_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entityType: "integrations",
          fieldName: "kms_credentials",
        }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.tier, "RESTRICTED");
      assert.strictEqual(body.atRestEncryption, "REQUIRED");
    });
  });

  it("GET /api/v1/security/documented-secret-exceptions returns exception registry", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/security/documented-secret-exceptions`, {
        method: "GET",
        headers: { "x-api-key": config.ECDAT_API_KEY },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.total >= 3);
      assert.ok(body.exceptions.some((e) => e.id === "INTEGRATION_CREDENTIAL_STORAGE"));
    });
  });

  it("POST /api/v1/security/validate-secret-storage enforces zero-secret policy", async () => {
    await withServer(async (baseUrl) => {
      // Prohibited private key is rejected
      const badRes = await fetch(`${baseUrl}/api/v1/security/validate-secret-storage`, {
        method: "POST",
        headers: {
          "x-api-key": config.ECDAT_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entityType: "assets",
          data: {
            assetName: "server-01",
            privateKeyPem: FAKE_RSA_PRIVATE_KEY,
          },
        }),
      });
      assert.strictEqual(badRes.status, 400);
      const badBody = await badRes.json();
      assert.strictEqual(badBody.code, "ERR_PROHIBITED_SECRET_STORAGE");

      // Clean payload is accepted
      const goodRes = await fetch(`${baseUrl}/api/v1/security/validate-secret-storage`, {
        method: "POST",
        headers: {
          "x-api-key": config.ECDAT_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          entityType: "assets",
          data: {
            assetName: "server-01",
            algorithm: "Kyber768",
            publicKeyCert: "CN=server-01",
          },
        }),
      });
      assert.strictEqual(goodRes.status, 200);
      const goodBody = await goodRes.json();
      assert.strictEqual(goodBody.allowed, true);
    });
  });

  it("POST /api/v1/security/encrypt-at-rest and /decrypt-at-rest roundtrip", async () => {
    await withServer(async (baseUrl) => {
      const plaintext = "sensitive-kms-arn-and-client-secret-12345";

      const encRes = await fetch(`${baseUrl}/api/v1/security/encrypt-at-rest`, {
        method: "POST",
        headers: {
          "x-api-key": config.ECDAT_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({ plaintext, aad: "connector-1" }),
      });
      assert.strictEqual(encRes.status, 200);
      const encBody = await encRes.json();
      assert.ok(encBody.ciphertext.startsWith("enc:v1:"));

      const decRes = await fetch(`${baseUrl}/api/v1/security/decrypt-at-rest`, {
        method: "POST",
        headers: {
          "x-api-key": config.ECDAT_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify({ ciphertext: encBody.ciphertext, aad: "connector-1" }),
      });
      assert.strictEqual(decRes.status, 200);
      const decBody = await decRes.json();
      assert.strictEqual(decBody.plaintext, plaintext);
    });
  });

  it("GET /api/v1/security/transit-status returns transit TLS posture", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/v1/security/transit-status`, {
        method: "GET",
        headers: { "x-api-key": config.ECDAT_API_KEY },
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.databaseTls.enforcedInProduction, true);
      assert.strictEqual(body.inboundApiTls.hstsEnabled, true);
    });
  });
});
