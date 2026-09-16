"""
NIST SP 800-63B Password Policy & Local Auth Manager (Python) — Phase 15.2

Implements:
- NIST SP 800-63B password length and complexity validation
- Dictionary blacklist rejection & username/email substring defense
- Modern memory-hard key derivation via hashlib.scrypt (RFC 7914)
- Constant-time password verification to prevent timing side-channels
- Brute-force protection with configurable lockout duration
"""

import hashlib
import hmac
import os
import re
import time
from typing import Any, Dict, List, Optional, Set


COMMON_PASSWORDS_BLACKLIST: Set[str] = {
    "password123!",
    "password1234",
    "admin2026!#",
    "welcome12345",
    "qwerty123456",
    "letmein2026!",
    "iloveyou1234",
    "changeme1234",
    "enterprise123",
    "secret123456",
}


class PasswordPolicyError(Exception):
    def __init__(self, message: str, violations: Optional[List[str]] = None):
        super().__init__(message)
        self.violations = violations or []


class AccountLockedError(Exception):
    def __init__(self, message: str, unlock_time: Optional[str] = None):
        super().__init__(message)
        self.unlock_time = unlock_time


class PasswordPolicy:
    """
    Enforces NIST SP 800-63B guidelines and memory-hard scrypt hashing.
    """

    def __init__(
        self,
        min_length: int = 12,
        max_length: int = 128,
        require_uppercase: bool = True,
        require_lowercase: bool = True,
        require_numbers: bool = True,
        require_special: bool = True,
    ):
        self.min_length = min_length
        self.max_length = max_length
        self.require_uppercase = require_uppercase
        self.require_lowercase = require_lowercase
        self.require_numbers = require_numbers
        self.require_special = require_special

    def validate(
        self,
        password: str,
        username: Optional[str] = None,
        email: Optional[str] = None,
    ) -> Dict[str, Any]:
        violations: List[str] = []

        if not password or not isinstance(password, str):
            raise PasswordPolicyError("Password must be a non-empty string", ["missing_password"])

        if len(password) < self.min_length:
            violations.append(f"Password must be at least {self.min_length} characters long")

        if len(password) > self.max_length:
            violations.append(f"Password must not exceed {self.max_length} characters")

        if self.require_uppercase and not re.search(r"[A-Z]", password):
            violations.append("Password must contain at least one uppercase letter (A-Z)")

        if self.require_lowercase and not re.search(r"[a-z]", password):
            violations.append("Password must contain at least one lowercase letter (a-z)")

        if self.require_numbers and not re.search(r"[0-9]", password):
            violations.append("Password must contain at least one numeral (0-9)")

        if self.require_special and not re.search(r"[!@#$%^&*()_+\-=[\]{}|;:,.<>?]", password):
            violations.append("Password must contain at least one special character")

        norm = password.lower()
        if norm in COMMON_PASSWORDS_BLACKLIST:
            violations.append("Password matches a known vulnerable or common dictionary password")

        if username and len(username) >= 4 and username.lower() in norm:
            violations.append("Password must not contain the username")

        if email and "@" in email:
            local_part = email.split("@")[0].lower()
            if len(local_part) >= 4 and local_part in norm:
                violations.append("Password must not contain the email address local part")

        if violations:
            raise PasswordPolicyError("Password does not meet enterprise security requirements", violations)

        return {"valid": True}

    def hash_password(self, password: str) -> str:
        salt = os.urandom(16)
        n = 16384
        r = 8
        p = 1
        key = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            maxmem=0,
            dklen=64,
        )
        return f"$scrypt$N={n},r={r},p={p}${salt.hex()}${key.hex()}"

    def verify_password(self, password: str, stored_hash: str) -> bool:
        if not stored_hash or not isinstance(stored_hash, str) or not stored_hash.startswith("$scrypt$"):
            return False

        try:
            parts = stored_hash.split("$")
            if len(parts) != 5:
                return False

            param_str = parts[2]
            salt = bytes.fromhex(parts[3])
            expected_key = bytes.fromhex(parts[4])

            params = dict(item.split("=") for item in param_str.split(","))
            n = int(params.get("N", 16384))
            r = int(params.get("r", 8))
            p = int(params.get("p", 1))

            derived = hashlib.scrypt(
                password.encode("utf-8"),
                salt=salt,
                n=n,
                r=r,
                p=p,
                maxmem=0,
                dklen=len(expected_key),
            )
            return hmac.compare_digest(derived, expected_key)
        except Exception:
            return False


