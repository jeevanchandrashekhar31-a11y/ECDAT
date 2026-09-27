"""
ECDAT Enterprise Policy-as-Code Engine (Phase 11.1).

Provides schema-validated, deterministic cryptographic policy evaluation supporting:
- algorithms (allowed, prohibited, deprecated, classical/quantum security)
- key sizes (RSA, ECC, DH, symmetric bit strength, curve restrictions)
- protocols (TLS, SSH, IKE versions and cipher suites)
- certificates (validity duration, self-signed detection, CT logs, signature algorithms)
- PQC requirements (mandatory algorithms, hybrid key exchange, Mosca gaps)
- environments (production, staging, dev, dmz, public internet)
- applications (app-tier rules and scoping)
- business units (BU-specific mandates and exemptions)
- exceptions (approved, active, and expired exception handling)
- deadlines (sunset dates, deprecation warnings, and hard blocking escalations)

Precedence Resolution:
BLOCK > WARN > EXCEPTION > ALLOW
"""

from __future__ import annotations
import json
import os
import re
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

from scanners.static.sanitization import redact_secrets

try:
    import jsonschema
except ImportError:  # pragma: no cover
    jsonschema = None

DEFAULT_RULES_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "rules"))
DEFAULT_SCHEMA_PATH = os.path.join(DEFAULT_RULES_DIR, "schemas", "policy_as_code.schema.json")
DEFAULT_POLICY_PATH = os.path.join(DEFAULT_RULES_DIR, "policy_as_code.json")

# Precedence rank mapping: lower number = higher precedence
PREFERENCE_ORDER = {
    "BLOCK": 1,
    "WARN": 2,
    "EXCEPTION": 3,
    "ALLOW": 4,
}


class PolicyValidationError(Exception):
    """Raised when a policy document fails JSON schema validation."""

    def __init__(self, message: str, errors: Optional[List[str]] = None):
        super().__init__(message)
        self.errors = errors or []


