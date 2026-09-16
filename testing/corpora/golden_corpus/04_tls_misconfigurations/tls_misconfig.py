"""
Category: TLS Misconfigurations (Phase 22.3 Golden Corpus)
Contains dangerous transport layer configurations:
- TLS 1.0 / TLS 1.1 (Deprecated by RFC 8996)
- Disabled certificate verification (ssl.CERT_NONE)
- Disabled hostname validation (check_hostname = False)
- Insecure null / export ciphers
"""

import ssl
import socket


def create_insecure_tls_context() -> ssl.SSLContext:
    """Creates a TLS context disabling trust validation."""
    # 1. Deprecated protocol version
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLSv1)

    # 2. Disabled certificate verification (MITM vulnerable)
    ctx.verify_mode = ssl.CERT_NONE

    # 3. Disabled hostname checking
    ctx.check_hostname = False

    # 4. Insecure cipher suite list including legacy 3DES and RC4
    ctx.set_ciphers("RC4-MD5:DES-CBC3-SHA:AES128-SHA")

    return ctx


def connect_untrusted_socket(host: str, port: int):
    """Establishes unverified TLS socket connection."""
    ctx = create_insecure_tls_context()
    raw_sock = socket.create_connection((host, port))
    tls_sock = ctx.wrap_socket(raw_sock, server_hostname=host)
    return tls_sock
