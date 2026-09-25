/**
 * ECDAT Data Classification & Protection Architecture — Phase 16.1
 *
 * Implements the enterprise data classification taxonomy and protection matrix:
 *
 * Classification Tiers:
 * - RESTRICTED (Level 4): Highest sensitivity. Immediate enterprise harm if exposed.
 *   - Credentials (passwords, salts, reset tokens, MFA TOTP seeds, session keys)
 *   - Integration tokens (KMS secrets, ticketing OAuth/PAT tokens, cloud IAM keys, webhook secrets)
 *   - Secret/key material (Strict zero-storage invariant; strictly forbidden unless documented unavoidable exception)
 *
 * - CONFIDENTIAL (Level 3): Business-sensitive and vulnerability data.
 *   - Security findings (cryptographic vulnerabilities, weakness locations, line numbers, Mosca assessments)
 *   - Scan metadata (target URLs, internal IP addresses, repository URLs, branch names, commit hashes)
 *   - Asset ownership (tenant IDs, project IDs, owner IDs, business unit, business criticality)
 *
 * - INTERNAL (Level 2): Organization-internal operational and inventory data.
 *   - Certificates (X.509 public certificates, serial numbers, issuer DN, subject DN, validity dates)
 *   - Fingerprints (SHA-256/SHA-1 cert fingerprints, SPKI public key fingerprints, library hashes)
 *   - Policy profiles & ruleset metadata
 *   - Diagnostic error messages & execution logs
 *
 * - PUBLIC (Level 1): Freely shareable open standards and documentation.
 *   - PQC migration guidelines, NIST/RFC standards reference data, health ping status
 */

const CLASSIFICATION_TIERS = Object.freeze({
  RESTRICTED: "RESTRICTED",
  CONFIDENTIAL: "CONFIDENTIAL",
  INTERNAL: "INTERNAL",
  PUBLIC: "PUBLIC",
});

const TIER_METADATA = Object.freeze({
  [CLASSIFICATION_TIERS.RESTRICTED]: {
    level: 4,
    description: "Highest sensitivity. Unauthorized disclosure causes catastrophic operational or regulatory harm.",
    atRestEncryption: "REQUIRED",
    inTransitEncryption: "REQUIRED_TLS_1_2_OR_HIGHER",
    maskInLogs: true,
    maskInApiResponses: true,
    allowPlaintextStorage: false,
    zeroSecretStorageApplies: true,
  },
  [CLASSIFICATION_TIERS.CONFIDENTIAL]: {
    level: 3,
    description: "Sensitive technical and vulnerability data. Disclosure reveals system attack surface.",
    atRestEncryption: "REQUIRED_OR_ENCRYPTED_VOLUME",
    inTransitEncryption: "REQUIRED_TLS_1_2_OR_HIGHER",
    maskInLogs: false,
    maskInApiResponses: false,
    allowPlaintextStorage: true,
    zeroSecretStorageApplies: true,
  },
  [CLASSIFICATION_TIERS.INTERNAL]: {
    level: 2,
    description: "Organization-internal cryptographic metadata and inventory without secret contents.",
    atRestEncryption: "RECOMMENDED",
    inTransitEncryption: "REQUIRED_TLS_1_2_OR_HIGHER",
    maskInLogs: false,
    maskInApiResponses: false,
    allowPlaintextStorage: true,
    zeroSecretStorageApplies: true,
  },
  [CLASSIFICATION_TIERS.PUBLIC]: {
    level: 1,
    description: "Public cryptographic standards, migration guidance, and non-sensitive status pings.",
    atRestEncryption: "OPTIONAL",
    inTransitEncryption: "RECOMMENDED_TLS",
    maskInLogs: false,
    maskInApiResponses: false,
    allowPlaintextStorage: true,
    zeroSecretStorageApplies: false,
  },
});

/**
 * Registry of data elements across ECDAT entities.
 */
