import re
from pathlib import Path
from typing import List, Optional

from scanners.models import CodeCryptoFinding
from scanners.static.regex_rules import (
    MD5_RE,
    SHA1_RE,
    RSA_KEYGEN_RE,
    ECDH_KEYGEN_RE,
    PEM_PRIVATE_KEY_RE,
    strip_comments,
)


def line_number_at(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def scan_file_regex(path: Path, root: Path) -> List[CodeCryptoFinding]:
    try:
        text = path.read_text(errors="ignore")
    except Exception:
        return []

    rel = str(path.relative_to(root)).replace("\\", "/")
    language = path.suffix.lstrip(".").upper()
    if language == "":
        language = "UNKNOWN"

    findings = []

    for m in PEM_PRIVATE_KEY_RE.finditer(text):
        key_kind = m.group(1).strip()
        findings.append(
            CodeCryptoFinding(
                bom_ref=f"code:key/{key_kind.lower().replace(' ', '')}@{rel}:{line_number_at(text, m.start())}",
                file_path=rel,
                language=language,
                line=line_number_at(text, m.start()),
                algorithm=key_kind,
                finding_type="hardcoded_key",
                confidence="high",
            )
        )

    text_stripped = strip_comments(text)

    for m in MD5_RE.finditer(text_stripped):
        findings.append(
            CodeCryptoFinding(
                bom_ref=f"code:algorithm/md5@{rel}:{line_number_at(text_stripped, m.start())}",
                file_path=rel,
                language=language,
                line=line_number_at(text_stripped, m.start()),
                algorithm="MD5",
                finding_type="algorithm",
                confidence="medium",  # Regex is less confident than AST
            )
        )

    for m in SHA1_RE.finditer(text_stripped):
        findings.append(
            CodeCryptoFinding(
                bom_ref=f"code:algorithm/sha1@{rel}:{line_number_at(text_stripped, m.start())}",
                file_path=rel,
                language=language,
                line=line_number_at(text_stripped, m.start()),
                algorithm="SHA1",
                finding_type="algorithm",
                confidence="medium",
            )
        )

    for m in RSA_KEYGEN_RE.finditer(text_stripped):
        bits_str = next((g for g in m.groups() if g is not None), None)
        key_size = None
        if bits_str:
            try:
                key_size = int(bits_str)
            except ValueError:
                pass

        slug = f"rsa-{key_size}" if key_size else "rsa-unknown"
        findings.append(
            CodeCryptoFinding(
                bom_ref=f"code:algorithm/{slug}@{rel}:{line_number_at(text_stripped, m.start())}",
                file_path=rel,
                language=language,
                line=line_number_at(text_stripped, m.start()),
                algorithm="RSA",
                key_size=key_size,
                finding_type="algorithm",
                confidence="medium",
            )
        )

    for m in ECDH_KEYGEN_RE.finditer(text_stripped):
        findings.append(
            CodeCryptoFinding(
                bom_ref=f"code:algorithm/ecc-dh@{rel}:{line_number_at(text_stripped, m.start())}",
                file_path=rel,
                language=language,
                line=line_number_at(text_stripped, m.start()),
                algorithm="ECC/DH",
                finding_type="algorithm",
                confidence="medium",
            )
        )

    return findings
