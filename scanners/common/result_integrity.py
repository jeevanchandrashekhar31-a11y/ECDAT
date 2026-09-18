"""
ECDAT Scanner Result Integrity & Provenance Engine (Phase 24 - P1)

Enforces strict 6-state discovery outcome categorization:
1. FOUND: Item scanned, positive cryptographic finding(s) or vulnerability discovered with provenance.
2. NOT_FOUND: Item scanned and affirmatively inspected; zero findings detected.
3. NOT_SCANNED: Item skipped, omitted, filtered out by rule/quota/boundary, or never reached.
4. SCAN_ERROR: Scanner encountered execution failure, parser exception, permission error, or crash.
5. UNSUPPORTED: Target, file format, language, or protocol recognized but unsupported by scanner.
6. UNKNOWN: Analysis outcome is indeterminate, unresolvable, or ambiguous.

CRITICAL ANTI-COLLAPSE INVARIANTS:
- NEVER collapse NOT_SCANNED into NOT_FOUND.
- NEVER collapse ERROR / SCAN_ERROR into CLEAN.
- Every finding MUST include sufficient provenance to reproduce why it was detected.
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple


class ResultState(str, Enum):
    FOUND = "FOUND"
    NOT_FOUND = "NOT_FOUND"
    NOT_SCANNED = "NOT_SCANNED"
    SCAN_ERROR = "SCAN_ERROR"
    UNSUPPORTED = "UNSUPPORTED"
    UNKNOWN = "UNKNOWN"


CANONICAL_STATES: Set[str] = {s.value for s in ResultState}

ABSENCE_DISCLAIMER: str = (
    "Absence of findings on scanned targets is NOT proof that no cryptographic assets "
    "or vulnerabilities exist across unscanned, skipped, or unsupported components."
)


class ResultIntegrityViolation(Exception):
    """Raised when scanner result integrity rules or anti-collapse invariants are violated."""
    pass


def validate_result_state(state: str) -> ResultState:
    """Validates that a status string belongs strictly to the 6 canonical states."""
    upper = str(state).strip().upper()
    if upper not in CANONICAL_STATES:
        raise ResultIntegrityViolation(
            f"Invalid scanner result state: '{state}'. Must be one of: {sorted(list(CANONICAL_STATES))}"
        )
    return ResultState(upper)


def assert_no_illegal_collapse(reported_state: str, actual_condition: str, context: str = "") -> None:
    """
    Guarantees strict anti-collapse invariants:
    - Never collapse NOT_SCANNED into NOT_FOUND.
    - Never collapse ERROR / SCAN_ERROR into CLEAN.
    - Never collapse UNSUPPORTED into NOT_FOUND.
    """
    rep = str(reported_state).strip().upper()
    act = str(actual_condition).strip().upper()
    ctx = f" (context: {context})" if context else ""

    # Invariant 1: Never collapse NOT_SCANNED into NOT_FOUND
    if act in ("NOT_SCANNED", "SKIPPED", "EXCLUDED", "OVERSIZED", "TIMEOUT") and rep in ("NOT_FOUND", "CLEAN", "EMPTY"):
        raise ResultIntegrityViolation(
            f"CRITICAL INTEGRITY VIOLATION: '{act}' was illegally collapsed into '{rep}'{ctx}. "
            f"Unscanned items must strictly be classified as NOT_SCANNED."
        )

    # Invariant 2: Never collapse ERROR / SCAN_ERROR into CLEAN
    if act in ("SCAN_ERROR", "ERROR", "CRASH", "PARSER_FAILURE", "PERMISSION_DENIED") and rep in ("CLEAN", "NOT_FOUND", "SUCCESS", "PASSED", "ALLOW"):
        raise ResultIntegrityViolation(
            f"CRITICAL INTEGRITY VIOLATION: '{act}' was illegally collapsed into '{rep}'{ctx}. "
            f"Scanner errors must fail closed and never be presented as clean."
        )

    # Invariant 3: Never collapse UNSUPPORTED into NOT_FOUND
    if act in ("UNSUPPORTED", "UNKNOWN_LANGUAGE", "UNRECOGNIZED_FORMAT") and rep in ("NOT_FOUND", "CLEAN"):
        raise ResultIntegrityViolation(
            f"CRITICAL INTEGRITY VIOLATION: '{act}' was illegally collapsed into '{rep}'{ctx}. "
            f"Unsupported targets must strictly be classified as UNSUPPORTED."
        )


@dataclass
class FindingProvenance:
    """
    Sufficient provenance to reproduce why a finding was detected.
    """
    location: str  # File path or host:port
    line_number: Optional[int] = None
    column_number: Optional[int] = None
    snippet: str = ""  # Sanitized code excerpt or network packet context
    detection_method: str = "ast"  # ast, regex, runtime_hook, network_handshake, package_manifest
    rule_id: str = "ECDAT-GENERIC"  # Specific rule, heuristic, or signature
    algorithm_or_asset: str = "UNKNOWN"
    confidence: str = "high"  # high, medium, low
    tool_name: str = "ECDAT Scanner"
    tool_version: str = "1.0.0"
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    reproducibility_context: Dict[str, Any] = field(default_factory=dict)

    def validate(self) -> Tuple[bool, List[str]]:
        """Validates that provenance is complete and sufficient for reproduction."""
        errors: List[str] = []
        if not self.location or self.location.strip() in ("", "unknown", "none"):
            errors.append("Provenance requires an auditable physical location (file:line or host:port).")
        if not self.detection_method or self.detection_method.strip() in ("", "unknown"):
            errors.append("Provenance requires a concrete detection_method (e.g. ast, regex, runtime_hook).")
        if not self.rule_id or self.rule_id.strip() in ("", "unknown", "TODO"):
            errors.append("Provenance requires an identifiable rule_id or signature name.")
        if not self.tool_name or self.tool_name.strip() in ("", "unknown"):
            errors.append("Provenance requires identifying the detecting tool name.")
        return len(errors) == 0, errors


@dataclass
class ItemResultRecord:
    """Item-level discovery record representing a single file, endpoint, or target."""
    item_id: str
    target: str
    status: ResultState
    reasons: List[str] = field(default_factory=list)
    findings: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ResultIntegrityTracker:
    """
    Maintains rigorous item-level audit accounting across all 6 discovery states.
    Prevents false negatives, illegal collapse, and silent failures.
    """

    def __init__(self, scanner_name: str = "ECDAT Scanner"):
        self.scanner_name = scanner_name
        self.records: List[ItemResultRecord] = []
        self._item_ids_seen: Set[str] = set()

    def record_found(
        self,
        item_id: str,
        target: str,
        findings: List[Dict[str, Any]],
        provenance_list: Optional[List[FindingProvenance]] = None,
        reasons: Optional[List[str]] = None,
    ) -> ItemResultRecord:
        """Records an item affirmatively scanned with positive cryptographic findings."""
        if not findings:
            raise ResultIntegrityViolation(f"Cannot record FOUND for item '{item_id}' with zero findings.")

        # Validate provenance on every finding
        if provenance_list:
            for prov in provenance_list:
                valid, errs = prov.validate()
                if not valid:
                    raise ResultIntegrityViolation(f"Insufficient provenance on finding for '{item_id}': {'; '.join(errs)}")

        rec = ItemResultRecord(
            item_id=item_id,
            target=target,
            status=ResultState.FOUND,
            reasons=reasons or [f"{len(findings)} cryptographic finding(s) detected"],
            findings=findings,
        )
        self.records.append(rec)
        self._item_ids_seen.add(item_id)
        return rec

    def record_not_found(
        self,
        item_id: str,
        target: str,
        reasons: Optional[List[str]] = None,
    ) -> ItemResultRecord:
        """Records an item affirmatively scanned and verified clean of findings."""
        rec = ItemResultRecord(
            item_id=item_id,
            target=target,
            status=ResultState.NOT_FOUND,
            reasons=reasons or ["Target thoroughly inspected; zero cryptographic findings detected"],
        )
        self.records.append(rec)
        self._item_ids_seen.add(item_id)
        return rec

    def record_not_scanned(
        self,
        item_id: str,
        target: str,
        reason: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> ItemResultRecord:
        """
        Records an item skipped, filtered out, or omitted.
        Strictly guarded against collapsing into NOT_FOUND.
        """
        assert_no_illegal_collapse(ResultState.NOT_SCANNED.value, "NOT_SCANNED", context=item_id)
        rec = ItemResultRecord(
            item_id=item_id,
            target=target,
            status=ResultState.NOT_SCANNED,
            reasons=[f"SKIPPED: {reason}"],
            metadata=details or {},
        )
        self.records.append(rec)
        self._item_ids_seen.add(item_id)
        return rec

    def record_scan_error(
        self,
        item_id: str,
        target: str,
        error: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> ItemResultRecord:
        """
        Records a scanner execution, parsing, or I/O failure.
        Strictly guarded against collapsing into CLEAN.
        """
        assert_no_illegal_collapse(ResultState.SCAN_ERROR.value, "SCAN_ERROR", context=item_id)
        rec = ItemResultRecord(
            item_id=item_id,
            target=target,
            status=ResultState.SCAN_ERROR,
            reasons=[f"ERROR: {error}"],
            errors=[error],
            metadata=details or {},
        )
        self.records.append(rec)
        self._item_ids_seen.add(item_id)
        return rec

    def record_unsupported(
        self,
        item_id: str,
        target: str,
        reason: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> ItemResultRecord:
        """Records a file or protocol format recognized but unsupported by scanner."""
        assert_no_illegal_collapse(ResultState.UNSUPPORTED.value, "UNSUPPORTED", context=item_id)
        rec = ItemResultRecord(
            item_id=item_id,
            target=target,
            status=ResultState.UNSUPPORTED,
            reasons=[f"UNSUPPORTED: {reason}"],
            metadata=details or {},
        )
        self.records.append(rec)
        self._item_ids_seen.add(item_id)
        return rec

    def record_unknown(
        self,
        item_id: str,
        target: str,
        reason: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> ItemResultRecord:
        """Records an indeterminate analysis state."""
        rec = ItemResultRecord(
            item_id=item_id,
            target=target,
            status=ResultState.UNKNOWN,
            reasons=[f"UNKNOWN: {reason}"],
            metadata=details or {},
        )
        self.records.append(rec)
        self._item_ids_seen.add(item_id)
        return rec

    def get_summary(self) -> Dict[str, Any]:
        """
        Returns an audited, non-collapsing 6-state summary of the scan.
        Guarantees overall verdict cannot be CLEAN if errors or unscanned items exist.
        """
        counts = {s.value: 0 for s in ResultState}
        total_findings = 0

        for r in self.records:
            counts[r.status.value] += 1
            total_findings += len(r.findings)

        total_items = len(self.records)

        # Determine overall verdict with strict integrity rules
        if counts[ResultState.SCAN_ERROR.value] > 0:
            overall_verdict = "SCAN_ERROR"
            clean_certified = False
        elif counts[ResultState.FOUND.value] > 0:
            overall_verdict = "FINDINGS_DETECTED"
            clean_certified = False
        elif counts[ResultState.NOT_SCANNED.value] > 0 or counts[ResultState.UNSUPPORTED.value] > 0 or counts[ResultState.UNKNOWN.value] > 0:
            overall_verdict = "PARTIAL_ASSESSMENT"
            clean_certified = False
        elif counts[ResultState.NOT_FOUND.value] > 0 and total_items == counts[ResultState.NOT_FOUND.value]:
            overall_verdict = "CLEAN"
            clean_certified = True
        else:
            overall_verdict = "EMPTY"
            clean_certified = False

        return {
            "scanner_name": self.scanner_name,
            "total_items": total_items,
            "total_findings": total_findings,
            "states": counts,
            "found_count": counts[ResultState.FOUND.value],
            "not_found_count": counts[ResultState.NOT_FOUND.value],
            "not_scanned_count": counts[ResultState.NOT_SCANNED.value],
            "scan_error_count": counts[ResultState.SCAN_ERROR.value],
            "unsupported_count": counts[ResultState.UNSUPPORTED.value],
            "unknown_count": counts[ResultState.UNKNOWN.value],
            "overall_verdict": overall_verdict,
            "clean_certified": clean_certified,
            "absence_of_finding_disclaimer": ABSENCE_DISCLAIMER if not clean_certified else "",
            "anti_collapse_verified": True,
        }
