"""
Category: Certificate Problems (Phase 22.3 Golden Corpus)
Generates and models problematic X.509 certificates:
- Self-signed certificate
- Expired validity period (notValidAfter in the past)
- Future validity period (notValidBefore in the future)
- Weak signature algorithm (md5WithRSAEncryption, sha1WithRSAEncryption)
- Short RSA public key (< 2048 bits)
"""

import datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa


def generate_problematic_certificates():
    """Builds test X.509 certificate structures exhibiting common trust vulnerabilities."""
    # 1. Generate weak 1024-bit RSA private key
    key = rsa.generate_private_key(public_exponent=65537, key_size=1024)

    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "insecure.internal.test"),
    ])

    # 2. Expired validity window (2020-2021)
    past_start = datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc)
    past_end = datetime.datetime(2021, 1, 1, tzinfo=datetime.timezone.utc)

    # 3. Self-signed with weak SHA-1 signature hash
    cert_builder = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)  # Self-signed
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(past_start)
        .not_valid_after(past_end)
    )

    # Sign with deprecated SHA-1
    cert_sha1 = cert_builder.sign(key, hashes.SHA1())
    return cert_sha1
