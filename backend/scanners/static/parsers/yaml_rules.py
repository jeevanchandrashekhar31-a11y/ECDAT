import os
import yaml
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional

@dataclass
class YAMLRule:
    id: str
    api_symbols: List[str]
    algorithm_mapping: Dict[str, str]
    arg_extractors: Dict[str, str] = field(default_factory=dict)
    key_size_rule: Optional[str] = None
    default_confidence: str = "medium"
    standards_refs: List[str] = field(default_factory=list)

class YAMLRuleLoader:
    def __init__(self, rules_dir: str):
        self.rules_dir = rules_dir

    def load_rules(self, language: str) -> List[YAMLRule]:
        lang_dir = os.path.join(self.rules_dir, language)
        if not os.path.exists(lang_dir):
            return []

        rules = []
        for filename in os.listdir(lang_dir):
            if filename.endswith(".yaml") or filename.endswith(".yml"):
                filepath = os.path.join(lang_dir, filename)
                with open(filepath, "r") as f:
                    try:
                        content = yaml.safe_load(f)
                    except yaml.YAMLError as e:
                        raise ValueError(f"Invalid YAML in {filepath}: {e}")

                    if not isinstance(content, dict):
                        raise ValueError(f"Rule file {filepath} must contain a dictionary")

                    if "id" not in content or "api_symbols" not in content or "algorithm_mapping" not in content:
                        raise ValueError(f"Missing required fields in {filepath}. Required: id, api_symbols, algorithm_mapping")

                    rules.append(YAMLRule(
                        id=content["id"],
                        api_symbols=content["api_symbols"],
                        algorithm_mapping=content["algorithm_mapping"],
                        arg_extractors=content.get("arg_extractors", {}),
                        key_size_rule=content.get("key_size_rule"),
                        default_confidence=content.get("default_confidence", "medium"),
                        standards_refs=content.get("standards_refs", [])
                    ))
        return rules
