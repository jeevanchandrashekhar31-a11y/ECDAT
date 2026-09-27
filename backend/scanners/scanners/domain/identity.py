"""
ECDAT Deterministic Identity Generator (Python)
Mirrors Node.js identity.js: implements versioned, collision-resistant
URN generation using RFC 8785 JSON Canonicalization and SHA-256 digests.
"""

import hashlib
import json
import re
from typing import Any, Dict, Optional

ACTIVE_IDENTITY_VERSION = "v1"


def normalize_slug(slug: Optional[str]) -> str:
    """Normalizes an identifier slug (tenant or application) into safe alphanumeric characters."""
    if not slug or not isinstance(slug, str):
        return "default"
    cleaned = re.sub(r"[^a-z0-9_-]", "_", slug.strip().lower())
    return cleaned or "default"


def canonicalize_json(value: Any) -> str:
    """
    Deterministic RFC 8785-compliant JSON canonicalization.
    Recursively sorts dictionary keys and serializes without whitespace.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        # Python json.dumps with ensure_ascii=False matches standard UTF-8 JSON
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False)

    if isinstance(value, (list, tuple)):
        items = [canonicalize_json(item) for item in value]
        return "[" + ",".join(items) + "]"

    if isinstance(value, dict):
        sorted_keys = sorted(value.keys())
        pairs = [
            json.dumps(str(k), ensure_ascii=False) + ":" + canonicalize_json(value[k])
            for k in sorted_keys
            if value[k] is not None
        ]
        return "{" + ",".join(pairs) + "}"

    # Fallback for unexpected types
    return json.dumps(str(value), separators=(",", ":"), ensure_ascii=False)


def compute_canonical_hash(descriptor: Any, length: int = 32) -> str:
    """Computes a SHA-256 hex digest over canonical JSON bytes."""
    canonical_str = canonicalize_json(descriptor)
    full_hash = hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()
    return full_hash[:length]


def generate_asset_id(
    asset_type: str,
    provenance: Optional[Dict[str, Any]] = None,
    core_properties: Optional[Dict[str, Any]] = None,
    tenant_id: str = "default",
    application_id: str = "default",
    version: str = ACTIVE_IDENTITY_VERSION,
) -> str:
    """
    Generates a deterministic CryptoAsset URN.
    Format: urn:ecdat:<version>:asset:<tenant>:<app>:<assetType>:<digest>
    """
    if not asset_type:
        raise ValueError("generate_asset_id requires asset_type")

    norm_tenant = normalize_slug(tenant_id)
    norm_app = normalize_slug(application_id)
    norm_asset_type = str(asset_type).lower()

    prov = provenance or {}
    locator = str(prov.get("locator", "unknown")).replace("\\", "/")

    descriptor = {
        "version": version,
        "entity": "asset",
        "tenantId": norm_tenant,
        "applicationId": norm_app,
        "assetType": norm_asset_type,
        "provenance": {
            "kind": str(prov.get("kind", "source_code")),
            "locator": locator,
        },
        "coreProperties": dict(core_properties or {}),
    }

    digest = compute_canonical_hash(descriptor, 32)
    return f"urn:ecdat:{version}:asset:{norm_tenant}:{norm_app}:{norm_asset_type}:{digest}"


def generate_finding_id(
    asset_id: str,
    algorithm_standard: str,
    rule_id: str = "GENERIC",
    context_descriptor: str = "",
    tenant_id: str = "default",
    application_id: str = "default",
    version: str = ACTIVE_IDENTITY_VERSION,
) -> str:
    """
    Generates a deterministic Finding URN.
    Format: urn:ecdat:<version>:finding:<tenant>:<app>:<digest>
    """
    if not asset_id:
        raise ValueError("generate_finding_id requires asset_id")
    if not algorithm_standard:
        raise ValueError("generate_finding_id requires algorithm_standard")

    norm_tenant = normalize_slug(tenant_id)
    norm_app = normalize_slug(application_id)

    descriptor = {
        "version": version,
        "entity": "finding",
        "tenantId": norm_tenant,
        "applicationId": norm_app,
        "assetId": str(asset_id),
        "ruleId": str(rule_id or "GENERIC"),
        "algorithmStandard": str(algorithm_standard).upper(),
        "contextDescriptor": str(context_descriptor or ""),
    }

    digest = compute_canonical_hash(descriptor, 32)
    return f"urn:ecdat:{version}:finding:{norm_tenant}:{norm_app}:{digest}"


def generate_evidence_id(
    canonical_location: str,
    proof_type: str = "source_code",
    snippet_hash: Optional[str] = None,
    version: str = ACTIVE_IDENTITY_VERSION,
) -> str:
    """Generates a deterministic Evidence ID."""
    norm_loc = str(canonical_location or "unknown").replace("\\", "/")
    descriptor = {
        "version": version,
        "entity": "evidence",
        "proofType": str(proof_type),
        "canonicalLocation": norm_loc,
        "snippetHash": str(snippet_hash) if snippet_hash else None,
    }
    digest = compute_canonical_hash(descriptor, 32)
    return f"urn:ecdat:{version}:evidence:{digest}"


def generate_relationship_id(
    source_asset_id: str,
    target_asset_id: str,
    relationship_type: str,
    version: str = ACTIVE_IDENTITY_VERSION,
) -> str:
    """Generates a deterministic Relationship ID."""
    if not source_asset_id or not target_asset_id or not relationship_type:
        raise ValueError("generate_relationship_id requires source_asset_id, target_asset_id, and relationship_type")
    descriptor = {
        "version": version,
        "entity": "relationship",
        "sourceAssetId": str(source_asset_id),
        "targetAssetId": str(target_asset_id),
        "relationshipType": str(relationship_type),
    }
    digest = compute_canonical_hash(descriptor, 32)
    return f"urn:ecdat:{version}:rel:{digest}"


def parse_identifier(urn: str) -> Dict[str, str]:
    """Parses and validates an ECDAT URN."""
    if not urn or not isinstance(urn, str) or not urn.startswith("urn:ecdat:"):
        raise ValueError(f"Invalid ECDAT URN format: '{urn}'")
    parts = urn.split(":")
    if len(parts) < 5:
        raise ValueError(f"Malformed ECDAT URN: '{urn}'")

    version = parts[2]
    entity_type = parts[3]

    if entity_type == "asset" and len(parts) == 7:
        return {
            "version": version,
            "entityType": entity_type,
            "tenantId": parts[4],
            "appId": parts[5],
            "assetType": parts[6],
            "digest": parts[6],
        }

    return {
        "version": version,
        "entityType": entity_type,
        "tenantId": parts[4] if len(parts) > 4 else "default",
        "appId": parts[5] if len(parts) > 5 else "default",
        "digest": parts[-1],
    }
