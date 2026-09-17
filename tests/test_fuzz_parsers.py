"""
Phase 22.2 — Property and Fuzz Testing Suite for Security-Sensitive Parsers.

Targets:
1. Source Parsers (Python, JS, TS, C, C++, Go, Java, Kotlin, C#, Rust AST Adapters)
2. Archive Parser (ArchiveSecurityGuard for ZIP and TAR formats)
3. Certificate Parser (SafeCertParser for DER, PEM, and X.509 chains)
4. PCAP Parser (SafePcapParser for PCAP binary structures)
5. CBOM Parser (import_cbom for CycloneDX 1.6/1.7 JSON and XML)
6. Binary Parser (SafeElfParser, SafePeParser, SafeMachoParser, LibraryFingerprinter)
7. Policy Parser (PolicyEngine and PolicySecurityController)

Requirements Enforced:
- No memory corruption (native crashes, access violations)
- No uncontrolled recursion (no RecursionError or stack exhaustion)
- No unbounded resource use (strict execution deadlines and memory bounds)
- No secrets in crash output (zero canary secret leakage in exceptions or diagnostic dumps)
"""

import io
import json
import os
import struct
import tarfile
import tempfile
import time
import zipfile
from pathlib import Path
import pytest

from testing.fuzzing.engine import (
    FuzzMutator,
    FuzzSecurityAssertion,
    FuzzWatchdogError,
    SecretLeakageError,
)

# 1. Source Parser imports
from scanners.static.ast.adapters import get_default_adapter_registry

# 2. Archive Parser imports
from scanners.common.archive_guard import (
    ArchiveSecurityGuard,
    ArchiveSecurityError,
    DecompressionBombError,
    PathTraversalError,
    NestedArchiveError,
)

# 3. Certificate Parser imports
from scanners.network.cert_parser import (
    SafeCertParser,
    CertSecurityError,
    CertParsingError,
    parse_cert_bytes,
)

# 4. PCAP Parser imports
from scanners.network.pcap_parser import (
    SafePcapParser,
    PcapSecurityError,
    PcapSizeLimitError,
    PcapTimeoutError,
    LINKTYPE_ETHERNET,
)

# 5. CBOM Parser imports
from scanners.cbom_io import import_cbom

# 6. Binary Parser imports
from scanners.binary_container.parsers import (
    SafeElfParser,
    SafePeParser,
    SafeMachoParser,
)
from scanners.binary_container.parsers.library_fingerprinter import LibraryFingerprinter
from scanners.binary_container.parsers.base import SymbolMetadata

# 7. Policy Parser imports
from scanners.policy_engine import PolicyEngine, PolicyValidationError
from scanners.policy_security import PolicySecurityController, PolicySecurityError


@pytest.fixture
def mutator():
    """Deterministic mutator with fixed seed for reproducible fuzzing."""
    return FuzzMutator(seed=42)


@pytest.fixture
def assertion():
    """Security watchdog enforcing time bounds and secret leakage assertions."""
    return FuzzSecurityAssertion(max_duration_seconds=3.0)


