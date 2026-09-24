import re

# Regex patterns for static parser
MD5_RE = re.compile(r"\b(md5|MD5|EVP_md5)\b")
SHA1_RE = re.compile(r"\b(sha1|SHA1|EVP_sha1)\b")
RSA_KEYGEN_RE = re.compile(
    r"\b(?:RSA_generate_key(?:_ex)?|generate_private_key|RSA\.generate|KeyPairGenerator\.getInstance\(['\"]RSA['\"]\))\b[^\n]*?(\d{3,4})?",
    re.IGNORECASE,
)
ECDH_KEYGEN_RE = re.compile(r"\b(ECDH|ecdh|ECDHE|ec_key_new_by_curve_name)\b", re.IGNORECASE)
PEM_PRIVATE_KEY_RE = re.compile(r"-----BEGIN (.*?)(?:KEY|CERTIFICATE|PARAMETERS)-----")


def strip_comments(text: str) -> str:
    """Safely strip single-line and multi-line comments for static regex scanning."""
    pattern = re.compile(r'//.*?$|/\*.*?\*/|#.*?$|\'(?:\\.|[^\\\'])*\'|"(?:\\.|[^\\"])*"', re.DOTALL | re.MULTILINE)

    def replacer(match):
        s = match.group(0)
        if s.startswith("/") or s.startswith("#"):
            return " "
        return s

    return pattern.sub(replacer, text)


RULES = [
    {
        "id": "R_CLOUD_KMS_AWS",
        "pattern": re.compile(r"\b(KMSClient|aws-kms|kms\.amazonaws\.com|AWSKMS)\b", re.IGNORECASE),
        "algorithm": "AWS KMS",
        "confidence": "high",
        "finding_type": "cloud_service",
        "severity": "Informational",
    },
    {
        "id": "R_CLOUD_KMS_AZURE",
        "pattern": re.compile(r"\b(KeyVaultClient|azure-keyvault|vault\.azure\.net)\b", re.IGNORECASE),
        "algorithm": "Azure Key Vault",
        "confidence": "high",
        "finding_type": "cloud_service",
        "severity": "Informational",
    },
    {
        "id": "R_CLOUD_KMS_GCP",
        "pattern": re.compile(r"\b(KeyManagementServiceClient|cloudkms|cloudkms\.googleapis\.com)\b", re.IGNORECASE),
        "algorithm": "GCP KMS",
        "confidence": "high",
        "finding_type": "cloud_service",
        "severity": "Informational",
    },
    {
        "id": "R_HSM_PKCS11",
        "pattern": re.compile(r"\b(PKCS11|Cryptoki|C_Initialize|C_GetSlotList|libpkcs11)\b", re.IGNORECASE),
        "algorithm": "PKCS#11 HSM",
        "confidence": "high",
        "finding_type": "hardware_module",
        "severity": "Informational",
    },
    {
        "id": "R_HSM_SGX",
        "pattern": re.compile(r"\b(sgx_enclave|intel_sgx|Intel SGX)\b", re.IGNORECASE),
        "algorithm": "Intel SGX Enclave",
        "confidence": "medium",
        "finding_type": "hardware_module",
        "severity": "Informational",
    },
    {
        "id": "R_MD5",
        "pattern": re.compile(r"\b(md5|MD5|EVP_md5)\b"),
        "algorithm": "MD5",
        "confidence": "high",
        "finding_type": "weak_hash",
        "severity": "critical",
    },
    {
        "id": "R_SHA1",
        "pattern": re.compile(r"\b(sha1|SHA1|EVP_sha1)\b"),
        "algorithm": "SHA-1",
        "confidence": "high",
        "finding_type": "weak_hash",
        "severity": "high",
    },
    {
        "id": "R_DES",
        "pattern": re.compile(r"\b(des|DES|EVP_des)\b"),
        "algorithm": "DES",
        "confidence": "high",
        "finding_type": "weak_cipher",
        "severity": "critical",
    },
    {
        "id": "R_3DES",
        "pattern": re.compile(r"\b(des3|DES3|des_ede|EVP_des_ede)\b"),
        "algorithm": "3DES",
        "confidence": "high",
        "finding_type": "weak_cipher",
        "severity": "high",
    },
    {
        "id": "R_RC2",
        "pattern": re.compile(r"\b(rc2|RC2|EVP_rc2)\b"),
        "algorithm": "RC2",
        "confidence": "high",
        "finding_type": "weak_cipher",
        "severity": "critical",
    },
    {
        "id": "R_RC4",
        "pattern": re.compile(r"\b(rc4|RC4|EVP_rc4)\b"),
        "algorithm": "RC4",
        "confidence": "high",
        "finding_type": "weak_cipher",
        "severity": "critical",
    },
    {
        "id": "R_ECB",
        "pattern": re.compile(r"\b(ecb|ECB)\b"),
        "algorithm": "ECB_Mode",
        "confidence": "high",
        "finding_type": "weak_mode",
        "severity": "critical",
    },
    {
        "id": "R_WEAK_RAND",
        "pattern": re.compile(r"\b(rand|srand|Math\.random|random|Math_random)\b"),
        "algorithm": "Weak_PRNG",
        "confidence": "low",
        "finding_type": "weak_prng",
        "severity": "medium",
    },
    {
        "id": "R_PEM",
        "pattern": re.compile(r"-----BEGIN (.*?)(KEY|CERTIFICATE|REQUEST|PARAMETERS)-----"),
        "algorithm": "Hardcoded_PEM",
        "confidence": "high",
        "finding_type": "hardcoded_key",
        "severity": "critical",
    },
    {
        "id": "R_SYM_CONST",
        "pattern": re.compile(r'\b(SECRET|KEY|PASSWORD|TOKEN|API_KEY)\s*=\s*["\'][a-zA-Z0-9+/=]{16,}["\']'),
        "algorithm": "Symmetric_Key",
        "confidence": "low",
        "finding_type": "hardcoded_key",
        "severity": "high",
    },
    {
        "id": "R_CRYPTO_LIBS",
        "pattern": re.compile(r"\b(openssl|mbedtls|wolfssl|libsodium)\b"),
        "algorithm": "Crypto_Library",
        "confidence": "medium",
        "finding_type": "crypto_library",
        "severity": "low",
    },
]


MAX_LINE_LENGTH = 4096
MAX_EVIDENCE_LENGTH = 250
MAX_REGEX_FINDINGS_PER_FILE = 500


def apply_regex_rules(content: str) -> list:
    matches = []
    lines = content.split("\n")
    for i, line in enumerate(lines):
        line_num = i + 1
        # Truncate lines exceeding 4KB to prevent catastrophic regex backtracking (ReDoS)
        scan_line = line[:MAX_LINE_LENGTH] if len(line) > MAX_LINE_LENGTH else line

        for rule in RULES:
            for match in rule["pattern"].finditer(scan_line):
                # Bounded evidence snippet around the match
                start_idx = max(0, match.start() - 40)
                end_idx = min(len(scan_line), match.end() + 120)
                evidence = scan_line[start_idx:end_idx].strip()
                if len(evidence) > MAX_EVIDENCE_LENGTH:
                    evidence = evidence[:MAX_EVIDENCE_LENGTH] + "..."

                matches.append(
                    {
                        "line_number": line_num,
                        "rule_id": rule["id"],
                        "algorithm": rule["algorithm"],
                        "evidence": evidence,
                        "confidence": rule["confidence"],
                        "finding_type": rule["finding_type"],
                        "severity": rule["severity"],
                    }
                )
                if len(matches) >= MAX_REGEX_FINDINGS_PER_FILE:
                    return matches
    return matches
