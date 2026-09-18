# @ecdat-synthetic-corpus
# ECDAT Adversarial Testing Framework & Security Control Specifications

## 1. Executive Summary & Framework Architecture

The **ECDAT Adversarial Testing Framework** (`security_tests/`) provides rigorous, continuous validation of all cryptographic, administrative, and data-plane security controls within ECDAT.

Rather than relying on basic happy-path unit tests, every vital security control in the platform is subjected to a **5-Point Testing Standard**:
1. **Positive Test**: Verifies legitimate authorized requests succeed cleanly with correct outputs.
2. **Negative Test**: Verifies malformed, missing, or unauthorized requests are rejected cleanly.
3. **Boundary Test**: Probes boundary limits, off-by-one errors, size clamps, and token expiration edges.
4. **Malicious Test**: Attacks the control using deliberately hostile exploit payloads, evasions, and injection vectors.
5. **Regression Test**: Guarantees that historically remediated CVEs and architectural bugs cannot resurface.

```
+-----------------------------------------------------------------------------+
|                     ECDAT 5-POINT VERIFICATION MODEL                        |
+-----------------------------------------------------------------------------+
|                                                                             |
|   1. POSITIVE       --> Valid authorized inputs pass with zero errors       |
|   2. NEGATIVE       --> Missing/malformed inputs fail deterministically     |
|   3. BOUNDARY       --> Exact min/max sizes, off-by-one, expiry boundaries  |
|   4. MALICIOUS      --> Evasions, encodings, injection vectors intercepted  |
|   5. REGRESSION     --> Past CVEs & bypasses validated against regression   |
|                                                                             |
+-----------------------------------------------------------------------------+
```

---

## 2. Directory Layout & Malicious Fixture Architecture

All adversarial tests and attack corpora reside strictly within `security_tests/`, segregated from general unit tests to isolate hazardous binary fixtures and hostile payload generators.

```text
security_tests/
├── fixtures/
│   ├── fixture_generator.py             # Reproducible fixture generation engine
│   ├── malicious_archives/              # Intentionally weaponized archive files
│   │   ├── zip_slip_relative.zip        # Path traversal via ../../../
│   │   ├── zip_slip_windows.zip        # Windows backslash traversal ..\..\..\
│   │   ├── absolute_unix_path.zip       # Escapes via /etc/passwd root paths
│   │   ├── absolute_windows_path.zip    # Escapes via C:\Windows\System32 paths
│   │   ├── symlink_escape.tar           # Symlink pointing to /etc/shadow
│   │   ├── hardlink_escape.tar          # Hardlink outside target root
│   │   ├── decompression_bomb_ratio.zip # >1000:1 compression ratio bomb
│   │   ├── decompression_bomb_lying_header.zip # Header uncompressed size spoofing
│   │   ├── nested_archive.zip           # Deeply nested archive bomb (depth 10)
│   │   └── malformed_corrupt.zip        # Corrupt header and truncated stream
│   └── malicious_payloads/              # Standardized attack vector JSON datasets
│       ├── ssrf_payloads.json           # DNS rebinding, link-local, hex/octal IPs
│       ├── command_injection_payloads.json # Metacharacters, separators, sh tricks
│       ├── sql_injection_payloads.json  # Tautologies, UNION, stacked queries
│       ├── path_traversal_payloads.json # URL-encoded, unicode, null-byte bypasses
│       ├── prototype_pollution_payloads.json # __proto__, constructor, prototype
│       ├── xxe_payloads.xml             # Billion laughs, external DTD, file schemes
│       └── cbom_malicious_fixtures.json # Deep recursion, component explosion, cycles
├── test_authentication_control.py       # 5-point authentication verification
├── test_authorization_control.py        # 5-point RBAC / privilege verification
├── test_tenant_isolation_control.py     # 5-point cross-tenant leakage prevention
├── test_idor_control.py                 # 5-point object-level access control
├── test_mfa_control.py                  # 5-point multi-factor auth verification
├── test_csrf_control.py                 # 5-point cross-site request forgery defense
├── test_token_management_control.py     # 5-point JWT/token lifecycle management
├── test_ssrf_control.py                 # 5-point server-side request forgery defense
├── test_command_injection_control.py    # 5-point shell injection prevention
├── test_sql_injection_control.py        # 5-point parameterization enforcement
├── test_path_traversal_control.py       # 5-point filesystem containment
├── test_zip_slip_control.py             # 5-point archive traversal defense
├── test_archive_bomb_control.py         # 5-point decompression bomb neutralization
├── test_secret_leakage_control.py       # 5-point secret redaction & canary handling
├── test_xxe_control.py                  # 5-point safe XML parsing defense
├── test_prototype_pollution_control.py  # 5-point object immutability defense
├── test_resource_governance_control.py  # 5-point memory/CPU/DoS governance
├── test_cbom_validation_control.py      # 5-point CycloneDX / CBOM schema defense
├── test_scanner_fail_closed_control.py  # 5-point fail-closed exit code integrity
└── test_session_management_control.py   # 5-point session lifecycle and rotation
```

