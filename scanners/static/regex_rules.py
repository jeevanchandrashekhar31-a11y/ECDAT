import re

RULES = [
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


def apply_regex_rules(content: str) -> list:
    matches = []
    lines = content.split("\n")
    for i, line in enumerate(lines):
        line_num = i + 1
        for rule in RULES:
            for match in rule["pattern"].finditer(line):
                matches.append(
                    {
                        "line_number": line_num,
                        "rule_id": rule["id"],
                        "algorithm": rule["algorithm"],
                        "evidence": line.strip(),
                        "confidence": rule["confidence"],
                        "finding_type": rule["finding_type"],
                        "severity": rule["severity"],
                    }
                )
    return matches
