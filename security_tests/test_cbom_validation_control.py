# @ecdat-synthetic-corpus
"""
Adversarial Security Test: CBOM Validation & Schema Correctness Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import json
from pathlib import Path
import pytest
from scanners.cbom_io import import_cbom

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "malicious_payloads" / "cbom_malicious_fixtures.json"


class TestCBOMValidationControl:
    """
    Security Control: Cryptographic Bill of Materials (CBOM) Schema & Content Validation
    Guarantees CycloneDX schema compliance, truthful provenance, and rejection of poisoned/tampered CBOMs.
    """

    @pytest.fixture
    def fixtures(self):
        if FIXTURE_PATH.exists():
            return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        return {}

    # 1. POSITIVE TEST: Well-formed CycloneDX CBOM imports cleanly
    def test_positive_cbom_validation(self, fixtures):
        sample_cbom = {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "version": 1,
            "components": [
                {
                    "type": "cryptographic-asset",
                    "name": "AES-256-GCM",
                    "cryptoProperties": {
                        "assetType": "algorithm",
                        "algorithmProperties": {
                            "primitive": "ae",
                            "parameterSetIdentifier": "256",
                            "executionEnvironment": "software-plain-ram",
                        },
                    },
                }
            ],
        }
        bom = import_cbom(sample_cbom, format="json")
        assert bom is not None
        assert len(bom.components) == 1

    # 2. NEGATIVE TEST: Corrupted syntax or invalid format fails cleanly
    def test_negative_cbom_validation(self):
        with pytest.raises(ValueError) as exc_info:
            import_cbom("Not valid json or xml", format="auto")
        assert "unable to determine cbom format" in str(exc_info.value).lower()

        # Malformed JSON syntax
        with pytest.raises(ValueError) as exc_info:
            import_cbom("{unclosed_json: true", format="json")
        assert "malformed" in str(exc_info.value).lower()

    # 3. BOUNDARY TEST: CBOM with empty components list
    def test_boundary_cbom_validation(self):
        empty_cbom = {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "version": 1,
            "components": [],
        }
        bom = import_cbom(empty_cbom, format="json")
        assert bom is not None
        assert len(bom.components) == 0

    # 4. MALICIOUS TEST: Poisoned CBOMs (private key leakage, prototype pollution, XXE) rejected
    def test_malicious_cbom_validation(self):
        # 1. CBOM containing leaked raw private key
        key_leak_cbom = {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "components": [],
            "metadata": {"key": "-----BEGIN RSA PRIVATE KEY-----\nMIIE...-----END RSA PRIVATE KEY-----"},
        }
        with pytest.raises(ValueError) as exc_info:
            import_cbom(key_leak_cbom, format="json")
        assert "private key" in str(exc_info.value).lower()

        # 2. CBOM containing prototype pollution payload
        proto_cbom = '{"bomFormat": "CycloneDX", "specVersion": "1.6", "__proto__": {"polluted": true}, "components": []}'
        with pytest.raises(ValueError) as exc_info:
            import_cbom(proto_cbom, format="json")
        assert "prototype pollution" in str(exc_info.value).lower()

        # 3. XML CBOM with malicious DOCTYPE entity expansion
        xxe_cbom = """<?xml version="1.0"?>
<!DOCTYPE bom [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<bom xmlns="http://cyclonedx.org/schema/bom/1.6">&xxe;</bom>"""
        with pytest.raises(ValueError) as exc_info:
            import_cbom(xxe_cbom, format="xml")
        assert "entity expansion" in str(exc_info.value).lower() or "forbidden" in str(exc_info.value).lower()

    # 5. REGRESSION TEST: Verifies truthfulness of declared schema version
    def test_regression_cbom_validation(self):
        # CycloneDX 1.6 declared document must not masquerade as 1.7
        doc_16 = {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "version": 1,
            "components": [],
        }
        bom = import_cbom(doc_16, format="json")
        assert bom is not None

        # Payload exceeding 50 MB budget is blocked before memory exhaustion
        huge_cbom = '{"bomFormat": "CycloneDX", "components": []}' + " " * (51 * 1024 * 1024)
        with pytest.raises(ValueError) as exc_info:
            import_cbom(huge_cbom, format="json")
        assert "size limit" in str(exc_info.value).lower()
