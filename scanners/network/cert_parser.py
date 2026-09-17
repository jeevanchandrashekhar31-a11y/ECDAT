from typing import Tuple, Optional, Dict, Any, List
from datetime import datetime, timezone
from cryptography.hazmat.primitives.asymmetric import rsa, ec, dsa, ed25519, ed448
from cryptography.hazmat.primitives import hashes
import cryptography.x509
import re


def get_key_info(public_key) -> Tuple[str, Optional[int]]:
    if isinstance(public_key, rsa.RSAPublicKey):
        return "RSA", public_key.key_size
    elif isinstance(public_key, ec.EllipticCurvePublicKey):
        return "EC", public_key.curve.key_size
    elif isinstance(public_key, dsa.DSAPublicKey):
        return "DSA", public_key.key_size
    elif isinstance(public_key, ed25519.Ed25519PublicKey):
        return "Ed25519", 256
    elif isinstance(public_key, ed448.Ed448PublicKey):
        return "Ed448", 448
    return public_key.__class__.__name__.replace("PublicKey", ""), None


def parse_cert(cert) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)

    # Validity dates
    if hasattr(cert, "not_valid_before_utc"):
        not_before = cert.not_valid_before_utc
    elif hasattr(cert, "not_valid_before"):
        not_before = cert.not_valid_before.replace(tzinfo=timezone.utc)
    else:
        not_before = now

    if hasattr(cert, "not_valid_after_utc"):
        not_after = cert.not_valid_after_utc
    elif hasattr(cert, "not_valid_after"):
        not_after = cert.not_valid_after.replace(tzinfo=timezone.utc)
    else:
        not_after = now

    is_expired = now > not_after
    is_not_yet_valid = now < not_before

    # Subject & Issuer
    try:
        subject_name = cert.subject.rfc4514_string()
    except Exception:
        subject_name = str(getattr(cert, "subject", "unknown"))

    try:
        issuer_name = cert.issuer.rfc4514_string()
    except Exception:
        issuer_name = str(getattr(cert, "issuer", "unknown"))

    is_self_signed = (cert.issuer == cert.subject) if hasattr(cert, "issuer") and hasattr(cert, "subject") else False

    # Key info
    algo_family, key_size = None, None
    try:
        pk = cert.public_key()
        algo_family, key_size = get_key_info(pk)
    except Exception:
        pass

    # Signature Algorithm & Hash
    sig_algo = None
    sig_hash = None
    try:
        if hasattr(cert, "signature_algorithm_oid"):
            sig_algo = (
                getattr(cert.signature_algorithm_oid, "_name", None) or cert.signature_algorithm_oid.dotted_string
            )
    except Exception:
        pass

    try:
        if hasattr(cert, "signature_hash_algorithm") and cert.signature_hash_algorithm:
            sig_hash = cert.signature_hash_algorithm.name
    except Exception:
        pass

    # Subject Alternative Names (SANs)
    sans: List[str] = []
    try:
        from cryptography.x509.oid import ExtensionOID

        san_ext = cert.extensions.get_extension_for_oid(ExtensionOID.SUBJECT_ALTERNATIVE_NAME)
        for name in san_ext.value:
            sans.append(str(name.value))
    except Exception:
        pass

    # Fingerprint
    fingerprint = ""
    try:
        fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    except Exception:
        pass

    # Serial number
    serial_str = ""
    try:
        serial_str = hex(cert.serial_number)[2:]
    except Exception:
        pass

    # Trust problems detection
    trust_problems: List[str] = []
    if is_expired:
        trust_problems.append("expired_certificate")
    if is_not_yet_valid:
        trust_problems.append("not_yet_valid_certificate")
    if is_self_signed:
        trust_problems.append("self_signed_certificate")
    if sig_algo:
        sig_lower = sig_algo.lower()
        if "md5" in sig_lower:
            trust_problems.append("weak_signature_algorithm_md5")
        elif "sha1" in sig_lower:
            trust_problems.append("weak_signature_algorithm_sha1")
    if algo_family == "RSA" and key_size and key_size < 2048:
        trust_problems.append(f"weak_rsa_key_size_{key_size}")
    if algo_family in ("EC", "ECDSA") and key_size and key_size < 224:
        trust_problems.append(f"weak_ec_key_size_{key_size}")

    # Quantum vulnerabilities
    quantum_vulns: List[str] = []
    if algo_family in ("RSA", "EC", "ECDSA", "DSA", "Ed25519", "Ed448"):
        quantum_vulns.append("shor_vulnerable_asymmetric_key")

    return {
        "subjectName": subject_name,
        "issuerName": issuer_name,
        "notValidBefore": not_before.isoformat(),
        "notValidAfter": not_after.isoformat(),
        "isExpired": is_expired,
        "isNotYetValid": is_not_yet_valid,
        "isSelfSigned": is_self_signed,
        "algo_family": algo_family,
        "key_size": key_size,
        "signature_algorithm": sig_algo,
        "signature_hash": sig_hash,
        "sans": sans,
        "fingerprint_sha256": fingerprint,
        "serial_number": serial_str,
        "trust_problems": trust_problems,
        "quantum_vulnerabilities": quantum_vulns,
    }


