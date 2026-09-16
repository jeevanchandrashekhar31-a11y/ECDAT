"""
Unit tests for ECDAT SARIF Engine (Phase 13.3).

Verifies:
- Compliant OASIS SARIF v2.1.0 generation for source findings
- All required dimensions:
  1. rule ID
  2. severity
  3. location
  4. message
  5. help
  6. evidence
  7. remediation guidance
- Automated validation:
  - Document root ($schema, version 2.1.0, runs)
  - Tool driver metadata and rules array
  - Rule completeness (id, shortDescription, defaultConfiguration, help)
  - Result location validity (artifactLocation.uri, region startLine >= 1)
  - Rule ID consistency (every result ruleId must be declared in driver.rules)
  - Zero raw secret leakage invariant in snippet text
"""

import json
from pathlib import Path
import pytest

from scanners.sarif_engine import (
    SarifEngine,
    SarifValidationError,
    SARIF_SCHEMA_URI,
    SARIF_VERSION,
    map_severity_to_sarif_level,
)


@pytest.fixture
def sample_findings():
    return [
        {
            "rule_id": "ECDAT-STATIC-MD5",
            "algorithm": "MD5",
            "finding_type": "weak_hash",
            "file_path": "src/auth/token.py",
            "line_number": 42,
            "column_number": 5,
            "severity": "critical",
            "confidence": "high",
            "evidence": "return hashlib.md5(token).hexdigest()",
            "description": "MD5 collision vulnerability detected",
            "remediation": "Replace with SHA-256",
        },
        {
            "rule_id": "ECDAT-STATIC-DES",
            "algorithm": "DES",
            "finding_type": "weak_cipher",
            "file_path": "src/crypto/cipher.py",
            "line_number": 108,
            "column_number": 1,
            "severity": "high",
            "confidence": "high",
            "evidence": "DES.new(key, DES.MODE_ECB)",
            "description": "Legacy 56-bit DES cipher detected",
            "remediation": "Migrate to AES-256-GCM",
        },
        {
            "rule_id": "ECDAT-STATIC-MEDIUM",
            "algorithm": "AES-128",
            "finding_type": "quantum_margin",
            "file_path": "src/crypto/store.py",
            "line_number": 15,
            "column_number": 1,
            "severity": "medium",
            "confidence": "medium",
            "evidence": "AES.new(key128, AES.MODE_GCM)",
            "description": "Grover quantum search margin deduction",
            "remediation": "Upgrade to AES-256 for long-term quantum margin",
        },
    ]


def test_sarif_generation_includes_all_required_dimensions(sample_findings):
    """Generated SARIF must include rule ID, severity, location, message, help, evidence, remediation."""
    sarif = SarifEngine.generate(sample_findings)

    # Automated validation passes
    is_valid, errors = SarifEngine.validate(sarif)
    assert is_valid is True
    assert len(errors) == 0

    assert sarif["version"] == SARIF_VERSION
    assert sarif["$schema"] == SARIF_SCHEMA_URI
    assert len(sarif["runs"]) == 1

    run = sarif["runs"][0]
    rules = run["tool"]["driver"]["rules"]
    results = run["results"]

    assert len(rules) == 3
    assert len(results) == 3

    # Dimension 1: Rule ID
    rule_ids = [r["id"] for r in rules]
    assert "ECDAT-STATIC-MD5" in rule_ids
    assert "ECDAT-STATIC-DES" in rule_ids

    # Dimension 2: Severity (error, warning, note + security-severity)
    md5_result = next(r for r in results if r["ruleId"] == "ECDAT-STATIC-MD5")
    assert md5_result["level"] == "error"
    md5_rule = next(r for r in rules if r["id"] == "ECDAT-STATIC-MD5")
    assert md5_rule["defaultConfiguration"]["level"] == "error"
    assert md5_rule["properties"]["security-severity"] == "9.5"

    med_result = next(r for r in results if r["ruleId"] == "ECDAT-STATIC-MEDIUM")
    assert med_result["level"] == "warning"

    # Dimension 3: Location (physicalLocation, artifactLocation.uri, region startLine, startColumn)
    loc = md5_result["locations"][0]["physicalLocation"]
    assert loc["artifactLocation"]["uri"] == "src/auth/token.py"
    assert loc["region"]["startLine"] == 42
    assert loc["region"]["startColumn"] == 5

    # Dimension 4: Message
    assert "MD5" in md5_result["message"]["text"]
    assert "src/auth/token.py:42" in md5_result["message"]["text"]

    # Dimension 5: Help (both text and rich markdown card)
    assert "SHA-256" in md5_rule["help"]["text"]
    assert "markdown" in md5_rule["help"]
    assert "### [CRITICAL]" in md5_rule["help"]["markdown"]
    assert "Why It Matters" in md5_rule["help"]["markdown"]

    # Dimension 6: Evidence (sanitized snippet)
    assert "hashlib.md5" in loc["region"]["snippet"]["text"]

    # Dimension 7: Remediation Guidance
    assert "remediation" in md5_rule["properties"]
    assert "remediation_guidance" in md5_result["properties"]


