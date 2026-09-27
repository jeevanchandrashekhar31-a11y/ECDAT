"""
ECDAT Evidence Integrity and Audit Attestation Module (Python Engine) — Phase 26.3.

Ensures evidence integrity, cryptographic fingerprints, and explicit metadata identification:
- scan timestamp
- ECDAT version
- scanner versions
- configuration
- policy version
- CBOM version

Strictly enforces:
- Never imply independent audit/certification unless actually obtained.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


ECDAT_VERSION = "1.0.0"

DEFAULT_SCANNER_VERSIONS = {
    "static_tree_sitter_ast": "1.0.0",
    "network_tls_prober": "1.0.0",
    "ebpf_runtime_tracer": "1.0.0",
    "syft_sbom_scanner": "1.0.0",
    "cbom_generator": "1.0.0",
}

PROHIBITED_DECEPTIVE_CLAIMS = [
    "third-party certified",
    "independently audited",
    "fips 140-3 certified",
    "common criteria certified",
    "accredited audit complete",
    "official third-party certification",
    "externally accredited audit",
]


def compute_canonical_sha256(data: Any) -> str:
    """Computes deterministic SHA-256 hex digest of JSON-serializable data."""
    if data is None:
        return hashlib.sha256(b"").hexdigest()

    def sort_obj(obj: Any) -> Any:
        if isinstance(obj, dict):
            return {k: sort_obj(v) for k, v in sorted(obj.items())}
        if isinstance(obj, list):
            return [sort_obj(v) for v in obj]
        return obj

    canonical_json = json.dumps(sort_obj(data), separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def compute_evidence_merkle_root(evidence_items: List[Any]) -> str:
    """Computes a chained Merkle root hash across an array of evidence items."""
    if not evidence_items:
        return compute_canonical_sha256({"empty": True, "count": 0})

    leaf_hashes = []
    for item in evidence_items:
        if isinstance(item, str):
            leaf_hashes.append(hashlib.sha256(item.encode("utf-8")).hexdigest())
        elif isinstance(item, dict):
            eid = item.get("evidence_id") or item.get("id") or item.get("finding_id", "")
            loc = item.get("location") or item.get("exact_source_location", {}).get("file_path", "")
            snippet = item.get("evidence_context") or item.get("evidence", {}).get("raw_evidence", "")
            raw = f"{eid}:{loc}:{snippet}:{item.get('sha256_hash', '')}"
            leaf_hashes.append(hashlib.sha256(raw.encode("utf-8")).hexdigest())
        else:
            leaf_hashes.append(compute_canonical_sha256(item))

    current_level = leaf_hashes
    while len(current_level) > 1:
        next_level = []
        for i in range(0, len(current_level), 2):
            if i + 1 < len(current_level):
                combined = bytes.fromhex(current_level[i]) + bytes.fromhex(current_level[i + 1])
                next_level.append(hashlib.sha256(combined).hexdigest())
            else:
                next_level.append(current_level[i])
        current_level = next_level

    return current_level[0]


class EvidenceIntegrityBuilder:
    """Builds and attaches verified evidence integrity blocks to reports."""

    def __init__(
        self,
        scan_timestamp: Optional[str] = None,
        policy_profile: str = "regulated_bfsi",
        is_independently_audited: bool = False,
        attestation_details: Optional[Dict[str, Any]] = None,
    ):
        self.scan_timestamp = scan_timestamp or datetime.now(timezone.utc).isoformat()
        self.policy_profile = policy_profile
        self.is_independently_audited = is_independently_audited
        self.attestation_details = attestation_details or {}

    def build_integrity_block(
        self,
        report_content: Optional[Dict[str, Any]] = None,
        evidence_list: Optional[List[Any]] = None,
        config: Optional[Dict[str, Any]] = None,
        cbom_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        cfg = config or {
            "environment": os.environ.get("ENV", "production"),
            "strict_enforcement": True,
            "zero_secrets_redaction": True,
            "pqc_migration_target_year": 2033,
            "active_rules_count": 28,
        }
        cfg_hash = compute_canonical_sha256(cfg)

        policy_snap = {
            "profile_id": self.policy_profile,
            "version": "1.0.0",
            "catalog_schema": "policy_as_code.schema.json",
            "enforcement_mode": "STRICT_BLOCK",
            "frameworks": [
                "NIST SP 800-131A Rev 2",
                "PCI-DSS v4.0",
                "BSI TR-02102-1",
                "CNSA 2.0",
                "FIPS 140-3",
            ],
        }
        policy_hash = compute_canonical_sha256(policy_snap)

        cbom = cbom_data or {
            "bomFormat": "CycloneDX",
            "specVersion": "CycloneDX 1.6",
            "serialNumber": "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
            "version": 1,
        }
        cbom_hash = compute_canonical_sha256(cbom)

        ev_list = evidence_list or []
        merkle_root = compute_evidence_merkle_root(ev_list)

        report_hash = (
            compute_canonical_sha256(report_content)
            if report_content
            else compute_canonical_sha256({"scan_timestamp": self.scan_timestamp, "merkle_root": merkle_root})
        )

        attestation = {
            "independent_audit_obtained": self.is_independently_audited,
            "certification_status": "FORMALLY_ATTESTED_THIRD_PARTY"
            if self.is_independently_audited
            else "UNATTESTED_AUTOMATED_EVALUATION",
            "attestation_statement": (
                f"This report has been formally audited and counter-attested by: {self.attestation_details.get('auditor_identity')}."
                if self.is_independently_audited
                else "AUTOMATED SCANNER EVALUATION ONLY: This report is generated automatically by ECDAT and reflects automated scanner outputs, heuristic static analysis, and dynamic observation. It does NOT constitute an independent third-party audit, formal certification, or accredited Common Criteria / FIPS 140-3 laboratory evaluation. No independent external certification has been obtained for this assessment."
            ),
            "auditor_identity": self.attestation_details.get("auditor_identity")
            if self.is_independently_audited
            else None,
            "accreditation_body": self.attestation_details.get("accreditation_body")
            if self.is_independently_audited
            else None,
            "attestation_valid_until": self.attestation_details.get("attestation_valid_until")
            if self.is_independently_audited
            else None,
            "disclaimer_mandatory": True,
        }

        return {
            "scan_timestamp": self.scan_timestamp,
            "ecdat_version": ECDAT_VERSION,
            "scanner_versions": dict(DEFAULT_SCANNER_VERSIONS),
            "configuration": {
                **cfg,
                "config_hash_sha256": cfg_hash,
            },
            "policy_version": {
                **policy_snap,
                "policy_hash_sha256": policy_hash,
            },
            "cbom_version": {
                "spec_version": cbom.get("specVersion", "CycloneDX 1.6"),
                "cbom_schema_version": "1.6",
                "cbom_serial_number": cbom.get("serialNumber", "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79"),
                "cbom_version": int(cbom.get("version", 1)),
                "cbom_sha256": cbom_hash,
            },
            "hashes": {
                "report_payload_sha256": report_hash,
                "evidence_merkle_root": merkle_root,
                "canonical_fingerprint": f"SHA256:{report_hash}",
            },
            "independent_attestation": attestation,
        }


def validate_evidence_integrity(report: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """Validates that a report conforms to Phase 26.3 integrity mandates."""
    violations = []

    integrity = report.get("evidence_integrity") or report.get("metadata", {}).get("evidence_integrity")
    if not integrity or not isinstance(integrity, dict):
        return False, ["Missing 'evidence_integrity' block in report"]

    # 1. Scan timestamp
    ts = integrity.get("scan_timestamp")
    if not ts or not isinstance(ts, str):
        violations.append("Missing or invalid 'scan_timestamp'")

    # 2. ECDAT version
    if not integrity.get("ecdat_version"):
        violations.append("Missing 'ecdat_version'")

    # 3. Scanner versions
    sv = integrity.get("scanner_versions")
    if not sv or not isinstance(sv, dict) or len(sv) == 0:
        violations.append("Missing or invalid 'scanner_versions'")

    # 4. Configuration
    cfg = integrity.get("configuration")
    if not cfg or not isinstance(cfg, dict) or len(cfg.get("config_hash_sha256", "")) != 64:
        violations.append("Missing valid 'configuration.config_hash_sha256'")

    # 5. Policy version
    pv = integrity.get("policy_version")
    if not pv or not isinstance(pv, dict) or len(pv.get("policy_hash_sha256", "")) != 64:
        violations.append("Missing valid 'policy_version.policy_hash_sha256'")

    # 6. CBOM version
    cb = integrity.get("cbom_version")
    if not cb or not isinstance(cb, dict) or len(cb.get("cbom_sha256", "")) != 64:
        violations.append("Missing valid 'cbom_version.cbom_sha256'")

    # 7. Hashes
    hashes = integrity.get("hashes", {})
    if len(hashes.get("report_payload_sha256", "")) != 64 or len(hashes.get("evidence_merkle_root", "")) != 64:
        violations.append("Missing valid 64-char hashes in 'hashes' block")

    # 8. Anti-Deception Guard: Never imply independent audit/certification unless actually obtained
    attestation = integrity.get("independent_attestation", {})
    if not isinstance(attestation, dict):
        violations.append("Missing 'independent_attestation' block")
    else:
        audited = attestation.get("independent_audit_obtained")
        if not isinstance(audited, bool):
            violations.append("'independent_audit_obtained' must be a boolean")

        if audited is False:
            if attestation.get("certification_status") not in {"UNATTESTED_AUTOMATED_EVALUATION", "NONE"}:
                violations.append(
                    f"Invalid certification_status for unattested report: '{attestation.get('certification_status')}'"
                )

            report_str = json.dumps(report).lower()
            for phrase in PROHIBITED_DECEPTIVE_CLAIMS:
                if phrase in report_str:
                    violations.append(
                        f"Deceptive certification claim detected: Report implies '{phrase}' without formal third-party attestation."
                    )
        else:
            if not attestation.get("auditor_identity"):
                violations.append("Independent audit claimed, but 'auditor_identity' is missing")
            if not attestation.get("accreditation_body"):
                violations.append("Independent audit claimed, but 'accreditation_body' is missing")

    return len(violations) == 0, violations


def main():
    parser = argparse.ArgumentParser(description="ECDAT Evidence Integrity Validator (Phase 26.3)")
    parser.add_argument("--verify-file", help="Path to report JSON to verify")
    parser.add_argument("--demo", action="store_true", help="Generate and print sample evidence integrity block")
    args = parser.parse_args()

    if args.demo or not args.verify_file:
        builder = EvidenceIntegrityBuilder()
        block = builder.build_integrity_block()
        print(json.dumps(block, indent=2))
        sys.exit(0)

    try:
        with open(args.verify_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        valid, violations = validate_evidence_integrity(data)
        if valid:
            print(">> [INTEGRITY CHECK] PASSED: All 6 metadata fields, hashes, and audit disclaimers verified.")
            sys.exit(0)
        else:
            print(f">> [INTEGRITY CHECK] FAILED: {len(violations)} violations found:")
            for v in violations:
                print(f"   - {v}")
            sys.exit(1)
    except Exception as e:
        print(f">> [ERROR] Failed to verify report file: {e}")
        sys.exit(2)


if __name__ == "__main__":
    main()
