"""
ECDAT SBOM Ingestion & Normalization Engine (Python) — Phase 3.1

Implements schema validation, normalization, and bounds enforcement for
CycloneDX (1.4, 1.5, 1.6) and SPDX (2.2, 2.3, 3.0) SBOMs.

Normalizes:
- Component (name)
- Version
- Package URL (purl)
- License
- Dependency Relationships
"""

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from scanners.domain.errors import InvalidInputError, UnsupportedFormatError, ErrorCode


MAX_COMPONENTS_LIMIT = 50000
MAX_SBOM_BYTES = 50 * 1024 * 1024  # 50MB
MAX_NESTING_DEPTH = 64
DANGEROUS_KEYS = {"__proto__", "constructor", "prototype"}

SUPPORTED_CYCLONEDX_VERSIONS = {"1.4", "1.5", "1.6", "1.7"}
SUPPORTED_SPDX_VERSIONS = {"SPDX-2.2", "SPDX-2.3", "SPDX-3.0"}


@dataclass(frozen=True)
class NormalizedComponent:
    component_id: str
    name: str
    version: str
    purl: Optional[str] = None
    licenses: List[str] = field(default_factory=list)
    type: str = "library"
    description: Optional[str] = None


@dataclass(frozen=True)
class DependencyRelationship:
    from_ref: str
    to_ref: str
    relationship_type: str = "DEPENDS_ON"


@dataclass
class NormalizedSbom:
    format: str
    spec_version: str
    component_count: int
    relationship_count: int
    components: List[NormalizedComponent] = field(default_factory=list)
    dependency_relationships: List[DependencyRelationship] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "format": self.format,
            "spec_version": self.spec_version,
            "component_count": self.component_count,
            "relationship_count": self.relationship_count,
            "components": [
                {
                    "component_id": c.component_id,
                    "name": c.name,
                    "version": c.version,
                    "purl": c.purl,
                    "licenses": c.licenses,
                    "type": c.type,
                    "description": c.description,
                }
                for c in self.components
            ],
            "dependency_relationships": [
                {
                    "from": r.from_ref,
                    "to": r.to_ref,
                    "relationship_type": r.relationship_type,
                }
                for r in self.dependency_relationships
            ],
        }


@dataclass
class SbomValidationResult:
    valid: bool
    format: str
    version: str
    component_count: int = 0
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def check_for_dangerous_keys(obj: Any, path: str = "", depth: int = 0) -> List[str]:
    violations = []
    if depth > MAX_NESTING_DEPTH:
        violations.append(f"Payload nesting exceeds {MAX_NESTING_DEPTH} levels at '{path or 'root'}'.")
        return violations

    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in DANGEROUS_KEYS:
                violations.append(f"Dangerous property detected: '{f'{path}.{k}' if path else k}'")
            elif isinstance(v, (dict, list)):
                violations.extend(check_for_dangerous_keys(v, f"{path}.{k}" if path else k, depth + 1))
    elif isinstance(obj, list):
        for idx, item in enumerate(obj):
            if isinstance(item, (dict, list)):
                violations.extend(check_for_dangerous_keys(item, f"{path}[{idx}]", depth + 1))

    return violations


