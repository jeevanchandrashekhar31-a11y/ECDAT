# Network Scanner (SSLyze Hardening)

The ECDAT network scanner utilizes `sslyze` to perform deep TLS inspection on authorized target endpoints.

## Features
- **Target Normalization**: Safely handles URLs and host:port strings.
- **DNS Safeties**: Rejects private, loopback, and reserved IPs by default to prevent SSRF and internal network scanning, unless explicitly overridden via `--allow-private-targets`.
- **Concurrency Control**: Implements bounded concurrent scanning with configurable timeouts and concurrency limits to protect the host machine and network.
- **Comprehensive TLS Inspection**: Discovers TLS versions (SSLv2 to TLS 1.3), cipher suites, certificate validity (expiration, self-signed status), and cryptographic key structures (RSA/EC parameters).
- **CycloneDX 1.6 Output**: Merges and standardizes cryptographic findings into the global ECDAT CycloneDX 1.6 taxonomy.

## Usage
```bash
python -m scanners.network.main target1 target2:8443 https://target3 -o network_cbom.json
```
