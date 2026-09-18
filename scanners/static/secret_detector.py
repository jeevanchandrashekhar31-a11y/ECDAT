"""
ECDAT Secret-Safe Crypto Detection & Secret Scanning Engine (Phase 2.9 / P1 Hardened)

Detects potential key, token, credential, and secret material without storing raw secret values.
For each candidate:
1. Classifies candidate type (AWS_ACCESS_KEY, GITHUB_TOKEN, JWT_SECRET, PRIVATE_KEY,
   DATABASE_CREDENTIAL, CLOUD_CREDENTIAL, GENERIC_API_KEY, HIGH_ENTROPY_SECRET, etc.)
2. Distinguishes synthetic fixtures (marked with explicit fixture markers, generated dummy prefixes,
   or in isolated test corpora) from real secrets.
3. Records exact location (file_path, line_number)
4. Generates a safe cryptographic fingerprint (e.g., sha256:...)
5. Redacts secret content completely
6. Preserves only minimal evidence (syntax context without secret bytes)

Enforces zero raw secret leakage across:
- logs
- JSON findings
- CBOM
- database
- UI
- error messages
"""

import collections
import hashlib
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Set

from scanners.static.results import StaticFinding


# =========================================================================
# 1. Secret Classification Patterns
# =========================================================================

# Real PEM keys have Base64 lines between headers and footers; regex definitions use [\s\S]
PEM_BODY = r"(?:\s*[A-Za-z0-9+/=_-]{8,}[\r\n\s]+)+"

PEM_PATTERNS = [
    ("RSA_PRIVATE_KEY", re.compile(rf"-----BEGIN RSA PRIVATE KEY-----{PEM_BODY}-----END RSA PRIVATE KEY-----", re.MULTILINE)),
    ("EC_PRIVATE_KEY", re.compile(rf"-----BEGIN EC PRIVATE KEY-----{PEM_BODY}-----END EC PRIVATE KEY-----", re.MULTILINE)),
    ("DSA_PRIVATE_KEY", re.compile(rf"-----BEGIN DSA PRIVATE KEY-----{PEM_BODY}-----END DSA PRIVATE KEY-----", re.MULTILINE)),
    ("OPENSSH_PRIVATE_KEY", re.compile(rf"-----BEGIN OPENSSH PRIVATE KEY-----{PEM_BODY}-----END OPENSSH PRIVATE KEY-----", re.MULTILINE)),
    ("PGP_PRIVATE_KEY", re.compile(rf"-----BEGIN PGP PRIVATE KEY BLOCK-----{PEM_BODY}-----END PGP PRIVATE KEY BLOCK-----", re.MULTILINE)),
    ("ENCRYPTED_PRIVATE_KEY", re.compile(rf"-----BEGIN ENCRYPTED PRIVATE KEY-----{PEM_BODY}-----END ENCRYPTED PRIVATE KEY-----", re.MULTILINE)),
    ("PKCS8_PRIVATE_KEY", re.compile(rf"-----BEGIN PRIVATE KEY-----{PEM_BODY}-----END PRIVATE KEY-----", re.MULTILINE)),
]

GENERIC_PEM_PRIVATE_KEY = re.compile(
    r"-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\r\n]+([\s\S]*?)[\r\n]+-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----",
    re.IGNORECASE,
)

