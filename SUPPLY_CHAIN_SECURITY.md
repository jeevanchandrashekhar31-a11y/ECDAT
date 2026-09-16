# ECDAT Supply-Chain Security Architecture & Compliance Standard

**Standard Version**: 1.0.0  
**Target Specification Alignment**: SLSA v1.0 (Level 3 Build Tracks), OpenSSF Scorecard, CycloneDX 1.6, SPDX 2.3  
**Status**: Production / Enforced in CI/CD  

---

## 1. Executive Summary

ECDAT's supply-chain security framework establishes zero-trust integrity, provenance, and tamper resistance across all application layers and build lifecycles.

Every dependency, build artifact, and container image is deterministically pinned, scanned for vulnerabilities across multiple threat databases, cryptographically signed with asymmetric keys, accompanied by machine-readable CycloneDX 1.6 / SPDX 2.3 SBOMs, attested via SLSA v1.0 in-toto provenance statements, and audited through an automated 6-point release gate.

---

## 2. Phase 19.1: ECDAT Software Bill of Materials (SBOM)

### 2.1 Multi-Ecosystem Coverage & Metrics
ECDAT generates a unified, multi-ecosystem SBOM capturing 100% of all direct and transitive dependencies across three core subsystems:

| Subsystem | Primary Manifest | Lockfile & Pinning | Package Count (Direct + Transitive) | Runtime Scope |
|---|---|---|---|---|
| **Python Core & Scanners** | [`requirements.txt`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/requirements.txt) | [`requirements.lock`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/requirements.lock) & [`requirements-lock.txt`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/requirements-lock.txt) | 55 packages | Production Runtime |
| **Node.js Backend & Risk Engine** | [`backend/package.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/package.json) | [`backend/package-lock.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/package-lock.json) | 243 packages | Production Runtime + Dev |
| **React Frontend Dashboard** | [`frontend/package.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/frontend/package.json) | [`frontend/package-lock.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/frontend/package-lock.json) | 404 packages | Production Bundle + Dev |
| **Workspace Root Scripts** | [`package.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/package.json) | [`package-lock.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/package-lock.json) | 1 package | Workspace Orchestration |
| **Total Ecosystem Inventory** | — | — | **702 unique packages** | Complete Graph |

