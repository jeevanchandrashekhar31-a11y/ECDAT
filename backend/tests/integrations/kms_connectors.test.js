const test = require("node:test");
const assert = require("node:assert/strict");
const {
  KmsKeyMetadata,
  ProtectedKeyMaterialError,
  assertNoPrivateKeyMaterial,
  sanitizeMetadata,
  BaseKmsConnector,
  AwsKmsConnector,
  GcpKmsConnector,
  AzureKeyVaultConnector,
  VaultTransitConnector,
  Pkcs11HsmConnector,
  KmsDiscoveryService,
} = require("../../src/integrations/kms");

test("KmsKeyMetadata - Enforces the 7 required metadata dimensions", () => {
  const meta = new KmsKeyMetadata({
    keyId: "arn:aws:kms:us-east-1:123456789012:key/test-uuid",
    algorithm: "AES-256-GCM",
    size: 256,
    state: "Enabled",
    owner: "123456789012",
    rotation: {
      enabled: true,
      periodDays: 365,
      version: "1",
    },
    usage: {
      keyUsage: "ENCRYPT_DECRYPT",
      operations: ["encrypt", "decrypt"],
      origin: "AWS_KMS",
      isExportable: false,
    },
    provider: "aws_kms",
    description: "App Secrets Key",
  });

  // Dimension 1: key identifier
  assert.equal(meta.keyId, "arn:aws:kms:us-east-1:123456789012:key/test-uuid");
  // Dimension 2: algorithm
  assert.equal(meta.algorithm, "AES-256-GCM");
  // Dimension 3: size/parameters
  assert.equal(meta.size, 256);
  // Dimension 4: state
  assert.equal(meta.state, "Enabled");
  // Dimension 5: rotation metadata
  assert.equal(meta.rotation.enabled, true);
  assert.equal(meta.rotation.periodDays, 365);
  assert.equal(meta.rotation.version, "1");
  // Dimension 6: owner
  assert.equal(meta.owner, "123456789012");
  // Dimension 7: usage metadata
  assert.equal(meta.usage.keyUsage, "ENCRYPT_DECRYPT");
  assert.deepEqual(meta.usage.operations, ["encrypt", "decrypt"]);
  assert.equal(meta.usage.origin, "AWS_KMS");
  assert.equal(meta.usage.isExportable, false);
});

test("KmsKeyMetadata - Rejects missing required dimensions", () => {
  assert.throws(
    () => new KmsKeyMetadata({ keyId: "", algorithm: "AES", size: 256, state: "Enabled", owner: "u" }),
    /keyId/
  );
  assert.throws(
    () => new KmsKeyMetadata({ keyId: "k1", algorithm: "", size: 256, state: "Enabled", owner: "u" }),
    /algorithm/
  );
  assert.throws(
    () => new KmsKeyMetadata({ keyId: "k1", algorithm: "AES", size: null, state: "Enabled", owner: "u" }),
    /size/
  );
  assert.throws(
    () => new KmsKeyMetadata({ keyId: "k1", algorithm: "AES", size: 256, state: "", owner: "u" }),
    /state/
  );
  assert.throws(
    () => new KmsKeyMetadata({ keyId: "k1", algorithm: "AES", size: 256, state: "Enabled", owner: "" }),
    /owner/
  );
});

test("KmsKeyMetadata - Invariant: Never extract protected private key material", () => {
  const forbiddenKeys = [
    "privateKey",
    "private_key",
    "d",
    "p",
    "q",
    "rawKey",
    "secretBytes",
    "seed",
    "masterKey",
    "keyMaterial",
  ];

  for (const field of forbiddenKeys) {
    const badMetadata = {
      id: "key-1",
      [field]: "MIICXAIBAAKCAQEA0Yp...",
    };

    assert.throws(
      () =>
        new KmsKeyMetadata({
          keyId: "key-1",
          algorithm: "RSA-2048",
          size: 2048,
          state: "Enabled",
          owner: "secops",
          rawMetadata: badMetadata,
        }),
      ProtectedKeyMaterialError
    );
  }
});

