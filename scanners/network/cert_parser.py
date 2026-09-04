from typing import Tuple, Optional, Dict, Any
from datetime import datetime, timezone
from cryptography.hazmat.primitives.asymmetric import rsa, ec, dsa, ed25519, ed448


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
    not_before = cert.not_valid_before_utc
    not_after = cert.not_valid_after_utc
    is_expired = now > not_after
    is_self_signed = cert.issuer == cert.subject

    algo_family, key_size = get_key_info(cert.public_key())

    return {
        "subjectName": cert.subject.rfc4514_string(),
        "issuerName": cert.issuer.rfc4514_string(),
        "notValidBefore": not_before.isoformat(),
        "notValidAfter": not_after.isoformat(),
        "isExpired": is_expired,
        "isSelfSigned": is_self_signed,
        "algo_family": algo_family,
        "key_size": key_size,
    }
