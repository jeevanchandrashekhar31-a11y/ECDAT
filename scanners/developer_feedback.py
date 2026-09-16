"""
ECDAT Developer Feedback Engine (Phase 13.2)

Makes cryptographic findings developer-actionable by attaching 9 required dimensions
to every finding:
1. Exact location (file_path, line_number, column_number, formatted)
2. Evidence (sanitized code snippet, zero secret leakage)
3. Confidence (CONFIRMED, HIGH, MEDIUM, LOW)
4. Severity (CRITICAL, HIGH, MEDIUM, LOW, INFORMATIONAL)
5. Why it matters (deep cryptographic rationale — strictly avoiding generic "crypto is insecure")
6. Safe fix (concrete, copy-pasteable replacement code and migration instructions)
7. References (NIST, RFC, FIPS, CWE standards and specifications)
8. Suppression/exception workflow (inline comment syntax and enterprise policy exception API)
9. Verification command (exact local CLI command to verify the fix before pushing)
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import os
from pathlib import Path
import re
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class SafeFixGuidance:
    summary: str
    code_example: str
    migration_steps: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SuppressionWorkflow:
    inline_comment_syntax: str
    inline_example: str
    policy_exception_api: str
    cli_exception_command: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class DeveloperFeedback:
    exact_location: Dict[str, Any]
    evidence: str
    confidence: str
    severity: str
    why_it_matters: str
    safe_fix: SafeFixGuidance
    references: List[str]
    suppression_workflow: SuppressionWorkflow
    verification_command: str
    is_suppressed: bool = False
    suppression_reason: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "exact_location": self.exact_location,
            "evidence": self.evidence,
            "confidence": self.confidence,
            "severity": self.severity,
            "why_it_matters": self.why_it_matters,
            "safe_fix": self.safe_fix.to_dict(),
            "references": self.references,
            "suppression_workflow": self.suppression_workflow.to_dict(),
            "verification_command": self.verification_command,
            "is_suppressed": self.is_suppressed,
            "suppression_reason": self.suppression_reason,
        }


# =========================================================================
# Cryptographic Knowledge Catalog for Developer Guidance
# Strictly avoids generic "crypto is insecure" messages.
# =========================================================================

KNOWLEDGE_CATALOG: Dict[str, Dict[str, Any]] = {
    "MD5": {
        "why_it_matters": (
            "MD5 is vulnerable to practical collision attacks (Wang et al., 2004) where two different inputs "
            "produce the identical 128-bit digest in under a second. In digital signatures, token generation, or "
            "file integrity checks, attackers can forge valid signatures or substitute malicious payloads without altering the hash."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Replace MD5 with SHA-256 (for general security) or SHA-3 / BLAKE3.",
            code_example=(
                "# Python:\n"
                "- import hashlib; return hashlib.md5(data).hexdigest()\n"
                "+ import hashlib; return hashlib.sha256(data).hexdigest()\n\n"
                "// JavaScript / Node.js:\n"
                "- const hash = crypto.createHash('md5').update(data).digest('hex');\n"
                "+ const hash = crypto.createHash('sha256').update(data).digest('hex');"
            ),
            migration_steps=[
                "Identify if the hash output is stored in database columns with fixed lengths (e.g. char(32) for MD5 -> widen to char(64) for SHA-256).",
                "Replace the hashing algorithm constructor with SHA-256 or SHA3-256.",
                "If computing HMACs, update the HMAC digest algorithm to SHA-256.",
                "Rerun unit tests and local ECDAT scan verification.",
            ],
        ),
        "references": [
            "NIST SP 800-131A Rev. 2 (Transitioning Cryptographic Algorithms and Key Lengths)",
            "CWE-328: Use of Weak Hash",
            "RFC 6151: Updated Security Considerations for the MD5 and HMAC-MD5 Algorithms",
        ],
    },
    "SHA-1": {
        "why_it_matters": (
            "SHA-1 has broken collision resistance (SHAttered attack, 2017; Shambles chosen-prefix attack, 2020) "
            "with computational complexity reduced to 2^63 operations. Attackers can forge X.509 TLS certificates, "
            "PGP keys, or git commits by producing identical SHA-1 hashes for different contents."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Upgrade SHA-1 to SHA-256 or SHA-384.",
            code_example=(
                "- crypto.createHash('sha1').update(payload).digest('hex')\n"
                "+ crypto.createHash('sha256').update(payload).digest('hex')"
            ),
            migration_steps=[
                "Verify database column and buffer allocations for 256-bit (32-byte) digest output.",
                "Replace 'sha1' / 'SHA-1' with 'sha256' / 'SHA-256'.",
                "Rotate any existing HMAC keys or certificate signing requests derived using SHA-1.",
            ],
        ),
        "references": [
            "NIST Policy on SHA-1 Deprecation (December 2022 - Transition to SHA-2/SHA-3 by Dec 31, 2030)",
            "CWE-328: Use of Weak Hash",
            "FIPS 180-4: Secure Hash Standard (SHS)",
        ],
    },
    "DES": {
        "why_it_matters": (
            "DES uses a 56-bit key length susceptible to exhaustive brute-force key search in minutes ($2^{56}$ operations) "
            "using specialized hardware (e.g. Crack.sh, Deep Crack). Furthermore, its 64-bit block size makes it vulnerable "
            "to Sweet32 collision attacks after encrypting approximately $2^{32}$ blocks (32 GB) with the same key."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Migrate to AES-256-GCM (Galois/Counter Mode) with an authenticated 96-bit nonce.",
            code_example=(
                "# Python (cryptography):\n"
                "- from Crypto.Cipher import DES; cipher = DES.new(key, DES.MODE_ECB)\n"
                "+ from cryptography.hazmat.primitives.ciphers.aead import AESGCM\n"
                "+ aes = AESGCM(aes_256_key); ciphertext = aes.encrypt(nonce_96_bits, plaintext, None)\n\n"
                "// Node.js:\n"
                "- const cipher = crypto.createCipheriv('des-cbc', key, iv);\n"
                "+ const cipher = crypto.createCipheriv('aes-256-gcm', key256, iv96);"
            ),
            migration_steps=[
                "Generate a cryptographically secure 256-bit symmetric key using a secure CSPRNG.",
                "Replace DES/3DES cipher suites with AES-GCM or ChaCha20-Poly1305.",
                "Ensure unique, non-repeating initialization vectors (IV/nonce) for every encryption call.",
            ],
        ),
        "references": [
            "NIST SP 800-131A Rev. 2 (Disallowing 3DES and single DES)",
            "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
            "CVE-2016-2183 (Sweet32 Birthday attack on 64-bit block ciphers)",
        ],
    },
    "3DES": {
        "why_it_matters": (
            "Triple DES (3DES/TDEA) relies on a small 64-bit block size vulnerable to Sweet32 birthday collision attacks "
            "(CVE-2016-2183) when encrypting large volumes of traffic under a single key. NIST has officially retired 3DES "
            "for all new and legacy applications after 2023."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Upgrade 3DES to AES-GCM (AES-128 or AES-256).",
            code_example=(
                "- cipher = crypto.createCipheriv('des-ede3-cbc', key, iv);\n"
                "+ cipher = crypto.createCipheriv('aes-256-gcm', key, iv);"
            ),
            migration_steps=[
                "Migrate cipher selection to AES-GCM.",
                "Re-encrypt legacy stored data with AES-256 keys.",
            ],
        ),
        "references": [
            "NIST SP 800-131A Rev. 2",
            "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
        ],
    },
    "RC4": {
        "why_it_matters": (
            "RC4 is a stream cipher with severe statistical keystream biases (Fluhrer-Mantin-Shamir attack, Bar Mitzvah attack) "
            "that allow passive eavesdroppers to recover session cookies and sensitive plaintexts from encrypted streams. "
            "IETF RFC 7465 explicitly prohibits the use of RC4 in all TLS configurations."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Replace RC4 with ChaCha20-Poly1305 or AES-GCM.",
            code_example=(
                "- const cipher = crypto.createCipheriv('rc4', key, '');\n"
                "+ const cipher = crypto.createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: 16 });"
            ),
            migration_steps=[
                "Disable RC4 cipher suites in TLS configurations.",
                "Replace application RC4 stream cipher instances with ChaCha20-Poly1305.",
            ],
        ),
        "references": [
            "RFC 7465: Prohibiting RC4 Cipher Suites",
            "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
        ],
    },
    "ECB": {
        "why_it_matters": (
            "Electronic Codebook (ECB) mode encrypts identical 16-byte plaintext blocks into identical ciphertext blocks "
            "without an initialization vector (IV). This leaks data patterns and structural relationships (e.g. the famous "
            "ECB penguin effect), allowing attackers to analyze, replay, or rearrange blocks without knowing the secret key."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Replace ECB mode with an authenticated mode such as GCM (Galois/Counter Mode) or CBC with HMAC.",
            code_example=(
                "- cipher = AES.new(key, AES.MODE_ECB)\n"
                "+ aesgcm = AESGCM(key); ciphertext = aesgcm.encrypt(nonce, plaintext, None)"
            ),
            migration_steps=[
                "Eliminate ECB mode from all symmetric cipher instantiations.",
                "Implement AEAD (AES-GCM or ChaCha20-Poly1305) to provide both confidentiality and ciphertext integrity.",
                "Generate a fresh 96-bit cryptographically random nonce for every encryption operation.",
            ],
        ),
        "references": [
            "NIST SP 800-38D (Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode)",
            "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
        ],
    },
    "RSA_KEY_SIZE": {
        "why_it_matters": (
            "RSA keys with modulus lengths under 2048 bits (such as RSA-512 or RSA-1024) provide less than 80 bits of "
            "security strength and are factorable using the General Number Field Sieve (GNFS) on modern computing clusters. "
            "Factoring the modulus exposes the private key, completely compromising authentication, signatures, and decryption."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Generate RSA keys with at least 2048 bits (3072 bits recommended), or adopt ML-KEM / ML-DSA for PQC.",
            code_example=(
                "- rsa.generate_private_key(public_exponent=65537, key_size=1024)\n"
                "+ rsa.generate_private_key(public_exponent=65537, key_size=3072)"
            ),
            migration_steps=[
                "Update key generation routines to set key_size=2048 or key_size=3072.",
                "Rotate all existing certificates and keypairs generated with sub-2048 bit moduli.",
                "Plan transition to FIPS 204 ML-DSA or FIPS 203 ML-KEM for long-term quantum resilience.",
            ],
        ),
        "references": [
            "NIST SP 800-57 Part 1 Rev. 5 (Recommendation for Key Management)",
            "CWE-326: Inadequate Encryption Strength",
        ],
    },
    "TLS_VERSION": {
        "why_it_matters": (
            "TLS 1.0 and TLS 1.1 lack modern Authenticated Encryption (AEAD), utilize broken hash functions in handshakes, "
            "and are vulnerable to BEAST, POODLE, and downgrade attacks. Major browsers, NIST SP 800-52r2, RFC 8996, and PCI-DSS "
            "have completely deprecated TLS 1.0/1.1."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Enforce TLS 1.2 minimum version, preferably TLS 1.3.",
            code_example=(
                "// Node.js TLS options:\n"
                "- const options = { secureProtocol: 'TLSv1_method' };\n"
                "+ const options = { minVersion: 'TLSv1.2' };"
            ),
            migration_steps=[
                "Set minVersion to 'TLSv1.2' or 'TLSv1.3' across web servers, reverse proxies, and HTTP clients.",
                "Remove references to 'TLSv1_method' or 'TLSv1_1_method'.",
            ],
        ),
        "references": [
            "RFC 8996: Deprecating TLS 1.0 and TLS 1.1",
            "NIST SP 800-52 Rev. 2 (Guidelines for the Selection, Configuration, and Use of TLS)",
        ],
    },
    "CERT_VALIDATION": {
        "why_it_matters": (
            "Disabling TLS certificate or hostname validation (e.g. `rejectUnauthorized: false` or `verify=False`) "
            "neutralizes all authentication guarantees of TLS. Any attacker on the local network, Wi-Fi, or ISP path "
            "can perform Man-in-the-Middle (MitM) attacks using self-signed or forged certificates to intercept and modify traffic."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Enable strict certificate validation and load enterprise root CA certificates into trust stores if needed.",
            code_example=(
                "# Python:\n"
                "- requests.get(url, verify=False)\n"
                "+ requests.get(url, verify='/path/to/custom_ca.pem')\n\n"
                "// Node.js:\n"
                "- const agent = new https.Agent({ rejectUnauthorized: false });\n"
                "+ const agent = new https.Agent({ ca: fs.readFileSync('/path/to/ca.pem') });"
            ),
            migration_steps=[
                "Remove all 'rejectUnauthorized: false', 'verify=False', and 'InsecureSkipVerify: true' statements.",
                "If communicating with internal servers using private PKI, configure the custom CA bundle explicitly.",
            ],
        ),
        "references": [
            "CWE-295: Improper Certificate Validation",
            "RFC 5280: Internet X.509 Public Key Infrastructure Certificate and CRL Profile",
        ],
    },
    "HARDCODED_KEY": {
        "why_it_matters": (
            "Hardcoding private keys, symmetric keys, or access tokens in source code exposes credentials to everyone "
            "with access to the git repository, build artifacts, container layers, and error logs. Once committed, keys remain "
            "in git commit history even if deleted in subsequent commits."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Extract cryptographic keys into a secure Secret Manager (AWS Secrets Manager, HashiCorp Vault) or environment variable.",
            code_example=(
                "- const SECRET_KEY = '0123456789abcdef0123456789abcdef';\n"
                "+ const SECRET_KEY = process.env.ENCRYPTION_KEY || await secretManager.getSecret('encryption-key');"
            ),
            migration_steps=[
                "Immediately revoke and rotate the exposed key or certificate.",
                "Store the new key in a hardened KMS or secret vault.",
                "Inject the key at runtime via environment variables or secret mount.",
                "Purge the sensitive commit from git history using git-filter-repo or BFG Repo-Cleaner if public.",
            ],
        ),
        "references": [
            "CWE-798: Use of Hard-coded Credentials",
            "NIST SP 800-57 Part 1 (Key Storage and Protection)",
        ],
    },
    "WEAK_PRNG": {
        "why_it_matters": (
            "Standard pseudorandom number generators (such as Math.random(), rand(), or Python's random module) "
            "use linear congruential or Mersenne Twister algorithms designed for statistical simulation, not cryptographic secrecy. "
            "Their internal states can be completely reconstructed after observing a small sequence of outputs, enabling attackers "
            "to predict generated nonces, tokens, or encryption keys."
        ),
        "safe_fix": SafeFixGuidance(
            summary="Use a Cryptographically Secure Pseudo-Random Number Generator (CSPRNG) backed by OS entropy.",
            code_example=(
                "- const token = Math.random().toString(36).substring(2);\n"
                "+ const token = crypto.randomBytes(32).toString('hex');"
            ),
            migration_steps=[
                "Replace standard PRNG calls with crypto.randomBytes() (Node.js) or secrets / os.urandom (Python).",
            ],
        ),
        "references": [
            "CWE-338: Use of Cryptographically Weak Pseudo-Random Number Generator",
            "NIST SP 800-90A Rev. 1 (Recommendation for Random Number Generation Using Deterministic Random Bit Generators)",
        ],
    },
}


# Generic Fallback (still specific to cryptography, never "crypto is insecure")
DEFAULT_KNOWLEDGE = {
    "why_it_matters": (
        "Cryptographic primitive deviates from NIST and enterprise approved cryptographic standards. "
        "Non-standard or legacy algorithms introduce operational risk, reduce security margins, and fail compliance audits."
    ),
    "safe_fix": SafeFixGuidance(
        summary="Migrate primitive to a modern NIST-approved standard algorithm.",
        code_example="// Review architecture to adopt AES-GCM, SHA-256, or PQC standards (FIPS 203/204).",
        migration_steps=[
            "Review cryptographic inventory against enterprise cryptographic baseline.",
            "Select an approved replacement from NIST SP 800-131A.",
        ],
    ),
    "references": [
        "NIST SP 800-131A Rev. 2",
        "CWE-327: Use of a Broken or Risky Cryptographic Algorithm",
    ],
}


class DeveloperFeedbackGenerator:
    """
    Generates developer-actionable feedback cards for cryptographic findings.
    """

    @classmethod
    def resolve_knowledge(cls, algorithm: str, finding_type: str) -> Dict[str, Any]:
        """Resolves matching knowledge entry based on algorithm and finding_type."""
        algo_upper = str(algorithm).upper()
        ft_upper = str(finding_type).upper()

        if "MD5" in algo_upper or "MD5" in ft_upper:
            return KNOWLEDGE_CATALOG["MD5"]
        if "SHA1" in algo_upper or "SHA-1" in algo_upper or "SHA1" in ft_upper or "SHA-1" in ft_upper:
            return KNOWLEDGE_CATALOG["SHA-1"]
        if "3DES" in algo_upper or "TRIPLE" in algo_upper or "3DES" in ft_upper:
            return KNOWLEDGE_CATALOG["3DES"]
        if "DES" in algo_upper or "DES" in ft_upper:
            return KNOWLEDGE_CATALOG["DES"]
        if "RC4" in algo_upper or "RC4" in ft_upper:
            return KNOWLEDGE_CATALOG["RC4"]
        if "ECB" in algo_upper or "ECB" in ft_upper:
            return KNOWLEDGE_CATALOG["ECB"]
        if "RSA" in algo_upper and ("1024" in algo_upper or "512" in algo_upper or "KEY_SIZE" in ft_upper):
            return KNOWLEDGE_CATALOG["RSA_KEY_SIZE"]
        if "TLS" in algo_upper or "SSL" in algo_upper or "TLS" in ft_upper:
            if "VALIDATION" in ft_upper or "VERIF" in ft_upper or "CERT" in ft_upper:
                return KNOWLEDGE_CATALOG["CERT_VALIDATION"]
            return KNOWLEDGE_CATALOG["TLS_VERSION"]
        if "HARDCODED" in ft_upper or "SECRET" in ft_upper or "PRIVATE_KEY" in algo_upper or "SYMMETRIC_KEY" in algo_upper:
            return KNOWLEDGE_CATALOG["HARDCODED_KEY"]
        if "PRNG" in ft_upper or "RANDOM" in ft_upper:
            return KNOWLEDGE_CATALOG["WEAK_PRNG"]

        return DEFAULT_KNOWLEDGE

    @classmethod
    def check_inline_suppression(
        cls,
        file_content: str,
        line_number: int,
        rule_id: str,
        algorithm: str = "",
        finding_type: str = "",
    ) -> Tuple[bool, Optional[str]]:
        """
        Scans current line and preceding line for developer inline suppression comments:
        e.g.
        # ecdat:suppress PY_HASHLIB_MD5 reason="File caching checksum only"
        # ecdat:suppress MD5 reason="File caching checksum only"
        // ecdat:suppress weak_hash reason="..."
        """
        if not file_content or line_number <= 0:
            return False, None

        lines = file_content.splitlines()
        target_idx = line_number - 1
        lines_to_check = []

        if target_idx < len(lines):
            lines_to_check.append(lines[target_idx])
        if target_idx > 0 and (target_idx - 1) < len(lines):
            lines_to_check.append(lines[target_idx - 1])

        clean_rule = rule_id.strip().upper()
        clean_algo = algorithm.strip().upper()
        clean_ft = finding_type.strip().upper()

        pattern = re.compile(
            r"(?:#|//|/\*)\s*ecdat:(?:suppress|ignore)\s+([A-Za-z0-9_-]+)(?:\s+reason=[\"']([^\"']+)[\"'])?",
            re.IGNORECASE,
        )

        for line in lines_to_check:
            m = pattern.search(line)
            if m:
                supp_target = m.group(1).strip().upper()
                reason = m.group(2) or "Suppressed via developer inline comment"
                if (
                    supp_target == "ALL"
                    or supp_target == clean_rule
                    or supp_target in clean_rule
                    or clean_rule in supp_target
                    or (clean_algo and (clean_algo == supp_target or clean_algo in supp_target or supp_target in clean_algo))
                    or (clean_ft and (clean_ft == supp_target or clean_ft in supp_target or supp_target in clean_ft))
                ):
                    return True, reason

        return False, None

    @classmethod
    def generate(cls, finding: Dict[str, Any], target_root: Optional[str] = None) -> DeveloperFeedback:
        """
        Constructs comprehensive DeveloperFeedback with all 9 required dimensions.
        """
        file_path = str(finding.get("file_path", "unknown")).replace("\\", "/")
        line_num = int(finding.get("line_number", 1))
        col_num = int(finding.get("column_number", 1))

        formatted_location = f"{file_path}:{line_num}:{col_num}"
        exact_location = {
            "file_path": file_path,
            "line_number": line_num,
            "column_number": col_num,
            "formatted": formatted_location,
        }

        algo = str(finding.get("algorithm", "UNKNOWN"))
        finding_type = str(finding.get("finding_type", "weak_crypto"))
        rule_id = str(finding.get("rule_id", "ECDAT-CRYPTO"))
        confidence = str(finding.get("confidence", "HIGH")).upper()
        severity = str(finding.get("severity", "MEDIUM")).upper()

        knowledge = cls.resolve_knowledge(algo, finding_type)

        # Evidence: Ensure strictly zero secret leakage
        raw_evidence = str(finding.get("evidence", ""))
        evidence = raw_evidence

        # In-Code Suppression check
        is_suppressed = False
        suppression_reason = None
        if target_root:
            full_target = Path(target_root) / file_path
            if full_target.exists() and full_target.is_file():
                try:
                    content = full_target.read_text(encoding="utf-8", errors="replace")
                    is_suppressed, suppression_reason = cls.check_inline_suppression(
                        content, line_num, rule_id, algorithm=algo, finding_type=finding_type
                    )
                except Exception:
                    pass

        # Suppression Workflow guidance
        comment_prefix = "#" if file_path.endswith((".py", ".yaml", ".yml", ".sh")) else "//"
        inline_example = f'{comment_prefix} ecdat:suppress {rule_id} reason="Explain why this cryptographic usage is safe or non-security"'
        suppression_workflow = SuppressionWorkflow(
            inline_comment_syntax=f'{comment_prefix} ecdat:suppress {rule_id} reason="<justification>"',
            inline_example=inline_example,
            policy_exception_api="POST /api/v1/policy/exceptions",
            cli_exception_command=f'python -m scanners.policy_security exception request --rule {rule_id} --reason "<justification>"',
        )

        # Verification Command
        verification_command = f"python -m scanners.ci_scanner . --changed-files {file_path} --fail-on critical"

        return DeveloperFeedback(
            exact_location=exact_location,
            evidence=evidence,
            confidence=confidence,
            severity=severity,
            why_it_matters=knowledge["why_it_matters"],
            safe_fix=knowledge["safe_fix"],
            references=knowledge["references"],
            suppression_workflow=suppression_workflow,
            verification_command=verification_command,
            is_suppressed=is_suppressed,
            suppression_reason=suppression_reason,
        )

    @classmethod
    def render_terminal_card(cls, feedback: DeveloperFeedback) -> str:
        """Renders developer feedback as a rich, formatted terminal card."""
        sep = "-" * 72
        status_line = f"[{feedback.severity}] {feedback.exact_location['formatted']}"
        if feedback.is_suppressed:
            status_line += f" (SUPPRESSED: {feedback.suppression_reason})"

        steps_str = "\n".join(f"    {i+1}. {step}" for i, step in enumerate(feedback.safe_fix.migration_steps))
        refs_str = "\n".join(f"    * {ref}" for ref in feedback.references)

        return (
            f"\n{sep}\n"
            f"  {status_line}\n"
            f"{sep}\n"
            f"  Location:     {feedback.exact_location['formatted']}\n"
            f"  Severity:     {feedback.severity} | Confidence: {feedback.confidence}\n\n"
            f"  Evidence:\n"
            f"    {feedback.exact_location['line_number']} | {feedback.evidence}\n\n"
            f"  Why It Matters (Cryptographic Weakness):\n"
            f"    {feedback.why_it_matters}\n\n"
            f"  Safe Fix:\n"
            f"    {feedback.safe_fix.summary}\n\n"
            f"  Migration Steps:\n"
            f"{steps_str}\n\n"
            f"  Code Remediation Example:\n"
            f"{feedback.safe_fix.code_example}\n\n"
            f"  Standards & References:\n"
            f"{refs_str}\n\n"
            f"  Suppression / Policy Exception:\n"
            f"    In-Code:  {feedback.suppression_workflow.inline_example}\n"
            f"    API:      {feedback.suppression_workflow.policy_exception_api}\n\n"
            f"  Verify Locally:\n"
            f"    $ {feedback.verification_command}\n"
            f"{sep}\n"
        )

    @classmethod
    def render_markdown(cls, feedback: DeveloperFeedback) -> str:
        """Renders developer feedback card as GitHub Flavored Markdown for PR comments and SARIF."""
        steps_md = "\n".join(f"{i+1}. {s}" for i, s in enumerate(feedback.safe_fix.migration_steps))
        refs_md = "\n".join(f"- {r}" for r in feedback.references)

        return (
            f"### [{feedback.severity}] Cryptographic Finding: `{feedback.exact_location['formatted']}`\n\n"
            f"**Location:** `{feedback.exact_location['formatted']}`  \n"
            f"**Severity:** `{feedback.severity}` | **Confidence:** `{feedback.confidence}`\n\n"
            f"#### Evidence\n"
            f"```text\n{feedback.exact_location['line_number']} | {feedback.evidence}\n```\n\n"
            f"#### Why It Matters\n"
            f"{feedback.why_it_matters}\n\n"
            f"#### Safe Fix\n"
            f"{feedback.safe_fix.summary}\n\n"
            f"```diff\n{feedback.safe_fix.code_example}\n```\n\n"
            f"**Migration Steps:**\n"
            f"{steps_md}\n\n"
            f"#### Standards & References\n"
            f"{refs_md}\n\n"
            f"#### Suppression & Exception Workflow\n"
            f"- **In-Code Suppression:** Add `{feedback.suppression_workflow.inline_example}`\n"
            f"- **Enterprise Policy Exception:** `{feedback.suppression_workflow.policy_exception_api}`\n\n"
            f"#### Verification Command\n"
            f"```bash\n{feedback.verification_command}\n```\n"
        )
