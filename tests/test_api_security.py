"""
Tests for OWASP API Security & Hardening — Phase 15.1
"""

import os
import pytest
from scanners.api_security import (
    validate_safe_url,
    validate_safe_path,
    inspect_for_injection,
    sanitize_response_data,
    validate_mass_assignment,
    validate_object_authorization,
    is_private_ip,
)


class TestSsrfProtection:
    """Test SSRF validation against private networks, cloud metadata, and invalid schemes."""

    @pytest.mark.parametrize("bad_url, expected_error_fragment", [
        ("http://127.0.0.1/admin", "forbidden target"),
        ("http://localhost:8080/metrics", "forbidden target"),
        ("http://169.254.169.254/latest/meta-data/", "forbidden target"),
        ("http://metadata.google.internal/computeMetadata/v1/", "forbidden target"),
        ("http://10.0.1.5:9200/_search", "private/link-local"),
        ("http://192.168.1.1/router", "private/link-local"),
        ("http://172.16.5.10/internal", "private/link-local"),
        ("ftp://files.example.com/dump.zip", "Protocol 'ftp' is not permitted"),
        ("file:///etc/passwd", "Protocol 'file' is not permitted"),
        ("gopher://127.0.0.1:6379/_flushall", "Protocol 'gopher' is not permitted"),
        ("https://admin:secret@api.example.com/webhook", "Embedded credentials"),
    ])
    def test_ssrf_rejects_malicious_urls(self, bad_url, expected_error_fragment):
        safe, err = validate_safe_url(bad_url)
        assert safe is False
        assert expected_error_fragment in err

    def test_ssrf_allows_public_urls(self):
        safe, err = validate_safe_url("https://api.github.com/repos/org/repo")
        assert safe is True
        assert err is None


class TestPathTraversalProtection:
    """Test Path Traversal defense against directory escape and null byte injection."""

    def test_path_traversal_rejection(self, tmp_path):
        base_dir = str(tmp_path)

        # 1. Null byte
        safe, _, err = validate_safe_path("report.pdf\0.png", base_dir)
        assert safe is False
        assert "Null byte" in err

        # 2. Parent directory traversal
        safe, _, err = validate_safe_path("../../../etc/shadow", base_dir)
        assert safe is False
        assert "Directory traversal" in err

        # 3. Encoded traversal
        safe, _, err = validate_safe_path("%2e%2e/secret.txt", base_dir)
        assert safe is False
        assert "Directory traversal" in err

        # 4. Legitimate subpath
        safe, resolved, err = validate_safe_path("scans/2026/cbom.json", base_dir)
        assert safe is True
        assert resolved.startswith(base_dir)
        assert err is None


class TestInjectionProtection:
    """Test injection inspection for SQL, NoSQL, command, and prototype pollution."""

    def test_prototype_pollution_detection(self):
        payload = {"__proto__": {"polluted": True}}
        res = inspect_for_injection(payload)
        assert res is not None
        assert res["type"] == "PROTOTYPE_POLLUTION"

        nested = {"user": {"constructor": {"prototype": {}}}}
        res_nested = inspect_for_injection(nested)
        assert res_nested is not None
        assert res_nested["type"] == "PROTOTYPE_POLLUTION"

    def test_nosql_operator_detection(self):
        payload = {"username": {"$gt": ""}}
        res = inspect_for_injection(payload)
        assert res is not None
        assert res["type"] == "NOSQL_INJECTION"

    def test_sqli_detection(self):
        sqli_inputs = [
            "admin' OR '1'='1",
            "1; DROP TABLE users;--",
            "1 UNION SELECT null, username, password FROM users",
        ]
        for inp in sqli_inputs:
            res = inspect_for_injection({"query": inp})
            assert res is not None
            assert res["type"] == "SQL_INJECTION"

    def test_command_injection_detection(self):
        cmd_inputs = [
            "127.0.0.1; rm -rf /",
            "test | cat /etc/passwd",
            "$(whoami)",
            "`id`",
        ]
        for inp in cmd_inputs:
            res = inspect_for_injection({"target": inp})
            assert res is not None
            assert res["type"] == "COMMAND_INJECTION"

    def test_legitimate_code_and_crypto_strings_not_flagged(self):
        safe_data = {
            "algorithm": "AES-256-GCM",
            "keyLength": 256,
            "evidence": "db.query('SELECT name FROM assets WHERE id = 1')", # exempt code field
            "description": "Standard cryptographic scan on database endpoint",
        }
        res = inspect_for_injection(safe_data)
        assert res is None


