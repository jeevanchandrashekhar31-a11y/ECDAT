"""
ECDAT Safe ELF Binary Parser (32-bit & 64-bit, Little & Big Endian)
Extracts metadata only without executing the binary.
"""

import hashlib
import struct
from typing import Any, Dict, List, Optional, Tuple

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

# ELF Machine constants
ELF_MACHINES = {
    0x03: "x86",
    0x3E: "x86_64",
    0x28: "arm",
    0xB7: "aarch64",
    0x08: "mips",
    0x14: "powerpc",
    0x15: "powerpc64",
    0xF3: "riscv",
    0x02: "sparc",
}

# Section Types
SHT_NULL = 0
SHT_PROGBITS = 1
SHT_SYMTAB = 2
SHT_STRTAB = 3
SHT_RELA = 4
SHT_HASH = 5
SHT_DYNAMIC = 6
SHT_NOTE = 7
SHT_NOBITS = 8
SHT_REL = 9
SHT_DYNSYM = 11

DT_NEEDED = 1
DT_SONAME = 14


class SafeElfParser:
    """Safe static parser for ELF binaries."""

    @staticmethod
    def is_elf(data: bytes) -> bool:
        return len(data) >= 16 and data.startswith(b"\x7fELF")

    def parse(self, data: bytes, file_path: str, options: Optional[ParserOptions] = None) -> BinaryMetadata:
        options = options or ParserOptions()
        warnings: List[str] = []

        if len(data) < 52:
            raise ValueError("File is too small to be a valid ELF binary.")

        # 1. Parse e_ident
        ei_class = data[4]
        ei_data = data[5]

        if ei_class == 1:
            bit_width = 32
        elif ei_class == 2:
            bit_width = 64
        else:
            warnings.append(f"Unknown EI_CLASS {ei_class}, defaulting to 64-bit.")
            bit_width = 64

        if ei_data == 1:
            endian = Endianness.LITTLE
            prefix = "<"
        elif ei_data == 2:
            endian = Endianness.BIG
            prefix = ">"
        else:
            warnings.append(f"Unknown EI_DATA {ei_data}, defaulting to little-endian.")
            endian = Endianness.LITTLE
            prefix = "<"

        # 2. Parse ELF Header
        try:
            if bit_width == 32:
                # 32-bit header format: 16s HHIIIIIHHHHHH
                (
                    e_ident,
                    e_type,
                    e_machine,
                    e_version,
                    e_entry,
                    e_phoff,
                    e_shoff,
                    e_flags,
                    e_ehsize,
                    e_phentsize,
                    e_phnum,
                    e_shentsize,
                    e_shnum,
                    e_shstrndx,
                ) = struct.unpack(prefix + "16sHHIIIIIHHHHHH", data[:52])
            else:
                # 64-bit header format: 16s HHIQQQIHHHHHH
                (
                    e_ident,
                    e_type,
                    e_machine,
                    e_version,
                    e_entry,
                    e_phoff,
                    e_shoff,
                    e_flags,
                    e_ehsize,
                    e_phentsize,
                    e_phnum,
                    e_shentsize,
                    e_shnum,
                    e_shstrndx,
                ) = struct.unpack(prefix + "16sHHIQQQIHHHHHH", data[:64])
        except Exception as e:
            raise ValueError(f"Failed to unpack ELF header: {e}")

        arch_name = ELF_MACHINES.get(e_machine, f"machine_{hex(e_machine)}")

        # 3. Read Section Headers safely
        sections: List[SectionMetadata] = []
        raw_sections: List[Dict[str, Any]] = []
        shstrtab_data = b""

        # Bounds-check section header table
        if 0 < e_shoff < len(data) and e_shentsize > 0 and 0 < e_shnum <= 1000:
            sh_end = e_shoff + (e_shnum * e_shentsize)
            if sh_end <= len(data):
                # First pass: read raw sections
                for i in range(e_shnum):
                    s_offset = e_shoff + (i * e_shentsize)
                    try:
                        if bit_width == 32:
                            (
                                sh_name,
                                sh_type,
                                sh_flags,
                                sh_addr,
                                sh_offset,
                                sh_size,
                                sh_link,
                                sh_info,
                                sh_addralign,
                                sh_entsize,
                            ) = struct.unpack(prefix + "IIIIIIIIII", data[s_offset : s_offset + 40])
                        else:
                            (
                                sh_name,
                                sh_type,
                                sh_flags,
                                sh_addr,
                                sh_offset,
                                sh_size,
                                sh_link,
                                sh_info,
                                sh_addralign,
                                sh_entsize,
                            ) = struct.unpack(prefix + "IIQQQQIIQQ", data[s_offset : s_offset + 64])
                        raw_sections.append(
                            {
                                "index": i,
                                "name_offset": sh_name,
                                "type": sh_type,
                                "flags": sh_flags,
                                "addr": sh_addr,
                                "offset": sh_offset,
                                "size": sh_size,
                                "link": sh_link,
                                "info": sh_info,
                                "entsize": sh_entsize,
                            }
                        )
                    except Exception as err:
                        warnings.append(f"Section {i} unpack failed: {err}")
                        break

                # Extract shstrtab data if valid
                if 0 <= e_shstrndx < len(raw_sections):
                    str_sec = raw_sections[e_shstrndx]
                    if str_sec["offset"] + str_sec["size"] <= len(data):
                        shstrtab_data = data[str_sec["offset"] : str_sec["offset"] + str_sec["size"]]

        # Helper to read null-terminated string from table
        def read_string(str_table: bytes, offset: int) -> str:
            if offset >= len(str_table):
                return ""
            end = str_table.find(b"\x00", offset)
            if end == -1:
                end = len(str_table)
            try:
                return str_table[offset:end].decode("utf-8", errors="ignore")
            except Exception:
                return ""

        # Second pass: construct SectionMetadata with names
        for rs in raw_sections:
            sec_name = read_string(shstrtab_data, rs["name_offset"]) if shstrtab_data else f"sec_{rs['index']}"
            sec_bytes = (
                data[rs["offset"] : rs["offset"] + rs["size"]] if rs["offset"] + rs["size"] <= len(data) else b""
            )
            entropy = calculate_entropy(sec_bytes) if sec_bytes else 0.0

            sections.append(
                SectionMetadata(
                    name=sec_name,
                    virtual_address=rs["addr"],
                    raw_size=rs["size"],
                    virtual_size=rs["size"],
                    raw_offset=rs["offset"],
                    flags=rs["flags"],
                    entropy=entropy,
                )
            )

        # 4. Extract imported libraries (DT_NEEDED) from .dynamic & .dynstr
        imported_libraries: List[str] = []
        dynstr_data = b""

        # Find .dynstr section
        for s, rs in zip(sections, raw_sections):
            if s.name == ".dynstr" or (rs["type"] == SHT_STRTAB and s.name != ".shstrtab" and not dynstr_data):
                if rs["offset"] + rs["size"] <= len(data):
                    dynstr_data = data[rs["offset"] : rs["offset"] + rs["size"]]

        # Parse SHT_DYNAMIC section
        for s, rs in zip(sections, raw_sections):
            if rs["type"] == SHT_DYNAMIC or s.name == ".dynamic":
                dyn_offset = rs["offset"]
                dyn_size = rs["size"]
                if dyn_offset + dyn_size <= len(data):
                    entry_size = 8 if bit_width == 32 else 16
                    num_entries = dyn_size // entry_size
                    for i in range(min(num_entries, 500)):
                        e_off = dyn_offset + (i * entry_size)
                        try:
                            if bit_width == 32:
                                d_tag, d_val = struct.unpack(prefix + "iI", data[e_off : e_off + 8])
                            else:
                                d_tag, d_val = struct.unpack(prefix + "qQ", data[e_off : e_off + 16])
                            if d_tag == 0:  # DT_NULL
                                break
                            if d_tag == DT_NEEDED and dynstr_data:
                                lib_name = read_string(dynstr_data, d_val)
                                if lib_name and lib_name not in imported_libraries:
                                    imported_libraries.append(lib_name)
                        except Exception:
                            break

        # 5. Extract Symbols safely
        symbols: List[SymbolMetadata] = []
        if options.extract_symbols:
            for s, rs in zip(sections, raw_sections):
                if rs["type"] in (SHT_DYNSYM, SHT_SYMTAB):
                    sym_offset = rs["offset"]
                    sym_size = rs["size"]
                    link_idx = rs["link"]

                    # Resolve corresponding string table
                    sym_str_data = dynstr_data
                    if 0 <= link_idx < len(raw_sections):
                        link_sec = raw_sections[link_idx]
                        if link_sec["offset"] + link_sec["size"] <= len(data):
                            sym_str_data = data[link_sec["offset"] : link_sec["offset"] + link_sec["size"]]

                    ent_size = 16 if bit_width == 32 else 24
                    num_syms = sym_size // ent_size
                    max_syms = min(num_syms, 5000)

                    for si in range(max_syms):
                        soff = sym_offset + (si * ent_size)
                        if soff + ent_size > len(data):
                            break
                        try:
                            if bit_width == 32:
                                st_name, st_value, st_size, st_info, st_other, st_shndx = struct.unpack(
                                    prefix + "IIIBBH", data[soff : soff + 16]
                                )
                            else:
                                st_name, st_info, st_other, st_shndx, st_value, st_size = struct.unpack(
                                    prefix + "IBBHQQ", data[soff : soff + 24]
                                )

                            sym_type_num = st_info & 0xF
                            sym_bind_num = st_info >> 4

                            sym_type = "function" if sym_type_num == 2 else ("object" if sym_type_num == 1 else "other")
                            sym_bind = "global" if sym_bind_num == 1 else ("weak" if sym_bind_num == 2 else "local")
                            is_imported = st_shndx == 0

                            sym_name = read_string(sym_str_data, st_name) if sym_str_data else ""
                            if sym_name:
                                symbols.append(
                                    SymbolMetadata(
                                        name=sym_name,
                                        is_imported=is_imported,
                                        symbol_type=sym_type,
                                        binding=sym_bind,
                                        section_index=st_shndx,
                                    )
                                )
                        except Exception:
                            break

        # 6. Extract Bounded Strings
        crypto_strings: List[str] = []
        if options.extract_strings:
            _, crypto_strings = extract_bounded_strings(
                data,
                max_bytes=options.max_bytes_to_scan,
                max_strings=options.max_strings,
                min_length=options.min_string_length,
            )

        # 7. Detect Crypto Indicators
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
            binary_format=BinaryFormat.ELF,
            architecture=arch_name,
            bit_width=bit_width,
            endianness=endian,
            imported_libraries=imported_libraries,
            symbols=symbols,
            sections=sections,
            strings=crypto_strings,
            certificates=[],
            crypto_library_indicators=crypto_indicators,
            parsing_warnings=warnings,
        )
