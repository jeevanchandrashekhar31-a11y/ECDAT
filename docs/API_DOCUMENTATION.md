# ECDAT REST API Reference & Public Specification (Phase 25.2)

## 1. Global API Standards & Conventions

### 1.1 Base URLs
- **Primary API v1**: `https://<host>:<port>/api/v1`
- **Root-level System Endpoints**: `https://<host>:<port>/health`, `https://<host>:<port>/metrics`
- **Root-level Ingestion Endpoints**: `https://<host>:<port>/scan/*`, `https://<host>:<port>/cbom/*`, `https://<host>:<port>/sbom/*`

### 1.2 Authentication Methods
1. **API Key Authentication**:
   - Header: `X-API-Key: <api-key>` OR `Authorization: Bearer <api-key>` OR `Authorization: ApiKey <api-key>`.
   - Used by CI/CD pipelines, automated scanners, CLI tools, and daemon agents.
2. **Session / Cookie Authentication**:
   - HTTP-Only, Secure, SameSite=Strict cookie: `ecdat_access_token`.
   - Used by the interactive Web Dashboard.
3. **CSRF Protection (State-Changing Operations via Cookie Auth)**:
   - Header: `X-CSRF-Token: <csrf-token>`.
   - Cookie: `ecdat_csrf_token`.
   - Required for all `POST`, `PUT`, `PATCH`, `DELETE` requests utilizing cookie authentication.

### 1.3 Role-Based Access Control (RBAC) & Roles
- `public`: Unauthenticated access permitted (health checks, login).
- `viewer`: Read-only visibility into findings, assets, inventory, and reports.
- `analyst`: Ability to upload CBOMs, run scans, generate remediation plans, and query graphs.
- `auditor`: Access to cryptographic audit logs, compliance evidence bundles, and tamper ledgers.
- `admin`: Full administrative control, policy approval, secret rotation, connector configuration, and database pruning.

### 1.4 Standard Error Response Schema
All error responses return a standardized JSON error envelope:
```json
{
  "error": {
    "code": "ERR_VALIDATION_FAILED",
    "message": "Detailed description of the validation failure.",
    "requestId": "req_884f9b2d-4180-493a-8b89-102948719283",
    "timestamp": "2026-09-17T02:00:00.000Z",
    "details": [
      "Field 'specVersion' must equal '1.6'"
    ]
  }
}
```

---

## 2. Core Health & System Endpoints

### 2.1 Service Health Check
- **Method & Path**: `GET /health` (alias: `GET /api/v1/health`)
- **Purpose**: Reports real-time backend operational health, uptime, version, and database connectivity. Used by Kubernetes readiness and liveness probes.
- **Auth Requirement**: None (`public`).
- **Authorization**: Public.
- **Rate Limit**: Uncapped (Internal cluster monitoring).
- **Request Schema**: None.
- **Response Schema (`200 OK`)**:
  ```json
  {
    "status": "healthy",
    "service": "ecdat-backend",
    "version": "1.0.0",
    "environment": "production",
    "uptime_seconds": 18240,
    "timestamp": "2026-09-17T02:00:00.000Z",
    "dependencies": {
      "database": "healthy"
    }
  }
  ```
- **Error Codes**: `503 Service Unavailable` (`status: "degraded"` if database is unreachable and `REQUIRE_DATABASE_HEALTH=true`).
- **Sensitive Fields**: None.
- **Example**:
  ```bash
  curl -X GET "https://api.ecdat.corp/health"
  ```

---

## 3. Authentication & Identity Endpoints (`/api/v1/auth`)

### 3.1 Local Username & Password Login
- **Method & Path**: `POST /api/v1/auth/local/login`
- **Purpose**: Authenticates local security principal, verifies argon2id/bcrypt password, handles account lockout, and issues short-lived access and refresh tokens.
- **Auth Requirement**: None (`public`).
- **Authorization**: Public.
- **Rate Limit**: `Auth Tier: 10 requests / minute per IP`.
- **Request Schema**:
  ```json
  {
    "username": "secops_admin",
    "password": "StrongPassword123!"
  }
  ```
