"""
ECDAT Versioned PQC Knowledge Base Provider (Phase 10.1)

Provides Python scanner and analysis engines with access to standardized PQC algorithms,
hybrid key exchange groups, stateful hash signatures (LMS/XMSS), and multi-authority
guidance (NIST, ANSSI, BSI, NSA CNSA 2.0, IETF).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

_CACHED_CATALOG: Optional[Dict[str, Any]] = None


def _normalize_query(query: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (query or "").lower())


def get_catalog_path() -> Path:
    """Resolves rules/pqc_algorithm_catalog.json relative to repository root."""
    current_file = Path(__file__).resolve()
    repo_root = current_file.parent.parent
    candidate = repo_root / "rules" / "pqc_algorithm_catalog.json"
    if candidate.exists():
        return candidate
    alt = Path.cwd() / "rules" / "pqc_algorithm_catalog.json"
    if alt.exists():
        return alt
    return candidate


def load_pqc_catalog(catalog_path: Optional[Path | str] = None) -> Dict[str, Any]:
    """Loads and returns the versioned PQC algorithm catalog."""
    global _CACHED_CATALOG
    if _CACHED_CATALOG is not None and catalog_path is None:
        return _CACHED_CATALOG

    path = Path(catalog_path) if catalog_path else get_catalog_path()
    if not path.exists():
        raise FileNotFoundError(f"PQC Knowledge Base catalog not found at: {path}")

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if catalog_path is None:
        _CACHED_CATALOG = data
    return data


def lookup_pqc_algorithm(query: str, catalog: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """
    Finds an algorithm in the PQC Knowledge Base by ID, standard name, alias, or OID.
    """
    if not query:
        return None

    cat = catalog or load_pqc_catalog()
    norm = _normalize_query(query)

    for algo in cat.get("algorithms", []):
        if _normalize_query(algo.get("id", "")) == norm:
            return algo
        if _normalize_query(algo.get("standard_name", "")) == norm:
            return algo
        if algo.get("ssh_name") and _normalize_query(algo["ssh_name"]) == norm:
            return algo
        if algo.get("oid") and algo["oid"] == query:
            return algo
        for alias in algo.get("aliases", []):
            if _normalize_query(alias) == norm:
                return algo

    return None


def list_algorithms_by_category(category: str, catalog: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Lists algorithms filtered by category ('post_quantum', 'hybrid', 'classical')."""
    cat = catalog or load_pqc_catalog()
    target = category.lower()
    return [a for a in cat.get("algorithms", []) if a.get("category", "").lower() == target]


def list_algorithms_by_usage(usage_category: str, catalog: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Lists algorithms filtered by usage category (e.g. 'EPHEMERAL_TLS_KEX', 'FIRMWARE_CODE_SIGNING')."""
    cat = catalog or load_pqc_catalog()
    target = usage_category.upper()
    return [a for a in cat.get("algorithms", []) if a.get("usage_category") == target]


def get_authority_recommendations(query: str) -> Optional[Dict[str, Any]]:
    """Returns multi-authority guidance comparing NIST, ANSSI, BSI, NSA CNSA 2.0, and IETF."""
    algo = lookup_pqc_algorithm(query)
    if not algo:
        return None

    return {
        "id": algo.get("id"),
        "standard_name": algo.get("standard_name"),
        "standard_reference": algo.get("standard_reference"),
        "security_level": algo.get("nist_quantum_security_level"),
        "authorities": algo.get("authority_recommendations", {}),
    }


def get_stateful_hash_guidelines() -> Dict[str, Any]:
    """Returns safety guidelines and HSM requirements for stateful hash signatures (LMS/XMSS)."""
    return {
        "schemes": ["LMS/HSS (RFC 8554, NIST SP 800-208)", "XMSS/XMSS^MT (RFC 8391, NIST SP 800-208)"],
        "approved_usage": "FIRMWARE_CODE_SIGNING exclusively. Never use for interactive TLS or general PKI.",
        "state_management_hazard": (
            "CRITICAL: Re-using a state index completely destroys private key security. "
            "All signing operations must monotonically increment state on physical non-volatile hardware storage."
        ),
        "hardware_security_module_requirements": [
            "Must enforce physical monotonic hardware counter.",
            "Must resist VM snapshot rollback and power-loss interruption during state increment.",
            "Must isolate private key operations within certified FIPS 140-3 Level 3/4 or Common Criteria EAL 5+ boundary.",
        ],
    }


def get_hybrid_tls_guidelines() -> Dict[str, Any]:
    """Returns operational guidance for TLS 1.3 hybrid key exchange mechanisms."""
    groups = list_algorithms_by_usage("EPHEMERAL_TLS_KEX")
    return {
        "standards_track": "IETF draft-ietf-tls-hybrid-design",
        "primary_recommended_group": "X25519MLKEM768 (IANA 0x11ec / 4588)",
        "fips_regulated_group": "SecP256r1MLKEM768 (IANA 0x11ed / 4589)",
        "high_assurance_group": "SecP384r1MLKEM1024 (IANA 0x11ef / 4591)",
        "supported_groups": [
            {
                "name": g.get("standard_name"),
                "iana_id": g.get("iana_tls_group_id"),
                "iana_hex": g.get("iana_tls_group_hex"),
                "classical": g.get("hybrid_components", {}).get("classical_component"),
                "pqc": g.get("hybrid_components", {}).get("post_quantum_component"),
                "status": g.get("deprecation_status"),
            }
            for g in groups
        ],
    }
