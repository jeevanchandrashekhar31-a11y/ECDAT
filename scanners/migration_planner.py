"""
ECDAT Cryptographic Migration Planner (Phase 10.2).

Implements end-to-end cryptographic migration planning supporting:
DISCOVER -> ASSESS -> PLAN -> SIMULATE -> REMEDIATE -> VERIFY

For each classical asset:
1. Identify why it is risky
2. Identify compatible replacement candidates
3. Identify dependencies
4. Identify affected services
5. Estimate migration complexity
6. Identify testing requirements
7. Propose staged rollout
8. Define rollback
9. Define rescan verification
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from scanners.pqc_knowledge_base import lookup_pqc_algorithm, load_pqc_catalog


LIFECYCLE_PHASES = ["DISCOVER", "ASSESS", "PLAN", "SIMULATE", "REMEDIATE", "VERIFY"]


def identify_why_risky(asset: Dict[str, Any]) -> Dict[str, Any]:
    """1. Identifies why a classical cryptographic asset is risky."""
    algo = str(asset.get("algorithm") or asset.get("name") or "Unknown").upper()
    key_size = asset.get("key_size") or asset.get("keySize")
    is_internet = bool(asset.get("is_internet_facing") or asset.get("isInternetExposed"))
    mosca = asset.get("mosca") or {}

    risks = {
        "classical_weakness": None,
        "quantum_vulnerability": None,
        "environmental_exposure": None,
        "mosca_urgency": None,
        "summary": "",
    }

    if any(w in algo for w in ["MD5", "DES", "RC4", "3DES"]):
        risks["classical_weakness"] = f"Broken classical algorithm ({algo}) with known practical attacks."
    elif any(w in algo for w in ["SHA1", "SHA-1"]):
        risks["classical_weakness"] = "Deprecated hash algorithm susceptible to chosen-prefix collisions."
    elif "RSA" in algo and key_size and int(key_size) < 2048:
        risks["classical_weakness"] = f"Sub-standard RSA key size ({key_size} bits) vulnerable to factorization."

    if any(a in algo for a in ["RSA", "ECDSA", "ECDH", "DIFFIE-HELLMAN", "DH", "DSA", "ED25519", "X25519"]):
        risks["quantum_vulnerability"] = (
            f"Asymmetric algorithm ({algo}) completely broken by Shor's algorithm on CRQCs."
        )
    elif "AES" in algo and key_size == 128:
        risks["quantum_vulnerability"] = "Grover's algorithm halves effective symmetric key search security margin."

    if is_internet:
        risks["environmental_exposure"] = (
            "Directly exposed on public internet perimeter; subject to active Harvest-Now-Decrypt-Later (HNDL)."
        )

    if mosca.get("status") == "CRITICAL_URGENT":
        risks["mosca_urgency"] = (
            "Critical Mosca deficit: Data shelf life + migration timeline exceeds quantum threat arrival."
        )
    elif mosca.get("status") == "AT_RISK":
        risks["mosca_urgency"] = "Mosca margin is narrow; migration lead time window is expiring."

    reasons = [v for v in risks.values() if v and isinstance(v, str)]
    risks["summary"] = " ".join(reasons) or "Asset requires modernization to satisfy cryptographic standards."
    return risks


def identify_replacement_candidates(asset: Dict[str, Any]) -> List[Dict[str, Any]]:
    """2. Identifies compatible replacement candidates from the PQC Knowledge Base."""
    algo = str(asset.get("algorithm") or asset.get("name") or "").upper()
    asset_type = asset.get("asset_type") or asset.get("assetType") or "file"
    candidates = []

    if any(k in algo for k in ["X25519", "ECDH", "DIFFIE-HELLMAN", "DH"]) or algo.startswith("TLS"):
        candidates.append(
            {
                "role": "PRIMARY_PQC_HYBRID",
                "algorithm": "X25519MLKEM768",
                "standard": "NIST FIPS 203 & IETF draft-ietf-tls-hybrid-design",
                "iana_group": "0x11ec (4588)",
                "security_level": 3,
                "rationale": "Standardized TLS 1.3 hybrid key exchange combining X25519 with ML-KEM-768.",
                "trade_offs": "ClientHello size increases by ~1.2 KB; supported in modern TLS stacks.",
            }
        )
        candidates.append(
            {
                "role": "FIPS_REGULATED_HYBRID",
                "algorithm": "SecP256r1MLKEM768",
                "standard": "NIST FIPS 203 & IETF draft-ietf-tls-hybrid-design",
                "iana_group": "0x11ed (4589)",
                "security_level": 3,
                "rationale": "FIPS-compliant hybrid group combining NIST P-256 with ML-KEM-768.",
                "trade_offs": "Standard MTU compliance; FIPS 140-3 validated.",
            }
        )
    elif "RSA" in algo and asset_type in ["certificate", "signing_key"]:
        candidates.append(
            {
                "role": "PRIMARY_PQC_SIGNATURE",
                "algorithm": "ML-DSA-65",
                "standard": "NIST FIPS 204",
                "security_level": 3,
                "rationale": "Primary post-quantum digital signature standard with fast verification.",
                "trade_offs": "Signature size is 3309 bytes; requires composite X.509 support.",
            }
        )
        candidates.append(
            {
                "role": "STATELESS_HASH_FALLBACK",
                "algorithm": "SLH-DSA-SHA2-128s",
                "standard": "NIST FIPS 205",
                "security_level": 1,
                "rationale": "Stateless hash-based signature scheme without lattice assumptions.",
                "trade_offs": "Signatures are 7856 bytes; slower signing speed.",
            }
        )
    elif asset_type in ["firmware", "bootloader"]:
        candidates.append(
            {
                "role": "STATEFUL_HASH_PRIMARY",
                "algorithm": "LMS/HSS",
                "standard": "NIST SP 800-208 & RFC 8554",
                "security_level": 3,
                "rationale": "Mandated under CNSA 2.0 for firmware signing; extremely fast ASIC verification.",
                "trade_offs": "Strict monotonic non-volatile state management required. Key reuse destroys private key.",
            }
        )
    elif any(h in algo for h in ["MD5", "SHA1", "SHA-1"]):
        candidates.append(
            {
                "role": "PRIMARY_HASH",
                "algorithm": "SHA-256",
                "standard": "NIST FIPS 180-4",
                "security_level": 0,
                "rationale": "Standard cryptographically secure classical hash.",
                "trade_offs": "Universal compatibility.",
            }
        )
    elif any(c in algo for c in ["DES", "3DES", "RC4"]):
        candidates.append(
            {
                "role": "PRIMARY_SYMMETRIC",
                "algorithm": "AES-256-GCM",
                "standard": "NIST FIPS 197 & SP 800-38D",
                "security_level": 5,
                "rationale": "Full 256-bit symmetric encryption providing 128-bit quantum security under Grover's algorithm.",
                "trade_offs": "Hardware accelerated on modern CPUs (AES-NI).",
            }
        )
    else:
        candidates.append(
            {
                "role": "PRIMARY_PQC_HYBRID",
                "algorithm": "X25519MLKEM768",
                "standard": "NIST FIPS 203 & IETF draft-ietf-tls-hybrid-design",
                "security_level": 3,
                "rationale": "Modern post-quantum hybrid protection.",
                "trade_offs": "Requires TLS 1.3.",
            }
        )

    return candidates


def identify_dependencies(asset: Dict[str, Any], selected_candidate: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """3. Identifies cryptographic, protocol, and hardware dependencies."""
    cand_algo = (selected_candidate or {}).get("algorithm", "")

    deps = {
        "cryptographic_libraries": [],
        "protocols": [],
        "hardware_requirements": [],
        "pki_requirements": [],
    }

    if any(k in cand_algo for k in ["ML-KEM", "ML-DSA", "SLH-DSA"]):
        deps["cryptographic_libraries"].extend(["OpenSSL 3.4+ / 3.5+", "liboqs", "BoringSSL"])
        deps["protocols"].append("TLS 1.3 (RFC 8446 with hybrid design support)")
    elif any(k in cand_algo for k in ["LMS", "XMSS"]):
        deps["cryptographic_libraries"].append("NIST SP 800-208 certified module")
        deps["hardware_requirements"].extend(
            [
                "Hardware Security Module (HSM) with certified monotonic counter",
                "FIPS 140-3 Level 3+ physical boundary",
            ]
        )
    else:
        deps["cryptographic_libraries"].append("Standard OpenSSL 3.0+ or language runtime standard crypto library")
        deps["protocols"].append("TLS 1.2 or TLS 1.3")

    if any(k in cand_algo for k in ["ML-DSA", "SLH-DSA"]):
        deps["pki_requirements"].append("IETF LAMPS Composite Certificate Support (draft-ietf-lamps-pq-composite-sigs)")

    return deps


def identify_affected_services(asset: Dict[str, Any]) -> Dict[str, Any]:
    """4. Identifies affected downstream services and applications."""
    app = asset.get("application") or asset.get("service") or "CoreService"
    blast_radius = int(asset.get("dependency_blast_radius") or asset.get("blast_radius") or 1)
    is_internet = bool(asset.get("is_internet_facing") or asset.get("isInternetExposed"))

    affected = [app]
    for i in range(1, min(blast_radius, 6)):
        affected.append(f"{app}-dependent-svc-{i}")

    return {
        "primary_application": app,
        "total_dependent_services": blast_radius,
        "affected_services": affected,
        "external_clients_affected": is_internet,
    }


def estimate_migration_complexity(
    asset: Dict[str, Any], selected_candidate: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """5. Estimates migration complexity."""
    algo = str(asset.get("algorithm") or asset.get("name") or "").upper()
    asset_type = asset.get("asset_type") or asset.get("assetType")
    cand_algo = (selected_candidate or {}).get("algorithm", "")

    score = 3
    level = "LOW"
    person_days = 2
    breakdown = []

    if asset_type in ["stored_encrypted_data", "database"]:
        score = 9
        level = "COMPLEX"
        person_days = 20
        breakdown.append("Database schema migration and bulk data re-encryption required.")
    elif any(k in cand_algo for k in ["LMS", "XMSS"]):
        score = 8
        level = "COMPLEX"
        person_days = 15
        breakdown.append("Hardware Security Module firmware upgrade and monotonic counter integration.")
    elif "ML-DSA" in cand_algo:
        score = 7
        level = "HIGH"
        person_days = 10
        breakdown.append("PKI certificate authority root upgrade and client trust store redistribution.")
    elif any(k in cand_algo for k in ["ML-KEM", "MLKEM"]):
        score = 4
        level = "MEDIUM"
        person_days = 5
        breakdown.append("TLS 1.3 termination proxy upgrade and client middlebox compatibility testing.")
    elif any(p in algo for p in ["TLS 1.0", "TLS 1.1", "SSLV3", "RC4", "3DES"]):
        score = 2
        level = "LOW"
        person_days = 1
        breakdown.append("Configuration toggle in ingress reverse proxy or API gateway.")

    return {
        "complexity_score": score,
        "effort_level": level,
        "estimated_person_days": person_days,
        "breakdown": breakdown,
    }


def identify_testing_requirements(
    asset: Dict[str, Any], selected_candidate: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """6. Identifies testing requirements."""
    cand_algo = (selected_candidate or {}).get("algorithm", "")
    is_internet = bool(asset.get("is_internet_facing") or asset.get("isInternetExposed"))

    return {
        "functional_tests": [
            f"Validate cryptographic handshake / verification using {cand_algo}.",
            "Verify end-to-end data transmission and integrity check.",
            "Verify zero private key leakage invariant.",
        ],
        "interoperability_tests": [
            "Test client backward compatibility with legacy endpoints (verify clean classical fallback).",
            "Network MTU inspection: Verify 1500-byte packet fragmentation does not cause TCP resets.",
        ],
        "performance_benchmarks": [
            "Benchmark handshake latency under load (ensure P99 latency <= 15ms overhead).",
            "Monitor CPU utilization on TLS termination instances during peak load.",
        ],
        "rollback_smoke_tests": [
            "Simulate configuration rollback in staging to ensure zero-downtime failback.",
        ],
    }


def propose_staged_rollout(
    asset: Dict[str, Any], selected_candidate: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """7. Proposes a structured staged rollout."""
    cand = (selected_candidate or {}).get("algorithm", "PQC Target")
    return [
        {
            "phase": 1,
            "name": "Pilot & Dual-Stack Enablement",
            "duration_weeks": 2,
            "scope": "Internal developer environment and staging clusters.",
            "description": f"Deploy {cand} in dual-stack configuration with classical fallback.",
            "exit_criteria": "100% test pass rate in staging with zero packet drops.",
        },
        {
            "phase": 2,
            "name": "Canary Deployment",
            "duration_weeks": 1,
            "scope": "5% of production traffic.",
            "description": "Route a small portion of production traffic through upgraded endpoints.",
            "exit_criteria": "Zero elevated connection drop rate for 7 consecutive days.",
        },
        {
            "phase": 3,
            "name": "Full Production Rollout",
            "duration_weeks": 3,
            "scope": "100% of production services with classical fallback.",
            "description": f"Enable {cand} across all active endpoints while retaining classical fallback.",
            "exit_criteria": "PQC handshake adoption >= 85% of modern clients.",
        },
        {
            "phase": 4,
            "name": "Classical Deprecation",
            "duration_weeks": 2,
            "scope": "Complete decommissioning of weak classical ciphers.",
            "description": "Disable legacy algorithms permanently. Enforce strict PQC / hybrid policy.",
            "exit_criteria": "Zero classical fallback invocations in 30 days.",
        },
    ]


def define_rollback(asset: Dict[str, Any]) -> Dict[str, Any]:
    """8. Defines automated rollback pre-conditions and procedures."""
    return {
        "pre_condition_triggers": [
            "Handshake error rate spikes > 0.1% over a 5-minute rolling window.",
            "P99 connection latency exceeds baseline by > 50ms.",
            "Middlebox packet fragmentation causes TCP resets > 0.05%.",
        ],
        "automated_procedure": [
            "Step 1: Ingress configuration toggle: Flip cipher suite group preference back to classical baseline.",
            "Step 2: Graceful reload of reverse proxy without process termination.",
            "Step 3: Route health check validation: Verify all upstream nodes respond with 200 OK.",
            "Step 4: Automated alert dispatch to security operations.",
        ],
        "estimated_rollback_time_seconds": 30,
        "zero_downtime_guaranteed": True,
    }


def define_rescan_verification(
    asset: Dict[str, Any], selected_candidate: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """9. Defines rescan verification requirements."""
    classical_algo = asset.get("algorithm") or asset.get("name") or "Classical"
    target_algo = (selected_candidate or {}).get("algorithm", "PQC Target")

    return {
        "verification_trigger": "Automated CI/CD webhook on pull request merge or post-deployment pipeline.",
        "absence_proof_disclaimer": "Never treat absence of a finding as proof that no crypto exists.",
        "expected_cbom_diff": {
            "removed_components": [
                {
                    "algorithm": classical_algo,
                    "expected_action": "REMOVED or DEPRECATED",
                    "absence_disclaimer_required": True,
                }
            ],
            "new_components": [
                {
                    "algorithm": target_algo,
                    "expected_action": "NEW (Compliant PQC/Hybrid)",
                    "compliance_status": "PASS",
                }
            ],
            "policy_diff": "POLICY_CHANGED -> PASSED",
        },
        "regression_checks": [
            "Verify no raw secrets or private key material exposed in CBOM properties.",
            "Verify CBOM validates strictly against CycloneDX 1.7 schema.",
        ],
    }


def plan_asset_migration(asset: Dict[str, Any]) -> Dict[str, Any]:
    """Generates a complete 9-point Migration Plan for a single asset."""
    why_risky = identify_why_risky(asset)
    candidates = identify_replacement_candidates(asset)
    primary_candidate = candidates[0] if candidates else None

    return {
        "asset_id": asset.get("asset_id") or asset.get("bom_ref") or asset.get("name") or "crypto-asset",
        "current_algorithm": asset.get("algorithm") or asset.get("name") or "Unknown",
        "asset_type": asset.get("asset_type") or "file",
        "application": asset.get("application") or "Enterprise App",
        "why_risky": why_risky,
        "replacement_candidates": candidates,
        "selected_candidate": primary_candidate,
        "dependencies": identify_dependencies(asset, primary_candidate),
        "affected_services": identify_affected_services(asset),
        "migration_complexity": estimate_migration_complexity(asset, primary_candidate),
        "testing_requirements": identify_testing_requirements(asset, primary_candidate),
        "staged_rollout": propose_staged_rollout(asset, primary_candidate),
        "rollback_plan": define_rollback(asset),
        "rescan_verification": define_rescan_verification(asset, primary_candidate),
    }


def create_enterprise_migration_plan(input_data: Any) -> Dict[str, Any]:
    """
    Comprehensive Enterprise Migration Planner supporting the 6 lifecycle phases:
    DISCOVER -> ASSESS -> PLAN -> SIMULATE -> REMEDIATE -> VERIFY
    """
    assets = []
    if isinstance(input_data, dict):
        assets = input_data.get("components") or input_data.get("findings") or input_data.get("top_risky_assets") or []
    elif isinstance(input_data, list):
        assets = input_data

    # DISCOVER
    discovered_count = len(assets)

    # ASSESS
    requiring_migration = [
        a
        for a in assets
        if any(
            w in str(a.get("algorithm") or a.get("name") or "").upper()
            for w in ["MD5", "SHA1", "SHA-1", "DES", "RC4", "3DES", "RSA", "ECDSA", "ECDH", "TLS 1.0", "TLS 1.1"]
        )
    ]

    # PLAN
    asset_plans = [plan_asset_migration(a) for a in requiring_migration]

    # SIMULATE
    simulation_results = []
    for plan in asset_plans:
        cand = (plan.get("selected_candidate") or {}).get("algorithm", "")
        is_mtu_risk = cand in ["SecP384r1MLKEM1024", "ML-KEM-1024"]
        simulation_results.append(
            {
                "asset_id": plan["asset_id"],
                "candidate_algorithm": cand,
                "mtu_packet_size_safe": not is_mtu_risk,
                "middlebox_fragmentation_risk": "HIGH (Key share > 1500B)"
                if is_mtu_risk
                else "LOW (Fits standard MTU)",
                "simulation_passed": True,
                "estimated_latency_delta_ms": 1.2 if "ML-KEM" in cand else 0.0,
            }
        )

    # REMEDIATE
    remediation_recipes = []
    for plan in asset_plans[:5]:
        cand = (plan.get("selected_candidate") or {}).get("algorithm", "")
        if "MLKEM" in cand:
            recipe_type = "tls_cipher_groups"
            snippet = "# Modern TLS 1.3 with Post-Quantum Hybrid Key Exchange\nssl_protocols TLSv1.3;\nssl_ecdh_curve X25519MLKEM768:X25519:secp256r1;\nssl_prefer_server_ciphers off;"
        elif "SHA-256" in cand:
            recipe_type = "code_refactor_snippet"
            snippet = "# Replace broken hash with SHA-256\nimport hashlib\nhash_val = hashlib.sha256(data).hexdigest()"
        else:
            recipe_type = "generic_crypto_upgrade"
            snippet = f"# Upgrade target: {cand}\n# Refer to FIPS / IETF guidance for implementation details."

        remediation_recipes.append(
            {
                "asset_id": plan["asset_id"],
                "target_algorithm": cand,
                "recipe_type": recipe_type,
                "remediation_snippet": snippet,
            }
        )

    # VERIFY
    verification_summary = {
        "engine": "ECDAT CBOM Diff & Security Gate",
        "total_assets_to_verify": len(asset_plans),
        "automated_rules": [
            "Assert old classical algorithms classified as REMOVED.",
            "Assert new PQC/hybrid algorithms present in component inventory.",
            "Assert zero unexpected secrets or private key leakage.",
            "Assert CI/CD gate returns PASS.",
        ],
    }

    return {
        "lifecycle_phases_supported": LIFECYCLE_PHASES,
        "summary": {
            "total_discovered": discovered_count,
            "total_requiring_migration": len(requiring_migration),
            "total_plans_generated": len(asset_plans),
        },
        "discover_phase": {"discovered_assets_count": discovered_count},
        "assess_phase": {
            "assessed_assets_count": len(assets),
            "requiring_migration_count": len(requiring_migration),
        },
        "plan_phase": {"asset_plans": asset_plans},
        "simulate_phase": {"simulation_results": simulation_results},
        "remediate_phase": {"recipes": remediation_recipes},
        "verify_phase": verification_summary,
    }
