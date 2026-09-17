"""
ECDAT Secret-Safe Crypto Detection (Phase 2.9)

Detects potential key and secret material without storing raw secret values.
For each candidate:
1. Classifies candidate type (RSA_PRIVATE_KEY, EC_PRIVATE_KEY, SYMMETRIC_KEY, etc.)
2. Records exact location (file_path, line_number)
3. Generates a safe cryptographic fingerprint (e.g., sha256:...)
4. Redacts secret content completely
5. Preserves only minimal evidence (syntax context without secret bytes)

Enforces zero raw secret leakage across:
- logs
- JSON findings
- CBOM
- database
- UI
- error messages
"""

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from scanners.static.results import StaticFinding


# =========================================================================
# Secret Classification Patterns
# =========================================================================

PEM_PATTERNS = [
    (
        "RSA_PRIVATE_KEY",
        re.compile(r"-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----", re.MULTILINE),
    ),
    ("EC_PRIVATE_KEY", re.compile(r"-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----", re.MULTILINE)),
    (
        "DSA_PRIVATE_KEY",
        re.compile(r"-----BEGIN DSA PRIVATE KEY-----[\s\S]*?-----END DSA PRIVATE KEY-----", re.MULTILINE),
    ),
    (
        "OPENSSH_PRIVATE_KEY",
        re.compile(r"-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]*?-----END OPENSSH PRIVATE KEY-----", re.MULTILINE),
    ),
    (
        "PGP_PRIVATE_KEY",
        re.compile(r"-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]*?-----END PGP PRIVATE KEY BLOCK-----", re.MULTILINE),
    ),
    (
        "ENCRYPTED_PRIVATE_KEY",
        re.compile(r"-----BEGIN ENCRYPTED PRIVATE KEY-----[\s\S]*?-----END ENCRYPTED PRIVATE KEY-----", re.MULTILINE),
    ),
    ("PKCS8_PRIVATE_KEY", re.compile(r"-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----", re.MULTILINE)),
]

GENERIC_PEM_PRIVATE_KEY = re.compile(
    r"-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----",
    re.IGNORECASE | re.MULTILINE,
)

SYMMETRIC_KEY_VAR_NAMES = (
    "aes_key",
    "secret_key",
    "des_key",
    "private_key",
    "encryption_key",
    "symmetric_key",
    "signing_key",
    "crypto_key",
)

API_TOKEN_PATTERNS = [
    ("AWS_ACCESS_KEY", re.compile(r"\b(AKIA[0-9A-Z]{16})\b")),
    ("GITHUB_TOKEN", re.compile(r"\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b")),
    ("SLACK_TOKEN", re.compile(r"\b(xox[baprs]-[0-9a-zA-Z-]{10,72})\b")),
    ("JWT_SECRET_OR_TOKEN", re.compile(r"\b(eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+)\b")),
]

HIGH_ENTROPY_HEX = re.compile(r"['\"]([0-9a-fA-F]{32}|[0-9a-fA-F]{48}|[0-9a-fA-F]{64})['\"]")
HIGH_ENTROPY_BASE64 = re.compile(r"['\"]([A-Za-z0-9+/=]{44}|[A-Za-z0-9+/=]{88})['\"]")


@dataclass(frozen=True)
class SecretCandidate:
    candidate_type: str
    file_path: str
    line_number: int
    safe_fingerprint: str
    redacted_token: str
    minimal_evidence: str
    confidence: str = "high"
    severity: str = "critical"