---

## 3. The 20 Audited Security Controls Matrix

Each security control implements exactly 5 test functions in its dedicated test module, providing 100% test coverage across all five testing dimensions:

| # | Control Subsystem | Target Test Module | Tested Mitigations |
|---|---|---|---|
| **1** | **Authentication** | [`test_authentication_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_authentication_control.py) | Timing-safe credential comparison (`hmac.compare_digest`), bcrypt hashing, salt verification, brute-force throttling. |
| **2** | **Authorization (RBAC)** | [`test_authorization_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_authorization_control.py) | Hierarchical permission checks (`admin`, `auditor`, `developer`, `viewer`), deny-by-default on undefined roles, privilege escalation prevention. |
| **3** | **Tenant Isolation** | [`test_tenant_isolation_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_tenant_isolation_control.py) | Mandatory tenant scoping in queries, rejection of cross-tenant IDs, wildcard tenant blocking, tenant context propagation. |
| **4** | **IDOR / BOLA** | [`test_idor_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_idor_control.py) | Direct object access validation against session ownership, parameter tampering detection, UUID path validation. |
| **5** | **Multi-Factor Auth (MFA)** | [`test_mfa_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_mfa_control.py) | RFC 6238 TOTP window enforcement, replay rejection via single-use code caching, rate limiting on invalid OTP attempts. |
| **6** | **CSRF Protection** | [`test_csrf_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_csrf_control.py) | Cryptographically bound double-submit tokens, SameSite cookie enforcement, Origin/Referer verification on state-changing methods. |
| **7** | **Token Management** | [`test_token_management_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_token_management_control.py) | Cryptographic signature validation, revocation registry / deny-list checks, audience/issuer clamping, expiration enforcement. |
| **8** | **SSRF Defense** | [`test_ssrf_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_ssrf_control.py) | Pre-resolution blocking of private IPs (RFC 1918), loopback (`127.0.0.1`), link-local (`169.254.169.254`), octal/hex/dword IP encodings, and DNS rebinding mitigations. |
| **9** | **Command Injection** | [`test_command_injection_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_command_injection_control.py) | Strict disallowance of shell invocation (`shell=False`), validation of CLI arguments against metacharacter blacklist (`;\|&$><\n\r\0()`), safe argument lists. |
| **10** | **SQL Injection** | [`test_sql_injection_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_sql_injection_control.py) | 100% parameterized SQL query execution, rejection of raw string interpolation, table and column identifier whitelisting. |
| **11** | **Path Traversal** | [`test_path_traversal_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_path_traversal_control.py) | Canonical root containment via `Path.resolve()`, rejection of `../`, `..\`, null bytes, and URL-encoded escapes (`%2e%2e%2f`). |
| **12** | **Zip Slip Defense** | [`test_zip_slip_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_zip_slip_control.py) | Member name pre-check before extraction, detection of relative traversal, absolute Unix/Windows paths, symlink escapes, and extraction aborts. |
| **13** | **Archive Bomb Defense** | [`test_archive_bomb_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_archive_bomb_control.py) | Member count cap (1,000), single member uncompressed cap (25MB), total uncompressed size cap (100MB), compression ratio threshold (100:1). |
| **14** | **Secret Leakage Defense** | [`test_secret_leakage_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_secret_leakage_control.py) | Automatic redaction of private keys, AWS tokens, API credentials, non-reversible SHA-256 fingerprinting, distinction between real secrets and synthetic corpus markers. |
| **15** | **XXE Defense** | [`test_xxe_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_xxe_control.py) | Use of `defusedxml`, disabling of entity resolution, external DTD retrieval, and parameter entities. |
| **16** | **Prototype Pollution** | [`test_prototype_pollution_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_prototype_pollution_control.py) | Sanitization of object keys rejecting `__proto__`, `constructor`, `prototype`, Object freeze enforcement on critical configuration dictionaries. |
| **17** | **Resource Governance** | [`test_resource_governance_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_resource_governance_control.py) | Request body size clamping (10MB max), query complexity limits, per-tenant rate limiting, regex execution timeouts preventing ReDoS. |
| **18** | **CBOM Validation** | [`test_cbom_validation_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_cbom_validation_control.py) | Strict CycloneDX 1.6 / CBOM JSON schema validation, recursion depth capping (depth 64), cyclic dependency resolution, component count caps (50,000). |
| **19** | **Scanner Fail-Closed** | [`test_scanner_fail_closed_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_scanner_fail_closed_control.py) | Deterministic scanner exit code preservation (0=Clean Pass, 1=Policy Violation, 2=Fatal Error), interception of silent crashes, unhandled exception containment. |
| **20** | **Session Management** | [`test_session_management_control.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/security_tests/test_session_management_control.py) | High-entropy session IDs (crypto random 32+ bytes), session regeneration on privilege escalation, idle/absolute timeout expiration, immediate server-side revocation on logout. |

