from dataclasses import dataclass
from typing import Optional

@dataclass
class ConfigFinding:
    file: str
    line_start: int
    line_end: int
    scope_id: str
    setting: str
    declared_value: Optional[str]
    effective_value: str
    value_source: str  # 'declared', 'inherited', 'inferred_default'
    evidence_tier: str  # e.g., 'primary', 'secondary', etc.
