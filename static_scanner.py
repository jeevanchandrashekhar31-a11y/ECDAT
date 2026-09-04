#!/usr/bin/env python3
"""
ECDAT Static Code Scanner (Stage 2 MVP)
SIH 2026 · PS 26164 · Team Cipher

Scope (per ECDAT_Supplementary_Reference, Section 1):
  - Regex-based detection ONLY. No tree-sitter, no LLM verification pass.
  - Checks: MD5, SHA-1, weak RSA key size, hardcoded private-key material.
  - Language: C (matches the PS's OpenSSL sample dataset).

Output: CycloneDX 1.6 JSON, built via the official cyclonedx-python-lib
(not a hand-rolled schema), with bom-ref format <source>:<assetType>/<slug>@<locator>
per the schema contract, source="code".

NOTE on scope: MD5 and SHA-1 findings here are CLASSICALLY broken
(collision attacks), not quantum-broken. They still belong in the CBOM as
crypto-debt, but don't feed the Mosca quantum-countdown calculation the way
RSA/ECC/DH findings do. Flagging this so the risk-engine owner (Stage 5)
doesn't force them into the quantum-risk narrative incorrectly.
"""
import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from cyclonedx.model.bom import Bom
from cyclonedx.model.component import Component, ComponentType
from cyclonedx.model.component_evidence import ComponentEvidence, Occurrence
from cyclonedx.model.crypto import (
    AlgorithmProperties,
    CryptoAssetType,
    CryptoProperties,
    RelatedCryptoMaterialProperties,
    RelatedCryptoMaterialType,
)
from cyclonedx.output.json import JsonV1Dot6

SOURCE_TAG = "code"  # per schema contract: net | code | bin

# ---------------------------------------------------------------------------
# Regex patterns — C / OpenSSL API surface only.
# Each pattern captures one *usage site*; usage sites are grouped later into
# one Component per (asset_type, slug, file) with multiple occurrences.
# ---------------------------------------------------------------------------

MD5_RE = re.compile(
    r'\b(?:MD5\s*\(|MD5_Init\s*\(|EVP_md5\s*\(\s*\)|EVP_get_digestbyname\s*\(\s*"md5"\s*\))'
)

SHA1_RE = re.compile(
    r'\b(?:SHA1\s*\(|SHA1_Init\s*\(|EVP_sha1\s*\(\s*\)|EVP_get_digestbyname\s*\(\s*"sha1"\s*\))'
)

# RSA_generate_key(bits, e, callback, cb_arg)              -- legacy, bits is arg 1
# RSA_generate_key_ex(rsa, bits, e, cb)                     -- bits is arg 2
# EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, bits)                -- bits is arg 2
RSA_KEYGEN_RE = re.compile(
    r'\bRSA_generate_key\s*\(\s*([a-zA-Z0-9_]+)\s*,'
    r'|\bRSA_generate_key_ex\s*\(\s*\w+\s*,\s*([a-zA-Z0-9_]+)\s*,'
    r'|\bEVP_PKEY_CTX_set_rsa_keygen_bits\s*\(\s*\w+\s*,\s*([a-zA-Z0-9_]+)\s*\)'
)

ECDH_KEYGEN_RE = re.compile(
    r'\b(?:EC_KEY_generate_key|EVP_PKEY_CTX_set_ec_paramgen_curve_nid|DH_generate_key|DH_generate_parameters_ex)\s*\('
)

PEM_PRIVATE_KEY_RE = re.compile(
    r'-----BEGIN ((?:RSA |EC |DSA |ENCRYPTED |OPENSSH )?PRIVATE KEY)-----'
)

WEAK_RSA_THRESHOLD_BITS = 2048

# Strips C/C++ comments and skips over string/char literals so words like
# "MD5" inside a comment or log string don't get flagged as real usage.
# Block comments are replaced with an equal count of newlines (not blanked
# entirely) so downstream line-number math stays correct.
_COMMENT_OR_LITERAL_RE = re.compile(
    r'"(?:\\.|[^"\\])*"'      # string literal
    r'|\'(?:\\.|[^\'\\])*\''  # char literal
    r'|/\*.*?\*/'             # block comment
    r'|//[^\n]*',             # line comment
    re.DOTALL,
)