# ============================================================================
# TARGET 1: SOURCE PARSERS
# ============================================================================
class TestFuzzSourceParsers:
    """Fuzz testing AST source parsers across all supported languages."""

    registry = get_default_adapter_registry()

    @pytest.mark.parametrize(
        "ext",
        [".py", ".js", ".ts", ".c", ".cpp", ".go", ".java", ".kt", ".cs", ".rs"],
    )
    def test_fuzz_source_parser_mutations(self, ext, mutator, assertion, tmp_path):
        """Generates mutated source code and asserts safe handling without crashes or secret leaks."""
        adapter = self.registry.get_by_extension(ext)
        assert adapter is not None, f"Adapter for {ext} must be registered"

        seed_samples = [
            "import hashlib\nh = hashlib.md5(b'test').hexdigest()\n",
            "const crypto = require('crypto');\ncrypto.createCipheriv('des', k, iv);\n",
            "int main() { EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new(); return 0; }\n",
            'package main\nimport "crypto/des"\nfunc main() { des.NewCipher([]byte("key")) }\n',
            'public class A { void test() { MessageDigest md = MessageDigest.getInstance("MD5"); } }\n',
        ]

        dummy_path = tmp_path / f"target{ext}"

        for seed in seed_samples:
            for _ in range(5):
                mutated_code = mutator.mutate_string(seed, num_mutations=3)
                mutated_bytes = mutated_code.encode("utf-8", errors="replace")

                # Must not crash, exhaust recursion, or leak canary secrets
                success, findings, exc = assertion.execute_safely(
                    adapter.extract_findings,
                    mutated_bytes,
                    dummy_path,
                    tmp_path,
                )
                assert success is True or exc is not None

    def test_source_parser_extreme_nesting_no_uncontrolled_recursion(self, assertion, tmp_path):
        """Tests extreme nesting depths up to 500 levels: must not cause RecursionError."""
        adapter = self.registry.get_by_extension(".py")
        dummy_path = tmp_path / "nested.py"

        # 500 nested function calls f(f(f(...)))
        depth = 500
        nested_code = "f(" * depth + "'canary_val'" + ")" * depth

        success, findings, exc = assertion.execute_safely(
            adapter.extract_findings,
            nested_code.encode("utf-8"),
            dummy_path,
            tmp_path,
        )
        assert success is True or exc is not None

    def test_source_parser_secret_in_code_never_leaked_in_errors(self, assertion, tmp_path):
        """If source code contains secrets and triggers parser syntax errors, secrets must not leak."""
        adapter = self.registry.get_by_extension(".py")
        dummy_path = tmp_path / "secret.py"

        canary = assertion.canary_secrets[0]
        malformed_with_secret = f"def broken_syntax( {canary} ::: == \n  return 123"

        success, findings, exc = assertion.execute_safely(
            adapter.extract_findings,
            malformed_with_secret.encode("utf-8"),
            dummy_path,
            tmp_path,
        )
        # Verify canary was not leaked in any string output
        if exc:
            assertion.assert_no_secret_leak(str(exc))
        if findings:
            for f in findings:
                assertion.assert_no_secret_leak(str(f))


# ============================================================================
# TARGET 2: ARCHIVE PARSER
# ============================================================================
class TestFuzzArchiveParser:
    """Fuzz testing ArchiveSecurityGuard on corrupted, bomb, and traversal archives."""

    def test_fuzz_zip_archives(self, mutator, assertion, tmp_path):
        guard = ArchiveSecurityGuard(
            max_total_bytes=5 * 1024 * 1024,
            max_entry_size=1024 * 1024,
            max_files_count=20,
            max_compression_ratio=20.0,
            allow_nested=False,
        )

        for _ in range(10):
            zip_buf = io.BytesIO()
            with zipfile.ZipFile(zip_buf, "w") as zf:
                zf.writestr("clean.txt", "valid file content\n")
                zf.writestr("sub/dir/test.c", "int main() {}\n")

            raw_zip = zip_buf.getvalue()
            mutated_zip = mutator.mutate_bytes(raw_zip, num_mutations=3)

            target_zip = tmp_path / "fuzz.zip"
            target_zip.write_bytes(mutated_zip)
            extract_dir = tmp_path / "extract_zip"

            # Execute extraction under security watchdog
            success, result, exc = assertion.execute_safely(
                guard.extract_zip,
                target_zip,
                extract_dir,
                allowed_exceptions=(
                    ArchiveSecurityError,
                    zipfile.BadZipFile,
                    EOFError,
                    ValueError,
                    OSError,
                ),
            )
            assert success is True or exc is not None

    def test_fuzz_tar_archives(self, mutator, assertion, tmp_path):
        guard = ArchiveSecurityGuard(
            max_total_bytes=5 * 1024 * 1024,
            max_entry_size=1024 * 1024,
            max_files_count=20,
            allow_nested=False,
        )

        for _ in range(10):
            tar_buf = io.BytesIO()
            with tarfile.open(fileobj=tar_buf, mode="w") as tf:
                data = b"Some legitimate code\n"
                ti = tarfile.TarInfo("test_file.py")
                ti.size = len(data)
                tf.addfile(ti, io.BytesIO(data))

            raw_tar = tar_buf.getvalue()
            mutated_tar = mutator.mutate_bytes(raw_tar, num_mutations=3)

            target_tar = tmp_path / "fuzz.tar"
            target_tar.write_bytes(mutated_tar)
            extract_dir = tmp_path / "extract_tar"

            success, result, exc = assertion.execute_safely(
                guard.extract_tar,
                target_tar,
                extract_dir,
                allowed_exceptions=(
                    ArchiveSecurityError,
                    tarfile.TarError,
                    EOFError,
                    ValueError,
                    OSError,
                ),
            )
            assert success is True or exc is not None

    def test_archive_path_traversal_fuzzing(self, assertion, tmp_path):
        """Fuzz path containment validation against all permutations of traversal vectors."""
        guard = ArchiveSecurityGuard()
        extract_dir = tmp_path / "dest"
        extract_dir.mkdir(parents=True, exist_ok=True)

        traversal_vectors = [
            "../../etc/passwd",
            "..\\..\\windows\\system32\\cmd.exe",
            "folder/../../outside.txt",
            "/etc/passwd/../../../escape.txt",
            "C:\\boot.ini",
            "D:/data/secret.key",
            "safe_dir/../../../canary_token.txt",
            "file.txt\x00.zip",
            "CON",
            "PRN.txt",
            "AUX",
            "COM1",
        ]

        for vector in traversal_vectors:
            with pytest.raises(PathTraversalError):
                guard._validate_path_containment(vector, extract_dir)