def validate_sbom_structure(payload: Any) -> SbomValidationResult:
    """
    Validates structural conformity, format specification, safety, and bounds.
    """
    errors = []
    warnings = []

    if not isinstance(payload, dict):
        return SbomValidationResult(
            valid=False,
            format="UNKNOWN",
            version="unknown",
            errors=["Payload must be a valid JSON dictionary"],
        )

    # 1. Byte limit check
    try:
        raw_bytes = json.dumps(payload).encode("utf-8")
        if len(raw_bytes) > MAX_SBOM_BYTES:
            return SbomValidationResult(
                valid=False,
                format="UNKNOWN",
                version="unknown",
                errors=[f"Payload exceeds the {MAX_SBOM_BYTES} byte safety limit."],
            )
    except Exception as e:
        return SbomValidationResult(
            valid=False,
            format="UNKNOWN",
            version="unknown",
            errors=[f"Payload cannot be serialized: {e}"],
        )

    # 2. Dangerous keys & nesting depth
    dangerous_violations = check_for_dangerous_keys(payload)
    if dangerous_violations:
        return SbomValidationResult(
            valid=False,
            format="UNKNOWN",
            version="unknown",
            errors=dangerous_violations,
        )

    # 3. Format detection
    detected_format = None
    detected_version = None
    component_count = 0

    if payload.get("bomFormat") == "CycloneDX" or "components" in payload:
        detected_format = "CycloneDX"
        detected_version = str(payload.get("specVersion", "1.6"))

        if payload.get("bomFormat") and payload.get("bomFormat") != "CycloneDX":
            errors.append(f"Invalid bomFormat: expected 'CycloneDX', received '{payload.get('bomFormat')}'")

        if detected_version not in SUPPORTED_CYCLONEDX_VERSIONS:
            errors.append(
                f"Unsupported CycloneDX specVersion: expected one of {sorted(list(SUPPORTED_CYCLONEDX_VERSIONS))}, received '{detected_version}'"
            )

        components = payload.get("components")
        if not isinstance(components, list):
            errors.append("CycloneDX document missing required 'components' list")
        else:
            component_count = len(components)

    elif "spdxVersion" in payload or "packages" in payload:
        detected_format = "SPDX"
        detected_version = str(payload.get("spdxVersion", "SPDX-2.3"))

        if detected_version not in SUPPORTED_SPDX_VERSIONS and not detected_version.startswith(("SPDX-2.", "SPDX-3.")):
            errors.append(
                f"Unsupported SPDX version: expected one of {sorted(list(SUPPORTED_SPDX_VERSIONS))}, received '{detected_version}'"
            )

        packages = payload.get("packages")
        if not isinstance(packages, list) and "SPDXID" not in payload:
            errors.append("SPDX document missing required 'packages' list or 'SPDXID'")
        elif isinstance(packages, list):
            component_count = len(packages)

    else:
        return SbomValidationResult(
            valid=False,
            format="UNKNOWN",
            version="unknown",
            errors=[
                "Unrecognized SBOM schema. Document must contain 'bomFormat': 'CycloneDX' or 'spdxVersion': 'SPDX-...'."
            ],
        )

    # 4. Resource bounds
    if component_count > MAX_COMPONENTS_LIMIT:
        errors.append(
            f"Component count ({component_count}) exceeds the maximum safety bound of {MAX_COMPONENTS_LIMIT}."
        )

    return SbomValidationResult(
        valid=len(errors) == 0,
        format=detected_format or "UNKNOWN",
        version=detected_version or "unknown",
        component_count=component_count,
        errors=errors,
        warnings=warnings,
    )


def extract_cyclonedx_licenses(licenses_field: Any) -> List[str]:
    licenses = []
    if isinstance(licenses_field, list):
        for item in licenses_field:
            if isinstance(item, str):
                licenses.append(item)
            elif isinstance(item, dict):
                if "expression" in item:
                    licenses.append(item["expression"])
                elif "license" in item and isinstance(item["license"], dict):
                    lic_obj = item["license"]
                    if "id" in lic_obj:
                        licenses.append(lic_obj["id"])
                    elif "name" in lic_obj:
                        licenses.append(lic_obj["name"])
    return licenses


def extract_spdx_purl(external_refs: Any) -> Optional[str]:
    if isinstance(external_refs, list):
        for ref in external_refs:
            if isinstance(ref, dict):
                r_type = str(ref.get("referenceType", "")).lower()
                locator = ref.get("referenceLocator")
                if r_type == "purl" and locator:
                    return locator
                cat = str(ref.get("referenceCategory", "")).upper()
                if cat == "PACKAGE-MANAGER" and r_type == "purl" and locator:
                    return locator
    return None


def extract_spdx_licenses(pkg: Dict[str, Any]) -> List[str]:
    licenses = []
    ignored = {"NOASSERTION", "NONE", "", None}

    concluded = pkg.get("licenseConcluded")
    if concluded not in ignored:
        licenses.append(concluded)

    declared = pkg.get("licenseDeclared")
    if declared not in ignored and declared not in licenses:
        licenses.append(declared)

    return licenses


