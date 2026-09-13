"""
Unit Tests for ECDAT Crypto Dependency Mapping & Reachability Engine (Python) — Phase 3.2
"""

import pytest
from scanners.sca.crypto_dependency_mapping import (
    ReachabilityLevel,
    CryptoDependencyKnowledgeBase,
    CryptoReachabilityClassifier,
    extract_name_from_purl,
    normalize_pkg_name,
)


@pytest.fixture
def kb():
    return CryptoDependencyKnowledgeBase()


@pytest.fixture
def classifier(kb):
    return CryptoReachabilityClassifier(kb)


def test_knowledge_base_loading(kb):
    assert kb.version == "1.0.0"
    assert len(kb.packages) >= 15
    assert len(kb.reachability_definitions) == 4

    # Verify 4 levels definition
    levels = kb.reachability_definitions
    assert levels["CAPABILITY_PRESENT"]["reachable"] is False
    assert levels["TRANSIENT_IMPORT"]["reachable"] is False
    assert levels["DIRECT_API_CALL"]["reachable"] is True
    assert levels["RUNTIME_CONFIRMED"]["reachable"] is True


def test_level_1_capability_present_not_overstated(classifier):
    """
    Package contains crypto capability in dependency manifest/SBOM,
    but neither imports nor calls are observed.
    Must NOT be labeled reachable.
    """
    res = classifier.classify(
        package_name="cryptography",
        version="41.0.3",
        purl="pkg:pypi/cryptography@41.0.3",
        is_present_in_manifest=True,
        imports=[],
        direct_calls=[],
        runtime_evidence=[],
    )

    assert res.reachability_level == ReachabilityLevel.CAPABILITY_PRESENT
    # CRITICAL REQUIREMENT: Do not overstate reachability
    assert res.is_reachable is False
    assert res.has_crypto_capability is True
    assert "AES" in res.crypto_capabilities
    assert "Reachability is not overstated" in res.rationale


def test_level_2_transient_import_not_overstated(classifier):
    """
    Package is imported, but application does not invoke crypto APIs directly.
    Must NOT be labeled reachable.
    """
    res = classifier.classify(
        package_name="crypto-js",
        version="4.1.1",
        purl="pkg:npm/crypto-js@4.1.1",
        is_present_in_manifest=True,
        imports=["import CryptoJS from 'crypto-js';"],
        direct_calls=[],
        runtime_evidence=[],
    )

    assert res.reachability_level == ReachabilityLevel.TRANSIENT_IMPORT
    # CRITICAL REQUIREMENT: Do not overstate reachability
    assert res.is_reachable is False
    assert len(res.evidence.imports) == 1
    assert len(res.evidence.direct_calls) == 0
    assert "Reachability is not overstated" in res.rationale


def test_level_3_direct_api_call_reachable(classifier):
    """
    Application directly invokes cryptographic APIs.
    Must be marked reachable.
    """
    res = classifier.classify(
        package_name="crypto-js",
        version="4.1.1",
        purl="pkg:npm/crypto-js@4.1.1",
        is_present_in_manifest=True,
        imports=["import CryptoJS from 'crypto-js';"],
        direct_calls=[{"api": "CryptoJS.AES.encrypt", "line": 23}],
        runtime_evidence=[],
    )

    assert res.reachability_level == ReachabilityLevel.DIRECT_API_CALL
    assert res.is_reachable is True
    assert len(res.evidence.direct_calls) == 1
    assert "directly invokes cryptographic APIs" in res.rationale


def test_level_4_runtime_confirmed_reachable(classifier):
    """
    Dynamic telemetry or network handshake confirms crypto operation.
    Must be marked reachable.
    """
    res = classifier.classify(
        package_name="openssl",
        version="3.0.8",
        is_present_in_manifest=True,
        imports=[],
        direct_calls=[],
        runtime_evidence=[{"description": "OpenSSL 3.0.8 negotiated TLS 1.3 handshake"}],
    )

    assert res.reachability_level == ReachabilityLevel.RUNTIME_CONFIRMED
    assert res.is_reachable is True
    assert len(res.evidence.runtime_observations) == 1
    assert "Runtime telemetry/execution trace confirmed" in res.rationale


def test_alias_and_purl_resolution(kb):
    pkg = kb.find_package("pkg:maven/org.bouncycastle/bcprov-jdk15on@1.70")
    assert pkg is not None
    assert pkg.canonical_name == "bcprov-jdk18on"
    assert "ML-KEM" in pkg.pqc_support

    pkg_rust = kb.find_package("ring")
    assert pkg_rust is not None
    assert "rust" in pkg_rust.ecosystems

    assert extract_name_from_purl("pkg:golang/golang.org/x/crypto@v0.1.0") == "golang.org/x/crypto"
    assert normalize_pkg_name("@types/node") == "node"


def test_full_correlation_pipeline(classifier):
    components = [
        {"name": "cryptography", "version": "41.0.3", "purl": "pkg:pypi/cryptography@41.0.3"},
        {"name": "crypto-js", "version": "4.1.1", "purl": "pkg:npm/crypto-js@4.1.1"},
        {"name": "ring", "version": "0.17.5", "purl": "pkg:cargo/ring@0.17.5"},
        {"name": "openssl", "version": "3.0.2", "purl": "pkg:generic/openssl@3.0.2"},
        {"name": "flask", "version": "2.3.2", "purl": "pkg:pypi/flask@2.3.2"},  # non-crypto
    ]

    static_findings = [
        {"target_package": "crypto-js", "api": "CryptoJS.AES.encrypt", "code_snippet": "CryptoJS.AES.encrypt(msg, key)"},
        {"target_package": "ring", "code_snippet": "use ring::aead;"},
    ]

    dynamic_findings = [
        {"target_package": "openssl", "description": "Active OpenSSL crypto session observed"},
    ]

    report = classifier.correlate_dependencies(
        components=components,
        static_findings=static_findings,
        dynamic_findings=dynamic_findings,
    )

    summary = report["summary"]
    assert summary["total_dependencies_evaluated"] == 5
    assert summary["crypto_packages_detected"] == 4

    breakdown = summary["reachability_breakdown"]
    assert breakdown["CAPABILITY_PRESENT"] == 1
    assert breakdown["TRANSIENT_IMPORT"] == 1
    assert breakdown["DIRECT_API_CALL"] == 1
    assert breakdown["RUNTIME_CONFIRMED"] == 1

    # Strict reachability counts:
    assert summary["reachable_crypto_count"] == 2
    assert summary["unreachable_crypto_count"] == 2