### 2.2 Generated SBOM Artifacts
- **Primary Standard**: CycloneDX 1.6 JSON ([`artifacts/sbom/ecdat_sbom_cyclonedx.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/sbom/ecdat_sbom_cyclonedx.json))
  - Conforms to CycloneDX 1.6 Schema (`https://cyclonedx.org/schema/bom-1.6.schema.json`).
  - Includes full root application metadata, sub-assembly component modeling (`ecdat-scanners`, `ecdat-backend`, `ecdat-frontend`), Package URLs (PURLs), SHA-512 integrity digests, upstream repository URLs, standardized SPDX licenses, and an explicit dependency tree (`dependencies` linking parents to child libraries).
- **Secondary Interoperability Standard**: SPDX 2.3 JSON ([`artifacts/sbom/ecdat_sbom_spdx.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/sbom/ecdat_sbom_spdx.json))
  - Conforms to SPDX 2.3 specification with standardized SPDX IDs, concluded/declared licenses, package download locators, and `DEPENDS_ON` relationships.

### 2.3 Automated SBOM CLI Tool
Run anytime from repository root:
```bash
python scripts/generate_sbom.py --format both --output-dir artifacts/sbom
# or via npm convenience shortcut:
npm run sbom
```

### 2.4 Multi-Ecosystem Vulnerability Scanning
ECDAT integrates [`scripts/scan_vulnerabilities.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scripts/scan_vulnerabilities.py):
- **Batch OSV API Integration**: High-performance chunked querying against Google's Open Source Vulnerabilities database (`https://api.osv.dev/v1/querybatch`) using package PURLs and versions.
- **Offline Fallback Architecture**: Built-in localized caching and advisory lookup prevents scanner failure in air-gapped CI environments.
- **npm audit Integration**: Runs native `npm audit` across backend and frontend lockfiles.
- **Direct SBOM Scanning**: Inspects CycloneDX SBOM component arrays directly.
- **Artifacts**: Emits [`artifacts/security/ecdat_vulnerability_report.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/security/ecdat_vulnerability_report.json) and [`artifacts/security/VULNERABILITY_REPORT.md`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/security/VULNERABILITY_REPORT.md).
- **Run Command**:
```bash
python scripts/scan_vulnerabilities.py --sbom artifacts/sbom/ecdat_sbom_cyclonedx.json --fail-on critical
# or via npm convenience shortcut:
npm run vuln-scan
```

---

## 3. Phase 19.2: Build Security & SLSA Alignment

### 3.1 Reproducible Builds & Deterministic Pinned Inputs
1. **Python Dependencies**: All direct and transitive Python packages are pinned to exact versions in [`requirements.lock`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/requirements.lock).
2. **Node.js Dependencies**: Both [`backend/package-lock.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/package-lock.json) and [`frontend/package-lock.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/frontend/package-lock.json) enforce immutable SHA-512 subresource integrity.
3. **Reproducible Flags**:
   - `SOURCE_DATE_EPOCH=0`: Enforces deterministic archive and binary timestamps.
   - `PYTHONDONTWRITEBYTECODE=1`: Eliminates non-deterministic `.pyc` header timestamps.
4. **Script Execution Isolation**: `npm ci --ignore-scripts` is enforced across all Docker builds to block malicious pre/postinstall lifecycle script hooks.

### 3.2 Container Hardening
- **Pinned Base Image Digests**:
  - Python Scanner: `python:3.12-slim@sha256:606e12e753bf88a444a8fbbfd65dfae87740e53a2588eec86ad6077ff6e20796`
  - Node.js Backend: `node:20-alpine@sha256:20a068eb0d0891d1e43e263c9db862ecbe6ff4ad599f6aa6a188be2849896796`
  - Frontend Nginx: `nginx:alpine@sha256:28929e7c5b6b19a0a2df3324c43ee7d76ee676b744d0c1154c1ff06a13241b44`
- **Unprivileged Non-Root Execution**:
  - Python Scanner executes as dedicated non-root user `ecdat` (UID 10001).
  - Node Backend executes as `node` (UID 1000).
  - Zero containers run as `root` in production.

### 3.3 Cryptographic Artifact Signing
- **Engine**: [`scripts/sign_artifacts.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scripts/sign_artifacts.py)
- **Manifests**: Computes canonical `SHA256SUMS` and `SHA512SUMS` covering all SBOMs, security reports, and attestations.
- **Asymmetric Ed25519 Signing**: Digitally signs checksum manifests using Ed25519 asymmetric cryptography; signature stored at [`artifacts/SHA256SUMS.sig`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/SHA256SUMS.sig).
- **Sigstore Cosign Keyless OIDC**: Integrated in GitHub Actions via OpenID Connect (`id-token: write`), generating verifiable transparency-log certificates via Sigstore Fulcio and Rekor.
- **Run Commands**:
```bash
# Sign artifacts
python scripts/sign_artifacts.py --generate-keys --sign
# Verify integrity & digital signatures
python scripts/sign_artifacts.py --verify
```

### 3.4 SLSA v1.0 Provenance Attestations
- **Engine**: [`scripts/generate_provenance.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scripts/generate_provenance.py)
- **Specification**: In-toto statement conforming to `https://slsa.dev/provenance/v1`.
- **Attestation File**: [`artifacts/provenance/ecdat_provenance.slsa.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/provenance/ecdat_provenance.slsa.json)
- **Attested Attributes**:
  - Subject SHA-256 digests (SBOMs, checksum manifests, vulnerability audits).
  - Builder URI and workflow identification (`.github/workflows/ecdat-supply-chain.yml`).
  - Source repository URI, commit SHA, and invocation ID.
  - Resolved input dependencies (lockfile digests and base container image digests).

### 3.5 CI Runner Isolation & Minimal Build Permissions
- **Least Privilege Workflow**: [`.github/workflows/ecdat-supply-chain.yml`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/.github/workflows/ecdat-supply-chain.yml)
  - Top-level permissions set to deny-all (`permissions: {}`).
  - Scoped minimal job permissions (`contents: read`, `id-token: write`, `security-events: write`).
  - GitHub Actions pinned to immutable 40-character commit SHAs (e.g. `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`).
  - Secretless OIDC authentication eliminates static, leakable credentials.
- **Automated Dependency Updates**: [`.github/dependabot.yml`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/.github/dependabot.yml) monitors pip, npm (backend), npm (frontend), and GitHub Actions.

---

## 4. Phase 19.3: Automated Zero-Trust Release Gate

### 4.1 Gate Rules & Enforcement Logic
The Release Gate engine ([`scripts/release_gate.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scripts/release_gate.py)) evaluates 6 mandatory criteria before any build can be declared valid:

| Gate # | Condition | Enforcement Mechanism | Failure Trigger |
|---|---|---|---|
| **Gate 1** | **Critical Known Exploitable Dependencies** | Evaluates [`artifacts/security/ecdat_vulnerability_report.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/security/ecdat_vulnerability_report.json) against [`rules/security_exceptions.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/rules/security_exceptions.json). | Any unexempted or expired critical vulnerability. |
| **Gate 2** | **Secret Detection** | High-performance entropy & regex pattern scanning for API tokens, AWS keys, private keys, and credentials. | Any unwhitelisted hardcoded credential. |
| **Gate 3** | **Critical Security Tests** | Executes cryptographic and security regression test suites (`pytest tests/`). | Any failing unit or integration security test. |
| **Gate 4** | **Artifact Integrity Verification** | Executes `scripts/sign_artifacts.py --verify`. | Any checksum mismatch or invalid Ed25519 signature. |
| **Gate 5** | **Silent Scanner Crash Detection** | Validates scanner exit codes; verifies error-interception behavior. | Non-zero exit code or scanner crash conflated with "0 vulnerabilities". |
| **Gate 6** | **Required SBOM Verification** | Inspects [`artifacts/sbom/ecdat_sbom_cyclonedx.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/artifacts/sbom/ecdat_sbom_cyclonedx.json) and `spdx.json`. | Missing SBOM, empty file, or invalid CycloneDX 1.6 / SPDX 2.3 schema. |

### 4.2 Documented Security Exceptions Protocol
Exceptions must be recorded in [`rules/security_exceptions.json`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/rules/security_exceptions.json) with:
- `advisory_id`: CVE or GHSA identifier.
- `package_name`: Affected package name.
- `reason`: Rationale detailing why the vulnerability is unexploitable in ECDAT.
- `mitigation_summary`: Defense-in-depth architectural control.
- `approved_by`: Security team approval authority.
- `expires_at`: Strict ISO 8601 expiry timestamp (expired exceptions fail the gate).

### 4.3 Running the Release Gate
```bash
python scripts/release_gate.py --output-dir artifacts/security
# or via npm convenience shortcut:
npm run release-gate
```

---

## 5. End-to-End Verification Runbook

```bash
# 1. Generate full CycloneDX 1.6 & SPDX 2.3 SBOMs
npm run sbom

# 2. Run multi-ecosystem vulnerability audit
npm run vuln-scan

# 3. Generate SLSA v1.0 provenance attestation
npm run provenance

# 4. Sign all release artifacts with Ed25519 & compute checksums
npm run sign

# 5. Execute 6-stage Zero-Trust Release Gate
npm run release-gate
```
