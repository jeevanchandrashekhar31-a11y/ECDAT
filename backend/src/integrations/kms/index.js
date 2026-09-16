/**
 * KMS & HSM Integrations Barrel Export — Phase 14.3
 */

const { KmsKeyMetadata, ProtectedKeyMaterialError, FORBIDDEN_PRIVATE_KEY_FIELDS } = require("./kms_metadata");
const { BaseKmsConnector } = require("./base_kms_connector");
const { AwsKmsConnector, AWS_READ_ONLY_ACTIONS, AWS_DISALLOWED_ACTIONS } = require("./aws_kms_connector");
const { GcpKmsConnector, GCP_READ_ONLY_PERMISSIONS, GCP_DISALLOWED_PERMISSIONS } = require("./gcp_kms_connector");
const { AzureKeyVaultConnector, AZURE_READ_ONLY_ACTIONS, AZURE_DISALLOWED_ACTIONS } = require("./azure_keyvault_connector");
const { VaultTransitConnector, VAULT_ALLOWED_CAPABILITIES, VAULT_DISALLOWED_CAPABILITIES } = require("./vault_transit_connector");
const { Pkcs11HsmConnector, CKA_ALLOWED_ATTRIBUTES, CKA_FORBIDDEN_ATTRIBUTES } = require("./pkcs11_hsm_connector");
const { KmsDiscoveryService, defaultKmsDiscoveryService } = require("./kms_discovery_service");

module.exports = {
  // Models & Errors
  KmsKeyMetadata,
  ProtectedKeyMaterialError,
  FORBIDDEN_PRIVATE_KEY_FIELDS,

  // Base
  BaseKmsConnector,

  // Connectors
  AwsKmsConnector,
  AWS_READ_ONLY_ACTIONS,
  AWS_DISALLOWED_ACTIONS,

  GcpKmsConnector,
  GCP_READ_ONLY_PERMISSIONS,
  GCP_DISALLOWED_PERMISSIONS,

  AzureKeyVaultConnector,
  AZURE_READ_ONLY_ACTIONS,
  AZURE_DISALLOWED_ACTIONS,

  VaultTransitConnector,
  VAULT_ALLOWED_CAPABILITIES,
  VAULT_DISALLOWED_CAPABILITIES,

  Pkcs11HsmConnector,
  CKA_ALLOWED_ATTRIBUTES,
  CKA_FORBIDDEN_ATTRIBUTES,

  // Orchestrator
  KmsDiscoveryService,
  defaultKmsDiscoveryService,
};
