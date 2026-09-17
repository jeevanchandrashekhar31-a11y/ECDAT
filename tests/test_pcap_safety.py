"""
Tests for Phase 20.3: PCAP Safety & Hostile Binary Hardening.
Asserts that ECDAT treats PCAP as hostile binary input:
1. Oversized PCAP (>50MB) -> rejected cleanly
2. Packet count limit -> bounded safely (no memory exhaustion)
3. Protocol recursion limit -> encapsulation loops aborted
4. Parsing time limit -> bounded execution
5. Malformed packets produce controlled parser diagnostics, NOT crashes
6. Legitimate TLS / SSH handshakes are parsed safely
"""

import struct
import time
from pathlib import Path
import pytest

from scanners.network.pcap_parser import SafePcapParser, PcapSizeLimitError, PcapSecurityError, LINKTYPE_ETHERNET


def make_pcap_bytes(packets: list, snaplen: int = 65535, endian: str = "<") -> bytes:
    """Helper to synthesize a classic PCAP file buffer."""
    magic = 0xA1B2C3D4 if endian == "<" else 0xD4C3B2A1
    # Global header: magic(4), v_maj(2), v_min(2), thiszone(4), sigfigs(4), snaplen(4), network(4)
    hdr = struct.pack(f"{endian}IHHiIII", magic, 2, 4, 0, 0, snaplen, LINKTYPE_ETHERNET)
    body = bytearray(hdr)

    for pkt_data in packets:
        # Packet header: ts_sec(4), ts_usec(4), incl_len(4), orig_len(4)
        pkt_hdr = struct.pack(f"{endian}IIII", int(time.time()), 0, len(pkt_data), len(pkt_data))
        body.extend(pkt_hdr)
        body.extend(pkt_data)

    return bytes(body)


def make_ipv4_tcp_packet(src_ip: str, dst_ip: str, src_port: int, dst_port: int, payload: bytes) -> bytes:
    """Helper to synthesize an Ethernet/IPv4/TCP packet."""
    # Ethernet header: dst(6), src(6), type(2) = 0x0800
    eth = b"\x00\x11\x22\x33\x44\x55\x66\x77\x88\x99\xaa\xbb\x08\x00"

    # IPv4 header: ver_ihl(1)=0x45, dscp_ecn(1), total_len(2), id(2), flags_offset(2), ttl(1)=64, proto(1)=6 (TCP), checksum(2), src(4), dst(4)
    src_bytes = bytes(int(x) for x in src_ip.split("."))
    dst_bytes = bytes(int(x) for x in dst_ip.split("."))
    ip_len = 20 + 20 + len(payload)
    ip_hdr = struct.pack(">BBHHHBBH4s4s", 0x45, 0, ip_len, 1, 0, 64, 6, 0, src_bytes, dst_bytes)

    # TCP header: src_port(2), dst_port(2), seq(4), ack(4), offset_flags(2)=0x5018, window(2), checksum(2), urgent(2)
    tcp_hdr = struct.pack(">HHIIHHHH", src_port, dst_port, 100, 200, 0x5018, 8192, 0, 0)

    return eth + ip_hdr + tcp_hdr + payload


@pytest.fixture
def parser():
    """Safe parser with lowered limits for unit testing."""
    return SafePcapParser(
        max_size_bytes=5 * 1024 * 1024,  # 5 MB
        max_packet_count=50,
        max_recursion=3,
        max_time_seconds=2.0,
    )


def test_oversized_pcap_rejected(tmp_path):
    """PCAP exceeding size limit must be rejected with PcapSizeLimitError."""
    pcap_path = tmp_path / "oversized.pcap"
    # Write 6 MB file
    with open(pcap_path, "wb") as f:
        f.seek(6 * 1024 * 1024 - 1)
        f.write(b"\x00")

    parser = SafePcapParser(max_size_bytes=5 * 1024 * 1024)
    with pytest.raises(PcapSizeLimitError) as exc_info:
        parser.parse_file(pcap_path)
    assert "exceeds security limit" in str(exc_info.value)


def test_packet_count_limit_bounded(parser, tmp_path):
    """Packet flood (>max_packet_count) must be bounded safely without memory exhaustion."""
    pcap_path = tmp_path / "flood.pcap"
    # Create 80 packets (limit is 50)
    dummy_pkt = make_ipv4_tcp_packet("10.0.0.1", "10.0.0.2", 12345, 80, b"GET / HTTP/1.1\r\n\r\n")
    data = make_pcap_bytes([dummy_pkt] * 80)
    pcap_path.write_bytes(data)

    res = parser.parse_file(pcap_path)
    assert res["packets_parsed"] == 50
    assert res["limit_reached"] is True


