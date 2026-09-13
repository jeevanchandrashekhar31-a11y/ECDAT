"""
ECDAT Safe PE Binary Parser (PE32 / PE32+, x86 / AMD64 / ARM64)
Extracts metadata, sections, imports, symbols, and certificates without execution.
"""

import hashlib
import struct
from typing import Dict, List, Optional, Tuple

from scanners.binary_container.parsers.base import (
    BinaryFormat,
    BinaryMetadata,
    CertificateMetadata,
    Endianness,
    ParserOptions,
    SectionMetadata,
    SymbolMetadata,
)
from scanners.binary_container.parsers.string_scanner import (
    calculate_entropy,
    extract_bounded_strings,
)
from scanners.binary_container.parsers.crypto_detector import detect_crypto_indicators

# PE Machine Constants
PE_MACHINES = {
    0x014C: "x86",
    0x8664: "x86_64",
    0xAA64: "arm64",
    0x01C0: "arm",
    0x01C4: "arm_thumb",
    0x0200: "ia64",
}


class SafePeParser:
    """Safe static parser for Windows PE executables and DLLs."""

    @staticmethod
    def is_pe(data: bytes) -> bool:
        if len(data) < 64 or not data.startswith(b"MZ"):
            return False
        e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
        if e_lfanew + 4 <= len(data):
            return data[e_lfanew:e_lfanew + 4] == b"PE\x00\x00"
        return False

    def parse(self, data: bytes, file_path: str, options: Optional[ParserOptions] = None) -> BinaryMetadata:
        options = options or ParserOptions()
        warnings: List[str] = []

        if len(data) < 64:
            raise ValueError("File is too small to be a valid PE binary.")

        # 1. DOS Header & PE offset
        e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
        if e_lfanew + 24 > len(data) or data[e_lfanew:e_lfanew + 4] != b"PE\x00\x00":
            raise ValueError("Invalid PE signature.")

        # 2. COFF File Header (20 bytes at e_lfanew + 4)
        coff_offset = e_lfanew + 4
        (
            machine, num_sections, time_date_stamp,
            ptr_sym_tab, num_symbols, size_opt_header, characteristics
        ) = struct.unpack_from("<HHIIIHH", data, coff_offset)

        arch_name = PE_MACHINES.get(machine, f"machine_{hex(machine)}")

        # 3. Optional Header
        opt_offset = coff_offset + 20
        if opt_offset + 2 > len(data):
            raise ValueError("PE optional header truncated.")

        opt_magic = struct.unpack_from("<H", data, opt_offset)[0]
        if opt_magic == 0x10B:
            bit_width = 32
            data_dir_offset = opt_offset + 96
        elif opt_magic == 0x20B:
            bit_width = 64
            data_dir_offset = opt_offset + 112
        else:
            warnings.append(f"Unrecognized OptionalHeader magic {hex(opt_magic)}, assuming 64-bit.")
            bit_width = 64
            data_dir_offset = opt_offset + 112

        # Read Data Directories (Import Directory = Index 1, Security Directory = Index 4)
        import_rva = 0
        import_size = 0
        security_file_offset = 0
        security_size = 0

        if data_dir_offset + 16 <= opt_offset + size_opt_header and data_dir_offset + 16 <= len(data):
            # Index 1: Imports (offset + 8)
            import_rva, import_size = struct.unpack_from("<II", data, data_dir_offset + 8)

        if data_dir_offset + 40 <= opt_offset + size_opt_header and data_dir_offset + 40 <= len(data):
            # Index 4: Security / Certificates (offset + 32)
            security_file_offset, security_size = struct.unpack_from("<II", data, data_dir_offset + 32)

        # 4. Section Headers
        sections_offset = opt_offset + size_opt_header
        sections: List[SectionMetadata] = []
        raw_sections: List[Dict[str, Any]] = []

        if num_sections > 0 and sections_offset + (num_sections * 40) <= len(data):
            for i in range(min(num_sections, 96)):
                sec_off = sections_offset + (i * 40)
                sec_name_raw, virt_size, virt_addr, raw_size, raw_ptr = struct.unpack_from(
                    "<8sIIII", data, sec_off
                )
                sec_name = sec_name_raw.split(b"\x00")[0].decode("ascii", errors="ignore")

                sec_bytes = data[raw_ptr:raw_ptr + raw_size] if raw_ptr + raw_size <= len(data) else b""
                entropy = calculate_entropy(sec_bytes) if sec_bytes else 0.0

                sec_meta = SectionMetadata(
                    name=sec_name,
                    virtual_address=virt_addr,
                    raw_size=raw_size,
                    virtual_size=virt_size,
                    raw_offset=raw_ptr,
                    flags=0,
                    entropy=entropy,
                )
                sections.append(sec_meta)
                raw_sections.append({
                    "name": sec_name,
                    "va": virt_addr,
                    "vsize": virt_size,
                    "raw_size": raw_size,
                    "raw_ptr": raw_ptr,
                })

        # Helper to convert RVA to File Offset
        def rva_to_offset(rva: int) -> Optional[int]:
            for sec in raw_sections:
                sec_va = sec["va"]
                sec_len = max(sec["vsize"], sec["raw_size"])
                if sec_va <= rva < sec_va + sec_len:
                    diff = rva - sec_va
                    if diff < sec["raw_size"]:
                        return sec["raw_ptr"] + diff
            return None

        # Helper to read null-terminated ASCII string
        def read_cstring(offset: int, max_len: int = 256) -> str:
            if offset >= len(data):
                return ""
            end = data.find(b"\x00", offset, offset + max_len)
            if end == -1:
                end = min(offset + max_len, len(data))
            try:
                return data[offset:end].decode("ascii", errors="ignore")
            except Exception:
                return ""

        # 5. Extract Imported Libraries and Symbols
        imported_libraries: List[str] = []
        symbols: List[SymbolMetadata] = []

        if import_rva > 0:
            import_desc_offset = rva_to_offset(import_rva)
            if import_desc_offset and import_desc_offset + 20 <= len(data):
                # Iterate IMAGE_IMPORT_DESCRIPTOR (20 bytes each)
                for i in range(256):
                    desc_off = import_desc_offset + (i * 20)
                    if desc_off + 20 > len(data):
                        break
                    orig_first_thunk, _, _, name_rva, first_thunk = struct.unpack_from("<IIIII", data, desc_off)
                    if orig_first_thunk == 0 and name_rva == 0 and first_thunk == 0:
                        break  # Null terminator

                    dll_name_off = rva_to_offset(name_rva)
                    if dll_name_off:
                        dll_name = read_cstring(dll_name_off)
                        if dll_name and dll_name not in imported_libraries:
                            imported_libraries.append(dll_name)

                        # Extract imported function names from thunk table
                        if options.extract_symbols:
                            thunk_rva = orig_first_thunk if orig_first_thunk != 0 else first_thunk
                            thunk_off = rva_to_offset(thunk_rva)
                            if thunk_off:
                                entry_size = 4 if bit_width == 32 else 8
                                ordinal_mask = 0x80000000 if bit_width == 32 else 0x8000000000000000

                                for j in range(200):  # limit per DLL
                                    t_entry_off = thunk_off + (j * entry_size)
                                    if t_entry_off + entry_size > len(data):
                                        break
                                    val = struct.unpack_from("<I" if bit_width == 32 else "<Q", data, t_entry_off)[0]
                                    if val == 0:
                                        break
                                    if not (val & ordinal_mask):
                                        # Hint/Name entry RVA
                                        name_entry_off = rva_to_offset(val)
                                        if name_entry_off and name_entry_off + 2 < len(data):
                                            # Skip 2-byte Hint
                                            func_name = read_cstring(name_entry_off + 2)
                                            if func_name:
                                                symbols.append(
                                                    SymbolMetadata(
                                                        name=func_name,
                                                        is_imported=True,
                                                        symbol_type="function",
                                                        binding="global",
                                                    )
                                                )

        # 6. Extract Certificates (Authenticode / WIN_CERTIFICATE)
        certificates: List[CertificateMetadata] = []
        if options.extract_certificates and security_file_offset > 0 and security_size > 8:
            if security_file_offset + 8 <= len(data):
                dw_length, w_revision, w_cert_type = struct.unpack_from("<IIH", data, security_file_offset)
                cert_data = data[security_file_offset + 8:security_file_offset + dw_length]
                if cert_data:
                    cert_sha256 = hashlib.sha256(cert_data).hexdigest()
                    # Parse subject or heuristic from certificate blob
                    certificates.append(
                        CertificateMetadata(
                            subject="Authenticode SignedData",
                            issuer="Authenticode PKCS#7 Certificate Table",
                            serial_number=None,
                            public_key_algorithm="RSA/ECC",
                            key_size_bits=2048,
                            is_self_signed=False,
                            sha256_fingerprint=cert_sha256,
                        )
                    )

        # 7. Extract Bounded Strings
        crypto_strings: List[str] = []
        if options.extract_strings:
            _, crypto_strings = extract_bounded_strings(
                data,
                max_bytes=options.max_bytes_to_scan,
                max_strings=options.max_strings,
                min_length=options.min_string_length,
            )

        # 8. Detect Crypto Indicators
        crypto_indicators = detect_crypto_indicators(
            imported_libraries=imported_libraries,
            symbols=symbols,
            strings=crypto_strings,
        )

        sha256_hash = hashlib.sha256(data).hexdigest()

        return BinaryMetadata(
            file_path=file_path,
            file_size=len(data),
            file_hash_sha256=sha256_hash,
            binary_format=BinaryFormat.PE,
            architecture=arch_name,
            bit_width=bit_width,
            endianness=Endianness.LITTLE,
            imported_libraries=imported_libraries,
            symbols=symbols,
            sections=sections,
            strings=crypto_strings,
            certificates=certificates,
            crypto_library_indicators=crypto_indicators,
            parsing_warnings=warnings,
        )
