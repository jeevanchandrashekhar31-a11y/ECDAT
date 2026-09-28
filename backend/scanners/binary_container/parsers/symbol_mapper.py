import json
import re
from pathlib import Path
from typing import List, Dict, Any, Optional

from scanners.binary_container.parsers.base import SymbolMetadata, CustomCryptoImplementation

DEFAULT_MAPPING_PATH = Path(__file__).resolve().parents[4] / "rules" / "crypto_symbol_mapping.json"

class SymbolMapper:
    def __init__(self, rules_path: Optional[str] = None):
        path = Path(rules_path) if rules_path else DEFAULT_MAPPING_PATH
        if not path.exists():
            alt_path = Path.cwd() / "rules" / "crypto_symbol_mapping.json"
            if alt_path.exists():
                path = alt_path
                
        self.rules = []
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for r in data.get("symbol_rules", []):
                        self.rules.append({
                            "pattern": re.compile(r["pattern"], re.IGNORECASE),
                            "algorithm": r.get("algorithm", "Unknown"),
                            "primitive": r.get("primitive", "Unknown"),
                            "confidence": r.get("confidence", "medium"),
                            "library": r.get("library", "Unknown")
                        })
            except Exception as e:
                import logging
                logging.warning(f"Failed to load symbol mapping rules: {e}")
                
    def map_symbols(self, symbols: List[SymbolMetadata]) -> List[CustomCryptoImplementation]:
        results = []
        seen = set()
        for sym in symbols:
            name = sym.name
            for rule in self.rules:
                match = rule["pattern"].search(name)
                if match:
                    # Resolve backreferences like $1
                    algo = rule["algorithm"]
                    if "$" in algo:
                        for i, group in enumerate(match.groups(), start=1):
                            algo = algo.replace(f"${i}", group.upper() if group else "")
                            
                    key = f"{algo}-{rule['primitive']}"
                    if key not in seen:
                        seen.add(key)
                        results.append(CustomCryptoImplementation(
                            algorithm=algo,
                            primitive=rule["primitive"],
                            confidence=rule["confidence"],
                            offsets=[],  # Symbol imports typically don't have a reliable offset in this context
                            evidence_type=f"symbol_mapping:{name}"
                        ))
        return results
