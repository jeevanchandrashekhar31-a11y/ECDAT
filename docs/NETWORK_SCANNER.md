# ECDAT Network Scanner (Phase 5.1: Network & Protocol Intelligence)

The ECDAT network scanner provides deep cryptographic and protocol intelligence across network endpoints with strict authorization and security controls.

## Features

### 1. Scope Authorization & Audit Logging
- **Authorized Scanning Only**: Explicit authorization is strictly required for every target scope. Scanning outside authorized scope is rejected with permission errors.
- **Target Scope Definition**: Supports hostname patterns (exact and wildcards like `*.corp.internal`), CIDR subnets (IPv4 & IPv6), port allowlists, validity windows, and authorized identities.
- **Immutable Audit Logging**: Every scan authorization check and attempt is permanently logged into a structured JSONL audit trail with unique audit IDs, target inputs, resolved endpoints, scopes, timestamps, and authorization decisions.

### 2. Defensive Security Guardrails
- **SSRF Protection**: Blocks loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, `fe80::/10`), multicast (`224.0.0.0/4`, `ff00::/8`), and cloud metadata services (`169.254.169.254`, `100.100.100.200`).
- **Private Network Policy**: Restricts private RFC1918/RFC4193 addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`) unless both the deployment policy and scope explicitly enable `--allow-private-targets`.
- **DNS Rebinding Protection & IP Pinning**: Validates all resolved addresses once and pins the connection to the validated IP to prevent TOCTOU DNS rebinding. Pre-authorizes hostnames to prevent DNS leakage on unauthorized inputs.
- **Rate Limiting & Concurrency**: Thread-safe token-bucket rate limiter controlling requests per second per target host and globally, combined with worker concurrency bounds.

### 3. Deep Cryptographic & Protocol Intelligence
- **TLS Versions & Protocols**: Discovers SSLv2, SSLv3, TLS 1.0, TLS 1.1, TLS 1.2, and TLS 1.3, plus SSH capabilities.
- **Cipher Suites & Key Exchanges**: Discovers accepted cipher suites and maps key exchange mechanisms (`ECDHE`, `DHE`, `RSA-KeyExchange`, `ECDHE-TLS1.3-KeyShare`).
- **Certificate Chains**: Extracts entire chain (leaf, intermediate, root) with subject, issuer, SANs, validity windows, serials, and SHA-256 fingerprints.
- **Signature Algorithms**: Extracts certificate signature algorithms (`sha256WithRSAEncryption`, `ecdsa-with-SHA384`, etc.).
- **Weak & Deprecated Algorithms**: Flags deprecated protocols (SSLv2/v3, TLS 1.0/1.1), weak ciphers (RC4, 3DES, DES), CBC mode (Lucky 13 / BEAST vulnerability), MD5, SHA-1 signatures, and small keys (RSA < 2048, EC < 224).
- **Expiration & Trust Problems**: Detects expired certificates, not-yet-valid certificates, self-signed certificates, and weak certificate keys.
- **Quantum Vulnerabilities**: Maps classical mechanisms to Shor's algorithm threat (asymmetric key exchange, RSA/EC signatures) and Grover's algorithm sensitivity (symmetric ciphers with keys < 256 bits).

### 4. CycloneDX 1.6 CBOM Taxonomy
- Emits standardized CycloneDX 1.6 Cryptography Bill of Materials (CBOM) including cryptographic properties, evidence, authorization metadata, and component relationships.

## Usage

### CLI Scanning with Explicit Scope

```bash
# Authorized via CLI flags
python -m scanners.network.main api.example.com:443 \
  --authorized-by sec-admin@org.com \
  --allowed-hosts api.example.com,*.internal.net \
  --audit-log audit_log.jsonl \
  -o network_cbom.json

# Authorized via Scope Config File
python -m scanners.network.main https://service.internal:8443 \
  --scope-config scope.json \
  --audit-log audit_log.jsonl \
  -o network_cbom.json
```

### Scope Configuration Format (`scope.json`)

```json
{
  "scope_id": "scope-prod-2026",
  "authorized_by": "ciso-office@corp.com",
  "allowed_hostnames": ["api.corp.com", "*.services.corp.com"],
  "allowed_subnets": ["93.184.216.0/24"],
  "allowed_ports": [443, 8443],
  "allow_private_ips": false,
  "valid_until": "2026-12-31T23:59:59Z",
  "purpose": "Quarterly cryptographic risk assessment"
}
```