test("KmsKeyMetadata - Deep nested private key detection", () => {
  const nested = {
    level1: {
      level2: {
        private_key: "secret-bytes",
      },
    },
  };

  assert.throws(
    () => KmsKeyMetadata.assertNoPrivateKeyMaterial(nested),
    /CRITICAL SECURITY VIOLATION: Private key material detected/
  );
});

test("KmsKeyMetadata - Sanitization and CBOM conversion", () => {
  const sanitized = KmsKeyMetadata.sanitizeMetadata({
    keyName: "test-key",
    privateKey: "should-be-redacted",
    publicExponent: 65537,
  });

  assert.equal(sanitized.keyName, "test-key");
  assert.equal(sanitized.publicExponent, 65537);
  assert.equal(sanitized.privateKey, "[REDACTED_PROTECTED_MATERIAL]");

  const meta = new KmsKeyMetadata({
    keyId: "arn:aws:kms:us-east-1:111:key/cmk-1",
    algorithm: "RSA-4096",
    size: 4096,
    state: "Enabled",
    owner: "111",
    rotation: { enabled: true, periodDays: 365, version: "v1" },
    usage: { keyUsage: "SIGN_VERIFY", operations: ["sign", "verify"], isExportable: false },
    provider: "aws_kms",
  });

  const cbomComp = meta.toCbomComponent();
  assert.equal(cbomComp.type, "cryptographic-asset");
  assert.equal(cbomComp["bom-ref"], "cbom:aws_kms:arn:aws:kms:us-east-1:111:key/cmk-1");
  assert.equal(cbomComp.cryptoProperties.algorithm, "RSA-4096");
  assert.equal(cbomComp.cryptoProperties.keyLength, 4096);
  assert.equal(cbomComp.cryptoProperties.rotationEnabled, true);
  assert.equal(cbomComp.cryptoProperties.isExportable, false);
});

test("BaseKmsConnector - Enforces least-privilege read-only mode by default", () => {
  class DummyConnector extends BaseKmsConnector {
    getLeastPrivilegeRoleDefinition() {
      return {};
    }
    listKeys() {
      return [];
    }
    describeKey() {}
  }

  const conn = new DummyConnector({ name: "dummy", provider: "aws_kms" });
  assert.equal(conn.readOnly, true);

  assert.throws(
    () => new DummyConnector({ name: "dummy", provider: "aws_kms", readOnly: false }),
    /must be initialized in read-only mode/
  );
});

test("AwsKmsConnector - Read-only IAM definition and key discovery", async () => {
  const mockDetails = {
    "arn:aws:kms:us-east-1:1111:key/key-uuid-1": {
      KeyMetadata: {
        Arn: "arn:aws:kms:us-east-1:1111:key/key-uuid-1",
        KeyId: "key-uuid-1",
        KeySpec: "SYMMETRIC_DEFAULT",
        KeyState: "Enabled",
        KeyUsage: "ENCRYPT_DECRYPT",
        AWSAccountId: "1111",
        Origin: "AWS_KMS",
        Description: "Main S3 CMK",
      },
      RotationStatus: {
        KeyRotationEnabled: true,
      },
      Tags: [{ TagKey: "Owner", TagValue: "cloud-sec" }],
    },
  };

  const connector = new AwsKmsConnector({
    name: "aws-prod",
    config: {
      region: "us-east-1",
      mockKeys: ["arn:aws:kms:us-east-1:1111:key/key-uuid-1"],
      mockKeyDetails: mockDetails,
    },
  });

  const role = connector.getLeastPrivilegeRoleDefinition();
  assert.ok(role.statement[0].Action.includes("kms:DescribeKey"));
  assert.ok(role.statement[1].Action.includes("kms:Decrypt"));

  const val = connector.validateLeastPrivilege(["kms:DescribeKey", "kms:Decrypt"]);
  assert.equal(val.valid, false);
  assert.ok(val.violations.some((v) => v.includes("kms:Decrypt")));

  const keys = await connector.discoverAll();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].algorithm, "AES-256-GCM");
  assert.equal(keys[0].size, 256);
  assert.equal(keys[0].owner, "cloud-sec");
  assert.equal(keys[0].rotation.enabled, true);
  assert.equal(keys[0].usage.isExportable, false);
});

