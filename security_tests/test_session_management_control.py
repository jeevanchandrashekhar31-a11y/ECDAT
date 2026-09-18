# @ecdat-synthetic-corpus
"""
Adversarial Security Test: Session Management & Revocation Control
Evaluates all 5 dimensions: positive, negative, boundary, malicious, regression.
"""

import time
import pytest


class SessionManager:
    """
    Manages session lifecycle with absolute TTL, sliding inactivity timeout, and global revocation epochs.
    """

    def __init__(self, inactivity_timeout_sec: int = 900, absolute_ttl_sec: int = 86400):
        self.inactivity_timeout_sec = inactivity_timeout_sec
        self.absolute_ttl_sec = absolute_ttl_sec
        self.sessions = {}  # session_id -> {user_id, created_at, last_active}
        self.user_revocation_epochs = {}  # user_id -> timestamp

    def create_session(self, session_id: str, user_id: str, current_time: float = None) -> dict:
        now = current_time or time.time()
        session = {
            "session_id": session_id,
            "user_id": user_id,
            "created_at": now,
            "last_active": now,
        }
        self.sessions[session_id] = session
        return session

    def validate_session(self, session_id: str, current_time: float = None) -> dict:
        now = current_time or time.time()
        session = self.sessions.get(session_id)
        if not session:
            return {"valid": False, "reason": "SESSION_NOT_FOUND"}

        user_id = session["user_id"]
        epoch = self.user_revocation_epochs.get(user_id, 0)
        if session["created_at"] < epoch:
            return {"valid": False, "reason": "SESSION_REVOKED_BY_EPOCH"}

        if now - session["created_at"] > self.absolute_ttl_sec:
            return {"valid": False, "reason": "ABSOLUTE_TTL_EXCEEDED"}

        if now - session["last_active"] > self.inactivity_timeout_sec:
            return {"valid": False, "reason": "INACTIVITY_TIMEOUT"}

        session["last_active"] = now
        return {"valid": True, "session": session}

    def revoke_all_user_sessions(self, user_id: str, current_time: float = None) -> None:
        self.user_revocation_epochs[user_id] = current_time or time.time()


class TestSessionManagementControl:
    """
    Security Control: Session Management & Universal Invalidation Epochs
    Guarantees session expiration, sliding timeouts, and instant global revocation across all devices.
    """

    @pytest.fixture
    def manager(self):
        return SessionManager(inactivity_timeout_sec=900, absolute_ttl_sec=86400)

    # 1. POSITIVE TEST: Active session within timeout validates and updates activity
    def test_positive_session(self, manager):
        t0 = 1000.0
        manager.create_session("sess-1", "user-1", current_time=t0)

        # 5 minutes later: valid
        res = manager.validate_session("sess-1", current_time=t0 + 300)
        assert res["valid"] is True
        assert res["session"]["last_active"] == t0 + 300

    # 2. NEGATIVE TEST: Non-existent session returns False cleanly
    def test_negative_session(self, manager):
        res = manager.validate_session("sess-non-existent")
        assert res["valid"] is False
        assert res["reason"] == "SESSION_NOT_FOUND"

    # 3. BOUNDARY TEST: Exact inactivity timeout boundary (900 seconds)
    def test_boundary_session(self, manager):
        t0 = 1000.0
        manager.create_session("sess-b", "user-2", current_time=t0)

        # At exactly 900s: valid (<= 900)
        res_edge = manager.validate_session("sess-b", current_time=t0 + 900)
        assert res_edge["valid"] is True

        # At 901s: expired (> 900)
        res_expired = manager.validate_session("sess-b", current_time=t0 + 900 + 901)
        assert res_expired["valid"] is False
        assert res_expired["reason"] == "INACTIVITY_TIMEOUT"

    # 4. MALICIOUS TEST: Session hijacking after user revocation epoch fails
    def test_malicious_session(self, manager):
        t0 = 1000.0
        # User creates session on mobile and desktop
        manager.create_session("sess-desktop", "victim", current_time=t0)
        manager.create_session("sess-mobile", "victim", current_time=t0 + 10)

        # Compromised account triggers global session revocation (e.g. password reset)
        t_revoke = t0 + 100
        manager.revoke_all_user_sessions("victim", current_time=t_revoke)

        # Both previous sessions are now invalid
        res_desk = manager.validate_session("sess-desktop", current_time=t_revoke + 5)
        assert res_desk["valid"] is False
        assert res_desk["reason"] == "SESSION_REVOKED_BY_EPOCH"

        res_mob = manager.validate_session("sess-mobile", current_time=t_revoke + 5)
        assert res_mob["valid"] is False
        assert res_mob["reason"] == "SESSION_REVOKED_BY_EPOCH"

    # 5. REGRESSION TEST: Absolute TTL cap prevents indefinitely renewed sessions
    def test_regression_session(self, manager):
        t0 = 1000.0
        manager.create_session("sess-eternal", "user-immortal", current_time=t0)

        # Kept active periodically beyond absolute TTL (86400s)
        res_over_ttl = manager.validate_session("sess-eternal", current_time=t0 + 86401)
        assert res_over_ttl["valid"] is False
        assert res_over_ttl["reason"] == "ABSOLUTE_TTL_EXCEEDED"
