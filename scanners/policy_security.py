"""
ECDAT Enterprise Policy Security & Governance Subsystem (Phase 11.2).

Enforces:
- Admin-only authorization & RBAC
- Four-eyes approval workflow (author != approver)
- Policy lifecycle versioning (DRAFT -> PENDING_APPROVAL -> APPROVED -> ACTIVE -> SUPERSEDED / ROLLED_BACK)
- Immutable, cryptographically chained audit history (SHA-256 hash chaining)
- Atomic rollback with audit attribution
- Safe sandbox / dry-run policy testing
- Cryptographic digital signing and verification of policy artifacts
- Strict rejection of arbitrary code execution
"""

from __future__ import annotations
import hmac
import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

from scanners.policy_engine import PolicyEngine, PolicyValidationError


class PolicySecurityError(Exception):
    """Raised when an unauthorized or invalid governance action is attempted."""
    pass


class PolicySecurityController:
    """
    Manages policy lifecycle, four-eyes approval workflow, immutable audit ledger,
    cryptographic signing, and rollback capabilities.
    """

    def __init__(self, signing_secret: Optional[str] = None):
        self.signing_secret = (
            signing_secret
            or os.environ.get("ECDAT_POLICY_SIGNING_KEY")
            or "ecdat-default-secure-governance-secret-key-32b"
        )
        self.engine = PolicyEngine()
        self.audit_log: List[Dict[str, Any]] = []
        self.versions: Dict[str, Dict[str, Any]] = {}  # version_str -> version_meta
        self.active_version: Optional[str] = None

        # Genesis audit entry
        self._append_audit_entry(
            action="GENESIS",
            actor="SYSTEM",
            policy_id="ecdat:policy:genesis",
            version="0.0.0",
            details="Policy security & governance ledger initialized.",
        )

    # =========================================================================
    # 1. Immutable Cryptographically Chained Audit Ledger
    # =========================================================================
    def _append_audit_entry(
        self,
        action: str,
        actor: str,
        policy_id: str,
        version: str,
        details: Any,
    ) -> Dict[str, Any]:
        """Appends a new cryptographically chained entry to the audit log."""
        prev_hash = self.audit_log[-1]["audit_hash"] if self.audit_log else "0" * 64
        entry_id = f"AUDIT-{len(self.audit_log) + 1:06d}"
        now_ts = datetime.now(timezone.utc).isoformat()

        canonical_payload = {
            "entry_id": entry_id,
            "timestamp": now_ts,
            "action": action,
            "actor": actor,
            "policy_id": policy_id,
            "version": version,
            "details": details,
            "prev_audit_hash": prev_hash,
        }

        entry_json = json.dumps(canonical_payload, sort_keys=True)
        entry_hash = hashlib.sha256(entry_json.encode("utf-8")).hexdigest()

        entry = {
            **canonical_payload,
            "audit_hash": entry_hash,
        }
        self.audit_log.append(entry)
        return entry

    def verify_audit_chain_integrity(self) -> Tuple[bool, List[str]]:
        """
        Validates the entire audit log hash chain to detect any tampering, modification, or deletion.
        """
        if not self.audit_log:
            return True, []

        errors = []
        for i, entry in enumerate(self.audit_log):
            expected_prev = self.audit_log[i - 1]["audit_hash"] if i > 0 else "0" * 64
            if entry["prev_audit_hash"] != expected_prev:
                errors.append(
                    f"Chain break at entry {entry['entry_id']}: expected prev_hash {expected_prev}, got {entry['prev_audit_hash']}"
                )

            # Re-compute hash
            payload = {
                "entry_id": entry["entry_id"],
                "timestamp": entry["timestamp"],
                "action": entry["action"],
                "actor": entry["actor"],
                "policy_id": entry["policy_id"],
                "version": entry["version"],
                "details": entry["details"],
                "prev_audit_hash": entry["prev_audit_hash"],
            }
            computed_hash = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
            if computed_hash != entry["audit_hash"]:
                errors.append(
                    f"Hash mismatch at entry {entry['entry_id']}: expected {computed_hash}, recorded {entry['audit_hash']}"
                )

        return (len(errors) == 0), errors

    # =========================================================================
    # 2. Authorization & RBAC Checks
    # =========================================================================
    def _assert_admin_authorized(self, actor_info: Dict[str, Any]) -> None:
        """Enforces that only authorized administrators may perform governance actions."""
        if not isinstance(actor_info, dict):
            raise PolicySecurityError("Invalid actor identity: must provide credentials/identity dictionary.")
        role = actor_info.get("role", "").lower()
        if role != "admin":
            raise PolicySecurityError(f"Unauthorized: actor '{actor_info.get('username', 'unknown')}' with role '{role}' is not an authorized policy administrator.")

    # =========================================================================
    # 3. Policy Lifecycle & Four-Eyes Approval Workflow
    # =========================================================================
    def create_draft(self, policy_data: Dict[str, Any], author: Dict[str, Any]) -> Dict[str, Any]:
        """
        Creates a new policy draft. Only authorized administrators may author policies.
        Strictly validates schema and ensures no arbitrary code execution.
        """
        self._assert_admin_authorized(author)

        # Validate schema & protect against prototype injection / code execution
        valid, errors = self.engine.validate_policy(policy_data)
        if not valid:
            raise PolicyValidationError(f"Cannot create draft with invalid policy schema: {', '.join(errors)}", errors)

        ver = policy_data["version"]
        pol_id = policy_data["id"]

        if ver in self.versions and self.versions[ver]["status"] in ["ACTIVE", "APPROVED", "SUPERSEDED"]:
            raise PolicySecurityError(f"Policy version '{ver}' already exists and is immutable.")

        author_name = author.get("username") or author.get("id") or "admin"
        now_ts = datetime.now(timezone.utc).isoformat()

        meta = {
            "policy_id": pol_id,
            "version": ver,
            "status": "DRAFT",
            "author": author_name,
            "created_at": now_ts,
            "policy_document": policy_data,
            "approver": None,
            "approved_at": None,
            "activated_at": None,
        }
        self.versions[ver] = meta

        self._append_audit_entry(
            action="POLICY_DRAFT_CREATED",
            actor=author_name,
            policy_id=pol_id,
            version=ver,
            details={"name": policy_data.get("name"), "rules_count": len(policy_data.get("rules", []))},
        )
        return meta

    def submit_for_approval(self, version: str, submitter: Dict[str, Any]) -> Dict[str, Any]:
        """Submits a draft policy for peer review."""
        self._assert_admin_authorized(submitter)
        if version not in self.versions:
            raise PolicySecurityError(f"Policy version '{version}' not found.")

        item = self.versions[version]
        if item["status"] != "DRAFT":
            raise PolicySecurityError(f"Policy version '{version}' is in status '{item['status']}', expected 'DRAFT'.")

        submitter_name = submitter.get("username") or "admin"
        item["status"] = "PENDING_APPROVAL"

        self._append_audit_entry(
            action="POLICY_SUBMITTED_FOR_APPROVAL",
            actor=submitter_name,
            policy_id=item["policy_id"],
            version=version,
            details={"submitter": submitter_name},
        )
        return item

    def approve_policy(
        self,
        version: str,
        approver: Dict[str, Any],
        comments: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Approves a submitted policy draft.
        Enforces the Four-Eyes principle: Approver MUST be distinct from the Author.
        """
        self._assert_admin_authorized(approver)
        if version not in self.versions:
            raise PolicySecurityError(f"Policy version '{version}' not found.")

        item = self.versions[version]
        if item["status"] != "PENDING_APPROVAL":
            raise PolicySecurityError(
                f"Policy version '{version}' is in status '{item['status']}', must be 'PENDING_APPROVAL' to approve."
            )

        approver_name = approver.get("username") or approver.get("id") or "approver-admin"
        if approver_name == item["author"]:
            raise PolicySecurityError(
                f"Four-Eyes Governance Violation: Author '{item['author']}' cannot approve their own policy submission."
            )

        now_ts = datetime.now(timezone.utc).isoformat()
        item["status"] = "APPROVED"
        item["approver"] = approver_name
        item["approved_at"] = now_ts
        item["approval_comments"] = comments or "Approved by security administrator."

        self._append_audit_entry(
            action="POLICY_APPROVED",
            actor=approver_name,
            policy_id=item["policy_id"],
            version=version,
            details={"approver": approver_name, "comments": item["approval_comments"]},
        )
        return item

    def reject_policy(
        self,
        version: str,
        reviewer: Dict[str, Any],
        reason: str,
    ) -> Dict[str, Any]:
        """Rejects a policy draft with an audited justification."""
        self._assert_admin_authorized(reviewer)
        if version not in self.versions:
            raise PolicySecurityError(f"Policy version '{version}' not found.")

        item = self.versions[version]
        reviewer_name = reviewer.get("username") or "reviewer"
        item["status"] = "REJECTED"
        item["rejection_reason"] = reason

        self._append_audit_entry(
            action="POLICY_REJECTED",
            actor=reviewer_name,
            policy_id=item["policy_id"],
            version=version,
            details={"reviewer": reviewer_name, "reason": reason},
        )
        return item

    def activate_policy(self, version: str, admin: Dict[str, Any]) -> Dict[str, Any]:
        """
        Promotes an approved policy to ACTIVE, superseding the previously active version.
        """
        self._assert_admin_authorized(admin)
        if version not in self.versions:
            raise PolicySecurityError(f"Policy version '{version}' not found.")

        item = self.versions[version]
        if item["status"] != "APPROVED":
            raise PolicySecurityError(
                f"Cannot activate policy '{version}' with status '{item['status']}'. Policy must be 'APPROVED' first."
            )

        admin_name = admin.get("username") or "admin"
        now_ts = datetime.now(timezone.utc).isoformat()

        # Supersede old active version if present
        if self.active_version and self.active_version in self.versions:
            old_item = self.versions[self.active_version]
            old_item["status"] = "SUPERSEDED"
            self._append_audit_entry(
                action="POLICY_SUPERSEDED",
                actor=admin_name,
                policy_id=old_item["policy_id"],
                version=self.active_version,
                details={"superseded_by": version},
            )

        item["status"] = "ACTIVE"
        item["activated_at"] = now_ts
        self.active_version = version

        self._append_audit_entry(
            action="POLICY_ACTIVATED",
            actor=admin_name,
            policy_id=item["policy_id"],
            version=version,
            details={"activated_by": admin_name},
        )
        return item

    # =========================================================================
    # 4. Rollback
    # =========================================================================
    def rollback_to_version(
        self,
        target_version: str,
        admin: Dict[str, Any],
        reason: str,
    ) -> Dict[str, Any]:
        """
        Rolls back the active policy to any previously approved/active/superseded version.
        Appends an explicit ROLLBACK entry to the audit log.
        """
        self._assert_admin_authorized(admin)
        if target_version not in self.versions:
            raise PolicySecurityError(f"Rollback target version '{target_version}' does not exist.")

        target = self.versions[target_version]
        if target["status"] not in ["SUPERSEDED", "APPROVED", "ACTIVE"]:
            raise PolicySecurityError(
                f"Cannot rollback to version '{target_version}' in status '{target['status']}' (must be previously approved or superseded)."
            )

        admin_name = admin.get("username") or "admin"
        now_ts = datetime.now(timezone.utc).isoformat()
        current_active = self.active_version

        if current_active and current_active in self.versions:
            self.versions[current_active]["status"] = "ROLLED_BACK"

        target["status"] = "ACTIVE"
        target["activated_at"] = now_ts
        self.active_version = target_version

        self._append_audit_entry(
            action="POLICY_ROLLED_BACK",
            actor=admin_name,
            policy_id=target["policy_id"],
            version=target_version,
            details={
                "previous_version": current_active,
                "target_version": target_version,
                "reason": reason,
            },
        )
        return target

    # =========================================================================
    # 5. Sandbox / Dry-Run Policy Testing
    # =========================================================================
    def test_policy(
        self,
        policy_data_or_version: Union[str, Dict[str, Any]],
        test_assets_or_cbom: Union[List[Dict[str, Any]], Dict[str, Any]],
        context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Performs a safe, non-mutating sandbox evaluation of a proposed policy.
        Returns impact metrics and compliance breakdown.
        """
        if isinstance(policy_data_or_version, str) and policy_data_or_version in self.versions:
            policy_doc = self.versions[policy_data_or_version]["policy_document"]
        elif isinstance(policy_data_or_version, str) and os.path.exists(policy_data_or_version):
            with open(policy_data_or_version, "r", encoding="utf-8") as f:
                policy_doc = json.load(f)
        elif isinstance(policy_data_or_version, dict):
            policy_doc = policy_data_or_version
        else:
            raise PolicySecurityError("Invalid policy reference for dry-run testing.")

        # Execute evaluation via deterministic engine
        result = self.engine.evaluate(test_assets_or_cbom, context=context, policy=policy_doc)

        impact_summary = {
            "test_timestamp": datetime.now(timezone.utc).isoformat(),
            "policy_id": policy_doc.get("id"),
            "policy_version": policy_doc.get("version"),
            "verdict": result["verdict"],
            "total_assets_tested": result["metrics"]["total_assets_evaluated"],
            "blocking_violations": result["metrics"]["counts_by_verdict"]["BLOCK"],
            "warning_violations": result["metrics"]["counts_by_verdict"]["WARN"],
            "exceptions_applied": result["metrics"]["counts_by_verdict"]["EXCEPTION"],
            "clean_assets": result["metrics"]["counts_by_verdict"]["ALLOW"],
            "is_safe_for_production": (result["metrics"]["counts_by_verdict"]["BLOCK"] == 0),
            "evaluation_result": result,
        }
        return impact_summary

    # =========================================================================
    # 6. Cryptographic Policy Artifact Signing & Verification
    # =========================================================================
    def sign_policy_bundle(
        self,
        policy_data: Dict[str, Any],
        signer_info: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Creates a cryptographically signed policy bundle with HMAC-SHA256 signature,
        tamper-evident envelope, timestamp, and signer metadata.
        """
        # Ensure policy is valid schema first
        valid, errors = self.engine.validate_policy(policy_data)
        if not valid:
            raise PolicyValidationError(f"Cannot sign invalid policy: {errors}", errors)

        canonical_body = json.dumps(policy_data, sort_keys=True)
        sig = hmac.new(
            self.signing_secret.encode("utf-8"),
            canonical_body.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        now_ts = datetime.now(timezone.utc).isoformat()
        bundle = {
            "envelope_version": "1.0.0",
            "signed_at": now_ts,
            "signer": signer_info.get("username", "security-officer"),
            "signature_algorithm": "HMAC-SHA256",
            "policy_id": policy_data.get("id"),
            "policy_version": policy_data.get("version"),
            "signature": sig,
            "policy": policy_data,
        }

        self._append_audit_entry(
            action="POLICY_SIGNED",
            actor=signer_info.get("username", "security-officer"),
            policy_id=policy_data.get("id"),
            version=policy_data.get("version"),
            details={"signature_preview": sig[:16] + "..."},
        )
        return bundle

    def verify_signed_policy_bundle(self, bundle: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
        """
        Verifies the cryptographic integrity and authenticity of a signed policy bundle.
        Rejects modified, forged, or malformed artifacts.
        """
        if not isinstance(bundle, dict):
            return False, "Bundle must be a JSON/dict object."

        required = ["signature", "signature_algorithm", "policy"]
        for r in required:
            if r not in bundle:
                return False, f"Signed bundle missing required field '{r}'."

        policy_data = bundle["policy"]
        canonical_body = json.dumps(policy_data, sort_keys=True)
        expected_sig = hmac.new(
            self.signing_secret.encode("utf-8"),
            canonical_body.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        # Constant-time comparison
        if not hmac.compare_digest(bundle["signature"], expected_sig):
            return False, "Cryptographic signature verification FAILED. Policy artifact has been tampered with or signature key mismatch."

        # Re-validate schema
        valid, errors = self.engine.validate_policy(policy_data)
        if not valid:
            return False, f"Signed policy contains schema violations: {', '.join(errors)}"

        return True, None


if __name__ == "__main__":
    import sys
    import argparse

    parser = argparse.ArgumentParser(description="ECDAT Policy Security & Governance CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # sign command
    sign_parser = subparsers.add_parser("sign", help="Sign a policy artifact")
    sign_parser.add_argument("policy_file", help="Path to policy JSON file")
    sign_parser.add_argument("--signer", default="security-officer", help="Signer username")
    sign_parser.add_argument("--out", default=None, help="Output file for signed bundle")

    # verify command
    verify_parser = subparsers.add_parser("verify", help="Verify a signed policy bundle")
    verify_parser.add_argument("bundle_file", help="Path to signed bundle JSON file")

    args = parser.parse_args()
    controller = PolicySecurityController()

    if args.command == "sign":
        with open(args.policy_file, "r", encoding="utf-8") as f:
            p_data = json.load(f)
        bundle = controller.sign_policy_bundle(p_data, signer_info={"username": args.signer, "role": "admin"})
        if args.out:
            with open(args.out, "w", encoding="utf-8") as f:
                json.dump(bundle, f, indent=2)
            print(f"Signed policy bundle written to {args.out}")
        else:
            print(json.dumps(bundle, indent=2))
        sys.exit(0)

    elif args.command == "verify":
        with open(args.bundle_file, "r", encoding="utf-8") as f:
            b_data = json.load(f)
        ok, err = controller.verify_signed_policy_bundle(b_data)
        if ok:
            print("[OK] Cryptographic signature and schema verification PASSED.")
            sys.exit(0)
        else:
            print(f"[FAIL] Verification FAILED: {err}", file=sys.stderr)
            sys.exit(1)