---

## 4. Node.js Cross-Platform Adversarial Suite

In addition to the 100 Python tests, the backend Node.js engine executes 30 adversarial tests in [`backend/tests/security/adversarial_controls.test.js`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/backend/tests/security/adversarial_controls.test.js):
- **Token Management Control**: 5 tests validating signature tampering, algorithm spoofing (`"none"`), expiration boundaries, and revocation caches.
- **IDOR Control**: 5 tests validating tenant resource ownership, cross-tenant modification attempts, invalid UUID handling, and token manipulation.
- **Path Traversal Control**: 5 tests validating root boundary checks, URL-encoded traversals, null-byte injections, and relative paths.
- **Prototype Pollution Control**: 5 tests validating `__proto__` injection neutralization, `constructor.prototype` tampering, deeply nested pollution vectors, and clean prototype state.
- **CBOM Deep Nesting & Recursion Control**: 5 tests validating iterative JSON schema parsing, stack overflow defense, recursion caps, and circular reference safety.
- **SSRF & Localhost Access Control**: 5 tests validating IPv4/IPv6 private ranges, cloud metadata addresses (`169.254.169.254`), dword/hex IP evasions, and strict domain whitelisting.

---

## 5. Verification & Supply-Chain Release Gate Integration

The adversarial test suite is permanently integrated into **Gate 3** of the ECDAT Release Gate Engine ([`scripts/release_gate.py`](file:///c:/Users/Jeevan%20c/Documents/ECDAT/scripts/release_gate.py)):

```python
# Gate 3 Execution Target List in scripts/release_gate.py
security_test_targets = [
    "tests/test_parity_audit.py",
    "tests/test_evidence_integrity.py",
    "tests/test_technical_reporting.py",
    "tests/test_executive_reporting.py",
    "tests/test_production_configuration.py",
    "tests/test_k8s_hardening.py",
    "tests/test_container_hardening.py",
    "tests/test_vulnerability_release_gate.py",
    "tests/test_security_regressions.py",
    "tests/test_security_regression_architecture.py",
    "tests/redteam/test_appsec_assessment.py",
    "tests/redteam/test_adversarial_scanner_assessment.py",
    "tests/test_golden_corpus.py",
    "tests/test_fuzz_parsers.py",
    "tests/test_adversarial_scanner.py",
    "tests/test_final_quality_gate.py",
    "security_tests",
]
```

### Running the Suite Locally
```bash
# Execute the full Python adversarial suite (100 tests)
pytest security_tests/ -v

# Execute the Node.js adversarial suite (30 tests)
node --test backend/tests/security/adversarial_controls.test.js

# Run the complete ECDAT SLSA Level 3 Release Gate (All 6 Gates)
python scripts/release_gate.py
```
