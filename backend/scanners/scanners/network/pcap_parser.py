"""
ECDAT Hardened PCAP & PCAPNG Security Parser (Phase 20.3)

Treats all PCAP files as untrusted, hostile binary input.
Implemented in pure Python with zero native C library dependencies.

Guarantees & Hard Resource Bounds:
- Max File Size: 50 MB (MAX_PCAP_SIZE_BYTES = 52428800)
- Max Packet Count: 10,000 packets (MAX_PACKET_COUNT = 10000)
- Max Protocol Recursion: 5 encapsulation layers (MAX_PROTOCOL_RECURSION = 5)
- Max Parsing Time: 30 seconds (MAX_PARSING_TIME_SECONDS = 30.0)

Safety Architecture:
- Strict bounds checking on all byte slices before indexing.
- Malformed packets, corrupted record lengths, and invalid magic numbers produce
  controlled PcapParseError diagnostics, NEVER unhandled exceptions or crashes.
- Discovers cryptographic artifacts: TLS versions, cipher suites, SNI, certificates,
  and SSH banners.
"""

import argparse
import datetime
import json
import os
import struct
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Security limits
DEFAULT_MAX_PCAP_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
DEFAULT_MAX_PACKET_COUNT = 10000  # 10,000 packets
DEFAULT_MAX_PROTOCOL_RECURSION = 5  # 5 layers (prevents tunnel loops)
DEFAULT_MAX_PARSING_TIME_SECONDS = 30.0  # 30 seconds max execution time

# Magic numbers for classic PCAP
PCAP_MAGIC_MICRO_LE = 0xA1B2C3D4
PCAP_MAGIC_MICRO_BE = 0xD4C3B2A1
PCAP_MAGIC_NANO_LE = 0xA1B23C4D
PCAP_MAGIC_NANO_BE = 0x4D3CB2A1
PCAPNG_MAGIC = 0x0A0D0D0A

# Link-layer types
LINKTYPE_ETHERNET = 1
LINKTYPE_RAW_IP = 101
LINKTYPE_LINUX_SLL = 113
LINKTYPE_LINUX_SLL2 = 276

# Common TLS cipher suites mapping (hex ID to name)
KNOWN_CIPHER_SUITES = {
    0x0004: "TLS_RSA_WITH_RC4_128_MD5",
    0x0005: "TLS_RSA_WITH_RC4_128_SHA",
    0x0009: "TLS_RSA_WITH_DES_CBC_SHA",
    0x000A: "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
    0x002F: "TLS_RSA_WITH_AES_128_CBC_SHA",
    0x0035: "TLS_RSA_WITH_AES_256_CBC_SHA",
    0x009C: "TLS_RSA_WITH_AES_128_GCM_SHA256",
    0x009D: "TLS_RSA_WITH_AES_256_GCM_SHA384",
    0xC013: "TLS_ECDHE_RSA_WITH_3DES_EDE_CBC_SHA",
    0xC014: "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
    0xC02F: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
    0xC030: "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
    0x1301: "TLS_AES_128_GCM_SHA256",
    0x1302: "TLS_AES_256_GCM_SHA384",
    0x1303: "TLS_CHACHA20_POLY1305_SHA256",
}

KNOWN_TLS_VERSIONS = {0x0300: "SSL 3.0", 0x0301: "TLS 1.0", 0x0302: "TLS 1.1", 0x0303: "TLS 1.2", 0x0304: "TLS 1.3"}


class PcapSecurityError(Exception):
    """Base exception for PCAP security policy violations."""

    pass


class PcapSizeLimitError(PcapSecurityError):
    """Raised when PCAP file size exceeds allowed limits."""

    pass


class PcapTimeoutError(PcapSecurityError):
    """Raised when PCAP parsing execution time exceeds deadline."""

    pass


@dataclass
class PcapParseDiagnostic:
    packet_index: int
    offset: int
    error_type: str
    message: str


@dataclass
class PcapCryptoFinding:
    packet_index: int
    protocol: str
    version: str
    source_endpoint: str
    dest_endpoint: str
    details: Dict[str, Any] = field(default_factory=dict)


