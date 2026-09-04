from pydantic import BaseModel
from typing import Optional


class StaticFinding(BaseModel):
    file_path: str
    line_number: int
    rule_id: str
    algorithm: str
    evidence: str
    confidence: str
    finding_type: str
    severity: Optional[str] = None
    analysis_source: str = "regex"
    needs_human_review: bool = False
    reason: Optional[str] = None

    def to_dict(self):
        return {
            "file_path": self.file_path,
            "line_number": self.line_number,
            "rule_id": self.rule_id,
            "algorithm": self.algorithm,
            "evidence": self.evidence,
            "confidence": self.confidence,
            "finding_type": self.finding_type,
            "severity": self.severity,
            "analysis_source": self.analysis_source,
            "needs_human_review": self.needs_human_review,
            "reason": self.reason,
        }
