"""
Tests for Phase 3.1: Python SBOM Ingestion & Normalization.

Verifies:
1. CycloneDX (1.4, 1.5, 1.6) ingestion and normalization:
   - component (name)
   - version
   - package URL (purl)
   - license
   - dependency relationships
2. SPDX (2.2, 2.3, 3.0) ingestion and normalization:
   - package (name)
   - version
   - purl from externalRefs
   - license
   - dependency relationships
3. Schema validation before processing.
4. Safe rejection of malformed or excessively large documents.
5. Rejection of dangerous properties / nesting depth.
"""

import json
import pytest

from scanners.sca.sbom_ingestion import (
    ingest_sbom,
    validate_sbom_structure,
    NormalizedSbom,
    NormalizedComponent,
    DependencyRelationship,
)
from scanners.domain.errors import InvalidInputError, UnsupportedFormatError


SAMPLE_CYCLONEDX = {
    "bomFormat": "CycloneDX",
    "specVersion": "1.6",
    "components": [
        {
            "bom-ref": "pkg:pypi/cryptography@41.0.0",
            "type": "library",
            "name": "cryptography",
            "version": "41.0.0",
            "purl": "pkg:pypi/cryptography@41.0.0",
            "licenses": [{"license": {"id": "Apache-2.0"}}, {"expression": "BSD-3-Clause"}],
            "description": "cryptography is a package which provides cryptographic recipes and primitives.",
        },
        {
            "bom-ref": "pkg:pypi/cffi@1.15.1",
            "type": "library",
            "name": "cffi",
            "version": "1.15.1",
            "purl": "pkg:pypi/cffi@1.15.1",
            "licenses": [{"license": {"name": "MIT"}}],
        },
    ],
    "dependencies": [
        {
            "ref": "pkg:pypi/cryptography@41.0.0",
            "dependsOn": ["pkg:pypi/cffi@1.15.1"],
        }
    ],
}

SAMPLE_SPDX = {
    "spdxVersion": "SPDX-2.3",
    "dataLicense": "CC0-1.0",
    "SPDXID": "SPDXRef-DOCUMENT",
    "name": "Python-SPDX-Test",
    "packages": [
        {
            "name": "requests",
            "SPDXID": "SPDXRef-Package-requests",
            "versionInfo": "2.31.0",
            "licenseConcluded": "Apache-2.0",
            "licenseDeclared": "Apache-2.0",
            "externalRefs": [
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": "pkg:pypi/requests@2.31.0",
                }
            ],
        },
        {
            "name": "urllib3",
            "SPDXID": "SPDXRef-Package-urllib3",
            "versionInfo": "2.0.4",
            "licenseConcluded": "MIT",
            "externalRefs": [
                {
                    "referenceCategory": "PACKAGE-MANAGER",
                    "referenceType": "purl",
                    "referenceLocator": "pkg:pypi/urllib3@2.0.4",
                }
            ],
        },
    ],
    "relationships": [
        {
            "spdxElementId": "SPDXRef-Package-requests",
            "relationshipType": "DEPENDS_ON",
            "relatedSpdxElement": "SPDXRef-Package-urllib3",
        }
    ],
}


def test_cyclonedx_normalization():
    """Verify CycloneDX normalization of components, version, purl, licenses, dependencies."""
    sbom = ingest_sbom(SAMPLE_CYCLONEDX)

    assert isinstance(sbom, NormalizedSbom)
    assert sbom.format == "CycloneDX"
    assert sbom.spec_version == "1.6"
    assert sbom.component_count == 2
    assert sbom.relationship_count == 1

    crypto_comp = next((c for c in sbom.components if c.name == "cryptography"), None)
    assert crypto_comp is not None
    assert crypto_comp.version == "41.0.0"
    assert crypto_comp.purl == "pkg:pypi/cryptography@41.0.0"
    assert "Apache-2.0" in crypto_comp.licenses
    assert "BSD-3-Clause" in crypto_comp.licenses

    cffi_comp = next((c for c in sbom.components if c.name == "cffi"), None)
    assert cffi_comp is not None
    assert cffi_comp.licenses == ["MIT"]

    rel = sbom.dependency_relationships[0]
    assert rel.from_ref == "pkg:pypi/cryptography@41.0.0"
    assert rel.to_ref == "pkg:pypi/cffi@1.15.1"
    assert rel.relationship_type == "DEPENDS_ON"

    d = sbom.to_dict()
    assert d["format"] == "CycloneDX"
    assert len(d["components"]) == 2


def test_spdx_normalization():
    """Verify SPDX normalization of packages, version, purl from externalRefs, licenses, relationships."""
    sbom = ingest_sbom(SAMPLE_SPDX)

    assert isinstance(sbom, NormalizedSbom)
    assert sbom.format == "SPDX"
    assert sbom.spec_version == "SPDX-2.3"
    assert sbom.component_count == 2
    assert sbom.relationship_count == 1

    requests_pkg = next((c for c in sbom.components if c.name == "requests"), None)
    assert requests_pkg is not None
    assert requests_pkg.version == "2.31.0"
    assert requests_pkg.purl == "pkg:pypi/requests@2.31.0"
    assert requests_pkg.licenses == ["Apache-2.0"]

    rel = sbom.dependency_relationships[0]
    assert rel.from_ref == "SPDXRef-Package-requests"
    assert rel.to_ref == "SPDXRef-Package-urllib3"
    assert rel.relationship_type == "DEPENDS_ON"


def test_schema_validation_before_processing():
    """Verify pre-validation catches malformed documents before ingestion."""
    # 1. Non-dict input
    res1 = validate_sbom_structure("not-a-dict")
    assert res1.valid is False

    # 2. Unknown schema
    res2 = validate_sbom_structure({"some_unknown_schema": True})
    assert res2.valid is False
    assert any("Unrecognized" in e for e in res2.errors)

    # 3. CycloneDX missing components
    res3 = validate_sbom_structure({"bomFormat": "CycloneDX", "specVersion": "1.6"})
    assert res3.valid is False
    assert any("components" in e for e in res3.errors)

    # 4. Ingesting invalid raises UnsupportedFormatError
    with pytest.raises(UnsupportedFormatError):
        ingest_sbom({"bomFormat": "UnknownFormat"})


def test_rejection_of_excessively_large_documents():
    """Verify bounds enforcement safely rejects excessive component counts."""
    huge_components = [{"name": f"pkg_{i}", "version": "1.0.0"} for i in range(50001)]
    huge_sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "components": huge_components,
    }

    res = validate_sbom_structure(huge_sbom)
    assert res.valid is False
    assert any("exceeds the maximum safety bound" in e for e in res.errors)

    with pytest.raises(InvalidInputError):
        ingest_sbom(huge_sbom)


def test_rejection_of_dangerous_properties():
    """Verify protection against prototype pollution keys."""
    polluted = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "components": [],
        "__proto__": {"malicious": True},
    }
    res = validate_sbom_structure(polluted)
    assert res.valid is False
    assert any("Dangerous property" in e for e in res.errors)
