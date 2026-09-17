# ECDAT Data Protection & Classification Architecture (Phase 16.1)

## 1. Executive Summary & Security Objectives

ECDAT processes sensitive cryptographic discovery findings, infrastructure topology, software bills of materials (CBOM/SBOM), and external integration credentials. To minimize attack surfaces and prevent data leakage, Phase 16.1 implements enterprise-grade data protection governed by three fundamental security tenets:

1. **Zero-Secret-Storage Invariant**: Never store secret/key contents unless there is a documented, unavoidable requirement. Cryptographic private keys are strictly prohibited from persistence under any circumstance.
2. **Authenticated Encryption at Rest**: Sensitive data requiring persistence (such as integration credentials and MFA seeds) must be encrypted using authenticated symmetric encryption (AES-256-GCM) with random initialization vectors and key rotation support.
3. **Strict TLS for Data in Transit**: All communications—database connections, client API traffic, and external integration connectors—must traverse modern TLS (TLS 1.2+ / TLS 1.3) with HSTS enforcement.

---

## 2. ECDAT Data Classification Taxonomy

All data handled by ECDAT is categorized into four distinct classification tiers:

| Tier | Sensitivity Level | Description | At-Rest Encryption | In-Transit Encryption | Log Masking | API Response Masking | Plaintext Storage Allowed? |
|---|---|---|---|---|---|---|---|
| **RESTRICTED** | Level 4 | Credentials, integration tokens, and user secrets. Unauthorized exposure causes catastrophic security harm. | **REQUIRED (AES-256-GCM)** | **REQUIRED (TLS 1.2+)** | **YES (Masked / Redacted)** | **YES (Masked)** | **NO** |
| **CONFIDENTIAL** | Level 3 | Security findings, vulnerability locations, line numbers, scan metadata, and asset ownership. | **REQUIRED / Encrypted Volume** | **REQUIRED (TLS 1.2+)** | Selective / Sanitized | Scoped to Tenant/Role | **YES (Tenant Isolated)** |
| **INTERNAL** | Level 2 | Public certificates, cryptographic fingerprints, policy profiles, and operational metrics. | **RECOMMENDED** | **REQUIRED (TLS 1.2+)** | NO | NO | **YES** |
| **PUBLIC** | Level 1 | Cryptographic standards, PQC migration playbooks, and system health status. | OPTIONAL | RECOMMENDED | NO | NO | **YES** |

---

## 3. Protection Matrix across the Seven Key Domains

ECDAT systematically enforces tailored protections across seven core data domains:

### 3.1 Credentials
- **Scope**: User password hashes, Argon2/bcrypt salts, MFA TOTP seeds, backup recovery codes, API authorization tokens, JWT signing keys.
- **Protection**:
  - Encrypted at rest with AES-256-GCM.
  - Salted and hashed using strong key derivation functions.
  - Automatically masked in application logging (`***REDACTED***`).
  - Screened by `excessiveDataExposureFilter` middleware to prevent leakage in response payloads.

### 3.2 Integration Tokens
- **Scope**: Outbound KMS connector credentials (AWS KMS, GCP KMS, Azure KeyVault, HashiCorp Vault), Ticketing tokens (Jira PAT, GitHub PAT, GitLab Token, ServiceNow credentials), Webhook HMAC signing secrets.
- **Protection**:
  - Only stored under the documented `INTEGRATION_CREDENTIAL_STORAGE` exception.
  - Field-level encryption using AES-256-GCM with context-bound Additional Authenticated Data (AAD).
  - Outbound calls strictly enforced over HTTPS.
  - Zero token exposure in API responses.

### 3.3 Scan Metadata
- **Scope**: Target URLs, internal IP addresses, repository Git endpoints, branch names, commit hashes, target infrastructure topology, raw CBOM JSON evidence.
- **Protection**:
  - Scoped to authenticated tenant and project identifiers (`tenant_id`, `project_id`).
  - Access controlled via Role-Based Access Control (RBAC) and Object-Level Authorization (BOLA guards).
  - Raw evidence scanned for embedded private keys prior to ingestion.

### 3.4 Asset Ownership
- **Scope**: Asset owner IDs, user assignments, business unit metadata, system tags, business criticality, and data sensitivity classifications.
- **Protection**:
  - Stored with tenant isolation constraints.
  - Enforces Broken Object Property Level Authorization (BOPLA) protection: non-admins cannot mutate asset ownership or tenancy bindings.

