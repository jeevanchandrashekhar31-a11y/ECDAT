"""
ECDAT Evidence-Based Compliance Mapping Engine (Phase 11.3).

Maps discovered cryptographic assets, CycloneDX CBOMs, and findings to
applicable standards and regulatory guidance:
- NIST SP 800-53 Rev 5
- NIST CNSA 2.0
- PCI DSS v4.0
- NIST SP 800-131A Rev 2
- ISO/IEC 27001:2022

Support Levels:
- SUPPORTED CONTROL: Fully validated by automated discovery with technical evidence.
- PARTIAL SUPPORT: Partially validated by technical evidence; requires manual organizational/custodial audit.
- NOT SUPPORTED: Out-of-scope for automated software/network discovery (e.g. physical facility security).

Secret Safety:
- Never exposes raw secrets, private keys, or passwords in generated audit evidence.
- All secrets are redacted into safe hashes '[REDACTED_SECRET SHA256:<hash>]'.

Non-Certification Disclaimer:
- Explicitly disclaims formal regulatory, statutory, or lab (CMVP/CAVP) certification.
"""

from __future__ import annotations
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

try:
    import jsonschema
except ImportError:  # pragma: no cover
    jsonschema = None

DEFAULT_RULES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "rules"))
DEFAULT_CATALOG_PATH = os.path.join(DEFAULT_RULES_DIR, "compliance_catalog.json")
DEFAULT_SCHEMA_PATH = os.path.join(DEFAULT_RULES_DIR, "schemas", "compliance_catalog.schema.json")

SUPPORT_LEVELS = [
    "SUPPORTED CONTROL",
    "PARTIAL SUPPORT",
    "NOT SUPPORTED",
]

NON_CERTIFICATION_DISCLAIMER = (
    "DISCLAIMER: ECDAT provides evidence-based automated mapping of discovered cryptographic assets "
    "against published standards and guidance. ECDAT does not issue formal regulatory certification, "
    "accredited laboratory validation (e.g., NIST CMVP/CAVP), or statutory compliance attestation. "
    "Technical control verdicts represent automated evidence matches against documented criteria."
)

RAW_SECRET_PATTERNS = [
    re.compile(
        r"-----BEGIN (?:RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |ENCRYPTED )?PRIVATE KEY-----",
        re.MULTILINE,
    ),
    re.compile(r"(?:api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.+=/]{16,})['\"]?", re.IGNORECASE),
]


def redact_secret_string(secret_str: str) -> str:
    """Safely redacts raw secrets into a non-reversible cryptographic fingerprint."""
    digest = hashlib.sha256(secret_str.encode("utf-8")).hexdigest()
    return f"[REDACTED_SECRET SHA256:{digest[:16]}]"


def sanitize_evidence_data(data: Any) -> Any:
    """
    Recursively scans and sanitizes data structures to ensure no private keys,
    passwords, or raw secrets appear in audit evidence.
    """
    if isinstance(data, str):
        cleaned = data
        for pat in RAW_SECRET_PATTERNS:

            def _replace(match):
                matched_val = match.group(0)
                return redact_secret_string(matched_val)

            cleaned = pat.sub(_replace, cleaned)
        return cleaned
    elif isinstance(data, dict):
        sanitized = {}
        for k, v in data.items():
            lower_k = k.lower()
            if any(secret_word in lower_k for secret_word in ["private_key", "raw_secret", "secret_key", "password"]):
                sanitized[k] = redact_secret_string(str(v))
            else:
                sanitized[k] = sanitize_evidence_data(v)
        return sanitized
    elif isinstance(data, list):
        return [sanitize_evidence_data(item) for item in data]
    return data


