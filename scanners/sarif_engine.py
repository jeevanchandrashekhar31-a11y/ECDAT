"""
ECDAT SARIF Engine (Phase 13.3)

Generates strictly compliant OASIS SARIF v2.1.0 reports for cryptographic source findings.
Includes:
- rule ID (ruleId & driver rules)
- severity (error, warning, note; mapped to security-severity 0.0-10.0)
- location (physicalLocation, uri, region startLine, startColumn, endLine, endColumn)
- message (actionable text and markdown)
- help (plain text and rich markdown guidance cards)
- evidence (sanitized contextual code snippets with zero secret leakage)
- remediation guidance (concrete step-by-step guidance and code diffs)

Validates SARIF output automatically against OASIS SARIF 2.1.0 specifications.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from scanners.developer_feedback import DeveloperFeedbackGenerator, DeveloperFeedback
from scanners.static.sanitization import redact_secrets

SARIF_SCHEMA_URI = "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json"
SARIF_VERSION = "2.1.0"

VALID_SARIF_LEVELS = {"error", "warning", "note", "none"}


class SarifValidationError(Exception):
    """Raised when generated SARIF fails OASIS SARIF v2.1.0 structural or semantic validation."""

    def __init__(self, message: str, errors: Optional[List[str]] = None):
        super().__init__(message)
        self.errors = errors or []


def map_severity_to_sarif_level(severity: str) -> Tuple[str, str]:
    """
    Maps ECDAT finding severity to SARIF level and GitHub security-severity score.
    Returns (sarif_level, security_severity_score).
    """
    s = str(severity).lower()
    if s in ("critical", "fatal"):
        return "error", "9.5"
    if s in ("high", "error"):
        return "error", "8.0"
    if s in ("medium", "warning", "warn"):
        return "warning", "5.5"
    if s in ("low", "info", "informational", "note"):
        return "note", "2.5"
    return "note", "1.0"


class SarifEngine:
    """
    First-class OASIS SARIF v2.1.0 generator and automated validator.
    """

    @classmethod
    def generate(
        cls,
        findings: List[Dict[str, Any]],
        tool_name: str = "ECDAT Cryptographic Scanner",
        tool_version: str = "1.0.0",
        target_root: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generates standard OASIS SARIF v2.1.0 document incorporating all required dimensions:
        rule ID, severity, location, message, help, evidence, and remediation guidance.
        """
        rules: Dict[str, Dict[str, Any]] = {}
        results: List[Dict[str, Any]] = []

        for finding in findings:
            # 1. Rule ID
            rule_id = str(finding.get("rule_id") or finding.get("ruleId") or "ECDAT-CRYPTO-FINDING")
            raw_sev = str(finding.get("severity") or "medium")
            level, sec_score = map_severity_to_sarif_level(raw_sev)

            # Generate or reuse developer feedback
            df_dict = finding.get("developer_feedback")
            if not df_dict:
                df_obj = DeveloperFeedbackGenerator.generate(finding, target_root=target_root)
                df_dict = df_obj.to_dict()
            else:
                df_obj = DeveloperFeedbackGenerator.generate(finding, target_root=target_root)

            safe_fix = df_dict.get("safe_fix", {})
            safe_fix_summary = (
                safe_fix.get("summary") if isinstance(safe_fix, dict) else str(finding.get("remediation", ""))
            )
            why_it_matters = str(df_dict.get("why_it_matters", ""))

            # 2. Rule Definition (Help & Remediation Guidance)
            if rule_id not in rules:
                markdown_card = DeveloperFeedbackGenerator.render_markdown(df_obj)
                rule_def = {
                    "id": rule_id,
                    "name": rule_id.replace("-", "_").replace(":", "_"),
                    "shortDescription": {"text": f"Cryptographic finding: {finding.get('algorithm', rule_id)}"},
                    "fullDescription": {
                        "text": str(
                            finding.get("description")
                            or f"Detected {finding.get('finding_type')} ({finding.get('algorithm')})"
                        )
                    },
                    "defaultConfiguration": {
                        "level": level,
                    },
                    "help": {
                        "text": safe_fix_summary or "Review cryptographic usage according to enterprise crypto policy.",
                        "markdown": markdown_card,
                    },
                    "properties": {
                        "tags": ["cryptography", "security", "pqc-readiness"],
                        "precision": "very-high" if str(finding.get("confidence", "")).lower() == "high" else "high",
                        "security-severity": sec_score,
                        "references": df_dict.get("references", []),
                        "why_it_matters": why_it_matters,
                        "remediation": safe_fix_summary,
                        "verification_command": df_dict.get("verification_command", ""),
                    },
                }
                rules[rule_id] = rule_def

            # 3. Location & Evidence
            file_path = str(finding.get("file_path") or finding.get("filePath") or "unknown").replace("\\", "/")
            line_no = max(1, int(finding.get("line_number") or finding.get("lineNumber") or finding.get("line") or 1))
            col_no = max(
                1, int(finding.get("column_number") or finding.get("columnNumber") or finding.get("column") or 1)
            )

            raw_evidence = str(finding.get("evidence") or "")
            # Ensure zero secret leakage in snippet
            safe_snippet = redact_secrets(raw_evidence)

            # 4. Message
            msg_text = (
                f"Found {finding.get('finding_type', 'cryptographic finding')} ({finding.get('algorithm', 'UNKNOWN')}) "
                f"at {file_path}:{line_no}. Confidence: {finding.get('confidence', 'HIGH')}."
            )
            if why_it_matters:
                msg_text += f" {why_it_matters[:180]}..."

            fingerprint = hashlib.sha256(
                f"{file_path}:{line_no}:{finding.get('algorithm', rule_id)}".encode("utf-8")
            ).hexdigest()

            result_item = {
                "ruleId": rule_id,
                "level": level,
                "message": {
                    "text": msg_text,
                },
                "locations": [
                    {
                        "physicalLocation": {
                            "artifactLocation": {
                                "uri": file_path,
                            },
                            "region": {
                                "startLine": line_no,
                                "startColumn": col_no,
                                "endLine": line_no,
                                "endColumn": col_no + max(1, len(safe_snippet)),
                                "snippet": {
                                    "text": safe_snippet,
                                },
                            },
                        }
                    }
                ],
                "partialFingerprints": {
                    "primaryLocationLineHash": fingerprint,
                },
                "properties": {
                    "confidence": str(finding.get("confidence", "HIGH")),
                    "remediation_guidance": safe_fix_summary,
                    "developer_feedback": df_dict,
                },
            }

            # If in-code suppressed, record suppression in standard SARIF format
            if finding.get("is_suppressed") or df_obj.is_suppressed:
                reason = finding.get("suppression_reason") or df_obj.suppression_reason or "Inline comment suppression"
                result_item["suppressions"] = [
                    {
                        "kind": "inSource",
                        "status": "accepted",
                        "justification": reason,
                    }
                ]

            results.append(result_item)

        sarif_doc = {
            "$schema": SARIF_SCHEMA_URI,
            "version": SARIF_VERSION,
            "runs": [
                {
                    "tool": {
                        "driver": {
                            "name": tool_name,
                            "version": tool_version,
                            "informationUri": "https://github.com/ecdat/ecdat",
                            "rules": list(rules.values()),
                        }
                    },
                    "results": results,
                }
            ],
        }

        return sarif_doc

    @classmethod
    def validate(cls, sarif_doc: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Automatically validates SARIF document against OASIS SARIF v2.1.0 standard rules:
        - $schema, version
        - runs array and driver metadata
        - rule definitions (id, descriptions, level, help)
        - results (ruleId, level, locations, physicalLocation, region startLine >= 1)
        - ruleId integrity: every result ruleId must match a defined rule
        - zero secret leakage invariant: no unredacted PEM private keys in snippets
        """
        errors: List[str] = []

        if not isinstance(sarif_doc, dict):
            return False, ["SARIF document must be a JSON object"]

        # 1. Root Properties
        version = sarif_doc.get("version")
        if version != SARIF_VERSION:
            errors.append(f"Invalid SARIF version '{version}'. Expected '{SARIF_VERSION}'")

        schema = sarif_doc.get("$schema")
        if not schema or not isinstance(schema, str) or "sarif" not in schema.lower():
            errors.append(f"Invalid or missing $schema URI in SARIF document: {schema}")

        runs = sarif_doc.get("runs")
        if not isinstance(runs, list) or len(runs) == 0:
            errors.append("SARIF document must contain a non-empty 'runs' array")
            return False, errors

        run = runs[0]
        if not isinstance(run, dict):
            return False, ["Run item must be a JSON object"]

        tool = run.get("tool")
        if not tool or not isinstance(tool, dict):
            errors.append("Run missing required 'tool' object")
            return False, errors

        driver = tool.get("driver")
        if not driver or not isinstance(driver, dict):
            errors.append("Tool missing required 'driver' object")
            return False, errors

        if not driver.get("name"):
            errors.append("Tool driver missing required 'name' string")

        # 2. Validate Rules
        rules = driver.get("rules", [])
        if not isinstance(rules, list):
            errors.append("Driver 'rules' must be a list")
            rules = []

        defined_rule_ids: Set[str] = set()
        for idx, rule in enumerate(rules):
            rid = rule.get("id")
            if not rid or not isinstance(rid, str):
                errors.append(f"Rule at index {idx} missing required 'id' string")
            else:
                defined_rule_ids.add(rid)

            desc = rule.get("shortDescription") or rule.get("fullDescription")
            if not desc or not isinstance(desc, dict) or not desc.get("text"):
                errors.append(f"Rule '{rid or idx}' missing required description text")

            def_config = rule.get("defaultConfiguration")
            if def_config and isinstance(def_config, dict):
                lvl = def_config.get("level")
                if lvl and lvl not in VALID_SARIF_LEVELS:
                    errors.append(f"Rule '{rid}' has invalid level '{lvl}'. Must be one of {VALID_SARIF_LEVELS}")

            help_obj = rule.get("help")
            if (
                not help_obj
                or not isinstance(help_obj, dict)
                or (not help_obj.get("text") and not help_obj.get("markdown"))
            ):
                errors.append(f"Rule '{rid}' missing required 'help' guidance text/markdown")

        # 3. Validate Results
        results = run.get("results", [])
        if not isinstance(results, list):
            errors.append("Run 'results' must be a list")
            return False, errors

        pem_leak_regex = re.compile(
            r"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----(?!.*\[REDACTED_)", re.DOTALL
        )

        for idx, res in enumerate(results):
            r_id = res.get("ruleId")
            if not r_id or not isinstance(r_id, str):
                errors.append(f"Result at index {idx} missing required 'ruleId'")
            elif r_id not in defined_rule_ids:
                errors.append(f"Result '{r_id}' refers to an undefined rule ID (not present in driver.rules)")

            level = res.get("level")
            if level and level not in VALID_SARIF_LEVELS:
                errors.append(f"Result '{r_id}' has invalid level '{level}'. Must be one of {VALID_SARIF_LEVELS}")

            msg = res.get("message")
            if not msg or not isinstance(msg, dict) or not msg.get("text"):
                errors.append(f"Result '{r_id}' missing required 'message.text'")

            locs = res.get("locations")
            if not isinstance(locs, list) or len(locs) == 0:
                errors.append(f"Result '{r_id}' must contain a non-empty 'locations' array")
            else:
                for l_idx, loc in enumerate(locs):
                    phys = loc.get("physicalLocation")
                    if not phys or not isinstance(phys, dict):
                        errors.append(f"Result '{r_id}' location {l_idx} missing 'physicalLocation'")
                        continue

                    art = phys.get("artifactLocation")
                    if not art or not isinstance(art, dict) or not art.get("uri"):
                        errors.append(f"Result '{r_id}' location {l_idx} missing 'artifactLocation.uri'")

                    reg = phys.get("region")
                    if reg and isinstance(reg, dict):
                        start_line = reg.get("startLine")
                        if start_line is not None and (not isinstance(start_line, int) or start_line < 1):
                            errors.append(f"Result '{r_id}' startLine must be an integer >= 1 (got {start_line})")

                        snippet = reg.get("snippet")
                        if snippet and isinstance(snippet, dict):
                            snip_text = str(snippet.get("text", ""))
                            # Zero Secret Leakage Invariant: Check for raw private key leaks
                            if pem_leak_regex.search(snip_text):
                                errors.append(
                                    f"CRITICAL: Result '{r_id}' snippet contains unredacted raw secret material!"
                                )

        return len(errors) == 0, errors

    @classmethod
    def generate_and_validate(
        cls,
        findings: List[Dict[str, Any]],
        tool_name: str = "ECDAT Cryptographic Scanner",
        tool_version: str = "1.0.0",
        target_root: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Generates SARIF document and automatically validates it.
        Raises SarifValidationError if the generated output is invalid.
        """
        sarif_doc = cls.generate(findings, tool_name=tool_name, tool_version=tool_version, target_root=target_root)
        is_valid, errors = cls.validate(sarif_doc)
        if not is_valid:
            raise SarifValidationError(
                f"Generated SARIF failed automated validation with {len(errors)} error(s)",
                errors=errors,
            )
        return sarif_doc

    @classmethod
    def write_sarif(cls, sarif_doc: Dict[str, Any], output_path: str, validate: bool = True) -> None:
        """
        Writes SARIF document to disk with automated pre-write validation.
        """
        if validate:
            is_valid, errors = cls.validate(sarif_doc)
            if not is_valid:
                raise SarifValidationError(
                    f"Refusing to write invalid SARIF to {output_path} ({len(errors)} errors)",
                    errors=errors,
                )

        p = Path(output_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(sarif_doc, indent=2), encoding="utf-8")