- **Response Schema (`200 OK`)**:
  ```json
  {
    "success": true,
    "accessToken": "eyJhbGciOiJ...",
    "refreshToken": "eyJhbGciOiJ...",
    "expiresIn": 900,
    "tokenType": "Bearer",
    "user": {
      "id": "usr_99124",
      "username": "secops_admin",
      "roles": ["admin"],
      "tenantId": "tenant_default"
    },
    "mfaRequired": false
  }
  ```
- **Error Codes**: `400 Bad Request` (`ERR_MISSING_CREDENTIALS`), `401 Unauthorized` (`ERR_INVALID_CREDENTIALS`), `423 Locked` (`ERR_ACCOUNT_LOCKED_ATTEMPTS`).
- **Sensitive Fields**: `password` (Request - stripped from access logs), `accessToken`, `refreshToken` (Response - masked in logs).
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/auth/local/login" \
    -H "Content-Type: application/json" \
    -d '{"username":"secops_admin","password":"StrongPassword123!"}'
  ```

### 3.2 Token Refresh (RTR)
- **Method & Path**: `POST /api/v1/auth/token/refresh`
- **Purpose**: Exchanges a valid refresh token for a fresh token pair using Refresh Token Rotation (RTR).
- **Auth Requirement**: Refresh Token.
- **Authorization**: Public (with valid refresh token).
- **Rate Limit**: `30 requests / minute`.
- **Request Schema**:
  ```json
  {
    "refreshToken": "eyJhbGciOiJ..."
  }
  ```
- **Response Schema (`200 OK`)**:
  ```json
  {
    "accessToken": "eyJhbGciOiJ...",
    "refreshToken": "eyJhbGciOiJ...",
    "expiresIn": 900
  }
  ```
- **Error Codes**: `401 Unauthorized` (`ERR_TOKEN_EXPIRED`, `ERR_TOKEN_REVOKED`).
- **Sensitive Fields**: `refreshToken`, `accessToken`.
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/auth/token/refresh" \
    -H "Content-Type: application/json" \
    -d '{"refreshToken":"eyJhbGciOiJ..."}'
  ```

### 3.3 CSRF Token Generation
- **Method & Path**: `GET /api/v1/auth/csrf-token`
- **Purpose**: Generates and issues a cryptographically secure CSRF token pair for browser SPA sessions.
- **Auth Requirement**: None (`public`).
- **Authorization**: Public.
- **Rate Limit**: `60 requests / minute`.
- **Response Schema (`200 OK`)**:
  ```json
  {
    "csrfToken": "csrf_019284abcdef...",
    "headerName": "X-CSRF-Token"
  }
  ```
- **Sensitive Fields**: `csrfToken`.
- **Example**:
  ```bash
  curl -X GET "https://api.ecdat.corp/api/v1/auth/csrf-token"
  ```

### 3.4 Secret Rotation
- **Method & Path**: `POST /api/v1/auth/secrets/rotate`
- **Purpose**: Rotates JWT signing secrets and re-keys active security credentials.
- **Auth Requirement**: API Key / JWT.
- **Authorization**: `admin` role with `SECRETS_ROTATE` permission.
- **Rate Limit**: `5 requests / minute`.
- **Request Schema**:
  ```json
  {
    "secretType": "jwt_signing_key",
    "reason": "Routine quarterly cryptographic key rotation"
  }
  ```
- **Response Schema (`200 OK`)**:
  ```json
  {
    "status": "rotated",
    "secretType": "jwt_signing_key",
    "newKeyId": "key_2026_q3_09",
    "rotatedAt": "2026-09-17T02:00:00.000Z"
  }
  ```
