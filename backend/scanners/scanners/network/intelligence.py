"""
ECDAT Cryptographic Network Intelligence (Phase 5.1)
Extracts and classifies:
- TLS versions & cipher suites
- Key exchange mechanisms (ECDHE, DHE, RSA, TLS 1.3 Key Share)
- Certificate signature algorithms
- Weak/deprecated protocols and algorithms (SSLv2/v3, TLS 1.0/1.1, RC4, 3DES, CBC, MD5, SHA-1)
- Certificate expiration & trust problems (expired, not yet valid, self-signed, weak keys)
- Quantum-vulnerable classical mechanisms (Shor's algorithm for asymmetric KEX/signatures, Grover's algorithm for symmetric ciphers)
"""

import re
from typing import List, Dict, Any, Set
from scanners.models import NetworkCryptoFinding


def extract_key_exchanges(tls_versions: List[str], cipher_suites: List[str]) -> List[str]:
    """
    Extracts or infers negotiated/supported key exchange mechanisms.
    """
    kex_set: Set[str] = set()

    # TLS 1.3 mandates ephemeral Diffie-Hellman / ECDHE key shares
    if any("1.3" in v for v in tls_versions):
        kex_set.add("ECDHE-TLS1.3-KeyShare")

    for cipher in cipher_suites:
        c_upper = cipher.upper()
        if "ECDHE" in c_upper or "ECDH_ANON" in c_upper:
            kex_set.add("ECDHE")
        elif "DHE" in c_upper or "EDH" in c_upper:
            kex_set.add("DHE")
        elif "ECDH" in c_upper:
            kex_set.add("Static-ECDH")
        elif "DH" in c_upper:
            kex_set.add("DH")
        elif "PSK" in c_upper:
            kex_set.add("PSK")
        elif (
            c_upper.startswith("TLS_RSA_")
            or c_upper.startswith("RSA_")
            or ("-SHA" in c_upper and not any(k in c_upper for k in ["ECDHE", "DHE", "ECDH", "DH"]))
            or any(legacy in c_upper for legacy in ["DES-CBC3", "RC4-MD5", "RC4-SHA", "AES128-SHA", "AES256-SHA"])
        ):
            kex_set.add("RSA-KeyExchange")

    return sorted(list(kex_set))


def extract_signature_algorithms(cert_chain: List[Dict[str, Any]], cipher_suites: List[str] = None) -> List[str]:
    """
    Extracts signature algorithms from the certificate chain or cipher suites.
    """
    sigs: Set[str] = set()

    for cert in cert_chain:
        sig = cert.get("signature_algorithm")
        if sig:
            sigs.add(sig)

    if not sigs and cipher_suites:
        for cipher in cipher_suites:
            c_upper = cipher.upper()
            if "ECDSA" in c_upper:
                sigs.add("ECDSA")
            elif "RSA" in c_upper:
                sigs.add("RSA")
            elif "DSS" in c_upper or "DSA" in c_upper:
                sigs.add("DSA")

    return sorted(list(sigs))


def classify_weak_algorithms(
    tls_versions: List[str],
    cipher_suites: List[str],
    cert_chain: List[Dict[str, Any]],
) -> List[str]:
    """
    Detects deprecated or cryptographically weak protocols, ciphers, and hash functions.
    """
    weak_findings: Set[str] = set()

    # 1. Deprecated TLS/SSL protocol versions
    for ver in tls_versions:
        v_upper = ver.upper()
        if "SSLV2" in v_upper or "SSL 2" in v_upper:
            weak_findings.add("deprecated_protocol:SSLv2")
        elif "SSLV3" in v_upper or "SSL 3" in v_upper:
            weak_findings.add("deprecated_protocol:SSLv3")
        elif "TLSV1.0" in v_upper or "TLS 1.0" in v_upper or v_upper == "TLSV1":
            weak_findings.add("deprecated_protocol:TLSv1.0")
        elif "TLSV1.1" in v_upper or "TLS 1.1" in v_upper:
            weak_findings.add("deprecated_protocol:TLSv1.1")

    # 2. Insecure or deprecated cipher suites
    for cipher in cipher_suites:
        c_upper = cipher.upper()
        if "RC4" in c_upper:
            weak_findings.add("weak_cipher:RC4")
        if "3DES" in c_upper or "DES-CBC3" in c_upper or "DES" in c_upper:
            weak_findings.add("weak_cipher:3DES")
        if "NULL" in c_upper:
            weak_findings.add("insecure_cipher:NULL")
        if "EXPORT" in c_upper or "EXP" in c_upper:
            weak_findings.add("insecure_cipher:EXPORT")
        if "ANON" in c_upper:
            weak_findings.add("insecure_cipher:ANONYMOUS")
        if "MD5" in c_upper:
            weak_findings.add("weak_hash:MD5")
        if re.search(r"(-SHA$|-SHA1$|_SHA$|_SHA1$)", c_upper):
            weak_findings.add("deprecated_hash:SHA1")
        # CBC mode in TLS 1.2 or earlier exposes to Lucky 13 / padding oracle attacks
        if "CBC" in c_upper or (
            any(leg in c_upper for leg in ["AES128-SHA", "AES256-SHA", "DES-CBC3-SHA"])
            and not any(aead in c_upper for aead in ["GCM", "CCM", "POLY1305"])
        ):
            weak_findings.add("vulnerable_cipher_mode:CBC")

    # 3. Weak certificate attributes
    for cert in cert_chain:
        sig = str(cert.get("signature_algorithm", "")).lower()
        if "md5" in sig:
            weak_findings.add("weak_cert_signature:MD5")
        elif "sha1" in sig:
            weak_findings.add("weak_cert_signature:SHA1")

        algo = cert.get("algo_family")
        key_size = cert.get("key_size")
        if algo == "RSA" and key_size and key_size < 2048:
            weak_findings.add(f"weak_cert_key:RSA_{key_size}_below_2048")
        elif algo in ("EC", "ECDSA") and key_size and key_size < 224:
            weak_findings.add(f"weak_cert_key:EC_{key_size}_below_224")

    return sorted(list(weak_findings))