### 3.5 Security Findings
- **Scope**: Discovered algorithms, key sizes, source code file paths, AST line numbers, evidence contexts, CVSS/vulnerabilities, Mosca quantum risk assessments (`mosca_x_years`, `mosca_y_years`, `mosca_z_years`, `mosca_status`).
- **Protection**:
  - Redacted of proprietary code or secret leakage before presentation.
  - Tenant-isolated persistence in database and CBOM annotations.
  - Strict pagination and nesting limits to prevent resource exhaustion.

### 3.6 Certificates
- **Scope**: X.509 public certificates, serial numbers, issuer DN, subject DN, validity dates, Subject Alternative Names (SAN), public key algorithm and size.
- **Protection**:
  - Contains **public cryptographic metadata only**.
  - Strict runtime guard `assertNoPrivateKey()` rejects any certificate object containing private key blocks.
  - Integrity verified against tampering.

### 3.7 Fingerprints
- **Scope**: SHA-256 public certificate fingerprints, SHA-1 legacy fingerprints, SubjectPublicKeyInfo (SPKI) fingerprints, cryptographic library binary hashes.
- **Protection**:
  - Cryptographic digests used for deduplication, anomaly detection, and fast index lookup.
  - Read-only integrity.

---

## 4. Zero-Secret-Storage Invariant & Documented Exceptions

### The Rule
> *"Never store secret/key contents unless there is a documented, unavoidable requirement."*

### Strict Invariant for Cryptographic Private Keys
**Raw private cryptographic keys (RSA, ECC, Ed25519, OpenSSH, PGP) have ZERO storage exceptions.** ECDAT is a cryptographic discovery and posture management tool; its role is to discover, inventory, and assess keys—**never to ingest, persist, or escrow private keys**.

If private keys are detected during scanner parsing or CBOM ingestion, they are immediately sanitized using `scrubSecrets()` or rejected via `assertStorageAllowed()`.

