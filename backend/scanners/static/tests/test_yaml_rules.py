import os
import tempfile
import yaml
import pytest
from scanners.static.parsers.yaml_rules import YAMLRuleLoader

def test_load_valid_rule_pack():
    with tempfile.TemporaryDirectory() as tmpdir:
        lang_dir = os.path.join(tmpdir, "java")
        os.makedirs(lang_dir)
        rule_content = {
            "id": "crypto-java-aes-cbc",
            "api_symbols": ["javax.crypto.Cipher.getInstance"],
            "arg_extractors": {"0": "transformation_string"},
            "algorithm_mapping": {
                "primitive": "AES",
                "mode": "CBC"
            },
            "key_size_rule": "lookup_key_gen",
            "default_confidence": "high"
        }
        with open(os.path.join(lang_dir, "aes.yaml"), "w") as f:
            yaml.dump(rule_content, f)

        loader = YAMLRuleLoader(rules_dir=tmpdir)
        rules = loader.load_rules("java")
        
        assert len(rules) == 1
        rule = rules[0]
        assert rule.id == "crypto-java-aes-cbc"
        assert "javax.crypto.Cipher.getInstance" in rule.api_symbols
        assert rule.arg_extractors["0"] == "transformation_string"
        assert rule.algorithm_mapping["primitive"] == "AES"

def test_load_invalid_rule_pack():
    with tempfile.TemporaryDirectory() as tmpdir:
        lang_dir = os.path.join(tmpdir, "java")
        os.makedirs(lang_dir)
        rule_content = {
            "id": "missing-fields",
            # missing api_symbols and algorithm_mapping
        }
        with open(os.path.join(lang_dir, "bad.yaml"), "w") as f:
            yaml.dump(rule_content, f)

        loader = YAMLRuleLoader(rules_dir=tmpdir)
        with pytest.raises(ValueError, match="Missing required fields"):
            loader.load_rules("java")
