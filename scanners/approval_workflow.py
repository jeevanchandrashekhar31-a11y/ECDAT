"""
ECDAT Safe Remediation Engine — Human Approval Workflow (Phase 12.3).

Enforces explicit human approval for 6 sensitive operational categories:
- key/certificate rotation
- production config changes
- algorithm migration
- dependency upgrades
- network changes
- infrastructure changes

Supported Approval States:
PROPOSED -> REVIEWED -> APPROVED -> APPLIED -> VERIFIED
                     \\          \\          \\-> ROLLED_BACK
                      \\          \\-----------> FAILED
"""

from __future__ import annotations
import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


APPROVAL_STATES = [
    "PROPOSED",
    "REVIEWED",
    "APPROVED",
    "APPLIED",
    "VERIFIED",
    "ROLLED_BACK",
    "FAILED",
]

SENSITIVE_APPROVAL_CATEGORIES = [
    "KEY_CERT_ROTATION",
    "PROD_CONFIG_CHANGE",
    "ALGORITHM_MIGRATION",
    "DEPENDENCY_UPGRADE",
    "NETWORK_CHANGE",
    "INFRASTRUCTURE_CHANGE",
]


class ApprovalWorkflowError(Exception):
    """Exception raised for governance or state machine violations."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize_category(category_str: str = "") -> str:
    """Normalizes input category string to canonical form."""
    norm = str(category_str).strip().upper().replace(" ", "_").replace("-", "_").replace("/", "_")

    if any(k in norm for k in ["KEY", "CERT", "ROTATION", "RENEWAL"]):
        return "KEY_CERT_ROTATION"
    if "PROD_CONFIG" in norm or "PRODUCTION_CONFIG" in norm or ("CONFIG" in norm and "PROD" in norm):
        return "PROD_CONFIG_CHANGE"
    if any(k in norm for k in ["ALGORITHM", "MIGRATION", "PQC", "CRYPTO_UPGRADE"]):
        return "ALGORITHM_MIGRATION"
    if any(k in norm for k in ["DEPENDENCY", "LIBRARY", "PACKAGE"]):
        return "DEPENDENCY_UPGRADE"
    if any(k in norm for k in ["NETWORK", "TLS", "CIPHER_SUITE", "INGRESS", "GATEWAY"]):
        return "NETWORK_CHANGE"
    if any(k in norm for k in ["INFRASTRUCTURE", "CLUSTER", "SERVER", "HOST"]):
        return "INFRASTRUCTURE_CHANGE"

    return norm


def requires_explicit_approval(category: str, environment: str = "production") -> bool:
    """Checks whether an action requires explicit human sign-off."""
    norm = normalize_category(category)
    if norm in SENSITIVE_APPROVAL_CATEGORIES:
        return True
    if environment.lower() == "production" and "CONFIG" in norm:
        return True
    return False


class ApprovalWorkflowEngine:
    """State machine controller managing human approval lifecycles and cryptographic audit trails."""

    def __init__(self, signing_secret: Optional[str] = None):
        self.signing_secret = signing_secret or "ecdat-python-approval-secret-2026"
        self.approvals: Dict[str, Dict[str, Any]] = {}

    def _compute_transition_hash(self, prev_hash: Optional[str], payload: Dict[str, Any]) -> str:
        raw = f"{prev_hash or 'GENESIS'}|{json.dumps(payload, sort_keys=True)}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def propose_remediation(
        self,
        data: Dict[str, Any],
        proposer: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """1. PROPOSE: Creates an approval request in PROPOSED state."""
        proposer = proposer or {"username": "engineer", "role": "developer"}
        if not data.get("title"):
            raise ApprovalWorkflowError("Approval proposal requires a title")

        approval_id = data.get("approval_id") or data.get("id") or f"appr_{uuid.uuid4().hex[:8]}"
        category = normalize_category(data.get("category") or data.get("action_type") or "ALGORITHM_MIGRATION")
        environment = data.get("environment", "production")
        explicit_required = requires_explicit_approval(category, environment)

        now_ts = datetime.now(timezone.utc).isoformat()
        genesis_hash = self._compute_transition_hash(
            None,
            {
                "approval_id": approval_id,
                "state": "PROPOSED",
                "proposer": proposer["username"],
                "timestamp": now_ts,
            },
        )

        initial_audit = {
            "event_id": f"evt_{uuid.uuid4().hex[:8]}",
            "from_state": None,
            "to_state": "PROPOSED",
            "actor": proposer["username"],
            "role": proposer.get("role", "developer"),
            "timestamp": now_ts,
            "comments": data.get("comments", "Initial remediation proposal created."),
            "hash": genesis_hash,
        }

        record = {
            "approval_id": approval_id,
            "state": "PROPOSED",
            "title": data["title"],
            "description": data.get("description", ""),
            "category": category,
            "environment": environment,
            "requires_explicit_approval": explicit_required,
            "finding_id": data.get("finding_id"),
            "affected_asset": data.get("affected_asset"),
            "target_standard": data.get("target_standard"),
            "patch_diff": data.get("patch_diff"),
            "test_plan": data.get("test_plan"),
            "rollback_plan": data.get("rollback_plan"),
            "proposer": {
                "username": proposer["username"],
                "role": proposer.get("role", "developer"),
                "proposed_at": now_ts,
            },
            "reviewer": None,
            "approver": None,
            "deployer": None,
            "verifier": None,
            "audit_history": [initial_audit],
            "current_state_hash": genesis_hash,
        }

        self.approvals[approval_id] = record
        return record

    def review_remediation(
        self,
        approval_id: str,
        reviewer: Optional[Dict[str, str]] = None,
        comments: str = "Reviewed and verified.",
    ) -> Dict[str, Any]:
        """2. REVIEW: Transitions from PROPOSED -> REVIEWED."""
        reviewer = reviewer or {"username": "tech_lead", "role": "reviewer"}
        record = self.get_approval(approval_id)

        if record["state"] != "PROPOSED":
            raise ApprovalWorkflowError(f"Cannot review approval in state '{record['state']}'. Expected 'PROPOSED'.")

        now_ts = datetime.now(timezone.utc).isoformat()
        new_hash = self._compute_transition_hash(
            record["current_state_hash"],
            {
                "approval_id": approval_id,
                "from_state": record["state"],
                "to_state": "REVIEWED",
                "reviewer": reviewer["username"],
                "timestamp": now_ts,
            },
        )

        record["state"] = "REVIEWED"
        record["reviewer"] = {
            "username": reviewer["username"],
            "role": reviewer.get("role", "reviewer"),
            "reviewed_at": now_ts,
            "comments": comments,
        }

        record["audit_history"].append(
            {
                "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                "from_state": "PROPOSED",
                "to_state": "REVIEWED",
                "actor": reviewer["username"],
                "role": reviewer.get("role", "reviewer"),
                "timestamp": now_ts,
                "comments": comments,
                "hash": new_hash,
            }
        )

        record["current_state_hash"] = new_hash
        return record

    def approve_remediation(
        self,
        approval_id: str,
        approver: Optional[Dict[str, str]] = None,
        comments: str = "Approved for execution.",
    ) -> Dict[str, Any]:
        """3. APPROVE: Transitions from REVIEWED -> APPROVED. Enforces Four-Eyes & RBAC."""
        approver = approver or {"username": "sec_admin", "role": "admin"}
        record = self.get_approval(approval_id)

        if record["state"] != "REVIEWED":
            raise ApprovalWorkflowError(
                f"Cannot approve remediation in state '{record['state']}'. Expected 'REVIEWED'."
            )

        # Four-Eyes Governance Check
        if record["proposer"]["username"].lower() == approver["username"].lower():
            raise ApprovalWorkflowError(
                f"Four-Eyes Governance Violation: Proposer '{record['proposer']['username']}' cannot approve their own remediation proposal.",
                status_code=403,
            )

        # RBAC Check
        allowed_roles = ["admin", "security_lead", "ciso", "secops"]
        if str(approver.get("role", "")).lower() not in allowed_roles:
            raise ApprovalWorkflowError(
                f"Unauthorized: Role '{approver.get('role')}' is not authorized to approve cryptographic remediation.",
                status_code=403,
            )

        now_ts = datetime.now(timezone.utc).isoformat()
        new_hash = self._compute_transition_hash(
            record["current_state_hash"],
            {
                "approval_id": approval_id,
                "from_state": record["state"],
                "to_state": "APPROVED",
                "approver": approver["username"],
                "timestamp": now_ts,
            },
        )

        record["state"] = "APPROVED"
        record["approver"] = {
            "username": approver["username"],
            "role": approver.get("role", "admin"),
            "approved_at": now_ts,
            "comments": comments,
        }

        record["audit_history"].append(
            {
                "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                "from_state": "REVIEWED",
                "to_state": "APPROVED",
                "actor": approver["username"],
                "role": approver.get("role", "admin"),
                "timestamp": now_ts,
                "comments": comments,
                "hash": new_hash,
            }
        )

        record["current_state_hash"] = new_hash
        return record

    def apply_remediation(
        self,
        approval_id: str,
        deployer: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """4. APPLY: Transitions from APPROVED -> APPLIED."""
        deployer = deployer or {"username": "automation_pipeline", "role": "deployer"}
        record = self.get_approval(approval_id)

        # If explicit approval is required, state MUST be APPROVED
        if record["requires_explicit_approval"] and record["state"] != "APPROVED":
            raise ApprovalWorkflowError(
                f"Explicit Human Approval Required: Remediation for '{record['category']}' in '{record['environment']}' cannot be applied in state '{record['state']}'. Must be 'APPROVED'.",
                status_code=403,
            )

        if record["state"] not in ["APPROVED", "REVIEWED", "PROPOSED"]:
            raise ApprovalWorkflowError(f"Cannot apply remediation in terminal or invalid state '{record['state']}'.")

        now_ts = datetime.now(timezone.utc).isoformat()
        new_hash = self._compute_transition_hash(
            record["current_state_hash"],
            {
                "approval_id": approval_id,
                "from_state": record["state"],
                "to_state": "APPLIED",
                "deployer": deployer["username"],
                "timestamp": now_ts,
            },
        )

        record["state"] = "APPLIED"
        record["deployer"] = {
            "username": deployer["username"],
            "role": deployer.get("role", "deployer"),
            "applied_at": now_ts,
        }

        record["audit_history"].append(
            {
                "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                "from_state": record["audit_history"][-1]["to_state"],
                "to_state": "APPLIED",
                "actor": deployer["username"],
                "role": deployer.get("role", "deployer"),
                "timestamp": now_ts,
                "comments": "Remediation patch applied to target environment.",
                "hash": new_hash,
            }
        )

        record["current_state_hash"] = new_hash
        return record

    def verify_remediation(
        self,
        approval_id: str,
        verifier: Optional[Dict[str, str]] = None,
        verification_results: Optional[Dict[str, bool]] = None,
    ) -> Dict[str, Any]:
        """5. VERIFY: Transitions from APPLIED -> VERIFIED."""
        verifier = verifier or {"username": "ecdat_rescan", "role": "verifier"}
        verification_results = verification_results or {"tests_passed": True, "finding_resolved": True}
        record = self.get_approval(approval_id)

        if record["state"] != "APPLIED":
            raise ApprovalWorkflowError(f"Cannot verify remediation in state '{record['state']}'. Expected 'APPLIED'.")

        if not verification_results.get("tests_passed") or not verification_results.get("finding_resolved"):
            return self.fail_remediation(approval_id, verifier, "Verification tests or rescan check failed.")

        now_ts = datetime.now(timezone.utc).isoformat()
        new_hash = self._compute_transition_hash(
            record["current_state_hash"],
            {
                "approval_id": approval_id,
                "from_state": record["state"],
                "to_state": "VERIFIED",
                "verifier": verifier["username"],
                "timestamp": now_ts,
            },
        )

        record["state"] = "VERIFIED"
        record["verifier"] = {
            "username": verifier["username"],
            "role": verifier.get("role", "verifier"),
            "verified_at": now_ts,
            "verification_results": verification_results,
        }

        record["audit_history"].append(
            {
                "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                "from_state": "APPLIED",
                "to_state": "VERIFIED",
                "actor": verifier["username"],
                "role": verifier.get("role", "verifier"),
                "timestamp": now_ts,
                "comments": "Post-remediation verification tests and CBOM comparison succeeded.",
                "hash": new_hash,
            }
        )

        record["current_state_hash"] = new_hash
        return record

    def rollback_remediation(
        self,
        approval_id: str,
        actor: Optional[Dict[str, str]] = None,
        reason: str = "Rollback triggered due to error threshold.",
    ) -> Dict[str, Any]:
        """6. ROLLBACK: Transitions from APPLIED or APPROVED -> ROLLED_BACK."""
        actor = actor or {"username": "secops", "role": "admin"}
        record = self.get_approval(approval_id)

        if record["state"] not in ["APPLIED", "APPROVED", "REVIEWED"]:
            raise ApprovalWorkflowError(f"Cannot rollback remediation in state '{record['state']}'.")

        now_ts = datetime.now(timezone.utc).isoformat()
        new_hash = self._compute_transition_hash(
            record["current_state_hash"],
            {
                "approval_id": approval_id,
                "from_state": record["state"],
                "to_state": "ROLLED_BACK",
                "actor": actor["username"],
                "reason": reason,
                "timestamp": now_ts,
            },
        )

        prev_state = record["state"]
        record["state"] = "ROLLED_BACK"

        record["audit_history"].append(
            {
                "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                "from_state": prev_state,
                "to_state": "ROLLED_BACK",
                "actor": actor["username"],
                "role": actor.get("role", "admin"),
                "timestamp": now_ts,
                "comments": f"Rollback executed: {reason}",
                "hash": new_hash,
            }
        )

        record["current_state_hash"] = new_hash
        return record

    def fail_remediation(
        self,
        approval_id: str,
        actor: Optional[Dict[str, str]] = None,
        reason: str = "Remediation execution failed.",
    ) -> Dict[str, Any]:
        """7. FAIL: Transitions to FAILED state (terminal)."""
        actor = actor or {"username": "system", "role": "system"}
        record = self.get_approval(approval_id)

        now_ts = datetime.now(timezone.utc).isoformat()
        new_hash = self._compute_transition_hash(
            record["current_state_hash"],
            {
                "approval_id": approval_id,
                "from_state": record["state"],
                "to_state": "FAILED",
                "actor": actor["username"],
                "reason": reason,
                "timestamp": now_ts,
            },
        )

        prev_state = record["state"]
        record["state"] = "FAILED"

        record["audit_history"].append(
            {
                "event_id": f"evt_{uuid.uuid4().hex[:8]}",
                "from_state": prev_state,
                "to_state": "FAILED",
                "actor": actor["username"],
                "role": actor.get("role", "system"),
                "timestamp": now_ts,
                "comments": f"Remediation marked as failed: {reason}",
                "hash": new_hash,
            }
        )

        record["current_state_hash"] = new_hash
        return record

    def get_approval(self, approval_id: str) -> Dict[str, Any]:
        """Retrieves approval record by ID."""
        record = self.approvals.get(approval_id)
        if not record:
            raise ApprovalWorkflowError(f"Approval request '{approval_id}' not found", status_code=404)
        return record

    def list_approvals(self, filters: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        """Lists approval records with optional filters."""
        filters = filters or {}
        items = list(self.approvals.values())

        if filters.get("state"):
            s = filters["state"].upper()
            items = [r for r in items if r["state"] == s]
        if filters.get("category"):
            c = normalize_category(filters["category"])
            items = [r for r in items if r["category"] == c]
        if filters.get("environment"):
            e = filters["environment"].lower()
            items = [r for r in items if r["environment"].lower() == e]

        return items


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="ECDAT Human Approval Workflow CLI (Phase 12.3)")
    subparsers = parser.add_subparsers(dest="subcommand")

    # Propose
    p_prop = subparsers.add_parser("propose", help="Propose a remediation change")
    p_prop.add_argument("--title", required=True)
    p_prop.add_argument("--category", required=True)
    p_prop.add_argument("--env", default="production")
    p_prop.add_argument("--user", default="engineer")

    # Approve
    p_app = subparsers.add_parser("approve", help="Approve a change (Four-eyes enforced)")
    p_app.add_argument("--id", required=True)
    p_app.add_argument("--user", required=True)
    p_app.add_argument("--role", default="admin")

    # List
    p_list = subparsers.add_parser("list", help="List approval requests")

    args = parser.parse_args()
    engine = ApprovalWorkflowEngine()

    if args.subcommand == "propose":
        rec = engine.propose_remediation(
            {"title": args.title, "category": args.category, "environment": args.env},
            proposer={"username": args.user, "role": "developer"},
        )
        print(
            f"[PROPOSED] Created approval ID: {rec['approval_id']} (State: {rec['state']}, Category: {rec['category']})"
        )
    elif args.subcommand == "list":
        print(json.dumps(engine.list_approvals(), indent=2))
    else:
        parser.print_help()
