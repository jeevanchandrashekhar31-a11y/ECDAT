"""
Unit and Governance Tests for ECDAT Human Approval Workflow (Phase 12.3).
"""

import pytest
from scanners.approval_workflow import (
    ApprovalWorkflowEngine,
    ApprovalWorkflowError,
    APPROVAL_STATES,
    SENSITIVE_APPROVAL_CATEGORIES,
    normalize_category,
    requires_explicit_approval,
)


@pytest.fixture
def engine():
    return ApprovalWorkflowEngine()


def test_six_sensitive_categories_detected():
    # 1. key/certificate rotation
    assert requires_explicit_approval("key/certificate rotation") is True
    assert normalize_category("cert_renewal") == "KEY_CERT_ROTATION"

    # 2. production config changes
    assert requires_explicit_approval("production config changes") is True
    assert normalize_category("prod_config_change") == "PROD_CONFIG_CHANGE"

    # 3. algorithm migration
    assert requires_explicit_approval("algorithm migration") is True
    assert normalize_category("pqc_migration") == "ALGORITHM_MIGRATION"

    # 4. dependency upgrades
    assert requires_explicit_approval("dependency upgrades") is True
    assert normalize_category("library_upgrade") == "DEPENDENCY_UPGRADE"

    # 5. network changes
    assert requires_explicit_approval("network changes") is True
    assert normalize_category("tls_cipher_change") == "NETWORK_CHANGE"

    # 6. infrastructure changes
    assert requires_explicit_approval("infrastructure changes") is True
    assert normalize_category("cluster_host_upgrade") == "INFRASTRUCTURE_CHANGE"


def test_approval_lifecycle_happy_path(engine):
    proposer = {"username": "alice_engineer", "role": "developer"}
    reviewer = {"username": "bob_lead", "role": "reviewer"}
    approver = {"username": "charlie_secadmin", "role": "admin"}
    deployer = {"username": "cd_pipeline", "role": "deployer"}
    verifier = {"username": "ecdat_scanner", "role": "verifier"}

    # 1. PROPOSED
    req = engine.propose_remediation(
        {
            "title": "Migrate Ingress Gateway to ML-KEM-768",
            "category": "algorithm migration",
            "environment": "production",
        },
        proposer=proposer,
    )
    appr_id = req["approval_id"]
    assert req["state"] == "PROPOSED"
    assert req["requires_explicit_approval"] is True

    # 2. REVIEWED
    reviewed = engine.review_remediation(appr_id, reviewer=reviewer, comments="Diff looks solid.")
    assert reviewed["state"] == "REVIEWED"
    assert reviewed["reviewer"]["username"] == "bob_lead"

    # 3. APPROVED
    approved = engine.approve_remediation(appr_id, approver=approver, comments="Approved for rollout.")
    assert approved["state"] == "APPROVED"
    assert approved["approver"]["username"] == "charlie_secadmin"

    # 4. APPLIED
    applied = engine.apply_remediation(appr_id, deployer=deployer)
    assert applied["state"] == "APPLIED"
    assert applied["deployer"]["username"] == "cd_pipeline"

    # 5. VERIFIED
    verified = engine.verify_remediation(
        appr_id,
        verifier=verifier,
        verification_results={"tests_passed": True, "finding_resolved": True},
    )
    assert verified["state"] == "VERIFIED"
    assert len(verified["audit_history"]) == 5


def test_four_eyes_governance_violation(engine):
    proposer = {"username": "alice_engineer", "role": "developer"}
    reviewer = {"username": "bob_lead", "role": "reviewer"}

    req = engine.propose_remediation({"title": "Renew production cert", "category": "key/certificate rotation"}, proposer=proposer)
    appr_id = req["approval_id"]
    engine.review_remediation(appr_id, reviewer=reviewer)

    # Proposer attempts to approve their own change -> MUST FAIL
    with pytest.raises(ApprovalWorkflowError, match="Four-Eyes Governance Violation"):
        engine.approve_remediation(appr_id, approver={"username": "alice_engineer", "role": "admin"})


def test_rbac_approver_authorization(engine):
    proposer = {"username": "alice_engineer", "role": "developer"}
    reviewer = {"username": "bob_lead", "role": "reviewer"}
    non_admin = {"username": "dave_dev", "role": "developer"}

    req = engine.propose_remediation({"title": "Upgrade OpenSSL", "category": "dependency upgrades"}, proposer=proposer)
    appr_id = req["approval_id"]
    engine.review_remediation(appr_id, reviewer=reviewer)

    # Developer role cannot approve
    with pytest.raises(ApprovalWorkflowError, match="Unauthorized"):
        engine.approve_remediation(appr_id, approver=non_admin)


def test_sensitive_change_cannot_apply_without_approval(engine):
    proposer = {"username": "alice_engineer", "role": "developer"}
    req = engine.propose_remediation({"title": "Network TLS change", "category": "network changes"}, proposer=proposer)
    appr_id = req["approval_id"]

    # Attempt to apply directly while in PROPOSED state -> MUST FAIL
    with pytest.raises(ApprovalWorkflowError, match="Explicit Human Approval Required"):
        engine.apply_remediation(appr_id, deployer={"username": "deployer", "role": "deployer"})


def test_rollback_state_transition(engine):
    proposer = {"username": "alice_engineer", "role": "developer"}
    reviewer = {"username": "bob_lead", "role": "reviewer"}
    approver = {"username": "charlie_secadmin", "role": "admin"}
    deployer = {"username": "cd_pipeline", "role": "deployer"}

    req = engine.propose_remediation({"title": "Host config change", "category": "infrastructure changes"}, proposer=proposer)
    appr_id = req["approval_id"]
    engine.review_remediation(appr_id, reviewer=reviewer)
    engine.approve_remediation(appr_id, approver=approver)
    engine.apply_remediation(appr_id, deployer=deployer)

    # Rollback
    rolled_back = engine.rollback_remediation(appr_id, actor={"username": "secops", "role": "admin"}, reason="Latency spike > 50ms")
    assert rolled_back["state"] == "ROLLED_BACK"


def test_fail_state_transition(engine):
    proposer = {"username": "alice_engineer", "role": "developer"}
    req = engine.propose_remediation({"title": "Test change", "category": "other"}, proposer=proposer)
    appr_id = req["approval_id"]

    failed = engine.fail_remediation(appr_id, actor={"username": "qa_tester", "role": "qa"}, reason="Syntax error detected")
    assert failed["state"] == "FAILED"