- **Error Codes**: `401 Unauthorized`, `403 Forbidden` (`ERR_INSUFFICIENT_PERMISSIONS`).
- **Sensitive Fields**: None exposed in response.
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/auth/secrets/rotate" \
    -H "X-API-Key: <ADMIN_API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"secretType":"jwt_signing_key","reason":"Routine quarterly rotation"}'
  ```

---

## 4. Cryptographic Ingestion & Pipeline Endpoints (`/api/v1/cboms`, `/scan/*`)

### 4.1 Ingest CycloneDX 1.6 CBOM
- **Method & Path**: `POST /api/v1/cboms` (alias: `POST /api/v1/cbom/ingest`)
- **Purpose**: Ingests, sanitizes, and evaluates a CycloneDX 1.6 Cryptographic Bill of Materials (CBOM) file. Extracts cryptographic assets, runs the deterministic risk engine, calculates Mosca deltas, and persists scan results.
- **Auth Requirement**: API Key (`X-API-Key`) or JWT.
- **Authorization**: `analyst`, `admin`.
- **Rate Limit**: `Upload Tier: 60 uploads / minute`.
- **Payload Limit**: Strictly bounded to 10MB (`MAX_JSON_SIZE`).
- **Request Schema**: Standard CycloneDX 1.6 JSON with cryptographic component extensions:
  ```json
  {
    "bomFormat": "CycloneDX",
    "specVersion": "1.6",
    "serialNumber": "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
    "version": 1,
    "metadata": {
      "component": {
        "name": "payment-auth-service",
        "type": "application"
      }
    },
    "components": [
      {
        "type": "cryptographic-asset",
        "name": "RSA-1024-Token-Signer",
        "cryptoProperties": {
          "assetType": "algorithm",
          "algorithmProperties": {
            "name": "RSA",
            "keyLength": 1024,
            "mode": "signature"
          }
        }
      }
    ]
  }
  ```
- **Response Schema (`201 Created`)**:
  ```json
  {
    "success": true,
    "scanId": "scan_981240182",
    "target": "payment-auth-service",
    "totalComponents": 1,
    "cryptographicAssetsFound": 1,
    "riskSummary": {
      "critical": 1,
      "high": 0,
      "medium": 0,
      "low": 0,
      "moscaQuantumDeficit": true
    },
    "createdAt": "2026-09-17T02:00:00.000Z"
  }
  ```
- **Error Codes**: `400 Bad Request` (`ERR_CBOM_INVALID_SCHEMA`, `ERR_PROTOTYPE_POLLUTION`), `413 Payload Too Large`, `401 Unauthorized`.
- **Sensitive Fields**: Scanned and redacted automatically: any embedded private key or password is replaced with `[REDACTED_SECRET SHA256:<hash>]`.
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/cboms" \
    -H "X-API-Key: <API_KEY>" \
    -H "Content-Type: application/json" \
    --data-binary "@artifacts/cbom/ecdat_sbom_cyclonedx.json"
  ```

### 4.2 Ingest Standard SBOM (Extract Cryptography)
- **Method & Path**: `POST /api/v1/sbom/ingest`
- **Purpose**: Ingests standard software Bill of Materials (CycloneDX or SPDX) and automatically discovers linked cryptographic dependencies via the cryptographic library catalog.
- **Auth Requirement**: API Key / JWT.
- **Authorization**: `analyst`, `admin`.
- **Rate Limit**: `60 requests / minute`.
- **Response Schema (`200 OK`)**:
  ```json
  {
    "status": "success",
    "componentsScanned": 705,
    "cryptoLibrariesIdentified": [
      { "name": "openssl", "version": "3.0.13", "pqcReady": false }
    ],
    "cbomGenerated": true
  }
  ```
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/sbom/ingest" \
    -H "X-API-Key: <API_KEY>" \
    -H "Content-Type: application/json" \
    --data-binary "@artifacts/sbom/ecdat_sbom_cyclonedx.json"
  ```

---

## 5. Scans & Findings Endpoints (`/api/v1/scans`, `/api/v1/findings`, `/api/v1/assets`)

### 5.1 List All Scans
- **Method & Path**: `GET /api/v1/scans`
- **Purpose**: Lists historical and active scans with pagination, tenant filtering, and aggregate counts.
- **Auth Requirement**: Optional in dev; mandatory in production (`REQUIRE_AUTH_FOR_READS=true`).
- **Authorization**: `viewer`, `analyst`, `admin`.
- **Rate Limit**: `100 requests / minute`.
- **Query Parameters**:
  - `limit` (int, default: 20, max: 100)
  - `offset` (int, default: 0)
  - `target` (string, optional filter)
- **Response Schema (`200 OK`)**:
  ```json
  {
    "total": 45,
    "limit": 20,
    "offset": 0,
    "scans": [
      {
        "id": "scan_981240182",
        "targetName": "payment-auth-service",
        "status": "completed",
        "criticalCount": 1,
        "highCount": 2,
        "createdAt": "2026-09-17T01:30:00.000Z"
      }
    ]
  }
  ```
- **Example**:
  ```bash
  curl -X GET "https://api.ecdat.corp/api/v1/scans?limit=10" \
    -H "X-API-Key: <API_KEY>"
  ```

### 5.2 List Cryptographic Findings
- **Method & Path**: `GET /api/v1/findings`
- **Purpose**: Returns filterable cryptographic findings across scans, supporting multi-dimensional queries.
- **Auth Requirement**: Mandatory in production (`REQUIRE_AUTH_FOR_READS=true`).
- **Authorization**: `viewer`, `analyst`, `admin`.
- **Rate Limit**: `100 requests / minute`.
- **Query Parameters**:
  - `scanId` (string, optional)
  - `severity` (enum: `critical`, `high`, `medium`, `low`)
  - `algorithm` (string, e.g. `RSA`, `MD5`)
  - `pqcReadiness` (enum: `quantum_vulnerable`, `quantum_safe`, `hybrid`, `broken`)
  - `limit` (int, default: 50)
- **Response Schema (`200 OK`)**:
  ```json
  {
    "total": 1,
    "findings": [
      {
        "findingId": "find_rsa_1024_auth",
        "scanId": "scan_981240182",
        "assetName": "RSA-1024-Token-Signer",
        "algorithm": "RSA",
        "keySize": 1024,
        "severity": "Critical",
        "riskScore": 92.5,
        "pqcStatus": "quantum_vulnerable",
        "moscaDeltaYears": 4.5,
        "location": "services/auth/token_signer.go:42",
        "remediationTarget": "ML-KEM-768 / RSA-3072"
      }
    ]
  }
  ```
- **Example**:
  ```bash
  curl -X GET "https://api.ecdat.corp/api/v1/findings?severity=critical" \
    -H "X-API-Key: <API_KEY>"
  ```

### 5.3 Retrieve Finding with Deterministic Explainability Tree
- **Method & Path**: `GET /api/v1/findings/:findingId`
- **Purpose**: Fetches granular finding details including mathematical risk derivations, regulatory non-compliance citations, and replacement recommendations.
- **Auth Requirement**: Mandatory in production.
- **Authorization**: `viewer`, `analyst`, `admin`.
- **Response Schema (`200 OK`)**:
  ```json
  {
    "findingId": "find_rsa_1024_auth",
    "algorithm": "RSA",
    "keySize": 1024,
    "severity": "Critical",
    "explainability": {
      "ruleTriggered": "rules/algorithm_lifecycle.json#RSA-sub2048",
      "quantumVulnerable": true,
      "mathematicalFormula": "Risk = 0.35(100) + 0.25(100) + 0.20(100) + 0.20(80) = 96.0",
      "regulatoryCitations": [
        "NIST SP 800-131A Rev 2: RSA < 2048 Disallowed since 2013",
        "PCI-DSS v4.0 Requirement 12.3.3: Strong Cryptography Mandate"
      ],
      "pqcMigrationGuidance": "Transition digital signature scheme to ML-DSA-65 or hybrid ECDSA-P256+ML-DSA."
    }
  }
  ```
- **Example**:
  ```bash
  curl -X GET "https://api.ecdat.corp/api/v1/findings/find_rsa_1024_auth" \
    -H "X-API-Key: <API_KEY>"
  ```

---

## 6. Dashboard & Crypto Graph Endpoints (`/api/v1/dashboard`, `/api/v1/graph`)

### 6.1 Multi-Tier Cryptographic Relationship Graph
- **Method & Path**: `GET /api/v1/graph` (alias: `GET /api/v1/dashboard/graph`)
- **Purpose**: Generates nodes, edges, blast-radius metrics, and filtered subgraphs for interactive Cytoscape/D3 network visualization.
- **Auth Requirement**: Mandatory in production.
- **Authorization**: `viewer`, `analyst`, `admin`.
- **Rate Limit**: `60 requests / minute`.
- **Query Parameters**:
  - `scanId` (string, default: latest)
  - `severity` (string filter)
  - `algorithm` (string filter)
  - `pqcReadiness` (string filter)
- **Response Schema (`200 OK`)**:
  ```json
  {
    "scanId": "scan_981240182",
    "nodes": [
      {
        "id": "app_customer_identity",
        "type": "Application",
        "label": "Customer Identity Portal",
        "severity": "High"
      },
      {
        "id": "algo_rsa_1024",
        "type": "Algorithm",
        "label": "RSA-1024",
        "severity": "Critical"
      }
    ],
    "edges": [
      {
        "id": "e1",
        "source": "app_customer_identity",
        "target": "algo_rsa_1024",
        "relation": "signs_jwt",
        "severity": "Critical"
      }
    ],
    "blastRadius": {
      "affectedApplications": 1,
      "affectedEndpoints": 2,
      "exposedDataSensitivity": "auth_credentials"
    }
  }
  ```
- **Sensitive Fields**: Node labels are sanitized by `sanitizeGraphLabel()`; raw PEM keys, hashes, and secrets are strictly redacted.
- **Example**:
  ```bash
  curl -X GET "https://api.ecdat.corp/api/v1/graph" \
    -H "X-API-Key: <API_KEY>"
  ```

---

## 7. Certificate Intelligence Endpoints (`/api/v1/certificates`)

### 7.1 List Certificate Inventory
- **Method & Path**: `GET /api/v1/certificates`
- **Purpose**: Retrieves tracked X.509 certificates with validity periods, key types, issuers, and CT log status.
- **Auth Requirement**: Mandatory in production.
- **Authorization**: `viewer`, `analyst`, `admin`.
- **Response Schema (`200 OK`)**:
  ```json
  {
    "total": 12,
    "certificates": [
      {
        "fingerprintSha256": "3a8b9c...f1",
        "subjectDn": "CN=api.ecdat.corp",
        "issuerDn": "CN=Let's Encrypt Authority X3",
        "validFrom": "2026-01-01T00:00:00.000Z",
        "validTo": "2026-10-01T00:00:00.000Z",
        "daysRemaining": 14,
        "keyAlgorithm": "RSA",
        "keySize": 2048,
        "isSelfSigned": false,
        "isAnomaly": true,
        "anomalyReason": "Expiring within 30 days"
      }
    ]
  }
  ```
- **Example**:
  ```bash
  curl -X GET "https://api.ecdat.corp/api/v1/certificates" \
    -H "X-API-Key: <API_KEY>"
  ```

---

## 8. Compliance & Policy Endpoints (`/api/v1/policy`, `/api/v1/compliance`)

### 8.1 Evaluate Findings Against Policy
- **Method & Path**: `POST /api/v1/policy/evaluate`
- **Purpose**: Evaluates an array of cryptographic findings against a specific environmental or compliance policy profile.
- **Auth Requirement**: Mandatory in production.
- **Authorization**: `analyst`, `admin`.
- **Request Schema**:
  ```json
  {
    "policyProfile": "financial_pci",
    "findings": [
      {
        "algorithm": "DES",
        "keySize": 56,
        "tlsVersion": "TLS 1.0"
      }
    ]
  }
  ```
- **Response Schema (`200 OK`)**:
  ```json
  {
    "profileUsed": "financial_pci",
    "compliant": false,
    "violationsCount": 2,
    "violations": [
      "Algorithm 'DES' is prohibited by PCI-DSS v4.0",
      "TLS version 'TLS 1.0' is disallowed; minimum version is TLS 1.2"
    ],
    "cicdAction": "BLOCK"
  }
  ```
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/policy/evaluate" \
    -H "X-API-Key: <API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"policyProfile":"financial_pci","findings":[{"algorithm":"DES"}]}'
  ```

---

## 9. Remediation & Patching Endpoints (`/api/v1/remediation`)

### 9.1 Generate Contextual Remediation Plan
- **Method & Path**: `POST /api/v1/remediation/plan`
- **Purpose**: Formulates an end-to-end PQC migration roadmap, estimating complexity, defining staged rollouts, identifying replacement primitives, and generating rollback procedures.
- **Auth Requirement**: Mandatory in production.
- **Authorization**: `analyst`, `admin`.
- **Request Schema**:
  ```json
  {
    "scanId": "scan_981240182",
    "targetPqcStandard": "NIST-FIPS-203-ML-KEM"
  }
  ```
- **Response Schema (`200 OK`)**:
  ```json
  {
    "planId": "plan_981240182",
    "totalActions": 1,
    "actions": [
      {
        "actionId": "act_1",
        "targetAsset": "RSA-1024-Token-Signer",
        "replacementCandidate": "ML-KEM-768 / RSA-3072",
        "effortEstimate": "Medium (2-3 sprints)",
        "stagedRollout": {
          "phase1": "Deploy hybrid dual-signing with X25519+ML-KEM-768",
          "phase2": "Deprecate legacy RSA-1024 with warning telemetry",
          "phase3": "Enforce quantum-safe verification strictly"
        },
        "rollbackPlan": "Re-enable RSA-1024 fallback via feature flag"
      }
    ]
  }
  ```
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/remediation/plan" \
    -H "X-API-Key: <API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"scanId":"scan_981240182"}'
  ```

### 9.2 Generate AST-Preserving Code Patch
- **Method & Path**: `POST /api/v1/remediation/generate-patch`
- **Purpose**: Generates a unified syntactic code diff replacing deprecated cryptographic calls with modern/post-quantum alternatives without corrupting whitespace or comments.
- **Auth Requirement**: Mandatory in production.
- **Authorization**: `analyst`, `admin`.
- **Request Schema**:
  ```json
  {
    "findingId": "find_rsa_1024_auth",
    "targetFile": "services/auth/token_signer.go",
    "targetAlgorithm": "ML-DSA-65"
  }
  ```
- **Response Schema (`200 OK`)**:
  ```json
  {
    "status": "success",
    "targetFile": "services/auth/token_signer.go",
    "unifiedDiff": "--- a/services/auth/token_signer.go\n+++ b/services/auth/token_signer.go\n@@ -42,3 +42,3 @@\n-   key, err := rsa.GenerateKey(rand.Reader, 1024)\n+   key, err := rsa.GenerateKey(rand.Reader, 3072)\n",
    "syntaxValid": true
  }
  ```
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/remediation/generate-patch" \
    -H "X-API-Key: <API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"findingId":"find_rsa_1024_auth","targetFile":"services/auth/token_signer.go"}'
  ```

---

## 10. CI/CD & Vulnerability Release Gate (`/api/v1/ci`)

### 10.1 Vulnerability Release Gate Evaluation (Phase 23.3)
- **Method & Path**: `POST /api/v1/ci/vulnerability-release-gate`
- **Purpose**: Evaluates release readiness against the four-tier vulnerability standard (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`) with anti-tampering verification.
- **Auth Requirement**: API Key / JWT.
- **Authorization**: `analyst`, `admin`.
- **Request Schema**:
  ```json
  {
    "findings": [
      { "id": "VULN-001", "severity": "MEDIUM", "title": "Self-signed certificate in internal DMZ" }
    ],
    "acceptedRisks": []
  }
  ```
- **Response Schema (`200 OK`)**:
  ```json
  {
    "verdict": "PASS",
    "releasedBlocked": false,
    "criticalBlockers": 0,
    "unacceptedHighs": 0,
    "acceptedHighs": 0,
    "trackedRemediations": 1,
    "trackedImprovements": 0,
    "tamperingViolations": 0
  }
  ```
- **Error Codes**: `422 Unprocessable Entity` (if release blocked: `verdict: "BLOCKED"`).
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/ci/vulnerability-release-gate" \
    -H "X-API-Key: <API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"findings":[]}'
  ```

---

## 11. SIEM Event Dispatcher Endpoints (`/api/v1/siem`)

### 11.1 Forward Cryptographic Security Event
- **Method & Path**: `POST /api/v1/siem/forward`
- **Purpose**: Forwards cryptographic findings, compliance alerts, and audit events to configured SIEM collectors (Splunk, Elastic, Syslog, CEF).
- **Auth Requirement**: Mandatory in production.
- **Authorization**: `analyst`, `admin`, `system`.
- **Request Schema**:
  ```json
  {
    "event": {
      "action": "CRYPTOGRAPHIC_SCAN",
      "severity": "CRITICAL",
      "findingId": "find_rsa_1024_auth",
      "asset": "payment-auth-service",
      "description": "RSA-1024 key detected in production"
    }
  }
  ```
- **Response Schema (`200 OK`)**:
  ```json
  {
    "success": true,
    "dispatchedTargets": ["splunk_hec", "syslog_cef"],
    "eventId": "evt_991204812"
  }
  ```
- **Example**:
  ```bash
  curl -X POST "https://api.ecdat.corp/api/v1/siem/forward" \
    -H "X-API-Key: <API_KEY>" \
    -H "Content-Type: application/json" \
    -d '{"event":{"action":"CRYPTOGRAPHIC_SCAN","severity":"CRITICAL"}}'
  ```

---

## 12. Complete Error Code Taxonomy

| HTTP Status | Error Code | Description | Root Cause / Remedy |
| :--- | :--- | :--- | :--- |
| `400` | `ERR_VALIDATION_FAILED` | Request payload failed schema validation | Check JSON syntax and required properties |
| `400` | `ERR_CBOM_INVALID_SCHEMA` | CycloneDX CBOM does not conform to spec 1.6 | Ensure `bomFormat="CycloneDX"` and `specVersion="1.6"` |
| `400` | `ERR_PROTOTYPE_POLLUTION` | Malicious `__proto__` or prototype keys detected | Payload rejected by security parser |
| `401` | `ERR_AUTH_MISSING` | API key or session token not supplied | Provide `X-API-Key` or `Authorization` header |
| `401` | `ERR_AUTH_INVALID` | Credential signature or key is invalid | Check API key validity or re-authenticate |
| `403` | `ERR_CSRF_INVALID` | Double-submit CSRF token mismatch | Provide matching `X-CSRF-Token` header |
| `403` | `ERR_INSUFFICIENT_PERMISSIONS` | User role lacks required RBAC permission | Elevate user permissions or contact admin |
| `404` | `ERR_NOT_FOUND` | Requested scan, finding, or asset does not exist | Verify ID parameter |
| `413` | `ERR_PAYLOAD_TOO_LARGE` | Request payload exceeds 10MB limit | Compress payload or split into batch uploads |
| `422` | `ERR_RELEASE_BLOCKED` | Vulnerability release gate failed | Remediate CRITICAL/HIGH findings or submit risk acceptance |
| `429` | `ERR_RATE_LIMIT_EXCEEDED` | Request frequency exceeded configured threshold | Back off and retry according to `Retry-After` header |
| `500` | `ERR_INTERNAL_SERVER_ERROR` | Uncaught server exception | Check backend logs; secrets are masked |
| `503` | `ERR_DATABASE_UNAVAILABLE` | Database connection failure | Verify PostgreSQL cluster connectivity |
