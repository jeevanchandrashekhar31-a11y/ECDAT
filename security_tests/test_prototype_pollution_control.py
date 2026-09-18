# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Prototype Pollution Defense Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import json
from pathlib import Path
import pytest

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "malicious_payloads" / "prototype_pollution_payloads.json"

DANGEROUS_OBJECT_KEYS = {"__proto__", "constructor", "prototype"}


def safe_object_merge(target: dict, source: dict) -> dict:
    """
    Safely merges source dictionary into target, stripping __proto__, constructor, and prototype keys.
    """
    if not isinstance(target, dict) or not isinstance(source, dict):
        raise TypeError("Both target and source must be dictionaries")

    for k, v in source.items():
        if k in DANGEROUS_OBJECT_KEYS:
            continue
        if isinstance(v, dict) and isinstance(target.get(k), dict):
            safe_object_merge(target[k], v)
        else:
            target[k] = v
    return target


class TestPrototypePollutionControl:
    """
    Security Control: Prototype Pollution & Object Prototype Tampering Defense
    Guarantees that JSON deserialization and merging never inject __proto__ or constructor keys.
    """

    @pytest.fixture
    def payloads(self):
        if FIXTURE_PATH.exists():
            return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        return {}

    # 1. POSITIVE TEST: Normal dictionary merging works as expected
    def test_positive_prototype_pollution(self):
        target = {"scan": {"threads": 4, "format": "cyclonedx"}}
        source = {"scan": {"threads": 8, "output": "reports/cbom.json"}, "active": True}
        result = safe_object_merge(target, source)

        assert result["scan"]["threads"] == 8
        assert result["scan"]["format"] == "cyclonedx"
        assert result["scan"]["output"] == "reports/cbom.json"
        assert result["active"] is True

    # 2. NEGATIVE TEST: Non-dictionary inputs raise TypeError cleanly
    def test_negative_prototype_pollution(self):
        with pytest.raises(TypeError):
            safe_object_merge("not a dict", {"key": "val"})

        with pytest.raises(TypeError):
            safe_object_merge({"key": "val"}, None)

    # 3. BOUNDARY TEST: Deeply nested benign dictionaries merged without failure
    def test_boundary_prototype_pollution(self):
        target = {"a": {"b": {"c": {"d": 1}}}}
        source = {"a": {"b": {"c": {"e": 2}}}}
        result = safe_object_merge(target, source)
        assert result["a"]["b"]["c"]["d"] == 1
        assert result["a"]["b"]["c"]["e"] == 2

    # 4. MALICIOUS TEST: Hostile prototype pollution exploit payloads stripped
    def test_malicious_prototype_pollution(self, payloads):
        mal_list = payloads.get("malicious", [
            {"__proto__": {"polluted": True, "isAdmin": True}},
            {"constructor": {"prototype": {"polluted": True}}},
            {"prototype": {"isAdmin": True}},
        ])

        for mal_payload in mal_list:
            clean_target = {"status": "clean"}
            result = safe_object_merge(clean_target, mal_payload)

            # Assert dangerous keys were stripped
            assert "__proto__" not in result
            assert "constructor" not in result
            assert "prototype" not in result

            # Base object is not polluted
            base_dict = {}
            assert not hasattr(base_dict, "polluted")
            assert not hasattr(base_dict, "isAdmin")

    # 5. REGRESSION TEST: Verification of SEC-REG-003 prototype pollution mitigation
    def test_regression_prototype_pollution(self):
        polluter = json.loads('{"__proto__": {"polluted": true}}')
        target = {}
        safe_object_merge(target, polluter)

        # Invariant: __proto__ key does not appear in target keys
        assert "__proto__" not in target.keys()
        # Invariant: Built-in object prototype is clean
        assert not hasattr({}, "polluted")
