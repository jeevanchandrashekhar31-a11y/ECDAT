"""
ECDAT Security Regression Policy Engine (Phase 22.4)

Enforces the absolute invariant:
"Never close a security bug without:
 - root cause
 - fix
 - test
 - threat model update
 - release note if applicable"

Provides:
- Schema validation against rules/schemas/security_regression.schema.json
- Physical file and test existence verification
- Gating checks for CI/CD and release pipelines
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import jsonschema

REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass
class RegressionPolicyViolation:
    bug_id: str
    missing_element: str
    description: str


@dataclass
class RegressionPolicyVerdict:
    passed: bool
    total_regressions: int
    verified_regressions: int
    violations: List[RegressionPolicyViolation] = field(default_factory=list)
    summary: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "total_regressions": self.total_regressions,
            "verified_regressions": self.verified_regressions,
            "violations": [
                {
                    "bug_id": v.bug_id,
                    "missing_element": v.missing_element,
                    "description": v.description,
                }
                for v in self.violations
            ],
            "summary": self.summary,
        }


class SecurityRegressionPolicyEngine:
    """
    Validates and enforces the 5-point security bug closure policy.
    """

    MANDATORY_CLOSURE_FIELDS = (
        "root_cause",
        "fix",
        "test",
        "threat_model_update",
        "release_note",
    )

    def __init__(
        self,
        registry_path: Optional[Path] = None,
        schema_path: Optional[Path] = None,
        repo_root: Optional[Path] = None,
    ):
        self.repo_root = (repo_root or REPO_ROOT).resolve()
        self.registry_path = (
            registry_path or (self.repo_root / "rules" / "security_regressions.json")
        ).resolve()
        self.schema_path = (
            schema_path
            or (self.repo_root / "rules" / "schemas" / "security_regression.schema.json")
        ).resolve()

    def load_registry(self) -> Dict[str, Any]:
        if not self.registry_path.exists():
            raise FileNotFoundError(f"Regression registry not found: {self.registry_path}")
        with open(self.registry_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def load_schema(self) -> Dict[str, Any]:
        if not self.schema_path.exists():
            raise FileNotFoundError(f"Regression schema not found: {self.schema_path}")
        with open(self.schema_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def validate_schema(self, registry_data: Optional[Dict[str, Any]] = None) -> List[str]:
        """Validates the regression registry against its JSON schema."""
        data = registry_data or self.load_registry()
        schema = self.load_schema()
        validator = jsonschema.Draft7Validator(schema)
        errors = []
        for error in validator.iter_errors(data):
            path_str = " -> ".join(str(p) for p in error.path)
            errors.append(f"Schema violation at '{path_str}': {error.message}")
        return errors

    def validate_single_entry(self, entry: Dict[str, Any]) -> List[RegressionPolicyViolation]:
        """
        Validates a single security regression record against the 5 mandatory elements.
        """
        bug_id = entry.get("id", "UNKNOWN_BUG")
        violations: List[RegressionPolicyViolation] = []

        # 1. Root Cause verification
        rc = entry.get("root_cause")
        if not rc or not isinstance(rc, dict):
            violations.append(
                RegressionPolicyViolation(bug_id, "root_cause", "Missing root_cause object")
            )
        else:
            if not rc.get("technical_summary") or len(rc.get("technical_summary", "").strip()) < 10:
                violations.append(
                    RegressionPolicyViolation(
                        bug_id, "root_cause.technical_summary", "Insufficient technical root cause description"
                    )
                )
            if not rc.get("cwe_id"):
                violations.append(
                    RegressionPolicyViolation(bug_id, "root_cause.cwe_id", "Missing CWE identifier")
                )

        # 2. Fix verification
        fix = entry.get("fix")
        if not fix or not isinstance(fix, dict):
            violations.append(
                RegressionPolicyViolation(bug_id, "fix", "Missing fix specification object")
            )
        else:
            if not fix.get("fix_summary") or len(fix.get("fix_summary", "").strip()) < 10:
                violations.append(
                    RegressionPolicyViolation(
                        bug_id, "fix.fix_summary", "Insufficient fix summary explanation"
                    )
                )
            if not fix.get("modified_files") or len(fix.get("modified_files", [])) == 0:
                violations.append(
                    RegressionPolicyViolation(
                        bug_id, "fix.modified_files", "No modified files recorded for fix"
                    )
                )

        # 3. Test verification (Must physically exist on disk and define test function)
        test = entry.get("test")
        if not test or not isinstance(test, dict):
            violations.append(
                RegressionPolicyViolation(bug_id, "test", "Missing regression test object")
            )
        else:
            test_file_rel = test.get("test_file")
            test_name = test.get("test_name")

            if not test_file_rel:
                violations.append(
                    RegressionPolicyViolation(bug_id, "test.test_file", "Missing test file path")
                )
            else:
                test_file_abs = self.repo_root / test_file_rel
                if not test_file_abs.exists():
                    violations.append(
                        RegressionPolicyViolation(
                            bug_id,
                            "test.test_file",
                            f"Permanent regression test file does not exist: {test_file_rel}",
                        )
                    )
                elif test_name:
                    # Verify test_name is present inside the test file content
                    try:
                        content = test_file_abs.read_text(encoding="utf-8", errors="replace")
                        if test_name not in content:
                            violations.append(
                                RegressionPolicyViolation(
                                    bug_id,
                                    "test.test_name",
                                    f"Test '{test_name}' not found inside file '{test_file_rel}'",
                                )
                            )
                    except Exception as e:
                        violations.append(
                            RegressionPolicyViolation(
                                bug_id, "test.test_file", f"Unable to read test file: {e}"
                            )
                        )

        # 4. Threat Model Update verification
        tmu = entry.get("threat_model_update")
        if not tmu or not isinstance(tmu, dict):
            violations.append(
                RegressionPolicyViolation(
                    bug_id, "threat_model_update", "Missing threat model update object"
                )
            )
        else:
            if not tmu.get("stride_category") or len(tmu.get("stride_category", [])) == 0:
                violations.append(
                    RegressionPolicyViolation(
                        bug_id, "threat_model_update.stride_category", "Missing STRIDE classification"
                    )
                )
            if not tmu.get("threat_model_section"):
                violations.append(
                    RegressionPolicyViolation(
                        bug_id, "threat_model_update.threat_model_section", "Missing threat model section reference"
                    )
                )

        # 5. Release Note verification
        rn = entry.get("release_note")
        if not rn or not isinstance(rn, dict):
            violations.append(
                RegressionPolicyViolation(
                    bug_id, "release_note", "Missing release note specification"
                )
            )
        else:
            if rn.get("applicable", False):
                if not rn.get("advisory_summary") or len(rn.get("advisory_summary", "").strip()) < 10:
                    violations.append(
                        RegressionPolicyViolation(
                            bug_id,
                            "release_note.advisory_summary",
                            "Release note is marked applicable but advisory summary is empty or too short",
                        )
                    )

        return violations

    def enforce_policy(self) -> RegressionPolicyVerdict:
        """
        Executes complete policy enforcement across all registered security regressions.
        """
        registry = self.load_registry()
        regressions = registry.get("regressions", [])

        all_violations: List[RegressionPolicyViolation] = []

        # 1. Validate Schema
        schema_errors = self.validate_schema(registry)
        for se in schema_errors:
            all_violations.append(
                RegressionPolicyViolation("REGISTRY_SCHEMA", "schema_validation", se)
            )

        # 2. Validate every entry for the 5-point policy
        verified_count = 0
        for entry in regressions:
            entry_violations = self.validate_single_entry(entry)
            if entry_violations:
                all_violations.extend(entry_violations)
            else:
                verified_count += 1

        passed = len(all_violations) == 0
        summary = (
            f"Verified {verified_count}/{len(regressions)} security regressions conforming to "
            f"the 5-point policy. {len(all_violations)} violations found."
        )

        return RegressionPolicyVerdict(
            passed=passed,
            total_regressions=len(regressions),
            verified_regressions=verified_count,
            violations=all_violations,
            summary=summary,
        )


def verify_regression_policy() -> bool:
    """CLI and pipeline hook verifying regression policy conformance."""
    engine = SecurityRegressionPolicyEngine()
    verdict = engine.enforce_policy()
    print(f"\n>> [ECDAT Regression Policy Engine] {verdict.summary}")
    if not verdict.passed:
        for v in verdict.violations:
            print(f"   [VIOLATION] {v.bug_id} ({v.missing_element}): {v.description}")
        return False
    return True


if __name__ == "__main__":
    success = verify_regression_policy()
    sys.exit(0 if success else 1)