# ============================================================================
# TARGET 3: CERTIFICATE PARSER
# ============================================================================
class TestFuzzCertificateParser:
    """Fuzz testing SafeCertParser against mutated DER, PEM, and chain encodings."""

    def test_fuzz_der_and_pem_bytes(self, mutator, assertion):
        for _ in range(15):
            garbage = mutator.mutate_bytes(b"\x30\x82\x02\x00\x02\x01\x00", num_mutations=4)
            success, res, exc = assertion.execute_safely(
                SafeCertParser.parse_bytes,
                garbage,
                format="auto",
                allowed_exceptions=(CertParsingError, CertSecurityError),
            )
            assert success is True or exc is not None

    def test_certificate_secret_canary_rejection_no_leak(self, assertion):
        """Feeding private keys into certificate parser must reject cleanly without leaking key."""
        canary = assertion.canary_secrets[0]
        fake_private_key = (
            f"-----BEGIN RSA PRIVATE KEY-----\n"
            f"{canary}\n"
            f"MIIEowIBAAKCAQEA0canaryfakekeydata==\n"
            f"-----END RSA PRIVATE KEY-----\n"
        ).encode("utf-8")

        with pytest.raises(CertSecurityError) as exc_info:
            SafeCertParser.parse_bytes(fake_private_key)

        # Confirm the exception did NOT echo the canary private key
        assertion.assert_no_secret_leak(str(exc_info.value))

    def test_certificate_oversized_payload_rejection(self, assertion):
        """Oversized payloads (> 10MB) must be rejected immediately to avoid unbounded memory."""
        huge_payload = b"A" * (11 * 1024 * 1024)
        with pytest.raises(CertSecurityError):
            SafeCertParser.parse_bytes(huge_payload)


# ============================================================================
# TARGET 4: PCAP PARSER
# ============================================================================
class TestFuzzPcapParser:
    """Fuzz testing SafePcapParser on corrupted PCAP byte streams and packets."""

    def _make_minimal_pcap(self) -> bytes:
        magic = 0xA1B2C3D4
        hdr = struct.pack("<IHHiIII", magic, 2, 4, 0, 0, 65535, LINKTYPE_ETHERNET)
        pkt_data = b"\x00" * 54  # Ethernet + IP + TCP stub
        pkt_hdr = struct.pack("<IIII", int(time.time()), 0, len(pkt_data), len(pkt_data))
        return hdr + pkt_hdr + pkt_data

    def test_fuzz_pcap_buffers(self, mutator, assertion):
        parser = SafePcapParser(max_size_bytes=5 * 1024 * 1024, max_packet_count=50, max_time_seconds=1.0)
        base_pcap = self._make_minimal_pcap()

        for _ in range(15):
            mutated_pcap = mutator.mutate_bytes(base_pcap, num_mutations=4)
            success, res, exc = assertion.execute_safely(
                parser.parse_bytes,
                mutated_pcap,
                allowed_exceptions=(PcapSecurityError, PcapSizeLimitError, PcapTimeoutError),
            )
            assert success is True or exc is not None

    def test_pcap_secret_in_banner_redacted_safely(self, assertion):
        """SSH banners containing secrets must be sanitized in findings and diagnostics."""
        parser = SafePcapParser()
        canary = assertion.canary_secrets[1]
        raw_banner = f"SSH-2.0-OpenSSH_9.0 {canary}\n".encode("utf-8")

        # Directly invoke banner parser
        parser._parse_ssh_banner(raw_banner, "1.2.3.4:22", "5.6.7.8:54321", pkt_idx=1)
        assert len(parser.findings) == 1
        finding = parser.findings[0]

        # The banner must not leak the canary
        assertion.assert_no_secret_leak(str(finding.details))
        assert "[REDACTED_BANNER_SECRET]" in finding.details["banner"]


