import pytest
from scanners.sca.sbom_ingestion import NormalizedComponent
from scanners.sca.sca_crypto_mapper import CryptoLibraryMapper

def test_crypto_library_mapper():
    mapper = CryptoLibraryMapper()
    
    # Mock some normalized components
    bouncy = NormalizedComponent(
        component_id="pkg:maven/org.bouncycastle/bcprov-jdk18on@1.79",
        name="bcprov-jdk18on",
        version="1.79",
        purl="pkg:maven/org.bouncycastle/bcprov-jdk18on@1.79"
    )
    
    crypto_py = NormalizedComponent(
        component_id="pkg:pypi/cryptography@43.0.0",
        name="cryptography",
        version="43.0.0",
        purl="pkg:pypi/cryptography@43.0.0"
    )
    
    non_crypto = NormalizedComponent(
        component_id="pkg:npm/lodash@4.17.21",
        name="lodash",
        version="4.17.21",
        purl="pkg:npm/lodash@4.17.21"
    )
    
    from scanners.sca.sbom_ingestion import NormalizedSbom, DependencyRelationship
    
    sbom = NormalizedSbom(
        format="CycloneDX",
        spec_version="1.7",
        component_count=3,
        relationship_count=2,
        components=[bouncy, crypto_py, non_crypto],
        dependency_relationships=[
            DependencyRelationship(from_ref="root", to_ref="pkg:maven/org.bouncycastle/bcprov-jdk18on@1.79"),
            DependencyRelationship(from_ref="pkg:maven/org.bouncycastle/bcprov-jdk18on@1.79", to_ref="pkg:pypi/cryptography@43.0.0")
        ]
    )
    
    capabilities = mapper.map_capabilities(sbom)
    
    assert len(capabilities) == 2
    
    # BouncyCastle checks
    bc_cap = next(c for c in capabilities if "bcprov" in c.component_id)
    assert bc_cap.fips_validated is True
    assert bc_cap.pqc_support is True
    
    # Cryptography checks
    crypt_cap = next(c for c in capabilities if "cryptography" in c.component_id)
    
    # Transitive checks
    assert bc_cap.is_transitive is False # It's a direct dependency of 'root'
    assert crypt_cap.is_transitive is True # It's only a dependency of bouncy, not 'root'