def strip_comments(text: str) -> str:
    def _replace(m: re.Match) -> str:
        s = m.group(0)
        if s.startswith('/*'):
            return '\n' * s.count('\n')  # preserve line count
        if s.startswith('//'):
            return ''  # single line, no newline to preserve
        return s  # leave string/char literals untouched
    return _COMMENT_OR_LITERAL_RE.sub(_replace, text)


@dataclass
class Finding:
    asset_type: str        # "algorithm" | "related-crypto-material"
    slug: str               # short id used in bom-ref, e.g. "md5", "rsa-1024"
    display_name: str       # human-readable, e.g. "MD5", "RSA-1024"
    file_path: str
    line: int
    detail: str              # extra context for the finding (e.g. bit size)
    kind: str                # "algorithm" | "hardcoded-key"
    algorithm_family: Optional[str] = None


def line_number_at(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def scan_file(path: Path, root: Path) -> Optional[list[Finding]]:
    try:
        text = path.read_text(errors="ignore")
    except (UnicodeDecodeError, OSError) as e:
        print(f"warning: failed to read {path}: {e}", file=sys.stderr)
        return None

    rel = str(path.relative_to(root))
    findings: list[Finding] = []

    # PEM key blocks live inside string literals, so we must search the
    # PEM pattern against the *raw* text (before comment/literal stripping
    # would otherwise leave the string content untouched — it does here,
    # since strip_comments preserves string literals — but scanning raw
    # text for this one check avoids any dependency on that behavior).
    for m in PEM_PRIVATE_KEY_RE.finditer(text):
        key_kind = m.group(1)
        findings.append(Finding(
            asset_type="related-crypto-material", slug="hardcoded-private-key",
            display_name=f"Hardcoded {key_kind}",
            file_path=rel, line=line_number_at(text, m.start()),
            detail=f"PEM-encoded private key material ({key_kind}) embedded directly in source.",
            kind="hardcoded-key",
        ))

    text = strip_comments(text)

    for m in MD5_RE.finditer(text):
        findings.append(Finding(
            asset_type="algorithm", slug="md5", display_name="MD5",
            file_path=rel, line=line_number_at(text, m.start()),
            detail="MD5 hash usage — classically broken (collision attacks), not quantum-specific.",
            kind="algorithm", algorithm_family="MD5"
        ))

    for m in SHA1_RE.finditer(text):
        findings.append(Finding(
            asset_type="algorithm", slug="sha1", display_name="SHA-1",
            file_path=rel, line=line_number_at(text, m.start()),
            detail="SHA-1 hash usage — classically broken (SHAttered, 2017), not quantum-specific.",
            kind="algorithm", algorithm_family="SHA1"
        ))

    for m in RSA_KEYGEN_RE.finditer(text):
        bits_str = next(g for g in m.groups() if g is not None)
        try:
            bits = int(bits_str)
            if bits < WEAK_RSA_THRESHOLD_BITS:
                findings.append(Finding(
                    asset_type="algorithm", slug=f"rsa-{bits}", display_name=f"RSA-{bits}",
                    file_path=rel, line=line_number_at(text, m.start()),
                    detail=f"RSA key generation at {bits} bits — below {WEAK_RSA_THRESHOLD_BITS}-bit "
                           f"threshold (weak even classically) AND broken by Shor's algorithm regardless of size.",
                    kind="algorithm", algorithm_family="RSA"
                ))
            else:
                findings.append(Finding(
                    asset_type="algorithm", slug=f"rsa-{bits}", display_name=f"RSA-{bits}",
                    file_path=rel, line=line_number_at(text, m.start()),
                    detail=f"RSA key generation at {bits} bits — meets classical strength threshold "
                           f"but broken by Shor's algorithm (critical, quantum security level 0).",
                    kind="algorithm", algorithm_family="RSA"
                ))
        except ValueError:
            findings.append(Finding(
                asset_type="algorithm", slug="rsa-unknown", display_name="RSA (Unknown Size)",
                file_path=rel, line=line_number_at(text, m.start()),
                detail="RSA keygen call detected, bit size not statically resolvable. "
                       "Broken by Shor's algorithm (critical, quantum security level 0).",
                kind="algorithm", algorithm_family="RSA"
            ))

    for m in ECDH_KEYGEN_RE.finditer(text):
        findings.append(Finding(
            asset_type="algorithm", slug="ecc-dh", display_name="ECC/DH",
            file_path=rel, line=line_number_at(text, m.start()),
            detail="Elliptic Curve or Diffie-Hellman key generation detected. Broken by Shor's algorithm (critical, quantum security level 0).",
            kind="algorithm", algorithm_family="ECC/DH"
        ))

    return findings


def build_components(findings: list[Finding]) -> list[Component]:
    """Group findings by (asset_type, slug, file) into one Component each,
    with every matching line attached as a separate evidence.occurrence."""
    groups: dict[tuple[str, str, str], list[Finding]] = {}
    for f in findings:
        key = (f.asset_type, f.slug, f.file_path)
        groups.setdefault(key, []).append(f)

    components = []
    for (asset_type, slug, file_path), group in groups.items():
        first = group[0]
        bom_ref = f"{SOURCE_TAG}:{asset_type}/{slug}@{file_path}"

        occurrences = [
            Occurrence(location=f.file_path, line=f.line)
            for f in group
        ]
        evidence = ComponentEvidence(occurrences=occurrences)

        if first.kind == "algorithm":
            nist_level = 0  # classical algorithm in every case this scanner currently detects
            algo_props = AlgorithmProperties(nist_quantum_security_level=nist_level)
            crypto_props = CryptoProperties(
                asset_type=CryptoAssetType.ALGORITHM,
                algorithm_properties=algo_props,
            )
        else:  # hardcoded-key
            related_props = RelatedCryptoMaterialProperties(
                type=RelatedCryptoMaterialType.PRIVATE_KEY,
            )
            crypto_props = CryptoProperties(
                asset_type=CryptoAssetType.RELATED_CRYPTO_MATERIAL,
                related_crypto_material_properties=related_props,
            )

        comp = Component(
            name=first.display_name,
            type=ComponentType.CRYPTOGRAPHIC_ASSET,
            bom_ref=bom_ref,
            crypto_properties=crypto_props,
            evidence=evidence,
            description=first.detail,
        )
        components.append(comp)

    return components


def main():
    ap = argparse.ArgumentParser(description="ECDAT static code scanner (regex-only MVP)")
    ap.add_argument("target_dir", help="Directory to scan (recurses into .c/.h files)")
    ap.add_argument("-o", "--output", default="static_scan_cbom.json", help="Output CBOM JSON path")
    args = ap.parse_args()

    root = Path(args.target_dir).resolve()
    if not root.is_dir():
        print(f"error: {root} is not a directory", file=sys.stderr)
        sys.exit(1)

    c_files = list(root.rglob("*.c")) + list(root.rglob("*.h"))
    if not c_files:
        print(f"warning: no .c/.h files found under {root}", file=sys.stderr)

    all_findings: list[Finding] = []
    files_read = 0
    for f in c_files:
        res = scan_file(f, root)
        if res is not None:
            files_read += 1
            all_findings.extend(res)

    components = build_components(all_findings)

    bom = Bom()
    for c in components:
        bom.components.add(c)

    output_json = JsonV1Dot6(bom).output_as_string(indent=2)
    
    parsed = json.loads(output_json)
    family_map = {}
    for f in all_findings:
        if getattr(f, "algorithm_family", None):
            bom_ref = f"{SOURCE_TAG}:{f.asset_type}/{f.slug}@{f.file_path}"
            family_map[bom_ref] = f.algorithm_family

    for comp in parsed.get("components", []):
        bom_ref = comp.get("bom-ref")
        if bom_ref in family_map:
            crypto_props = comp.get("cryptoProperties", {})
            if "algorithmProperties" in crypto_props:
                crypto_props["algorithmProperties"]["algorithmFamily"] = family_map[bom_ref]

    output_json = json.dumps(parsed, indent=2)
    Path(args.output).write_text(output_json)

    print(f"Scanned {files_read} file(s) (found {len(c_files)}), found {len(all_findings)} usage site(s), "
          f"{len(components)} CBOM component(s) written to {args.output}")


if __name__ == "__main__":
    main()