### Approved Documented Exceptions Registry
For operational scenarios where secret credentials are unavoidable (e.g. authenticating to external services on the customer's behalf), ECDAT maintains a strict formal registry:

```json
[
  {
    "id": "INTEGRATION_CREDENTIAL_STORAGE",
    "title": "Outbound 3rd-Party Integration Credentials",
    "rationale": "ECDAT must authenticate to customer-managed external systems (Cloud KMS, Vault Transit, Jira, ServiceNow, GitHub, GitLab, Webhooks) to discover key metadata and synchronize tickets.",
    "allowedEntities": ["integrations.kms", "integrations.ticketing", "integrations.webhook"],
    "allowedSecretTypes": ["api_token", "client_secret", "access_key", "password", "hmac_signing_key"],
    "mandatoryControls": [
      "MUST be encrypted at rest using AES-256-GCM field-level encryption",
      "MUST use random 96-bit IV and 128-bit authentication tag",
      "MUST NEVER be logged or included in debug traces",
      "MUST be masked in API responses",
      "MUST support credential rotation with versioning"
    ],
    "approvedBy": "ECDAT Architecture Security Review Board"
  },
  {
    "id": "MFA_TOTP_SECRET_STORAGE",
    "title": "User Multi-Factor Authentication TOTP Seeds",
    "rationale": "ECDAT must verify RFC 6238 TOTP codes submitted by users during authentication against the shared base32 seed.",
    "allowedEntities": ["identity.users", "identity.mfa"],
    "allowedSecretTypes": ["totp_seed", "recovery_code_hash"],
    "mandatoryControls": [
      "MUST be encrypted at rest using AES-256-GCM",
      "MUST NOT be returned in API responses after initial user enrollment QR display",
      "MUST be bound to tenant and user identity"
    ],
    "approvedBy": "ECDAT Identity & Security Team"
  },
  {
    "id": "SESSION_SIGNING_KEY_STORAGE",
    "title": "JWT Token Signing Keys in Secret Manager",
    "rationale": "ECDAT TokenService requires active and grace-period JWT signing keys to sign and verify user session tokens.",
    "allowedEntities": ["identity.secret_manager"],
    "allowedSecretTypes": ["hmac_sha256_key", "asymmetric_private_key"],
    "mandatoryControls": [
      "Managed by dedicated SecretManager with Kid indexing",
      "Automated rotation with dual-key overlapping grace periods",
      "Never exported through public API endpoints"
    ],
    "approvedBy": "ECDAT Cryptographic Architecture Review"
  }
]
```

---

## 5. Authenticated Encryption at Rest Architecture (AES-256-GCM)

ECDAT includes a dedicated authenticated encryption service [`backend/src/security/encryption_at_rest.js`](backend/src/security/encryption_at_rest.js):

### Cryptographic Parameters
- **Cipher**: AES-256-GCM (`aes-256-gcm`, NIST SP 800-38D).
- **Key Length**: 256 bits (32 bytes).
- **Initialization Vector (IV)**: 96 bits (12 bytes) cryptographically random, generated via `crypto.randomBytes(12)` per encryption.
- **Authentication Tag**: 128 bits (16 bytes) verifying ciphertext integrity and authenticity.
- **Encrypted Token Format**:
  ```text
  enc:v1:<kid>:<iv_base64>:<tag_base64>:<ciphertext_base64>
  ```

### Additional Authenticated Data (AAD) Context Binding
To prevent ciphertext transplantation attacks (e.g. copying an encrypted token from one tenant or record to another), the encryption engine supports AAD binding:
```javascript
const ciphertext = defaultEncryptionAtRest.encrypt(token, {
  aad: { tenantId: "tenant-alpha", resourceId: "conn-1" },
});
```
Attempting to decrypt with mismatched AAD triggers an immediate `ERR_AUTH_FAILED` exception.

### Key Versioning and Zero-Downtime Key Rotation
The keyring maintains key identifiers (`kid`). During key rotation:
1. `rotateKey(newKeyBytes, newKid)` promotes the new key to `active` status.
2. Older keys transition to `retired` status within the keyring to allow on-the-fly decryption of legacy records.
3. `reencrypt(oldCiphertext)` transparently upgrades ciphertexts to the latest active key without database disruption.

---

## 6. Data in Transit TLS Enforcement

All data in transit is protected using TLS:

### 6.1 PostgreSQL Database Connection TLS
- Configured via [`backend/src/security/transit_security.js`](backend/src/security/transit_security.js) and utilized by [`backend/knexfile.js`](backend/knexfile.js).
- In production (`NODE_ENV=production`), TLS is strictly mandatory:
  ```javascript
  DATABASE_SSL=true
  DATABASE_SSL_REJECT_UNAUTHORIZED=true
  DATABASE_SSL_CA_PATH=/path/to/enterprise-ca.pem
  ```
- Cleartext database connections in production throw `InsecureTransitError` and abort startup.

### 6.2 Inbound HTTP API HTTPS Enforcement
- Enforced via `tlsEnforcementMiddleware`:
  - Enforces `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload` (HSTS).
  - In production, insecure cleartext HTTP requests to mutation endpoints (`POST`, `PUT`, `DELETE`) are rejected with `426 Upgrade Required` (`ERR_TLS_REQUIRED`).
  - Browser navigation requests (`GET`) are automatically redirected to `https://` via `301 Permanent Redirect`.

### 6.3 Outbound Integration TLS
- Enforced via `validateOutboundTlsUrl`:
  - External endpoints for Cloud KMS (AWS, GCP, Azure, Vault) and Ticketing systems (Jira, GitHub, GitLab, ServiceNow, Webhooks) must use `https://`. Cleartext `http://` is blocked in production.

---

## 7. REST API Endpoints for Data Protection

ECDAT exposes endpoints under `/api/v1/security/` for policy verification and auditing:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/v1/security/data-classification` | Returns full data classification taxonomy, tiers, and domain policies |
| `POST` | `/api/v1/security/data-classification/classify` | Classifies a given entity and field name |
| `GET` | `/api/v1/security/data-classification/domain/:domain` | Returns policy details for a specific data domain |
| `GET` | `/api/v1/security/documented-secret-exceptions` | Lists all approved documented unavoidable requirements for secret storage |
| `POST` | `/api/v1/security/validate-secret-storage` | Verifies a data payload against the zero-secret-storage invariant |
| `POST` | `/api/v1/security/encrypt-at-rest` | Tests AES-256-GCM authenticated encryption |
| `POST` | `/api/v1/security/decrypt-at-rest` | Tests AES-256-GCM authenticated decryption |
| `GET` | `/api/v1/security/transit-status` | Returns TLS posture across DB, API, and outbound connectors |
