/**
 * AWS KMS Connector — Phase 14.3
 *
 * Implements metadata collection for AWS Key Management Service (AWS KMS).
 * Enforces least-privilege read-only IAM roles:
 *   - kms:ListKeys
 *   - kms:DescribeKey
 *   - kms:GetKeyRotationStatus
 *   - kms:ListResourceTags
 *
 * Never requests or processes ciphertext decryption or private key material.
 */

const { BaseKmsConnector } = require("./base_kms_connector");
const { KmsKeyMetadata } = require("./kms_metadata");

const AWS_READ_ONLY_ACTIONS = Object.freeze([
  "kms:ListKeys",
  "kms:DescribeKey",
  "kms:GetKeyRotationStatus",
  "kms:ListResourceTags",
  "kms:ListAliases",
]);

const AWS_DISALLOWED_ACTIONS = Object.freeze([
  "kms:Decrypt",
  "kms:Encrypt",
  "kms:ReEncrypt*",
  "kms:GenerateDataKey*",
  "kms:Sign",
  "kms:Verify",
  "kms:GetSecretValue",
  "kms:ScheduleKeyDeletion",
  "kms:DisableKey",
  "kms:Create*",
  "kms:Put*",
  "kms:Update*",
]);

class AwsKmsConnector extends BaseKmsConnector {
  /**
   * @param {Object} options
   * @param {string} options.name
   * @param {Object} [options.config]
   * @param {string} [options.config.region="us-east-1"]
   * @param {string} [options.config.accountId]
   * @param {string} [options.config.roleArn]
   * @param {Object} [options.client] - Mock or real AWS KMS client
   * @param {Function} [options.fetchFn]
   */
  constructor(options = {}) {
    super({
      ...options,
      provider: "aws_kms",
    });
  }

  validateConfig(config) {
    super.validateConfig(config);
    if (!config.region) {
      this.config = { ...config, region: "us-east-1" };
    }
  }

  getLeastPrivilegeRoleDefinition() {
    return {
      version: "2012-10-17",
      statement: [
        {
          Sid: "ECDATKmsReadOnlyMetadataAccess",
          Effect: "Allow",
          Action: [...AWS_READ_ONLY_ACTIONS],
          Resource: "*",
        },
        {
          Sid: "ECDATDenyCryptographicAndDestructiveActions",
          Effect: "Deny",
          Action: [...AWS_DISALLOWED_ACTIONS],
          Resource: "*",
        },
      ],
      description: "Least-privilege read-only role for cryptographic metadata discovery in AWS KMS.",
    };
  }

