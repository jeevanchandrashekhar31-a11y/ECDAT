import json
import hashlib
from typing import List
from scanners.static.results import StaticFinding


def map_confidence_to_severity(confidence: str, finding_type: str) -> str:
    # SARIF levels: "none", "note", "warning", "error"
    if (
        "MD5" in finding_type.upper()
        or "DES" in finding_type.upper()
        or "RC4" in finding_type.upper()
        or finding_type == "hardcoded_key"
    ):
        return "error"
    if confidence == "high":
        return "error"
    elif confidence == "medium":
        return "warning"
    else:
        return "note"


def get_recommendation(finding_type: str) -> str:
    if finding_type == "weak_hash":
        return "Migrate to SHA-256 or SHA-3 for secure hashing."
    elif finding_type == "weak_cipher":
        return "Migrate to AES-GCM or ChaCha20-Poly1305."
    elif finding_type == "hardcoded_key":
        return "Move secrets to a secure vault or environment variables."
    elif finding_type == "weak_prng":
        return "Use cryptographically secure PRNG instead of standard rand()."
    return "Review cryptographic usage for best practices."


def generate_sarif(findings: List[StaticFinding], tool_name: str = "ECDAT Static Scanner") -> dict:
    rules = {}
    results = []

    for finding in findings:
        severity = map_confidence_to_severity(finding.confidence, finding.finding_type)
        rule_id = finding.rule_id

        # Add rule if not present
        if rule_id not in rules:
            rules[rule_id] = {
                "id": rule_id,
                "shortDescription": {"text": f"Cryptographic finding: {finding.finding_type}"},
                "defaultConfiguration": {"level": severity},
                "help": {"text": get_recommendation(finding.finding_type)},
            }

        message_text = f"Found {finding.finding_type} ({finding.algorithm}). Confidence: {finding.confidence}."
        if finding.needs_human_review:
            message_text += " [Needs Human Review]"

        fingerprint = hashlib.sha256(
            f"{finding.file_path}:{finding.line_number}:{finding.algorithm}".encode()
        ).hexdigest()

        result = {
            "ruleId": rule_id,
            "level": severity,
            "message": {"text": message_text},
            "locations": [
                {
                    "physicalLocation": {
                        "artifactLocation": {"uri": finding.file_path},
                        "region": {"startLine": finding.line_number, "snippet": {"text": finding.evidence}},
                    }
                }
            ],
            "partialFingerprints": {"primaryLocationLineHash": fingerprint},
        }
        results.append(result)

    sarif = {
        "version": "2.1.0",
        "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": tool_name,
                        "informationUri": "https://github.com/ecdat",
                        "rules": list(rules.values()),
                    }
                },
                "results": results,
            }
        ],
    }
    return sarif
