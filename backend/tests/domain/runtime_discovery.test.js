const test = require("node:test");
const assert = require("node:assert/strict");

const {
  RuntimeCapabilityStatus,
  SensitiveDataExposureError,
  RuntimeCryptoEvent,
  KernelCapabilityChecker,
  RuntimeProbesCatalog,
  RuntimeObservationSubsystem,
  assertMetadataOnly,
} = require("../../src/domain/runtime_discovery");

const { RelationshipType, EvidenceSource } = require("../../src/domain/contracts");

test("Graceful Degradation - handles disabled in config or non-linux platform", () => {
  // Disabled by config
  const disabled = KernelCapabilityChecker.checkCapabilities(false);
  assert.equal(disabled.status, RuntimeCapabilityStatus.DISABLED_BY_CONFIG);
  assert.ok(disabled.reason.includes("disabled by configuration"));

  const subDisabled = new RuntimeObservationSubsystem({ enabled: false });
  assert.equal(subDisabled.isOperational(), false);
  assert.equal(subDisabled.status, RuntimeCapabilityStatus.DISABLED_BY_CONFIG);

  // Enabled on current OS
  const subEnabled = new RuntimeObservationSubsystem({ enabled: true });
  if (process.platform !== "linux") {
    assert.equal(subEnabled.isOperational(), false);
    assert.equal(subEnabled.status, RuntimeCapabilityStatus.UNAVAILABLE_NON_LINUX);
    assert.ok(subEnabled.statusReason.includes("requires Linux"));
  }
});

test("Metadata-Only Invariant - allows valid parameters and rejects sensitive fields", () => {
  // Valid metadata parameters
  const valid = {
    cipher_name: "AES-256-GCM",
    key_length: 256,
    mode: "GCM",
  };
  assert.doesNotThrow(() => assertMetadataOnly(valid));

  // Rejection of private_key
  assert.throws(
    () => assertMetadataOnly({ private_key: "MIIEowIBAAKCAQEA..." }),
    {
      name: "SensitiveDataExposureError",
      message: /Forbidden sensitive field 'private_key' detected/,
    }
  );

  // Rejection of plaintext
  assert.throws(
    () => assertMetadataOnly({ plaintext: "user credentials and ssn" }),
    {
      name: "SensitiveDataExposureError",
      message: /Forbidden sensitive field 'plaintext' detected/,
    }
  );

  // Rejection of password and token
  assert.throws(
    () => assertMetadataOnly({ password: "secret_password_123" }),
    {
      name: "SensitiveDataExposureError",
    }
  );

  assert.throws(
    () => assertMetadataOnly({ auth_token: "ghp_xxxxxxxxxxxxxxxxxxxx" }),
    {
      name: "SensitiveDataExposureError",
    }
  );

  // Rejection of PEM private key header in any value
  assert.throws(
    () => assertMetadataOnly({ buffer_data: "-----BEGIN RSA PRIVATE KEY-----\n..." }),
    {
      name: "SensitiveDataExposureError",
      message: /Private key material detected/,
    }
  );
});

test("RuntimeCryptoEvent - enforces metadata-only invariant at construction", () => {
  assert.throws(
    () => {
      new RuntimeCryptoEvent({
        processId: 120,
        functionName: "EVP_EncryptInit_ex",
        parameters: { raw_key: "super_secret" },
      });
    },
    {
      name: "SensitiveDataExposureError",
    }
  );

  const clean = new RuntimeCryptoEvent({
    processId: 300,
    processName: "nginx",
    libraryName: "OpenSSL",
    functionName: "EVP_EncryptInit_ex",
    cryptoOperation: "symmetric_encryption_init",
    parameters: { cipher_name: "AES-256-GCM" },
  });
  assert.equal(clean.processId, 300);
  assert.equal(clean.parameters.cipher_name, "AES-256-GCM");
});

test("Runtime Probes Catalog - loads version and looks up target functions", () => {
  const catalog = new RuntimeProbesCatalog();
  assert.equal(catalog.version, "1.0.0");

  const probe = catalog.lookupFunction("SSL_do_handshake");
  assert.ok(probe);
  assert.equal(probe.crypto_operation, "tls_handshake");
  assert.ok(probe.library_name);

  const evp = catalog.lookupFunction("EVP_EncryptInit_ex");
  assert.ok(evp);
  assert.equal(evp.crypto_operation, "symmetric_encryption_init");
});

test("Runtime Subsystem & Correlation - links Process -> Library -> Function -> Asset", () => {
  const subsystem = new RuntimeObservationSubsystem({ enabled: true });
  const event = subsystem.recordEvent({
    processId: 9021,
    processName: "vault-agent",
    libraryName: "OpenSSL",
    functionName: "EVP_EncryptInit_ex",
    parameters: { cipher_name: "AES-256-GCM", key_length: 256 },
    containerId: "containerd://b489c201",
    applicationName: "vault",
    serviceName: "key-manager",
  });

  assert.equal(event.processId, 9021);
  assert.equal(event.cryptoOperation, "symmetric_encryption_init");

  const correlation = subsystem.correlateToDomainAssets(event);
  assert.equal(correlation.application_ref, "app:vault");
  assert.equal(correlation.process_ref, "proc:9021:vault-agent");
  assert.equal(correlation.library_ref, "lib:openssl");
  assert.equal(correlation.function_ref, "fn:openssl:EVP_EncryptInit_ex");
  assert.equal(correlation.crypto_asset_id, "runtime:asset:AES-256-GCM-256");
  assert.equal(correlation.reachability, "RUNTIME_CONFIRMED");
  assert.equal(correlation.evidence_source, EvidenceSource.RUNTIME);

  const relTypes = correlation.relationships.map((r) => r.relationship_type);
  assert.ok(relTypes.includes("hosts_process"));
  assert.ok(relTypes.includes(RelationshipType.DEPENDS_ON));
  assert.ok(relTypes.includes(RelationshipType.USES));
  assert.ok(relTypes.includes(RelationshipType.IMPLEMENTS));
});