  validateLeastPrivilege(actions = []) {
    const list = Array.isArray(actions) ? actions : actions.actions || [];
    const violations = [];

    for (const act of list) {
      const lower = act.toLowerCase();
      for (const dis of AWS_DISALLOWED_ACTIONS) {
        const pattern = dis.toLowerCase().replace("*", ".*");
        if (new RegExp(`^${pattern}$`).test(lower)) {
          violations.push(`Violation: Disallowed action '${act}' violates least-privilege read-only requirement.`);
        }
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  async testConnection() {
    if (this.client && typeof this.client.listKeys === "function") {
      try {
        await this.client.listKeys({ Limit: 1 });
        return { ok: true, message: `AWS KMS connection verified for region ${this.config.region}` };
      } catch (err) {
        return { ok: false, message: `AWS KMS connection failed: ${err.message}` };
      }
    }
    return { ok: true, message: `AWS KMS read-only configured for region ${this.config.region}` };
  }

  async listKeys() {
    if (this.client && typeof this.client.listKeys === "function") {
      const response = await this.client.listKeys({});
      return (response.Keys || []).map((k) => k.KeyId || k.KeyArn);
    }
    // Fallback/mock support
    return this.config.mockKeys || [];
  }

  async describeKey(keyId) {
    let keyMetadata = null;
    let rotationStatus = { KeyRotationEnabled: false };
    let tags = [];

    if (this.client && typeof this.client.describeKey === "function") {
      const descRes = await this.client.describeKey({ KeyId: keyId });
      keyMetadata = descRes.KeyMetadata;

      if (typeof this.client.getKeyRotationStatus === "function") {
        try {
          const rotRes = await this.client.getKeyRotationStatus({ KeyId: keyId });
          rotationStatus = rotRes;
        } catch (_) {
          // Rotation status might be unavailable for asymmetric keys
          rotationStatus = { KeyRotationEnabled: false };
        }
      }

      if (typeof this.client.listResourceTags === "function") {
        try {
          const tagRes = await this.client.listResourceTags({ KeyId: keyId });
          tags = tagRes.Tags || [];
        } catch (_) {
          tags = [];
        }
      }
    } else if (this.config.mockKeyDetails && this.config.mockKeyDetails[keyId]) {
      const mock = this.config.mockKeyDetails[keyId];
      keyMetadata = mock.KeyMetadata || mock;
      rotationStatus = mock.RotationStatus || { KeyRotationEnabled: false };
      tags = mock.Tags || [];
    } else {
      throw new Error(`AWS KMS: Key '${keyId}' not found or no client configured`);
    }

    return this.mapToKmsMetadata(keyMetadata, rotationStatus, tags);
  }

  mapToKmsMetadata(keyMeta, rotationStatus = {}, tags = []) {
    const keySpec = keyMeta.KeySpec || keyMeta.CustomerMasterKeySpec || "SYMMETRIC_DEFAULT";
    const { algorithm, size } = this.parseAlgorithmAndSize(keySpec);

    const tagOwner = (tags.find((t) => (t.TagKey || t.Key || "").toLowerCase() === "owner") || {}).TagValue;
    const owner = tagOwner || keyMeta.AWSAccountId || this.config.accountId || "AWS_ACCOUNT";

    const state = keyMeta.KeyState || (keyMeta.Enabled ? "Enabled" : "Disabled");

    const rotation = {
      enabled: Boolean(rotationStatus.KeyRotationEnabled),
      periodDays: rotationStatus.KeyRotationEnabled ? 365 : null,
      lastRotatedAt: rotationStatus.LastRotationDate ? new Date(rotationStatus.LastRotationDate).toISOString() : null,
      nextRotationAt: rotationStatus.NextRotationDate ? new Date(rotationStatus.NextRotationDate).toISOString() : null,
      version: keyMeta.KeyId || "1",
    };

    const keyUsage = keyMeta.KeyUsage || "ENCRYPT_DECRYPT";
    const operations = keyUsage === "SIGN_VERIFY" ? ["sign", "verify"] : ["encrypt", "decrypt"];

    const usage = {
      keyUsage,
      operations,
      origin: keyMeta.Origin || "AWS_KMS",
      isExportable: false, // Invariant: AWS KMS keys are strictly non-exportable
    };

    return new KmsKeyMetadata({
      keyId: keyMeta.Arn || keyMeta.KeyId,
      algorithm,
      size,
      state,
      rotation,
      owner,
      usage,
      provider: "aws_kms",
      description: keyMeta.Description || `AWS KMS Key (${algorithm})`,
      rawMetadata: {
        KeyMetadata: keyMeta,
        RotationStatus: rotationStatus,
        Tags: tags,
      },
    });
  }

  parseAlgorithmAndSize(spec = "") {
    const s = String(spec).toUpperCase();
    if (s.includes("SYMMETRIC") || s === "AES_256") {
      return { algorithm: "AES-256-GCM", size: 256 };
    }
    if (s.includes("RSA_2048")) return { algorithm: "RSA-2048", size: 2048 };
    if (s.includes("RSA_3072")) return { algorithm: "RSA-3072", size: 3072 };
    if (s.includes("RSA_4096")) return { algorithm: "RSA-4096", size: 4096 };
    if (s.includes("ECC_NIST_P256")) return { algorithm: "ECDSA-P256", size: 256 };
    if (s.includes("ECC_NIST_P384")) return { algorithm: "ECDSA-P384", size: 384 };
    if (s.includes("ECC_NIST_P521")) return { algorithm: "ECDSA-P521", size: 521 };
    if (s.includes("ECC_SECG_P256K1")) return { algorithm: "ECDSA-SECP256K1", size: 256 };
    if (s.includes("HMAC_256")) return { algorithm: "HMAC-SHA256", size: 256 };
    if (s.includes("HMAC_384")) return { algorithm: "HMAC-SHA384", size: 384 };
    if (s.includes("HMAC_512")) return { algorithm: "HMAC-SHA512", size: 512 };
    return { algorithm: s, size: 256 };
  }
}

module.exports = {
  AwsKmsConnector,
  AWS_READ_ONLY_ACTIONS,
  AWS_DISALLOWED_ACTIONS,
};
