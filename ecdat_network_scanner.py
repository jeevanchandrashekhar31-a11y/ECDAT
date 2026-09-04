"""
ECDAT — Network/Protocol Scanner (MVP)

Given a target host:port, this does exactly what a browser does when it visits
an HTTPS site: opens a TCP connection, performs a TLS handshake, and inspects
the certificate the server presents. No external scanning library — raw
socket + ssl, so every step is visible and explainable.

Negotiates the single strongest mutually-supported TLS version/cipher only. Does not enumerate legacy/weak fallback ciphers a server may also accept — full cipher-suite enumeration (e.g. via sslyze) is post-MVP roadmap, not implemented here.

Output: one CycloneDX-style CBOM fragment per target, matching our schema
contract (bom-ref = net:<assetType>/<slug>@<host>:<port>).

Deferred features (not implemented): IPv6 literal handling, dual-connection load-balancer edge cases, cryptography version pinning.
"""

import socket
import ssl
import json
import sys
import subprocess
import re
import argparse
from pathlib import Path
from datetime import datetime, timezone
from cryptography import x509
from cryptography.hazmat.primitives.asymmetric import rsa, ec

ALLOWED_TARGETS = {"badssl.com", "expired.badssl.com", "self-signed.badssl.com"}


# Python's ssl module reports TLS 1.2-and-below cipher names in OpenSSL's
# dash-separated style (e.g. "ECDHE-RSA-AES128-GCM-SHA256"). CycloneDX/CBOM
# consumers expect the IANA registry name (e.g.
# "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256"). TLS 1.3 names already match IANA
# style in OpenSSL, so they pass through unchanged. This table covers the
# cipher suites you'll actually encounter scanning real servers; anything
# not in the table is left as-is and flagged "unmapped" rather than guessed.
OPENSSL_TO_IANA_CIPHER = {
    "ECDHE-RSA-AES128-GCM-SHA256": "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
    "ECDHE-RSA-AES256-GCM-SHA384": "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
    "ECDHE-ECDSA-AES128-GCM-SHA256": "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
    "ECDHE-ECDSA-AES256-GCM-SHA384": "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
    "ECDHE-RSA-AES128-SHA": "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
    "ECDHE-RSA-AES256-SHA": "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
    "ECDHE-RSA-AES128-SHA256": "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
    "ECDHE-RSA-AES256-SHA384": "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384",
    "ECDHE-RSA-CHACHA20-POLY1305": "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
    "ECDHE-ECDSA-CHACHA20-POLY1305": "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
    "AES128-GCM-SHA256": "TLS_RSA_WITH_AES_128_GCM_SHA256",
    "AES256-GCM-SHA384": "TLS_RSA_WITH_AES_256_GCM_SHA384",
    "AES128-SHA": "TLS_RSA_WITH_AES_128_CBC_SHA",
    "AES256-SHA": "TLS_RSA_WITH_AES_256_CBC_SHA",
    "AES128-SHA256": "TLS_RSA_WITH_AES_128_CBC_SHA256",
    "AES256-SHA256": "TLS_RSA_WITH_AES_256_CBC_SHA256",
    "DES-CBC3-SHA": "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
    "RC4-SHA": "TLS_RSA_WITH_RC4_128_SHA",
    "RC4-MD5": "TLS_RSA_WITH_RC4_128_MD5",
}


def to_iana_cipher_name(openssl_name: str) -> str:
    if openssl_name.startswith("TLS_"):
        return openssl_name  # TLS 1.3 names already match IANA style
    return OPENSSL_TO_IANA_CIPHER.get(openssl_name, f"{openssl_name} (unmapped)")


def fetch_certificate_chain(host: str, port: int, timeout: float = 6.0):
    """
    Walk the full certificate chain (leaf -> intermediate(s) -> root, if
    sent) using `openssl s_client -showcerts`. Returns a list of parsed
    x509 certificate objects in the order the server presented them, or
    None if openssl isn't available / the call fails -- callers should
    fall back to the single leaf cert from the ssl module in that case.
    """
    try:
        proc = subprocess.run(
            ["openssl", "s_client", "-connect", f"{host}:{port}",
             "-servername", host, "-showcerts"],
            input=b"", capture_output=True, timeout=timeout,
        )
    except Exception as e:
        return None

    pem_blocks = re.findall(
        rb"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
        proc.stdout, re.DOTALL,
    )
    if not pem_blocks:
        return None

    certs = []
    for block in pem_blocks:
        try:
            certs.append(x509.load_pem_x509_certificate(block))
        except ValueError:
            continue
    return certs or None


def classify_key(pubkey):
    """Return (algorithm_family, size_bits, nist_quantum_security_level)."""
    if isinstance(pubkey, rsa.RSAPublicKey):
        size = pubkey.key_size
        # RSA is broken by Shor's algorithm regardless of size — classical
        # key size matters for today's security, not for quantum resistance.
        return "RSA", size, 0
    if isinstance(pubkey, ec.EllipticCurvePublicKey):
        size = pubkey.curve.key_size
        return "EC", size, 0
    return pubkey.__class__.__name__, None, 0


