"""
Phase 22.1 — Parser Resilience and Integrity Test Suite

Verifies that all security-sensitive parsers (AST, Binary, Network, Container)
behave predictably, preserve structural fidelity, recover from malformed inputs,
and never suffer unhandled crashes or uncontrolled recursion.
"""

import os
import tempfile
from pathlib import Path
import pytest

from scanners.static.ast.adapters import get_default_adapter_registry
from scanners.binary_container.parsers import (
    SafeElfParser,
    SafePeParser,
    SafeMachoParser,
)
from scanners.binary_container.parsers.library_fingerprinter import LibraryFingerprinter
from scanners.network.pcap_parser import SafePcapParser


class TestAstParserResilience:
    """Validates AST parser robustness across all 9 supported languages."""

    registry = get_default_adapter_registry()

    @pytest.mark.parametrize(
        "language,ext",
        [
            ("python", ".py"),
            ("javascript", ".js"),
            ("typescript", ".ts"),
            ("c", ".c"),
            ("cpp", ".cpp"),
            ("go", ".go"),
            ("java", ".java"),
            ("kotlin", ".kt"),
            ("csharp", ".cs"),
            ("rust", ".rs"),
        ],
    )
    def test_parser_handles_empty_file(self, language, ext):
        adapter = self.registry.get_by_extension(ext)
        assert adapter is not None, f"Adapter for {language} ({ext}) must exist"

        findings = adapter.extract_findings(b"", Path(f"empty{ext}"), Path("."))
        assert findings == [], f"Empty file in {language} must produce 0 findings"

    @pytest.mark.parametrize(
        "language,ext,malformed_code",
        [
            ("python", ".py", "def broken(\n  # missing close and body\nfor x in"),
            ("javascript", ".js", "function syntaxError( { return ;;; const = {"),
            ("typescript", ".ts", "interface <T> { type = ::::"),
            ("c", ".c", "int main( { void* p = &&;;"),
            ("cpp", ".cpp", "template<typename class struct void >>>"),
            ("go", ".go", "package main \n func (((( {"),
            ("java", ".java", "public class { private static void (("),
            ("kotlin", ".kt", "fun broken(:: String = {"),
            ("csharp", ".cs", "namespace Broken { class { void Main("),
            ("rust", ".rs", "fn broken( -> { let mut x: & = =;"),
        ],
    )
    def test_parser_survives_severe_syntax_errors(self, language, ext, malformed_code):
        adapter = self.registry.get_by_extension(ext)
        assert adapter is not None
        findings = adapter.extract_findings(malformed_code.encode("utf-8"), Path(f"malformed{ext}"), Path("."))
        assert isinstance(findings, list), "Must return a list even when code is syntax-corrupted"

    def test_ast_deeply_nested_expressions_do_not_exhaust_stack(self):
        """Tests that deeply nested call expressions f(f(f(...))) terminate safely."""
        depth = 300
        nested_py = "crypto.hash(" * depth + "'data'" + ")" * depth
        adapter = self.registry.get_by_extension(".py")
        findings = adapter.extract_findings(nested_py.encode("utf-8"), Path("deep_nest.py"), Path("."))
        assert isinstance(findings, list)

    def test_ast_giant_literal_and_null_bytes_handled_safely(self):
        # Giant literal preceding a cryptographic call
        giant_code = "x = '" + "A" * 20000 + "'\nimport hashlib\nh = hashlib.md5(b'test').hexdigest()\n"
        adapter = self.registry.get_by_extension(".py")
        findings = adapter.extract_findings(giant_code.encode("utf-8"), Path("test_giant.py"), Path("."))
        assert len(findings) >= 1
        assert any(f.algorithm == "MD5" for f in findings)
        md5_finding = next(f for f in findings if f.algorithm == "MD5")
        assert md5_finding.line_number == 3

        # Null bytes in stream must survive without crash or unhandled exception
        code_with_nulls = b"import hashlib\x00\x01\x02# comment\nh = hashlib.md5(b'test').hexdigest()\n"
        findings_null = adapter.extract_findings(code_with_nulls, Path("test_nulls.py"), Path("."))
        assert isinstance(findings_null, list)

    def test_unicode_obfuscation_and_homoglyphs(self):
        """Identifiers with homoglyphs or bidirectional controls must not break the parser."""
        tricky_code = (
            "# \u202e RLO override comment\n"
            "import hashlib\n"
            "def test():\n"
            "    cipher = hashlib.sha1()\n"
            "    return cipher\n"
        )
        adapter = self.registry.get_by_extension(".py")
        findings = adapter.extract_findings(tricky_code.encode("utf-8"), Path("homoglyph.py"), Path("."))
        assert len(findings) >= 1
        assert any(f.algorithm == "SHA-1" or "SHA1" in f.algorithm for f in findings)