# ============================================================================
# TARGET 5: CBOM PARSER
# ============================================================================
class TestFuzzCbomParser:
    """Fuzz testing CBOM ingestion for prototype pollution, XML bombs, and corrupted structures."""

    def test_cbom_fuzz_json_payloads(self, mutator, assertion):
        base_cbom = {
            "bomFormat": "CycloneDX",
            "specVersion": "1.7",
            "serialNumber": "urn:uuid:3e671687-395b-41f5-a30f-a58921a69b79",
            "version": 1,
            "components": [
                {
                    "type": "cryptographic-asset",
                    "name": "AES-256-GCM",
                    "bom-ref": "crypto:algo/aes-256",
                    "cryptoProperties": {
                        "assetType": "algorithm",
                        "algorithmProperties": {
                            "parameterSetIdentifier": "256",
                            "cryptoFunctions": ["encrypt", "decrypt"],
                        },
                    },
                }
            ],
        }
        base_json = json.dumps(base_cbom)

        for _ in range(15):
            mutated = mutator.mutate_string(base_json, num_mutations=3)
            success, res, exc = assertion.execute_safely(
                import_cbom,
                mutated,
                allowed_exceptions=(ValueError, TypeError, json.JSONDecodeError),
            )
            assert success is True or exc is not None

    def test_cbom_prototype_pollution_blocked(self):
        malicious_cbom = '{"bomFormat": "CycloneDX", "__proto__": {"polluted": true}, "components": []}'
        with pytest.raises(ValueError) as exc:
            import_cbom(malicious_cbom)
        assert "prototype pollution" in str(exc.value).lower()

    def test_cbom_xml_entity_expansion_bomb_blocked(self):
        xml_bomb = (
            '<?xml version="1.0"?>'
            "<!DOCTYPE bom ["
            '<!ENTITY lol "lol">'
            '<!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">'
            "]>"
            "<bom><components>&lol2;</components></bom>"
        )
        with pytest.raises(ValueError) as exc:
            import_cbom(xml_bomb, format="xml")
        assert "entity expansion" in str(exc.value).lower() or "doctype" in str(exc.value).lower()

    def test_cbom_private_key_material_rejected_no_leak(self, assertion):
        canary = assertion.canary_secrets[0]
        cbom_with_key = json.dumps(
            {
                "bomFormat": "CycloneDX",
                "specVersion": "1.7",
                "components": [
                    {
                        "name": "RSA-Key",
                        "properties": [{"name": "private_key", "value": f"-----BEGIN RSA PRIVATE KEY-----\n{canary}"}],
                    }
                ],
            }
        )

        with pytest.raises(ValueError) as exc:
            import_cbom(cbom_with_key)
        assertion.assert_no_secret_leak(str(exc.value))


