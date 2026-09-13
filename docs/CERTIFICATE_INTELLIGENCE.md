# ECDAT Certificate Intelligence & Inventory (Phase 5.2)

The ECDAT Certificate Intelligence subsystem establishes a unified inventory of cryptographic certificates discovered across network probes, filesystem scans, container images, and software components.

## Core Invariant: Zero Private Key Storage

> [!CAUTION]
> **STRICT SECURITY INVARIANT**: Under NO circumstances does the ECDAT Certificate Inventory, scanner pipeline, CBOM output, database, or logging framework store, process, or persist private key material.
>
> Any payload containing private key markers (`BEGIN PRIVATE KEY`, `BEGIN RSA PRIVATE KEY`, `BEGIN EC PRIVATE KEY`, `BEGIN DSA PRIVATE KEY`, `BEGIN ENCRYPTED PRIVATE KEY`, `BEGIN OPENSSH PRIVATE KEY`) is immediately intercepted, raises a `SECURITY VIOLATION` error, and is blocked from ingestion.

---

## 1. Tracked Certificate Inventory Attributes

For every certificate in the inventory, ECDAT tracks:

| Attribute | Description | Example |
| :--- | :--- | :--- |
| **`fingerprint_sha256`** | Canonical SHA-256 fingerprint hex digest | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| **`serial_number`** | Certificate serial number in hex/decimal | `1029384756` |
| **`subject`** | Full RFC4514 Subject DN | `CN=api.corp.internal,O=Corporate Systems,C=US` |
| **`issuer`** | Full RFC4514 Issuer DN | `CN=Enterprise Intermediate CA,O=Corporate Systems,C=US` |
| **`san`** | Subject Alternative Names (DNS names, IP addresses) | `["api.corp.internal", "gateway.corp.internal"]` |
| **`validity`** | `not_before`, `not_after`, `days_until_expiration` | `not_after: "2027-01-01T00:00:00Z"`, `days_until_expiration: 110` |
| **`public_key_algorithm`**| Asymmetric algorithm family | `RSA`, `EC`, `Ed25519`, `DSA` |
| **`public_key_size`** | Asymmetric key size in bits | `2048`, `4096`, `256`, `384` |
| **`signature_algorithm`** | Certificate signature algorithm | `sha256WithRSAEncryption`, `ecdsa-with-SHA384` |
| **`chain`** | Complete certificate chain & fingerprints | `[leaf, intermediate_1, ..., root]` |
| **`trust_context`** | Trust status & anchor assessment | `trusted`, `self_signed`, `untrusted_root`, `invalid_chain` |
| **`endpoint_usage`** | Network endpoints serving this certificate | `[{"endpoint": "api.corp.internal:443", "protocol": "TLS", ...}]` |
| **`owner`** | Operational owner / responsible team | `cloud-platform@corp.internal` |
| **`environment`** | Target deployment environment | `production`, `staging`, `development`, `internal`, `sandbox` |
| **`renewal_state`** | Lifecycle renewal state | `OK`, `EXPIRING_SOON`, `CRITICAL_EXPIRING`, `EXPIRED`, `NOT_YET_VALID`, `RENEWED` |

---

## 2. Automated Anomaly Detection

ECDAT automatically inspects and flags the following anomaly classes:

1. **`expired`**:
   - Detected when the current system timestamp exceeds `not_after`.
2. **`expiring`**:
   - Detected when `days_until_expiration <= warning_days` (default: 30 days) or `critical_days` (default: 7 days).
3. **`weak_keys`**:
   - RSA key size < 2048 bits (e.g. 512, 1024).
   - EC curve key size < 224 bits (e.g. secp160r1, secp192r1).
   - DSA key size < 2048 bits.
4. **`deprecated_signatures`**:
   - Signature algorithm contains MD5 (e.g., `md5WithRSAEncryption`).
   - Signature algorithm contains SHA-1 (e.g., `sha1WithRSAEncryption`, `ecdsa-with-SHA1`).
5. **`invalid_chains`**:
   - Broken issuer-to-subject linkage between sequential certificates in the chain (`child.issuer != parent.subject`).
   - Incomplete chain: A non-self-signed certificate deployed without its intermediate certificate chain.
   - Expired intermediate certificate in chain.
6. **`inconsistent_deployments`**:
   - **Multiple Certificates for Single Host**: Differing certificates (different fingerprints or expiry dates) deployed across separate endpoints serving the same service hostname (e.g. round-robin or load-balancer nodes out of sync).
   - **Hostname Mismatch**: The serving endpoint hostname does not match the certificate Subject Common Name or any Subject Alternative Name (`inconsistent_deployments:hostname_mismatch`).
   - **Production Self-Signed**: A self-signed certificate deployed on an endpoint marked for `production` (`inconsistent_deployments:production_self_signed`).

---

## 3. CLI and Programmatic Interfaces

### Python CLI Export

```bash
# Network scan with certificate inventory export
python -m scanners.network.main api.corp.internal:443 \
  --authorized-by sec-ops@corp.internal \
  --allowed-hosts api.corp.internal \
  --export-cert-inventory cert_inventory.json \
  --owner platform-team \
  --environment production \
  -o network_cbom.json
```

### Node.js REST API Endpoints

- `GET /api/v1/certificates`: Lists certificates with query filters (`environment`, `renewalState`, `owner`, `anomaly`, `expiringWithinDays`).
- `GET /api/v1/certificates/anomalies`: Groups certificates by anomaly category.
- `GET /api/v1/certificates/summary`: Metrics on renewal states and anomaly counts.
- `GET /api/v1/certificates/:fingerprint`: Retrieves detailed certificate record by SHA-256 fingerprint.
- `POST /api/v1/certificates/ingest`: Ingests certificates with zero private key storage verification.