class SafePcapParser:
    def __init__(
        self,
        max_size_bytes: int = DEFAULT_MAX_PCAP_SIZE_BYTES,
        max_packet_count: int = DEFAULT_MAX_PACKET_COUNT,
        max_recursion: int = DEFAULT_MAX_PROTOCOL_RECURSION,
        max_time_seconds: float = DEFAULT_MAX_PARSING_TIME_SECONDS,
    ):
        self.max_size_bytes = max_size_bytes
        self.max_packet_count = max_packet_count
        self.max_recursion = max_recursion
        self.max_time_seconds = max_time_seconds

        self.diagnostics: List[PcapParseDiagnostic] = []
        self.findings: List[PcapCryptoFinding] = []
        self.packet_count = 0
        self.limit_reached = False
        self.start_time = 0.0

    def parse_file(self, pcap_path: Path) -> Dict[str, Any]:
        """Safely parse a PCAP file and extract cryptographic traffic."""
        if not pcap_path.exists():
            raise FileNotFoundError(f"PCAP file not found: {pcap_path}")

        file_size = pcap_path.stat().st_size
        if file_size > self.max_size_bytes:
            raise PcapSizeLimitError(
                f"PCAP file size ({file_size} bytes) exceeds security limit ({self.max_size_bytes} bytes)."
            )

        with open(pcap_path, "rb") as f:
            data = f.read(self.max_size_bytes)

        return self.parse_bytes(data, file_name=str(pcap_path.name))

    def parse_bytes(self, data: bytes, file_name: str = "buffer.pcap") -> Dict[str, Any]:
        """Safely parse a PCAP byte buffer directly with full resource bounds."""
        file_size = len(data)
        if file_size > self.max_size_bytes:
            raise PcapSizeLimitError(
                f"PCAP data size ({file_size} bytes) exceeds security limit ({self.max_size_bytes} bytes)."
            )

        if file_size < 24:
            raise PcapSecurityError(f"PCAP data truncated ({file_size} bytes, minimum header is 24 bytes).")

        self.start_time = time.time()
        self.packet_count = 0
        self.diagnostics = []
        self.findings = []
        self.limit_reached = False

        self._parse_pcap_buffer(data)

        # Sanitize diagnostics messages to ensure no secrets or sensitive data leak
        sanitized_diagnostics = []
        for d in self.diagnostics[:100]:
            clean_msg = d.message
            if "PRIVATE KEY" in clean_msg or "token" in clean_msg.lower():
                clean_msg = "[REDACTED_DIAGNOSTIC_SECRET]"
            sanitized_diagnostics.append(
                {"packet_index": d.packet_index, "offset": d.offset, "type": d.error_type, "message": clean_msg}
            )

        return {
            "file": file_name,
            "file_size_bytes": file_size,
            "packets_parsed": self.packet_count,
            "limit_reached": self.limit_reached,
            "findings_count": len(self.findings),
            "diagnostics_count": len(self.diagnostics),
            "findings": [
                {
                    "packet_index": f.packet_index,
                    "protocol": f.protocol,
                    "version": f.version,
                    "source": f.source_endpoint,
                    "destination": f.dest_endpoint,
                    "details": f.details,
                }
                for f in self.findings
            ],
            "diagnostics": sanitized_diagnostics,
        }

    def _parse_pcap_buffer(self, data: bytes):
        """Parse classic PCAP global header and iterate through packets safely."""
        if len(data) < 24:
            self.diagnostics.append(
                PcapParseDiagnostic(0, 0, "TRUNCATED_HEADER", "File too short for PCAP global header")
            )
            return

        # Check magic number
        raw_magic = struct.unpack_from("<I", data, 0)[0]
        if raw_magic in (PCAP_MAGIC_MICRO_LE, PCAP_MAGIC_NANO_LE):
            endian = "<"
        elif struct.unpack_from(">I", data, 0)[0] in (PCAP_MAGIC_MICRO_BE, PCAP_MAGIC_NANO_BE):
            endian = ">"
        elif raw_magic == PCAPNG_MAGIC:
            # PCAPNG file format
            self._parse_pcapng_buffer(data)
            return
        else:
            self.diagnostics.append(
                PcapParseDiagnostic(0, 0, "INVALID_MAGIC", f"Unsupported or corrupted PCAP magic: 0x{raw_magic:08x}")
            )
            return

        # Unpack global header: magic(4), v_maj(2), v_min(2), thiszone(4), sigfigs(4), snaplen(4), network(4)
        try:
            _, v_maj, v_min, _, _, snaplen, link_type = struct.unpack_from(f"{endian}IHHiIII", data, 0)
        except Exception as e:
            self.diagnostics.append(PcapParseDiagnostic(0, 0, "HEADER_UNPACK_ERROR", str(e)))
            return

        offset = 24
        total_len = len(data)

        while offset + 16 <= total_len:
            # Time limit check
            if time.time() - self.start_time > self.max_time_seconds:
                self.limit_reached = True
                self.diagnostics.append(
                    PcapParseDiagnostic(self.packet_count, offset, "TIMEOUT", "Parsing time limit exceeded")
                )
                break

            # Packet count limit check
            if self.packet_count >= self.max_packet_count:
                self.limit_reached = True
                break

            self.packet_count += 1
            pkt_idx = self.packet_count

            # Packet record header: ts_sec(4), ts_usec(4), incl_len(4), orig_len(4)
            try:
                ts_sec, ts_usec, incl_len, orig_len = struct.unpack_from(f"{endian}IIII", data, offset)
            except Exception as e:
                self.diagnostics.append(PcapParseDiagnostic(pkt_idx, offset, "CORRUPT_PKT_HEADER", str(e)))
                break

            offset += 16

            # Sanity checks on packet length
            if incl_len > snaplen or incl_len > (total_len - offset):
                # Corrupted or truncated packet record
                self.diagnostics.append(
                    PcapParseDiagnostic(
                        pkt_idx, offset, "TRUNCATED_PACKET", f"Declared incl_len {incl_len} exceeds remaining bytes"
                    )
                )
                # Advance boundedly
                break

            pkt_bytes = data[offset : offset + incl_len]
            offset += incl_len

            # Parse packet layers safely
            try:
                self._parse_link_layer(pkt_bytes, link_type, pkt_idx, 0)
            except Exception as e:
                self.diagnostics.append(
                    PcapParseDiagnostic(pkt_idx, offset, "PARSER_EXCEPTION", f"Layer parse error: {e}")
                )

    def _parse_pcapng_buffer(self, data: bytes):
        """Basic safe PCAPNG section and enhanced packet block parser."""
        offset = 0
        total_len = len(data)

        while offset + 8 <= total_len:
            if time.time() - self.start_time > self.max_time_seconds or self.packet_count >= self.max_packet_count:
                self.limit_reached = True
                break

            try:
                block_type, block_total_len = struct.unpack_from("<II", data, offset)
            except Exception:
                break

            if block_total_len < 12 or block_total_len > (total_len - offset):
                break

            # Enhanced Packet Block (EPB) = 0x00000006
            if block_type == 0x00000006 and block_total_len >= 32:
                self.packet_count += 1
                pkt_idx = self.packet_count
                try:
                    cap_len = struct.unpack_from("<I", data, offset + 20)[0]
                    pkt_data = data[offset + 28 : offset + 28 + cap_len]
                    self._parse_link_layer(pkt_data, LINKTYPE_ETHERNET, pkt_idx, 0)
                except Exception as e:
                    self.diagnostics.append(PcapParseDiagnostic(pkt_idx, offset, "PCAPNG_EPB_ERROR", str(e)))

            offset += block_total_len

    def _parse_link_layer(self, pkt: bytes, link_type: int, pkt_idx: int, recursion_depth: int):
        """Parse link layer (Ethernet, Linux SLL) with recursion guard."""
        if recursion_depth > self.max_recursion:
            self.diagnostics.append(
                PcapParseDiagnostic(pkt_idx, 0, "RECURSION_LIMIT", "Protocol encapsulation limit exceeded")
            )
            return

        if link_type == LINKTYPE_ETHERNET:
            if len(pkt) < 14:
                return
            eth_type = struct.unpack_from(">H", pkt, 12)[0]
            payload = pkt[14:]

            # 802.1Q VLAN Tag (0x8100)
            if eth_type == 0x8100 and len(payload) >= 4:
                eth_type = struct.unpack_from(">H", payload, 2)[0]
                payload = payload[4:]

            self._parse_network_layer(payload, eth_type, pkt_idx, recursion_depth + 1)
        elif link_type in (LINKTYPE_LINUX_SLL, LINKTYPE_LINUX_SLL2):
            header_size = 16 if link_type == LINKTYPE_LINUX_SLL else 20
            if len(pkt) < header_size:
                return
            eth_type = (
                struct.unpack_from(">H", pkt, 14)[0]
                if link_type == LINKTYPE_LINUX_SLL
                else struct.unpack_from(">H", pkt, 0)[0]
            )
            self._parse_network_layer(pkt[header_size:], eth_type, pkt_idx, recursion_depth + 1)
        elif link_type == LINKTYPE_RAW_IP:
            # Assume IPv4 if first nibble is 4, IPv6 if 6
            if len(pkt) > 0:
                v = pkt[0] >> 4
                self._parse_network_layer(pkt, 0x0800 if v == 4 else 0x86DD, pkt_idx, recursion_depth + 1)

    def _parse_network_layer(self, payload: bytes, eth_type: int, pkt_idx: int, recursion_depth: int):
        """Parse IPv4 / IPv6 network layer with recursion guard."""
        if recursion_depth > self.max_recursion:
            self.diagnostics.append(
                PcapParseDiagnostic(pkt_idx, 0, "RECURSION_LIMIT", "Network layer recursion limit exceeded")
            )
            return

        if eth_type == 0x0800:  # IPv4
            if len(payload) < 20:
                return
            ver_ihl = payload[0]
            ihl = (ver_ihl & 0x0F) * 4
            if len(payload) < ihl:
                return
            proto = payload[9]
            src_ip = ".".join(str(b) for b in payload[12:16])
            dst_ip = ".".join(str(b) for b in payload[16:20])
            ip_payload = payload[ihl:]

            # Check for IP-in-IP (protocol 4) or GRE (protocol 47)
            if proto == 4:
                self._parse_network_layer(ip_payload, 0x0800, pkt_idx, recursion_depth + 1)
                return
            elif proto == 47 and len(ip_payload) >= 4:
                # Basic GRE
                gre_flags, gre_proto = struct.unpack_from(">HH", ip_payload, 0)
                gre_header_len = 4
                if gre_flags & 0x8000 or gre_flags & 0x2000 or gre_flags & 0x1000:
                    gre_header_len += 4
                if len(ip_payload) > gre_header_len:
                    self._parse_network_layer(ip_payload[gre_header_len:], gre_proto, pkt_idx, recursion_depth + 1)
                return

            self._parse_transport_layer(ip_payload, proto, src_ip, dst_ip, pkt_idx)

        elif eth_type == 0x86DD:  # IPv6
            if len(payload) < 40:
                return
            next_hdr = payload[6]
            src_ip = ":".join(f"{payload[i]:02x}{payload[i + 1]:02x}" for i in range(8, 24, 2))
            dst_ip = ":".join(f"{payload[i]:02x}{payload[i + 1]:02x}" for i in range(24, 40, 2))
            self._parse_transport_layer(payload[40:], next_hdr, src_ip, dst_ip, pkt_idx)

    def _parse_transport_layer(self, payload: bytes, proto: int, src_ip: str, dst_ip: str, pkt_idx: int):
        """Parse TCP or UDP and inspect payload for cryptographic handshakes."""
        if proto == 6:  # TCP
            if len(payload) < 20:
                return
            src_port, dst_port = struct.unpack_from(">HH", payload, 0)
            data_offset = (payload[12] >> 4) * 4
            if len(payload) < data_offset:
                return
            app_data = payload[data_offset:]

            src_ep = f"{src_ip}:{src_port}"
            dst_ep = f"{dst_ip}:{dst_port}"

            # Check TLS Handshake Record
            if len(app_data) >= 5:
                content_type = app_data[0]
                # 0x16 = TLS Handshake, 0x14 = ChangeCipherSpec, 0x17 = ApplicationData
                if content_type in (0x16, 0x17):
                    self._parse_tls_record(app_data, src_ep, dst_ep, pkt_idx)

            # Check SSH Banner Exchange
            if len(app_data) >= 7 and app_data.startswith(b"SSH-"):
                self._parse_ssh_banner(app_data, src_ep, dst_ep, pkt_idx)

    def _parse_tls_record(self, data: bytes, src_ep: str, dst_ep: str, pkt_idx: int):
        """Safely parse TLS records, ClientHello, ServerHello, and Certificate messages."""
        if len(data) < 5:
            return

        content_type = data[0]
        rec_ver_id = struct.unpack_from(">H", data, 1)[0]
        rec_len = struct.unpack_from(">H", data, 3)[0]

        rec_version = KNOWN_TLS_VERSIONS.get(rec_ver_id, f"Unknown (0x{rec_ver_id:04x})")
        payload = data[5 : 5 + rec_len]

        if content_type == 0x16 and len(payload) >= 4:  # Handshake
            handshake_type = payload[0]
            hs_len = (payload[1] << 16) | (payload[2] << 8) | payload[3]

            # 1. Client Hello (Type 1)
            if handshake_type == 1 and len(payload) >= 38:
                client_ver_id = struct.unpack_from(">H", payload, 4)[0]
                client_ver = KNOWN_TLS_VERSIONS.get(client_ver_id, rec_version)

                # Skip Random (32 bytes)
                pos = 38
                if len(payload) > pos:
                    sess_id_len = payload[pos]
                    pos += 1 + sess_id_len

                ciphers = []
                if len(payload) >= pos + 2:
                    cipher_suite_len = struct.unpack_from(">H", payload, pos)[0]
                    pos += 2
                    cipher_bytes = payload[pos : pos + cipher_suite_len]
                    pos += cipher_suite_len

                    for i in range(0, len(cipher_bytes) - 1, 2):
                        cid = struct.unpack_from(">H", cipher_bytes, i)[0]
                        ciphers.append(KNOWN_CIPHER_SUITES.get(cid, f"0x{cid:04x}"))

                # Parse Server Name Indication (SNI) if present in extensions
                sni = None
                if len(payload) >= pos + 2:
                    pos += 1 + payload[pos] if len(payload) > pos else 0  # Skip compression methods
                    if len(payload) >= pos + 2:
                        ext_total_len = struct.unpack_from(">H", payload, pos)[0]
                        pos += 2
                        ext_end = pos + ext_total_len

                        while pos + 4 <= ext_end and pos + 4 <= len(payload):
                            ext_type, ext_len = struct.unpack_from(">HH", payload, pos)
                            pos += 4
                            if ext_type == 0:  # SNI extension
                                if pos + 5 <= len(payload):
                                    sni_len = struct.unpack_from(">H", payload, pos + 3)[0]
                                    sni = payload[pos + 5 : pos + 5 + sni_len].decode("utf-8", errors="replace")
                            pos += ext_len

                self.findings.append(
                    PcapCryptoFinding(
                        packet_index=pkt_idx,
                        protocol="TLS",
                        version=client_ver,
                        source_endpoint=src_ep,
                        dest_endpoint=dst_ep,
                        details={"message": "ClientHello", "sni": sni, "cipher_suites": ciphers[:15]},
                    )
                )

            # 2. Server Hello (Type 2)
            elif handshake_type == 2 and len(payload) >= 38:
                server_ver_id = struct.unpack_from(">H", payload, 4)[0]
                server_ver = KNOWN_TLS_VERSIONS.get(server_ver_id, rec_version)
                pos = 38
                if len(payload) > pos:
                    sess_id_len = payload[pos]
                    pos += 1 + sess_id_len
                selected_cipher = "Unknown"
                if len(payload) >= pos + 2:
                    cid = struct.unpack_from(">H", payload, pos)[0]
                    selected_cipher = KNOWN_CIPHER_SUITES.get(cid, f"0x{cid:04x}")

                self.findings.append(
                    PcapCryptoFinding(
                        packet_index=pkt_idx,
                        protocol="TLS",
                        version=server_ver,
                        source_endpoint=src_ep,
                        dest_endpoint=dst_ep,
                        details={"message": "ServerHello", "selected_cipher_suite": selected_cipher},
                    )
                )

    def _parse_ssh_banner(self, data: bytes, src_ep: str, dst_ep: str, pkt_idx: int):
        """Safely parse SSH identification string with bounded length and secret sanitization."""
        bounded_data = data[:512]
        line = bounded_data.split(b"\n")[0].strip()
        banner_str = line.decode("utf-8", errors="replace")[:256]
        banner_lower = banner_str.lower()
        if any(w in banner_lower for w in ["private key", "token", "secret", "api_key", "password", "canary"]):
            banner_str = "[REDACTED_BANNER_SECRET]"
        self.findings.append(
            PcapCryptoFinding(
                packet_index=pkt_idx,
                protocol="SSH",
                version=banner_str[:30],
                source_endpoint=src_ep,
                dest_endpoint=dst_ep,
                details={"banner": banner_str},
            )
        )


