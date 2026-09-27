import json
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any

from scanners.models import BinaryContainerFinding

DEFAULT_CATALOG_PATH = Path(__file__).resolve().parents[2] / "rules" / "crypto_library_catalog.json"

_CATALOG_CACHE: Optional[List[Dict[str, Any]]] = None


def load_crypto_catalog(catalog_path: Optional[str | Path] = None) -> List[Dict[str, Any]]:
    """Loads and caches the cryptographic library catalog JSON."""
    global _CATALOG_CACHE
    path = Path(catalog_path) if catalog_path else DEFAULT_CATALOG_PATH

    if not path.is_file():
        logging.warning(f"Crypto library catalog not found at {path}. Using empty catalog.")
        return []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
    except Exception as e:
        logging.error(f"Failed to load crypto catalog from {path}: {e}")
    return []


def get_catalog(catalog_path: Optional[str | Path] = None) -> List[Dict[str, Any]]:
    global _CATALOG_CACHE
    if catalog_path is not None:
        return load_crypto_catalog(catalog_path)
    if _CATALOG_CACHE is None:
        _CATALOG_CACHE = load_crypto_catalog()
    return _CATALOG_CACHE


def match_crypto_library(
    name: str, purl: Optional[str] = None, catalog: Optional[List[Dict[str, Any]]] = None
) -> Optional[Dict[str, Any]]:
    """Matches a component name/purl against recognized libraries in the catalog."""
    if not name and not purl:
        return None

    if catalog is None:
        catalog = get_catalog()

    name_clean = name.strip().lower() if name else ""

    for entry in catalog:
        canon = entry.get("canonical_name", "").lower()
        if name_clean and name_clean == canon:
            return entry

        for alias in entry.get("aliases", []):
            alias_clean = alias.strip().lower()
            if name_clean:
                if name_clean == alias_clean:
                    return entry
                # Prefix matching for versioned packages like libssl3, libgcrypt20
                if name_clean.startswith(alias_clean) and len(alias_clean) >= 4:
                    return entry
                # Exact package name match within compound package name
                if f"/{alias_clean}" in name_clean or f"-{alias_clean}" in name_clean:
                    return entry

        if purl:
            purl_clean = purl.strip().lower()
            for alias in entry.get("aliases", []):
                alias_clean = alias.strip().lower()
                if alias_clean in purl_clean and len(alias_clean) >= 4:
                    return entry

    return None


def is_cryptographic_component(name: str, catalog: Optional[List[Dict[str, Any]]] = None) -> bool:
    """Helper to check whether a given package name corresponds to a known crypto library."""
    return match_crypto_library(name, catalog=catalog) is not None


def extract_cpe(comp: dict) -> Optional[str]:
    """Extracts CPE if present on the CycloneDX component."""
    if comp.get("cpe"):
        return str(comp.get("cpe"))
    cpes = comp.get("cpes")
    if isinstance(cpes, list) and len(cpes) > 0:
        return str(cpes[0])
    for prop in comp.get("properties", []):
        if prop.get("name") in ("syft:cpe", "cpe"):
            return prop.get("value")
    return None


def extract_artifact_path(comp: dict) -> Optional[str]:
    """Extracts file/artifact path where Syft detected the component."""
    for prop in comp.get("properties", []):
        pname = prop.get("name", "")
        if "location" in pname and pname.endswith(":path"):
            return prop.get("value")
        if pname in ("syft:location:path", "syft:path", "location"):
            return prop.get("value")

    evidence = comp.get("evidence", {})
    if isinstance(evidence, dict):
        occurrences = evidence.get("occurrences", [])
        if occurrences and isinstance(occurrences, list):
            loc = occurrences[0].get("location")
            if loc:
                return loc

    return None


def parse_cyclonedx_for_crypto(
    target: str, cyclonedx_data: dict, catalog_path: Optional[str | Path] = None
) -> list[BinaryContainerFinding]:
    """
    Parses Syft CycloneDX components, matches against the crypto catalog,
    and returns BinaryContainerFinding objects with package_inventory evidence.
    """
    catalog = get_catalog(catalog_path)
    findings: list[BinaryContainerFinding] = []

    components = cyclonedx_data.get("components", [])
    for comp in components:
        name = comp.get("name", "")
        purl = comp.get("purl")

        matched = match_crypto_library(name, purl=purl, catalog=catalog)
        if matched:
            version = comp.get("version", "unknown")
            bom_ref = comp.get("bom-ref", f"binary:{target}:{name}:{version}")
            cpe = extract_cpe(comp)
            artifact_path = extract_artifact_path(comp)
            canonical_name = matched.get("canonical_name", name)
            confidence = matched.get("confidence_limits", "medium")

            finding = BinaryContainerFinding(
                bom_ref=bom_ref,
                target=target,
                component_name=name,
                component_version=version,
                crypto_library=canonical_name,
                evidence_type="package_inventory",
                confidence=confidence,
                purl=purl,
                cpe=cpe,
                artifact_path=artifact_path,
                data_sensitivity="internal",
                business_criticality="medium",
            )
            findings.append(finding)

    return findings
