import re
import hashlib

# Patterns to redact
PEM_HEADER_REGEX = re.compile(r"-----BEGIN (.*?)KEY-----", re.IGNORECASE)
PEM_BODY_REGEX = re.compile(r"-----BEGIN [^-]+-----\s*([a-zA-Z0-9+/=\s]+)\s*-----END", re.IGNORECASE | re.MULTILINE)
LONG_ENTROPY_BLOB_REGEX = re.compile(r"[a-zA-Z0-9+/=]{64,}")
PASSWORD_LIKE_REGEX = re.compile(r"(?i)(password|passwd|pwd|secret|token|api_key|apikey)[\s=:]+[\"']([^\"']+)[\"']")


def redact_secrets(content: str) -> str:
    """
    Sanitize sensitive information from strings/evidence snippets before they are outputted.
    """
    if not content:
        return content

    sanitized = content

    # Redact PEM Body
    for match in PEM_BODY_REGEX.finditer(sanitized):
        full_match = match.group(0)
        body = match.group(1)
        h = hashlib.sha256(body.encode("utf-8")).hexdigest()[:8]
        redacted_body = f"\n[REDACTED_PEM_BODY SHA256:{h}]\n"
        redacted_full = full_match.replace(body, redacted_body)
        sanitized = sanitized.replace(full_match, redacted_full)

    # Redact Long entropy blobs (possible base64 keys)
    for match in LONG_ENTROPY_BLOB_REGEX.finditer(sanitized):
        val = match.group(0)
        h = hashlib.sha256(val.encode("utf-8")).hexdigest()[:8]
        sanitized = sanitized.replace(val, f"[REDACTED_BLOB SHA256:{h}]")

    # Redact simple password assignments
    for match in PASSWORD_LIKE_REGEX.finditer(sanitized):
        full = match.group(0)
        val = match.group(2)
        h = hashlib.sha256(val.encode("utf-8")).hexdigest()[:8]
        sanitized = sanitized.replace(val, f"[REDACTED_SECRET SHA256:{h}]")

    return sanitized