class TestBinaryParserResilience:
    """Validates ELF, PE, and Mach-O parsers against truncated and corrupt binary formats."""

    def test_elf_parser_corrupted_header_handling(self):
        parser = SafeElfParser()
        assert parser.is_elf(b"NOT_AN_ELF_BINARY_HEADER") is False

        truncated_elf = b"\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00"
        try:
            meta = parser.parse(truncated_elf, "truncated.so")
            assert meta is not None
        except Exception as e:
            # Must raise handled error, not native crash
            assert "ELF" in str(e) or "header" in str(e) or "truncated" in str(e) or "corrupt" in str(e)

    def test_pe_parser_corrupted_dos_and_nt_header(self):
        parser = SafePeParser()
        assert parser.is_pe(b"RANDOM_NON_PE_DATA_STRING") is False

        mz_truncated = b"MZ" + b"\x00" * 58 + b"\xff\xff\xff\x7f"
        try:
            meta = parser.parse(mz_truncated, "overflow.dll")
            assert meta is not None
        except Exception as e:
            assert "PE" in str(e) or "header" in str(e) or "offset" in str(e) or "bounds" in str(e)

    def test_macho_parser_corrupted_load_commands(self):
        parser = SafeMachoParser()
        assert parser.is_macho(b"\xde\xad\xbe\xef\x00\x00\x00\x00") is False

        macho_truncated = b"\xcf\xfa\xed\xfe\x07\x00\x00\x01\x03\x00\x00\x00\x02\x00\x00\x00\x10\x27\x00\x00"
        try:
            meta = parser.parse(macho_truncated, "truncated.dylib")
            assert meta is not None
        except Exception as e:
            assert "Mach-O" in str(e) or "header" in str(e) or "load command" in str(e) or "bounds" in str(e)

    def test_library_fingerprinter_with_corrupt_symbols(self):
        from scanners.binary_container.parsers.base import SymbolMetadata

        fingerprinter = LibraryFingerprinter()
        corrupt_symbols = [
            SymbolMetadata(name="", is_imported=True, symbol_type="function", binding="global"),
            SymbolMetadata(name="A" * 10000, is_imported=True, symbol_type="function", binding="global"),
            SymbolMetadata(name="\x00\x01\x02", is_imported=True, symbol_type="function", binding="global"),
            SymbolMetadata(name="AES_encrypt", is_imported=True, symbol_type="function", binding="global"),
            SymbolMetadata(name="EVP_CIPHER_CTX_new", is_imported=True, symbol_type="function", binding="global"),
        ]
        matches = fingerprinter.fingerprint(
            imported_libraries=["libcrypto.so.3"],
            symbols=corrupt_symbols,
            strings=["OpenSSL 3.0.8", "junk\x00data" * 100],
        )
        assert isinstance(matches, list)
        assert any(m.library_name == "OpenSSL" for m in matches)


class TestNetworkParserResilience:
    """Validates X.509 Certificate and PCAP parser bounds and error handling."""

    def test_x509_parser_handles_corrupt_der_and_pem(self):
        import cryptography.x509

        corrupt_pem = b"-----BEGIN CERTIFICATE-----\nNOT_BASE_64_DATA!!!\n-----END CERTIFICATE-----"
        with pytest.raises(Exception):
            cryptography.x509.load_pem_x509_certificate(corrupt_pem)

        garbage_der = b"\x30\x82\xff\xff\x00\x01\x02\x03\x04"
        with pytest.raises(Exception):
            cryptography.x509.load_der_x509_certificate(garbage_der)

    def test_pcap_parser_rejects_truncated_global_header(self):
        with tempfile.NamedTemporaryFile(suffix=".pcap", delete=False) as tf:
            tf.write(b"\xd4\xc3\xb2\xa1\x02\x04")
            tf.flush()
            temp_path = tf.name

        try:
            parser = SafePcapParser()
            with pytest.raises(Exception):
                parser.parse_file(temp_path)
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
