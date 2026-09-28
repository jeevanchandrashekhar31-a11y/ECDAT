
from typing import Any

class CoverageReport(BaseModel):
    files_discovered: int = 0
    files_scanned: int = 0
    files_skipped: Dict[str, int] = Field(default_factory=dict)
    parser_success_rate: Dict[str, float] = Field(default_factory=dict)
    parse_errors: List[str] = Field(default_factory=list)
    truncation_notices: List[str] = Field(default_factory=list)
    rules_loaded: int = 0
    ecdat_version: str = "3.0"
    rule_pack_hash: str = ""

class ScanResult(BaseModel):
    assets: List[Any] = Field(default_factory=list)
    findings: List[Any] = Field(default_factory=list)
    coverage: Optional[CoverageReport] = None