class ComplianceMapper:
    """
    Evidence-based regulatory and standards mapping engine.
    """

    def __init__(self, catalog_path: Optional[str] = None, schema_path: Optional[str] = None):
        self.catalog_path = catalog_path or DEFAULT_CATALOG_PATH
        self.schema_path = schema_path or DEFAULT_SCHEMA_PATH
        self.catalog = self._load_catalog()

    def _load_catalog(self) -> Dict[str, Any]:
        """Loads and validates the compliance catalog."""
        if not os.path.exists(self.catalog_path):
            return {"version": "1.0.0", "standards": [], "disclaimer": NON_CERTIFICATION_DISCLAIMER}

        with open(self.catalog_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if jsonschema and os.path.exists(self.schema_path):
            with open(self.schema_path, "r", encoding="utf-8") as sf:
                schema = json.load(sf)
            jsonschema.validate(instance=data, schema=schema)

        return data

    def get_catalog(self) -> Dict[str, Any]:
        """Returns the full compliance catalog dictionary."""
        return self.catalog

    def list_standards(self) -> List[Dict[str, Any]]:
        """Returns summary of supported compliance standards."""
        return [
            {
                "id": s["id"],
                "name": s["name"],
                "version": s["version"],
                "publisher": s["publisher"],
                "description": s["description"],
                "controls_count": len(s.get("controls", [])),
            }
            for s in self.catalog.get("standards", [])
        ]

    def get_standard(self, standard_id: str) -> Optional[Dict[str, Any]]:
        """Retrieves complete details and controls for a given standard."""
        for s in self.catalog.get("standards", []):
            if s["id"].lower() == standard_id.lower():
                return s
        return None

    def assess_control(
        self,
        control: Dict[str, Any],
        assets: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Evaluates discovered assets against a single compliance control.
        Produces sanitized audit evidence and compliance status.
        """
        support_level = control.get("support_level", "PARTIAL SUPPORT")
        control_id = control["control_id"]
        title = control["title"]
        criteria = control.get("evaluation_criteria", {})

        # If NOT SUPPORTED, immediately return guidance without attempting false automation
        if support_level == "NOT SUPPORTED":
            return {
                "control_id": control_id,
                "title": title,
                "support_level": "NOT SUPPORTED",
                "verdict": "NOT_APPLICABLE_OUT_OF_SCOPE",
                "compliant": None,
                "evidence_count": 0,
                "evidence": [],
                "gaps": [],
                "manual_audit_guidance": control.get(
                    "manual_audit_guidance", "This control requires manual physical or organizational inspection."
                ),
            }

        evidence = []
        gaps = []

        prohibited_algos = [a.upper() for a in criteria.get("prohibited_algorithms", [])]
        allowed_algos = [a.upper() for a in criteria.get("allowed_algorithms", [])]
        prohibited_protos = [p.lower() for p in criteria.get("prohibited_protocols", [])]
        allowed_protos = [p.lower() for p in criteria.get("allowed_protocols", [])]
        min_rsa = criteria.get("min_rsa_bits")
        min_ecc = criteria.get("min_ecc_bits")
        min_sym = criteria.get("min_symmetric_bits")
        req_pqc = criteria.get("require_pqc", False)
        allow_self_signed = criteria.get("allow_self_signed", True)

        for raw_asset in assets:
            # Secret sanitize before any processing
            asset = sanitize_evidence_data(raw_asset)
            asset_id = asset.get("asset_id") or asset.get("id") or asset.get("name") or "unknown"
            algo = str(asset.get("algorithm") or asset.get("name") or "").upper()
            proto = str(asset.get("protocol") or "").lower()
            key_size = asset.get("key_size") or asset.get("keyLength") or asset.get("bits")
            if key_size is not None:
                try:
                    key_size = int(key_size)
                except (ValueError, TypeError):
                    key_size = None

            is_self_signed = bool(asset.get("is_self_signed", False))
            is_pqc = bool(asset.get("is_quantum_safe", False) or asset.get("pqc_type") in ["pqc", "hybrid"])

            asset_gaps = []

            # Check prohibited algorithms
            for pa in prohibited_algos:
                if pa == algo or (pa in algo):
                    asset_gaps.append(f"Prohibited algorithm detected: '{algo}'")
                    break

            # Check allowed algorithms
            if allowed_algos and not any(aa in algo for aa in allowed_algos):
                asset_gaps.append(f"Algorithm '{algo}' not in approved list {allowed_algos}")

            # Check prohibited protocols
            for pp in prohibited_protos:
                if pp and (pp in proto):
                    asset_gaps.append(f"Prohibited protocol detected: '{proto}'")
                    break

            # Check allowed protocols
            if allowed_protos and proto and not any(ap in proto for ap in allowed_protos):
                asset_gaps.append(f"Protocol '{proto}' not in allowed list {allowed_protos}")

            # Key sizes
            if min_rsa and "RSA" in algo and key_size is not None and key_size < min_rsa:
                asset_gaps.append(f"RSA key size {key_size} is below required {min_rsa} bits")

            if min_ecc and ("ECC" in algo or "ECDSA" in algo) and key_size is not None and key_size < min_ecc:
                asset_gaps.append(f"ECC key size {key_size} is below required {min_ecc} bits")

            if min_sym and ("AES" in algo or "CHACHA" in algo) and key_size is not None and key_size < min_sym:
                asset_gaps.append(f"Symmetric key size {key_size} is below required {min_sym} bits")

            # Self signed
            if not allow_self_signed and is_self_signed:
                asset_gaps.append("Self-signed certificate violates control")

            # PQC
            if req_pqc and not is_pqc:
                asset_gaps.append("Cryptographic asset lacks post-quantum protection mandated by control")

            # Formulate safe evidence entry
            evidence_entry = {
                "asset_id": asset_id,
                "name": asset.get("name") or algo,
                "algorithm": algo,
                "key_size": key_size,
                "protocol": proto if proto else None,
                "environment": asset.get("environment", "production"),
                "compliant_with_control": len(asset_gaps) == 0,
            }
            evidence.append(evidence_entry)

            if asset_gaps:
                gaps.append(
                    {
                        "asset_id": asset_id,
                        "issues": asset_gaps,
                    }
                )

        # Determine verdict
        if support_level == "SUPPORTED CONTROL":
            compliant = (len(gaps) == 0) and (len(evidence) > 0)
            verdict = "COMPLIANT" if compliant else ("NON_COMPLIANT" if gaps else "NO_EVIDENCE_FOUND")
        else:  # PARTIAL SUPPORT
            compliant = False
            verdict = "REQUIRES_MANUAL_REVIEW" if len(gaps) == 0 else "NON_COMPLIANT_WITH_TECHNICAL_GAPS"

        return {
            "control_id": control_id,
            "title": title,
            "support_level": support_level,
            "verdict": verdict,
            "compliant": compliant,
            "evidence_count": len(evidence),
            "evidence": evidence,
            "gaps": gaps,
            "manual_audit_guidance": control.get("manual_audit_guidance"),
        }

    def assess(
        self,
        assets_or_cbom: Union[List[Dict[str, Any]], Dict[str, Any]],
        standard_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Alias for assess_compliance."""
        return self.assess_compliance(assets_or_cbom, standard_ids)

    def assess_compliance(
        self,
        assets_or_cbom: Union[List[Dict[str, Any]], Dict[str, Any]],
        standard_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Conducts evidence-based assessment against selected or all standards.
        Never claims formal certification.
        """
        # Extract asset list
        raw_list: List[Dict[str, Any]] = []
        if isinstance(assets_or_cbom, list):
            raw_list = assets_or_cbom
        elif isinstance(assets_or_cbom, dict):
            if "components" in assets_or_cbom:
                raw_list = assets_or_cbom["components"]
            elif "findings" in assets_or_cbom:
                raw_list = assets_or_cbom["findings"]
            elif "assets" in assets_or_cbom:
                raw_list = assets_or_cbom["assets"]
            else:
                raw_list = [assets_or_cbom]

        # Sanitize all assets upfront to guarantee zero secret leakage
        clean_assets = [sanitize_evidence_data(a) for a in raw_list]

        target_standards = self.catalog.get("standards", [])
        if standard_ids:
            target_ids = [s.lower() for s in standard_ids]
            target_standards = [s for s in target_standards if s["id"].lower() in target_ids]

        assessment_results = []
        total_controls = 0
        supported_controls = 0
        partial_controls = 0
        not_supported_controls = 0
        compliant_controls = 0

        now_ts = datetime.now(timezone.utc).isoformat()

        for std in target_standards:
            std_controls = std.get("controls", [])
            assessed_controls = []

            for ctrl in std_controls:
                total_controls += 1
                level = ctrl.get("support_level", "PARTIAL SUPPORT")
                if level == "SUPPORTED CONTROL":
                    supported_controls += 1
                elif level == "PARTIAL SUPPORT":
                    partial_controls += 1
                else:
                    not_supported_controls += 1

                assessment = self.assess_control(ctrl, clean_assets)
                if assessment.get("compliant") is True:
                    compliant_controls += 1
                assessed_controls.append(assessment)

            assessment_results.append(
                {
                    "standard_id": std["id"],
                    "standard_name": std["name"],
                    "version": std["version"],
                    "publisher": std["publisher"],
                    "controls": assessed_controls,
                }
            )

        # Create cryptographic SHA-256 evidence digest for non-repudiation
        canonical_digest_payload = {
            "timestamp": now_ts,
            "total_assets": len(clean_assets),
            "standards_assessed": [s["standard_id"] for s in assessment_results],
            "compliant_controls": compliant_controls,
            "total_controls": total_controls,
        }
        digest = hashlib.sha256(json.dumps(canonical_digest_payload, sort_keys=True).encode("utf-8")).hexdigest()

        return {
            "disclaimer": NON_CERTIFICATION_DISCLAIMER,
            "certification_claimed": False,
            "assessment_timestamp": now_ts,
            "summary": {
                "total_standards_assessed": len(assessment_results),
                "total_controls_mapped": total_controls,
                "support_level_breakdown": {
                    "SUPPORTED CONTROL": supported_controls,
                    "PARTIAL SUPPORT": partial_controls,
                    "NOT SUPPORTED": not_supported_controls,
                },
                "compliant_automated_controls": compliant_controls,
            },
            "standards": assessment_results,
            "evidence_digest": digest,
        }


if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="ECDAT Evidence-Based Compliance Mapping CLI")
    parser.add_argument("--input", "-i", default=None, help="Path to asset JSON or CycloneDX CBOM file")
    parser.add_argument(
        "--standards", "-s", default=None, help="Comma-separated list of standard IDs (e.g. nist_sp_800_53_r5,cnsa_2_0)"
    )
    parser.add_argument("--list-standards", action="store_true", help="List all supported standards in catalog")
    parser.add_argument("--output", "-o", default=None, help="Output file path for assessment JSON")
    parser.add_argument("--json", action="store_true", help="Print full JSON output to stdout")
    args = parser.parse_args()

    mapper = ComplianceMapper()

    if args.list_standards:
        standards = mapper.list_standards()
        print("Supported Compliance Standards & Guidance in Catalog:")
        print(f"Non-Certification Disclaimer: {NON_CERTIFICATION_DISCLAIMER}\n")
        for s in standards:
            print(f"- [{s['id']}] {s['name']} (v{s['version']}, {s['publisher']}) - {s['controls_count']} controls")
        sys.exit(0)

    if not args.input:
        print("[ERROR] --input file is required unless using --list-standards", file=sys.stderr)
        sys.exit(1)

    with open(args.input, "r", encoding="utf-8") as f:
        input_data = json.load(f)

    std_filter = [x.strip() for x in args.standards.split(",")] if args.standards else None
    result = mapper.assess(input_data, standard_ids=std_filter)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        print(f"Compliance assessment evidence written to {args.output}")

    if args.json or not args.output:
        print(json.dumps(result, indent=2))
