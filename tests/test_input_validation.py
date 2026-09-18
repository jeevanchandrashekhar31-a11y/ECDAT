"""
Tests for External Input Validation & Sanitization Engine — Phase 19 / P1
"""

import pytest
from scanners.common.input_validation import (
    validate_url,
    validate_hostname,
    validate_ip_address,
    validate_length,
    validate_enum,
    validate_numeric_bounds,
    validate_pagination,
    validate_file,
    validate_cbom_content,
    validate_strict_schema,
    InputValidationError,
    TypeValidationError,
    BoundsValidationError,
    SchemaValidationError,
    ALLOWED_ROLES,
    ALLOWED_SEVERITIES,
    ALLOWED_ASSET_TYPES,
    ALLOWED_KMS_PROVIDERS,
    DANGEROUS_MIMES,
)


class TestInputValidation:
    # --------------------------------------------------------------------------
    # 1. Strict Schema & Unknown Field Rejection
    # --------------------------------------------------------------------------
    def test_strict_schema_valid_payload(self):
        payload = {
            "name": "aws-primary-kms",
            "provider": "aws_kms",
            "region": "us-east-1",
        }
        validated = validate_strict_schema(
            payload,
            required_fields=["name", "provider"],
            allowed_fields={"name", "provider", "region"},
            field_types={"name": str, "provider": str, "region": str},
        )
        assert validated["name"] == "aws-primary-kms"

    def test_strict_schema_rejects_unknown_fields(self):
        payload = {
            "name": "test-connector",
            "provider": "aws_kms",
            "injected_field": True,  # Unknown field
        }
        with pytest.raises(SchemaValidationError, match="Unknown fields.*injected_field"):
            validate_strict_schema(
                payload,
                required_fields=["name", "provider"],
                allowed_fields={"name", "provider"},
            )

    # --------------------------------------------------------------------------
    # 2. Type Validation
    # --------------------------------------------------------------------------
    def test_type_validation_rejects_unexpected_types(self):
        payload = {
            "name": 12345,  # Expected str
            "provider": "aws_kms",
        }
        with pytest.raises(TypeValidationError, match="must be of type str"):
            validate_strict_schema(
                payload,
                required_fields=["name", "provider"],
                allowed_fields={"name", "provider"},
                field_types={"name": str, "provider": str},
            )

    # --------------------------------------------------------------------------
    # 3. Length Limits
    # --------------------------------------------------------------------------
    def test_length_limits(self):
        assert validate_length("valid_identifier", min_len=3, max_len=64) == "valid_identifier"

        with pytest.raises(BoundsValidationError, match="less than minimum"):
            validate_length("a", min_len=3, max_len=64)

        with pytest.raises(BoundsValidationError, match="exceeds maximum"):
            validate_length("a" * 100, min_len=1, max_len=50)

    # --------------------------------------------------------------------------
    # 4. Enum Validation
    # --------------------------------------------------------------------------
    def test_enum_validation(self):
        assert validate_enum("viewer", ALLOWED_ROLES) == "viewer"
        assert validate_enum("CRITICAL", ALLOWED_SEVERITIES) == "CRITICAL"
        assert validate_enum("aws_kms", ALLOWED_KMS_PROVIDERS) == "aws_kms"

        with pytest.raises(InputValidationError, match="Invalid value"):
            validate_enum("unauthorized_superadmin", ALLOWED_ROLES)

    # --------------------------------------------------------------------------
    # 5. URL Validation & SSRF Defense
    # --------------------------------------------------------------------------
    def test_url_validation_safe(self):
        url = "https://api.github.com/repos/org/repo"
        assert validate_url(url) == url

    def test_url_validation_rejects_dangerous_protocols(self):
        for proto in ["javascript:alert(1)", "data:text/plain,test", "file:///etc/passwd"]:
            with pytest.raises(InputValidationError, match="Dangerous or forbidden"):
                validate_url(proto)

    def test_url_validation_rejects_ssrf_destinations(self):
        for ssrf_url in [
            "http://169.254.169.254/latest/meta-data/",
            "http://localhost:8080/admin",
            "http://127.0.0.1/status",
            "http://10.0.0.1/internal",
            "http://192.168.1.1/keys",
        ]:
            with pytest.raises(InputValidationError, match="SSRF violation"):
                validate_url(ssrf_url)

    # --------------------------------------------------------------------------
    # 6. Hostname Validation
    # --------------------------------------------------------------------------
    def test_hostname_validation(self):
        assert validate_hostname("kms.us-east-1.amazonaws.com") == "kms.us-east-1.amazonaws.com"

        with pytest.raises(InputValidationError, match="illegal whitespace"):
            validate_hostname("bad\0hostname.com")

        with pytest.raises(InputValidationError, match="Forbidden internal"):
            validate_hostname("localhost")

        with pytest.raises(InputValidationError, match="Forbidden internal"):
            validate_hostname("metadata.google.internal")

    # --------------------------------------------------------------------------
    # 7. IP Validation
    # --------------------------------------------------------------------------
    def test_ip_validation(self):
        assert str(validate_ip_address("8.8.8.8")) == "8.8.8.8"
        assert str(validate_ip_address("2001:4860:4860::8888")) == "2001:4860:4860::8888"

        with pytest.raises(InputValidationError, match="Invalid IP address syntax"):
            validate_ip_address("999.999.999.999")

        # Private IP rejection
        for private_ip in ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.5", "169.254.169.254"]:
            with pytest.raises(InputValidationError, match="Prohibited private"):
                validate_ip_address(private_ip)

    # --------------------------------------------------------------------------
    # 8. File Validation
    # --------------------------------------------------------------------------
    def test_file_validation_traversal_rejection(self):
        with pytest.raises(InputValidationError, match="path traversal"):
            validate_file("../../etc/passwd.json")

        with pytest.raises(InputValidationError, match="path traversal"):
            validate_file("cbom\0.json")

        with pytest.raises(InputValidationError, match="File extension.*is not permitted"):
            validate_file("exploit.sh")

    def test_file_validation_valid(self):
        res = validate_file("cyclonedx.cdx.json", content=b'{"bomFormat":"CycloneDX"}')
        assert res["filename"] == "cyclonedx.cdx.json"
        assert res["size"] > 0

    # --------------------------------------------------------------------------
    # 9. MIME Validation
    # --------------------------------------------------------------------------
    def test_mime_validation_rejects_dangerous_mimes(self):
        for mime in DANGEROUS_MIMES:
            if mime == "application/octet-stream":
                continue
            with pytest.raises(InputValidationError, match="Dangerous MIME type"):
                validate_file("report.json", mime_type=mime)

    # --------------------------------------------------------------------------
    # 10. Content Validation (JSON structure & Private Key Rejection)
    # --------------------------------------------------------------------------
    def test_cbom_content_validation(self):
        clean_json = '{"bomFormat": "CycloneDX", "specVersion": "1.6"}'
        parsed = validate_cbom_content(clean_json)
        assert parsed["bomFormat"] == "CycloneDX"

        with pytest.raises(InputValidationError, match="JSON syntax error"):
            validate_cbom_content("{ broken json")

        malicious = '{"bomFormat": "CycloneDX", "key": "-----BEGIN RSA PRIVATE KEY-----\\nxyz\\n-----END RSA PRIVATE KEY-----"}'
        with pytest.raises(InputValidationError, match="raw private key material"):
            validate_cbom_content(malicious)

    # --------------------------------------------------------------------------
    # 11. Numeric Bounds
    # --------------------------------------------------------------------------
    def test_numeric_bounds(self):
        assert validate_numeric_bounds(10, min_val=1, max_val=100) == 10

        with pytest.raises(TypeValidationError, match="must be a valid number"):
            validate_numeric_bounds("abc")

        with pytest.raises(TypeValidationError, match="cannot be a boolean"):
            validate_numeric_bounds(True)

        with pytest.raises(BoundsValidationError, match="exceeds maximum"):
            validate_numeric_bounds(150, min_val=1, max_val=100)

        with pytest.raises(BoundsValidationError, match="less than minimum"):
            validate_numeric_bounds(0, min_val=1, max_val=100)

    # --------------------------------------------------------------------------
    # 12. Pagination Bounds
    # --------------------------------------------------------------------------
    def test_pagination_bounds(self):
        defaults = validate_pagination({})
        assert defaults["page"] == 1
        assert defaults["pageSize"] == 25
        assert defaults["offset"] == 0

        paged = validate_pagination({"page": 3, "pageSize": 50})
        assert paged["page"] == 3
        assert paged["pageSize"] == 50
        assert paged["offset"] == 100

        with pytest.raises(BoundsValidationError, match="less than minimum"):
            validate_pagination({"page": 0})

        with pytest.raises(BoundsValidationError, match="exceeds maximum"):
            validate_pagination({"pageSize": 1000})
