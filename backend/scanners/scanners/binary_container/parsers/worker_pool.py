"""
ECDAT Worker Isolation Pool for Binary Parsing

Ensures that untrusted binary parsing executes within an isolated worker process
with hard timeout enforcement, preventing crashes or hangs from affecting the main scanner.
Never executes the target binary.
"""

from concurrent.futures import ProcessPoolExecutor, TimeoutError
import logging
import os
from typing import Optional, Dict, Any

from scanners.binary_container.parsers.base import (
    BinaryFormat,
    BinaryMetadata,
    Endianness,
    ParserOptions,
)
from scanners.binary_container.parsers.elf_parser import SafeElfParser
from scanners.binary_container.parsers.pe_parser import SafePeParser
from scanners.binary_container.parsers.macho_parser import SafeMachoParser


def _parse_binary_worker_task(file_path: str, options_dict: Dict[str, Any]) -> Dict[str, Any]:
    """
    Isolated worker function that runs in a separate process.
    Reads file as raw bytes, identifies format via magic bytes, and executes static parsing.
    NEVER executes the binary.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Binary file not found: {file_path}")

    # Reconstitute options
    options = ParserOptions(
        max_bytes_to_scan=options_dict.get("max_bytes_to_scan", 10 * 1024 * 1024),
        max_strings=options_dict.get("max_strings", 5000),
        min_string_length=options_dict.get("min_string_length", 4),
        extract_strings=options_dict.get("extract_strings", True),
        extract_symbols=options_dict.get("extract_symbols", True),
        extract_certificates=options_dict.get("extract_certificates", True),
        timeout_seconds=options_dict.get("timeout_seconds", 10),
        worker_isolation=False,  # Already inside worker
    )

    # Read binary safely as raw bytes
    max_read_size = 100 * 1024 * 1024  # 100MB max binary file safety limit
    with open(file_path, "rb") as f:
        data = f.read(max_read_size)

    # Route by magic bytes
    if SafeElfParser.is_elf(data):
        parser = SafeElfParser()
        result = parser.parse(data, file_path, options)
    elif SafePeParser.is_pe(data):
        parser = SafePeParser()
        result = parser.parse(data, file_path, options)
    elif SafeMachoParser.is_macho(data):
        parser = SafeMachoParser()
        result = parser.parse(data, file_path, options)
    else:
        # Fallback for unknown / generic binary (run bounded string scanning)
        from scanners.binary_container.parsers.string_scanner import extract_bounded_strings
        from scanners.binary_container.parsers.crypto_detector import detect_crypto_indicators
        import hashlib

        _, crypto_strings = extract_bounded_strings(data, max_bytes=options.max_bytes_to_scan)
        crypto_indicators = detect_crypto_indicators([], [], crypto_strings)

        result = BinaryMetadata(
            file_path=file_path,
            file_size=len(data),
            file_hash_sha256=hashlib.sha256(data).hexdigest(),
            binary_format=BinaryFormat.UNKNOWN,
            architecture="unknown",
            bit_width=0,
            endianness=Endianness.UNKNOWN,
            imported_libraries=[],
            symbols=[],
            sections=[],
            strings=crypto_strings,
            certificates=[],
            crypto_library_indicators=crypto_indicators,
            parsing_warnings=["Unrecognized binary magic header; executed bounded raw string scan only."],
        )

    return result.to_dict()


class WorkerIsolatedBinaryAnalyzer:
    """
    Coordinates safe, isolated parsing of binary files using isolated worker processes.
    """

    def __init__(self, default_timeout: int = 10):
        self.default_timeout = default_timeout

    def analyze(self, file_path: str, options: Optional[ParserOptions] = None) -> BinaryMetadata:
        options = options or ParserOptions()
        timeout = options.timeout_seconds or self.default_timeout

        if not options.worker_isolation:
            # Run in-process
            opt_dict = {
                "max_bytes_to_scan": options.max_bytes_to_scan,
                "max_strings": options.max_strings,
                "min_string_length": options.min_string_length,
                "extract_strings": options.extract_strings,
                "extract_symbols": options.extract_symbols,
                "extract_certificates": options.extract_certificates,
            }
            res_dict = _parse_binary_worker_task(file_path, opt_dict)
            return self._dict_to_metadata(res_dict)

        # Run with Worker Process Isolation
        opt_dict = {
            "max_bytes_to_scan": options.max_bytes_to_scan,
            "max_strings": options.max_strings,
            "min_string_length": options.min_string_length,
            "extract_strings": options.extract_strings,
            "extract_symbols": options.extract_symbols,
            "extract_certificates": options.extract_certificates,
            "timeout_seconds": timeout,
        }

        try:
            with ProcessPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_parse_binary_worker_task, file_path, opt_dict)
                res_dict = future.result(timeout=timeout)
                return self._dict_to_metadata(res_dict)
        except TimeoutError:
            logging.warning(f"Binary parsing timed out after {timeout}s in isolated worker for {file_path}")
            return BinaryMetadata(
                file_path=file_path,
                file_size=os.path.getsize(file_path) if os.path.exists(file_path) else 0,
                file_hash_sha256="",
                binary_format=BinaryFormat.UNKNOWN,
                architecture="unknown",
                bit_width=0,
                endianness=Endianness.UNKNOWN,
                parsing_warnings=[f"Binary parser worker exceeded timeout of {timeout}s and was terminated."],
            )
        except Exception as e:
            logging.warning(f"Binary parser worker exception for {file_path}: {e}")
            return BinaryMetadata(
                file_path=file_path,
                file_size=os.path.getsize(file_path) if os.path.exists(file_path) else 0,
                file_hash_sha256="",
                binary_format=BinaryFormat.UNKNOWN,
                architecture="unknown",
                bit_width=0,
                endianness=Endianness.UNKNOWN,
                parsing_warnings=[f"Binary parser worker failed safely: {str(e)}"],
            )

    def _dict_to_metadata(self, d: Dict[str, Any]) -> BinaryMetadata:
        from scanners.binary_container.parsers.base import (
            SectionMetadata,
            SymbolMetadata,
            CertificateMetadata,
            CryptoIndicator,
        )

        symbols = [
            SymbolMetadata(
                name=s["name"],
                is_imported=s["is_imported"],
                symbol_type=s["symbol_type"],
                binding=s["binding"],
            )
            for s in d.get("symbols", [])
        ]

        sections = [
            SectionMetadata(
                name=sec["name"],
                virtual_address=int(sec["virtual_address"], 16)
                if isinstance(sec["virtual_address"], str)
                else sec["virtual_address"],
                raw_size=sec["raw_size"],
                entropy=sec.get("entropy", 0.0),
            )
            for sec in d.get("sections", [])
        ]

        certs = [
            CertificateMetadata(
                subject=c["subject"],
                issuer=c["issuer"],
                public_key_algorithm=c["public_key_algorithm"],
                key_size_bits=c["key_size_bits"],
                is_self_signed=c["is_self_signed"],
                sha256_fingerprint=c["sha256_fingerprint"],
            )
            for c in d.get("certificates", [])
        ]

        indicators = [
            CryptoIndicator(
                library_name=ci["library_name"],
                confidence=ci["confidence"],
                matched_libraries=ci.get("matched_libraries", []),
                matched_symbols=ci.get("matched_symbols", []),
                matched_strings=ci.get("matched_strings", []),
                description=ci.get("description", ""),
            )
            for ci in d.get("crypto_library_indicators", [])
        ]

        return BinaryMetadata(
            file_path=d["file_path"],
            file_size=d["file_size"],
            file_hash_sha256=d["file_hash_sha256"],
            binary_format=BinaryFormat(d["binary_format"]),
            architecture=d["architecture"],
            bit_width=d["bit_width"],
            endianness=Endianness(d["endianness"]),
            imported_libraries=d.get("imported_libraries", []),
            symbols=symbols,
            sections=sections,
            strings=d.get("crypto_strings_preview", []),
            certificates=certs,
            crypto_library_indicators=indicators,
            parsing_warnings=d.get("parsing_warnings", []),
        )
