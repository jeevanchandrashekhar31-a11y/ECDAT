"""
ECDAT Binary Parser Architecture Package
Safe, static metadata analysis for ELF, PE, and Mach-O binaries with worker isolation.
"""

from .base import (
    BinaryFormat,
    Endianness,
    SectionMetadata,
    SymbolMetadata,
    CertificateMetadata,
    CryptoIndicator,
    ParserOptions,
    BinaryMetadata,
)
from .elf_parser import SafeElfParser
from .pe_parser import SafePeParser
from .macho_parser import SafeMachoParser
from .string_scanner import extract_bounded_strings, calculate_entropy
from .crypto_detector import detect_crypto_indicators, KNOWN_CRYPTO_LIBRARIES
from .library_fingerprinter import LibraryFingerprinter, FingerprintEvidence
from .worker_pool import WorkerIsolatedBinaryAnalyzer

# Convenient top-level analyzer function
def analyze_binary(
    file_path: str,
    options: ParserOptions = None,
    worker_isolation: bool = True,
) -> BinaryMetadata:
    """
    Safely analyzes an ELF, PE, or Mach-O binary.
    Extracts metadata, sections, symbols, imports, certificates, and crypto indicators.
    Never executes the binary.
    Enforces worker process isolation by default.
    """
    options = options or ParserOptions()
    options.worker_isolation = worker_isolation
    analyzer = WorkerIsolatedBinaryAnalyzer(default_timeout=options.timeout_seconds)
    return analyzer.analyze(file_path, options=options)


__all__ = [
    "BinaryFormat",
    "Endianness",
    "SectionMetadata",
    "SymbolMetadata",
    "CertificateMetadata",
    "CryptoIndicator",
    "ParserOptions",
    "BinaryMetadata",
    "SafeElfParser",
    "SafePeParser",
    "SafeMachoParser",
    "extract_bounded_strings",
    "calculate_entropy",
    "detect_crypto_indicators",
    "KNOWN_CRYPTO_LIBRARIES",
    "LibraryFingerprinter",
    "FingerprintEvidence",
    "WorkerIsolatedBinaryAnalyzer",
    "analyze_binary",
]