def extract_trust_problems(cert_chain: List[Dict[str, Any]]) -> List[str]:
    """
    Collects trust and validity anomalies across certificate chain.
    """
    problems: Set[str] = set()
    for cert in cert_chain:
        if cert.get("isExpired"):
            problems.add("expired_certificate")
        if cert.get("isNotYetValid"):
            problems.add("not_yet_valid_certificate")
        if cert.get("isSelfSigned"):
            problems.add("self_signed_certificate")
        for p in cert.get("trust_problems", []):
            problems.add(p)
    return sorted(list(problems))


def classify_quantum_vulnerabilities(
    key_exchanges: List[str],
    cert_chain: List[Dict[str, Any]],
    cipher_suites: List[str],
) -> List[str]:
    """
    Maps classical mechanisms to quantum threat models:
    - Shor's algorithm: breaks asymmetric key exchange (RSA, DH, ECDH) and signatures (RSA, DSA, ECDSA, Ed25519)
    - Grover's algorithm: reduces effective security of symmetric ciphers < 256 bits
    """
    vulns: Set[str] = set()

    # 1. Classical key exchange broken by Shor's algorithm
    for kex in key_exchanges:
        if any(classical in kex for classical in ["ECDHE", "DHE", "DH", "RSA", "Static-ECDH"]):
            vulns.add("shor_vulnerable_key_exchange")
            break

    # 2. Classical asymmetric signatures & identities broken by Shor's algorithm
    for cert in cert_chain:
        algo = cert.get("algo_family")
        if algo in ("RSA", "EC", "ECDSA", "DSA", "Ed25519", "Ed448"):
            vulns.add("shor_vulnerable_signature_and_identity")
            break

    # 3. Symmetric ciphers vulnerable to Grover's algorithm
    has_sub_256_symmetric = False
    has_256_symmetric = False

    for cipher in cipher_suites:
        c_upper = cipher.upper()
        if any(s in c_upper for s in ["128", "RC4", "3DES", "DES"]):
            has_sub_256_symmetric = True
        if any(s in c_upper for s in ["256"]):
            has_256_symmetric = True

    if has_sub_256_symmetric:
        vulns.add("grover_sensitive_symmetric_encryption_128bit")
    if has_256_symmetric:
        vulns.add("quantum_resistant_symmetric_256bit")

    return sorted(list(vulns))


def enrich_finding_intelligence(finding: NetworkCryptoFinding) -> NetworkCryptoFinding:
    """
    Enriches finding with derived cryptographic intelligence.
    """
    # Key exchanges
    kex = extract_key_exchanges(finding.tls_versions, finding.cipher_suites)
    for k in kex:
        if k not in finding.key_exchanges:
            finding.key_exchanges.append(k)

    # Signature algorithms
    sigs = extract_signature_algorithms(finding.cert_chain, finding.cipher_suites)
    for s in sigs:
        if s not in finding.signature_algorithms:
            finding.signature_algorithms.append(s)

    # Weak/deprecated algorithms
    weak = classify_weak_algorithms(finding.tls_versions, finding.cipher_suites, finding.cert_chain)
    for w in weak:
        if w not in finding.weak_algorithms:
            finding.weak_algorithms.append(w)

    # Trust problems
    trust = extract_trust_problems(finding.cert_chain)
    for t in trust:
        if t not in finding.trust_problems:
            finding.trust_problems.append(t)

    # Quantum vulnerabilities
    quantum = classify_quantum_vulnerabilities(finding.key_exchanges, finding.cert_chain, finding.cipher_suites)
    for q in quantum:
        if q not in finding.quantum_vulnerabilities:
            finding.quantum_vulnerabilities.append(q)

    return finding