def scan_target(host: str, port: int = 443, timeout: float = 5.0) -> dict:
    locator = f"{host}:{port}"
    findings = []

    if host not in ALLOWED_TARGETS:
        print(f"Error: Target {host} is not in ALLOWED_TARGETS. Unauthorized network scanning carries legal and IDS-trigger risk. Refusing to scan.", file=sys.stderr)
        return {
            "target": locator,
            "reachable": False,
            "error": "Target not authorized in ALLOWED_TARGETS list.",
            "findings": [],
        }

    # --- Step 1: raw TCP three-way handshake ---
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except (socket.timeout, socket.gaierror, ConnectionRefusedError, OSError) as e:
        return {
            "target": locator,
            "reachable": False,
            "error": f"{type(e).__name__}: {e}",
            "findings": [],
        }

    # --- Step 2: TLS handshake on top of the open TCP connection ---
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # we want to inspect weak/self-signed certs too, not reject them

    try:
        with ctx.wrap_socket(sock, server_hostname=host) as tls_sock:
            negotiated_version = tls_sock.version()
            negotiated_cipher = tls_sock.cipher()  # (name, protocol, secret_bits)
            der_cert = tls_sock.getpeercert(binary_form=True)
    except (ssl.SSLError, socket.timeout, OSError) as e:
        sock.close()
        return {
            "target": locator,
            "reachable": True,
            "tls_error": f"{type(e).__name__}: {e}",
            "findings": [],
        }

    # --- Step 3: parse the certificate chain ---
    # Try to walk the full chain (leaf + intermediates + root, if sent) via
    # openssl. If that's unavailable for any reason, fall back to just the
    # leaf cert the ssl module already gave us, so the scanner still works.
    try:
        chain_source = "openssl"
        chain = fetch_certificate_chain(host, port, timeout=timeout)
        if not chain:
            chain = [x509.load_der_x509_certificate(der_cert)]
            chain_source = "fallback-leaf-only"
        chain_complete = len(chain) > 1 and chain[-1].issuer == chain[-1].subject

        now = datetime.now(timezone.utc)
        iana_cipher = to_iana_cipher_name(negotiated_cipher[0]) if negotiated_cipher else None

        findings.append({
            "type": "cryptographic-asset",
            "bom-ref": f"net:protocol/{negotiated_version.lower().replace(' ', '')}@{locator}",
            "name": f"TLS {negotiated_version}",
            "cryptoProperties": {
                "assetType": "protocol",
                "protocolProperties": {
                    "type": "tls",
                    "version": negotiated_version,
                    "cipherSuites": [iana_cipher] if iana_cipher else [],
                },
            },
            "evidence": {"occurrences": [{"location": locator, "additionalContext": "negotiated during TLS handshake"}]},
        })

        chain_positions = []
        for i, cert in enumerate(chain):
            if i == 0:
                chain_positions.append("leaf")
            elif cert.issuer == cert.subject:
                chain_positions.append("root")  # only a true root if actually self-signed
            else:
                chain_positions.append("intermediate")

        for i, cert in enumerate(chain):
            position = chain_positions[i]
            not_before, not_after = cert.not_valid_before_utc, cert.not_valid_after_utc
            is_expired = now > not_after
            is_self_signed = cert.issuer == cert.subject
            algo_family, key_size, nist_level = classify_key(cert.public_key())
            ref_suffix = locator if i == 0 else f"{locator}-chain{i}"

            findings.append({
                "type": "cryptographic-asset",
                "bom-ref": f"net:certificate/{ref_suffix}",
                "name": f"{host} {position} certificate",
                "cryptoProperties": {
                    "assetType": "certificate",
                    "certificateProperties": {
                        "subjectName": cert.subject.rfc4514_string(),
                        "issuerName": cert.issuer.rfc4514_string(),
                        "notValidBefore": not_before.isoformat(),
                        "notValidAfter": not_after.isoformat(),
                        "certificateFormat": "X.509",
                        "isExpired": is_expired,
                        "isSelfSigned": is_self_signed,
                        "chainPosition": position,
                    },
                },
                "evidence": {"occurrences": [{"location": locator, "additionalContext": f"negotiated {position} certificate"}]},
            })

            findings.append({
                "type": "cryptographic-asset",
                "bom-ref": f"net:algorithm/{algo_family.lower()}-{key_size}@{ref_suffix}",
                "name": f"{algo_family}-{key_size}",
                "cryptoProperties": {
                    "assetType": "algorithm",
                    "algorithmProperties": {
                        "primitive": "signature",
                        "algorithmFamily": algo_family,
                        "parameterSetIdentifier": str(key_size),
                        "nistQuantumSecurityLevel": nist_level,
                    },
                },
                "evidence": {"occurrences": [{"location": locator, "additionalContext": f"negotiated {position} certificate"}]},
            })

        return {
            "target": locator,
            "reachable": True,
            "negotiated_tls_version": negotiated_version,
            "negotiated_cipher": iana_cipher,
            "chain_length": len(chain),
            "chain_complete": chain_complete,
            "chainSource": chain_source,
            "findings": findings,
        }
    except Exception as e:
        return {
            "target": locator,
            "reachable": True,
            "parse_error": f"{type(e).__name__}: {e}",
            "findings": []
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ECDAT Network/Protocol Scanner (MVP)")
    parser.add_argument("targets", nargs="*", default=["badssl.com:443"], help="Target host:port (or just host)")
    parser.add_argument("-o", "--output", help="Output JSON path (writes to stdout if omitted)")
    args = parser.parse_args()
    
    results = []
    for t in args.targets:
        try:
            if ":" in t:
                parts = t.split(":", 1)
                res = scan_target(parts[0], int(parts[1]))
            else:
                res = scan_target(t)
            results.append(res)
        except Exception as e:
            results.append({
                "target": t,
                "reachable": True,
                "parse_error": f"Unhandled exception: {type(e).__name__}: {e}",
                "findings": []
            })
            
    out_json = json.dumps(results, indent=2)
    if args.output:
        Path(args.output).write_text(out_json, encoding="utf-8")
    else:
        print(out_json)