const DATA_CATALOG = Object.freeze({
  // 1. Credentials
  "identity.password_hash": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "credentials",
    description: "Argon2/bcrypt hashed user passwords and salts",
    atRestEncryption: "REQUIRED",
    storageAllowed: true,
  },
  "identity.mfa_totp_secret": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "credentials",
    description: "Base32 TOTP secret seed for multi-factor authentication",
    atRestEncryption: "REQUIRED",
    storageAllowed: true,
    documentedException: "MFA_TOTP_SECRET_STORAGE",
  },
  "identity.mfa_recovery_codes": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "credentials",
    description: "One-time backup recovery codes",
    atRestEncryption: "REQUIRED",
    storageAllowed: true,
    documentedException: "MFA_RECOVERY_CODES_STORAGE",
  },
  "identity.api_key": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "credentials",
    description: "API authorization secret keys and hashes",
    atRestEncryption: "REQUIRED",
    storageAllowed: true,
  },
  "identity.jwt_signing_secret": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "credentials",
    description: "Symmetric HMAC secret or asymmetric private signing key for JWTs",
    atRestEncryption: "REQUIRED",
    storageAllowed: true,
    documentedException: "SESSION_SIGNING_KEY_STORAGE",
  },

  // 2. Integration Tokens
  "integrations.kms_credentials": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "integration_tokens",
    description: "AWS/GCP/Azure/Vault KMS client secrets, access keys, or tokens",
    atRestEncryption: "REQUIRED",
    storageAllowed: true,
    documentedException: "INTEGRATION_CREDENTIAL_STORAGE",
  },
  "integrations.ticketing_token": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "integration_tokens",
    description: "Jira Personal Access Token, GitHub PAT, GitLab Token, ServiceNow password",
    atRestEncryption: "REQUIRED",
    storageAllowed: true,
    documentedException: "INTEGRATION_CREDENTIAL_STORAGE",
  },
  "integrations.webhook_secret": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "integration_tokens",
    description: "Shared HMAC secret for signing outbound webhook payloads",
    atRestEncryption: "REQUIRED",
    storageAllowed: true,
    documentedException: "INTEGRATION_CREDENTIAL_STORAGE",
  },

  // 3. Cryptographic Secret / Key Contents (ZERO STORAGE POLICY)
  "crypto.private_key": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "secret_key_material",
    description: "Raw private key PEM, RSA/ECC exponents, private seed bytes",
    atRestEncryption: "N_A",
    storageAllowed: false, // STRICT ZERO STORAGE: FORBIDDEN
    rule: "Never store secret/key contents unless there is a documented, unavoidable requirement.",
  },
  "crypto.symmetric_key": {
    tier: CLASSIFICATION_TIERS.RESTRICTED,
    domain: "secret_key_material",
    description: "Raw AES/ChaCha/3DES secret symmetric key bytes",
    atRestEncryption: "N_A",
    storageAllowed: false, // STRICT ZERO STORAGE: FORBIDDEN
    rule: "Never store secret/key contents unless there is a documented, unavoidable requirement.",
  },

  // 4. Scan Metadata
  "scans.target_name": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "scan_metadata",
    description: "Target hostname, IP, file path, or repository URL",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "scans.scanner_type": {
    tier: CLASSIFICATION_TIERS.INTERNAL,
    domain: "scan_metadata",
    description: "Scanner plugin invoked (static, network, binary, combined)",
    atRestEncryption: "OPTIONAL",
    storageAllowed: true,
  },
  "scans.threat_horizon": {
    tier: CLASSIFICATION_TIERS.INTERNAL,
    domain: "scan_metadata",
    description: "Evaluation scenario (baseline, pqc_migration, regulated_bfsi)",
    atRestEncryption: "OPTIONAL",
    storageAllowed: true,
  },
  "cboms.raw_json": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "scan_metadata",
    description: "Raw uploaded or generated CycloneDX CBOM evidence",
    atRestEncryption: "REQUIRED_OR_ENCRYPTED_VOLUME",
    storageAllowed: true,
    zeroSecretStorageApplies: true,
  },

  // 5. Asset Ownership
  "assets.owner_id": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "asset_ownership",
    description: "User or team ID possessing ownership of cryptographic asset",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "assets.tenant_id": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "asset_ownership",
    description: "Enterprise tenant partition identifier",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "assets.project_id": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "asset_ownership",
    description: "Organizational project identifier",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "assets.business_criticality": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "asset_ownership",
    description: "Asset business tier (critical, high, medium, low)",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "assets.data_sensitivity": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "asset_ownership",
    description: "Data sensitivity classification of data handled by asset",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },

  // 6. Security Findings
  "findings.algorithm": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "security_findings",
    description: "Cryptographic algorithm name (MD5, RSA, Kyber, Dilithium)",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "findings.key_size": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "security_findings",
    description: "Key length in bits (e.g. 1024, 2048, 4096)",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "findings.location": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "security_findings",
    description: "Source code file path, container layer, or network URI",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "findings.evidence_context": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "security_findings",
    description: "Code snippet or network handshake evidence context",
    atRestEncryption: "REQUIRED_OR_ENCRYPTED_VOLUME",
    storageAllowed: true,
    zeroSecretStorageApplies: true,
  },
  "risk_assessments.severity": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "security_findings",
    description: "Calculated severity rating (Critical, High, Medium, Low, Info)",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "risk_assessments.mosca_status": {
    tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
    domain: "security_findings",
    description: "Mosca quantum risk evaluation (AT_RISK, WATCH, SAFE)",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },

  // 7. Certificates & Fingerprints
  "certificates.public_cert": {
    tier: CLASSIFICATION_TIERS.INTERNAL,
    domain: "certificates",
    description: "Public X.509 PEM certificate chain (contains public key only)",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "certificates.issuer_dn": {
    tier: CLASSIFICATION_TIERS.INTERNAL,
    domain: "certificates",
    description: "Distinguished name of issuing certificate authority",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "certificates.subject_dn": {
    tier: CLASSIFICATION_TIERS.INTERNAL,
    domain: "certificates",
    description: "Subject entity common name and organizational unit",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "certificates.fingerprint_sha256": {
    tier: CLASSIFICATION_TIERS.INTERNAL,
    domain: "fingerprints",
    description: "SHA-256 cryptographic digest of public certificate or key",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "certificates.fingerprint_sha1": {
    tier: CLASSIFICATION_TIERS.INTERNAL,
    domain: "fingerprints",
    description: "Legacy SHA-1 digest for backward lookup",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "components.spki_fingerprint": {
    tier: CLASSIFICATION_TIERS.INTERNAL,
    domain: "fingerprints",
    description: "SubjectPublicKeyInfo cryptographic fingerprint",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },
  "components.library_hash": {
    tier: CLASSIFICATION_TIERS.INTERNAL,
    domain: "fingerprints",
    description: "Binary or package hash of cryptographic library (e.g. OpenSSL)",
    atRestEncryption: "RECOMMENDED",
    storageAllowed: true,
  },

  // 8. Public References & Standards
  "standards.fips_guidelines": {
    tier: CLASSIFICATION_TIERS.PUBLIC,
    domain: "cryptographic_standards",
    description: "NIST FIPS 203, 204, 205 post-quantum standard definitions",
    atRestEncryption: "OPTIONAL",
    storageAllowed: true,
  },
  "pqc.migration_playbook": {
    tier: CLASSIFICATION_TIERS.PUBLIC,
    domain: "pqc_guidelines",
    description: "Classical-to-hybrid and PQC migration recommendation guides",
    atRestEncryption: "OPTIONAL",
    storageAllowed: true,
  },
  "system.health": {
    tier: CLASSIFICATION_TIERS.PUBLIC,
    domain: "system_health",
    description: "Liveness and readiness ping response",
    atRestEncryption: "OPTIONAL",
    storageAllowed: true,
  },
});

/**
 * Classifies a specific field within an entity.
 *
 * @param {string} entityType - e.g. 'scans', 'assets', 'identity', 'integrations'
 * @param {string} fieldName - e.g. 'kms_credentials', 'owner_id', 'private_key'
 * @returns {object} Classification entry and tier metadata
 */
function classifyField(entityType, fieldName) {
  const key = `${entityType}.${fieldName}`;
  let entry = DATA_CATALOG[key];

  // If exact key is not found, attempt heuristic match based on field name
  if (!entry) {
    const normalized = fieldName.toLowerCase().replace(/[-_]/g, "");
    if (
      normalized.includes("password") ||
      normalized.includes("secret") ||
      normalized.includes("token") ||
      normalized.includes("apikey") ||
      normalized.includes("totp")
    ) {
      entry = {
        tier: CLASSIFICATION_TIERS.RESTRICTED,
        domain: normalized.includes("token") ? "integration_tokens" : "credentials",
        description: `Inferred sensitive field '${fieldName}'`,
        atRestEncryption: "REQUIRED",
        storageAllowed: true,
      };
    } else if (
      normalized.includes("privatekey") ||
      normalized.includes("rawkey") ||
      normalized.includes("secretbytes")
    ) {
      entry = {
        tier: CLASSIFICATION_TIERS.RESTRICTED,
        domain: "secret_key_material",
        description: `Prohibited private key material '${fieldName}'`,
        atRestEncryption: "N_A",
        storageAllowed: false,
        rule: "Never store secret/key contents unless there is a documented, unavoidable requirement.",
      };
    } else if (
      normalized.includes("finding") ||
      normalized.includes("severity") ||
      normalized.includes("vulnerability") ||
      normalized.includes("risk") ||
      normalized.includes("target") ||
      normalized.includes("evidence")
    ) {
      entry = {
        tier: CLASSIFICATION_TIERS.CONFIDENTIAL,
        domain: "security_findings",
        description: `Inferred security data '${fieldName}'`,
        atRestEncryption: "RECOMMENDED",
        storageAllowed: true,
      };
    } else if (
      normalized.includes("cert") ||
      normalized.includes("fingerprint") ||
      normalized.includes("hash")
    ) {
      entry = {
        tier: CLASSIFICATION_TIERS.INTERNAL,
        domain: "fingerprints",
        description: `Inferred cryptographic metadata '${fieldName}'`,
        atRestEncryption: "RECOMMENDED",
        storageAllowed: true,
      };
    } else {
      entry = {
        tier: CLASSIFICATION_TIERS.INTERNAL,
        domain: "operational_data",
        description: `Default internal field '${fieldName}'`,
        atRestEncryption: "RECOMMENDED",
        storageAllowed: true,
      };
    }
  }

  const meta = TIER_METADATA[entry.tier];
  return {
    key,
    entityType,
    fieldName,
    tier: entry.tier,
    domain: entry.domain,
    level: meta.level,
    description: entry.description,
    atRestEncryption: entry.atRestEncryption || meta.atRestEncryption,
    inTransitEncryption: meta.inTransitEncryption,
    maskInLogs: meta.maskInLogs,
    maskInApiResponses: meta.maskInApiResponses,
    storageAllowed: entry.storageAllowed,
    documentedException: entry.documentedException || null,
  };
}

/**
 * Gets classification and security rules for a high-level data domain.
 * Domains: 'credentials', 'integration_tokens', 'scan_metadata', 'asset_ownership',
 *          'security_findings', 'certificates', 'fingerprints', 'secret_key_material'
 *
 * @param {string} domainName
 * @returns {object} Protection summary
 */
function getDomainProtectionPolicy(domainName) {
  const norm = domainName.toLowerCase().replace(/[-_]/g, "_");
  const domainEntries = Object.entries(DATA_CATALOG).filter(
    ([_, v]) => v.domain === norm
  );

  let tier = CLASSIFICATION_TIERS.INTERNAL;
  if (norm === "credentials" || norm === "integration_tokens" || norm === "secret_key_material") {
    tier = CLASSIFICATION_TIERS.RESTRICTED;
  } else if (norm === "scan_metadata" || norm === "asset_ownership" || norm === "security_findings") {
    tier = CLASSIFICATION_TIERS.CONFIDENTIAL;
  } else if (norm === "certificates" || norm === "fingerprints") {
    tier = CLASSIFICATION_TIERS.INTERNAL;
  }

  const meta = TIER_METADATA[tier];

  return {
    domain: norm,
    tier,
    level: meta.level,
    atRestEncryption: meta.atRestEncryption,
    inTransitEncryption: meta.inTransitEncryption,
    maskInLogs: meta.maskInLogs,
    maskInApiResponses: meta.maskInApiResponses,
    zeroSecretStorageRule:
      norm === "secret_key_material"
        ? "STRICT: Zero secret/key contents may be stored unless a documented, unavoidable requirement exists."
        : "Standard protection rules apply.",
    registeredFieldCount: domainEntries.length,
    registeredFields: domainEntries.map(([k, v]) => ({ key: k, description: v.description })),
  };
}

/**
 * Returns the entire taxonomy and matrix of all classified domains.
 */
function getClassificationTaxonomy() {
  return {
    tiers: TIER_METADATA,
    domains: [
      "credentials",
      "integration_tokens",
      "scan_metadata",
      "asset_ownership",
      "security_findings",
      "certificates",
      "fingerprints",
      "secret_key_material",
    ].map((d) => getDomainProtectionPolicy(d)),
    catalogCount: Object.keys(DATA_CATALOG).length,
  };
}

module.exports = {
  CLASSIFICATION_TIERS,
  TIER_METADATA,
  DATA_CATALOG,
  classifyField,
  getDomainProtectionPolicy,
  getClassificationTaxonomy,
};