test("GcpKmsConnector - roles/cloudkms.viewer and CryptoKey discovery", async () => {
  const mockDetails = {
    "projects/gcp-proj/locations/global/keyRings/ring1/cryptoKeys/key1": {
      name: "projects/gcp-proj/locations/global/keyRings/ring1/cryptoKeys/key1",
      purpose: "ENCRYPT_DECRYPT",
      rotationPeriod: "2592000s", // 30 days
      primary: {
        name: "projects/gcp-proj/locations/global/keyRings/ring1/cryptoKeys/key1/cryptoKeyVersions/1",
        algorithm: "GOOGLE_SYMMETRIC_ENCRYPTION",
        state: "ENABLED",
        protectionLevel: "HSM",
      },
      labels: { owner: "platform-team" },
    },
  };

  const connector = new GcpKmsConnector({
    name: "gcp-prod",
    config: {
      projectId: "gcp-proj",
      mockKeys: ["projects/gcp-proj/locations/global/keyRings/ring1/cryptoKeys/key1"],
      mockKeyDetails: mockDetails,
    },
  });

  const role = connector.getLeastPrivilegeRoleDefinition();
  assert.equal(role.role, "roles/cloudkms.viewer");

  const keys = await connector.discoverAll();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].algorithm, "AES-256-GCM");
  assert.equal(keys[0].rotation.periodDays, 30);
  assert.equal(keys[0].owner, "platform-team");
  assert.equal(keys[0].usage.origin, "HSM");
});

test("AzureKeyVaultConnector - Key Vault Crypto Viewer and key bundle discovery", async () => {
  const mockDetails = {
    "app-auth-rsa": {
      key: {
        kid: "https://vault.vault.azure.net/keys/app-auth-rsa/v1",
        kty: "RSA",
        key_size: 2048,
        key_ops: ["encrypt", "decrypt"],
      },
      properties: {
        name: "app-auth-rsa",
        id: "https://vault.vault.azure.net/keys/app-auth-rsa/v1",
        attributes: { enabled: true, exportable: false },
        tags: { owner: "identity-ops" },
      },
      rotationPolicy: {
        lifetimeActions: [{ timeAfterCreate: "P90D" }],
      },
    },
  };

  const connector = new AzureKeyVaultConnector({
    name: "azure-prod",
    config: {
      vaultUrl: "https://vault.vault.azure.net",
      mockKeys: ["app-auth-rsa"],
      mockKeyDetails: mockDetails,
    },
  });

  const keys = await connector.discoverAll();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].algorithm, "RSA-2048");
  assert.equal(keys[0].size, 2048);
  assert.equal(keys[0].rotation.periodDays, 90);
  assert.equal(keys[0].owner, "identity-ops");
  assert.equal(keys[0].usage.isExportable, false);
});

test("VaultTransitConnector - Transit engine key discovery", async () => {
  const mockDetails = {
    "database-encryption": {
      type: "aes256-gcm96",
      latest_version: 2,
      auto_rotate_period: 5184000, // 60 days
      deletion_allowed: false,
      supports_encryption: true,
      exportable: false,
    },
  };

  const connector = new VaultTransitConnector({
    name: "vault-transit-prod",
    config: {
      endpoint: "https://vault.internal:8200",
      mockKeys: ["database-encryption"],
      mockKeyDetails: mockDetails,
    },
  });

  const keys = await connector.discoverAll();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].algorithm, "AES-256-GCM");
  assert.equal(keys[0].rotation.periodDays, 60);
  assert.equal(keys[0].state, "Protected");
  assert.equal(keys[0].usage.isExportable, false);
});