class TestMassAssignmentAndBopla:
    """Test Broken Object Property Level Authorization (BOPLA) defense."""

    def test_blocks_sensitive_fields_for_non_admins(self):
        payload = {
            "displayName": "Jeevan C",
            "email": "jeevan@enterprise.internal",
            "role": "admin", # Forbidden mass assignment
        }
        valid, violations = validate_mass_assignment(payload, is_admin=False)
        assert valid is False
        assert "role" in violations

    def test_permits_modification_for_admins(self):
        payload = {
            "displayName": "Jeevan C",
            "role": "admin",
            "tenantId": "tenant-alpha",
        }
        valid, violations = validate_mass_assignment(payload, is_admin=True)
        assert valid is True
        assert len(violations) == 0


class TestObjectLevelAuthorizationBola:
    """Test Broken Object Level Authorization (BOLA / IDOR) and tenant isolation."""

    def test_tenant_boundary_enforced(self):
        # Cross-tenant access attempt
        allowed, err = validate_object_authorization(
            caller_user_id="user-1",
            caller_tenant_id="tenant-A",
            resource_owner_id="user-2",
            resource_tenant_id="tenant-B",
            is_admin=False,
        )
        assert allowed is False
        assert "TENANT_ACCESS_DENIED" in err

    def test_owner_boundary_enforced(self):
        # Same tenant, different owner
        allowed, err = validate_object_authorization(
            caller_user_id="user-1",
            caller_tenant_id="tenant-A",
            resource_owner_id="user-2",
            resource_tenant_id="tenant-A",
            is_admin=False,
        )
        assert allowed is False
        assert "OBJECT_AUTHORIZATION_FAILED" in err

    def test_owner_access_granted(self):
        allowed, err = validate_object_authorization(
            caller_user_id="user-1",
            caller_tenant_id="tenant-A",
            resource_owner_id="user-1",
            resource_tenant_id="tenant-A",
            is_admin=False,
        )
        assert allowed is True
        assert err is None

    def test_admin_bypass_allowed(self):
        allowed, err = validate_object_authorization(
            caller_user_id="admin-user",
            caller_tenant_id="tenant-admin",
            resource_owner_id="user-2",
            resource_tenant_id="tenant-B",
            is_admin=True,
        )
        assert allowed is True
        assert err is None


class TestExcessiveDataExposure:
    """Test response sanitization redacting sensitive fields."""

    def test_sanitizes_nested_secrets(self):
        dirty_response = {
            "userId": "usr-123",
            "username": "alice",
            "password": "hashed_pass_secret",
            "tokens": {
                "private_key": "-----BEGIN PRIVATE KEY-----...",
                "secret_bytes": "01020304",
            },
            "publicInfo": "Developer",
        }

        clean = sanitize_response_data(dirty_response)
        assert clean["userId"] == "usr-123"
        assert clean["username"] == "alice"
        assert clean["publicInfo"] == "Developer"
        assert clean["password"] == "[REDACTED_SENSITIVE_DATA]"
        assert clean["tokens"]["private_key"] == "[REDACTED_SENSITIVE_DATA]"
        assert clean["tokens"]["secret_bytes"] == "[REDACTED_SENSITIVE_DATA]"