# ============================================================================
# TARGET 6: BINARY PARSER
# ============================================================================
class TestFuzzBinaryParsers:
    """Fuzz testing SafeElfParser, SafePeParser, SafeMachoParser, and LibraryFingerprinter."""

    def test_fuzz_elf_parser(self, mutator, assertion):
        parser = SafeElfParser()
        base_elf = b"\x7fELF\x02\x01\x01\x00" + b"\x00" * 56

        for _ in range(15):
            fuzzed = mutator.mutate_bytes(base_elf, num_mutations=4)
            success, res, exc = assertion.execute_safely(
                parser.parse,
                fuzzed,
                "fuzzed.elf",
                allowed_exceptions=(ValueError, struct.error),
            )
            assert success is True or exc is not None

    def test_fuzz_pe_parser(self, mutator, assertion):
        parser = SafePeParser()
        base_pe = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00" + b"\x00" * 128

        for _ in range(15):
            fuzzed = mutator.mutate_bytes(base_pe, num_mutations=4)
            success, res, exc = assertion.execute_safely(
                parser.parse,
                fuzzed,
                "fuzzed.exe",
                allowed_exceptions=(ValueError, struct.error),
            )
            assert success is True or exc is not None

    def test_fuzz_macho_parser(self, mutator, assertion):
        parser = SafeMachoParser()
        base_macho = struct.pack("<IIIIIIII", 0xFEEDFACF, 0x01000007, 3, 2, 1, 64, 0, 0) + b"\x00" * 128

        for _ in range(15):
            fuzzed = mutator.mutate_bytes(base_macho, num_mutations=4)
            success, res, exc = assertion.execute_safely(
                parser.parse,
                fuzzed,
                "fuzzed.dylib",
                allowed_exceptions=(ValueError, struct.error),
            )
            assert success is True or exc is not None

    def test_fuzz_library_fingerprinter(self, mutator, assertion):
        fingerprinter = LibraryFingerprinter()

        for _ in range(10):
            noisy_symbols = [
                SymbolMetadata(name=mutator.mutate_string("crypto_func"), is_imported=True),
                SymbolMetadata(name=mutator.mutate_string("EVP_CIPHER"), is_imported=False),
            ]
            noisy_strings = [mutator.mutate_string("OpenSSL 3.0"), mutator.mutate_string("WolfSSL")]

            success, matches, exc = assertion.execute_safely(
                fingerprinter.fingerprint,
                imported_libraries=["libcrypto.so.3"],
                symbols=noisy_symbols,
                strings=noisy_strings,
            )
            assert success is True
            assert isinstance(matches, list)


# ============================================================================
# TARGET 7: POLICY PARSER
# ============================================================================
class TestFuzzPolicyParser:
    """Fuzz testing PolicyEngine and PolicySecurityController."""

    def test_fuzz_policy_engine(self, mutator, assertion):
        engine = PolicyEngine()
        valid_policy = {
            "version": "1.0",
            "id": "fuzz-policy",
            "name": "Fuzz Test Policy",
            "rules": [
                {
                    "rule_id": "rule_01",
                    "action": "BLOCK",
                    "algorithms": ["MD5", "DES"],
                    "reason": "Cryptographically broken",
                }
            ],
        }
        valid_json = json.dumps(valid_policy)

        for _ in range(15):
            mutated_json = mutator.mutate_string(valid_json, num_mutations=3)
            success, res, exc = assertion.execute_safely(
                engine.load_policy,
                mutated_json,
                allowed_exceptions=(PolicyValidationError, json.JSONDecodeError, ValueError),
            )
            assert success is True or exc is not None

    def test_policy_engine_redos_regex_safety(self, assertion):
        """Adversarial ReDoS patterns in algorithm rules must not hang the policy evaluator."""
        engine = PolicyEngine()
        redos_pattern = "(a+)+$"
        policy = {
            "version": "1.0.0",
            "id": "redos-policy",
            "name": "ReDoS Test Policy",
            "rules": [
                {
                    "id": "rule_redos",
                    "name": "ReDoS Rule",
                    "category": "algorithm",
                    "action": "BLOCK",
                    "algorithms": {"prohibited": [redos_pattern]},
                }
            ],
        }
        engine.load_policy(policy)

        # Evaluate against pathological input
        pathological_input = "a" * 25 + "!"
        finding = {"algorithm": pathological_input}

        # Must evaluate within watchdog time budget without CPU lockup
        success, decision, exc = assertion.execute_safely(
            engine.evaluate,
            [finding],
        )
        assert success is True
        assert decision is not None

    def test_policy_governance_secret_canary_not_leaked(self, assertion):
        """Governance exception rules containing secret tokens must not leak in error or ledger."""
        controller = PolicySecurityController()
        canary = assertion.canary_secrets[2]

        tampered_version = {
            "version": "1.0.0",
            "id": "gov-test-policy",
            "name": "Secret Governance Test",
            "rules": [
                {
                    "id": "rule_canary",
                    "name": "Canary Rule",
                    "category": "algorithm",
                    "action": "BLOCK",
                    "algorithms": {"prohibited": [f"CANARY_ALGO_{canary}"]},
                }
            ],
        }

        # Create draft policy with canary
        author_admin = {"role": "admin", "username": "sec_lead"}
        draft = controller.create_draft(tampered_version, author=author_admin)
        assert draft is not None

        # Verify audit trail does not leak raw canary in error fields or summaries
        audit_records = controller.audit_log
        for record in audit_records:
            details_str = str(record.get("details", ""))
            # Ensure no secret in details error messages
            if "error" in record.get("details", {}):
                assertion.assert_no_secret_leak(details_str)