# API Token & Credential Patterns
API_TOKEN_PATTERNS = [
    # AWS Access Key ID (standard 20-char identifier starting with AKIA, ASIA, ABIA, ACCA)
    ("AWS_ACCESS_KEY", re.compile(r"\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b")),
    # AWS Secret Access Key (40 chars Base64)
    ("AWS_SECRET_ACCESS_KEY", re.compile(r"(?i)\b(?:aws_secret_access_key|aws_secret_key)\s*[:=]\s*['\"]([A-Za-z0-9/+=]{40})['\"]")),
    # GitHub Tokens: Classic, Fine-Grained, and OAuth/User tokens
    ("GITHUB_TOKEN", re.compile(r"\b(gh[pousr]_[A-Za-z0-9_]{36,255})\b")),
    ("GITHUB_FINE_GRAINED_PAT", re.compile(r"\b(github_pat_[0-9a-zA-Z_]{80,95})\b")),
    # Slack API Tokens
    ("SLACK_TOKEN", re.compile(r"\b(xox[baprs]-[0-9a-zA-Z-]{10,72})\b")),
    # JWT Tokens (raw Base64 encoded signed JWTs)
    ("JWT_TOKEN", re.compile(r"\b(eyJ[A-Za-z0-9-_=]+\.eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+)\b")),
    # JWT Secrets (configuration variable assignments)
    ("JWT_SECRET", re.compile(r"(?i)\b(?:jwt_secret|jwt_key|jwt_secret_key)\s*[:=]\s*['\"]([^'\"\s]{16,128})['\"]")),
    # Database URIs with embedded credentials (Postgres, MySQL, Mongo, Redis)
    ("DATABASE_URI", re.compile(r"(?i)\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss):\/\/[^:\s\/]+:([^@\s\/]{3,})@[^\s\/]+(?:\/[^\s]*)?)\b")),
    # Database password assignment
    ("DATABASE_PASSWORD", re.compile(r"(?i)\b(?:db_password|database_password|db_pass|database_pass)\s*[:=]\s*['\"]([^'\"\s]{8,128})['\"]")),
    # Google Cloud API Key
    ("GCP_API_KEY", re.compile(r"\b(AIzaSy[0-9A-Za-z_-]{33})\b")),
    # Azure Storage Connection String / Account Key
    ("AZURE_STORAGE_KEY", re.compile(r"(?i)\b(DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]{64,128})(?=[\s;\"']|$)")),
    # Azure Client Secret
    ("AZURE_CLIENT_SECRET", re.compile(r"(?i)\b(?:azure_client_secret|client_secret)\s*[:=]\s*['\"]([A-Za-z0-9~_.-]{34,44})['\"]")),
    # OpenAI, Anthropic, Groq API keys
    ("OPENAI_API_KEY", re.compile(r"\b((?:sk|gsk|sk-ant|sk-proj)-[a-zA-Z0-9_-]{30,})\b")),
    # Stripe Secret Keys
    ("STRIPE_KEY", re.compile(r"\b(sk_live_[0-9a-zA-Z]{24,34})\b")),
    # Generic API Keys
    ("GENERIC_API_KEY", re.compile(r"(?i)\b(?:api_key|apikey|secret_key|auth_token)\s*[:=]\s*['\"]([a-zA-Z0-9_\-\.\+\/=]{24,128})['\"]")),
]

SYMMETRIC_KEY_VAR_NAMES = (
    "aes_key",
    "secret_key",
    "des_key",
    "private_key",
    "encryption_key",
    "symmetric_key",
    "signing_key",
    "crypto_key",
    "data_encryption_key",
    "master_key",
)

# Known synthetic test credentials and documentation dummy markers
KNOWN_SYNTHETIC_MARKERS = {
    "ecdat:fixture",
    "ecdat:synthetic",
    "synthetic-fixture",
    "mock-credential",
    "test-fixture",
    "@fixture",
    "canary_",
    "synthetic_secrets",
    "[synthetic_fixture]",
    "@ecdat-synthetic-corpus",
}

KNOWN_SYNTHETIC_VALUES = {
    "AKIAIOSFODNN7EXAMPLE",  # AWS official documentation dummy key
    "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",  # AWS official dummy secret
}

KNOWN_SYNTHETIC_PREFIXES = (
    "change-this-",
    "dummy-",
    "example-",
    "fake-",
    "mock-",
    "mock_",
    "synthetic-",
    "test-",
    "canarytoken",
    "0123456789abcdef",  # repeating hex pattern
)


def calculate_shannon_entropy(data: str) -> float:
    """
    Calculates Shannon entropy in bits per character.
    High-entropy keys typically have H >= 3.0 (hex) or H >= 3.8 (Base64/alphanumeric).
    """
    if not data:
        return 0.0
    length = len(data)
    counts = collections.Counter(data)
    entropy = 0.0
    for count in counts.values():
        p = count / length
        entropy -= p * math.log2(p)
    return round(entropy, 4)


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
    is_synthetic: bool = False