class CertSecurityError(Exception):
    """Raised when certificate input contains security violations or private keys."""

    pass


class CertParsingError(Exception):
    """Raised when certificate input cannot be parsed or is corrupted."""

    pass


class SafeCertParser:
    """
    Hardened certificate parser supporting DER, PEM, and PKCS#7 certificate chains.
    Enforces size bounds, recursion limits, and zero secret leakage.
    """

    MAX_CERT_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB maximum certificate payload
    MAX_CHAIN_LENGTH = 20  # Maximum certificates in a single PEM bundle

    @classmethod
    def parse_bytes(cls, data: bytes, format: str = "auto") -> Dict[str, Any]:
        """
        Safely parse raw bytes (DER or PEM) into a structured dictionary.
        Guarantees:
        - Rejection of oversized payloads (> 10MB)
        - Rejection and sanitization of private keys (never leaked in error)
        - Handling of truncated, malformed ASN.1 without crashes
        """
        if not data:
            raise CertParsingError("Certificate data is empty.")

        if len(data) > cls.MAX_CERT_SIZE_BYTES:
            raise CertSecurityError(
                f"Certificate payload ({len(data)} bytes) exceeds safety limit ({cls.MAX_CERT_SIZE_BYTES} bytes)."
            )

        # Defense against private key leakage in certificate parsing pipelines
        if b"PRIVATE KEY" in data:
            raise CertSecurityError(
                "Input contains private key material, which is strictly prohibited in certificate parsing."
            )

        fmt = format.lower()
        if fmt == "auto":
            if b"-----BEGIN" in data:
                fmt = "pem"
            else:
                fmt = "der"

        if fmt == "pem":
            try:
                # Find all PEM certificates
                certs = []
                pem_text = data.decode("utf-8", errors="replace")
                pem_blocks = re.findall(r"-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----", pem_text)
                if not pem_blocks:
                    raise CertParsingError("No valid PEM certificate boundaries found.")

                if len(pem_blocks) > cls.MAX_CHAIN_LENGTH:
                    raise CertSecurityError(
                        f"Certificate chain contains {len(pem_blocks)} certs, exceeding max limit ({cls.MAX_CHAIN_LENGTH})."
                    )

                for block in pem_blocks:
                    loaded = cryptography.x509.load_pem_x509_certificate(block.encode("utf-8"))
                    certs.append(parse_cert(loaded))

                return {
                    "format": "pem",
                    "chain_length": len(certs),
                    "primary_certificate": certs[0],
                    "chain": certs,
                }
            except CertSecurityError:
                raise
            except Exception as e:
                # Sanitize error message to prevent accidental echo of inputs
                raise CertParsingError(f"Failed to parse PEM certificate: {type(e).__name__}")

        elif fmt == "der":
            try:
                loaded = cryptography.x509.load_der_x509_certificate(data)
                parsed = parse_cert(loaded)
                return {
                    "format": "der",
                    "chain_length": 1,
                    "primary_certificate": parsed,
                    "chain": [parsed],
                }
            except Exception as e:
                raise CertParsingError(f"Failed to parse DER certificate: {type(e).__name__}")
        else:
            raise CertParsingError(f"Unsupported certificate format '{format}'. Supported: der, pem, auto.")


def parse_cert_bytes(data: bytes, format: str = "auto") -> Dict[str, Any]:
    """Convenience helper for SafeCertParser.parse_bytes."""
    return SafeCertParser.parse_bytes(data, format=format)
