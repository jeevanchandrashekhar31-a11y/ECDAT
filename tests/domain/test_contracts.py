"""
Tests for ECDAT Domain Contracts
Validates field constraints, serializations, enumerations, and DiscoveryEngine interface.
"""

import pytest
from pydantic import ValidationError
from scanners.domain.contracts import (
    DiscoveryEngine,
    ScanRequest,
    ScanContext,
    Finding,
    Evidence,
    CryptoAsset,
    AssetRelationship,
    Observation,
    RiskAssessment,
    PolicyEvaluation,
    RemediationAction,
    RemediationPlan,
    ScanResult,
    ScanType,
    ScanStatus,
    SeverityLevel,
    ConfidenceLevel,
    AssetType,
    RelationshipType,
    QuantumRelevance,
    MoscaStatus,
)


def test_scan_request_and_context_instantiation():
    req = ScanRequest(
        scan_type=ScanType.STATIC,
        target="src/",
        policy_profile="regulated_bfsi",
        fail_on="critical",
        include_extensions={".c", ".h"},
        exclude_directories={".git", "vendor"},
        max_file_size_bytes=2 * 1024 * 1024,
        max_files=5000,
    )
    assert req.scan_type == ScanType.STATIC
    assert req.target == "src/"
    assert req.max_files == 5000

    ctx = ScanContext(
        scan_id="scan_unit_test_001",
        request=req,
    )
    assert ctx.scan_id == "scan_unit_test_001"
    assert not ctx.is_cancelled
    assert ctx.progress_percent == 0


def test_evidence_and_observation():
    ev = Evidence(
        location="src/crypto/tls.c",
        line_number=42,
        snippet="EVP_sha1();",
        proof_type="source_code",
        confidence=ConfidenceLevel.HIGH,
    )
    assert ev.location == "src/crypto/tls.c"
    assert ev.line_number == 42
    assert ev.confidence == ConfidenceLevel.HIGH

    obs = Observation(
        observation_id="obs_001",
        discovery_engine="ECDAT Static Scanner v2.0",
        target="src/crypto/tls.c",
        raw_algorithm="SHA1",
        evidence=ev,
    )
    assert obs.observation_id == "obs_001"
    assert obs.raw_algorithm == "SHA1"


def test_finding_and_crypto_asset():
    ev = Evidence(
        location="gateway.example.com:443",
        proof_type="tls_handshake",
        confidence=ConfidenceLevel.HIGH,
    )

    finding = Finding(
        finding_id="fnd_001",
        asset_id="net:tls:gateway.example.com:443",
        algorithm_standard="RSA",
        primitive_type="asymmetric_cipher",
        key_size_bits=1024,
        severity=SeverityLevel.CRITICAL,
        confidence=ConfidenceLevel.HIGH,
        evidence=ev,
        analysis_source="ssl_handshake",
    )
    assert finding.algorithm_standard == "RSA"
    assert finding.key_size_bits == 1024
    assert finding.severity == SeverityLevel.CRITICAL

    asset = CryptoAsset(
        asset_id="net:tls:gateway.example.com:443",
        primary_identifier="https://gateway.example.com:443",
        asset_type=AssetType.NETWORK_ENDPOINT,
        data_sensitivity="confidential",
        business_criticality="critical",
        highest_severity=SeverityLevel.CRITICAL,
        at_quantum_risk=True,
        findings_count=1,
    )
    assert asset.asset_type == AssetType.NETWORK_ENDPOINT
    assert asset.at_quantum_risk is True


def test_asset_relationship():
    rel = AssetRelationship(
        source_id="net:tls:gateway.example.com:443",
        target_id="cert:sha256:abcd1234",
        relationship_type=RelationshipType.SECURES,
    )
    assert rel.relationship_type == RelationshipType.SECURES


def test_risk_assessment_and_policy_evaluation():
    risk = RiskAssessment(
        classical_severity=SeverityLevel.HIGH,
        classical_score=8.5,
        quantum_relevance=QuantumRelevance.SHOR_VULNERABLE,
        shor_vulnerable=True,
        mosca_status=MoscaStatus.AT_RISK,
        mosca_collapse_year=2029,
        explainability=["RSA-2048 is vulnerable to Shor's algorithm on CRQC."],
    )
    assert risk.quantum_relevance == QuantumRelevance.SHOR_VULNERABLE
    assert risk.shor_vulnerable is True
    assert risk.mosca_status == MoscaStatus.AT_RISK

    eval_result = PolicyEvaluation(
        policy_profile="regulated_bfsi",
        fail_on_threshold="critical",
        passed=False,
        blocking_reasons=["Asset uses RSA-1024 which violates BFSI baseline."],
    )
    assert not eval_result.passed
    assert len(eval_result.blocking_reasons) == 1


def test_remediation_plan_and_action():
    action = RemediationAction(
        action_id="act_001",
        asset_id="net:tls:gateway.example.com:443",
        priority=1,
        title="Upgrade to ML-KEM-768 Hybrid",
        description="Migrate key encapsulation from classical RSA to ML-KEM-768 hybrid.",
        target_standard="ML-KEM-768",
        recommended_year=2026,
        effort_estimate="medium",
    )
    plan = RemediationPlan(
        plan_id="plan_001",
        scan_id="scan_unit_test_001",
        total_actions=1,
        actions=[action],
    )
    assert plan.total_actions == 1
    assert plan.actions[0].target_standard == "ML-KEM-768"


def test_scan_result_and_discovery_engine_contract():
    class DummyEngine(DiscoveryEngine):
        def scan(self, request: ScanRequest, context: ScanContext) -> ScanResult:
            return ScanResult(
                scan_id=context.scan_id,
                scan_type=request.scan_type,
                target=request.target,
                status=ScanStatus.SUCCESS,
                engine_name="DummyEngine",
                engine_version="1.0.0",
                duration_seconds=0.12,
                summary_metrics={"total_files": 1},
            )

    engine = DummyEngine()
    req = ScanRequest(scan_type=ScanType.STATIC, target="dummy/")
    ctx = ScanContext(scan_id="scan_test", request=req)
    result = engine.scan(req, ctx)

    assert isinstance(result, ScanResult)
    assert result.status == ScanStatus.SUCCESS
    assert result.engine_name == "DummyEngine"


def test_discovery_engine_abc_enforcement():
    class IncompleteEngine(DiscoveryEngine):
        pass

    with pytest.raises(TypeError):
        # Cannot instantiate abstract class without implementing scan()
        IncompleteEngine()
