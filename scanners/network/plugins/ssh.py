import socket
import struct
import logging
from typing import List
from datetime import datetime, timezone

from scanners.models import NetworkCryptoFinding
from scanners.network.target_validation import NormalizedTarget

logger = logging.getLogger(__name__)


def get_ssh_capabilities(host: str, port: int, timeout: int = 5):
    with socket.create_connection((host, port), timeout=timeout) as s:
        banner = b""
        while b"\n" not in banner:
            banner += s.recv(1)
            if len(banner) > 1024:
                break
        banner_str = banner.decode("utf-8", errors="ignore").strip()

        s.sendall(b"SSH-2.0-ECDAT_Scanner\r\n")

        packet_len_data = s.recv(4)
        if len(packet_len_data) < 4:
            return banner_str, None
        packet_len = struct.unpack(">I", packet_len_data)[0]
        if packet_len < 1 or packet_len > 256 * 1024:
            return banner_str, None

        padding_len = struct.unpack(">B", s.recv(1))[0]

        payload = s.recv(packet_len - 1)
        if padding_len > 0:
            payload = payload[:-padding_len]

        if not payload or payload[0] != 20:
            return banner_str, None

        offset = 17

        def read_name_list():
            nonlocal offset
            if offset + 4 > len(payload):
                return []
            length = struct.unpack(">I", payload[offset : offset + 4])[0]
            offset += 4
            if offset + length > len(payload):
                return []
            names = payload[offset : offset + length].decode("utf-8", errors="ignore").split(",")
            offset += length
            return [n for n in names if n]

        kex_algs = read_name_list()
        host_key_algs = read_name_list()
        enc_algs_c2s = read_name_list()
        enc_algs_s2c = read_name_list()
        mac_algs_c2s = read_name_list()
        mac_algs_s2c = read_name_list()
        comp_algs_c2s = read_name_list()
        comp_algs_s2c = read_name_list()

        return banner_str, {
            "kex": kex_algs,
            "host_key": host_key_algs,
            "encryption": list(set(enc_algs_c2s + enc_algs_s2c)),
            "mac": list(set(mac_algs_c2s + mac_algs_s2c)),
            "compression": list(set(comp_algs_c2s + comp_algs_s2c)),
        }


class SshScanner:
    def scan(
        self, targets: List[NormalizedTarget], max_concurrency: int, timeout: int = 15
    ) -> List[NetworkCryptoFinding]:
        findings = []
        for t in targets:
            finding = NetworkCryptoFinding(
                bom_ref=f"net:target/{t.hostname}:{t.port}",
                host=t.hostname,
                port=t.port,
                target_supplied=t.original_input,
                timestamp=datetime.now(timezone.utc).isoformat(),
                resolved_endpoint=f"{t.resolved_ip}:{t.port}" if t.resolved_ip else None,
                protocol="SSH",
            )
            if not t.resolved_ip:
                finding.scan_status = "failed"
                finding.error_reason = "No resolved IP available."
                findings.append(finding)
                continue

            try:
                banner, caps = get_ssh_capabilities(t.resolved_ip, t.port, timeout=timeout)
                finding.tls_versions = [banner] if banner else ["SSH-Unknown"]
                if caps:
                    ciphers = []
                    ciphers.extend([f"kex:{x}" for x in caps["kex"]])
                    ciphers.extend([f"hostkey:{x}" for x in caps["host_key"]])
                    ciphers.extend([f"enc:{x}" for x in caps["encryption"]])
                    ciphers.extend([f"mac:{x}" for x in caps["mac"]])
                    ciphers.extend([f"comp:{x}" for x in caps["compression"]])
                    finding.cipher_suites = ciphers
                    finding.key_exchanges = list(caps.get("kex", []))
                    finding.signature_algorithms = list(caps.get("host_key", []))

                    # Weak SSH algorithms
                    weak = []
                    for k in caps.get("kex", []):
                        if "sha1" in k.lower() or "group1-" in k:
                            weak.append(f"weak_kex:{k}")
                    for hk in caps.get("host_key", []):
                        if "dss" in hk.lower() or hk == "ssh-rsa":
                            weak.append(f"weak_host_key:{hk}")
                    for enc in caps.get("encryption", []):
                        if "arcfour" in enc.lower() or "3des" in enc.lower() or "des" in enc.lower():
                            weak.append(f"weak_cipher:{enc}")
                        elif "-cbc" in enc.lower():
                            weak.append(f"vulnerable_cipher_mode_cbc:{enc}")
                    for mac in caps.get("mac", []):
                        if "md5" in mac.lower():
                            weak.append(f"weak_mac:{mac}")
                        elif "sha1" in mac.lower():
                            weak.append(f"deprecated_mac:{mac}")
                    finding.weak_algorithms = sorted(list(set(weak)))

                    # Quantum vulnerabilities
                    q_vulns = []
                    if any("diffie-hellman" in k.lower() or "curve25519" in k.lower() or "ecdh" in k.lower() for k in caps.get("kex", [])):
                        q_vulns.append("shor_vulnerable_key_exchange")
                    if any("rsa" in hk.lower() or "ecdsa" in hk.lower() or "ed25519" in hk.lower() or "dss" in hk.lower() for hk in caps.get("host_key", [])):
                        q_vulns.append("shor_vulnerable_host_key")
                    if any("128" in enc for enc in caps.get("encryption", [])):
                        q_vulns.append("grover_sensitive_symmetric_cipher")
                    finding.quantum_vulnerabilities = sorted(list(set(q_vulns)))

                    finding.scan_status = "success"
                else:
                    finding.scan_status = "partial"
                    finding.error_reason = "Failed to complete KEXINIT"
            except Exception as e:
                finding.scan_status = "failed"
                finding.error_reason = f"SSH error: {e}"

            findings.append(finding)
        return findings