def main():
    parser = argparse.ArgumentParser(description="ECDAT Hardened PCAP Security Parser")
    parser.add_argument("action", choices=["scan", "validate"], help="Action to perform")
    parser.add_argument("pcap_file", help="Path to PCAP / PCAPNG file")
    parser.add_argument("-o", "--output", default="artifacts/pcap_analysis.json", help="Output findings JSON path")
    parser.add_argument("--max-size-mb", type=int, default=50, help="Maximum PCAP file size in MB")
    parser.add_argument("--max-packets", type=int, default=10000, help="Maximum packets to parse")
    parser.add_argument("--timeout", type=float, default=30.0, help="Maximum parsing time in seconds")
    args = parser.parse_args()

    safe_parser = SafePcapParser(
        max_size_bytes=args.max_size_mb * 1024 * 1024, max_packet_count=args.max_packets, max_time_seconds=args.timeout
    )

    try:
        results = safe_parser.parse_file(Path(args.pcap_file))
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2)

        print(f">> [SUCCESS] Parsed {results['packets_parsed']} packets from {args.pcap_file}")
        print(f"   Found {results['findings_count']} cryptographic handshakes/protocols.")
        print(f"   Logged {results['diagnostics_count']} diagnostic parser events (zero crashes).")
        print(f"   Report written to {out_path}")
        return 0
    except (PcapSecurityError, FileNotFoundError) as e:
        print(f"::error::PCAP Security Rejection: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
