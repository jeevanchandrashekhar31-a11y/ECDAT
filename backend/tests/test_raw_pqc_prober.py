import socket
import threading
import pytest
from typing import Tuple
from scanners.network.plugins.raw_pqc_prober import probe_tls13_group, PqcGroup

# The standard TLS 1.3 HelloRetryRequest random
HRR_RANDOM = bytes.fromhex("CF21AD74E59A6111BE1D8C021E65B891C2A211167ABB8C5E079E09E2C8A8339C")

def fake_tls_server(host, port, response_mode: str, group_id: int):
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind((host, port))
    server.listen(1)
    
    def handle():
        try:
            conn, _ = server.accept()
            data = conn.recv(1024)
            if not data:
                return
                
            if response_mode == "HRR":
                # Send ServerHello with HRR random
                # Record Header (5 bytes): Handshake (22), TLS 1.2 (03 03), length
                # Handshake Header (4 bytes): ServerHello (2), length
                # ServerHello payload: TLS 1.2 (03 03), HRR_RANDOM, ...
                payload = b"\x03\x03" + HRR_RANDOM + b"\x00" + b"\x13\x01" + b"\x00" + b"\x00\x00"
                handshake = b"\x02" + len(payload).to_bytes(3, "big") + payload
                record = b"\x16\x03\x03" + len(handshake).to_bytes(2, "big") + handshake
                conn.sendall(record)
            elif response_mode == "ALERT":
                # Send Handshake Failure Alert (2, 40)
                record = b"\x15\x03\x03\x00\x02\x02\x28"
                conn.sendall(record)
            elif response_mode == "SERVER_HELLO_NATIVE":
                # Send ServerHello with regular random and KeyShare extension matching the group
                # Extensions: KeyShare (0x0033) length 4 -> group_id (2) length (2)
                ext = b"\x00\x33\x00\x04" + group_id.to_bytes(2, "big") + b"\x00\x00"
                payload = b"\x03\x03" + (b"\x00" * 32) + b"\x00" + b"\x13\x01" + b"\x00" + len(ext).to_bytes(2, "big") + ext
                handshake = b"\x02" + len(payload).to_bytes(3, "big") + payload
                record = b"\x16\x03\x03" + len(handshake).to_bytes(2, "big") + handshake
                conn.sendall(record)
            elif response_mode == "SERVER_HELLO_WRONG_GROUP":
                ext = b"\x00\x33\x00\x04" + (group_id + 1).to_bytes(2, "big") + b"\x00\x00"
                payload = b"\x03\x03" + (b"\x00" * 32) + b"\x00" + b"\x13\x01" + b"\x00" + len(ext).to_bytes(2, "big") + ext
                handshake = b"\x02" + len(payload).to_bytes(3, "big") + payload
                record = b"\x16\x03\x03" + len(handshake).to_bytes(2, "big") + handshake
                conn.sendall(record)
            elif response_mode == "GARBAGE":
                conn.sendall(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            elif response_mode == "TRUNCATED":
                record = b"\x16\x03\x03\x00\x50\x02"
                conn.sendall(record)
            elif response_mode == "LENGTH_LARGER_THAN_DATA":
                record = b"\x16\x03\x03\x00\xff\x02\x00\x00\x10" + (b"\x00" * 16)
                conn.sendall(record)
            elif response_mode == "SLOW":
                import time
                time.sleep(3)
                conn.sendall(b"\x15\x03\x03\x00\x02\x02\x28")
                
            conn.close()
        except Exception:
            pass
        finally:
            server.close()
            
    t = threading.Thread(target=handle)
    t.start()
    return t, server.getsockname()[1]

def test_pqc_prober_hrr():
    t, port = fake_tls_server("127.0.0.1", 0, "HRR", 0x11EC)
    supported = probe_tls13_group("127.0.0.1", port, PqcGroup.X25519_MLKEM768, timeout=2)
    assert supported is True
    t.join()

def test_pqc_prober_alert():
    t, port = fake_tls_server("127.0.0.1", 0, "ALERT", 0x11EC)
    supported = probe_tls13_group("127.0.0.1", port, PqcGroup.X25519_MLKEM768, timeout=2)
    assert supported is False
    t.join()

def test_pqc_prober_server_hello_native():
    t, port = fake_tls_server("127.0.0.1", 0, "SERVER_HELLO_NATIVE", 0x11EC)
    supported = probe_tls13_group("127.0.0.1", port, PqcGroup.X25519_MLKEM768, timeout=2)
    assert supported is True
    t.join()

def test_pqc_prober_garbage():
    t, port = fake_tls_server("127.0.0.1", 0, "GARBAGE", 0x11EC)
    supported = probe_tls13_group("127.0.0.1", port, PqcGroup.X25519_MLKEM768, timeout=2)
    assert supported is False
    t.join()

def test_pqc_prober_wrong_group():
    t, port = fake_tls_server("127.0.0.1", 0, "SERVER_HELLO_WRONG_GROUP", 0x11EC)
    supported = probe_tls13_group("127.0.0.1", port, PqcGroup.X25519_MLKEM768, timeout=2)
    assert supported is False
    t.join()

def test_pqc_prober_truncated():
    t, port = fake_tls_server("127.0.0.1", 0, "TRUNCATED", 0x11EC)
    supported = probe_tls13_group("127.0.0.1", port, PqcGroup.X25519_MLKEM768, timeout=2)
    assert supported is False
    t.join()
    
def test_pqc_prober_length_larger_than_data():
    t, port = fake_tls_server("127.0.0.1", 0, "LENGTH_LARGER_THAN_DATA", 0x11EC)
    supported = probe_tls13_group("127.0.0.1", port, PqcGroup.X25519_MLKEM768, timeout=2)
    assert supported is False
    t.join()
    
def test_pqc_prober_slow():
    t, port = fake_tls_server("127.0.0.1", 0, "SLOW", 0x11EC)
    supported = probe_tls13_group("127.0.0.1", port, PqcGroup.X25519_MLKEM768, timeout=1)
    assert supported is False
    t.join()
