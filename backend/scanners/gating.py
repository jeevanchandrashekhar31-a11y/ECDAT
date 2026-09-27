"""Shared CI gate helpers for scanner CLIs.

Scanner output is intentionally written before these helpers are consulted so a
failed gate never hides the CBOM/SARIF evidence that caused it.
"""

from typing import Iterable, List, Tuple


VALID_FAIL_ON = ("none", "critical", "high", "mosca-risk")


def static_finding_severity(finding) -> str:
    """Return the deterministic pre-risk-engine severity for a static finding."""
    explicit = getattr(finding, "severity", None)
    if explicit:
        return str(explicit).lower()

    algorithm = str(getattr(finding, "algorithm", "")).upper()
    finding_type = str(getattr(finding, "finding_type", "")).lower()
    if finding_type == "hardcoded_key" or algorithm in {"MD5", "DES", "RC2", "RC4", "ECB_MODE"}:
        return "critical"
    if algorithm in {"SHA-1", "SHA1", "3DES", "SYMMETRIC_KEY"}:
        return "high"
    return "informational"


def evaluate_static_gate(findings: Iterable, fail_on: str) -> Tuple[bool, List[str]]:
    """Evaluate scanner-local gates.

    Mosca status is calculated by the backend risk engine, not inferred by a
    source scanner.  Consequently a static-only scan has no Mosca-risk result
    and cannot trip that gate; use ``import_cbom.js`` for that final gate.
    """
    if fail_on not in VALID_FAIL_ON:
        raise ValueError(f"Unsupported --fail-on value '{fail_on}'. Choose from: {', '.join(VALID_FAIL_ON)}")
    if fail_on in ("none", "mosca-risk"):
        return False, []

    minimum = {"critical": 2, "high": 1}[fail_on]
    rank = {"critical": 2, "high": 1}
    matches = []
    for finding in findings:
        severity = static_finding_severity(finding)
        if rank.get(severity, 0) >= minimum:
            matches.append(
                f"{severity.upper()} {getattr(finding, 'rule_id', 'unknown')} "
                f"at {getattr(finding, 'file_path', 'unknown')}:{getattr(finding, 'line_number', '?')}"
            )
    return bool(matches), matches