class SecretSafeDetector:
    """
    Detects, fingerprints, and redacts key and secret material.
    Distinguishes certified synthetic fixtures from real secrets.
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
    def is_synthetic_fixture(
        cls,
        line: str,
        context: str = "",
        file_path: str = "",
        secret_val: str = "",
        line_number: int = 1,
    ) -> bool:
        """
        Determines whether a secret candidate is a certified synthetic fixture or a real secret.

        Distinguishes:
        - explicit fixture markers in code comments (e.g. 'ecdat:fixture', 'synthetic-fixture')
        - generated fake credentials / dummy prefixes ('mock-', 'dummy-', 'change-this-')
        - isolated test corpus paths (e.g. 'tests/fixtures/synthetic_secrets/')
        - file-level synthetic corpus markers ('@ecdat-synthetic-corpus')
        """
        norm_file = file_path.replace("\\", "/").lower()

        # 1. Isolated test corpus check
        if "tests/fixtures/synthetic_secrets" in norm_file or "fixtures/synthetic" in norm_file:
            return True

        # 2. File-level corpus header check (first 10 lines)
        if context:
            first_lines = "\n".join(context.splitlines()[:10]).lower()
            if any(m in first_lines for m in [
                "@ecdat-synthetic-corpus",
                "ecdat_synthetic_fixture = true",
                "ecdat:synthetic",
                "ecdat:fixture",
                "synthetic-fixture",
            ]):
                return True

        # 3. Known documentation dummy values
        if secret_val in KNOWN_SYNTHETIC_VALUES:
            return True

        # 4. Code definition checks (regex patterns, scanner test code, or template strings)
        if "${" in secret_val or "[REDACTED" in secret_val or "[SYNTHETIC" in secret_val:
            return True
        if "/(?:" in line or "re.compile(" in line or ".test(line)" in line:
            return True

        # 5. Local development and test database URIs / variable references
        lower_secret = secret_val.lower()
        if any(h in lower_secret for h in ["localhost", "127.0.0.1", "::1", ".internal", ".local", "postgres:5432", "db.test", "$("]):
            return True

        # 6. Known dummy prefixes / patterns (check full secret value and surrounding line)
        if any(p in lower_secret for p in KNOWN_SYNTHETIC_PREFIXES):
            return True
        if "0123456789abcdef" in lower_secret:
            return True
        if "canarytoken" in lower_secret:
            return True

        # 7. Explicit fixture marker in line or surrounding lines (+/- 3 lines)
        lower_line = line.lower()
        if any(m in lower_line for m in KNOWN_SYNTHETIC_MARKERS):
            return True
        if any(p in lower_line for p in KNOWN_SYNTHETIC_PREFIXES):
            return True

        # 8. Test file specific fixture patterns (e.g. test passwords, mock assertions)
        if "test" in norm_file or "examples/real_target" in norm_file:
            test_indicators = [
                "mock", "dummy", "fake", "sample", "example", "canary", "assert",
                "expect", "describe(", "it(", "login", "register", "password",
                "super_secret", "never_expose", "snippet", "auth_header", "testpassword"
            ]
            if any(ind in lower_line for ind in test_indicators):
                return True

        if context:
            lines = context.splitlines()
            idx = line_number - 1
            start = max(0, idx - 3)
            end = min(len(lines), idx + 4)
            surrounding = " ".join(lines[start:end]).lower()
            if any(m in surrounding for m in KNOWN_SYNTHETIC_MARKERS):
                return True
            if any(p in surrounding for p in KNOWN_SYNTHETIC_PREFIXES):
                return True
            if "test" in norm_file:
                test_indicators = ["mock", "dummy", "fake", "sample", "example", "assert", "expect"]
                if any(ind in surrounding for ind in test_indicators):
                    return True

        return False

    @classmethod
    def detect_and_redact(
        cls,
        content: str,
        file_path: str = "",
        test_mode: bool = False,
    ) -> Tuple[str, List[SecretCandidate]]:
        """
        Scans content, extracts candidates, classifies them, distinguishes synthetic fixtures,
        generates safe fingerprints, redacts content, and returns sanitized content + candidates.
        Guarantees zero line drift by evaluating all patterns on original content with claimed spans.
        """
        candidates: List[SecretCandidate] = []
        if not content:
            return content, candidates

        lines = content.splitlines()
        claimed_spans: List[Tuple[int, int]] = []

        def is_overlapping(start: int, end: int) -> bool:
            for s, e in claimed_spans:
                if not (end <= s or start >= e):
                    return True
            return False

        def get_line_info(start_idx: int) -> Tuple[int, str]:
            line_no = content.count("\n", 0, start_idx) + 1
            raw_line = lines[line_no - 1].strip() if 1 <= line_no <= len(lines) else ""
            return line_no, raw_line

        replacements: List[Tuple[int, int, str]] = []

        # 1. Detect and redact PEM private keys
        for candidate_type, regex in PEM_PATTERNS:
            for match in regex.finditer(content):
                start, end = match.start(), match.end()
                if is_overlapping(start, end):
                    continue
                claimed_spans.append((start, end))

                raw_pem = match.group(0)
                line_no, raw_line = get_line_info(start)

                is_synthetic = cls.is_synthetic_fixture(
                    raw_line, context=content, file_path=file_path, secret_val=raw_pem, line_number=line_no
                ) or (test_mode and "test" in file_path.lower())

                fingerprint = cls.generate_fingerprint(raw_pem)
                tag_prefix = "SYNTHETIC_PRIVATE_KEY" if is_synthetic else "REDACTED_PRIVATE_KEY"
                redacted_token = f"[{tag_prefix}:{candidate_type}:{fingerprint}]"

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
                        severity="low" if is_synthetic else "critical",
                        is_synthetic=is_synthetic,
                    )
                )
                replacements.append((start, end, redacted_token))

        # 2. Check for remaining generic PEM headers if any
        for match in GENERIC_PEM_PRIVATE_KEY.finditer(content):
            start, end = match.start(), match.end()
            if is_overlapping(start, end):
                continue
            body = match.group(1).strip()
            if not body or "re.compile" in body or r"[\s\S]" in body or "PEM_BODY" in body:
                continue
            claimed_spans.append((start, end))

            raw_pem = match.group(0)
            line_no, raw_line = get_line_info(start)

            is_synthetic = cls.is_synthetic_fixture(
                raw_line, context=content, file_path=file_path, secret_val=raw_pem, line_number=line_no
            ) or (test_mode and "test" in file_path.lower())

            fingerprint = cls.generate_fingerprint(raw_pem)
            tag_prefix = "SYNTHETIC_PRIVATE_KEY" if is_synthetic else "REDACTED_PRIVATE_KEY"
            redacted_token = f"[{tag_prefix}:GENERIC_PRIVATE_KEY:{fingerprint}]"

            candidates.append(
                SecretCandidate(
                    candidate_type="GENERIC_PRIVATE_KEY",
                    file_path=file_path,
                    line_number=line_no,
                    safe_fingerprint=fingerprint,
                    redacted_token=redacted_token,
                    minimal_evidence=f'private_key = "{redacted_token}"',
                    confidence="high",
                    severity="low" if is_synthetic else "critical",
                    is_synthetic=is_synthetic,
                )
            )
            replacements.append((start, end, redacted_token))

        # 3. Detect API Tokens, Database URIs, Cloud Credentials, JWT Secrets
        for token_type, regex in API_TOKEN_PATTERNS:
            for match in regex.finditer(content):
                token_val = match.group(1)
                start, end = match.start(1), match.end(1)
                if is_overlapping(start, end):
                    continue
                if "[REDACTED" in token_val or "[SYNTHETIC" in token_val:
                    continue

                claimed_spans.append((start, end))
                line_no, raw_line = get_line_info(start)

                is_synthetic = cls.is_synthetic_fixture(
                    raw_line, context=content, file_path=file_path, secret_val=token_val, line_number=line_no
                ) or (test_mode and "test" in file_path.lower())

                fingerprint = cls.generate_fingerprint(token_val)
                tag_prefix = "SYNTHETIC_SECRET" if is_synthetic else "REDACTED_SECRET"
                redacted_token = f"[{tag_prefix}:{token_type}:{fingerprint}]"

                if "=" in raw_line:
                    var_part = raw_line.split("=")[0].strip()
                    minimal_evidence = f'{var_part} = "{redacted_token}"'
                elif ":" in raw_line:
                    var_part = raw_line.split(":")[0].strip()
                    minimal_evidence = f'{var_part}: "{redacted_token}"'
                else:
                    minimal_evidence = f'credential = "{redacted_token}"'

                candidates.append(
                    SecretCandidate(
                        candidate_type=token_type,
                        file_path=file_path,
                        line_number=line_no,
                        safe_fingerprint=fingerprint,
                        redacted_token=redacted_token,
                        minimal_evidence=minimal_evidence,
                        confidence="high",
                        severity="low" if is_synthetic else ("critical" if "ACCESS_KEY" in token_type or "TOKEN" in token_type else "high"),
                        is_synthetic=is_synthetic,
                    )
                )
                replacements.append((start, end, redacted_token))

        # 4. Detect Symmetric Keys assigned to known variable names
        assign_regex = re.compile(
            r"(?i)\b([a-zA-Z0-9_]*("
            + "|".join(SYMMETRIC_KEY_VAR_NAMES)
            + r")[a-zA-Z0-9_]*)\s*[:=]\s*(?:b)?['\"]([^'\"]{16,128})['\"]"
        )
        for match in assign_regex.finditer(content):
            var_name = match.group(1)
            raw_val = match.group(3)
            start, end = match.start(3), match.end(3)
            if is_overlapping(start, end):
                continue
            if "[REDACTED" in raw_val or "[SYNTHETIC" in raw_val or "{" in raw_val or "}" in raw_val or "${" in raw_val or "..." in raw_val:
                continue
            if "/" in raw_val or "\\" in raw_val or raw_val.startswith(("arn:", "projects/")):
                continue
            if raw_val.endswith((".pem", ".crt", ".key", ".pub", ".cert", ".der", ".json", ".txt", ".yaml", ".yml")):
                continue
            if raw_val.lower() == var_name.lower() or var_name.lower().endswith(raw_val.lower()):
                continue
            if re.fullmatch(r"[a-z0-9_]+", raw_val) and calculate_shannon_entropy(raw_val) < 3.2:
                continue

            claimed_spans.append((start, end))
            line_no, raw_line = get_line_info(start)

            is_synthetic = cls.is_synthetic_fixture(
                raw_line, context=content, file_path=file_path, secret_val=raw_val, line_number=line_no
            ) or (test_mode and "test" in file_path.lower())

            fingerprint = cls.generate_fingerprint(raw_val)
            tag_prefix = "SYNTHETIC_KEY" if is_synthetic else "REDACTED_KEY"
            redacted_token = f"[{tag_prefix}:SYMMETRIC_KEY:{fingerprint}]"

            candidates.append(
                SecretCandidate(
                    candidate_type="SYMMETRIC_KEY",
                    file_path=file_path,
                    line_number=line_no,
                    safe_fingerprint=fingerprint,
                    redacted_token=redacted_token,
                    minimal_evidence=f'{var_name} = "{redacted_token}"',
                    confidence="high",
                    severity="low" if is_synthetic else "high",
                    is_synthetic=is_synthetic,
                )
            )
            replacements.append((start, end, redacted_token))

        # 5. Detect High-Entropy Secrets assigned to variable literals
        entropy_assign_regex = re.compile(
            r"(?i)\b([a-zA-Z0-9_]*(?:secret|password|token|key|credential|private|dek|kek|salt)[a-zA-Z0-9_]*)\s*[:=]\s*['\"]([^'\"\s]{20,128})['\"]"
        )
        for match in entropy_assign_regex.finditer(content):
            var_name = match.group(1)
            raw_val = match.group(2)
            start, end = match.start(2), match.end(2)
            if is_overlapping(start, end):
                continue
            if "onkey" in var_name.lower():
                continue
            if "[REDACTED" in raw_val or "[SYNTHETIC" in raw_val or "{" in raw_val or "}" in raw_val or "${" in raw_val or "..." in raw_val:
                continue
            if "/" in raw_val or "\\" in raw_val or raw_val.startswith(("arn:", "projects/")):
                continue
            if raw_val.endswith((".pem", ".crt", ".key", ".pub", ".cert", ".der", ".json", ".txt", ".yaml", ".yml")):
                continue
            if raw_val.lower() == var_name.lower() or var_name.lower().endswith(raw_val.lower()):
                continue

            # Calculate Shannon Entropy
            entropy = calculate_shannon_entropy(raw_val)
            is_hex = bool(re.fullmatch(r"[0-9a-fA-F]+", raw_val))

            # Hex threshold >= 3.0 (length >= 32); Alphanumeric/Base64 threshold >= 3.7 (length >= 24)
            is_high_entropy = (is_hex and len(raw_val) >= 32 and entropy >= 3.0) or (
                not is_hex and len(raw_val) >= 24 and entropy >= 3.7
            )

            if is_high_entropy:
                claimed_spans.append((start, end))
                line_no, raw_line = get_line_info(start)

                is_synthetic = cls.is_synthetic_fixture(
                    raw_line, context=content, file_path=file_path, secret_val=raw_val, line_number=line_no
                ) or (test_mode and "test" in file_path.lower())

                fingerprint = cls.generate_fingerprint(raw_val)
                tag_prefix = "SYNTHETIC_ENTROPY_SECRET" if is_synthetic else "REDACTED_ENTROPY_SECRET"
                redacted_token = f"[{tag_prefix}:HIGH_ENTROPY_SECRET:{fingerprint}]"

                candidates.append(
                    SecretCandidate(
                        candidate_type="HIGH_ENTROPY_SECRET",
                        file_path=file_path,
                        line_number=line_no,
                        safe_fingerprint=fingerprint,
                        redacted_token=redacted_token,
                        minimal_evidence=f'{var_name} = "{redacted_token}"',
                        confidence="high",
                        severity="low" if is_synthetic else "high",
                        is_synthetic=is_synthetic,
                    )
                )
                replacements.append((start, end, redacted_token))

        # Perform all redactions in reverse order of start index to preserve character offsets
        replacements.sort(key=lambda x: x[0], reverse=True)
        sanitized = content
        for start, end, token in replacements:
            sanitized = sanitized[:start] + token + sanitized[end:]

        return sanitized, candidates

    @classmethod
    def create_static_findings(cls, candidates: List[SecretCandidate]) -> List[StaticFinding]:
        findings = []
        for c in candidates:
            if c.is_synthetic:
                rule_id = f"SYNTHETIC_FIXTURE_{c.candidate_type}"
                finding_type = "synthetic_fixture"
                severity = "low"
                reason = f"Certified synthetic test fixture: {c.candidate_type} (fingerprint: {c.safe_fingerprint})"
            else:
                rule_id = f"SECRET_DETECTED_{c.candidate_type}"
                finding_type = "hardcoded_private_key" if "PRIVATE_KEY" in c.candidate_type else "hardcoded_secret"
                severity = c.severity
                reason = f"Secret-safe discovery: {c.candidate_type} (fingerprint: {c.safe_fingerprint})"

            findings.append(
                StaticFinding(
                    file_path=c.file_path,
                    line_number=c.line_number,
                    rule_id=rule_id,
                    algorithm=c.candidate_type,
                    evidence=c.minimal_evidence,
                    confidence=c.confidence,
                    finding_type=finding_type,
                    severity=severity,
                    analysis_source="secret_detector",
                    needs_human_review=False,
                    reason=reason,
                    fingerprint=c.safe_fingerprint,
                    secret_type=c.candidate_type,
                    is_synthetic=c.is_synthetic,
                )
            )
        return findings