def _normalize_date(date_val: Optional[Union[str, datetime]]) -> Optional[datetime]:
    """Parses ISO dates or date strings into timezone-aware UTC datetime."""
    if not date_val:
        return None
    if isinstance(date_val, datetime):
        if date_val.tzinfo is None:
            return date_val.replace(tzinfo=timezone.utc)
        return date_val.astimezone(timezone.utc)
    try:
        # Supports YYYY-MM-DD and full ISO strings
        clean_str = str(date_val).strip()
        if len(clean_str) == 10:
            clean_str += "T00:00:00Z"
        dt = datetime.fromisoformat(clean_str.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _matches_pattern_or_set(value: Optional[str], patterns: Optional[List[str]]) -> bool:
    """Helper to check if a value matches a list of wildcards, regexes, or exact values."""
    if not patterns:
        return True
    if not value:
        return False
    val_lower = str(value).lower().strip()
    for pat in patterns:
        pat_str = str(pat).strip()
        if pat_str == "*":
            return True
        if pat_str.lower() == val_lower:
            return True
        if "*" in pat_str:
            regex_pat = "^" + re.escape(pat_str).replace("\\*", ".*") + "$"
            if re.match(regex_pat, val_lower, re.IGNORECASE):
                return True
        elif pat_str.lower() in val_lower:
            return True
    return False


class PolicyEngine:
    """
    Enterprise Policy-as-Code Engine with deterministic evaluation and defined precedence.
    """

    def __init__(self, schema_path: Optional[str] = None):
        self.schema_path = schema_path or DEFAULT_SCHEMA_PATH
        self._schema = self._load_schema()

    def _load_schema(self) -> Dict[str, Any]:
        """Loads the JSON schema for validation."""
        if os.path.exists(self.schema_path):
            with open(self.schema_path, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}

    def validate_policy(self, policy: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Validates a policy document against the JSON schema.
        Never executes arbitrary code.
        """
        if not isinstance(policy, dict):
            return False, ["Policy must be a JSON/dict object."]

        # Prototype pollution protection
        if "__proto__" in policy or "constructor" in policy:
            return False, ["Policy contains forbidden prototype properties."]

        if jsonschema and self._schema:
            validator = jsonschema.Draft7Validator(self._schema)
            errors = []
            for err in validator.iter_errors(policy):
                path = ".".join(str(p) for p in err.path) or "root"
                clean_msg = redact_secrets(err.message)
                errors.append(f"[{path}] {clean_msg}")
            if errors:
                return False, errors

        # Basic structural assertions
        required = ["version", "id", "name", "rules"]
        missing = [r for r in required if r not in policy]
        if missing:
            return False, [f"Missing required policy fields: {missing}"]

        return True, []

    def load_policy(self, policy_or_path: Union[str, Dict[str, Any]]) -> Dict[str, Any]:
        """Loads and schema-validates a policy document."""
        if isinstance(policy_or_path, str):
            if os.path.exists(policy_or_path):
                with open(policy_or_path, "r", encoding="utf-8") as f:
                    policy = json.load(f)
            else:
                try:
                    policy = json.loads(policy_or_path)
                except Exception as e:
                    clean_err = redact_secrets(str(e))
                    raise PolicyValidationError(f"Could not load policy from path or string: {clean_err}")
        else:
            policy = policy_or_path

        valid, errors = self.validate_policy(policy)
        if not valid:
            pol_id = redact_secrets(str(policy.get("id", "unknown")))
            clean_errors = [redact_secrets(e) for e in errors]
            raise PolicyValidationError(
                f"Policy validation failed for '{pol_id}': {', '.join(clean_errors)}",
                errors=clean_errors,
            )
        return policy

    def normalize_asset(
        self, raw_asset: Dict[str, Any], default_context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Normalizes CBOM components, findings, or plain assets into a canonical asset representation.
        """
        ctx = default_context or {}
        asset_id = (
            raw_asset.get("asset_id")
            or raw_asset.get("id")
            or raw_asset.get("bom-ref")
            or raw_asset.get("name")
            or "asset-unknown"
        )
        asset_name = raw_asset.get("name") or raw_asset.get("algorithm") or raw_asset.get("title") or asset_id
        asset_type = raw_asset.get("type") or raw_asset.get("asset_type") or "algorithm"

        # Key sizes
        key_size = raw_asset.get("key_size") or raw_asset.get("keyLength") or raw_asset.get("bits")
        if key_size is not None:
            try:
                key_size = int(key_size)
            except (ValueError, TypeError):
                key_size = None

        curve = raw_asset.get("curve") or raw_asset.get("elliptic_curve") or raw_asset.get("curveName")

        # Protocols
        protocol = raw_asset.get("protocol") or raw_asset.get("protocol_version") or raw_asset.get("tls_version")
        cipher_suite = raw_asset.get("cipher_suite") or raw_asset.get("cipherSuite")

        # Certificates
        cert_info = raw_asset.get("certificate") or raw_asset.get("cryptoProperties", {}).get("certificate", {})
        is_self_signed = (
            raw_asset.get("is_self_signed")
            or cert_info.get("is_self_signed")
            or (
                raw_asset.get("issuer")
                and raw_asset.get("subject")
                and raw_asset.get("issuer") == raw_asset.get("subject")
            )
            or False
        )
        validity_days = raw_asset.get("validity_days") or cert_info.get("validity_days")
        has_ct_logs = raw_asset.get("has_ct_logs", cert_info.get("has_ct_logs", False))
        sig_algo = (
            raw_asset.get("signature_algorithm") or cert_info.get("signature_algorithm") or raw_asset.get("sig_algo")
        )

        # PQC & Quantum
        pqc_type = raw_asset.get("pqc_type") or raw_asset.get("quantum_category")
        is_quantum_safe = (
            raw_asset.get("is_quantum_safe")
            or raw_asset.get("quantum_safe")
            or (pqc_type in ["pqc", "hybrid", "quantum_resistant"])
            or False
        )

        algo_upper = str(raw_asset.get("algorithm") or asset_name).upper()
        if not is_quantum_safe:
            qs_patterns = [
                "ML-KEM",
                "ML-DSA",
                "SLH-DSA",
                "FALCON",
                "SPHINCS",
                "KYBER",
                "DILITHIUM",
                "AES-256",
                "CHACHA20",
                "SHA-256",
                "SHA-384",
                "SHA-512",
                "SHA3",
            ]
            if any(p in algo_upper for p in qs_patterns):
                is_quantum_safe = True

        is_hybrid = raw_asset.get("is_hybrid") or (pqc_type == "hybrid") or False
        mosca_gap = raw_asset.get("mosca_gap_years") or raw_asset.get("mosca", {}).get("gap_years")
        if mosca_gap is not None:
            try:
                mosca_gap = float(mosca_gap)
            except (ValueError, TypeError):
                mosca_gap = None

        # Contextual scopes
        env = raw_asset.get("environment") or ctx.get("environment") or "production"
        app = raw_asset.get("application") or raw_asset.get("app") or ctx.get("application") or "default-app"
        bu = raw_asset.get("business_unit") or raw_asset.get("bu") or ctx.get("business_unit") or "general"

        return {
            "asset_id": str(asset_id),
            "name": str(asset_name),
            "asset_type": str(asset_type).lower(),
            "algorithm": algo_upper,
            "key_size": key_size,
            "curve": str(curve).lower() if curve else None,
            "protocol": str(protocol) if protocol else None,
            "cipher_suite": str(cipher_suite) if cipher_suite else None,
            "is_self_signed": bool(is_self_signed),
            "validity_days": int(validity_days) if validity_days is not None else None,
            "has_ct_logs": bool(has_ct_logs),
            "signature_algorithm": str(sig_algo) if sig_algo else None,
            "is_quantum_safe": bool(is_quantum_safe),
            "is_hybrid": bool(is_hybrid),
            "mosca_gap_years": mosca_gap,
            "environment": str(env).lower(),
            "application": str(app),
            "business_unit": str(bu),
            "raw": raw_asset,
        }

    def _matches_scope(self, rule_or_exc: Dict[str, Any], asset: Dict[str, Any]) -> bool:
        """Determines whether a rule or exception applies to the asset's environment, application, and business unit."""
        scope = rule_or_exc.get("scope", rule_or_exc)

        # Environment match
        envs = scope.get("environments")
        if envs is None and "environment" in scope:
            envs = [scope["environment"]]
        if envs and not _matches_pattern_or_set(asset["environment"], envs):
            return False

        # Application match
        apps = scope.get("applications")
        if apps is None and "application" in scope:
            apps = [scope["application"]]
        if apps and not _matches_pattern_or_set(asset["application"], apps):
            return False

        # Business Unit match
        bus = scope.get("business_units")
        if bus is None and "business_unit" in scope:
            bus = [scope["business_unit"]]
        if bus and not _matches_pattern_or_set(asset["business_unit"], bus):
            return False

        # Asset type match
        types = scope.get("asset_types")
        if types and not _matches_pattern_or_set(asset["asset_type"], types):
            return False

        return True

    def _find_matching_exception(
        self,
        rule: Dict[str, Any],
        asset: Dict[str, Any],
        exceptions: List[Dict[str, Any]],
        eval_time: datetime,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """
        Locates an active approved exception for the asset and rule.
        Returns (exception_obj, expiry_status_note).
        """
        for exc in exceptions:
            # Match rule_id
            rule_id_pat = exc.get("rule_id", "*")
            if rule_id_pat != "*" and rule_id_pat != rule["id"]:
                continue

            # Match asset_id
            asset_id_pat = exc.get("asset_id", "*")
            if asset_id_pat != "*" and not _matches_pattern_or_set(asset["asset_id"], [asset_id_pat]):
                continue

            # Match scope (env, app, BU)
            if not self._matches_scope(exc, asset):
                continue

            status = (exc.get("status") or "APPROVED").upper()
            if status == "EXPIRED":
                return None, f"Exception {exc['id']} has EXPIRED status"
            if status != "APPROVED":
                continue

            # Check dates
            valid_from = _normalize_date(exc.get("valid_from"))
            expires_at = _normalize_date(exc.get("expires_at"))

            if valid_from and eval_time < valid_from:
                return None, f"Exception {exc['id']} not yet valid (starts {valid_from.isoformat()})"

            if expires_at and eval_time > expires_at:
                return None, f"Exception {exc['id']} EXPIRED on {expires_at.isoformat()}"

            # Valid, active, approved exception matched!
            return exc, None

        return None, None

    def evaluate_rule_on_asset(
        self,
        rule: Dict[str, Any],
        asset: Dict[str, Any],
        eval_time: datetime,
    ) -> Optional[Dict[str, Any]]:
        """
        Evaluates a single rule against a single normalized asset.
        Returns violation details dict if violated, or None if compliant / non-applicable.
        """
        if not self._matches_scope(rule, asset):
            return None

        violations = []
        algo = asset["algorithm"]
        key_size = asset["key_size"]

        # 1. Algorithm Rules
        if "algorithms" in rule:
            alg_rule = rule["algorithms"]
            prohibited = [p.upper() for p in alg_rule.get("prohibited", [])]
            for p in prohibited:
                if p == algo or (p in algo):
                    violations.append(f"Algorithm '{algo}' is prohibited by policy")
                    break

            allowed = [a.upper() for a in alg_rule.get("allowed", [])]
            if allowed and not any((a == algo or a in algo) for a in allowed):
                violations.append(f"Algorithm '{algo}' is not in allowed algorithm list")

            if alg_rule.get("require_quantum_resistant") and not asset["is_quantum_safe"]:
                violations.append(f"Algorithm '{algo}' is classical and policy requires quantum resistance")

        # 2. Key Sizes
        if "key_sizes" in rule:
            ks_rule = rule["key_sizes"]
            if (
                "RSA" in algo or asset["asset_type"] in ["key", "asymmetric_key", "certificate"]
            ) and key_size is not None:
                min_rsa = ks_rule.get("min_rsa_bits")
                if min_rsa and "RSA" in algo and key_size < min_rsa:
                    violations.append(f"RSA key size {key_size} bits is below minimum required {min_rsa} bits")

            if ("ECC" in algo or "ECDSA" in algo or "ECDH" in algo) and key_size is not None:
                min_ecc = ks_rule.get("min_ecc_bits")
                if min_ecc and key_size < min_ecc:
                    violations.append(f"ECC key size {key_size} bits is below minimum required {min_ecc} bits")

            if ("DH" in algo or "DIFFIE" in algo) and key_size is not None:
                min_dh = ks_rule.get("min_dh_bits")
                if min_dh and key_size < min_dh:
                    violations.append(
                        f"Diffie-Hellman key size {key_size} bits is below minimum required {min_dh} bits"
                    )

            if ("AES" in algo or "CHACHA" in algo) and key_size is not None:
                min_sym = ks_rule.get("min_symmetric_bits")
                if min_sym and key_size < min_sym:
                    violations.append(f"Symmetric key size {key_size} bits is below minimum required {min_sym} bits")

            # Curves
            if asset.get("curve"):
                allowed_curves = [c.lower() for c in ks_rule.get("allowed_curves", [])]
                if allowed_curves and asset["curve"] not in allowed_curves:
                    violations.append(f"Curve '{asset['curve']}' is not in approved curve list")

                prohibited_curves = [c.lower() for c in ks_rule.get("prohibited_curves", [])]
                if prohibited_curves and asset["curve"] in prohibited_curves:
                    violations.append(f"Curve '{asset['curve']}' is prohibited by policy")

        # 3. Protocols & Cipher Suites
        if "protocols" in rule:
            proto_rule = rule["protocols"]
            proto = asset.get("protocol")
            if proto:
                prohibited_versions = proto_rule.get("prohibited_versions", [])
                for pv in prohibited_versions:
                    if pv.lower() == proto.lower() or (pv.lower() in proto.lower()):
                        violations.append(f"Protocol '{proto}' is deprecated and prohibited")
                        break

                allowed_versions = proto_rule.get("allowed_versions", [])
                if allowed_versions and not any(av.lower() in proto.lower() for av in allowed_versions):
                    violations.append(f"Protocol '{proto}' is not in allowed protocols {allowed_versions}")

            cipher = asset.get("cipher_suite")
            if cipher:
                prohibited_ciphers = proto_rule.get("prohibited_cipher_suites", [])
                for pc in prohibited_ciphers:
                    if _matches_pattern_or_set(cipher, [pc]):
                        violations.append(f"Cipher suite '{cipher}' matches prohibited pattern '{pc}'")
                        break

        # 4. Certificates
        if "certificates" in rule:
            cert_rule = rule["certificates"]
            if asset["is_self_signed"] and not cert_rule.get("allow_self_signed", True):
                violations.append("Self-signed certificate is strictly prohibited in this environment")

            max_days = cert_rule.get("max_validity_days")
            if max_days and asset.get("validity_days") and asset["validity_days"] > max_days:
                violations.append(f"Certificate validity {asset['validity_days']} days exceeds maximum {max_days} days")

            if cert_rule.get("require_ct_logs") and not asset["has_ct_logs"]:
                violations.append("Certificate Transparency (CT) logs are required but missing")

            sig_algo = asset.get("signature_algorithm")
            if sig_algo:
                proh_sigs = [s.upper() for s in cert_rule.get("prohibited_signature_algorithms", [])]
                for ps in proh_sigs:
                    if ps in sig_algo.upper():
                        violations.append(f"Certificate signature algorithm '{sig_algo}' is prohibited")
                        break

        # 5. PQC Requirements
        if "pqc_requirements" in rule:
            pqc_rule = rule["pqc_requirements"]
            if pqc_rule.get("require_pqc") and not asset["is_quantum_safe"]:
                violations.append("Asset lacks required Post-Quantum Cryptographic protection")

            if (
                pqc_rule.get("require_hybrid")
                and not asset["is_hybrid"]
                and asset["asset_type"] in ["key_exchange", "protocol", "kex", "key_establishment"]
            ):
                violations.append("Policy requires hybrid classical + post-quantum key exchange")

            max_gap = pqc_rule.get("max_mosca_gap_years")
            if max_gap is not None and asset.get("mosca_gap_years") is not None:
                if asset["mosca_gap_years"] > max_gap:
                    violations.append(
                        f"Mosca quantum deficit gap ({asset['mosca_gap_years']:.1f} years) exceeds policy threshold ({max_gap:.1f} years)"
                    )

        if not violations:
            return None

        # Deadlines & Escalation
        raw_action = rule.get("action", "BLOCK").upper()
        if "deadlines" in rule:
            deadlines = rule["deadlines"]
            enf_date = _normalize_date(deadlines.get("enforcement_date"))
            dep_date = _normalize_date(deadlines.get("deprecation_date"))

            # If before deprecation, soft action
            if dep_date and eval_time < dep_date:
                raw_action = "WARN"
            # If on/after enforcement deadline, escalate to BLOCK
            elif enf_date and eval_time >= enf_date:
                raw_action = "BLOCK"

        return {
            "rule_id": rule["id"],
            "rule_name": rule["name"],
            "category": rule["category"],
            "action": raw_action,
            "severity": rule.get("severity", "HIGH"),
            "remediation_guidance": rule.get("remediation_guidance", ""),
            "reasons": violations,
        }

    def evaluate(
        self,
        assets_or_cbom: Union[List[Dict[str, Any]], Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None,
        policy: Optional[Union[str, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Executes deterministic evaluation of assets against the policy.
        Returns structured decision, metrics, explainability, and SHA-256 audit digest.
        """
        ctx = dict(context or {})
        eval_time = _normalize_date(ctx.get("evaluation_date")) or datetime.now(timezone.utc)

        # 1. Resolve Policy
        if policy is None:
            active_policy = self.load_policy(DEFAULT_POLICY_PATH)
        else:
            active_policy = self.load_policy(policy)

        rules: List[Dict[str, Any]] = sorted(active_policy.get("rules", []), key=lambda r: str(r.get("id")))
        exceptions: List[Dict[str, Any]] = sorted(active_policy.get("exceptions", []), key=lambda e: str(e.get("id")))

        # 2. Extract & Normalize Assets
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

        normalized_assets = [self.normalize_asset(a, default_context=ctx) for a in raw_list]
        normalized_assets.sort(key=lambda a: a["asset_id"])

        # 3. Deterministic Evaluation Loop
        evaluated_assets = []
        rule_evaluations = []
        applied_exceptions = []
        expired_exceptions = []

        overall_verdicts = []

        for asset in normalized_assets:
            asset_rule_results = []
            asset_verdict = "ALLOW"

            for rule in rules:
                violation = self.evaluate_rule_on_asset(rule, asset, eval_time)
                if not violation:
                    continue

                raw_action = violation["action"]

                # Check for active exception
                matching_exc, exc_status_note = self._find_matching_exception(rule, asset, exceptions, eval_time)

                if matching_exc:
                    final_action = "EXCEPTION"
                    exc_record = {
                        "exception_id": matching_exc["id"],
                        "rule_id": rule["id"],
                        "asset_id": asset["asset_id"],
                        "reason": matching_exc["reason"],
                        "approved_by": matching_exc["approved_by"],
                        "expires_at": matching_exc["expires_at"],
                        "compensating_controls": matching_exc.get("compensating_controls", []),
                    }
                    if exc_record not in applied_exceptions:
                        applied_exceptions.append(exc_record)
                else:
                    final_action = raw_action
                    if exc_status_note and "EXPIRED" in exc_status_note:
                        expired_exceptions.append(
                            {
                                "rule_id": rule["id"],
                                "asset_id": asset["asset_id"],
                                "note": exc_status_note,
                            }
                        )

                rule_record = {
                    "rule_id": rule["id"],
                    "rule_name": rule["name"],
                    "category": rule["category"],
                    "raw_action": raw_action,
                    "final_action": final_action,
                    "severity": violation["severity"],
                    "reasons": violation["reasons"],
                    "remediation": violation["remediation_guidance"],
                    "exception_applied": matching_exc["id"] if matching_exc else None,
                }
                asset_rule_results.append(rule_record)
                rule_evaluations.append({"asset_id": asset["asset_id"], **rule_record})

            # Asset-level precedence resolution: BLOCK > WARN > EXCEPTION > ALLOW
            if any(r["final_action"] == "BLOCK" for r in asset_rule_results):
                asset_verdict = "BLOCK"
            elif any(r["final_action"] == "WARN" for r in asset_rule_results):
                asset_verdict = "WARN"
            elif any(r["final_action"] == "EXCEPTION" for r in asset_rule_results):
                asset_verdict = "EXCEPTION"
            else:
                asset_verdict = "ALLOW"

            overall_verdicts.append(asset_verdict)
            evaluated_assets.append(
                {
                    "asset_id": asset["asset_id"],
                    "name": asset["name"],
                    "verdict": asset_verdict,
                    "environment": asset["environment"],
                    "application": asset["application"],
                    "business_unit": asset["business_unit"],
                    "violations_count": len(asset_rule_results),
                    "rule_results": asset_rule_results,
                }
            )

        # 4. Evaluation-Level Precedence Resolution
        if any(v == "BLOCK" for v in overall_verdicts):
            policy_verdict = "BLOCK"
        elif any(v == "WARN" for v in overall_verdicts):
            policy_verdict = "WARN"
        elif any(v == "EXCEPTION" for v in overall_verdicts):
            policy_verdict = "EXCEPTION"
        else:
            policy_verdict = "ALLOW"

        # Passed boolean definition
        # ALLOW passes; EXCEPTION passes under conditional supervision; WARN passes unless fail_on_warn is configured; BLOCK fails.
        passed = policy_verdict != "BLOCK"
        if ctx.get("fail_on_warn") and policy_verdict == "WARN":
            passed = False

        # Counts
        block_count = sum(1 for v in overall_verdicts if v == "BLOCK")
        warn_count = sum(1 for v in overall_verdicts if v == "WARN")
        exception_count = sum(1 for v in overall_verdicts if v == "EXCEPTION")
        allow_count = sum(1 for v in overall_verdicts if v == "ALLOW")

        # 5. Deterministic SHA-256 Audit Digest
        canonical_summary = {
            "policy_id": active_policy.get("id"),
            "policy_version": active_policy.get("version"),
            "evaluation_time": eval_time.isoformat(),
            "total_assets": len(evaluated_assets),
            "verdict": policy_verdict,
            "block_count": block_count,
            "warn_count": warn_count,
            "exception_count": exception_count,
            "allow_count": allow_count,
            "asset_verdicts": sorted([f"{a['asset_id']}={a['verdict']}" for a in evaluated_assets]),
        }
        digest = hashlib.sha256(json.dumps(canonical_summary, sort_keys=True).encode("utf-8")).hexdigest()

        return {
            "policy_id": active_policy.get("id"),
            "policy_name": active_policy.get("name"),
            "policy_version": active_policy.get("version"),
            "evaluation_timestamp": eval_time.isoformat(),
            "verdict": policy_verdict,
            "passed": passed,
            "metrics": {
                "total_assets_evaluated": len(evaluated_assets),
                "total_rules_evaluated": len(rules),
                "total_violations_found": len(rule_evaluations),
                "counts_by_verdict": {
                    "BLOCK": block_count,
                    "WARN": warn_count,
                    "EXCEPTION": exception_count,
                    "ALLOW": allow_count,
                },
            },
            "assets": evaluated_assets,
            "applied_exceptions": applied_exceptions,
            "expired_exceptions": expired_exceptions,
            "audit_digest": digest,
        }


if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="ECDAT Policy-as-Code Engine CLI")
    parser.add_argument("cbom_file", help="Path to CycloneDX CBOM or asset JSON file")
    parser.add_argument("--policy", default=None, help="Path to custom policy JSON file")
    parser.add_argument("--env", default="production", help="Environment (default: production)")
    parser.add_argument("--app", default="default-app", help="Application name/ID")
    parser.add_argument("--bu", default="general", help="Business unit")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")
    args = parser.parse_args()

    engine = PolicyEngine()
    with open(args.cbom_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    ctx = {"environment": args.env, "application": args.app, "business_unit": args.bu}
    res = engine.evaluate(data, context=ctx, policy=args.policy)

    if args.json:
        print(json.dumps(res, indent=2))
    else:
        print(f"Policy: {res['policy_name']} ({res['policy_version']})")
        print(f"Verdict: {res['verdict']} | Passed: {res['passed']}")
        print(f"Metrics: {res['metrics']['counts_by_verdict']}")
        print(f"Audit Digest: {res['audit_digest']}")

    sys.exit(0 if res["passed"] else 1)
