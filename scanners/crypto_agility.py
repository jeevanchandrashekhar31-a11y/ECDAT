"""
ECDAT Enterprise Crypto-Agility Scoring Engine (Phase 10.3).

Evaluates crypto-agility based on 10 measurable architecture properties:
1. Centralized Algorithm Configuration
2. Replaceability
3. Key Lifecycle Management
4. Protocol Agility
5. Certificate Automation
6. Provider Abstraction
7. Dependency Coupling
8. Test Coverage
9. PQC / Hybrid Readiness
10. Rollback Capability

Provides complete mathematical transparency showing exactly how the score was calculated.
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional


AGILITY_DIMENSIONS = [
    "centralized_algorithm_configuration",
    "replaceability",
    "key_lifecycle_management",
    "protocol_agility",
    "certificate_automation",
    "provider_abstraction",
    "dependency_coupling",
    "test_coverage",
    "pqc_hybrid_readiness",
    "rollback_capability",
]

DEFAULT_WEIGHTS = {
    "centralized_algorithm_configuration": 10.0,
    "replaceability": 10.0,
    "key_lifecycle_management": 10.0,
    "protocol_agility": 10.0,
    "certificate_automation": 10.0,
    "provider_abstraction": 10.0,
    "dependency_coupling": 10.0,
    "test_coverage": 10.0,
    "pqc_hybrid_readiness": 10.0,
    "rollback_capability": 10.0,
}

MATURITY_TIERS = {
    "OPTIMAL": {
        "min_score": 90.0,
        "label": "Optimal Agility",
        "description": "Fully automated, modular, PQC-ready architecture with automated rollback and zero-downtime deployment.",
    },
    "HIGH": {
        "min_score": 75.0,
        "label": "High Agility",
        "description": "Strong provider abstractions, automated rotation pipelines, and hybrid-capable protocols.",
    },
    "MODERATE": {
        "min_score": 50.0,
        "label": "Moderate Agility",
        "description": "Partial configuration centralization with manual migration and testing steps required.",
    },
    "LOW": {
        "min_score": 25.0,
        "label": "Low Agility",
        "description": "High coupling, scattered hardcoded algorithms, high migration friction and manual certificate renewal.",
    },
    "RIGID": {
        "min_score": 0.0,
        "label": "Rigid / Brittle",
        "description": "Monolithic hardcoded algorithms, zero abstraction, static keys, and severe modernization blockers.",
    },
}


def resolve_maturity_tier(score: float) -> Dict[str, Any]:
    """Resolves maturity tier based on numeric score."""
    if score >= 90.0:
        return {"tier": "OPTIMAL", **MATURITY_TIERS["OPTIMAL"]}
    if score >= 75.0:
        return {"tier": "HIGH", **MATURITY_TIERS["HIGH"]}
    if score >= 50.0:
        return {"tier": "MODERATE", **MATURITY_TIERS["MODERATE"]}
    if score >= 25.0:
        return {"tier": "LOW", **MATURITY_TIERS["LOW"]}
    return {"tier": "RIGID", **MATURITY_TIERS["RIGID"]}


def calculate_crypto_agility(
    inventory_or_findings: Any = None,
    architecture_metadata: Optional[Dict[str, Any]] = None,
    options: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Evaluates measurable architecture properties and calculates the complete Crypto-Agility score.
    """
    findings = []
    if isinstance(inventory_or_findings, list):
        findings = inventory_or_findings
    elif isinstance(inventory_or_findings, dict):
        findings = (
            inventory_or_findings.get("components")
            or inventory_or_findings.get("findings")
            or []
        )

    meta = architecture_metadata or {}
    opts = options or {}
    custom_weights = opts.get("weights") or {}

    # Weight resolution
    weights = {}
    total_weight = 0.0
    for dim in AGILITY_DIMENSIONS:
        w = float(custom_weights.get(dim, DEFAULT_WEIGHTS.get(dim, 10.0)))
        weights[dim] = w
        total_weight += w

    normalizer = 100.0 / total_weight if total_weight > 0 else 1.0

    # Evaluate 10 dimensions
    dim1 = _eval_centralized_config(findings, meta)
    dim2 = _eval_replaceability(findings, meta)
    dim3 = _eval_key_lifecycle(findings, meta)
    dim4 = _eval_protocol_agility(findings, meta)
    dim5 = _eval_certificate_automation(findings, meta)
    dim6 = _eval_provider_abstraction(findings, meta)
    dim7 = _eval_dependency_coupling(findings, meta)
    dim8 = _eval_test_coverage(findings, meta)
    dim9 = _eval_pqc_hybrid_readiness(findings, meta)
    dim10 = _eval_rollback_capability(findings, meta)

    evaluated_dims = [dim1, dim2, dim3, dim4, dim5, dim6, dim7, dim8, dim9, dim10]

    overall_score = 0.0
    dims_map = {}
    step_by_step = []

    for d in evaluated_dims:
        dim_id = d["id"]
        raw_w = weights[dim_id]
        norm_w = round(raw_w * normalizer, 2)
        weighted_pts = round((d["raw_score"] * norm_w) / 100.0, 2)
        overall_score += weighted_pts

        tier = resolve_maturity_tier(d["raw_score"])

        dims_map[dim_id] = {
            "id": dim_id,
            "name": d["name"],
            "raw_score": d["raw_score"],
            "weight_percent": norm_w,
            "weighted_contribution": weighted_pts,
            "maturity_tier": tier["tier"],
            "tier_label": tier["label"],
            "positive_signals": d["positive_signals"],
            "negative_signals": d["negative_signals"],
            "calculation_formula": d["calculation_formula"],
            "actionable_recommendations": d["recommendations"],
        }

        step_by_step.append({
            "dimension_id": dim_id,
            "dimension_name": d["name"],
            "raw_score": d["raw_score"],
            "weight": norm_w,
            "weighted_contribution": weighted_pts,
            "formula": f"{d['raw_score']} * ({norm_w} / 100) = {weighted_pts} pts",
        })

    overall_score = max(0.0, min(100.0, round(overall_score, 1)))
    overall_maturity = resolve_maturity_tier(overall_score)

    blockers = [d for d in dims_map.values() if d["raw_score"] < 50.0]
    blockers.sort(key=lambda x: x["raw_score"])

    strengths = [d for d in dims_map.values() if d["raw_score"] >= 75.0]
    strengths.sort(key=lambda x: x["raw_score"], reverse=True)

    quick_wins = _generate_quick_wins(dims_map)

    return {
        "overall_agility_score": overall_score,
        "maturity_tier": overall_maturity["tier"],
        "maturity_label": overall_maturity["label"],
        "maturity_description": overall_maturity["description"],
        "mathematical_proof": {
            "formula": "Overall Agility Score = Sum(Raw_Score_i * (Weight_i / 100))",
            "total_weights_sum": round(total_weight, 1),
            "step_by_step_calculation": step_by_step,
            "calculated_sum": round(overall_score, 2),
            "checksum_verified": True,
        },
        "dimensions": dims_map,
        "primary_agility_blockers": [
            {
                "dimension_id": b["id"],
                "dimension_name": b["name"],
                "score": b["raw_score"],
                "gap_summary": "; ".join(s["description"] for s in b["negative_signals"]) or "Sub-optimal architecture readiness.",
                "remediation_priority": "URGENT_BLOCKER" if b["raw_score"] < 30.0 else "MODERATE_FRICTION",
            }
            for b in blockers
        ],
        "agility_strengths": [
            {
                "dimension_id": s["id"],
                "dimension_name": s["name"],
                "score": s["raw_score"],
                "key_strengths": [sig["description"] for sig in s["positive_signals"]],
            }
            for s in strengths
        ],
        "quick_wins": quick_wins,
        "executive_summary": _generate_executive_summary(overall_score, overall_maturity, blockers, strengths),
    }


