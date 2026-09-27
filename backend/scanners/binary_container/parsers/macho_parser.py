"""
ECDAT Safe Mach-O Binary Parser (32-bit, 64-bit, and Universal Fat Binaries)
Extracts metadata, sections, dylib imports, symbols, and code signatures without execution.
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

# Mach-O Magic Constants
MH_MAGIC = 0xFEEDFACE
MH_CIGAM = 0xCEFAEDFE
MH_MAGIC_64 = 0xFEEDFACF
MH_CIGAM_64 = 0xCFFAEDFE
FAT_MAGIC = 0xCAFEBABE
FAT_CIGAM = 0xBEBAFECA

# CPU Types
CPU_TYPE_X86 = 7
CPU_TYPE_X86_64 = 7 | 0x01000000
CPU_TYPE_ARM = 12
CPU_TYPE_ARM64 = 12 | 0x01000000
CPU_TYPE_POWERPC = 18

MACHO_CPUS = {
    CPU_TYPE_X86: "x86",
    CPU_TYPE_X86_64: "x86_64",
    CPU_TYPE_ARM: "arm",
    CPU_TYPE_ARM64: "arm64",
    CPU_TYPE_POWERPC: "powerpc",
}

# Load Commands
LC_SEGMENT = 0x1
LC_SYMTAB = 0x2
LC_LOAD_DYLIB = 0xC
LC_LOAD_WEAK_DYLIB = 0x18 | 0x80000000
LC_SEGMENT_64 = 0x19
LC_CODE_SIGNATURE = 0x1D
LC_REEXPORT_DYLIB = 0x1F


class SafeMachoParser:
    """Safe static parser for Apple Mach-O binaries."""

    @staticmethod
    def is_macho(data: bytes) -> bool:
        if len(data) < 4:
            return False
        magic = struct.unpack(">I", data[:4])[0]
        return magic in (MH_MAGIC, MH_CIGAM, MH_MAGIC_64, MH_CIGAM_64, FAT_MAGIC, FAT_CIGAM)

    def parse(self, data: bytes, file_path: str, options: Optional[ParserOptions] = None) -> BinaryMetadata:
        options = options or ParserOptions()
        warnings: List[str] = []

        if len(data) < 28:
            raise ValueError("File is too small to be a valid Mach-O binary.")

        first_magic = struct.unpack(">I", data[:4])[0]

        # Handle Universal Fat Binary
        slice_offset = 0
        slice_size = len(data)
        format_type = BinaryFormat.MACHO

        if first_magic in (FAT_MAGIC, FAT_CIGAM):
            format_type = BinaryFormat.FAT_MACHO
            fat_prefix = ">" if first_magic == FAT_MAGIC else "<"
            nfat_arch = struct.unpack(fat_prefix + "I", data[4:8])[0]

            # Choose the best 64-bit slice or first slice
            best_slice = None
            for i in range(min(nfat_arch, 16)):
                arch_off = 8 + (i * 20)
                if arch_off + 20 > len(data):
                    break
                cputype, cpusubtype, offset, size, align = struct.unpack(
                    fat_prefix + "IIIII", data[arch_off : arch_off + 20]
                )
                if cputype == CPU_TYPE_X86_64 or cputype == CPU_TYPE_ARM64:
                    best_slice = (offset, size)
                    break
                if best_slice is None:
                    best_slice = (offset, size)

            if best_slice:
                slice_offset, slice_size = best_slice
                if slice_offset + 28 > len(data):
                    raise ValueError("Fat Mach-O slice offset out of bounds.")
            else:
                raise ValueError("No valid slices found in Fat Mach-O binary.")

        slice_data = data[slice_offset : slice_offset + slice_size]
        magic = struct.unpack(">I", slice_data[:4])[0]

        if magic in (MH_MAGIC, MH_MAGIC_64):
            endian = Endianness.BIG
            prefix = ">"
        elif magic in (MH_CIGAM, MH_CIGAM_64):
            endian = Endianness.LITTLE
            prefix = "<"
        else:
            raise ValueError(f"Invalid Mach-O slice magic: {hex(magic)}")

        bit_width = 64 if magic in (MH_MAGIC_64, MH_CIGAM_64) else 32
        header_len = 32 if bit_width == 64 else 28

        if len(slice_data) < header_len:
            raise ValueError("Mach-O slice truncated.")

        if bit_width == 32:
            m_magic, cputype, cpusubtype, filetype, ncmds, sizeofcmds, flags = struct.unpack(
                prefix + "IIIIIII", slice_data[:28]
            )
        else:
            m_magic, cputype, cpusubtype, filetype, ncmds, sizeofcmds, flags, reserved = struct.unpack(
                prefix + "IIIIIIII", slice_data[:32]
            )

        arch_name = MACHO_CPUS.get(cputype, f"cputype_{hex(cputype)}")

        # 2. Iterate Load Commands
        cmd_offset = header_len
        sections: List[SectionMetadata] = []
        imported_libraries: List[str] = []
        symbols: List[SymbolMetadata] = []
        certificates: List[CertificateMetadata] = []

        for _ in range(min(ncmds, 256)):
            if cmd_offset + 8 > len(slice_data):
                break
            cmd, cmdsize = struct.unpack(prefix + "II", slice_data[cmd_offset : cmd_offset + 8])
            if cmdsize < 8 or cmd_offset + cmdsize > len(slice_data):
                break

            cmd_bytes = slice_data[cmd_offset : cmd_offset + cmdsize]

            # A. Segment & Section extraction
            if cmd == LC_SEGMENT:
                # 32-bit segment
                if len(cmd_bytes) >= 56:
                    segname, vmaddr, vmsize, fileoff, filesize, maxprot, initprot, nsects, flags = struct.unpack(
                        prefix + "16sIIIIIIII", cmd_bytes[8:56]
                    )
                    sec_cursor = 56
                    for _ in range(min(nsects, 64)):
                        if sec_cursor + 68 > len(cmd_bytes):
                            break
                        sectname, segname_s, s_addr, s_size, s_offset, s_align, s_reloff, s_nreloc, s_flags = (
                            struct.unpack(prefix + "16s16sIIIIIII", cmd_bytes[sec_cursor : sec_cursor + 68])
                        )
                        s_name = sectname.split(b"\x00")[0].decode("ascii", errors="ignore")
                        sec_bytes = (
                            slice_data[s_offset : s_offset + s_size] if s_offset + s_size <= len(slice_data) else b""
                        )
                        sections.append(
                            SectionMetadata(
                                name=s_name,
                                virtual_address=s_addr,
                                raw_size=s_size,
                                virtual_size=s_size,
                                raw_offset=s_offset,
                                entropy=calculate_entropy(sec_bytes) if sec_bytes else 0.0,
                            )
                        )
                        sec_cursor += 68

            elif cmd == LC_SEGMENT_64:
                # 64-bit segment
                if len(cmd_bytes) >= 72:
                    segname, vmaddr, vmsize, fileoff, filesize, maxprot, initprot, nsects, flags = struct.unpack(
                        prefix + "16sQQQQIIII", cmd_bytes[8:72]
                    )
                    sec_cursor = 72
                    for _ in range(min(nsects, 64)):
                        if sec_cursor + 80 > len(cmd_bytes):
                            break
                        sectname, segname_s, s_addr, s_size, s_offset, s_align, s_reloff, s_nreloc, s_flags, _, _, _ = (
                            struct.unpack(prefix + "16s16sQQIIIIIIII", cmd_bytes[sec_cursor : sec_cursor + 80])
                        )
                        s_name = sectname.split(b"\x00")[0].decode("ascii", errors="ignore")
                        sec_bytes = (
                            slice_data[s_offset : s_offset + s_size] if s_offset + s_size <= len(slice_data) else b""
                        )
                        sections.append(
                            SectionMetadata(
                                name=s_name,
                                virtual_address=s_addr,
                                raw_size=s_size,
                                virtual_size=s_size,
                                raw_offset=s_offset,
                                entropy=calculate_entropy(sec_bytes) if sec_bytes else 0.0,
                            )
                        )
                        sec_cursor += 80

            # B. Imported dynamic libraries
            elif cmd in (LC_LOAD_DYLIB, LC_LOAD_WEAK_DYLIB, LC_REEXPORT_DYLIB):
                if len(cmd_bytes) >= 24:
                    name_offset = struct.unpack(prefix + "I", cmd_bytes[8:12])[0]
                    if name_offset < len(cmd_bytes):
                        dylib_str_bytes = cmd_bytes[name_offset:].split(b"\x00")[0]
                        dylib_path = dylib_str_bytes.decode("utf-8", errors="ignore")
                        if dylib_path and dylib_path not in imported_libraries:
                            imported_libraries.append(dylib_path)

            # C. Symbols (LC_SYMTAB)
            elif cmd == LC_SYMTAB and options.extract_symbols:
                if len(cmd_bytes) >= 24:
                    symoff, nsyms, stroff, strsize = struct.unpack(prefix + "IIII", cmd_bytes[8:24])
                    if symoff < len(slice_data) and stroff < len(slice_data):
                        str_table = slice_data[stroff : stroff + strsize]
                        ent_size = 12 if bit_width == 32 else 16
                        num_syms = min(nsyms, 5000)

                        for si in range(num_syms):
                            soff = symoff + (si * ent_size)
                            if soff + ent_size > len(slice_data):
                                break
                            if bit_width == 32:
                                n_strx, n_type, n_sect, n_desc, n_value = struct.unpack(
                                    prefix + "IBBH I", slice_data[soff : soff + 12]
                                )
                            else:
                                n_strx, n_type, n_sect, n_desc, n_value = struct.unpack(
                                    prefix + "IBBH Q", slice_data[soff : soff + 16]
                                )

                            if n_strx < len(str_table):
                                sym_name = str_table[n_strx:].split(b"\x00")[0].decode("utf-8", errors="ignore")
                                if sym_name:
                                    is_ext = bool(n_type & 0x01)
                                    symbols.append(
                                        SymbolMetadata(
                                            name=sym_name,
                                            is_imported=is_ext and (n_sect == 0),
                                            symbol_type="function",
                                            binding="global" if is_ext else "local",
                                        )
                                    )

            # D. Code Signature
            elif cmd == LC_CODE_SIGNATURE and options.extract_certificates:
                if len(cmd_bytes) >= 16:
                    dataoff, datasize = struct.unpack(prefix + "II", cmd_bytes[8:16])
                    if dataoff + datasize <= len(slice_data):
                        sig_bytes = slice_data[dataoff : dataoff + datasize]
                        certificates.append(
                            CertificateMetadata(
                                subject="Apple Code Signature Blob",
                                issuer="Apple Embedded Certificate Chain",
                                public_key_algorithm="RSA/ECDSA",
                                key_size_bits=256,
                                is_self_signed=False,
                                sha256_fingerprint=hashlib.sha256(sig_bytes).hexdigest(),
                            )
                        )

            cmd_offset += cmdsize

        # 3. Extract Bounded Strings
        crypto_strings: List[str] = []
        if options.extract_strings:
            _, crypto_strings = extract_bounded_strings(
                slice_data,
                max_bytes=options.max_bytes_to_scan,
                max_strings=options.max_strings,
                min_length=options.min_string_length,
            )

        # 4. Detect Crypto Indicators
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
            binary_format=format_type,
            architecture=arch_name,
            bit_width=bit_width,
            endianness=endian,
            imported_libraries=imported_libraries,
            symbols=symbols,
            sections=sections,
            strings=crypto_strings,
            certificates=certificates,
            crypto_library_indicators=crypto_indicators,
            parsing_warnings=warnings,
        )