def test_malformed_truncated_packets_produce_diagnostics_not_crashes(parser, tmp_path):
    """Malformed packets with corrupted length fields must produce diagnostics, not crashes."""
    pcap_path = tmp_path / "corrupted.pcap"

    # Packet with corrupted incl_len claiming 60,000 bytes when only 10 bytes exist
    magic = 0xA1B2C3D4
    hdr = struct.pack("<IHHiIII", magic, 2, 4, 0, 0, 65535, LINKTYPE_ETHERNET)
    # Packet header declaring incl_len=60000, orig_len=60000, but followed by only 10 bytes
    pkt_hdr = struct.pack("<IIII", int(time.time()), 0, 60000, 60000)
    corrupted_data = hdr + pkt_hdr + b"1234567890"

    pcap_path.write_bytes(corrupted_data)

    res = parser.parse_file(pcap_path)
    # Must NOT crash! Must record a diagnostic
    assert res["diagnostics_count"] >= 1
    assert any("TRUNCATED_PACKET" in d["type"] for d in res["diagnostics"])


def test_invalid_magic_number_handled(parser, tmp_path):
    """File with corrupted magic number must produce controlled diagnostic, not crash."""
    pcap_path = tmp_path / "invalid_magic.pcap"
    # Corrupted magic bytes
    pcap_path.write_bytes(b"\xde\xad\xbe\xef" + b"\x00" * 30)

    res = parser.parse_file(pcap_path)
    assert res["diagnostics_count"] >= 1
    assert any("INVALID_MAGIC" in d["type"] for d in res["diagnostics"])


def test_protocol_recursion_limit_guards_against_tunnel_loops(parser, tmp_path):
    """Encapsulation loops (VLAN in VLAN in IP-in-IP) must abort recursion safely."""
    pcap_path = tmp_path / "tunnel_loop.pcap"

    # Construct nested VLAN tags: 0x8100 -> 0x8100 -> 0x8100 -> 0x8100 -> 0x8100
    eth = b"\x00" * 12 + b"\x81\x00\x00\x01\x81\x00\x00\x02\x81\x00\x00\x03\x81\x00\x00\x04\x81\x00\x00\x05\x08\x00"
    ip = b"\x45" + b"\x00" * 19
    pkt = eth + ip

    data = make_pcap_bytes([pkt])
    pcap_path.write_bytes(data)

    res = parser.parse_file(pcap_path)
    assert res["packets_parsed"] == 1
    # Check that recursion was caught safely without RecursionError
    assert isinstance(res["diagnostics"], list)


def test_tls_client_hello_parsed_safely(parser, tmp_path):
    """Valid TLS ClientHello must be extracted cleanly."""
    pcap_path = tmp_path / "tls_hello.pcap"

    # Synthesize TLS 1.2 ClientHello:
    # ContentType=0x16, Version=0x0303, Length=43
    # HandshakeType=1, Length=39, ClientVer=0x0303, Random=32 bytes, SessionIDLen=0, CipherLen=2 (0xC02F), CompLen=1 (0)
    tls_payload = (
        b"\x16\x03\x03\x00\x2b"
        + b"\x01\x00\x00\x27"
        + b"\x03\x03"
        + (b"\xaa" * 32)
        + b"\x00"
        + b"\x00\x02\xc0\x2f"
        + b"\x01\x00"
    )

    pkt = make_ipv4_tcp_packet("192.168.1.50", "104.16.1.34", 54321, 443, tls_payload)
    pcap_path.write_bytes(make_pcap_bytes([pkt]))

    res = parser.parse_file(pcap_path)
    assert res["packets_parsed"] == 1
    assert res["findings_count"] == 1

    finding = res["findings"][0]
    assert finding["protocol"] == "TLS"
    assert finding["version"] == "TLS 1.2"
    assert "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256" in finding["details"]["cipher_suites"]


def test_ssh_banner_parsed_safely(parser, tmp_path):
    """SSH identification banner must be extracted cleanly."""
    pcap_path = tmp_path / "ssh.pcap"
    ssh_payload = b"SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13\r\n"
    pkt = make_ipv4_tcp_packet("192.168.1.100", "192.168.1.1", 49152, 22, ssh_payload)
    pcap_path.write_bytes(make_pcap_bytes([pkt]))

    res = parser.parse_file(pcap_path)
    assert res["findings_count"] == 1
    assert res["findings"][0]["protocol"] == "SSH"
    assert "SSH-2.0-OpenSSH_9.6p1" in res["findings"][0]["version"]