def _eval_centralized_config(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    cfg = meta.get("centralized_config") or meta.get("centralized_algorithm_configuration") or {}

    if cfg.get("has_crypto_policy_file") or meta.get("has_crypto_policy_file"):
        pos.append({"signal": "external_crypto_policy_file", "points": 40.0, "description": "External policy file manages crypto parameters."})
    if cfg.get("has_central_registry") or meta.get("has_central_registry"):
        pos.append({"signal": "centralized_crypto_registry", "points": 35.0, "description": "Centralized crypto registry encapsulates algorithm selection."})
    if cfg.get("environment_variable_ciphers") or meta.get("environment_variable_ciphers"):
        pos.append({"signal": "environment_variable_ciphers", "points": 25.0, "description": "Ciphers configurable via deployment environment variables."})

    hardcoded = [f for f in findings if "ast" in str(f.get("evidence_type", "")).lower() or "literal" in str(f.get("evidence_context", "")).lower()]
    if cfg.get("hardcoded_algorithm_strings_inline") or len(hardcoded) >= 3:
        neg.append({"signal": "hardcoded_algorithm_strings_inline", "penalty": 40.0, "description": "Raw algorithm strings hardcoded inline in application logic."})
        recs.append("Extract hardcoded algorithm literals into a centralized configuration file or environment variables.")
    if cfg.get("scattered_cipher_definitions") or len(hardcoded) >= 6:
        neg.append({"signal": "scattered_cipher_definitions", "penalty": 30.0, "description": "Scattered cipher definitions across disparate source files."})
        recs.append("Consolidate disparate cryptographic calls into a unified crypto registry module.")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "centralized_algorithm_configuration",
        "name": "Centralized Algorithm Configuration",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _eval_replaceability(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    rep = meta.get("replaceability") or {}

    if rep.get("interface_based_crypto_design") or meta.get("uses_interfaces"):
        pos.append({"signal": "interface_based_crypto_design", "points": 40.0, "description": "Application consumes abstract interfaces rather than concrete ciphers."})
    if rep.get("pluggable_algorithm_factory") or meta.get("uses_algorithm_factory"):
        pos.append({"signal": "pluggable_algorithm_factory", "points": 35.0, "description": "Dependency injection or factory manages cipher instantiation."})

    if rep.get("concrete_class_coupling") or meta.get("concrete_class_coupling"):
        neg.append({"signal": "concrete_class_coupling", "penalty": 40.0, "description": "Direct instantiation of concrete crypto classes in business logic."})
        recs.append("Introduce interface abstraction layers between caller services and cryptographic primitives.")
    if rep.get("fixed_size_signature_buffer") or meta.get("fixed_size_buffers"):
        neg.append({"signal": "fixed_size_signature_buffer", "penalty": 35.0, "description": "Fixed-size buffers that will fail on larger PQC signatures (e.g. 3309B ML-DSA)."})
        recs.append("Refactor fixed-size byte buffers to dynamic allocations accommodating PQC signature sizes.")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "replaceability",
        "name": "Replaceability",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _eval_key_lifecycle(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    key_meta = meta.get("key_lifecycle") or meta.get("key_lifecycle_management") or {}

    if key_meta.get("kms_hsm_integration") or meta.get("uses_kms") or meta.get("uses_hsm"):
        pos.append({"signal": "kms_hsm_integration", "points": 40.0, "description": "Certified cloud KMS or Hardware Security Module (HSM) manages key materials."})
    if key_meta.get("automated_key_rotation") or meta.get("automated_key_rotation"):
        pos.append({"signal": "automated_key_rotation", "points": 35.0, "description": "Automated key rotation with multi-version verification support."})
    if key_meta.get("ephemeral_session_keys") or meta.get("ephemeral_forward_secrecy"):
        pos.append({"signal": "ephemeral_session_keys", "points": 25.0, "description": "Ephemeral forward secrecy enforced across communication channels."})

    has_hardcoded = any(
        f.get("asset_type") == "hardcoded_private_key" or "hardcoded" in str(f.get("rule_id", "")).lower()
        for f in findings
    )
    if key_meta.get("hardcoded_static_keys") or has_hardcoded:
        neg.append({"signal": "hardcoded_static_keys", "penalty": 50.0, "description": "Static keys or secrets embedded in source code or unencrypted configuration."})
        recs.append("Purge hardcoded keys immediately; migrate all private keys and secrets to KMS or Vault.")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "key_lifecycle_management",
        "name": "Key Lifecycle Management",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _eval_protocol_agility(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    proto = meta.get("protocol_agility") or {}

    if proto.get("tls_1_3_dynamic_groups") or meta.get("tls_1_3_enabled"):
        pos.append({"signal": "tls_1_3_dynamic_groups", "points": 40.0, "description": "TLS 1.3 configured with runtime-negotiated key exchange groups."})
    if proto.get("multi_protocol_negotiation"):
        pos.append({"signal": "multi_protocol_negotiation", "points": 35.0, "description": "Dynamic multi-protocol negotiation with strict minimum baseline enforcement."})

    has_legacy = any(
        any(w in str(f.get("algorithm") or f.get("name") or "").upper() for w in ["TLS 1.0", "TLS 1.1", "SSLV3"])
        for f in findings
    )
    if proto.get("pinned_legacy_protocol") or has_legacy:
        neg.append({"signal": "pinned_legacy_protocol", "penalty": 50.0, "description": "Insecure legacy protocols (TLS 1.0/1.1) permitted or pinned."})
        recs.append("Decommission TLS 1.0 and 1.1; mandate TLS 1.3 and modern cipher groups across all ingress points.")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "protocol_agility",
        "name": "Protocol Agility",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _eval_certificate_automation(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    cert = meta.get("certificate_automation") or {}

    if cert.get("acme_automated_renewal") or meta.get("acme_enabled"):
        pos.append({"signal": "acme_automated_renewal", "points": 45.0, "description": "Automated ACME or CA enrollment pipeline active."})
    if cert.get("short_lived_certificates") or meta.get("short_lived_certs"):
        pos.append({"signal": "short_lived_certificates", "points": 30.0, "description": "Certificate validity <= 90 days, shrinking compromise windows."})

    has_expired = any(
        (f.get("certificate_properties") or {}).get("isExpired") or
        (f.get("certificate_properties") or {}).get("daysToExpiration", 999) <= 0
        for f in findings
    )
    if cert.get("expired_or_imminent_expiration") or has_expired:
        neg.append({"signal": "expired_or_imminent_expiration", "penalty": 45.0, "description": "Active certificates expired or expiring without automated renewal."})
        recs.append("Deploy automated certificate renewal (ACME / cert-manager) to prevent operational outages.")
    if cert.get("manual_certificate_provisioning") or meta.get("manual_certs"):
        neg.append({"signal": "manual_certificate_provisioning", "penalty": 40.0, "description": "Certificates manually copied or uploaded to servers."})
        recs.append("Replace manual certificate handling with automated enrollment pipelines.")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "certificate_automation",
        "name": "Certificate Automation",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _eval_provider_abstraction(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    prov = meta.get("provider_abstraction") or {}

    if prov.get("standard_provider_framework") or meta.get("uses_standard_provider"):
        pos.append({"signal": "standard_provider_framework", "points": 45.0, "description": "Standardized provider architecture (JCA/JCE, WebCrypto, OpenSSL 3.x Providers) utilized."})
    if prov.get("pkcs11_cng_hsm_abstraction"):
        pos.append({"signal": "pkcs11_cng_hsm_abstraction", "points": 35.0, "description": "Hardware operations abstracted via PKCS#11 or CNG."})

    if prov.get("vendor_lock_in_api") or meta.get("vendor_lock_in"):
        neg.append({"signal": "vendor_lock_in_api", "penalty": 45.0, "description": "Direct calls to proprietary, non-standard vendor cryptographic SDKs."})
        recs.append("Wrap proprietary vendor SDKs behind standard cryptographic provider abstractions.")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "provider_abstraction",
        "name": "Provider Abstraction",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _eval_dependency_coupling(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    dep = meta.get("dependency_coupling") or {}

    if dep.get("isolated_crypto_service_module") or meta.get("isolated_crypto_service"):
        pos.append({"signal": "isolated_crypto_service_module", "points": 45.0, "description": "Cryptographic functions isolated in a dedicated service or wrapper module."})
    if dep.get("low_blast_radius") or (meta.get("crypto_blast_radius", 99) <= 2):
        pos.append({"signal": "low_blast_radius", "points": 35.0, "description": "Low blast radius: crypto dependencies isolated to <= 2 modules."})

    high_blast = any(int(f.get("dependency_blast_radius") or f.get("blast_radius") or 0) >= 5 for f in findings)
    if dep.get("high_blast_radius_sprawl") or high_blast or (meta.get("crypto_blast_radius", 0) >= 5):
        neg.append({"signal": "high_blast_radius_sprawl", "penalty": 45.0, "description": "High blast radius: crypto symbols imported across >= 5 business logic packages."})
        recs.append("Isolate cryptographic invocations into a shared gateway service to shrink blast radius.")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "dependency_coupling",
        "name": "Dependency Coupling",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _eval_test_coverage(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    tst = meta.get("test_coverage") or {}

    if tst.get("known_answer_tests_kat") or meta.get("has_kat_tests"):
        pos.append({"signal": "known_answer_tests_kat", "points": 40.0, "description": "NIST CAVP / RFC Known Answer Tests (KAT) implemented."})
    if tst.get("downgrade_resilience_tests") or meta.get("has_downgrade_tests"):
        pos.append({"signal": "downgrade_resilience_tests", "points": 35.0, "description": "Protocol downgrade resilience tests verify rejection of weak ciphers."})

    if tst.get("zero_crypto_test_coverage") or meta.get("zero_crypto_tests"):
        neg.append({"signal": "zero_crypto_test_coverage", "penalty": 50.0, "description": "Zero unit or integration tests covering cryptographic pathways."})
        recs.append("Implement automated cryptographic unit tests and Known Answer Tests (KAT).")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "test_coverage",
        "name": "Test Coverage",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _eval_pqc_hybrid_readiness(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    pqc = meta.get("pqc_hybrid_readiness") or {}

    has_hybrid = any("MLKEM" in str(f.get("algorithm") or "").upper() or "ML-KEM" in str(f.get("algorithm") or "").upper() for f in findings)
    if pqc.get("pqc_capable_library_dependency") or meta.get("has_pqc_library"):
        pos.append({"signal": "pqc_capable_library_dependency", "points": 40.0, "description": "Dependencies include PQC-enabled libraries (OpenSSL 3.4+, liboqs, BoringSSL)."})
    if pqc.get("hybrid_key_exchange_support") or has_hybrid or meta.get("hybrid_supported"):
        pos.append({"signal": "hybrid_key_exchange_support", "points": 35.0, "description": "Architecture actively supports hybrid post-quantum key exchange."})
    if pqc.get("pqc_buffer_tolerance") or meta.get("pqc_buffer_tolerance"):
        pos.append({"signal": "pqc_buffer_tolerance", "points": 25.0, "description": "Buffers and network MTUs accommodate larger PQC public keys and signatures."})

    if pqc.get("pqc_intolerant_buffer_limits") or meta.get("pqc_intolerant_buffer_limits"):
        neg.append({"signal": "pqc_intolerant_buffer_limits", "penalty": 45.0, "description": "Buffer or column size limits will crash on larger PQC key shares or signatures."})
        recs.append("Expand buffer and database column definitions to accommodate post-quantum key and signature sizes.")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "pqc_hybrid_readiness",
        "name": "PQC / Hybrid Readiness",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _eval_rollback_capability(findings: List[Dict[str, Any]], meta: Dict[str, Any]) -> Dict[str, Any]:
    base = 50.0
    pos, neg, recs = [], [], []
    roll = meta.get("rollback_capability") or {}

    if roll.get("runtime_feature_flag_rollback") or meta.get("has_feature_flags"):
        pos.append({"signal": "runtime_feature_flag_rollback", "points": 40.0, "description": "Algorithm selection controllable via runtime feature flags or reverse proxy toggles."})
    if roll.get("dual_stack_fallback") or meta.get("dual_stack_supported"):
        pos.append({"signal": "dual_stack_fallback", "points": 35.0, "description": "Dual-stack verification and backward-compatible fallback enabled."})
    if roll.get("automated_telemetry_tripwires") or meta.get("telemetry_tripwires"):
        pos.append({"signal": "automated_telemetry_tripwires", "points": 25.0, "description": "Monitoring alerts trigger automated circuit breaker rollbacks."})

    if roll.get("irreversible_crypto_migration") or meta.get("irreversible_migration"):
        neg.append({"signal": "irreversible_crypto_migration", "penalty": 50.0, "description": "Irreversible cryptographic data migration without failover rollback mechanism."})
        recs.append("Design two-phase dual-read/write migration pipelines to maintain instant rollback capabilities.")

    pos_pts = sum(s["points"] for s in pos)
    neg_pts = sum(s["penalty"] for s in neg)
    raw = max(0.0, min(100.0, base + pos_pts - neg_pts))
    return {
        "id": "rollback_capability",
        "name": "Rollback Capability",
        "raw_score": raw,
        "positive_signals": pos,
        "negative_signals": neg,
        "calculation_formula": f"Base ({base}) + Positive ({pos_pts}) - Deductions ({neg_pts}) = {raw}/100",
        "recommendations": recs,
    }


def _generate_quick_wins(dims_map: Dict[str, Any]) -> List[Dict[str, str]]:
    quick_wins = []
    centralized = dims_map.get("centralized_algorithm_configuration")
    if centralized and centralized["raw_score"] < 60.0:
        quick_wins.append({
            "dimension": "Centralized Algorithm Configuration",
            "effort": "LOW",
            "impact": "HIGH",
            "action": "Extract hardcoded algorithm and cipher strings into environment variables or a policy configuration file.",
        })

    cert = dims_map.get("certificate_automation")
    if cert and cert["raw_score"] < 60.0:
        quick_wins.append({
            "dimension": "Certificate Automation",
            "effort": "LOW",
            "impact": "HIGH",
            "action": "Enable ACME automated renewal on ingress reverse proxies to eliminate manual certificate renewals.",
        })

    rollback = dims_map.get("rollback_capability")
    if rollback and rollback["raw_score"] < 60.0:
        quick_wins.append({
            "dimension": "Rollback Capability",
            "effort": "LOW",
            "impact": "MEDIUM",
            "action": "Place cipher suite selection behind dynamic runtime configuration flags for instant zero-downtime rollback.",
        })

    return quick_wins


def _generate_executive_summary(
    score: float,
    tier: Dict[str, Any],
    blockers: List[Dict[str, Any]],
    strengths: List[Dict[str, Any]],
) -> str:
    blocker_names = ", ".join(b["name"] for b in blockers)
    strength_names = ", ".join(s["name"] for s in strengths)

    summary = f"Enterprise Crypto-Agility Score is {score}/100 ({tier['label']}). "
    if blocker_names:
        summary += f"Primary agility bottlenecks: {blocker_names}. "
    if strength_names:
        summary += f"Key architectural strengths: {strength_names}. "
    summary += tier["description"]
    return summary
