import socket
import struct
import threading
import time
import pytest
from scanners.network.plugins.ssh import SshScanner
from scanners.network.target_validation import NormalizedTarget

def create_mock_ssh_server(port, kex_algs, host_key_algs):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", port))
    server.listen(1)

    def handle_client():
        try:
            conn, addr = server.accept()
            # Send banner
            conn.sendall(b"SSH-2.0-MockServer\r\n")
            
            # Receive client banner
            banner = b""
            while b"\n" not in banner:
                banner += conn.recv(1)
                
            # Send KEXINIT
            # Cookie (16 bytes)
            payload = bytes([20]) + b"A" * 16
            
            def add_name_list(names):
                name_bytes = ",".join(names).encode("utf-8")
                return struct.pack(">I", len(name_bytes)) + name_bytes
                
            payload += add_name_list(kex_algs)
            payload += add_name_list(host_key_algs)
            payload += add_name_list(["aes128-ctr"]) # enc c2s
            payload += add_name_list(["aes128-ctr"]) # enc s2c
            payload += add_name_list(["hmac-sha2-256"]) # mac c2s
            payload += add_name_list(["hmac-sha2-256"]) # mac s2c
            payload += add_name_list(["none"]) # comp c2s
            payload += add_name_list(["none"]) # comp s2c
            payload += add_name_list([""]) # lang c2s
            payload += add_name_list([""]) # lang s2c
            payload += bytes([0]) # first_kex_packet_follows
            payload += struct.pack(">I", 0) # reserved
            
            padding_len = 8 - ((len(payload) + 5) % 8)
            if padding_len < 4:
                padding_len += 8
                
            packet_len = len(payload) + padding_len + 1
            
            packet = struct.pack(">I", packet_len)
            packet += struct.pack(">B", padding_len)
            packet += payload
            packet += b"P" * padding_len
            
            conn.sendall(packet)
            
            time.sleep(0.5)
            conn.close()
        except Exception as e:
            print("Server exception:", e)
        finally:
            server.close()
            
    t = threading.Thread(target=handle_client)
    t.daemon = True
    t.start()
    return server

def test_ssh_pqc_ground_truth():
    port = 2222
    kex_algs = ["sntrup761x25519-sha512@openssh.com", "mlkem768x25519-sha256", "curve25519-sha256"]
    host_key_algs = ["ssh-ed25519"]
    
    server = create_mock_ssh_server(port, kex_algs, host_key_algs)
    time.sleep(0.5)
    
    scanner = SshScanner()
    target = NormalizedTarget(
        original_input=f"127.0.0.1:{port}",
        hostname="127.0.0.1",
        resolved_ip="127.0.0.1",
        port=port
    )
    
    try:
        findings = scanner.scan([target], max_concurrency=1)
        assert len(findings) == 1
        f = findings[0]
        
        assert f.scan_status == "success"
        assert "sntrup761x25519-sha512@openssh.com" in f.pqc_groups_accepted
        assert "mlkem768x25519-sha256" in f.pqc_groups_accepted
        assert "shor_vulnerable_key_exchange" in f.quantum_vulnerabilities
        
        print("SSH ground truth passed.")
    finally:
        server.close()

if __name__ == "__main__":
    test_ssh_pqc_ground_truth()