class LocalAuthManager:
    """
    Manages local user credentials, lockout, and MFA status.
    """

    def __init__(
        self,
        policy: Optional[PasswordPolicy] = None,
        max_failed_attempts: int = 5,
        lockout_duration_sec: int = 15 * 60,
    ):
        self.policy = policy or PasswordPolicy()
        self.max_failed_attempts = max_failed_attempts
        self.lockout_duration_sec = lockout_duration_sec
        self.users: Dict[str, Dict[str, Any]] = {}

    def register_user(
        self,
        username: str,
        email: str,
        password: str,
        roles: Optional[List[str]] = None,
        tenant_id: str = "default-tenant",
    ) -> Dict[str, Any]:
        norm_user = (username or "").strip().lower()
        if not norm_user:
            raise ValueError("Username is required")
        if norm_user in self.users:
            raise ValueError(f"Username '{username}' already exists")

        self.policy.validate(password, username=norm_user, email=email)
        password_hash = self.policy.hash_password(password)
        user_id = f"usr_{os.urandom(8).hex()}"

        record = {
            "userId": user_id,
            "username": norm_user,
            "email": (email or "").strip().lower(),
            "passwordHash": password_hash,
            "roles": roles or ["viewer"],
            "tenantId": tenant_id,
            "failedAttempts": 0,
            "lockedUntil": 0,
            "mfaEnabled": False,
            "mfaSecret": None,
            "backupCodeHashes": [],
            "createdAt": time.time(),
        }
        self.users[norm_user] = record
        return {
            "userId": record["userId"],
            "username": record["username"],
            "email": record["email"],
            "roles": record["roles"],
            "tenantId": record["tenantId"],
        }

    def authenticate(
        self,
        username: str,
        password: str,
        ip: str = "127.0.0.1",
    ) -> Dict[str, Any]:
        norm_user = (username or "").strip().lower()
        user = self.users.get(norm_user)

        if not user:
            # Dummy scrypt to prevent user enumeration timing attack
            hashlib.scrypt(b"dummy_timing", salt=b"1234567812345678", n=1024, r=8, p=1, dklen=64)
            raise ValueError("Invalid username or password")

        now = time.time()
        if user["lockedUntil"] and now < user["lockedUntil"]:
            remaining = int(user["lockedUntil"] - now)
            raise AccountLockedError(
                f"Account is locked due to too many failed attempts. Please retry in {remaining} seconds.",
                unlock_time=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(user["lockedUntil"])),
            )

        if user["lockedUntil"] and now >= user["lockedUntil"]:
            user["lockedUntil"] = 0
            user["failedAttempts"] = 0

        valid = self.policy.verify_password(password, user["passwordHash"])
        if not valid:
            user["failedAttempts"] += 1
            if user["failedAttempts"] >= self.max_failed_attempts:
                user["lockedUntil"] = now + self.lockout_duration_sec
                unlock_iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(user["lockedUntil"]))
                raise AccountLockedError(
                    f"Account locked after {self.max_failed_attempts} failed attempts. Lockout period: 15 minutes.",
                    unlock_time=unlock_iso,
                )
            raise ValueError("Invalid username or password")

        user["failedAttempts"] = 0
        user["lockedUntil"] = 0

        if user["mfaEnabled"]:
            mfa_token = os.urandom(24).hex()
            user["pendingMfaToken"] = mfa_token
            user["pendingMfaExpiresAt"] = now + 300
            return {
                "mfaRequired": True,
                "mfaToken": mfa_token,
                "userId": user["userId"],
                "username": user["username"],
            }

        return {
            "mfaRequired": False,
            "user": {
                "userId": user["userId"],
                "username": user["username"],
                "email": user["email"],
                "roles": user["roles"],
                "tenantId": user["tenantId"],
            },
        }

    def get_user(self, username_or_id: str) -> Optional[Dict[str, Any]]:
        norm = (username_or_id or "").strip().lower()
        for u in self.users.values():
            if u["username"] == norm or u["userId"] == username_or_id:
                return u
        return None
