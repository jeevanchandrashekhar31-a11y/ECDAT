"""
Unit and Security Tests for ECDAT Policy Security & Governance Subsystem (Phase 11.2).
"""

import pytest
import copy
from scanners.policy_security import PolicySecurityController, PolicySecurityError
from scanners.policy_engine import DEFAULT_POLICY_PATH, PolicyEngine


@pytest.fixture
def controller():
    return PolicySecurityController(signing_secret="test-governance-signing-secret-key-12345")


@pytest.fixture
def valid_policy_doc():
    engine = PolicyEngine()
    return engine.load_policy(DEFAULT_POLICY_PATH)


def test_rbac_admin_authorization(controller, valid_policy_doc):
    non_admin = {"username": "developer_dave", "role": "developer"}
    admin = {"username": "alice_admin", "role": "admin"}

    # Developer attempting to create policy draft fails
    with pytest.raises(PolicySecurityError, match="Unauthorized"):
        controller.create_draft(valid_policy_doc, author=non_admin)

    # Admin succeeds
    draft = controller.create_draft(valid_policy_doc, author=admin)
    assert draft["status"] == "DRAFT"
    assert draft["author"] == "alice_admin"


def test_four_eyes_approval_workflow(controller, valid_policy_doc):
    author = {"username": "alice_author", "role": "admin"}
    approver = {"username": "bob_approver", "role": "admin"}

    # 1. Create draft
    controller.create_draft(valid_policy_doc, author=author)
    version = valid_policy_doc["version"]

    # 2. Submit for approval
    controller.submit_for_approval(version, submitter=author)
    assert controller.versions[version]["status"] == "PENDING_APPROVAL"

    # 3. Self-approval MUST be rejected (Four-eyes violation)
    with pytest.raises(PolicySecurityError, match="Four-Eyes Governance Violation"):
        controller.approve_policy(version, approver=author)

    # 4. Peer approval succeeds
    approved = controller.approve_policy(version, approver=approver, comments="Approved for production rollout.")
    assert approved["status"] == "APPROVED"
    assert approved["approver"] == "bob_approver"

    # 5. Activation
    activated = controller.activate_policy(version, admin=approver)
    assert activated["status"] == "ACTIVE"
    assert controller.active_version == version


def test_immutable_audit_ledger_integrity_and_tamper_detection(controller, valid_policy_doc):
    admin1 = {"username": "alice", "role": "admin"}
    admin2 = {"username": "bob", "role": "admin"}

    controller.create_draft(valid_policy_doc, author=admin1)
    controller.submit_for_approval(valid_policy_doc["version"], submitter=admin1)
    controller.approve_policy(valid_policy_doc["version"], approver=admin2)

    # Verify audit log is currently valid
    valid, errors = controller.verify_audit_chain_integrity()
    assert valid is True
    assert len(errors) == 0
    assert len(controller.audit_log) >= 4  # GENESIS + DRAFT + SUBMIT + APPROVE

    # Malicious tampering: tamper with an entry's actor or payload
    controller.audit_log[2]["actor"] = "malicious_hacker"

    # Tamper detection catches the violation!
    valid_after_tamper, errors_after = controller.verify_audit_chain_integrity()
    assert valid_after_tamper is False
    assert len(errors_after) > 0
    assert "Hash mismatch" in errors_after[0] or "Chain break" in errors_after[0]


def test_rollback_to_previous_version(controller, valid_policy_doc):
    author = {"username": "alice", "role": "admin"}
    approver = {"username": "bob", "role": "admin"}

    # Version 1.0.0
    v1_doc = copy.deepcopy(valid_policy_doc)
    v1_doc["version"] = "1.0.0"
    controller.create_draft(v1_doc, author=author)
    controller.submit_for_approval("1.0.0", submitter=author)
    controller.approve_policy("1.0.0", approver=approver)
    controller.activate_policy("1.0.0", admin=approver)
    assert controller.active_version == "1.0.0"

    # Version 2.0.0
    v2_doc = copy.deepcopy(valid_policy_doc)
    v2_doc["version"] = "2.0.0"
    controller.create_draft(v2_doc, author=author)
    controller.submit_for_approval("2.0.0", submitter=author)
    controller.approve_policy("2.0.0", approver=approver)
    controller.activate_policy("2.0.0", admin=approver)
    assert controller.active_version == "2.0.0"
    assert controller.versions["1.0.0"]["status"] == "SUPERSEDED"

    # Rollback from 2.0.0 back to 1.0.0
    rolled_back = controller.rollback_to_version("1.0.0", admin=author, reason="Regression detected in v2 rules")
    assert rolled_back["version"] == "1.0.0"
    assert rolled_back["status"] == "ACTIVE"
    assert controller.active_version == "1.0.0"
    assert controller.versions["2.0.0"]["status"] == "ROLLED_BACK"

    # Verify rollback was audited
    last_audit = controller.audit_log[-1]
    assert last_audit["action"] == "POLICY_ROLLED_BACK"
    assert last_audit["details"]["target_version"] == "1.0.0"


def test_sandbox_dry_run_policy_testing(controller, valid_policy_doc):
    test_assets = [
        {"asset_id": "test-1", "algorithm": "MD5"},
        {"asset_id": "test-2", "algorithm": "AES-256-GCM"},
    ]

    report = controller.test_policy(valid_policy_doc, test_assets)
    assert report["total_assets_tested"] == 2
    assert report["blocking_violations"] == 1
    assert report["clean_assets"] == 1
    assert report["is_safe_for_production"] is False
    assert report["verdict"] == "BLOCK"


def test_signed_policy_artifact_generation_and_verification(controller, valid_policy_doc):
    signer = {"username": "ciso_alex", "role": "admin"}

    # 1. Sign policy
    bundle = controller.sign_policy_bundle(valid_policy_doc, signer_info=signer)
    assert "signature" in bundle
    assert bundle["signature_algorithm"] == "HMAC-SHA256"
    assert bundle["signer"] == "ciso_alex"

    # 2. Verify legitimate bundle
    valid, err = controller.verify_signed_policy_bundle(bundle)
    assert valid is True
    assert err is None

    # 3. Tamper with policy body inside bundle
    tampered_bundle = copy.deepcopy(bundle)
    tampered_bundle["policy"]["description"] = "Malicious unauthorized modification"

    tampered_valid, tampered_err = controller.verify_signed_policy_bundle(tampered_bundle)
    assert tampered_valid is False
    assert "tampered with" in tampered_err


def test_arbitrary_code_injection_prevention(controller, valid_policy_doc):
    malicious_policy = copy.deepcopy(valid_policy_doc)
    malicious_policy["__proto__"] = {"polluted": True}

    admin = {"username": "admin", "role": "admin"}
    with pytest.raises(Exception):
        controller.create_draft(malicious_policy, author=admin)
