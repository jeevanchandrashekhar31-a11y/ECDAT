"""
Unit Tests for ECDAT Binary Parser Architecture (Phase 4.1)

Verifies:
- Safe metadata extraction for ELF, PE, and Mach-O binaries.
- Extraction of:
  - architecture
  - imported libraries
  - symbols
  - sections
  - strings with bounded scanning
  - certificates / public keys
  - crypto-library indicators
- Target binary is NEVER executed.
- Worker isolation (process pool, timeout handling, crash resilience).
"""

import os
import struct
import tempfile
import pytest

from scanners.binary_container.parsers import (
    BinaryFormat,
    Endianness,
    ParserOptions,
    SafeElfParser,
    SafePeParser,
    SafeMachoParser,
    WorkerIsolatedBinaryAnalyzer,
    analyze_binary,
    extract_bounded_strings,
    detect_crypto_indicators,
)


def build_synthetic_elf() -> bytes:
    """Builds a minimal valid 64-bit Little-Endian ELF executable."""
    # 1. Prepare strings for .dynstr and .shstrtab
    shstrtab = b"\x00.shstrtab\x00.dynstr\x00.dynamic\x00.dynsym\x00.text\x00"
    dynstr = b"\x00libcrypto.so.3\x00EVP_EncryptInit\x00AES-256-GCM\x00"

    # Positions
    header_size = 64
    text_data = b"\x90\x90\x90AES-256-GCM OpenSSL 3.0.8\x00"
    text_offset = header_size
    text_size = len(text_data)

    shstr_offset = text_offset + text_size
    shstr_size = len(shstrtab)

    dynstr_offset = shstr_offset + shstr_size
    dynstr_size = len(dynstr)

    # Dynamic section (DT_NEEDED=1 val=1 pointing to "libcrypto.so.3", DT_NULL=0)
    # Elf64_Dyn: qQ (16 bytes)
    dynamic_data = struct.pack("<qQ", 1, 1) + struct.pack("<qQ", 0, 0)
    dynamic_offset = dynstr_offset + dynstr_size
    dynamic_size = len(dynamic_data)

    # Dynsym section (1 null sym, 1 symbol for EVP_EncryptInit)
    # Elf64_Sym: I B B H Q Q (24 bytes)
    sym0 = struct.pack("<IBBHQQ", 0, 0, 0, 0, 0, 0)
    # EVP_EncryptInit is at offset 16 in dynstr ("\0libcrypto.so.3\0EVP_EncryptInit\0")
    sym1 = struct.pack("<IBBHQQ", 16, 0x12, 0, 0, 0x401000, 32)
    dynsym_data = sym0 + sym1
    dynsym_offset = dynamic_offset + dynamic_size
    dynsym_size = len(dynsym_data)

    shoff = dynsym_offset + dynsym_size

    # Section headers (6 sections: NULL, .text, .shstrtab, .dynstr, .dynamic, .dynsym)
    # Elf64_Shdr: IIQQQQIIQQ (64 bytes each)
    sh_null = struct.pack("<IIQQQQIIQQ", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    sh_text = struct.pack("<IIQQQQIIQQ", shstrtab.find(b".text"), 1, 6, 0x401000, text_offset, text_size, 0, 0, 16, 0)
    sh_shstr = struct.pack("<IIQQQQIIQQ", shstrtab.find(b".shstrtab"), 3, 0, 0, shstr_offset, shstr_size, 0, 0, 1, 0)
    sh_dynstr = struct.pack("<IIQQQQIIQQ", shstrtab.find(b".dynstr"), 3, 2, 0, dynstr_offset, dynstr_size, 0, 0, 1, 0)
    sh_dynamic = struct.pack(
        "<IIQQQQIIQQ", shstrtab.find(b".dynamic"), 6, 3, 0, dynamic_offset, dynamic_size, 3, 0, 8, 16
    )
    sh_dynsym = struct.pack("<IIQQQQIIQQ", shstrtab.find(b".dynsym"), 11, 2, 0, dynsym_offset, dynsym_size, 3, 1, 8, 24)

    shdrs = sh_null + sh_text + sh_shstr + sh_dynstr + sh_dynamic + sh_dynsym

    # ELF Header
    # 16s H H I Q Q Q I H H H H H H
    e_ident = b"\x7fELF\x02\x01\x01\x00" + (b"\x00" * 8)
    elf_hdr = struct.pack(
        "<16sHHIQQQIHHHHHH",
        e_ident,
        2,  # ET_EXEC
        0x3E,  # EM_X86_64
        1,  # EV_CURRENT
        0x401000,  # e_entry
        0,  # e_phoff
        shoff,  # e_shoff
        0,  # e_flags
        64,  # e_ehsize
        0,  # e_phentsize
        0,  # e_phnum
        64,  # e_shentsize
        6,  # e_shnum
        2,  # e_shstrndx (.shstrtab is section index 2)
    )

    return elf_hdr + text_data + shstrtab + dynstr + dynamic_data + dynsym_data + shdrs


def build_synthetic_pe() -> bytes:
    """Builds a minimal valid 64-bit PE (PE32+) executable with imports and Authenticode cert directory."""
    buf = bytearray(0x800)  # 2KB buffer

    # 1. DOS Header
    buf[0:2] = b"MZ"
    struct.pack_into("<I", buf, 0x3C, 0x80)  # e_lfanew = 0x80

    # 2. PE Signature
    pe_off = 0x80
    buf[pe_off : pe_off + 4] = b"PE\x00\x00"

    # 3. COFF Header (20 bytes)
    coff_off = pe_off + 4
    struct.pack_into(
        "<HHIIIHH",
        buf,
        coff_off,
        0x8664,  # Machine: AMD64
        2,  # NumberOfSections = 2 (.text, .rdata)
        0x65000000,  # TimeDateStamp
        0,
        0,  # Symbols
        240,  # SizeOfOptionalHeader (PE32+ standard is 240)
        0x0002,  # Characteristics: EXECUTABLE_IMAGE
    )

    # 4. Optional Header (PE32+ Magic = 0x20B)
    opt_off = coff_off + 20
    struct.pack_into("<H", buf, opt_off, 0x020B)  # Magic = PE32+
    struct.pack_into("<Q", buf, opt_off + 24, 0x140001000)  # ImageBase

    # Data Directories in PE32+ start at opt_off + 112
    data_dir_off = opt_off + 112
    # Index 1: Import Directory -> RVA 0x2000, Size 40
    struct.pack_into("<II", buf, data_dir_off + 8, 0x2000, 40)
    # Index 4: Security / Certificates Directory -> Raw file offset 0x600, Size 64
    struct.pack_into("<II", buf, data_dir_off + 32, 0x600, 64)

    # 5. Section Headers (2 sections, 40 bytes each)
    sec_off = opt_off + 240
    # Section 1: .text (VA 0x1000, RawOffset 0x200, RawSize 0x200)
    struct.pack_into("<8sIIII", buf, sec_off, b".text\x00\x00\x00", 0x100, 0x1000, 0x200, 0x200)
    # Section 2: .rdata (VA 0x2000, RawOffset 0x400, RawSize 0x200)
    struct.pack_into("<8sIIII", buf, sec_off + 40, b".rdata\x00\x00", 0x200, 0x2000, 0x200, 0x400)

    # 6. Put code/string in .text (raw offset 0x200)
    text_payload = b"Microsoft Enhanced Cryptographic Provider RSA-2048\x00"
    buf[0x200 : 0x200 + len(text_payload)] = text_payload

    # 7. Import Directory at .rdata (raw offset 0x400)
    # IMAGE_IMPORT_DESCRIPTOR: OriginalFirstThunk (0x2030), TimeDate, Forwarder, NameRVA (0x2040), FirstThunk (0x2030)
    struct.pack_into("<IIIII", buf, 0x400, 0x2030, 0, 0, 0x2040, 0x2030)
    # Null terminator descriptor
    struct.pack_into("<IIIII", buf, 0x400 + 20, 0, 0, 0, 0, 0)

    # ILT / Thunk at RVA 0x2030 -> raw offset 0x430
    # Entry points to IMAGE_IMPORT_BY_NAME at RVA 0x2050 -> raw offset 0x450
    struct.pack_into("<Q", buf, 0x430, 0x2050)
    struct.pack_into("<Q", buf, 0x438, 0)  # Null terminator

    # DLL Name at RVA 0x2040 -> raw offset 0x440
    dll_name = b"bcrypt.dll\x00"
    buf[0x440 : 0x440 + len(dll_name)] = dll_name

    # Hint/Name at RVA 0x2050 -> raw offset 0x450
    # Hint (2 bytes) + "BCryptEncrypt\x00"
    struct.pack_into("<H", buf, 0x450, 1)
    func_name = b"BCryptEncrypt\x00"
    buf[0x452 : 0x452 + len(func_name)] = func_name

    # 8. Security Directory at raw file offset 0x600 (WIN_CERTIFICATE)
    # dwLength (uint32), wRevision (uint16), wCertificateType (uint16)
    struct.pack_into("<IIH", buf, 0x600, 64, 0x0200, 0x0002)  # WIN_CERT_TYPE_PKCS_SIGNED_DATA
    buf[0x608 : 0x608 + 16] = b"SAMPLE_AUTH_CERT"

    return bytes(buf)


def build_synthetic_macho() -> bytes:
    """Builds a minimal valid 64-bit Little-Endian Mach-O executable."""
    # Mach-O 64-bit Header (32 bytes)
    magic = 0xFEEDFACF  # MH_MAGIC_64
    cputype = 7 | 0x01000000  # CPU_TYPE_X86_64
    cpusubtype = 3
    filetype = 2  # MH_EXECUTE
    ncmds = 3

    # Command 1: LC_SEGMENT_64 (72 bytes header + 80 bytes 1 section = 152 bytes)
    sec_cmd = struct.pack(
        "<16s16sQQIIIIIIII",
        b"__text\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
        b"__TEXT\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
        0x1000,
        0x100,
        0x100,
        2,
        0,
        0,
        0,
        0,
        0,
        0,
    )
    seg_cmd = (
        struct.pack(
            "<II16sQQQQIIII",
            0x19,  # LC_SEGMENT_64
            72 + 80,  # cmdsize
            b"__TEXT\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00",
            0x1000,  # vmaddr
            0x1000,  # vmsize
            0,  # fileoff
            0x400,  # filesize
            7,
            5,  # maxprot, initprot
            1,
            0,  # nsects = 1, flags = 0
        )
        + sec_cmd
    )

    # Command 2: LC_LOAD_DYLIB
    dylib_path = b"/usr/lib/libcrypto.dylib\x00\x00\x00"
    cmd2_size = 24 + len(dylib_path)
    dylib_cmd = struct.pack("<IIIIII", 0x0C, cmd2_size, 24, 0, 0x010000, 0x010000) + dylib_path

    # Command 3: LC_SYMTAB (24 bytes)
    symtab_cmd = struct.pack("<IIIIII", 0x02, 24, 0x200, 1, 0x220, 32)

    sizeofcmds = len(seg_cmd) + len(dylib_cmd) + len(symtab_cmd)
    hdr = struct.pack("<IIIIIIII", magic, cputype, cpusubtype, filetype, ncmds, sizeofcmds, 0, 0)

    buf = bytearray(0x500)
    payload = hdr + seg_cmd + dylib_cmd + symtab_cmd
    buf[: len(payload)] = payload

    # Add symbol table at offset 0x200: nlist_64 (16 bytes: n_strx, n_type, n_sect, n_desc, n_value)
    struct.pack_into("<IBBHQ", buf, 0x200, 1, 0x01, 0, 0, 0x1000)

    # Add string table at offset 0x220: "\x00_EVP_EncryptInit\x00"
    str_data = b"\x00_EVP_EncryptInit\x00"
    buf[0x220 : 0x220 + len(str_data)] = str_data

    # Add crypto banner string in data area
    crypto_str = b"ChaCha20-Poly1305 Apple CommonCrypto\x00"
    buf[0x300 : 0x300 + len(crypto_str)] = crypto_str

    return bytes(buf)


def test_elf_parser_metadata_extraction():
    elf_bytes = build_synthetic_elf()
    assert SafeElfParser.is_elf(elf_bytes) is True

    parser = SafeElfParser()
    meta = parser.parse(elf_bytes, "synthetic_app.elf")

    # Verify extracted metadata
    assert meta.binary_format == BinaryFormat.ELF
    assert meta.architecture == "x86_64"
    assert meta.bit_width == 64
    assert meta.endianness == Endianness.LITTLE

    # Verify imported libraries
    assert "libcrypto.so.3" in meta.imported_libraries

    # Verify symbols
    sym_names = [s.name for s in meta.symbols]
    assert "EVP_EncryptInit" in sym_names

    # Verify sections
    sec_names = [s.name for s in meta.sections]
    assert ".text" in sec_names
    assert ".dynamic" in sec_names

    # Verify strings bounded scanning
    assert any("AES-256-GCM" in s for s in meta.strings)

    # Verify crypto indicator
    assert len(meta.crypto_library_indicators) > 0
    indicator = next((ci for ci in meta.crypto_library_indicators if ci.library_name == "OpenSSL"), None)
    assert indicator is not None
    assert indicator.confidence == "high"
    assert "EVP_EncryptInit" in indicator.matched_symbols


def test_pe_parser_metadata_and_certificates():
    pe_bytes = build_synthetic_pe()
    assert SafePeParser.is_pe(pe_bytes) is True

    parser = SafePeParser()
    meta = parser.parse(pe_bytes, "synthetic_app.exe")

    # Verify metadata
    assert meta.binary_format == BinaryFormat.PE
    assert meta.architecture == "x86_64"
    assert meta.bit_width == 64
    assert meta.endianness == Endianness.LITTLE

    # Verify imported libraries
    assert "bcrypt.dll" in meta.imported_libraries

    # Verify symbols
    sym_names = [s.name for s in meta.symbols]
    assert "BCryptEncrypt" in sym_names

    # Verify sections
    sec_names = [s.name for s in meta.sections]
    assert ".text" in sec_names
    assert ".rdata" in sec_names

    # Verify Authenticode certificate extraction
    assert len(meta.certificates) > 0
    cert = meta.certificates[0]
    assert "Authenticode" in cert.subject
    assert cert.sha256_fingerprint is not None

    # Verify crypto indicator
    indicator = next((ci for ci in meta.crypto_library_indicators if "Windows CNG" in ci.library_name), None)
    assert indicator is not None
    assert indicator.confidence == "high"
    assert "BCryptEncrypt" in indicator.matched_symbols


def test_macho_parser_metadata():
    macho_bytes = build_synthetic_macho()
    assert SafeMachoParser.is_macho(macho_bytes) is True

    parser = SafeMachoParser()
    meta = parser.parse(macho_bytes, "synthetic_app.dylib")

    # Verify metadata
    assert meta.binary_format == BinaryFormat.MACHO
    assert meta.architecture == "x86_64"
    assert meta.bit_width == 64

    # Verify imported libraries
    assert any("libcrypto.dylib" in lib for lib in meta.imported_libraries)

    # Verify symbols
    sym_names = [s.name for s in meta.symbols]
    assert "_EVP_EncryptInit" in sym_names

    # Verify sections
    sec_names = [s.name for s in meta.sections]
    assert "__text" in sec_names

    # Verify crypto strings
    assert any("ChaCha20-Poly1305" in s for s in meta.strings)


def test_bounded_string_scanner_bounds():
    # Construct a 50KB data blob with repeated noise and crypto strings
    noise = b"A" * 50000 + b"TLSv1.3 AES-GCM 1.2.840.113549.1.1.1"
    all_strs, crypto_strs = extract_bounded_strings(
        noise,
        max_bytes=10000,  # limit to first 10KB
        max_strings=5,
        min_length=4,
    )

    # Must respect string count bound
    assert len(all_strs) <= 5


def test_never_execute_target_binary(monkeypatch):
    """
    Guarantees that analyzing a binary NEVER calls subprocess, exec, or spawns the target file.
    """
    import subprocess

    def forbidden_call(*args, **kwargs):
        raise AssertionError("SECURITY VIOLATION: Execution of target binary was attempted!")

    monkeypatch.setattr(subprocess, "run", forbidden_call)
    monkeypatch.setattr(subprocess, "Popen", forbidden_call)
    monkeypatch.setattr(os, "system", forbidden_call)

    with tempfile.NamedTemporaryFile(suffix=".elf", delete=False) as tf:
        tf.write(build_synthetic_elf())
        tf_path = tf.name

    try:
        # Must parse cleanly without calling any execution primitives
        meta = analyze_binary(tf_path, worker_isolation=False)
        assert meta.binary_format == BinaryFormat.ELF
        assert "libcrypto.so.3" in meta.imported_libraries
    finally:
        if os.path.exists(tf_path):
            os.remove(tf_path)


def test_worker_isolation_and_resilience():
    """
    Tests that the worker isolated analyzer executes parsing in an isolated worker,
    recovering safely from malformed binaries or corrupt inputs.
    """
    # Write a malformed binary with invalid offsets
    corrupt_data = b"\x7fELF\x02\x01\x01\x00" + b"\xff" * 128
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as tf:
        tf.write(corrupt_data)
        tf_path = tf.name

    try:
        analyzer = WorkerIsolatedBinaryAnalyzer(default_timeout=5)
        meta = analyzer.analyze(tf_path, options=ParserOptions(worker_isolation=True))

        # Worker handles failure safely without crashing parent process
        assert meta.file_path == tf_path
        assert isinstance(meta.parsing_warnings, list)
    finally:
        if os.path.exists(tf_path):
            os.remove(tf_path)


def test_fat_macho_parsing():
    macho_slice = build_synthetic_macho()
    # Build FAT Mach-O header:
    # magic: 0xCAFEBABE (big-endian), nfat_arch: 1
    fat_header = struct.pack(">II", 0xCAFEBABE, 1)
    # fat_arch: cputype, cpusubtype, offset, size, align (each 4 bytes, total 20 bytes)
    slice_offset = 8 + 20
    fat_arch = struct.pack(">IIIII", 7 | 0x01000000, 3, slice_offset, len(macho_slice), 2)
    fat_bytes = fat_header + fat_arch + macho_slice

    assert SafeMachoParser.is_macho(fat_bytes) is True
    parser = SafeMachoParser()
    meta = parser.parse(fat_bytes, "fat_universal_app")

    assert meta.binary_format == BinaryFormat.FAT_MACHO
    assert meta.architecture == "x86_64"
    assert "_EVP_EncryptInit" in [s.name for s in meta.symbols]
    assert any("libcrypto.dylib" in lib for lib in meta.imported_libraries)


def test_binary_metadata_to_cbom_mapping():
    """
    Tests converting extracted BinaryMetadata into a CycloneDX 1.6 CBOM document.
    """
    from scanners.cbom_mapping import binary_metadata_to_cbom, serialize_cbom, validate_cbom_json

    elf_bytes = build_synthetic_elf()
    parser = SafeElfParser()
    meta = parser.parse(elf_bytes, "test_binary_service.elf")

    cbom = binary_metadata_to_cbom(meta)
    json_str = serialize_cbom(cbom)

    assert validate_cbom_json(json_str) is True
    import json

    data = json.loads(json_str)

    # Verify root target application component
    components = data.get("components", [])
    assert len(components) >= 2  # target app + at least one crypto lib
    target_comp = next(c for c in components if c["type"] == "application")
    assert target_comp["name"] == "test_binary_service.elf"

    # Verify custom properties
    prop_dict = {p["name"]: p["value"] for p in target_comp.get("properties", [])}
    assert prop_dict["ecdat:binary_format"] == "ELF"
    assert prop_dict["ecdat:architecture"] == "x86_64"
    assert prop_dict["ecdat:analysis_mode"] == "STATIC_SAFE_NON_EXECUTING"
    assert "libcrypto.so.3" in prop_dict.get("ecdat:imported_libraries", "")

    # Verify crypto library components
    crypto_comp = next(c for c in components if c.get("name") == "OpenSSL")
    assert crypto_comp["type"] == "library"
    c_props = {p["name"]: p["value"] for p in crypto_comp.get("properties", [])}
    assert c_props["ecdat:confidence"] in ["high", "medium", "low"]
    assert "Static binary" in c_props["ecdat:reason"]
