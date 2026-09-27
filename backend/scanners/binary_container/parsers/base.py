"""
ECDAT Binary Parser Architecture — Base Contracts & Metadata Models
"""

from dataclasses import dataclass, field
from enum import Enum
import hashlib
from typing import Any, Dict, List, Optional


class BinaryFormat(str, Enum):
    ELF = "ELF"
    PE = "PE"
    MACHO = "Mach-O"
    FAT_MACHO = "FAT_Mach-O"
    UNKNOWN = "UNKNOWN"


class Endianness(str, Enum):
    LITTLE = "little"
    BIG = "big"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class SectionMetadata:
    name: str
    virtual_address: int
    raw_size: int
    virtual_size: int = 0
    raw_offset: int = 0
    flags: int = 0
    entropy: float = 0.0


@dataclass(frozen=True)
class SymbolMetadata:
    name: str
    is_imported: bool = True
    symbol_type: str = "function"  # function, object, notype, unknown
    binding: str = "global"  # global, weak, local
    section_index: int = 0


@dataclass(frozen=True)
class CertificateMetadata:
    subject: str
    issuer: str
    serial_number: Optional[str] = None
    public_key_algorithm: str = "RSA"
    key_size_bits: Optional[int] = None
    not_before: Optional[str] = None
    not_after: Optional[str] = None
    is_self_signed: bool = False
    sha256_fingerprint: Optional[str] = None


@dataclass(frozen=True)
class CryptoIndicator:
    library_name: str
    confidence: str  # high, medium, low
    matched_libraries: List[str] = field(default_factory=list)
    matched_symbols: List[str] = field(default_factory=list)
    matched_strings: List[str] = field(default_factory=list)
    description: str = ""


@dataclass
class ParserOptions:
    max_bytes_to_scan: int = 10 * 1024 * 1024  # 10MB
    max_strings: int = 5000
    min_string_length: int = 4
    extract_strings: bool = True
    extract_symbols: bool = True
    extract_certificates: bool = True
    timeout_seconds: int = 10
    worker_isolation: bool = True


@dataclass
class BinaryMetadata:
    file_path: str
    file_size: int
    file_hash_sha256: str
    binary_format: BinaryFormat
    architecture: str
    bit_width: int  # 32 or 64
    endianness: Endianness
    imported_libraries: List[str] = field(default_factory=list)
    symbols: List[SymbolMetadata] = field(default_factory=list)
    sections: List[SectionMetadata] = field(default_factory=list)
    strings: List[str] = field(default_factory=list)
    certificates: List[CertificateMetadata] = field(default_factory=list)
    crypto_library_indicators: List[CryptoIndicator] = field(default_factory=list)
    parsing_warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "file_path": self.file_path,
            "file_size": self.file_size,
            "file_hash_sha256": self.file_hash_sha256,
            "binary_format": self.binary_format.value,
            "architecture": self.architecture,
            "bit_width": self.bit_width,
            "endianness": self.endianness.value,
            "imported_libraries": self.imported_libraries,
            "symbols_count": len(self.symbols),
            "symbols": [
                {
                    "name": s.name,
                    "is_imported": s.is_imported,
                    "symbol_type": s.symbol_type,
                    "binding": s.binding,
                }
                for s in self.symbols[:200]  # bounded preview in dict
            ],
            "sections": [
                {
                    "name": sec.name,
                    "virtual_address": hex(sec.virtual_address),
                    "raw_size": sec.raw_size,
                    "entropy": round(sec.entropy, 2),
                }
                for sec in self.sections
            ],
            "strings_count": len(self.strings),
            "crypto_strings_preview": self.strings[:100],
            "certificates": [
                {
                    "subject": c.subject,
                    "issuer": c.issuer,
                    "public_key_algorithm": c.public_key_algorithm,
                    "key_size_bits": c.key_size_bits,
                    "is_self_signed": c.is_self_signed,
                    "sha256_fingerprint": c.sha256_fingerprint,
                }
                for c in self.certificates
            ],
            "crypto_library_indicators": [
                {
                    "library_name": ci.library_name,
                    "confidence": ci.confidence,
                    "matched_libraries": ci.matched_libraries,
                    "matched_symbols": ci.matched_symbols[:20],
                    "matched_strings": ci.matched_strings[:20],
                    "description": ci.description,
                }
                for ci in self.crypto_library_indicators
            ],
            "parsing_warnings": self.parsing_warnings,
        }