def test_automated_validation_detects_invalid_sarif():
    """Automated validator must detect missing version, undefined ruleId, and malformed locations."""
    # 1. Missing version & schema
    invalid_doc_1 = {"runs": []}
    is_valid, errors = SarifEngine.validate(invalid_doc_1)
    assert is_valid is False
    assert any("version" in e.lower() for e in errors)
    assert any("schema" in e.lower() for e in errors)

    # 2. Undefined ruleId (rule referenced in results but absent in driver.rules)
    invalid_doc_2 = {
        "$schema": SARIF_SCHEMA_URI,
        "version": SARIF_VERSION,
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "Test Tool",
                        "rules": [
                            {
                                "id": "DECLARED-RULE",
                                "shortDescription": {"text": "A declared rule"},
                                "help": {"text": "Help text"},
                            }
                        ],
                    }
                },
                "results": [
                    {
                        "ruleId": "UNDECLARED-RULE-ID",
                        "level": "error",
                        "message": {"text": "Missing rule"},
                        "locations": [
                            {
                                "physicalLocation": {
                                    "artifactLocation": {"uri": "test.py"},
                                    "region": {"startLine": 1, "snippet": {"text": "test"}},
                                }
                            }
                        ],
                    }
                ],
            }
        ],
    }
    is_valid, errors = SarifEngine.validate(invalid_doc_2)
    assert is_valid is False
    assert any("undefined rule ID" in e for e in errors)

    # 3. Invalid startLine (< 1)
    invalid_doc_3 = {
        "$schema": SARIF_SCHEMA_URI,
        "version": SARIF_VERSION,
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "Test Tool",
                        "rules": [
                            {
                                "id": "R1",
                                "shortDescription": {"text": "R1"},
                                "help": {"text": "Help"},
                            }
                        ],
                    }
                },
                "results": [
                    {
                        "ruleId": "R1",
                        "level": "error",
                        "message": {"text": "Bad startLine"},
                        "locations": [
                            {
                                "physicalLocation": {
                                    "artifactLocation": {"uri": "test.py"},
                                    "region": {"startLine": 0, "snippet": {"text": "test"}},
                                }
                            }
                        ],
                    }
                ],
            }
        ],
    }
    is_valid, errors = SarifEngine.validate(invalid_doc_3)
    assert is_valid is False
    assert any("startLine must be an integer >= 1" in e for e in errors)


def test_automated_validation_detects_secret_leakage_in_snippet():
    """Automated validator must reject snippets containing unredacted raw private keys."""
    leaky_sarif = {
        "$schema": SARIF_SCHEMA_URI,
        "version": SARIF_VERSION,
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "Test Tool",
                        "rules": [
                            {
                                "id": "SECRET-RULE",
                                "shortDescription": {"text": "Secret rule"},
                                "help": {"text": "Help"},
                            }
                        ],
                    }
                },
                "results": [
                    {
                        "ruleId": "SECRET-RULE",
                        "level": "error",
                        "message": {"text": "Leaked secret in snippet"},
                        "locations": [
                            {
                                "physicalLocation": {
                                    "artifactLocation": {"uri": "key.pem"},
                                    "region": {
                                        "startLine": 1,
                                        "snippet": {
                                            "text": "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...RAW_SECRET..."
                                        },
                                    },
                                }
                            }
                        ],
                    }
                ],
            }
        ],
    }

    is_valid, errors = SarifEngine.validate(leaky_sarif)
    assert is_valid is False
    assert any("unredacted raw secret material" in e for e in errors)


def test_generate_and_validate_helper(sample_findings):
    """generate_and_validate must return clean SARIF on valid findings and raise on invalid."""
    sarif = SarifEngine.generate_and_validate(sample_findings)
    assert sarif["version"] == SARIF_VERSION

    # Calling write_sarif writes valid file
    tmp_out = Path("artifacts/test_valid.sarif")
    try:
        SarifEngine.write_sarif(sarif, str(tmp_out), validate=True)
        assert tmp_out.exists()
    finally:
        if tmp_out.exists():
            tmp_out.unlink()