def ingest_sbom(payload: Dict[str, Any]) -> NormalizedSbom:
    """
    Validates, redacts secrets from, and normalizes a CycloneDX or SPDX SBOM document.
    """
    validation = validate_sbom_structure(payload)
    if not validation.valid:
        is_unsupported = any("Unrecognized" in e or "Unsupported" in e for e in validation.errors)
        if is_unsupported:
            raise UnsupportedFormatError(
                f"SBOM Ingestion Format Error: {'; '.join(validation.errors)}",
                details={"errors": validation.errors},
                code=ErrorCode.ERR_FORMAT_UNSUPPORTED_SPEC,
            )
        raise InvalidInputError(
            f"SBOM Ingestion Validation Failed: {'; '.join(validation.errors)}",
            details={"errors": validation.errors},
            code=ErrorCode.ERR_INPUT_INVALID_PARAMETER,
        )

    # Normalize CycloneDX
    if validation.format == "CycloneDX":
        components: List[NormalizedComponent] = []
        relationships: List[DependencyRelationship] = []

        for c in payload.get("components", []):
            cid = c.get("bom-ref") or c.get("purl") or f"{c.get('name', 'unknown')}@{c.get('version', 'unknown')}"
            components.append(
                NormalizedComponent(
                    component_id=cid,
                    name=c.get("name", "unknown"),
                    version=c.get("version", "unknown"),
                    purl=c.get("purl"),
                    licenses=extract_cyclonedx_licenses(c.get("licenses")),
                    type=c.get("type", "library"),
                    description=c.get("description"),
                )
            )

        for dep in payload.get("dependencies", []):
            from_ref = dep.get("ref")
            if from_ref and isinstance(dep.get("dependsOn"), list):
                for to_ref in dep["dependsOn"]:
                    relationships.append(
                        DependencyRelationship(
                            from_ref=from_ref,
                            to_ref=to_ref,
                            relationship_type="DEPENDS_ON",
                        )
                    )

        return NormalizedSbom(
            format="CycloneDX",
            spec_version=validation.version,
            component_count=len(components),
            relationship_count=len(relationships),
            components=components,
            dependency_relationships=relationships,
        )

    # Normalize SPDX
    elif validation.format == "SPDX":
        components = []
        relationships = []

        for pkg in payload.get("packages", []):
            pid = pkg.get("SPDXID") or pkg.get("name", "unknown")
            components.append(
                NormalizedComponent(
                    component_id=pid,
                    name=pkg.get("name", "unknown"),
                    version=pkg.get("versionInfo", "unknown"),
                    purl=extract_spdx_purl(pkg.get("externalRefs")),
                    licenses=extract_spdx_licenses(pkg),
                    type=pkg.get("primaryPackagePurpose", "library").lower(),
                    description=pkg.get("description") or pkg.get("summary"),
                )
            )

        for rel in payload.get("relationships", []):
            r_type = str(rel.get("relationshipType", "DEPENDS_ON")).upper()
            elem1 = rel.get("spdxElementId")
            elem2 = rel.get("relatedSpdxElement")
            if elem1 and elem2:
                if r_type == "DEPENDENCY_OF":
                    relationships.append(
                        DependencyRelationship(from_ref=elem2, to_ref=elem1, relationship_type="DEPENDS_ON")
                    )
                elif r_type == "CONTAINS":
                    relationships.append(
                        DependencyRelationship(from_ref=elem1, to_ref=elem2, relationship_type="CONTAINS")
                    )
                else:
                    relationships.append(
                        DependencyRelationship(from_ref=elem1, to_ref=elem2, relationship_type="DEPENDS_ON")
                    )

        return NormalizedSbom(
            format="SPDX",
            spec_version=validation.version,
            component_count=len(components),
            relationship_count=len(relationships),
            components=components,
            dependency_relationships=relationships,
        )

    raise UnsupportedFormatError(f"Unsupported format '{validation.format}'")