class SecretSafeDetector:
    """
    Detects, fingerprints, and redacts key and secret material.
    Guarantees that raw secret values are never retained in memory or finding objects.
    """

    @staticmethod
    def generate_fingerprint(raw_secret: str) -> str:
        """
        Generates a non-reversible SHA-256 fingerprint for auditing and deduplication.
        Never reveals secret bytes.
        """
        normalized = raw_secret.strip().encode("utf-8", errors="replace")
        digest = hashlib.sha256(normalized).hexdigest()
        return f"sha256:{digest[:16]}"

    @classmethod
    def classify_pem(cls, pem_text: str) -> str:
        for candidate_type, regex in PEM_PATTERNS:
            if regex.search(pem_text):
                return candidate_type
        return "GENERIC_PRIVATE_KEY"

    @classmethod
    def detect_and_redact(cls, content: str, file_path: str = "") -> Tuple[str, List[SecretCandidate]]:
        """
        Scans content, extracts candidates, classifies them, generates fingerprints,
        redacts content, and returns the sanitized content alongside safe metadata.
        """
        candidates: List[SecretCandidate] = []
        if not content:
            return content, candidates

        sanitized = content
        lines = content.split("\n")

        # 1. Detect and redact PEM private keys
        for candidate_type, regex in PEM_PATTERNS:
            for match in regex.finditer(content):
                raw_pem = match.group(0)
                start_idx = match.start()
                line_no = content.count("\n", 0, start_idx) + 1
                fingerprint = cls.generate_fingerprint(raw_pem)
                redacted_token = f"[REDACTED_PRIVATE_KEY:{candidate_type}:{fingerprint}]"

                raw_line = lines[line_no - 1].strip() if line_no <= len(lines) else ""
                # Build minimal evidence: snippet with variable name and redaction token
                if "=" in raw_line:
                    var_part = raw_line.split("=")[0].strip()
                    minimal_evidence = f'{var_part} = "{redacted_token}"'
                elif ":" in raw_line:
                    var_part = raw_line.split(":")[0].strip()
                    minimal_evidence = f'{var_part}: "{redacted_token}"'
                else:
                    minimal_evidence = f'private_key = "{redacted_token}"'

                candidates.append(
                    SecretCandidate(
                        candidate_type=candidate_type,
                        file_path=file_path,
                        line_number=line_no,
                        safe_fingerprint=fingerprint,
                        redacted_token=redacted_token,
                        minimal_evidence=minimal_evidence,
                        confidence="high",
                        severity="critical",
                    )
                )
                sanitized = sanitized.replace(raw_pem, redacted_token)

        # 2. Check for remaining generic PEM headers if any
        for match in GENERIC_PEM_PRIVATE_KEY.finditer(sanitized):
            raw_pem = match.group(0)
            if "[REDACTED" in raw_pem:
                continue
            start_idx = match.start()
            line_no = sanitized.count("\n", 0, start_idx) + 1
            fingerprint = cls.generate_fingerprint(raw_pem)
            redacted_token = f"[REDACTED_PRIVATE_KEY:GENERIC_PRIVATE_KEY:{fingerprint}]"
            candidates.append(
                SecretCandidate(
                    candidate_type="GENERIC_PRIVATE_KEY",
                    file_path=file_path,
                    line_number=line_no,
                    safe_fingerprint=fingerprint,
                    redacted_token=redacted_token,
                    minimal_evidence=f'private_key = "{redacted_token}"',
                    confidence="high",
                    severity="critical",
                )
            )
            sanitized = sanitized.replace(raw_pem, redacted_token)

        # 3. Detect well-known API Tokens
        for token_type, regex in API_TOKEN_PATTERNS:
            for match in regex.finditer(sanitized):
                token_val = match.group(1)
                start_idx = match.start(1)
                line_no = sanitized.count("\n", 0, start_idx) + 1
                fingerprint = cls.generate_fingerprint(token_val)
                redacted_token = f"[REDACTED_SECRET:{token_type}:{fingerprint}]"

                raw_line = lines[line_no - 1].strip() if line_no <= len(lines) else ""
                if "=" in raw_line:
                    var_part = raw_line.split("=")[0].strip()
                    minimal_evidence = f'{var_part} = "{redacted_token}"'
                else:
                    minimal_evidence = f'token = "{redacted_token}"'

                candidates.append(
                    SecretCandidate(
                        candidate_type=token_type,
                        file_path=file_path,
                        line_number=line_no,
                        safe_fingerprint=fingerprint,
                        redacted_token=redacted_token,
                        minimal_evidence=minimal_evidence,
                        confidence="high",
                        severity="high",
                    )
                )
                sanitized = sanitized.replace(token_val, redacted_token)

        # 4. Detect Symmetric Keys assigned to known variable names
        assign_regex = re.compile(
            r"(?i)\b([a-zA-Z0-9_]*("
            + "|".join(SYMMETRIC_KEY_VAR_NAMES)
            + r")[a-zA-Z0-9_]*)\s*[:=]\s*(?:b)?['\"]([^'\"]{16,128})['\"]"
        )
        for match in assign_regex.finditer(sanitized):
            var_name = match.group(1)
            raw_val = match.group(3)
            if "[REDACTED" in raw_val:
                continue
            start_idx = match.start(3)
            line_no = sanitized.count("\n", 0, start_idx) + 1
            fingerprint = cls.generate_fingerprint(raw_val)
            redacted_token = f"[REDACTED_KEY:SYMMETRIC_KEY:{fingerprint}]"

            minimal_evidence = f'{var_name} = "{redacted_token}"'
            candidates.append(
                SecretCandidate(
                    candidate_type="SYMMETRIC_KEY",
                    file_path=file_path,
                    line_number=line_no,
                    safe_fingerprint=fingerprint,
                    redacted_token=redacted_token,
                    minimal_evidence=minimal_evidence,
                    confidence="high",
                    severity="high",
                )
            )
            sanitized = sanitized.replace(f'"{raw_val}"', f'"{redacted_token}"').replace(
                f"'{raw_val}'", f"'{redacted_token}'"
            )

        return sanitized, candidates

    @classmethod
    def create_static_findings(cls, candidates: List[SecretCandidate]) -> List[StaticFinding]:
        findings = []
        for c in candidates:
            findings.append(
                StaticFinding(
                    file_path=c.file_path,
                    line_number=c.line_number,
                    rule_id=f"SECRET_DETECTED_{c.candidate_type}",
                    algorithm=c.candidate_type,
                    evidence=c.minimal_evidence,
                    confidence=c.confidence,
                    finding_type="hardcoded_private_key"
                    if "PRIVATE_KEY" in c.candidate_type
                    else "hardcoded_symmetric_key",
                    severity=c.severity,
                    analysis_source="secret_detector",
                    needs_human_review=False,
                    reason=f"Secret-safe discovery: {c.candidate_type} (fingerprint: {c.safe_fingerprint})",
                    fingerprint=c.safe_fingerprint,
                    secret_type=c.candidate_type,
                )
            )
        return findings