test("Pkcs11HsmConnector - CKA_VALUE extraction prohibited and token object discovery", async () => {
  const mockDetails = {
    "root-rsa-key": {
      CKA_LABEL: "Root-Signing-Key",
      CKA_ID: "root01",
      CKA_KEY_TYPE: "CKK_RSA",
      CKA_MODULUS_BITS: 4096,
      CKA_EXTRACTABLE: false,
      CKA_NEVER_EXTRACTABLE: true,
      CKA_SIGN: true,
      CKA_VERIFY: true,
      CKA_TOKEN: true,
    },
  };

  const connector = new Pkcs11HsmConnector({
    name: "hsm-slot-0",
    config: {
      slotId: 0,
      tokenLabel: "Enterprise-Root-CA",
      mockKeys: ["root-rsa-key"],
      mockKeyDetails: mockDetails,
    },
  });

  const role = connector.getLeastPrivilegeRoleDefinition();
  assert.ok(role.forbiddenAttributes.includes("CKA_VALUE"));

  const val = connector.validateLeastPrivilege(["CKA_LABEL", "CKA_VALUE"]);
  assert.equal(val.valid, false);
  assert.ok(val.violations.some((v) => v.includes("CKA_VALUE")));

  const keys = await connector.discoverAll();
  assert.equal(keys.length, 1);
  assert.equal(keys[0].algorithm, "RSA-4096");
  assert.equal(keys[0].size, 4096);
  assert.equal(keys[0].owner, "Enterprise-Root-CA");
  assert.equal(keys[0].usage.isExportable, false);

  // Asserting extraction attempt on poisoned HSM details
  const poisonedConnector = new Pkcs11HsmConnector({
    name: "poisoned-hsm",
    config: {
      mockKeys: ["bad-key"],
      mockKeyDetails: {
        "bad-key": {
          CKA_LABEL: "Insecure",
          CKA_VALUE: "RAW_PRIVATE_EXPONENT_BYTES",
        },
      },
    },
  });

  await assert.rejects(
    () => poisonedConnector.describeKey("bad-key"),
    ProtectedKeyMaterialError
  );
});

test("KmsDiscoveryService - Multi-provider discovery, summary metrics, and CBOM export", async () => {
  const service = new KmsDiscoveryService();

  service.registerConnector(
    new AwsKmsConnector({
      name: "aws-test",
      config: {
        mockKeys: ["k1"],
        mockKeyDetails: {
          k1: {
            KeyMetadata: {
              Arn: "arn:aws:kms:us-east-1:11:key/k1",
              KeySpec: "RSA_2048",
              KeyState: "Enabled",
              AWSAccountId: "11",
            },
            RotationStatus: { KeyRotationEnabled: false },
          },
        },
      },
    })
  );

  service.registerConnector(
    new VaultTransitConnector({
      name: "vault-test",
      config: {
        mockKeys: ["k2"],
        mockKeyDetails: {
          k2: {
            type: "aes256-gcm96",
            auto_rotate_period: 2592000,
          },
        },
      },
    })
  );

  assert.equal(service.listConnectors().length, 2);

  const discovery = await service.discoverAll();
  assert.equal(discovery.totalCount, 2);
  assert.equal(discovery.errors.length, 0);

  const summary = service.getSummary(discovery.keys);
  assert.equal(summary.totalKeys, 2);
  assert.equal(summary.byProvider["aws_kms"], 1);
  assert.equal(summary.byProvider["hashicorp_vault"], 1);
  assert.equal(summary.metrics.unrotatedCount, 1);

  const cbom = service.toCbom(discovery.keys);
  assert.equal(cbom.bomFormat, "CycloneDX");
  assert.equal(cbom.specVersion, "1.6");
  assert.equal(cbom.components.length, 2);
  assert.equal(cbom.components[0].type, "cryptographic-asset");
});
